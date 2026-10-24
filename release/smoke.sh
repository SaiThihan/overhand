#!/bin/sh
# Smoke-tests a built Overhand binary: version, a daemon on a free port with a scratch HOME and OVERHAND_HOME, its state, every
# /api/request/* answering 200 with the daemon still up afterwards, and a foreign Host header refused with 403.
#   bash release/smoke.sh                 build this machine's package with release/build.ts, then test it
#   bash release/smoke.sh <package-dir>   test an unpacked package (the folder holding overhand and web/)
# SMOKE_PORT picks the first port to try (default 4490). It never touches ~/.overhand, ~/.claude or port 4317.
set -eu

ROOT="$(cd "$(dirname "$0")/.." && pwd)"
TMP="$(mktemp -d)"
PID=""
cleanup() {
  if [ -n "$PID" ]; then kill "$PID" 2>/dev/null || true; fi
  rm -rf "$TMP"
}
trap cleanup EXIT

fail() {
  echo "✗ $*" >&2
  if [ -f "$TMP/daemon.log" ]; then
    echo "--- daemon log ---" >&2
    tail -n 40 "$TMP/daemon.log" >&2
  fi
  exit 1
}

if [ $# -ge 1 ]; then
  PKG="$1"
else
  case "$(uname -s)" in Darwin) os=darwin ;; *) os=linux ;; esac
  case "$(uname -m)" in arm64 | aarch64) arch=arm64 ;; *) arch=x64 ;; esac
  (cd "$ROOT" && bun release/build.ts "$TMP/out")
  PKG="$TMP/out/overhand-${os}-${arch}"
fi
BIN="$PKG/overhand"
[ -x "$BIN" ] || fail "no binary at $BIN"
[ -f "$PKG/web/index.html" ] || fail "no dashboard at $PKG/web"

want="$(cd "$ROOT" && bun -e 'console.log((await Bun.file("package.json").json()).version)')"
got="$("$BIN" version)"
[ "$got" = "$want" ] || fail "version says $got, package.json says $want"
echo "✓ version $got"

port="${SMOKE_PORT:-4490}"
while curl -s -o /dev/null "http://127.0.0.1:${port}/"; do port=$((port + 1)); done
[ "$port" != 4317 ] || fail "refusing port 4317"
base="http://127.0.0.1:${port}"

mkdir -p "$TMP/home" "$TMP/ops"
HOME="$TMP/home" OVERHAND_HOME="$TMP/ops" OVERHAND_PORT="$port" "$BIN" daemon >"$TMP/daemon.log" 2>&1 &
PID=$!

# every local call needs the install's key, made on first use in its control folder; the CLI sends it the same way
keyfile="$TMP/ops/control/local-key"
state() { curl -s -o /dev/null -w '%{http_code}' -H "x-overhand-key: $(cat "$keyfile" 2>/dev/null)" "$base/api/state"; }
i=0
until [ "$(state)" = 200 ]; do
  i=$((i + 1))
  [ "$i" -lt 60 ] || fail "no /api/state on port $port after 30 s"
  kill -0 "$PID" 2>/dev/null || fail "the daemon exited"
  sleep 0.5
done
echo "✓ daemon answers /api/state on port $port"
key="$(cat "$keyfile")"

code="$(curl -s -o /dev/null -w '%{http_code}' "$base/api/state")"
[ "$code" = 401 ] || fail "a call without the local key got $code, not 401"
echo "✓ a call without the local key gets 401"

for r in plan inbox work; do
  code="$(curl -s -o /dev/null -w '%{http_code}' -X POST -H "Origin: $base" -H "x-overhand-key: $key" -H 'Content-Type: application/json' -d '{}' "$base/api/request/$r")"
  [ "$code" = 200 ] || fail "POST /api/request/$r answered $code"
  code="$(state)"
  [ "$code" = 200 ] || fail "after /api/request/$r, /api/state answered $code"
  echo "✓ /api/request/$r, and the daemon still answers"
done

code="$(curl -s -o /dev/null -w '%{http_code}' -H 'Host: evil.example' -H "x-overhand-key: $key" "$base/api/state")"
[ "$code" = 403 ] || fail "a foreign Host header got $code, not 403"
echo "✓ a foreign Host header gets 403"

kill -0 "$PID" 2>/dev/null || fail "the daemon died during the test"
echo "Smoke test passed."
