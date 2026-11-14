data "aws_ami" "al2023" {
  owners      = ["amazon"]
  most_recent = true

  filter {
    name   = "name"
    values = ["al2023-ami-2023.*-x86_64"]
  }
}

locals {
  node_port = 30080
}

# Firewall: the Kubernetes NodePort, and only from the load balancer.
resource "aws_security_group" "api" {
  name = "${var.project}-api"

  ingress {
    from_port       = local.node_port
    to_port         = local.node_port
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

# The node's identity, which its pods use too: pull from ECR, its own bucket, its metrics and logs.
# No AWS keys anywhere on the machine.
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

# Systems Manager: how FIS injects the network latency, and how the pipeline runs kubectl on the node.
resource "aws_iam_role_policy_attachment" "ssm" {
  role       = aws_iam_role.api.name
  policy_arn = "arn:aws:iam::aws:policy/AmazonSSMManagedInstanceCore"
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

# Memory, the business metric and the calls to the other cloud. Only into its own namespace.
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

# The pods' logs, shipped by Fluent Bit. Only into their own log group.
resource "aws_iam_role_policy" "logs" {
  role = aws_iam_role.api.id
  policy = jsonencode({
    Version = "2012-10-17"
    Statement = [{
      Effect   = "Allow"
      Action   = ["logs:CreateLogStream", "logs:PutLogEvents", "logs:DescribeLogStreams"]
      Resource = "${aws_cloudwatch_log_group.app.arn}:*"
    }]
  })
}

resource "aws_iam_instance_profile" "api" {
  name = var.project
  role = aws_iam_role.api.name
}

resource "random_password" "fault_token" {
  length  = 32
  special = false
}

locals {
  # Everything the cluster runs, rendered here and applied by k3s on first boot.
  manifests = templatefile("${path.module}/k8s/inventory-api.yaml", {
    image         = "${aws_ecr_repository.api.repository_url}:${var.image_tag}"
    node_port     = local.node_port
    region        = var.region
    namespace     = var.project
    bucket        = aws_s3_bucket.exports.bucket
    database_url  = "postgres://${aws_db_instance.main.username}:${random_password.db.result}@${aws_db_instance.main.endpoint}/${aws_db_instance.main.db_name}"
    partner_url   = var.partner_url
    partner_key   = var.partner_key
    partner_token = var.partner_api_key
    fault_token   = random_password.fault_token.result
    otlp_endpoint = var.otlp_endpoint
    otlp_headers  = var.otlp_headers
  })
  log_shipper = templatefile("${path.module}/k8s/fluent-bit.yaml", {
    region    = var.region
    log_group = aws_cloudwatch_log_group.app.name
  })
}

# One Kubernetes node: k3s on a single machine, behind the load balancer.
resource "aws_instance" "node" {
  ami                    = data.aws_ami.al2023.id
  instance_type          = "t3.medium"
  availability_zone      = "${var.region}a"
  vpc_security_group_ids = [aws_security_group.api.id]
  iam_instance_profile   = aws_iam_instance_profile.api.name
  monitoring             = true # CPU every minute, not every five: an experiment lasts minutes

  # A new image means a new node: the script only runs on first boot.
  user_data_replace_on_change = true
  user_data = templatefile("${path.module}/user-data.sh", {
    region      = var.region
    image       = "${aws_ecr_repository.api.repository_url}:${var.image_tag}"
    manifests   = local.manifests
    log_shipper = local.log_shipper
  })

  # Hop limit 2: the pods are one network hop away and need the role's credentials.
  metadata_options {
    http_tokens                 = "required"
    http_put_response_hop_limit = 2
  }

  tags = {
    Name = "${var.project}-node"
  }
}
