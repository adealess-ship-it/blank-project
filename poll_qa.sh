#!/bin/bash
# Poll GitHub Actions QA workflow, download screenshots, show results
# Usage: GITHUB_TOKEN=ghp_xxx ./poll_qa.sh

REPO="${QA_REPO:-$(git remote get-url origin 2>/dev/null | sed 's|.*github.com[:/]||;s|\.git$||')}"
WORKFLOW="${QA_WORKFLOW:-e2e_screenshot.yml}"
API="https://api.github.com/repos/${REPO}/actions"
AUTH="Authorization: token ${GITHUB_TOKEN}"
OUT_DIR="qa_results"

if [ -z "$GITHUB_TOKEN" ]; then
  echo "ERROR: set GITHUB_TOKEN env"
  exit 1
fi

# Find latest run
echo "Finding latest QA run..."
RUN_ID=$(curl -sf -H "$AUTH" "${API}/workflows/${WORKFLOW}/runs?per_page=1" \
  | python3 -c "import sys,json; print(json.load(sys.stdin)['workflow_runs'][0]['id'])" 2>/dev/null)

if [ -z "$RUN_ID" ]; then
  echo "ERROR: no runs found"
  exit 1
fi

echo "Run ID: ${RUN_ID}"
echo "URL: https://github.com/${REPO}/actions/runs/${RUN_ID}"
echo ""

# Poll until done
while true; do
  RESP=$(curl -sf -H "$AUTH" "${API}/runs/${RUN_ID}")
  STATUS=$(echo "$RESP" | python3 -c "import sys,json; print(json.load(sys.stdin)['status'])")
  CONCLUSION=$(echo "$RESP" | python3 -c "import sys,json; print(json.load(sys.stdin).get('conclusion') or '')")

  if [ "$STATUS" = "completed" ]; then
    echo "Completed: ${CONCLUSION}"
    break
  fi

  echo "$(date +%H:%M:%S) status=${STATUS} ..."
  sleep 30
done

echo ""

# Download artifact
mkdir -p "$OUT_DIR"
ARTIFACTS=$(curl -sf -H "$AUTH" "${API}/runs/${RUN_ID}/artifacts")
ART_URL=$(echo "$ARTIFACTS" | python3 -c "
import sys,json
arts = json.load(sys.stdin).get('artifacts',[])
for a in arts:
    if 'screenshot' in a['name']:
        print(a['archive_download_url'])
        break
" 2>/dev/null)

if [ -n "$ART_URL" ]; then
  echo "Downloading screenshots..."
  curl -sfL -H "$AUTH" "$ART_URL" -o "${OUT_DIR}/screenshots.zip"
  cd "$OUT_DIR" && unzip -o screenshots.zip 2>/dev/null && rm -f screenshots.zip && cd ..
  echo "Screenshots saved to ${OUT_DIR}/"
  ls -lh "${OUT_DIR}"/*.png 2>/dev/null
else
  echo "No screenshot artifact found"
fi

echo ""

# Show selftest report from Replit
BASE="${REPLIT_DEV_DOMAIN:-}"
if [ -n "$BASE" ]; then
  BASE="${BASE%/}"
  echo "=== Self-Test Report ==="
  curl -sf "${BASE}/pytrigger/test-report" | python3 -c "
import sys,json
r = json.load(sys.stdin)
if 'data' not in r:
    print('No report')
    sys.exit(0)
tests = r['data'].get('tests',[])
p = f = 0
for t in tests:
    mark = 'PASS' if t['pass'] else 'FAIL'
    if t['pass']: p += 1
    else: f += 1
    print(f'  {mark} {t[\"name\"]:30s} {t[\"detail\"]}')
print(f'\nTotal: {p} passed, {f} failed')
" 2>/dev/null || echo "(could not fetch report from Replit)"
fi

echo ""
echo "Done. View screenshots: ls ${OUT_DIR}/"
