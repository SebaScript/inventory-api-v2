variable "region" {
  type    = string
  default = "us-east-1"
}

variable "project" {
  type    = string
  default = "inventory-api"
}

variable "image_tag" {
  description = "Tag of the API image in ECR. The pipeline sets it to the commit SHA."
  type        = string
  default     = "latest"
}
