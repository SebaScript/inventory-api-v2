data "aws_ami" "al2023" {
  owners      = ["amazon"]
  most_recent = true

  filter {
    name   = "name"
    values = ["al2023-ami-2023.*-x86_64"]
  }
}

# Firewall: port 80, and only from the load balancer.
resource "aws_security_group" "api" {
  name = "${var.project}-api"

  ingress {
    from_port       = 80
    to_port         = 80
    protocol        = "tcp"
    security_groups = [aws_security_group.alb.id]
  }

  egress {
    from_port   = 0
    to_port     = 0
    protocol    = "-1"
    cidr_blocks = ["0.0.0.0/0"]
  }
}

# Permissions: pull the image from ECR, use its own S3 bucket and publish metrics, with no AWS keys on the machine.
resource "aws_iam_role" "api" {
  name = "${var.project}-ec2"
  assume_role_policy = jsonencode({
    Version = "2012-10-17"
    Statement = [{
      Effect    = "Allow"
      Action    = "sts:AssumeRole"
      Principal = { Service = "ec2.amazonaws.com" }
    }]
  })
}

resource "aws_iam_role_policy_attachment" "ecr" {
  role       = aws_iam_role.api.name
  policy_arn = "arn:aws:iam::aws:policy/AmazonEC2ContainerRegistryReadOnly"
}

resource "aws_iam_role_policy" "s3" {
  role = aws_iam_role.api.id
  policy = jsonencode({
    Version = "2012-10-17"
    Statement = [{
      Effect   = "Allow"
      Action   = ["s3:PutObject", "s3:GetObject"]
      Resource = "${aws_s3_bucket.exports.arn}/*"
    }]
  })
}

# Memory and the business metric, which only the app can measure. Only into its own namespace.
resource "aws_iam_role_policy" "metrics" {
  role = aws_iam_role.api.id
  policy = jsonencode({
    Version = "2012-10-17"
    Statement = [{
      Effect    = "Allow"
      Action    = "cloudwatch:PutMetricData"
      Resource  = "*"
      Condition = { StringEquals = { "cloudwatch:namespace" = var.project } }
    }]
  })
}

resource "aws_iam_instance_profile" "api" {
  name = var.project
  role = aws_iam_role.api.name
}

# One machine per track: on first boot it runs user-data.sh, which installs Docker and starts the API.
resource "aws_instance" "api" {
  for_each = local.tracks

  ami                    = data.aws_ami.al2023.id
  instance_type          = "t3.micro"
  availability_zone      = "${var.region}a"
  vpc_security_group_ids = [aws_security_group.api.id]
  iam_instance_profile   = aws_iam_instance_profile.api.name
  monitoring             = true # CPU every minute, not every five: a stage bakes for minutes

  # A new image means a new machine: the script only runs on first boot.
  user_data_replace_on_change = true
  user_data = templatefile("${path.module}/user-data.sh", {
    region       = var.region
    image        = "${aws_ecr_repository.api.repository_url}:${each.value}"
    track        = each.key
    database_url = "postgres://${aws_db_instance.main.username}:${random_password.db.result}@${aws_db_instance.main.endpoint}/${aws_db_instance.main.db_name}"
    bucket       = aws_s3_bucket.exports.bucket
    namespace    = var.project
  })

  # Hop limit 2: the container is one network hop away and needs the role's credentials.
  metadata_options {
    http_tokens                 = "required"
    http_put_response_hop_limit = 2
  }

  tags = {
    Name = "${var.project}-${each.key}"
  }
}
