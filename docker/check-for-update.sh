#!/usr/bin/env bash

set -Eeuo pipefail

readonly REPOSITORY="${FREECUT_REPOSITORY:-mariojgt/freecut}"
readonly INSTALL_DIRECTORY="${FREECUT_INSTALL_DIR:-/opt/freecut}"
readonly LATEST_RELEASE_URL="${FREECUT_LATEST_RELEASE_URL:-https://github.com/${REPOSITORY}/releases/latest}"
readonly DEPLOYED_ENV_FILE="${INSTALL_DIRECTORY}/.freecut-deployed.env"
readonly UPDATE_REQUEST_FILE="${FREECUT_UPDATE_REQUEST_FILE:-${INSTALL_DIRECTORY}/run/update-request}"

temporary_directory=''
restore_assets_on_exit=false

log() {
  printf '[freecut-update] %s\n' "$*"
}

fail() {
  printf '[freecut-update] ERROR: %s\n' "$*" >&2
  exit 1
}

cleanup() {
  local exit_status=$?
  if [[ "$restore_assets_on_exit" == true && -n "$temporary_directory" ]]; then
    printf '[freecut-update] restoring deployment files from the last healthy release\n' >&2
    set +e
    cp -p -- "${temporary_directory}/previous-compose.yml" \
      "${INSTALL_DIRECTORY}/docker-compose.production.yml"
    cp -p -- "${temporary_directory}/previous-deploy.sh" \
      "${INSTALL_DIRECTORY}/docker/deploy-release.sh"
    cp -p -- "${temporary_directory}/previous-check.sh" \
      "${INSTALL_DIRECTORY}/docker/check-for-update.sh"
    set -e
  fi
  if [[ -n "$temporary_directory" && -d "$temporary_directory" ]]; then
    rm -rf -- "$temporary_directory"
  fi
  return "$exit_status"
}
trap cleanup EXIT

if [[ ! "$REPOSITORY" =~ ^[A-Za-z0-9_.-]+/[A-Za-z0-9_.-]+$ ]]; then
  fail 'FREECUT_REPOSITORY must use owner/repository format'
fi
if [[ ! "$INSTALL_DIRECTORY" =~ ^/[A-Za-z0-9._/-]+$ || "$INSTALL_DIRECTORY" == *..* ]]; then
  fail 'FREECUT_INSTALL_DIR must be an absolute path without spaces or parent traversal'
fi
if [[ "$UPDATE_REQUEST_FILE" != "${INSTALL_DIRECTORY}/run/update-request" ]]; then
  fail 'FREECUT_UPDATE_REQUEST_FILE must point to the managed update request file'
fi

# The path unit has already scheduled this service, so consume its exact,
# non-sensitive marker before doing any network or Docker work.
rm -f -- "$UPDATE_REQUEST_FILE"

command -v curl >/dev/null 2>&1 || fail 'curl is not installed'
command -v docker >/dev/null 2>&1 || fail 'docker is not installed'
docker compose version >/dev/null 2>&1 || fail 'the Docker Compose plugin is not available'
[[ -d "$INSTALL_DIRECTORY" ]] || fail "$INSTALL_DIRECTORY does not exist"
[[ -x "$INSTALL_DIRECTORY/docker/deploy-release.sh" ]] \
  || fail 'docker/deploy-release.sh is missing or not executable'
[[ -f "$INSTALL_DIRECTORY/docker-compose.production.yml" ]] \
  || fail 'docker-compose.production.yml is missing'

curl_arguments=(
  --fail
  --silent
  --show-error
  --location
  --connect-timeout 10
  --max-time 45
  --retry 2
  --retry-delay 1
)

if ! latest_release_url="$(
  curl "${curl_arguments[@]}" \
    --output /dev/null \
    --write-out '%{url_effective}' \
    "$LATEST_RELEASE_URL"
)"; then
  fail "could not read the latest public release for ${REPOSITORY}"
fi
latest_release_url="${latest_release_url%/}"
latest_tag="${latest_release_url##*/}"

if [[ ! "$latest_tag" =~ ^v?[0-9]+\.[0-9]+\.[0-9]+([.-][0-9A-Za-z.-]+)?$ ]]; then
  fail "latest GitHub Release returned an invalid tag: ${latest_tag}"
fi

current_tag=''
if [[ -f "$DEPLOYED_ENV_FILE" ]]; then
  current_tag="$(sed -n 's/^FREECUT_IMAGE_TAG=//p' "$DEPLOYED_ENV_FILE" | tail -n 1)"
fi

web_container_id="$(
  docker ps \
    --filter label=com.docker.compose.project=freecut \
    --filter label=com.docker.compose.service=web \
    --filter status=running \
    --filter health=healthy \
    --format '{{.ID}}'
)"

if [[ "$latest_tag" == "$current_tag" && -n "$web_container_id" ]]; then
  log "${latest_tag} is already running"
  exit 0
fi

refresh_release_assets() {
  local tag="$1"
  local raw_base_url="https://raw.githubusercontent.com/${REPOSITORY}/${tag}"

  temporary_directory="$(mktemp -d "${INSTALL_DIRECTORY}/.freecut-update.XXXXXX")"
  log "downloading deployment files for ${tag}"
  curl "${curl_arguments[@]}" \
    --output "${temporary_directory}/docker-compose.production.yml" \
    "${raw_base_url}/docker-compose.production.yml"
  curl "${curl_arguments[@]}" \
    --output "${temporary_directory}/deploy-release.sh" \
    "${raw_base_url}/docker/deploy-release.sh"
  curl "${curl_arguments[@]}" \
    --output "${temporary_directory}/check-for-update.sh" \
    "${raw_base_url}/docker/check-for-update.sh"

  bash -n "${temporary_directory}/deploy-release.sh"
  bash -n "${temporary_directory}/check-for-update.sh"
  FREECUT_IMAGE_TAG="$tag" docker compose \
    -f "${temporary_directory}/docker-compose.production.yml" \
    config --quiet

  chmod 644 "${temporary_directory}/docker-compose.production.yml"
  chmod 755 "${temporary_directory}/deploy-release.sh"
  chmod 755 "${temporary_directory}/check-for-update.sh"
  cp -p -- "${INSTALL_DIRECTORY}/docker-compose.production.yml" \
    "${temporary_directory}/previous-compose.yml"
  cp -p -- "${INSTALL_DIRECTORY}/docker/deploy-release.sh" \
    "${temporary_directory}/previous-deploy.sh"
  cp -p -- "${INSTALL_DIRECTORY}/docker/check-for-update.sh" \
    "${temporary_directory}/previous-check.sh"
  restore_assets_on_exit=true
  mv "${temporary_directory}/docker-compose.production.yml" \
    "${INSTALL_DIRECTORY}/docker-compose.production.yml"
  mv "${temporary_directory}/deploy-release.sh" \
    "${INSTALL_DIRECTORY}/docker/deploy-release.sh"
  mv "${temporary_directory}/check-for-update.sh" \
    "${INSTALL_DIRECTORY}/docker/check-for-update.sh"
}

if [[ "$latest_tag" != "$current_tag" ]]; then
  refresh_release_assets "$latest_tag"
  log "new release found: ${current_tag:-none} -> ${latest_tag}"
else
  log "${latest_tag} is installed but the web container is not running; repairing it"
fi

cd "$INSTALL_DIRECTORY"
if ! "${INSTALL_DIRECTORY}/docker/deploy-release.sh" "$latest_tag"; then
  fail "deployment of ${latest_tag} failed"
fi
restore_assets_on_exit=false
