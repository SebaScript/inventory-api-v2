data "aws_ssm_parameter" "al2023" {
  name = "/aws/service/ami-amazon-linux-latest/al2023-ami-kernel-default-x86_64"
}

# One virtual machine running the API container.
resource "aws_instance" "api" {
  ami                    = data.aws_ssm_parameter.al2023.value
  instance_type          = "t3.micro"
  subnet_id              = data.aws_subnets.default.ids[0]
  vpc_security_group_ids = [aws_security_group.api.id]
  iam_instance_profile   = aws_iam_instance_profile.api.name

  # A new image means a new machine: the script below only runs on first boot.
  user_data_replace_on_change = true
  user_data = templatefile("${path.module}/user-data.sh", {
    region       = var.region
    image        = "${aws_ecr_repository.api.repository_url}:${var.image_tag}"
    database_url = "postgres://${aws_db_instance.main.username}:${random_password.db.result}@${aws_db_instance.main.endpoint}/${aws_db_instance.main.db_name}"
    bucket       = aws_s3_bucket.exports.bucket
  })

  # Hop limit 2: the container is one network hop away and needs the role's credentials.
  metadata_options {
    http_tokens                 = "required"
    http_put_response_hop_limit = 2
  }

  tags = {
    Name = var.project
  }
}
