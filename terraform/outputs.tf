output "api_url" {
  value = "http://${aws_lb.api.dns_name}"
}

output "ecr_repository_url" {
  value = aws_ecr_repository.api.repository_url
}

output "dashboard_url" {
  value = "https://${var.region}.console.aws.amazon.com/cloudwatch/home?region=${var.region}#dashboards/dashboard/${aws_cloudwatch_dashboard.chaos.dashboard_name}"
}

output "image_tag" {
  value = var.image_tag
}

output "node_id" {
  description = "The Kubernetes node: kubectl runs on it through SSM"
  value       = aws_instance.node.id
}

output "fis_template_id" {
  description = "Fault (a). Empty until the partner's URL is known"
  value       = try(aws_fis_experiment_template.partner_latency[0].id, "")
}

output "fault_token" {
  description = "What a request needs to trip the fault switch"
  value       = random_password.fault_token.result
  sensitive   = true
}
