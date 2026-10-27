#!/bin/bash
# One stage of the rollout: move the weight, bake under load, let the gate judge it.
# Run from terraform/ with URL, STABLE, CANARY, GATE, BAKE_MINUTES, RPS and FAULT set.
set -euo pipefail
WEIGHT=$1

read -ra ALARMS <<< "$(jq -r '.alarms | join(" ")' <<< "$GATE")"
firing() {
  aws cloudwatch describe-alarms --alarm-names "${ALARMS[@]}" --state-value ALARM \
    --query 'MetricAlarms[].AlarmName' --output text
}

# An alarm still firing from an earlier rollout says nothing about this one: let it clear first.
for _ in $(seq 30); do
  [ -z "$(firing)" ] && break
  echo "Waiting for $(firing) to clear"
  sleep 20
done

terraform apply -auto-approve -input=false -var="stable_image_tag=$STABLE" \
  -var="canary_image_tag=$CANARY" -var="canary_weight=$WEIGHT"
echo "### $WEIGHT% of traffic to the canary" >> "$GITHUB_STEP_SUMMARY"

START=$(date -u +%FT%TZ)
npx ts-node ../canary/load.ts --url "$URL" --seconds $((BAKE_MINUTES * 60)) --rps "$RPS" --fault "$FAULT" &
LOAD=$!

# The alarms judge every minute: one firing ends the stage without waiting for the bake.
while kill -0 "$LOAD" 2> /dev/null; do
  sleep 20
  FIRING=$(firing)
  if [ -n "$FIRING" ]; then
    kill "$LOAD"
    echo "**ABORT**: alarm $FIRING firing" | tee -a "$GITHUB_STEP_SUMMARY"
    exit 4
  fi
done
wait "$LOAD"
END=$(date -u +%FT%TZ)

# The load balancer's metrics reach CloudWatch about a minute late.
sleep 90
CODE=0
npx ts-node ../canary/gate.ts --start "$START" --end "$END" --gate "$GATE" || CODE=$?

if [ "$CODE" -eq 3 ]; then
  echo "PAUSED=true" >> "$GITHUB_ENV"
  echo "::warning::Paused at $WEIGHT%: the canary keeps this weight until someone promotes or rolls back"
  exit 0
fi
exit "$CODE"
