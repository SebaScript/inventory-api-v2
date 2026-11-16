# Everything the security game day adds (v4.3.0): an audit trail, detections as code,
# a network boundary for the bucket, immutable versions and a decoy. The chaos platform
# does not depend on any of it; a destroy removes it all but the state bucket.

# --- Experiment 4: versions and a WORM lock on the data bucket ----------------------
# Object Lock needs versioning and is set at bucket creation (see s3.tf: object_lock_enabled),
# so turning it on replaces the disposable demo bucket. Governance, 1-day retention: a
# ransomware overwrite leaves the previous version recoverable, and the end-of-day destroy
# can still bypass the lock (an admin with s3:BypassGovernanceRetention), unlike compliance.

resource "aws_s3_bucket_versioning" "exports" {
  bucket = aws_s3_bucket.exports.id
  versioning_configuration {
    status = "Enabled"
  }
}

resource "aws_s3_bucket_object_lock_configuration" "exports" {
  bucket = aws_s3_bucket.exports.id
  rule {
    default_retention {
      mode = "GOVERNANCE"
      days = 1
    }
  }
}

# The honeytoken: a decoy nobody legitimate ever reads. Any GetObject on it is an alert,
# almost without false positives. Synthetic content, no real credentials.
resource "aws_s3_object" "honeytoken" {
  bucket       = aws_s3_bucket.exports.id
  key          = "flows/admin-credentials-backup.json"
  content_type = "application/json"
  content = jsonencode({
    _decoy = "Synthetic honeytoken. No real credentials. Reading this object raises an alert."
    note   = "flows/admin-credentials-backup.json"
  })
}

# --- Experiment 1, improvement 2: a network boundary for flows/ ---------------------
# Zero Trust at the bucket (NIST SP 800-207): flows/ and the honeytoken are reachable only
# through the VPC endpoint. The node role used from outside AWS (the stolen credential of
# exp 1) gets AccessDenied. exports/ stays open, so presigned CSV links keep working.

data "aws_route_tables" "default" {
  vpc_id = data.aws_vpc.default.id
}

resource "aws_vpc_endpoint" "s3" {
  vpc_id            = data.aws_vpc.default.id
  service_name      = "com.amazonaws.${var.region}.s3"
  vpc_endpoint_type = "Gateway"
  route_table_ids   = data.aws_route_tables.default.ids

  tags = {
    Name = "${var.project}-s3"
  }
}

resource "aws_s3_bucket_policy" "exports" {
  bucket = aws_s3_bucket.exports.id
  policy = jsonencode({
    Version = "2012-10-17"
    Statement = [{
      Sid       = "FlowsOnlyThroughVpceForTheNodeRole"
      Effect    = "Deny"
      Principal = "*"
      Action    = "s3:*"
      Resource  = "${aws_s3_bucket.exports.arn}/flows/*"
      Condition = {
        # Only the node role is boxed in, so Terraform and presigned exports are untouched.
        ArnEquals       = { "aws:PrincipalArn" = aws_iam_role.api.arn }
        StringNotEquals = { "aws:SourceVpce" = aws_vpc_endpoint.s3.id }
      }
    }]
  })
}

# --- Experiment 1, improvement 1: see the stolen credential being used --------------
# CloudTrail with S3 data events feeds the default event bus; the EventBridge rules below
# turn each adverse act into a line in /security/alerts.

resource "aws_s3_bucket" "trail" {
  bucket        = "${var.project}-trail-${data.aws_caller_identity.current.account_id}"
  force_destroy = true
}

# The audit log is versioned: a tamper leaves the previous version (immutable-ish logbook).
resource "aws_s3_bucket_versioning" "trail" {
  bucket = aws_s3_bucket.trail.id
  versioning_configuration {
    status = "Enabled"
  }
}

data "aws_iam_policy_document" "trail" {
  statement {
    sid       = "AclCheck"
    actions   = ["s3:GetBucketAcl"]
    resources = [aws_s3_bucket.trail.arn]
    principals {
      type        = "Service"
      identifiers = ["cloudtrail.amazonaws.com"]
    }
  }
  statement {
    sid       = "Write"
    actions   = ["s3:PutObject"]
    resources = ["${aws_s3_bucket.trail.arn}/AWSLogs/${data.aws_caller_identity.current.account_id}/*"]
    principals {
      type        = "Service"
      identifiers = ["cloudtrail.amazonaws.com"]
    }
    condition {
      test     = "StringEquals"
      variable = "s3:x-amz-acl"
      values   = ["bucket-owner-full-control"]
    }
  }
}

resource "aws_s3_bucket_policy" "trail" {
  bucket = aws_s3_bucket.trail.id
  policy = data.aws_iam_policy_document.trail.json
}

resource "aws_cloudtrail" "main" {
  name                          = var.project
  s3_bucket_name                = aws_s3_bucket.trail.id
  include_global_service_events = true
  is_multi_region_trail         = false
  enable_log_file_validation    = true

  # Object-level reads and writes on the bucket: that is what exp 1 and exp 4 touch.
  event_selector {
    read_write_type           = "All"
    include_management_events = false

    data_resource {
      type   = "AWS::S3::Object"
      values = ["${aws_s3_bucket.exports.arn}/"]
    }
  }

  depends_on = [aws_s3_bucket_policy.trail]
}

# Where the detections write. 30 days, enough for the game day and the write-up.
resource "aws_cloudwatch_log_group" "security" {
  name              = "/security/alerts"
  retention_in_days = 30
}

resource "aws_cloudwatch_log_resource_policy" "security" {
  policy_name = "${var.project}-security-events"
  policy_document = jsonencode({
    Version = "2012-10-17"
    Statement = [{
      Effect    = "Allow"
      Principal = { Service = ["events.amazonaws.com", "delivery.logs.amazonaws.com"] }
      Action    = ["logs:CreateLogStream", "logs:PutLogEvents"]
      Resource  = "${aws_cloudwatch_log_group.security.arn}:*"
    }]
  })
}

# Detection as code: each rule is the same JSON file the CI tests with a positive and a
# negative event. One source of truth for the rule and its tests.
locals {
  detections = {
    "node-role-outside-vpce" = "Machine identity: the node role touching S3 from outside the VPC endpoint (exp 1)"
    "honeytoken-read"        = "Deception: the decoy object was read (trend)"
    "flows-destruction"      = "Ransomware: a flows/ object was deleted (exp 4)"
  }
}

resource "aws_cloudwatch_event_rule" "detection" {
  for_each      = local.detections
  name          = "${var.project}-${each.key}"
  description   = each.value
  event_pattern = file("${path.module}/../security/detections/${each.key}.json")
}

resource "aws_cloudwatch_event_target" "to_security_log" {
  for_each = local.detections
  rule     = aws_cloudwatch_event_rule.detection[each.key].name
  arn      = aws_cloudwatch_log_group.security.arn
}

# Each rule's firing becomes a metric, so an alarm can show it on the dashboard and the
# MTTD query has something to count.
resource "aws_cloudwatch_log_metric_filter" "detection" {
  for_each       = local.detections
  name           = "${var.project}-${each.key}"
  log_group_name = aws_cloudwatch_log_group.security.name
  # Every event the rules deliver carries the rule name in resources[].
  pattern = "\"${var.project}-${each.key}\""

  metric_transformation {
    name          = each.key
    namespace     = "${var.project}-security"
    value         = "1"
    default_value = "0"
  }
}

resource "aws_cloudwatch_metric_alarm" "detection" {
  for_each            = local.detections
  alarm_name          = "${var.project}-${each.key}"
  alarm_description   = each.value
  namespace           = "${var.project}-security"
  metric_name         = each.key
  statistic           = "Sum"
  period              = 60
  evaluation_periods  = 1
  threshold           = 0
  comparison_operator = "GreaterThanThreshold"
  treat_missing_data  = "notBreaching"
}

# The security telemetry dashboard for the demo: the three detections side by side, each
# alarm and its count on one time axis, so a fault window lines up with its alert.
resource "aws_cloudwatch_dashboard" "security" {
  dashboard_name = "${var.project}-security"
  dashboard_body = jsonencode({
    widgets = concat(
      [for i, k in keys(local.detections) : {
        type   = "metric"
        x      = (i % 2) * 12
        y      = floor(i / 2) * 6
        width  = 12
        height = 6
        properties = {
          title   = local.detections[k]
          metrics = [["${var.project}-security", k, { stat = "Sum", label = "firings" }]]
          view    = "timeSeries"
          region  = var.region
          period  = 60
        }
      }],
      [{
        type   = "alarm"
        x      = 0
        y      = 18
        width  = 24
        height = 3
        properties = {
          title  = "Security detections (in ALARM = the control fired)"
          alarms = [for k in keys(local.detections) : aws_cloudwatch_metric_alarm.detection[k].arn]
        }
      }],
    )
  })
}
