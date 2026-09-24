# Observability — Prometheus and Grafana for the inventory API

Each API has its own, independent observability stack. This is the inventory
one.

## Where things run

| Piece                             | Where                                                                  | Defined in                                |
| --------------------------------- | ---------------------------------------------------------------------- | ----------------------------------------- |
| **Prometheus** (agent mode)       | **In the EKS cluster**                                                 | `deploy/prometheus.example.yaml`          |
| Metrics storage, dashboard, alert | Grafana Cloud, this API's own stack                                    | `dashboards/inventory.grafana-cloud.json` |
| Traces                            | OpenTelemetry collector in the cluster → X-Ray and Grafana Cloud Tempo | `deploy/otel-collector.yaml`              |
| Logs                              | CloudWatch, read from Grafana through an IAM role                      | —                                         |

## The in-cluster Prometheus

It runs in **agent mode**: it scrapes and forwards with `remote_write`, and
keeps no database of its own. Everything is queried in Grafana Cloud.

It scrapes two things:

1. **Every API pod, directly.** Pods are found through the Kubernetes API, so
   the target list follows the autoscaler. This is where every number on the
   dashboard comes from.
2. **`/metrics/inventory` on the orchestrator**, the path the other cloud reads.
   Only as a health check: `up` says whether that path works, and every sample
   it returns is dropped so nothing is counted twice.

Why not only the orchestrator path, as before: it goes through the gateway and
the load balancer, so each scrape lands on whichever pod answers. The counters
of different pods end up in one series, and `rate()` reads every jump between
them as a reset. After a load test that showed 271 requests a second with no
traffic at all. One series per pod has no such problem.

Every series it sends carries `collector="eks"`.

### Deploying it

```bash
cp deploy/prometheus.example.yaml deploy/prometheus.yaml   # fill in the placeholders
kubectl create secret generic grafana-cloud-prometheus -n inventory \
  --from-file=token=observability/grafana-cloud-token
kubectl apply -f deploy/prometheus.yaml
```

`deploy/prometheus.yaml` is git-ignored: it names the orchestrator's address and
this API's Grafana Cloud instance. The token file is git-ignored too, and must
be plain UTF-8: PowerShell's `echo ... >` writes UTF-16, which Grafana Cloud
rejects with a 401 that never says why.

### Looking at what it scrapes

Agent mode has no query page, but the target list works:

```bash
kubectl port-forward -n inventory svc/prometheus 9090:9090
# then open http://localhost:9090/targets
```

Three targets, all UP: two API pods (more under load) and the orchestrator.

## The local stack

`docker-compose.yml` still raises a Prometheus and a Grafana on this machine,
for looking only. It sends nothing to Grafana Cloud: two Prometheus instances
writing the same metrics would double every rate on the dashboard.

## The dashboard

`dashboards/inventory.grafana-cloud.json`, twelve panels:

| Panel                         | Source                                                                 |
| ----------------------------- | ---------------------------------------------------------------------- |
| **Cross-cloud calls**         | `sum by (outcome) (rate(partner_lookups_total[5m]))`                   |
| Orchestrator path             | `up{job="inventory-api"}`                                              |
| **Pods serving**              | `count(up{job="inventory-api-pods"} == 1)` — watch the autoscaler here |
| Request rate by endpoint      | `sum by (route) (rate(http_requests_total[5m]))`                       |
| Error rate by endpoint        | 4xx and 5xx over the total, by route                                   |
| p50 / p95 latency by endpoint | `histogram_quantile` over `http_request_duration_seconds_bucket`       |
| By status code                | `sum by (status) (...)`                                                |
| Cache hit ratio               | hits over hits plus misses, summed across pods                         |
| Process memory                | one line per pod                                                       |
| Recent traces                 | Tempo                                                                  |
| Logs for one correlation id   | CloudWatch Logs                                                        |

The `route` label is the route pattern, never the resolved URL, so item ids
cannot multiply the time series.
