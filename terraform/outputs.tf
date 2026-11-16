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
  description = "The Kubernetes node: kubectl runs on it through SSM, and the game day reads its IMDS"
  value       = aws_instance.node.id
}

output "bucket" {
  description = "The data bucket the security game day attacks"
  value       = aws_s3_bucket.exports.bucket
}

output "node_role" {
  description = "The role whose stolen credentials exp 1 uses; exp1-contain revokes its sessions"
  value       = aws_iam_role.api.name
}

output "security_dashboard_url" {
  value = "https://${var.region}.console.aws.amazon.com/cloudwatch/home?region=${var.region}#dashboards/dashboard/${aws_cloudwatch_dashboard.security.dashboard_name}"
}

output "partner_host" {
  description = "The host fault (a) slows down, taken from the partner's URL. Empty without a partner"
  value       = var.partner_url == "" ? "" : regex("^https?://([^/:]+)", var.partner_url)[0]
  sensitive   = true
}

output "fault_token" {
  description = "What a request needs to trip the fault switch"
  value       = random_password.fault_token.result
  sensitive   = true
}
