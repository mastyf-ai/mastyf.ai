# shellcheck shell=sh
# Load or create $MASTYF_HOME/dashboard_api_key. Never echo the value.
dashboard_api_key_path() {
  printf '%s\n' "${MASTYF_HOME:-$HOME/.mastyf}/dashboard_api_key"
}

ensure_dashboard_api_key() {
  if [ -n "${DASHBOARD_API_KEY:-}" ]; then
    return 0
  fi
  KEY_FILE="$(dashboard_api_key_path)"
  mkdir -p "$(dirname "$KEY_FILE")"
  if [ ! -s "$KEY_FILE" ]; then
    node -e "require('fs').writeFileSync(process.argv[1], require('crypto').randomBytes(32).toString('hex')+'\n',{mode:0o600})" "$KEY_FILE"
  fi
  DASHBOARD_API_KEY="$(tr -d '\n\r' < "$KEY_FILE")"
  export DASHBOARD_API_KEY
}

curl_api_key_header() {
  if [ -z "${DASHBOARD_API_KEY:-}" ]; then
    ensure_dashboard_api_key
  fi
  if [ -n "${DASHBOARD_API_KEY:-}" ]; then
    printf '%s' "-H X-API-Key: ${DASHBOARD_API_KEY}"
  fi
}
