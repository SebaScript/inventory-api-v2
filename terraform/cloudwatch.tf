# The thresholds live in one versioned file: the alarms here and the pipeline gate both read it.
locals {
  slo    = jsondecode(file("${path.module}/../canary/slo.json"))
  colors = { stable = "#2ca02c", canary = "#ff7f0e" }

  alb_dimensions = {
    for track, group in aws_lb_target_group.api :
    track => ["TargetGroup", group.arn_suffix, "LoadBalancer", aws_lb.api.arn_suffix]
  }

  # One line per track, so every widget compares stable and canary side by side.
  per_track = {
    for track in keys(local.tracks) : track => {
      requests = concat(["AWS/ApplicationELB", "RequestCount"], local.alb_dimensions[track])
      errors   = concat(["AWS/ApplicationELB", "HTTPCode_Target_5XX_Count"], local.alb_dimensions[track])
      rejected = concat(["AWS/ApplicationELB", "HTTPCode_Target_4XX_Count"], local.alb_dimensions[track])
      latency  = concat(["AWS/ApplicationELB", "TargetResponseTime"], local.alb_dimensions[track])
      cpu      = ["AWS/EC2", "CPUUtilization", "InstanceId", aws_instance.api[track].id]
      memory   = [var.project, "MemoryUsedMB", "Track", track]
      business = [var.project, "MovementsRecorded", "Track", track]
    }
  }

  rate_lines = {
    for kind in ["errors", "rejected"] : kind => flatten([
      for track, m in local.per_track : [
        concat(m.requests, [{ id = "r_${track}", stat = "Sum", visible = false }]),
        concat(m[kind], [{ id = "e_${track}", stat = "Sum", visible = false }]),
        [{ expression = "100 * FILL(e_${track}, 0) / r_${track}", label = track, color = local.colors[track] }],
      ]
    ])
  }

  widgets = [
    ["Traffic (requests per minute)", [for track, m in local.per_track : concat(m.requests, [{ stat = "Sum", label = track, color = local.colors[track] }])]],
    ["Canary share of traffic (%)", [
      concat(local.per_track.stable.requests, [{ id = "s", stat = "Sum", visible = false }]),
      concat(local.per_track.canary.requests, [{ id = "c", stat = "Sum", visible = false }]),
      [{ expression = "100 * FILL(c, 0) / (FILL(s, 0) + FILL(c, 0))", label = "canary %", color = local.colors.canary }],
    ]],
    ["5xx error rate (%)", local.rate_lines.errors],
    ["4xx error rate (%)", local.rate_lines.rejected],
    ["Latency p50 / p95 / p99 (seconds)", flatten([
      for track, m in local.per_track : [
        for p in ["p50", "p95", "p99"] : concat(m.latency, [{ stat = p, label = "${track} ${p}", color = local.colors[track] }])
      ]
    ])],
    ["CPU (%)", [for track, m in local.per_track : concat(m.cpu, [{ stat = "Average", label = track, color = local.colors[track] }])]],
    ["Memory (MB)", [for track, m in local.per_track : concat(m.memory, [{ stat = "Average", label = track, color = local.colors[track] }])]],
    ["Movements recorded per minute (business)", [for track, m in local.per_track : concat(m.business, [{ stat = "Sum", label = track, color = local.colors[track] }])]],
  ]
}

# Detection: either alarm firing during a stage makes the pipeline send every request back to stable.
resource "aws_cloudwatch_metric_alarm" "canary_errors" {
  alarm_name          = "${var.project}-canary-errors"
  alarm_description   = "Canary 5xx rate above the abort threshold in canary/slo.json"
  comparison_operator = "GreaterThanThreshold"
  threshold           = local.slo.objectives.errorRate.abort * 100
  evaluation_periods  = 3
  datapoints_to_alarm = 2
  treat_missing_data  = "notBreaching"

  metric_query {
    id          = "rate"
    expression  = "IF(requests >= 30, 100 * FILL(errors, 0) / requests, 0)"
    return_data = true
  }
  metric_query {
    id = "requests"
    metric {
      namespace   = "AWS/ApplicationELB"
      metric_name = "RequestCount"
      stat        = "Sum"
      period      = 60
      dimensions  = { TargetGroup = aws_lb_target_group.api["canary"].arn_suffix, LoadBalancer = aws_lb.api.arn_suffix }
    }
  }
  metric_query {
    id = "errors"
    metric {
      namespace   = "AWS/ApplicationELB"
      metric_name = "HTTPCode_Target_5XX_Count"
      stat        = "Sum"
      period      = 60
      dimensions  = { TargetGroup = aws_lb_target_group.api["canary"].arn_suffix, LoadBalancer = aws_lb.api.arn_suffix }
    }
  }
}

resource "aws_cloudwatch_metric_alarm" "canary_latency" {
  alarm_name          = "${var.project}-canary-latency"
  alarm_description   = "Canary p95 latency above the abort threshold in canary/slo.json"
  namespace           = "AWS/ApplicationELB"
  metric_name         = "TargetResponseTime"
  extended_statistic  = "p95"
  period              = 60
  comparison_operator = "GreaterThanThreshold"
  threshold           = local.slo.objectives.p95LatencyMs.abort / 1000
  evaluation_periods  = 3
  datapoints_to_alarm = 2
  treat_missing_data  = "notBreaching"
  dimensions          = { TargetGroup = aws_lb_target_group.api["canary"].arn_suffix, LoadBalancer = aws_lb.api.arn_suffix }
}

resource "aws_cloudwatch_dashboard" "canary" {
  dashboard_name = var.project
  dashboard_body = jsonencode({
    widgets = concat(
      [for i, w in local.widgets : {
        type   = "metric"
        x      = (i % 2) * 12
        y      = floor(i / 2) * 6
        width  = 12
        height = 6
        properties = {
          title   = w[0]
          metrics = w[1]
          view    = "timeSeries"
          stacked = false
          region  = var.region
          period  = 60
        }
      }],
      [{
        type   = "alarm"
        x      = 0
        y      = ceil(length(local.widgets) / 2) * 6
        width  = 24
        height = 3
        properties = {
          title  = "Automatic abort: either alarm in ALARM sends all traffic back to stable"
          alarms = [aws_cloudwatch_metric_alarm.canary_errors.arn, aws_cloudwatch_metric_alarm.canary_latency.arn]
        }
      }],
    )
  })
}
