#!/usr/bin/env bash
# Print Railway Variables for Firebase (copy/paste). Does not push anywhere.
set -euo pipefail
ROOT="$(cd "$(dirname "$0")/.." && pwd)"
cd "$ROOT"

if [[ ! -f .env ]]; then
  echo "Missing .env" >&2
  exit 1
fi
if [[ ! -f secrets/firebase-service-account.json ]]; then
  echo "Missing secrets/firebase-service-account.json" >&2
  exit 1
fi

# shellcheck disable=SC1091
set -a
# shellcheck source=/dev/null
source <(grep -E '^(FIREBASE_|DEV_AUTH_BYPASS=)' .env | sed 's/\r$//')
set +a

JSON=$(python3 -c 'import json,pathlib; print(json.dumps(json.load(open("secrets/firebase-service-account.json")),separators=(",",":")))')

cat <<EOF
# Paste these into Railway → Variables, then Redeploy.
# Also add your *.up.railway.app host in Firebase Console →
# Authentication → Settings → Authorized domains.

DEV_AUTH_BYPASS=false
FIREBASE_PROJECT_ID=${FIREBASE_PROJECT_ID}
FIREBASE_WEB_API_KEY=${FIREBASE_WEB_API_KEY}
FIREBASE_AUTH_DOMAIN=${FIREBASE_AUTH_DOMAIN}
FIREBASE_STORAGE_BUCKET=${FIREBASE_STORAGE_BUCKET}
FIREBASE_MESSAGING_SENDER_ID=${FIREBASE_MESSAGING_SENDER_ID}
FIREBASE_APP_ID=${FIREBASE_APP_ID}
FIREBASE_CREDENTIALS_JSON=${JSON}

# Do NOT set FIREBASE_CREDENTIALS_PATH on Railway (no local file).
EOF
