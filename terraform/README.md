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

## Run it from your machine

Requires Terraform 1.11+, Docker and the AWS CLI with credentials.

```bash
cd terraform
BUCKET="inventory-api-tfstate-$(aws sts get-caller-identity --query Account --output text)"
aws s3 mb "s3://$BUCKET"                      # first time only
terraform init -backend-config="bucket=$BUCKET"

terraform apply -target=aws_ecr_repository.api
REPO=$(terraform output -raw ecr_repository_url)
aws ecr get-login-password | docker login --username AWS --password-stdin "${REPO%%/*}"
docker build -t "$REPO:v1" .. && docker push "$REPO:v1"

terraform apply -var="image_tag=v1"
terraform output api_url                      # ready a couple of minutes later
```

The registry goes first because the machine pulls the image on its first boot.
If the API never answers, *EC2 → the instance → Actions → Monitor and
troubleshoot → Get system log* shows what the boot script printed.

## Cost

About 0.03 USD per hour while it exists. Destroy it when the demo is over.
