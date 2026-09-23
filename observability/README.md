# Observability — Prometheus and Grafana for the inventory API

One Prometheus and one Grafana per API. This is the inventory one; the other
team runs its own, pointed at the same orchestrator on a different path.

## Start it

```bash
cd observability
cp prometheus.example.yml prometheus.yml   # fill in the placeholders
docker compose up -d
```

`prometheus.yml` is git-ignored: it holds the orchestrator's address and this
API's Grafana Cloud instance. The Grafana Cloud token goes in a separate file,
`grafana-cloud-token`, also ignored — write it as plain UTF-8. PowerShell's
`echo ... >` writes UTF-16, which turns the password into bytes Grafana Cloud
rejects with a 401 that never says why.

| | |
|---|---|
| Grafana | http://localhost:3001 — `admin` / `admin` |
| Prometheus | http://localhost:9090 |

Nothing to click afterwards: the data source and the dashboard are both
provisioned from files, and Grafana opens straight on the dashboard.

## What it scrapes, and why through the orchestrator

The API sits behind API Gateway and demands an API key on every call.
Prometheus has no clean way to send one, and handing our key to another team's
tooling is worse. The orchestrator holds the key and republishes one clean
path per API, so `prometheus.yml` points at `/metrics/inventory` there.

That path answers without a key. Convenient, and worth saying out loud: route
names and traffic volumes are readable by anyone who finds the address. It
carries no business data, which is why it is an acceptable trade for a demo
and not for production.

The orchestrator serves plain HTTP on a bare IP, hence `scheme: http`. If it
ever moves, change the host in `prometheus.yml` — **host only**: no scheme, no
path, no trailing slash. A URL there is the single most common reason the
target shows up DOWN.

## Check the target before trusting a panel

Open http://localhost:9090/targets. It must be **UP**. If it is DOWN, the error
on that page says why, and it is almost always one of:

| Error | Cause |
|---|---|
| `server returned HTTP status 403` | The orchestrator is not sending the API key, or its key is not on the usage plan |
| `invalid metric type` / parse error | The orchestrator is wrapping the response in JSON. It must pass the body through as `text/plain` |
| `context deadline exceeded` | The orchestrator is slow or asleep |
| `no such host` | The hostname in `prometheus.yml` has a scheme or a path in it |

## The dashboard

`dashboards/inventory.json`, eight panels:

| Panel | Query |
|---|---|
| **Cross-cloud calls** | `sum by (outcome) (rate(partner_lookups_total[5m]))` |
| Scrape target | `up{job="inventory-api"}` |
| Requests per second | `sum(rate(http_requests_total[5m]))` |
| By status code | `sum by (status) (rate(http_requests_total[5m]))` |
| p95 latency | `histogram_quantile(0.95, sum by (le) (rate(http_request_duration_seconds_bucket[5m])))` |
| Busiest routes | `topk(5, sum by (route) (rate(http_requests_total[5m])))` |
| Cache hit ratio | `rate(cache_hits_total[5m]) / (rate(cache_hits_total[5m]) + rate(cache_misses_total[5m]))` |
| Process memory | `process_resident_memory_bytes` |

Cross-cloud calls is first and widest on purpose: it is the one panel that
shows, in a single picture, that the two clouds are talking and how often it
works.

Panels edited in the browser are not written back to the JSON. To keep a
change, export it from Grafana and overwrite the file.

## Two honest caveats about the numbers

**The counters come from two replicas behind a load balancer**, and each scrape
lands on whichever one answers. They therefore jump between pods instead of
summing across them, and a rate over them is indicative, not exact. A real
setup has Prometheus discover and scrape each pod directly; going through a
load balancer is the trade taken here so the other team can read the metrics
without credentials into the cluster.

**Restarting a pod resets its counters to zero.** `rate()` copes with that, but
a raw counter graph will show a cliff that is not a traffic drop.
