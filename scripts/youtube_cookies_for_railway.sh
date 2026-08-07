#!/usr/bin/env bash
# Build a compact YouTube Netscape cookies file + base64 for Railway YTDLP_COOKIES_B64.
# Keeps only youtube/google auth cookies so the value fits env-var length limits.
set -euo pipefail
ROOT="$(cd "$(dirname "$0")/.." && pwd)"
SRC="${1:-$ROOT/secrets/youtube-cookies.txt}"
OUT="$ROOT/secrets/youtube-cookies.railway.txt"

if [[ ! -f "$SRC" ]]; then
  echo "Missing $SRC" >&2
  echo "First export cookies:" >&2
  echo "  yt-dlp --cookies-from-browser chrome --cookies secrets/youtube-cookies.txt --skip-download --no-playlist 'https://www.youtube.com/watch?v=jNQXAC9IVRw'" >&2
  exit 1
fi

python3 - "$SRC" "$OUT" <<'PY'
import re, sys
src, out = sys.argv[1], sys.argv[2]
# Domains yt-dlp needs for YouTube auth on datacenter IPs
domain_ok = re.compile(
    r"(^|\.)(youtube\.com|youtu\.be|google\.com|googleapis\.com|ggpht\.com|ytimg\.com)$",
    re.I,
)
# High-value cookie names; still keep other youtube.* rows as backup
priority = re.compile(
    r"^(LOGIN_INFO|SID|HSID|SSID|APISID|SAPISID|__Secure-[13]PSID|__Secure-[13]PSIDTS|"
    r"__Secure-3PAPISID|SSID|CONSENT|PREF|VISITOR_INFO1_LIVE|VISITOR_PRIVACY_METADATA|"
    r"YSC|SESSION_TOKEN|__Secure-YEC|SIDCC|__Secure-1PSIDCC|__Secure-3PSIDCC)$",
    re.I,
)

rows = []
with open(src, "r", encoding="utf-8", errors="replace") as f:
    for line in f:
        s = line.strip()
        if not s or s.startswith("#"):
            continue
        parts = s.split("\t") if "\t" in s else re.split(r"[ ]{2,}", s)
        if len(parts) < 7:
            parts = s.split()
        if len(parts) < 7:
            continue
        domain, flag, path, secure, expiry, name = parts[:6]
        value = "\t".join(parts[6:])
        host = domain.lstrip(".")
        if not domain_ok.search(host):
            continue
        # Always keep youtube.com cookies; for google.com only priority auth names
        if "youtube" in host or "youtu.be" in host or "ytimg" in host or "ggpht" in host:
            rows.append((domain, flag, path, secure, expiry, name, value))
        elif priority.match(name):
            rows.append((domain, flag, path, secure, expiry, name, value))

# De-dupe by (domain, name) keeping last
seen = {}
for r in rows:
    seen[(r[0], r[5])] = r
rows = list(seen.values())

with open(out, "w", encoding="utf-8") as f:
    f.write("# Netscape HTTP Cookie File\n")
    for r in rows:
        f.write("\t".join(r) + "\n")

print(f"wrote {out} ({len(rows)} cookies)", file=sys.stderr)
if len(rows) < 3:
    print("WARNING: very few cookies kept — are you logged into YouTube in that browser?", file=sys.stderr)
    sys.exit(2)
PY

B64=$(base64 -w0 "$OUT")
LEN=${#B64}
echo "YTDLP_COOKIES_B64 length: $LEN chars" >&2
if (( LEN > 30000 )); then
  echo "Still large — try exporting while only logged into YouTube, or use Chrome profile with fewer extensions." >&2
fi
# Print ONLY the value to stdout for easy copy
printf '%s\n' "$B64"
echo >&2
echo "Railway: delete YTDLP_COOKIES if present. Set YTDLP_COOKIES_B64 to the line above. Redeploy." >&2
