# AWS Fault Injection Service: the declarative chaos tool for fault (a).
resource "aws_iam_role" "fis" {
  name = "${var.project}-fis"
  assume_role_policy = jsonencode({
    Version = "2012-10-17"
    Statement = [{
      Effect    = "Allow"
      Action    = "sts:AssumeRole"
      Principal = { Service = "fis.amazonaws.com" }
    }]
  })
}

# Only what the latency action needs: run one AWS document on our own instances.
resource "aws_iam_role_policy" "fis" {
  role = aws_iam_role.fis.id
  policy = jsonencode({
    Version = "2012-10-17"
    Statement = [
      {
        Effect = "Allow"
        Action = "ssm:SendCommand"
        Resource = [
          "arn:aws:ec2:${var.region}:${data.aws_caller_identity.current.account_id}:instance/*",
          "arn:aws:ssm:${var.region}::document/AWSFIS-Run-Network-Latency-Sources",
        ]
      },
      {
        Effect   = "Allow"
        Action   = ["ssm:ListCommands", "ssm:CancelCommand", "ec2:DescribeInstances"]
        Resource = "*"
      },
    ]
  })
}

# Fault (a): 2 s of latency on the node's traffic to the partner's host, for 5 minutes at most.
# Blast radius: that one node and that one destination. Rollback: FIS removes it when the action
# ends or the experiment stops. Abort: the flow-errors alarm. Only exists once the partner is known.
resource "aws_fis_experiment_template" "partner_latency" {
  count = nonsensitive(var.partner_url == "") ? 0 : 1

  description = "Fault (a): 2 s of latency on the calls to the partner API"
  role_arn    = aws_iam_role.fis.arn

  stop_condition {
    source = "aws:cloudwatch:alarm"
    value  = aws_cloudwatch_metric_alarm.flow_errors.arn
  }

  target {
    name           = "node"
    resource_type  = "aws:ec2:instance"
    selection_mode = "ALL"

    resource_tag {
      key   = "Name"
      value = "${var.project}-node"
    }

    filter {
      path   = "State.Name"
      values = ["running"]
    }
  }

  action {
    name      = "partner-latency"
    action_id = "aws:ssm:send-command"

    parameter {
      key   = "documentArn"
      value = "arn:aws:ssm:${var.region}::document/AWSFIS-Run-Network-Latency-Sources"
    }
    parameter {
      key = "documentParameters"
      value = jsonencode({
        DelayMilliseconds   = "2000"
        Sources             = local.partner_host
        Interface           = "ens5"
        DurationSeconds     = "300"
        InstallDependencies = "True"
      })
    }
    parameter {
      key   = "duration"
      value = "PT5M"
    }

    target {
      key   = "Instances"
      value = "node"
    }
  }

  tags = {
    Name = "${var.project}-partner-latency"
  }
}
