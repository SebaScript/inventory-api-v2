#!/bin/bash
# Detection as code: every pattern must fire on its positive event and stay quiet on its
# negative one. aws events test-event-pattern returns true/false, exactly as code is tested.
# Needs AWS credentials (it is an API call). Run from the repo root.
set -euo pipefail
cd "$(dirname "$0")/detections"

fail=0
for pattern in *.json; do
  case "$pattern" in *.positive.json | *.negative.json) continue ;; esac
  name=${pattern%.json}

  for kind in positive negative; do
    event="$name.$kind.json"
    [ -f "$event" ] || { echo "MISSING  $event"; fail=1; continue; }
    got=$(aws events test-event-pattern \
      --event-pattern "file://$pattern" --event "file://$event" \
      --query Result --output text)
    want=$([ "$kind" = positive ] && echo True || echo False)
    if [ "$got" = "$want" ]; then
      echo "ok   $name  $kind -> $got"
    else
      echo "FAIL $name  $kind -> $got (wanted $want)"; fail=1
    fi
  done
done
exit $fail
