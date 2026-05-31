#!/usr/bin/env sh
set -eu

cd "$(dirname "$0")/.."

mkdir -p \
  cli/bin \
  openclaw-data/auth-profile-secrets \
  openclaw-data/config \
  openclaw-data/node \
  openclaw-data/workspace \
  skills \
  sites \
  tools

if [ ! -f .env ]; then
  cp .env.example .env
  echo "Created .env. Add your OpenAI key when you are ready to use the agent."
fi

env_value() {
  key="$1"
  grep "^${key}=" .env 2>/dev/null | tail -n 1 | cut -d= -f2- | sed 's/^"//; s/"$//; s/^'\''//; s/'\''$//'
}

ensure_env() {
  key="$1"
  value="$2"
  if ! grep -q "^${key}=" .env; then
    printf '\n%s=%s\n' "$key" "$value" >> .env
  fi
}

fill_empty_env() {
  key="$1"
  value="$2"
  tmp_file=".env.tmp"
  awk -v key="$key" -v value="$value" '
    BEGIN { replaced = 0 }
    $0 ~ "^" key "=" && replaced == 0 {
      print key "=" value
      replaced = 1
      next
    }
    { print }
  ' .env > "$tmp_file"
  mv "$tmp_file" .env
}

ensure_env "OPEN_AI_KEY" ""
ensure_env "OPENAI_API_KEY" ""
ensure_env "OPENCLAW_PORT" "18789"
ensure_env "OPENCLAW_GATEWAY_TOKEN" ""
ensure_env "OPENCLAW_MODEL_OPENAI" "openai/gpt-5.4-mini"
ensure_env "OPENCLAW_CONTEXT_TOKENS" "131072"
ensure_env "OPENCLAW_AGENT_TIMEOUT_SECONDS" "300"
ensure_env "OPENCLAW_COMPACTION_RESERVE_TOKENS" "24576"
ensure_env "OPENCLAW_COMPACTION_MODEL" "openai/gpt-5.4-mini"
ensure_env "OPENCLAW_HEARTBEAT_TIMEOUT_SECONDS" "300"
ensure_env "OPENCLAW_HEARTBEAT_MODEL" "openai/gpt-5.4-nano"
ensure_env "OPENCLAW_WHATSAPP_PENDING_MAX_AGE_SECONDS" "300"
ensure_env "CONTENT_BUCKET" "syncpoly-web-builder-sites"
ensure_env "AWS_REGION" "us-east-1"
ensure_env "AWS_DEFAULT_REGION" "us-east-1"
ensure_env "CLOUDFRONT_DOMAIN_NAME" ""
ensure_env "AWS_ACCESS_KEY_ID" ""
ensure_env "AWS_SECRET_ACCESS_KEY" ""
ensure_env "AWS_SESSION_TOKEN" ""
ensure_env "GODADDY_API_KEY" ""
ensure_env "GODADDY_API_SECRET" ""

open_ai_key="$(env_value OPEN_AI_KEY)"
openai_api_key="$(env_value OPENAI_API_KEY)"

if [ -z "$open_ai_key" ] && [ -n "$openai_api_key" ]; then
  fill_empty_env "OPEN_AI_KEY" "$openai_api_key"
elif [ -z "$openai_api_key" ] && [ -n "$open_ai_key" ]; then
  fill_empty_env "OPENAI_API_KEY" "$open_ai_key"
fi

gateway_token="$(env_value OPENCLAW_GATEWAY_TOKEN)"
if [ -z "$gateway_token" ]; then
  token="$(openssl rand -hex 32 2>/dev/null || date +%s)"
  fill_empty_env "OPENCLAW_GATEWAY_TOKEN" "$token"
fi

port_is_busy() {
  port="$1"
  if command -v lsof >/dev/null 2>&1; then
    lsof -nP -iTCP:"$port" -sTCP:LISTEN >/dev/null 2>&1 && return 0
  fi
  nc -z 127.0.0.1 "$port" >/dev/null 2>&1
}

openclaw_port="$(env_value OPENCLAW_PORT)"
if [ -z "$openclaw_port" ]; then
  openclaw_port=18789
fi

if port_is_busy "$openclaw_port"; then
  candidate=18790
  while port_is_busy "$candidate"; do
    candidate=$((candidate + 1))
  done
  echo "Port $openclaw_port is already in use; using $candidate for this run."
  openclaw_port="$candidate"
fi

export OPENCLAW_PORT="$openclaw_port"

node bin/configure-openclaw.js "$openclaw_port"

prune_stale_whatsapp_pending() {
  max_age_seconds="$(env_value OPENCLAW_WHATSAPP_PENDING_MAX_AGE_SECONDS)"
  case "$max_age_seconds" in
    ""|*[!0-9]*)
      max_age_seconds=300
      ;;
  esac

  if [ "$max_age_seconds" -eq 0 ]; then
    return
  fi

  state_db="openclaw-data/config/plugin-state/state.sqlite"
  if [ ! -f "$state_db" ] || ! command -v python3 >/dev/null 2>&1; then
    return
  fi

  python3 - "$state_db" "$max_age_seconds" <<'PY'
import sqlite3
import sys
import time

db_path = sys.argv[1]
max_age_seconds = int(sys.argv[2])
cutoff_ms = int(time.time() * 1000) - (max_age_seconds * 1000)

con = sqlite3.connect(db_path)
cur = con.cursor()
rows = cur.execute(
    """
    select plugin_id, namespace, entry_key, value_json
    from plugin_state_entries
    where plugin_id = 'whatsapp'
      and namespace like 'inbound.v1.pending.%'
      and created_at < ?
    """,
    (cutoff_ms,),
).fetchall()

now_ms = int(time.time() * 1000)
cur.executemany(
    """
    insert or replace into plugin_state_entries
      (plugin_id, namespace, entry_key, value_json, created_at, expires_at)
    values (?, ?, ?, ?, ?, ?)
    """,
    [
        (
            plugin_id,
            namespace.replace("inbound.v1.pending.", "inbound.v1.completed.", 1),
            entry_key,
            value_json,
            now_ms,
            None,
        )
        for plugin_id, namespace, entry_key, value_json in rows
    ],
)
cur.execute(
    """
    delete from plugin_state_entries
    where plugin_id = 'whatsapp'
      and namespace like 'inbound.v1.pending.%'
      and created_at < ?
    """,
    (cutoff_ms,),
)
con.commit()
con.close()

if rows:
    print(f"Marked {len(rows)} stale WhatsApp pending message(s) as completed.")
PY
}

prune_stale_whatsapp_pending

echo "Starting OpenClaw gateway on http://127.0.0.1:${OPENCLAW_PORT}/"
echo "Use the OpenClaw UI for any channel setup you want to do manually."

docker compose up --build openclaw
