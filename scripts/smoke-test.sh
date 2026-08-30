#!/usr/bin/env bash
# Phase 1 end-to-end smoke test. Assumes the server is already running
# (node server.js) and the DB is otherwise empty/disposable. Re-run after
# any change to Stage 0/1 code as a regression guard for later phases.
set -e
BASE="${BASE_URL:-http://localhost:3000}"

echo "== contacts: import + list =="
curl -sf -X POST "$BASE/api/import/dedup" -H "Content-Type: application/json" \
  -d '{"csv":"email,name,company,phone\nalice@example.com,Alice,Acme,555-1111"}'
echo
curl -sf "$BASE/api/contacts"
echo

echo "== re-import: merge/skip/unsubscribed-stays-unsubscribed =="
curl -sf -X POST "$BASE/api/import/dedup" -H "Content-Type: application/json" \
  -d '{"csv":"email,contactName,businessName,phone\nbob@example.com,Bob,Bobco,555-2222\n,NoEmail,MissingCo,555-0000\ncarol@example.com,Carol,Carolco,555-3333"}'
echo

echo "== sync token + extension-sync (dedup + supplier) =="
TOKEN_JSON=$(curl -sf -X POST "$BASE/api/sync-tokens" -H "Content-Type: application/json" -d '{"label":"smoke-test"}')
TOKEN=$(node -e "console.log(JSON.parse(process.argv[1]).token)" "$TOKEN_JSON")
curl -sf -X POST "$BASE/extension-sync/dedup" -H "Content-Type: application/json" -H "Authorization: Bearer $TOKEN" \
  -d '[{"id":"row1","businessName":"Acme Corp","contactName":"Dana","email":"dana@example.com","phone":"555-9999","commodity":"widgets"}]'
echo
curl -sf -X POST "$BASE/extension-sync/supplier" -H "Content-Type: application/json" -H "Authorization: Bearer $TOKEN" \
  -d '[{"id":"row2","businessName":"Beta LLC","contactName":"Evan","email":"evan@example.com"}]'
echo

echo "== bad token should 401 =="
curl -s -o /dev/null -w "status=%{http_code}\n" -X POST "$BASE/extension-sync/dedup" \
  -H "Content-Type: application/json" -H "Authorization: Bearer wrong-token" -d '[{"email":"x@example.com"}]'

echo "== campaign draft create + view + recipients =="
CAMP_JSON=$(curl -sf -X POST "$BASE/api/campaigns" -H "Content-Type: application/json" \
  -d '{"name":"Smoke test campaign","subject":"Hi {{name}}","body":"<p>Hi {{name}}</p>","track":"B"}')
CAMP_ID=$(node -e "console.log(JSON.parse(process.argv[1]).id)" "$CAMP_JSON")
curl -sf "$BASE/api/campaigns/$CAMP_ID"
echo
curl -sf "$BASE/api/campaigns/$CAMP_ID/recipients"
echo

echo "== reputation status =="
curl -sf "$BASE/api/reputation/status"
echo

echo "Smoke test complete. Tracking-pixel/click and throttle checks require",
echo "manual DB seeding — see BUILD-ROADMAP.md Phase 1 verification notes."
