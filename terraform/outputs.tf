output "api_url" {
  value = "http://${aws_instance.api.public_dns}"
}

output "ecr_repository_url" {
  value = aws_ecr_repository.api.repository_url
}
