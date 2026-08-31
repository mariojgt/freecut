import assert from 'node:assert/strict'
import {
  chmodSync,
  copyFileSync,
  mkdtempSync,
  mkdirSync,
  readFileSync,
  writeFileSync,
} from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { spawnSync } from 'node:child_process'
import test from 'node:test'
import { fileURLToPath } from 'node:url'

const repositoryRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
const deployScript = path.join(repositoryRoot, 'docker', 'deploy-release.sh')

function createFixture({
  previousTag = '',
  requestedTag = previousTag,
  runningHeadless = false,
  failTag = '',
} = {}) {
  const root = mkdtempSync(path.join(os.tmpdir(), 'freecut-release-deploy-'))
  const binDirectory = path.join(root, 'bin')
  const dockerDirectory = path.join(root, 'docker')
  const commandLog = path.join(root, 'docker-commands.log')
  mkdirSync(binDirectory)
  mkdirSync(dockerDirectory)
  copyFileSync(deployScript, path.join(dockerDirectory, 'deploy-release.sh'))
  writeFileSync(path.join(root, 'docker-compose.production.yml'), 'services: {}\n')
  if (previousTag) {
    writeFileSync(path.join(root, '.freecut-release.env'), `FREECUT_IMAGE_TAG=${requestedTag}\n`)
    writeFileSync(path.join(root, '.freecut-deployed.env'), `FREECUT_IMAGE_TAG=${previousTag}\n`)
  }

  const fakeDocker = path.join(binDirectory, 'docker')
  writeFileSync(
    fakeDocker,
    `#!/usr/bin/env bash
set -eu
printf '%s\\n' "$*" >> "$FAKE_DOCKER_LOG"
if [[ "$*" == *" ps --status running --services"* ]]; then
  if [[ "\${FAKE_HEADLESS_RUNNING:-}" == "1" ]]; then printf 'headless\\n'; fi
  exit 0
fi
if [[ "$*" == *" up "* ]] && [[ -n "\${FAKE_FAIL_TAG:-}" ]] \\
  && grep -Fqx "FREECUT_IMAGE_TAG=\${FAKE_FAIL_TAG}" .freecut-release.env; then
  exit 1
fi
exit 0
`,
  )
  chmodSync(fakeDocker, 0o755)

  return {
    root,
    commandLog,
    env: {
      ...process.env,
      PATH: `${binDirectory}:${process.env.PATH ?? ''}`,
      FAKE_DOCKER_LOG: commandLog,
      FAKE_HEADLESS_RUNNING: runningHeadless ? '1' : '',
      FAKE_FAIL_TAG: failTag,
    },
  }
}

function deploy(fixture, tag) {
  return spawnSync('bash', ['docker/deploy-release.sh', tag], {
    cwd: fixture.root,
    env: fixture.env,
    encoding: 'utf8',
  })
}

test('rejects an invalid release tag before invoking Docker', () => {
  const fixture = createFixture()
  const result = deploy(fixture, 'release/unsafe')

  assert.notEqual(result.status, 0)
  assert.match(result.stderr, /valid Docker tag/)
})

test('deploys the web image and persists the immutable release tag', () => {
  const fixture = createFixture({ previousTag: 'v1.0.0' })
  const result = deploy(fixture, 'v1.1.0')

  assert.equal(result.status, 0, result.stderr)
  assert.equal(
    readFileSync(path.join(fixture.root, '.freecut-release.env'), 'utf8'),
    'FREECUT_IMAGE_TAG=v1.1.0\n',
  )
  assert.equal(
    readFileSync(path.join(fixture.root, '.freecut-deployed.env'), 'utf8'),
    'FREECUT_IMAGE_TAG=v1.1.0\n',
  )
  const commands = readFileSync(fixture.commandLog, 'utf8')
  assert.match(commands, /pull web/)
  assert.match(commands, /up -d --no-build --wait --wait-timeout 180 web/)
  assert.doesNotMatch(commands, /pull web headless/)
})

test('updates the headless image only when the automation service is already running', () => {
  const fixture = createFixture({ previousTag: 'v1.0.0', runningHeadless: true })
  const result = deploy(fixture, 'v1.1.0')

  assert.equal(result.status, 0, result.stderr)
  const commands = readFileSync(fixture.commandLog, 'utf8')
  assert.match(commands, /--profile automation pull web headless/)
  assert.match(commands, /--profile automation up .* web headless/)
})

test('restores the previous immutable tag when the new release is unhealthy', () => {
  const fixture = createFixture({ previousTag: 'v1.0.0', failTag: 'v1.1.0' })
  const result = deploy(fixture, 'v1.1.0')

  assert.notEqual(result.status, 0)
  assert.match(result.stdout, /rollback to v1\.0\.0 completed/)
  assert.equal(
    readFileSync(path.join(fixture.root, '.freecut-release.env'), 'utf8'),
    'FREECUT_IMAGE_TAG=v1.0.0\n',
  )
  assert.equal(
    readFileSync(path.join(fixture.root, '.freecut-deployed.env'), 'utf8'),
    'FREECUT_IMAGE_TAG=v1.0.0\n',
  )
  const commands = readFileSync(fixture.commandLog, 'utf8')
  assert.equal(commands.match(/ up /g)?.length, 2)
})

test('rolls back to the last healthy tag after an interrupted earlier attempt', () => {
  const fixture = createFixture({
    previousTag: 'v1.0.0',
    requestedTag: 'v1.1.0',
    failTag: 'v1.2.0',
  })
  const result = deploy(fixture, 'v1.2.0')

  assert.notEqual(result.status, 0)
  assert.match(result.stdout, /rollback to v1\.0\.0 completed/)
  assert.equal(
    readFileSync(path.join(fixture.root, '.freecut-deployed.env'), 'utf8'),
    'FREECUT_IMAGE_TAG=v1.0.0\n',
  )
})
