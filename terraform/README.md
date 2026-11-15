# Infrastructure with Terraform

Everything the API needs on AWS, created and destroyed with one command:

| File            | Service        | What it is for                                                                  |
| --------------- | -------------- | ------------------------------------------------------------------------------- |
| `alb.tf`        | **ELB**        | The load balancer: the only public entrance, forwarding to the node's NodePort  |
| `ec2.tf`        | **EC2**        | One node running k3s, its IAM role, and the manifests it applies on first boot  |
| `k8s/`          | **Kubernetes** | The Deployment (2 replicas, probes, requests and limits), Service and Fluent Bit |
| `rds.tf`        | **RDS**        | The PostgreSQL database, reachable only from the node                           |
| `ecr.tf`        | **ECR**        | The registry the pipeline pushes the API image to; a tag can never be reused   |
| `s3.tf`         | **S3**         | The bucket where the API stores its exports and flow objects                    |
| `cloudwatch.tf` | **CloudWatch** | The pods' log group, the chaos dashboard and the alarm that aborts experiments  |

`providers.tf`, `variables.tf` and `outputs.tf` hold the configuration, and
`user-data.sh` is what the node runs on its first boot: install k3s, pull the image
with the node's role, and apply `k8s/`.

```
Internet ──:80──► ALB ──:30080──► k3s node ──► 2 × inventory-api ──► RDS PostgreSQL
                                                     │                S3, CloudWatch
                                                     └──► partner API (Google Cloud)
```

`image_tag` picks the image; changing it replaces the node, so every deploy starts
from a clean machine. `partner_url`, `partner_api_key`, `otlp_endpoint` and
`otlp_headers` come from repository secrets; left empty, the partner lookup and the
traces are off.

## Deploy from the pipeline

`.github/workflows/infrastructure.yml` deploys the infrastructure **and** installs
the API on it. It runs on demand only, so nothing is created, or billed, by accident.

1. Add the repository secrets (*Settings → Secrets and variables → Actions*):
   `AWS_ACCESS_KEY_ID` and `AWS_SECRET_ACCESS_KEY`, and optionally `PARTNER_URL`,
   `PARTNER_API_KEY`, `OTLP_ENDPOINT` and `OTLP_HEADERS`.
2. *Actions → Infrastructure → Run workflow*, choose **apply**.

It then:

1. creates the S3 bucket for the Terraform state, if it does not exist;
2. creates the ECR repository, builds the API image and pushes it, tagged with the commit;
3. applies everything else with that image;
4. waits until the API answers `/health/ready` and writes the URLs in the run summary;
5. runs chaos experiment (a) as a quality gate, unless the run unticks `chaos_gate`.

## Destroy

Run the same workflow with **destroy**. Or, from this folder:

```bash
terraform destroy
```

Nothing is left behind except the small state bucket; remove it last with
`aws s3 rb s3://inventory-api-tfstate-<account-id> --force`.
