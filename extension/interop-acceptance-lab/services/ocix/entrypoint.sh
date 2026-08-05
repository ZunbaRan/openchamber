#!/bin/sh
set -eu

runtime_secret_root=/tmp/openchamber-secrets
install -d -m 0711 "${runtime_secret_root}"

for source_path in /run/secrets/*; do
  [ -f "${source_path}" ] || continue
  target_path="${runtime_secret_root}/$(basename "${source_path}")"
  cp "${source_path}" "${target_path}"
  chmod 0400 "${target_path}"
  chown node:node "${target_path}"
done

if [ -n "${HOSTED_RELEASE_STATE_FILE:-}" ]; then
  case "${HOSTED_RELEASE_STATE_FILE}" in
    /data/*)
      mkdir -p /data
      data_owner_uid="$(stat -c '%u' /data)"
      if [ "${data_owner_uid}" = "0" ]; then
        chmod 0700 /data
        chown node:node /data
      elif [ "${data_owner_uid}" = "$(id -u node)" ]; then
        setpriv --reuid=node --regid=node --init-groups -- chmod 0700 /data
      else
        echo "/data must be owned by root or node" >&2
        exit 1
      fi
      ;;
    *)
      echo "HOSTED_RELEASE_STATE_FILE must be inside /data" >&2
      exit 1
      ;;
  esac
fi

exec setpriv --reuid=node --regid=node --init-groups -- node /app/server.mjs
