#!/usr/bin/env bash
# ---------------------------------------------------------------------------
# Smoke test for a running Inventory API instance.
#
#   ./scripts/smoke-test.sh http://localhost:3000
#
# Exercises the real HTTP surface of a deployed container: health, both CRUDs,
# an IN and an OUT movement, the insufficient-stock rule, and the QUERY verb.
#
# This is what makes the Docker configuration genuinely verified rather than
# merely present — the pipeline boots the exact stack that ships and then proves
# it serves correct responses.
#
# Any failure aborts with a non-zero exit code.
# ---------------------------------------------------------------------------
set -euo pipefail

BASE_URL="${1:-http://localhost:3000}"
PASSED=0

fail() {
  echo "  FAIL: $*" >&2
  exit 1
}

pass() {
  PASSED=$((PASSED + 1))
  echo "  ok: $*"
}

# Issues a request and asserts the status code. Echoes the response body so the
# caller can inspect it.
expect_status() {
  local expected="$1" method="$2" path="$3" body="${4:-}"
  local response status payload

  if [ -n "$body" ]; then
    response=$(curl -sS -X "$method" "${BASE_URL}${path}" \
      -H 'Content-Type: application/json' -d "$body" -w $'\n%{http_code}')
  else
    response=$(curl -sS -X "$method" "${BASE_URL}${path}" -w $'\n%{http_code}')
  fi

  status="${response##*$'\n'}"
  payload="${response%$'\n'*}"

  if [ "$status" != "$expected" ]; then
    echo "  Response: $payload" >&2
    fail "$method $path expected $expected, got $status"
  fi

  echo "$payload"
}

# Reads a top-level field out of a JSON payload without requiring jq.
json_field() {
  node -e "
    let raw = '';
    process.stdin.on('data', (chunk) => (raw += chunk));
    process.stdin.on('end', () => {
      const value = process.argv[1].split('.').reduce((acc, key) => acc?.[key], JSON.parse(raw));
      if (value === undefined) { console.error('missing field: ' + process.argv[1]); process.exit(1); }
      process.stdout.write(String(value));
    });
  " "$1"
}

echo "Smoke testing ${BASE_URL}"

# --- Health -----------------------------------------------------------------
echo "[1/8] Health check"
health=$(expect_status 200 GET /health)
[ "$(echo "$health" | json_field status)" = "ok" ] || fail "health status is not ok"
[ "$(echo "$health" | json_field info.database.status)" = "up" ] || fail "database is not up"
pass "health reports ok with PostgreSQL up"

# --- Docs -------------------------------------------------------------------
echo "[2/8] API documentation"
expect_status 200 GET /docs > /dev/null
expect_status 200 GET /docs-json > /dev/null
pass "Swagger UI and OpenAPI document are served"

# --- Inventory summary ------------------------------------------------------
#
# Whether demo data is present is environment-specific: Test seeds itself,
# Production must not. So the shape of the report is always asserted, and the
# presence of seeded rows only when the caller says to expect it.
echo "[3/8] Inventory summary"
summary=$(expect_status 200 GET /items/summary)
for field in totalGroups totalItems totalUnits totalValue lowStockCount outOfStockCount; do
  echo "$summary" | json_field "$field" > /dev/null || fail "summary is missing ${field}"
done
total_items=$(echo "$summary" | json_field totalItems)

if [ "${EXPECT_SEED_DATA:-false}" = "true" ]; then
  [ "$total_items" -gt 0 ] || fail "expected seeded demo data, found none"
  pass "summary is well formed and reports ${total_items} seeded items"
else
  pass "summary is well formed (${total_items} items; seeding not expected here)"
fi

# --- Group CRUD -------------------------------------------------------------
echo "[4/8] Group CRUD"
suffix="$RANDOM$RANDOM"
group=$(expect_status 201 POST /groups "{\"name\":\"Smoke Test ${suffix}\",\"description\":\"created by smoke test\"}")
group_id=$(echo "$group" | json_field id)

expect_status 200 GET "/groups/${group_id}" > /dev/null
expect_status 200 PATCH "/groups/${group_id}" '{"description":"patched"}' > /dev/null
expect_status 200 PUT "/groups/${group_id}" "{\"name\":\"Smoke Test ${suffix}\"}" > /dev/null
expect_status 409 POST /groups "{\"name\":\"smoke test ${suffix}\"}" > /dev/null
expect_status 404 GET /groups/999999 > /dev/null
expect_status 400 POST /groups '{"name":"A"}' > /dev/null
pass "create, read, update, replace, duplicate 409, missing 404 and validation 400"

# --- Item CRUD --------------------------------------------------------------
echo "[5/8] Item CRUD"
item=$(expect_status 201 POST /items \
  "{\"groupId\":${group_id},\"name\":\"Smoke Item\",\"sku\":\"SMOKE-${suffix}\",\"quantity\":10,\"minimumStock\":2,\"unitPrice\":9.99}")
item_id=$(echo "$item" | json_field id)

[ "$(echo "$item" | json_field quantity)" = "10" ] || fail "opening stock was not applied"
expect_status 200 GET "/items/${item_id}" > /dev/null
expect_status 200 PATCH "/items/${item_id}" '{"unitPrice":11.5}' > /dev/null
expect_status 409 POST /items "{\"groupId\":${group_id},\"name\":\"Dup\",\"sku\":\"smoke-${suffix}\"}" > /dev/null
# quantity is owned by the ledger and must be rejected here.
expect_status 400 PATCH "/items/${item_id}" '{"quantity":999}' > /dev/null
pass "create with opening stock, read, patch, duplicate SKU 409, quantity rejected"

# --- Movements --------------------------------------------------------------
echo "[6/8] Inventory rules"
in_movement=$(expect_status 201 POST /movements \
  "{\"itemId\":${item_id},\"type\":\"IN\",\"quantity\":25,\"reason\":\"smoke test delivery\"}")
[ "$(echo "$in_movement" | json_field resultingStock)" = "35" ] || fail "IN did not raise stock to 35"

out_movement=$(expect_status 201 POST /movements \
  "{\"itemId\":${item_id},\"type\":\"OUT\",\"quantity\":15}")
[ "$(echo "$out_movement" | json_field resultingStock)" = "20" ] || fail "OUT did not lower stock to 20"

# The central rule: an oversized OUT is rejected and nothing is written.
rejected=$(expect_status 409 POST /movements "{\"itemId\":${item_id},\"type\":\"OUT\",\"quantity\":9999}")
[ "$(echo "$rejected" | json_field code)" = "INSUFFICIENT_STOCK" ] || fail "wrong error code for insufficient stock"

after=$(expect_status 200 GET "/items/${item_id}")
[ "$(echo "$after" | json_field quantity)" = "20" ] || fail "stock changed despite the rejected movement"

expect_status 400 POST /movements "{\"itemId\":${item_id},\"type\":\"ADJUST\",\"quantity\":1}" > /dev/null
expect_status 400 POST /movements "{\"itemId\":${item_id},\"type\":\"IN\",\"quantity\":0}" > /dev/null
expect_status 404 POST /movements '{"itemId":999999,"type":"IN","quantity":1}' > /dev/null
pass "IN, OUT, insufficient stock rejected atomically, enum and quantity validated"

# --- QUERY verb -------------------------------------------------------------
echo "[7/8] HTTP QUERY verb"
# curl sends any method verbatim with -X, so this is a genuine QUERY request.
query_result=$(expect_status 200 QUERY /items/search \
  '{"text":"smoke","price":{"min":0,"max":1000},"sort":[{"field":"quantity","order":"desc"}],"page":1,"pageSize":10}')
[ "$(echo "$query_result" | json_field meta.page)" = "1" ] || fail "QUERY did not return a paginated envelope"

found=$(echo "$query_result" | json_field meta.total)
[ "$found" -ge 1 ] || fail "QUERY did not find the smoke test item"

expect_status 400 QUERY /items/search '{"pageSize":101}' > /dev/null
pass "QUERY /items/search returned ${found} result(s) and enforces validation"

# --- Cleanup ----------------------------------------------------------------
echo "[8/8] Cleanup and referential integrity"
# The group still holds an item, so deleting it must be refused.
expect_status 409 DELETE "/groups/${group_id}" > /dev/null
expect_status 204 DELETE "/items/${item_id}" > /dev/null
expect_status 204 DELETE "/groups/${group_id}" > /dev/null
expect_status 404 GET "/groups/${group_id}" > /dev/null
pass "non-empty group refused, then item and group removed"

echo
echo "Smoke test passed (${PASSED} checks) against ${BASE_URL}"
