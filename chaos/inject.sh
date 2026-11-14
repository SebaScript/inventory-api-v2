#!/bin/bash
# The injections and rollbacks the experiments call, one subcommand each. Run from the repo root.
set -euo pipefail
PROJECT=inventory-api
OUT=chaos/out
mkdir -p "$OUT"

# The fault window on the dashboard: ChaosFaultActive = 1 every 30 s, until stopped or timed out.
mark_start() {
  nohup bash -c "for _ in \$(seq $(($2 / 30))); do aws cloudwatch put-metric-data --namespace $PROJECT \
    --metric-name ChaosFaultActive --dimensions Experiment=$1 --value 1; sleep 30; done" > /dev/null 2>&1 &
  echo $! > "$OUT/mark-$1.pid"
}

stop_pid() {
  kill "$(cat "$1" 2> /dev/null)" 2> /dev/null || true
  rm -f "$1"
}

case "${1:-}" in
  # (a) AWS FIS: 2 s of latency on the node's traffic to the partner. FIS removes it by itself.
  fis-start)
    aws fis start-experiment --experiment-template-id "$2" --tags "Round=${ROUND:-x}" \
      --query experiment.id --output text
    mark_start a 300
    ;;
  fis-stop)
    for id in $(aws fis list-experiments --output text --query \
      "experiments[?experimentTemplateId=='$2' && state.status=='running'].id"); do
      aws fis stop-experiment --id "$id" > /dev/null && echo "stopped $id"
    done
    stop_pid "$OUT/mark-a.pid"
    ;;
  # (c) The switch in our own code: a stream of slow reports that hold database connections.
  reports-start)
    nohup k6 run -e BASE_URL="$BASE_URL" -e FAULT_TOKEN="$FAULT_TOKEN" chaos/reports.js \
      > "$OUT/reports.log" 2>&1 &
    echo $! > "$OUT/reports.pid"
    mark_start c 240
    ;;
  reports-stop)
    stop_pid "$OUT/reports.pid"
    stop_pid "$OUT/mark-c.pid"
    ;;
  # Safeguard probe: how many of the named alarms are firing. 0 means keep going.
  alarm)
    aws cloudwatch describe-alarms --alarm-names "$2" --state-value ALARM \
      --query 'length(MetricAlarms)' --output text
    ;;
  *)
    echo "usage: inject.sh fis-start|fis-stop <template> | reports-start|reports-stop | alarm <name>" >&2
    exit 2
    ;;
esac
