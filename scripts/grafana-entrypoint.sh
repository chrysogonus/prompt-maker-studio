#!/bin/sh
set -eu

case "${GF_SECURITY_ADMIN_PASSWORD:-}" in
  ''|change-this-to-a-secure-password)
    echo 'Set a unique GRAFANA_ADMIN_PASSWORD before starting Grafana.' >&2
    exit 1
    ;;
esac

exec /run.sh "$@"
