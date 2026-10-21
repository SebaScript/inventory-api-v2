# Infrastructure with Terraform

Everything the API needs on AWS, created and destroyed with one command: the
network rules, a PostgreSQL database, the container registry, object storage,
logs, a load balancer and the API itself running on ECS Fargate.

```
Internet ──► Application Load Balancer ──► ECS Fargate (the API) ──┬──► RDS PostgreSQL
                                                 ▲                  ├──► S3 (exports)
                                       image from ECR               └──► CloudWatch Logs
                              DATABASE_URL from SSM Parameter Store
```

## What each file creates

| File           | AWS service           | What it is for                                                          |
| -------------- | --------------------- | ----------------------------------------------------------------------- |
| `providers.tf` | —                     | Terraform and provider versions, and the state kept in S3               |
| `variables.tf` | —                     | Region, name prefix and the image tag to deploy                         |
| `network.tf`   | VPC, security groups  | The default VPC; only the load balancer reaches the API, only the API reaches the database |
| `ecr.tf`       | ECR                   | The registry the API image is pushed to                                 |
| `rds.tf`       | RDS                   | PostgreSQL 18, `db.t4g.micro`, private, with a generated password       |
| `ssm.tf`       | SSM Parameter Store   | The database URL, encrypted, injected into the container at start       |
| `s3.tf`        | S3                    | The bucket for CSV exports and flow messages                            |
| `iam.tf`       | IAM                   | One role for ECS (image, logs, secret) and one for the API (its bucket) |
| `logs.tf`      | CloudWatch Logs       | The API logs, kept 7 days                                               |
| `alb.tf`       | Elastic Load Balancing | The public URL, with health checks on `/health/ready`                  |
| `ecs.tf`       | ECS Fargate           | The cluster, the task definition and the service running the API        |
| `outputs.tf`   | —                     | The API URL and the names the pipeline needs                            |

## Deploy from the pipeline

`.github/workflows/infrastructure.yml` deploys the infrastructure **and** installs
the API on it. It runs on demand only, so nothing is created, or billed, by accident.

1. Add two repository secrets (*Settings → Secrets and variables → Actions*):
   `AWS_ACCESS_KEY_ID` and `AWS_SECRET_ACCESS_KEY`.
2. *Actions → Infrastructure → Run workflow*, choose **apply**.

It then:

1. creates the S3 bucket for the Terraform state, if it does not exist;
2. creates the ECR repository, builds the API image and pushes it, tagged with the commit;
3. applies everything else; the apply waits until the API is running and healthy;
4. seeds the database with a one-off task;
5. calls `/health/ready` and writes the API URL in the run summary.

A first run takes about 10 minutes, most of it creating the database.

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
terraform output api_url
```

The registry goes first because the service cannot start without an image in it.

## Cost

About 0.07 USD per hour while it exists: Fargate, the load balancer and the
database. Destroy it when the demo is over.
