output "api_url" {
  value = "http://${aws_instance.api.public_dns}"
}

output "ecr_repository_url" {
  value = aws_ecr_repository.api.repository_url
}

output "instance_id" {
  value = aws_instance.api.id
}

output "database_endpoint" {
  value = aws_db_instance.main.address
}

output "exports_bucket" {
  value = aws_s3_bucket.exports.bucket
}
