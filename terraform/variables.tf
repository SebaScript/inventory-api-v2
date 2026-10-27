variable "region" {
  type    = string
  default = "us-east-1"
}

variable "project" {
  type    = string
  default = "inventory-api"
}

variable "stable_image_tag" {
  description = "Image the stable track runs. The pipeline sets it to a commit SHA."
  type        = string
  default     = "latest"
}

variable "canary_image_tag" {
  description = "Image the canary track runs. The same as stable when no canary is in progress."
  type        = string
  default     = "latest"
}

variable "canary_weight" {
  description = "Percentage of public traffic the canary receives."
  type        = number
  default     = 0

  validation {
    condition     = var.canary_weight >= 0 && var.canary_weight <= 100
    error_message = "canary_weight is a percentage: 0 to 100."
  }
}

locals {
  # One machine and one target group per track, each with its own image.
  tracks = {
    stable = var.stable_image_tag
    canary = var.canary_image_tag
  }
}
