resource "aws_ecr_repository" "api" {
  name                 = var.project
  image_tag_mutability = "IMMUTABLE" # a tag always names the same image
  force_delete         = true        # destroy also removes the images
}
