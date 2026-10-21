output "ecr_repository_url" {
  value = aws_ecr_repository.api.repository_url
}

output "database_endpoint" {
  value = aws_db_instance.main.address
}

output "exports_bucket" {
  value = aws_s3_bucket.exports.bucket
}
