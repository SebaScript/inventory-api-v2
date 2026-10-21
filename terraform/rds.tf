resource "random_password" "db" {
  length  = 24
  special = false # it goes inside a URL
}

# The default VPC's subnets in two zones: RDS requires at least two.
data "aws_subnets" "default" {
  filter {
    name   = "default-for-az"
    values = ["true"]
  }

  filter {
    name   = "availability-zone"
    values = ["${var.region}a", "${var.region}b"]
  }
}

resource "aws_db_subnet_group" "main" {
  name       = var.project
  subnet_ids = data.aws_subnets.default.ids
}

# Firewall: only the API machine reaches the database.
resource "aws_security_group" "db" {
  name = "${var.project}-db"

  ingress {
    from_port       = 5432
    to_port         = 5432
    protocol        = "tcp"
    security_groups = [aws_security_group.api.id]
  }
}

resource "aws_db_instance" "main" {
  identifier             = var.project
  engine                 = "postgres"
  engine_version         = "18"
  instance_class         = "db.t4g.micro"
  allocated_storage      = 20
  storage_type           = "gp3"
  storage_encrypted      = true
  db_name                = "inventory"
  username               = "inventory"
  password               = random_password.db.result
  db_subnet_group_name   = aws_db_subnet_group.main.name
  vpc_security_group_ids = [aws_security_group.db.id]

  # A disposable demo database: no backups, no snapshot on destroy.
  backup_retention_period = 0
  skip_final_snapshot     = true
  apply_immediately       = true
}
