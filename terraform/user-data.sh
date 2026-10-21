#!/bin/bash
# Runs once, on the first boot: installs Docker, seeds the database and starts the API.
set -euo pipefail

dnf install -y docker
systemctl enable --now docker

aws ecr get-login-password --region ${region} | docker login --username AWS --password-stdin ${split("/", image)[0]}

DATABASE_URL=$(aws ssm get-parameter --region ${region} --name ${parameter} --with-decryption --query Parameter.Value --output text)
ENV="-e NODE_ENV=production -e DB_SSL=true -e S3_BUCKET=${bucket} -e AWS_REGION=${region} -e DATABASE_URL=$DATABASE_URL"

docker run --rm $ENV ${image} node dist/database/seed.cli.js

docker run -d --name api --restart always -p 80:3000 \
  --log-driver awslogs --log-opt awslogs-group=${log_group} --log-opt awslogs-region=${region} \
  $ENV ${image}
