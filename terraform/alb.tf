resource "aws_lb" "api" {
  name               = var.project
  load_balancer_type = "application"
  subnets            = data.aws_subnets.default.ids
  security_groups    = [aws_security_group.alb.id]
}

resource "aws_lb_target_group" "api" {
  name        = var.project
  port        = 3000
  protocol    = "HTTP"
  target_type = "ip"
  vpc_id      = data.aws_vpc.default.id

  # The API drains in 5 s; the 300 s default only slows deploys and destroy.
  deregistration_delay = 15

  health_check {
    path              = "/health/ready"
    interval          = 10
    healthy_threshold = 2
  }
}

resource "aws_lb_listener" "http" {
  load_balancer_arn = aws_lb.api.arn
  port              = 80

  default_action {
    type             = "forward"
    target_group_arn = aws_lb_target_group.api.arn
  }
}
