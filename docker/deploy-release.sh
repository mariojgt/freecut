#!/usr/bin/env bash

set -Eeuo pipefail

readonly RELEASE_TAG="${1:-}"
readonly COMPOSE_FILE="${FREECUT_COMPOSE_FILE:-docker-compose.production.yml}"
readonly RELEASE_ENV_FILE="${FREECUT_RELEASE_ENV_FILE:-.freecut-release.env}"
readonly DEPLOYED_ENV_FILE="${FREECUT_DEPLOYED_ENV_FILE:-.freecut-deployed.env}"
readonly DEPLOY_TIMEOUT="${FREECUT_DEPLOY_TIMEOUT:-180}"

log() {
  printf '[freecut-deploy] %s\n' "$*"
}

fail() {
  printf '[freecut-deploy] ERROR: %s\n' "$*" >&2
  exit 1
}

if [[ ! "$RELEASE_TAG" =~ ^[A-Za-z0-9][A-Za-z0-9._-]{0,127}$ ]]; then
  fail 'release tag must be a valid Docker tag (letters, digits, dot, underscore, or dash)'
fi

if [[ ! "$DEPLOY_TIMEOUT" =~ ^[1-9][0-9]*$ ]]; then
  fail 'FREECUT_DEPLOY_TIMEOUT must be a positive number of seconds'
fi

command -v docker >/dev/null 2>&1 || fail 'docker is not installed'
docker compose version >/dev/null 2>&1 || fail 'the Docker Compose plugin is not available'
[[ -f "$COMPOSE_FILE" ]] || fail "$COMPOSE_FILE does not exist"

read_release_tag() {
  local source_file="$1"
  local tag=''
  if [[ -f "$source_file" ]]; then
    tag="$(sed -n 's/^FREECUT_IMAGE_TAG=//p' "$source_file" | tail -n 1)"
  fi
  if [[ "$tag" =~ ^[A-Za-z0-9][A-Za-z0-9._-]{0,127}$ ]]; then
    printf '%s' "$tag"
  fi
}

previous_tag="$(read_release_tag "$DEPLOYED_ENV_FILE")"
if [[ -z "$previous_tag" ]]; then
  # Compatibility with installations created before the deployed-state file
  # existed. New deployments only advance DEPLOYED_ENV_FILE after health checks.
  previous_tag="$(read_release_tag "$RELEASE_ENV_FILE")"
fi

write_release_env() {
  local destination_file="$1"
  local tag="$2"
  local temporary_file
  temporary_file="$(mktemp "${destination_file}.XXXXXX")"
  printf 'FREECUT_IMAGE_TAG=%s\n' "$tag" > "$temporary_file"
  chmod 600 "$temporary_file"
  mv "$temporary_file" "$destination_file"
}

compose_arguments=()
if [[ -f .env ]]; then
  compose_arguments+=(--env-file .env)
fi
compose_arguments+=(--env-file "$RELEASE_ENV_FILE" --project-name freecut -f "$COMPOSE_FILE")

compose() {
  docker compose "${compose_arguments[@]}" "$@"
}

write_release_env "$RELEASE_ENV_FILE" "$RELEASE_TAG"

services=(web)
include_headless=false
if compose --profile automation ps --status running --services 2>/dev/null \
  | grep -Fxq headless; then
  include_headless=true
  services+=(headless)
fi

compose_deployment() {
  if [[ "$include_headless" == true ]]; then
    compose --profile automation "$@"
    return
  fi
  compose "$@"
}

deploy_current_tag() {
  local tag
  tag="$(sed -n 's/^FREECUT_IMAGE_TAG=//p' "$RELEASE_ENV_FILE" | tail -n 1)"
  log "pulling release ${tag} for: ${services[*]}"
  if ! compose_deployment pull "${services[@]}"; then
    return 1
  fi

  log "starting release ${tag} and waiting for health checks"
  compose_deployment up \
    -d \
    --no-build \
    --wait \
    --wait-timeout "$DEPLOY_TIMEOUT" \
    "${services[@]}"
}

if deploy_current_tag; then
  write_release_env "$DEPLOYED_ENV_FILE" "$RELEASE_TAG"
  log "release ${RELEASE_TAG} is healthy"
  compose_deployment ps "${services[@]}"
  exit 0
fi

log "release ${RELEASE_TAG} failed its deployment or health check"

if [[ -z "$previous_tag" || "$previous_tag" == "$RELEASE_TAG" ]]; then
  rm -f "$RELEASE_ENV_FILE"
  fail 'no previous immutable release tag is available for rollback'
fi

log "rolling back to ${previous_tag}"
write_release_env "$RELEASE_ENV_FILE" "$previous_tag"
if deploy_current_tag; then
  write_release_env "$DEPLOYED_ENV_FILE" "$previous_tag"
  log "rollback to ${previous_tag} completed"
  exit 1
fi

fail "rollback to ${previous_tag} also failed; inspect docker compose logs"
