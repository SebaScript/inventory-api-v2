# The thresholds live in one versioned file: the abort alarm here and the experiments both read it.
locals {
  slo     = jsondecode(file("${path.module}/../chaos/slo.json"))
  alb     = ["TargetGroup", aws_lb_target_group.api.arn_suffix, "LoadBalancer", aws_lb.api.arn_suffix]
  search  = "SEARCH('{${var.project},%s} MetricName=\"%s\"', '%s', 60)"
  palette = { main = "#1f77b4", bad = "#d62728", fault = "#ff7f0e", good = "#2ca02c" }

  # Every widget shares the time axis, so a fault window lines up with what it caused.
  widgets = [
    ["Flow latency (seconds): the metric of fault (a)", [
      concat(["AWS/ApplicationELB", "TargetResponseTime"], local.alb, [{ stat = "p95", label = "p95", color = local.palette.main }]),
      concat(["AWS/ApplicationELB", "TargetResponseTime"], local.alb, [{ stat = "p50", label = "p50", color = local.palette.good }]),
    ]],
    ["Fault window: an experiment is injecting", [
      [{ id = "fault", expression = format(local.search, "Experiment", "ChaosFaultActive", "Maximum"), label = "", color = local.palette.fault }],
    ]],
    ["Calls to the partner API by outcome: the metric of fault (b)", [
      [{ id = "outcomes", expression = format(local.search, "Outcome", "PartnerCalls", "Sum"), label = "" }],
    ]],
    ["Partner call duration (ms)", [
      [var.project, "PartnerCallDuration", { stat = "p95", label = "p95", color = local.palette.fault }],
      [var.project, "PartnerCallDuration", { stat = "p50", label = "p50", color = local.palette.good }],
    ]],
    ["Requests and server errors per minute", [
      concat(["AWS/ApplicationELB", "RequestCount"], local.alb, [{ stat = "Sum", label = "requests", color = local.palette.main }]),
      concat(["AWS/ApplicationELB", "HTTPCode_Target_5XX_Count"], local.alb, [{ stat = "Sum", label = "5xx from the API", color = local.palette.bad }]),
      ["AWS/ApplicationELB", "HTTPCode_ELB_5XX_Count", "LoadBalancer", aws_lb.api.arn_suffix, { stat = "Sum", label = "5xx from the ALB", color = local.palette.fault }],
    ]],
    ["Healthy pods behind the load balancer", [
      concat(["AWS/ApplicationELB", "HealthyHostCount"], local.alb, [{ stat = "Minimum", label = "healthy node", color = local.palette.good }]),
    ]],
    ["Node CPU (%)", [
      ["AWS/EC2", "CPUUtilization", "InstanceId", aws_instance.node.id, { stat = "Average", label = "node", color = local.palette.main }],
    ]],
    ["Movements recorded per minute (business)", [
      [var.project, "MovementsRecorded", { stat = "Sum", label = "movements", color = local.palette.main }],
    ]],
  ]
}

# Where Fluent Bit puts the pods' logs: JSON lines, searchable by correlationId and traceId.
resource "aws_cloudwatch_log_group" "app" {
  name              = "/${var.project}/app"
  retention_in_days = 7
}

# The abort condition: the flow failing for real. The Chaos Toolkit safeguard stops the experiment
# when this fires. FILL(..., 0): a quiet minute counts as healthy, so it clears.
resource "aws_cloudwatch_metric_alarm" "flow_errors" {
  alarm_name          = "${var.project}-flow-errors"
  alarm_description   = "5xx rate of the API above chaos/slo.json abort.flowErrorRate: stop the experiment"
  comparison_operator = "GreaterThanThreshold"
  threshold           = local.slo.abort.flowErrorRate * 100
  evaluation_periods  = 3
  datapoints_to_alarm = 2

  metric_query {
    id          = "rate"
    expression  = "IF(served >= 30, 100 * (FILL(target, 0) + FILL(balancer, 0)) / served, 0)"
    return_data = true
  }
  metric_query {
    id         = "served"
    expression = "FILL(requests, 0)"
  }
  metric_query {
    id = "requests"
    metric {
      namespace   = "AWS/ApplicationELB"
      metric_name = "RequestCount"
      stat        = "Sum"
      period      = 60
      dimensions  = { TargetGroup = aws_lb_target_group.api.arn_suffix, LoadBalancer = aws_lb.api.arn_suffix }
    }
  }
  metric_query {
    id = "target"
    metric {
      namespace   = "AWS/ApplicationELB"
      metric_name = "HTTPCode_Target_5XX_Count"
      stat        = "Sum"
      period      = 60
      dimensions  = { TargetGroup = aws_lb_target_group.api.arn_suffix, LoadBalancer = aws_lb.api.arn_suffix }
    }
  }
  metric_query {
    id = "balancer"
    metric {
      namespace   = "AWS/ApplicationELB"
      metric_name = "HTTPCode_ELB_5XX_Count"
      stat        = "Sum"
      period      = 60
      dimensions  = { LoadBalancer = aws_lb.api.arn_suffix }
    }
  }
}

resource "aws_cloudwatch_dashboard" "chaos" {
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
          title  = "Abort condition: in ALARM, the experiments stop injecting"
          alarms = [aws_cloudwatch_metric_alarm.flow_errors.arn]
        }
      }],
    )
  })
}
