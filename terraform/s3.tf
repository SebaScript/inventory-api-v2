data "aws_caller_identity" "current" {}

# Private and encrypted by default, like every new bucket.
resource "aws_s3_bucket" "exports" {
  bucket        = "${var.project}-exports-${data.aws_caller_identity.current.account_id}"
  force_destroy = true # destroy also empties it
}
