variable "region" {
  type    = string
  default = "us-east-1"
}

variable "project" {
  type    = string
  default = "inventory-api"
}

variable "image_tag" {
  description = "Image the cluster runs. The pipeline sets it to a commit SHA."
  type        = string
  default     = "latest"
}

# The partner API in the other cloud. Empty: the flow runs without it and the latency experiment is not created.
variable "partner_url" {
  description = "Base URL of the partner API, which serves /interop/{partner_key}/random"
  type        = string
  default     = ""
  sensitive   = true # kept out of the public pipeline logs
}

variable "partner_key" {
  type    = string
  default = "orders"
}

variable "partner_api_key" {
  type      = string
  default   = ""
  sensitive = true
}

# Traces to Grafana Cloud Tempo, shared with the partner. Empty: tracing is off.
variable "otlp_endpoint" {
  type    = string
  default = ""
}

variable "otlp_headers" {
  description = "Authorization=Basic <base64 of instance id:token>, with a token that can only write traces"
  type        = string
  default     = ""
  sensitive   = true
}
