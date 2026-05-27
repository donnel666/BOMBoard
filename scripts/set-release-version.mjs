import { readFileSync, writeFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

const repoRoot = fileURLToPath(new URL('../', import.meta.url))
const version = resolveReleaseVersion()

const packageJsonPaths = [
  'package.json',
  'apps/web/package.json',
  'apps/desktop-electron/package.json',
  'apps/desktop-tauri/package.json',
]

for (const relativePath of packageJsonPaths) {
  updateJsonVersion(relativePath, version)
}

updateJsonVersion('apps/desktop-tauri/src-tauri/tauri.conf.json', version)
updateCargoVersion('apps/desktop-tauri/src-tauri/Cargo.toml', version)

console.log(`BOMBoard release version set to ${version}`)

function resolveReleaseVersion() {
  const raw =
    process.argv[2]
    ?? process.env.BOMBOARD_VERSION
    ?? process.env.VITE_BOMBOARD_VERSION
    ?? process.env.GITHUB_REF_NAME
    ?? readJson('package.json').version

  if (typeof raw !== 'string') {
    throw new Error('Unable to resolve release version.')
  }

  const normalized = raw.trim().replace(/^refs\/tags\//, '').replace(/^v/i, '')
  if (!/^\d+\.\d+\.\d+(?:-[0-9A-Za-z.-]+)?(?:\+[0-9A-Za-z.-]+)?$/.test(normalized)) {
    throw new Error(`Invalid release version: ${raw}`)
  }

  return normalized
}

function updateJsonVersion(relativePath, nextVersion) {
  const absolutePath = resolve(repoRoot, relativePath)
  const source = readFileSync(absolutePath, 'utf8')
  const json = JSON.parse(source)
  json.version = nextVersion
  writeIfChanged(absolutePath, `${JSON.stringify(json, null, 2)}\n`)
}

function updateCargoVersion(relativePath, nextVersion) {
  const absolutePath = resolve(repoRoot, relativePath)
  const source = readFileSync(absolutePath, 'utf8')
  const packageVersionPattern = /^version = ".+"$/m
  if (!packageVersionPattern.test(source)) {
    throw new Error(`Could not update Cargo package version in ${relativePath}`)
  }
  const updated = source.replace(packageVersionPattern, `version = "${nextVersion}"`)
  writeIfChanged(absolutePath, updated)
}

function readJson(relativePath) {
  return JSON.parse(readFileSync(resolve(repoRoot, relativePath), 'utf8'))
}

function writeIfChanged(path, nextSource) {
  const currentSource = readFileSync(path, 'utf8')
  if (currentSource === nextSource) return
  writeFileSync(path, nextSource)
}
