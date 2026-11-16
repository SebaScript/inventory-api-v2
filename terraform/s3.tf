data "aws_caller_identity" "current" {}

# Private and encrypted by default, like every new bucket.
resource "aws_s3_bucket" "exports" {
  bucket        = "${var.project}-exports-${data.aws_caller_identity.current.account_id}"
  force_destroy = true # destroy also empties it

  # Object Lock can only be enabled at creation; the WORM control of exp 4 (security.tf)
  # needs it. Turning it on replaces this disposable bucket; the data is synthetic.
  object_lock_enabled = true
}
