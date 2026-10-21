output "api_url" {
  value = "http://${aws_lb.api.dns_name}"
}

output "ecr_repository_url" {
  value = aws_ecr_repository.api.repository_url
}

output "cluster" {
  value = aws_ecs_cluster.main.name
}

output "service" {
  value = aws_ecs_service.api.name
}

output "database_endpoint" {
  value = aws_db_instance.main.address
}

output "exports_bucket" {
  value = aws_s3_bucket.exports.bucket
}
