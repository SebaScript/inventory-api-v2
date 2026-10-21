# Infrastructure with Terraform

Four AWS services, created and destroyed with one command:

| File     | Service | What it is for                                                         |
| -------- | ------- | ---------------------------------------------------------------------- |
| `ec2.tf` | **EC2** | One machine that runs the API with Docker, with its firewall and role  |
| `rds.tf` | **RDS** | The PostgreSQL database, private, reachable only from the machine      |
| `ecr.tf` | **ECR** | The registry the pipeline pushes the API image to                      |
| `s3.tf`  | **S3**  | The bucket where the API stores its CSV exports                        |

`providers.tf`, `variables.tf` and `outputs.tf` hold the configuration, and
`user-data.sh` is what the machine runs on its first boot: install Docker, seed
the database, start the API on port 80.

```
Internet ──:80──► EC2 (Docker: the API) ──┬──► RDS PostgreSQL
                     ▲                    └──► S3
                image from ECR
```

## Deploy from the pipeline

`.github/workflows/infrastructure.yml` deploys the infrastructure **and** installs
the API on it. It runs on demand only, so nothing is created, or billed, by accident.

1. Add two repository secrets (*Settings → Secrets and variables → Actions*):
   `AWS_ACCESS_KEY_ID` and `AWS_SECRET_ACCESS_KEY`.
2. *Actions → Infrastructure → Run workflow*, choose **apply**.

It then:

1. creates the S3 bucket for the Terraform state, if it does not exist;
2. creates the ECR repository, builds the API image and pushes it, tagged with the commit;
3. applies everything else; the machine boots, installs Docker, seeds the database and starts the API;
4. waits for `/health/ready` and writes the API URL in the run summary.

A new commit means a new image, and a new image means a new machine.

## Destroy

Run the same workflow with **destroy**. Or, from this folder:

```bash
terraform destroy
```

Nothing is left behind except the small state bucket; remove it last with
`aws s3 rb s3://inventory-api-tfstate-<account-id> --force`.
