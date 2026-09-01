import assert from 'node:assert/strict'
import {
  chmodSync,
  copyFileSync,
  existsSync,
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
const updateScript = path.join(repositoryRoot, 'docker', 'check-for-update.sh')

// One fixture centralizes all updater failure modes exercised by this integration suite.
// fallow-ignore-next-line complexity
function createFixture({
  currentTag = '',
  latestTag = 'v1.1.0',
  webRunning = false,
  invalidDeployAsset = false,
  newDeployFails = false,
  noRelease = false,
} = {}) {
  const root = mkdtempSync(path.join(os.tmpdir(), 'freecut-update-check-'))
  const binDirectory = path.join(root, 'bin')
  const dockerDirectory = path.join(root, 'docker')
  const deployLog = path.join(root, 'deploy.log')
  mkdirSync(binDirectory)
  mkdirSync(dockerDirectory)
  copyFileSync(updateScript, path.join(dockerDirectory, 'check-for-update.sh'))
  writeFileSync(path.join(root, 'docker-compose.production.yml'), 'services: {}\n')
  writeFileSync(
    path.join(dockerDirectory, 'deploy-release.sh'),
    '#!/usr/bin/env bash\nprintf "old:%s\\n" "$1" >> "$FAKE_DEPLOY_LOG"\n',
  )
  chmodSync(path.join(dockerDirectory, 'deploy-release.sh'), 0o755)
  if (currentTag) {
    writeFileSync(path.join(root, '.freecut-release.env'), `FREECUT_IMAGE_TAG=${currentTag}\n`)
    writeFileSync(path.join(root, '.freecut-deployed.env'), `FREECUT_IMAGE_TAG=${currentTag}\n`)
  }

  const fakeDocker = path.join(binDirectory, 'docker')
  writeFileSync(
    fakeDocker,
    `#!/usr/bin/env bash
set -eu
if [[ "\${1:-}" == "ps" ]]; then
  if [[ "\${FAKE_WEB_RUNNING:-}" == "1" ]]; then printf 'container-id\\n'; fi
  exit 0
fi
exit 0
`,
  )
  chmodSync(fakeDocker, 0o755)

  const fakeCurl = path.join(binDirectory, 'curl')
  writeFileSync(
    fakeCurl,
    `#!/usr/bin/env bash
set -eu
output=''
url=''
previous=''
for argument in "$@"; do
  if [[ "$previous" == "--output" ]]; then output="$argument"; fi
  previous="$argument"
  url="$argument"
done
if [[ "$url" == *"/releases/latest" ]]; then
  if [[ "\${FAKE_NO_RELEASE:-}" == "1" ]]; then exit 22; fi
  printf 'https://github.com/mariojgt/freecut/releases/tag/%s' "$FAKE_LATEST_TAG"
  exit 0
fi
if [[ "$url" == *"docker-compose.production.yml" ]]; then
  printf 'services: {}\\n' > "$output"
  exit 0
fi
if [[ "$url" == *"deploy-release.sh" ]]; then
  if [[ "\${FAKE_INVALID_DEPLOY_ASSET:-}" == "1" ]]; then
    printf 'if (\\n' > "$output"
  else
    printf '%s\\n' '#!/usr/bin/env bash' 'set -eu' \\
      'printf "new:%s\\n" "$1" >> "$FAKE_DEPLOY_LOG"' \\
      'if [[ "\${FAKE_NEW_DEPLOY_FAIL:-}" == "1" ]]; then exit 1; fi' \\
      'printf "FREECUT_IMAGE_TAG=%s\\n" "$1" > .freecut-release.env' \\
      'printf "FREECUT_IMAGE_TAG=%s\\n" "$1" > .freecut-deployed.env' > "$output"
  fi
  exit 0
fi
if [[ "$url" == *"check-for-update.sh" ]]; then
  printf '%s\\n' '#!/usr/bin/env bash' '# downloaded update checker' > "$output"
  exit 0
fi
if [[ "$url" == *"Caddyfile" ]]; then
  printf '%s\\n' '# downloaded caddyfile' > "$output"
  exit 0
fi
exit 1
`,
  )
  chmodSync(fakeCurl, 0o755)

  return {
    root,
    deployLog,
    env: {
      ...process.env,
      PATH: `${binDirectory}:${process.env.PATH ?? ''}`,
      FREECUT_INSTALL_DIR: root,
      FAKE_DEPLOY_LOG: deployLog,
      FAKE_LATEST_TAG: latestTag,
      FAKE_WEB_RUNNING: webRunning ? '1' : '',
      FAKE_INVALID_DEPLOY_ASSET: invalidDeployAsset ? '1' : '',
      FAKE_NEW_DEPLOY_FAIL: newDeployFails ? '1' : '',
      FAKE_NO_RELEASE: noRelease ? '1' : '',
    },
  }
}

function checkForUpdate(fixture) {
  return spawnSync('bash', ['docker/check-for-update.sh'], {
    cwd: fixture.root,
    env: fixture.env,
    encoding: 'utf8',
  })
}

test('does nothing when the latest release is already running', () => {
  const fixture = createFixture({ currentTag: 'v1.1.0', webRunning: true })
  const result = checkForUpdate(fixture)

  assert.equal(result.status, 0, result.stderr)
  assert.match(result.stdout, /v1\.1\.0 is already running/)
  assert.equal(existsSync(fixture.deployLog), false)
})

test('downloads deployment assets and deploys a newer stable release', () => {
  const fixture = createFixture({ currentTag: 'v1.0.0' })
  const result = checkForUpdate(fixture)

  assert.equal(result.status, 0, result.stderr)
  assert.equal(readFileSync(fixture.deployLog, 'utf8'), 'new:v1.1.0\n')
  assert.equal(
    readFileSync(path.join(fixture.root, '.freecut-release.env'), 'utf8'),
    'FREECUT_IMAGE_TAG=v1.1.0\n',
  )
  assert.equal(
    readFileSync(path.join(fixture.root, '.freecut-deployed.env'), 'utf8'),
    'FREECUT_IMAGE_TAG=v1.1.0\n',
  )
})

test('repairs a stopped container without downloading the same release again', () => {
  const fixture = createFixture({ currentTag: 'v1.1.0' })
  const result = checkForUpdate(fixture)

  assert.equal(result.status, 0, result.stderr)
  assert.match(result.stdout, /repairing it/)
  assert.equal(readFileSync(fixture.deployLog, 'utf8'), 'old:v1.1.0\n')
})

test('rejects an invalid latest tag', () => {
  const fixture = createFixture({ latestTag: 'unsafe/release' })
  const result = checkForUpdate(fixture)

  assert.notEqual(result.status, 0)
  assert.match(result.stderr, /invalid tag/)
  assert.equal(existsSync(fixture.deployLog), false)
})

test('does not replace installed deployment files when a download is invalid', () => {
  const fixture = createFixture({ currentTag: 'v1.0.0', invalidDeployAsset: true })
  const installedDeployScript = path.join(fixture.root, 'docker', 'deploy-release.sh')
  const originalContents = readFileSync(installedDeployScript, 'utf8')
  const result = checkForUpdate(fixture)

  assert.notEqual(result.status, 0)
  assert.equal(readFileSync(installedDeployScript, 'utf8'), originalContents)
  assert.equal(existsSync(fixture.deployLog), false)
})

test('restores installed deployment files when the new release fails', () => {
  const fixture = createFixture({ currentTag: 'v1.0.0', newDeployFails: true })
  const installedDeployScript = path.join(fixture.root, 'docker', 'deploy-release.sh')
  const installedCheckScript = path.join(fixture.root, 'docker', 'check-for-update.sh')
  const installedComposeFile = path.join(fixture.root, 'docker-compose.production.yml')
  const originalDeploy = readFileSync(installedDeployScript, 'utf8')
  const originalCheck = readFileSync(installedCheckScript, 'utf8')
  const originalCompose = readFileSync(installedComposeFile, 'utf8')
  const result = checkForUpdate(fixture)

  assert.notEqual(result.status, 0)
  assert.match(result.stderr, /restoring deployment files/)
  assert.equal(readFileSync(installedDeployScript, 'utf8'), originalDeploy)
  assert.equal(readFileSync(installedCheckScript, 'utf8'), originalCheck)
  assert.equal(readFileSync(installedComposeFile, 'utf8'), originalCompose)
})

test('reports when the repository has no public stable release', () => {
  const fixture = createFixture({ noRelease: true })
  const result = checkForUpdate(fixture)

  assert.notEqual(result.status, 0)
  assert.match(result.stderr, /could not read the latest public release/)
})
