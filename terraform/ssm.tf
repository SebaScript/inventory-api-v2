# Encrypted, and read by ECS at start: the password never appears in the task definition.
resource "aws_ssm_parameter" "database_url" {
  name  = "/${var.project}/database-url"
  type  = "SecureString"
  value = "postgres://${aws_db_instance.main.username}:${random_password.db.result}@${aws_db_instance.main.endpoint}/${aws_db_instance.main.db_name}"
}
