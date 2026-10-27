# Infrastructure with Terraform

Six AWS services, created and destroyed with one command:

| File            | Service        | What it is for                                                                 |
| --------------- | -------------- | ------------------------------------------------------------------------------ |
| `alb.tf`        | **ELB**        | The load balancer: the only public entrance, and where traffic is split        |
| `ec2.tf`        | **EC2**        | One machine per track, stable and canary, each running its image with Docker   |
| `rds.tf`        | **RDS**        | The PostgreSQL database both tracks share, reachable only from the machines    |
| `ecr.tf`        | **ECR**        | The registry the pipeline pushes the API image to; a tag can never be reused  |
| `s3.tf`         | **S3**         | The bucket where the API stores its CSV exports                                |
| `cloudwatch.tf` | **CloudWatch** | The stable-vs-canary dashboard, and the two alarms that abort a rollout        |

`providers.tf`, `variables.tf` and `outputs.tf` hold the configuration, and
`user-data.sh` is what each machine runs on its first boot: install Docker, prepare
and seed the database, start the API on port 80.

```
                         ┌─ weight 100 - w ─► EC2 stable (image A) ─┐
Internet ──:80──► ALB ───┤                                          ├──► RDS PostgreSQL
                         └─ weight w ───────► EC2 canary (image B) ─┘    S3, CloudWatch
                           x-canary: true ──► always the canary
```

Three variables drive a rollout: `stable_image_tag`, `canary_image_tag` and
`canary_weight` (0 to 100). Changing the weight only touches the load balancer
and takes seconds; changing an image replaces that track's machine.

## Deploy from the pipeline

`.github/workflows/infrastructure.yml` deploys the infrastructure **and** installs
the API on it. It runs on demand only, so nothing is created, or billed, by accident.

1. Add two repository secrets (*Settings → Secrets and variables → Actions*):
   `AWS_ACCESS_KEY_ID` and `AWS_SECRET_ACCESS_KEY`.
2. *Actions → Infrastructure → Run workflow*, choose **apply**.

It then:

1. creates the S3 bucket for the Terraform state, if it does not exist;
2. creates the ECR repository, builds the API image and pushes it, tagged with the commit;
3. applies everything else, with that image on both tracks and no traffic to the canary;
4. waits until each track answers `/health/ready` and writes the API URL in the run summary.

From there, the `Canary` workflow moves a new version through the stages: see
[Canary deployment](../README.md#canary-deployment).

## Destroy

Run the same workflow with **destroy**. Or, from this folder:

```bash
terraform destroy
```

Nothing is left behind except the small state bucket; remove it last with
`aws s3 rb s3://inventory-api-tfstate-<account-id> --force`.
