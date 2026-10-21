resource "aws_cloudwatch_log_group" "api" {
  name              = "/${var.project}"
  retention_in_days = 7
}
