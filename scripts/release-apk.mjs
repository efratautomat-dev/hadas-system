#!/usr/bin/env node
// build:apk — builds the Android app the shop's tablets install.
//
// The APK is a shell: it holds `shell/` and nothing else, and every tablet running
// it loads the customer's live site. So this script is NOT how a code change reaches
// the shop — `npm run deploy` is. Building an APK is only needed when the shell
// itself changes: the store gate, the offline page, the icon, permissions, or the
// Capacitor version.
//
//   npm run build:apk                 signed release APK (needs android/key.properties)
//   npm run build:aab                 Play Store bundle — stage 2, not used today
//   npm run build:apk -- --debug      unsigned debug build, for a quick device check
//   npm run build:apk -- --no-bump    build without moving the version
//
// Android refuses to install a new build over an old one unless versionCode went up,
// so bumping is the default and skipping it is the deliberate case.

import { execFileSync } from 'node:child_process'
import { existsSync, readFileSync, writeFileSync, statSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { dirname, resolve } from 'node:path'

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..')
const GRADLE_FILE = resolve(ROOT, 'android/app/build.gradle')
const KEY_PROPS = resolve(ROOT, 'android/key.properties')
const LOCAL_PROPS = resolve(ROOT, 'android/local.properties')

const args = process.argv.slice(2)
const wantAab = args.includes('--aab')
const wantDebug = args.includes('--debug')
const noBump = args.includes('--no-bump')

const step = (msg) => console.log(`\n\x1b[1m▸ ${msg}\x1b[0m`)
const info = (msg) => console.log(`  ${msg}`)
const warn = (msg) => console.log(`  \x1b[33m! ${msg}\x1b[0m`)
const fail = (msg) => { console.error(`\n\x1b[31m✗ ${msg}\x1b[0m\n`); process.exit(1) }

// ── environment ──────────────────────────────────────────────────────────────
// Kept here rather than in a shell profile so the build is reproducible on any
// machine that has the SDK, and so a missing piece says which piece.
const ANDROID_HOME = process.env.ANDROID_HOME ?? process.env.ANDROID_SDK_ROOT ?? '/home/runner/android-sdk'
const JAVA_HOME = process.env.JAVA_HOME ?? '/usr/lib/jvm/java-21-openjdk-amd64'

if (!existsSync(ANDROID_HOME)) fail(`Android SDK not found at ${ANDROID_HOME} — set ANDROID_HOME`)
if (!existsSync(JAVA_HOME)) fail(`JDK not found at ${JAVA_HOME} — set JAVA_HOME (Capacitor 8 needs JDK 21)`)
if (!existsSync(LOCAL_PROPS)) writeFileSync(LOCAL_PROPS, `sdk.dir=${ANDROID_HOME}\n`)

const env = { ...process.env, ANDROID_HOME, ANDROID_SDK_ROOT: ANDROID_HOME, JAVA_HOME }
const run = (cmd, cmdArgs, cwd = ROOT) =>
  execFileSync(cmd, cmdArgs, { cwd, env, stdio: 'inherit' })

// ── signing ──────────────────────────────────────────────────────────────────
// A release build without the keystore would produce an unsigned artifact that
// cannot be installed — better to stop here and say why than to hand over a file
// that fails on the tablet with "App not installed".
if (!wantDebug && !existsSync(KEY_PROPS)) {
  fail(
    'android/key.properties is missing — a release build cannot be signed.\n' +
    '  Create the keystore first (see docs/09-ANDROID-APP.md), or run with --debug.'
  )
}

// ── version ──────────────────────────────────────────────────────────────────
function bumpVersion() {
  let gradle = readFileSync(GRADLE_FILE, 'utf8')
  const code = gradle.match(/versionCode\s+(\d+)/)
  const name = gradle.match(/versionName\s+"([^"]+)"/)
  if (!code || !name) fail('could not read versionCode/versionName from android/app/build.gradle')

  const nextCode = parseInt(code[1], 10) + 1
  const parts = name[1].split('.').map((n) => parseInt(n, 10) || 0)
  while (parts.length < 3) parts.push(0)
  parts[2] += 1
  const nextName = parts.join('.')

  gradle = gradle
    .replace(/versionCode\s+\d+/, `versionCode ${nextCode}`)
    .replace(/versionName\s+"[^"]+"/, `versionName "${nextName}"`)
  writeFileSync(GRADLE_FILE, gradle)
  return { nextCode, nextName }
}

// ── build ────────────────────────────────────────────────────────────────────
step('building the shell')
run('node', ['scripts/build-shell.mjs'])

step('syncing to the Android project')
run('npx', ['cap', 'sync', 'android'])

if (noBump || wantDebug) {
  info('version unchanged (--no-bump / --debug)')
} else {
  step('raising the version')
  const { nextCode, nextName } = bumpVersion()
  info(`${nextName} (versionCode ${nextCode})`)
}

const task = wantDebug ? 'assembleDebug' : wantAab ? 'bundleRelease' : 'assembleRelease'
step(`gradle ${task}`)
run('./gradlew', [task, '--no-daemon'], resolve(ROOT, 'android'))

const out = wantDebug
  ? 'android/app/build/outputs/apk/debug/app-debug.apk'
  : wantAab
    ? 'android/app/build/outputs/bundle/release/app-release.aab'
    : 'android/app/build/outputs/apk/release/app-release.apk'

const abs = resolve(ROOT, out)
if (!existsSync(abs)) fail(`gradle finished but ${out} is missing`)

const mb = (statSync(abs).size / 1024 / 1024).toFixed(1)

// ── publish ──────────────────────────────────────────────────────────────────
// The download link lives in Supabase Storage, NOT on the demo server. A demo
// deploy syncs the built site and deletes whatever is not in it — which silently
// removed the APK (and, before it, the store registry) mid-testing. Storage is
// outside that blast radius, and the URL never changes, so a tablet installed a
// year ago is updated by replacing the file behind the same link.
async function publish(file) {
  const env = readEnv()
  const url = env.SUPABASE_URL
  const key = env.SUPABASE_SERVICE_ROLE_KEY
  if (!url || !key) {
    warn('SUPABASE_URL / SUPABASE_SERVICE_ROLE_KEY not set — skipping upload')
    return null
  }

  const target = `${url}/storage/v1/object/app-releases/incontrol.apk`
  const res = await fetch(target, {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${key}`,
      apikey: key,
      'Content-Type': 'application/vnd.android.package-archive',
      'x-upsert': 'true',
    },
    body: readFileSync(file),
  })
  if (!res.ok) {
    warn(`upload failed (${res.status}) — the previous version is still the live download`)
    return null
  }
  return `${url}/storage/v1/object/public/app-releases/incontrol.apk`
}

function readEnv() {
  const merged = { ...process.env }
  const envFile = resolve(ROOT, '.env')
  if (!existsSync(envFile)) return merged
  for (const line of readFileSync(envFile, 'utf8').split('\n')) {
    const m = line.match(/^\s*([A-Z0-9_]+)\s*=\s*(.*)\s*$/)
    if (m && !merged[m[1]]) merged[m[1]] = m[2].replace(/^["']|["']$/g, '')
  }
  return merged
}

// The tablets ask this file whether they are out of date. Written here, from the
// version that was actually built, so it can never drift from the APK behind the
// link — a manifest that promises a version nobody built is worse than none.
function writeVersionManifest(link) {
  const gradle = readFileSync(GRADLE_FILE, 'utf8')
  const code = Number(gradle.match(/versionCode\s+(\d+)/)?.[1] ?? 0)
  const name = gradle.match(/versionName\s+"([^"]+)"/)?.[1] ?? '0.0.0'
  const file = resolve(ROOT, 'public/app/app-version.json')
  const previous = existsSync(file) ? JSON.parse(readFileSync(file, 'utf8')) : {}
  writeFileSync(file, JSON.stringify({ ...previous, versionCode: code, versionName: name, url: link }, null, 2) + '\n')
  info(`public/app/app-version.json → ${name} (versionCode ${code})`)
  warn('deploy the site too, or the tablets will not learn about this build')
}

step('done')
info(`${out}  (${mb} MB)`)

if (wantDebug) {
  warn('debug build — for a device check only, not for the shop')
} else if (wantAab) {
  info('Play Store bundle — not uploaded; the store is the distribution channel for it')
} else {
  step('publishing the download link')
  const link = await publish(abs)
  if (link) {
    info(link)
    info('same link every time — a tablet updates by opening it again')
    writeVersionManifest(link)
  }
}
