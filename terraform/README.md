# Infrastructure with Terraform

Everything the API needs on AWS, created and destroyed with one command: a
PostgreSQL database, the container registry, object storage, logs, and one
virtual machine that runs the API with Docker.

```
Internet ──:80──► EC2 (Docker: the API) ──┬──► RDS PostgreSQL
                     ▲                    ├──► S3 (exports)
          image from ECR                  └──► CloudWatch Logs
          DATABASE_URL from SSM Parameter Store
```

## What each file creates

| File           | AWS service          | What it is for                                                         |
| -------------- | -------------------- | ---------------------------------------------------------------------- |
| `providers.tf` | —                    | Terraform and provider versions, and the state kept in S3              |
| `variables.tf` | —                    | Region, name prefix and the image tag to deploy                        |
| `network.tf`   | VPC, security groups | The default VPC; port 80 open to the API, only the API reaches the database |
| `ecr.tf`       | ECR                  | The registry the API image is pushed to                                |
| `rds.tf`       | RDS                  | PostgreSQL 18, `db.t4g.micro`, private, encrypted, generated password  |
| `ssm.tf`       | SSM Parameter Store  | The database URL, encrypted                                            |
| `s3.tf`        | S3                   | The bucket for CSV exports and flow messages                           |
| `iam.tf`       | IAM                  | The machine's role: pull the image, read the URL, its bucket, its logs |
| `logs.tf`      | CloudWatch Logs      | The API logs, kept 7 days                                              |
| `ec2.tf`       | EC2                  | A `t3.micro` with Amazon Linux 2023 that runs the API                  |
| `user-data.sh` | —                    | What the machine does on first boot: install Docker, seed, start the API |
| `outputs.tf`   | —                    | The API URL and the names the pipeline needs                           |

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

A new commit means a new image, and a new image means a new machine: Terraform
replaces it, so every deploy starts clean.

## Destroy

Run the same workflow with **destroy**. Or, from this folder:

```bash
terraform destroy
```

The bucket and the registry are emptied on the way out, and the database is
dropped without a final snapshot, so nothing is left behind. Only the small state
bucket stays; remove it last with `aws s3 rb s3://inventory-api-tfstate-<account-id> --force`.

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
terraform output api_url                      # ready a few minutes later
```

The registry goes first because the machine pulls the image on its first boot.

To look inside the machine without SSH keys: *EC2 → the instance → Connect →
Session Manager*, then `sudo docker logs api`.

## Cost

About 0.03 USD per hour while it exists: the machine, the database and a public
IPv4 address. Destroy it when the demo is over.
