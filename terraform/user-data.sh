set -euo pipefail

dnf install -y docker
systemctl enable --now docker

aws ecr get-login-password --region ${region} | docker login --username AWS --password-stdin ${split("/", image)[0]}

ENV="-e NODE_ENV=production -e DB_SSL=true -e S3_BUCKET=${bucket} -e AWS_REGION=${region} -e DATABASE_URL=${database_url}"

docker run --rm $ENV ${image} node dist/database/seed.cli.js
docker run -d --name api --restart always -p 80:3000 $ENV ${image}
