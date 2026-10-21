resource "aws_ecr_repository" "api" {
  name         = var.project
  force_delete = true # destroy also removes the images
}
