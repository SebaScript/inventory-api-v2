#!/bin/bash
set -euo pipefail

# Kubernetes: a single-node k3s, version pinned. No ingress or load balancer of its own: the ALB is the door.
curl -sfL https://get.k3s.io | INSTALL_K3S_VERSION="v1.36.6+k3s1" sh -s - \
  --disable traefik --disable servicelb --write-kubeconfig-mode 600
until k3s kubectl get nodes 2> /dev/null | grep -q ' Ready'; do sleep 3; done

# k3s holds no registry credentials: the node pulls the image with its own role, and the pods never pull.
TOKEN=$(aws ecr get-login-password --region ${region})
k3s ctr --namespace k8s.io images pull --user "AWS:$TOKEN" ${image}

mkdir -p /opt/inventory
cat > /opt/inventory/inventory-api.yaml << 'MANIFESTS'
${manifests}
MANIFESTS
cat > /opt/inventory/fluent-bit.yaml << 'MANIFESTS'
${log_shipper}
MANIFESTS

k3s kubectl apply -f /opt/inventory/inventory-api.yaml -f /opt/inventory/fluent-bit.yaml
# The first file holds the database password: once applied, it lives only in the cluster.
rm -f /opt/inventory/inventory-api.yaml
