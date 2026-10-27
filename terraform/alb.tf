data "aws_vpc" "default" {
  default = true
}

# Firewall: the load balancer is the only public entrance.
resource "aws_security_group" "alb" {
  name = "${var.project}-alb"

  ingress {
    from_port   = 80
    to_port     = 80
    protocol    = "tcp"
    cidr_blocks = ["0.0.0.0/0"]
  }

  egress {
    from_port   = 0
    to_port     = 0
    protocol    = "-1"
    cidr_blocks = ["0.0.0.0/0"]
  }
}

resource "aws_lb" "api" {
  name               = var.project
  load_balancer_type = "application"
  security_groups    = [aws_security_group.alb.id]
  subnets            = data.aws_subnets.default.ids
}

# One target group per track: the split is a weight between the two.
resource "aws_lb_target_group" "api" {
  for_each = local.tracks

  name                 = "${var.project}-${each.key}"
  port                 = 80
  protocol             = "HTTP"
  vpc_id               = data.aws_vpc.default.id
  deregistration_delay = 10 # a weight change takes seconds, not the default 5 minutes

  health_check {
    path                = "/health/ready"
    interval            = 10
    healthy_threshold   = 2
    unhealthy_threshold = 2
  }
}

resource "aws_lb_target_group_attachment" "api" {
  for_each = local.tracks

  target_group_arn = aws_lb_target_group.api[each.key].arn
  target_id        = aws_instance.api[each.key].id
}

# The split: each public request goes to one track or the other, by weight.
resource "aws_lb_listener" "http" {
  load_balancer_arn = aws_lb.api.arn
  port              = 80
  protocol          = "HTTP"

  default_action {
    type = "forward"

    forward {
      target_group {
        arn    = aws_lb_target_group.api["stable"].arn
        weight = 100 - var.canary_weight
      }

      target_group {
        arn    = aws_lb_target_group.api["canary"].arn
        weight = var.canary_weight
      }
    }
  }
}

# Stage 0: with this header a request reaches the canary, even at 0%.
resource "aws_lb_listener_rule" "canary_header" {
  listener_arn = aws_lb_listener.http.arn
  priority     = 1

  action {
    type             = "forward"
    target_group_arn = aws_lb_target_group.api["canary"].arn
  }

  condition {
    http_header {
      http_header_name = "x-canary"
      values           = ["true"]
    }
  }
}
