output "api_url" {
  value = "http://${aws_lb.api.dns_name}"
}

output "ecr_repository_url" {
  value = aws_ecr_repository.api.repository_url
}

output "dashboard_url" {
  value = "https://${var.region}.console.aws.amazon.com/cloudwatch/home?region=${var.region}#dashboards/dashboard/${aws_cloudwatch_dashboard.canary.dashboard_name}"
}

# What the canary pipeline reads back: each apply must repeat the images and weight already running.
output "stable_image_tag" {
  value = var.stable_image_tag
}

output "canary_image_tag" {
  value = var.canary_image_tag
}

output "canary_weight" {
  value = var.canary_weight
}

output "canary_gate" {
  value = {
    load_balancer = aws_lb.api.arn_suffix
    target_groups = { for track, group in aws_lb_target_group.api : track => { arn = group.arn, suffix = group.arn_suffix } }
    alarms        = [aws_cloudwatch_metric_alarm.canary_errors.alarm_name, aws_cloudwatch_metric_alarm.canary_latency.alarm_name]
  }
}
