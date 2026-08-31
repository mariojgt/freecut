#!/usr/bin/env bash

set -Eeuo pipefail

readonly INSTALL_DIRECTORY='/opt/freecut'
readonly SYSTEMD_DIRECTORY='/etc/systemd/system'
SCRIPT_DIRECTORY="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
readonly SCRIPT_DIRECTORY
REPOSITORY_ROOT="$(cd "${SCRIPT_DIRECTORY}/.." && pwd)"
readonly REPOSITORY_ROOT

if [[ "$(id -u)" -ne 0 ]]; then
  printf 'Run this installer as root: sudo ./docker/install-auto-update.sh\n' >&2
  exit 1
fi

for command_name in curl docker install systemctl; do
  if ! command -v "$command_name" >/dev/null 2>&1; then
    printf 'Required command is missing: %s\n' "$command_name" >&2
    exit 1
  fi
done
docker compose version >/dev/null 2>&1 \
  || { printf 'The Docker Compose plugin is required.\n' >&2; exit 1; }

install -d -m 755 "${INSTALL_DIRECTORY}/docker"
install -d -m 1777 "${INSTALL_DIRECTORY}/run"
install -m 644 "${REPOSITORY_ROOT}/docker-compose.production.yml" \
  "${INSTALL_DIRECTORY}/docker-compose.production.yml"
install -m 755 "${SCRIPT_DIRECTORY}/deploy-release.sh" \
  "${INSTALL_DIRECTORY}/docker/deploy-release.sh"
install -m 755 "${SCRIPT_DIRECTORY}/check-for-update.sh" \
  "${INSTALL_DIRECTORY}/docker/check-for-update.sh"
if [[ ! -e "${INSTALL_DIRECTORY}/.env" ]]; then
  install -m 600 /dev/null "${INSTALL_DIRECTORY}/.env"
fi
install -m 644 "${SCRIPT_DIRECTORY}/systemd/freecut-update.service" \
  "${SYSTEMD_DIRECTORY}/freecut-update.service"
install -m 644 "${SCRIPT_DIRECTORY}/systemd/freecut-update.timer" \
  "${SYSTEMD_DIRECTORY}/freecut-update.timer"
install -m 644 "${SCRIPT_DIRECTORY}/systemd/freecut-update.path" \
  "${SYSTEMD_DIRECTORY}/freecut-update.path"

systemctl daemon-reload
systemctl enable --now freecut-update.timer freecut-update.path

printf 'FreeCut automatic updates are installed. Running the first check now.\n'
systemctl start freecut-update.service
printf 'Use systemctl status freecut-update.service to inspect the result.\n'
