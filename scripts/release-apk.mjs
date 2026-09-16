#!/usr/bin/env node
// build:apk — builds the Android app the shop's tablets install.
//
// The APK is a shell: it holds `shell/` and nothing else, and every tablet running
// it loads the customer's live site. So this script is NOT how a code change reaches
// the shop — `npm run deploy` is. Building an APK is only needed when the shell
// itself changes: the store gate, the offline page, the icon, permissions, or the
// Capacitor version.
//
//   npm run build:apk                 the GENERIC app — one APK, store gate asks for a code
//   npm run build:apk -- --client=hadas   that customer's own app: their icon, their
//                                     name, their address baked in, no gate
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
import { loadClient, bumpClientVersion, listClients } from './lib/clients.mjs'

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..')
const GRADLE_FILE = resolve(ROOT, 'android/app/build.gradle')
const KEY_PROPS = resolve(ROOT, 'android/key.properties')
const LOCAL_PROPS = resolve(ROOT, 'android/local.properties')

const args = process.argv.slice(2)
const clientCode = args.find((a) => a.startsWith('--client='))?.split('=')[1] ?? null
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

// Built per call, not once: a branded build sets the customer's identity into
// process.env part-way through, and `cap sync` reads it from there. A snapshot
// taken at startup would hand every child process the generic identity — which
// produces a "branded" APK named InControl, with nothing to show anything went
// wrong.
const run = (cmd, cmdArgs, cwd = ROOT) =>
  execFileSync(cmd, cmdArgs, {
    cwd,
    env: { ...process.env, ANDROID_HOME, ANDROID_SDK_ROOT: ANDROID_HOME, JAVA_HOME },
    stdio: 'inherit',
  })

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

// ── identity ─────────────────────────────────────────────────────────────────
// The Android files in git hold the GENERIC identity. A branded build rewrites
// them, builds, and puts them back — so a release never leaves the repo dirty and
// the next build starts from the same known state.
const STRINGS = resolve(ROOT, 'android/app/src/main/res/values/strings.xml')
const ASSETS_DIR = resolve(ROOT, 'assets')

// Restore from git, not from a snapshot taken at the start of the run: a build
// that crashed after branding would otherwise leave branded files behind, and the
// NEXT build would faithfully "restore" them. Git is the only copy that is
// reliably the generic identity.
function restoreIdentity() {
  run('git', [
    'checkout', '--',
    'android/app/src/main/res/values/strings.xml',
    'android/app/build.gradle',
    'android/app/src/main/res',
    'assets',
  ])
}

function applyClient(client, version) {
  // Written AFTER `cap sync`, which is the only order that survives: sync rewrites
  // parts of this file from capacitor.config.ts, and the app name is not one of
  // the parts it maintains — it keeps whatever `cap add` first put there. Verified
  // by reading the built APK, not by trusting the build to have honoured it.
  const strings = readFileSync(STRINGS, 'utf8')
    .replace(/<string name="app_name">[^<]*<\/string>/, `<string name="app_name">${client.app.name}</string>`)
    .replace(/<string name="title_activity_main">[^<]*<\/string>/, `<string name="title_activity_main">${client.app.name}</string>`)
    .replace(/<string name="store_url">[^<]*<\/string>/, `<string name="store_url">${client.siteUrl}</string>`)
  writeFileSync(STRINGS, strings)

  // applicationId is the customer's identity to Android itself. The Java package
  // deliberately stays com.ctrlplusf.incontrol — Android separates the two, and
  // renaming packages per customer would fork the native code for nothing.
  let gradle = readFileSync(GRADLE_FILE, 'utf8')
    .replace(/applicationId "[^"]*"/, `applicationId "${client.app.applicationId}"`)
    .replace(/versionCode\s+\d+/, `versionCode ${version.code}`)
    .replace(/versionName\s+"[^"]+"/, `versionName "${version.name}"`)
  writeFileSync(GRADLE_FILE, gradle)

  // Icons, if this customer brought their own. @capacitor/assets reads fixed
  // names from assets/, so the client's files are copied over them for the build
  // and the generic ones are restored afterwards.
  const icons = [
    [client.app.icon, 'icon-only.png'],
    [client.app.iconForeground, 'icon-foreground.png'],
    [client.app.iconBackground, 'icon-background.png'],
  ].filter(([from]) => from && existsSync(resolve(ROOT, from)))

  if (icons.length === 0) {
    warn(`${client.code}: no icon files found — keeping the InControl icon`)
    return null
  }

  for (const [from, to] of icons) writeFileSync(resolve(ASSETS_DIR, to), readFileSync(resolve(ROOT, from)))
  run('npx', ['capacitor-assets', 'generate', '--android'])
  return true
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
let client = null
let savedIdentity = null
let savedIcons = null

if (clientCode) {
  client = loadClient(clientCode)
  step(`branded build — ${client.label} (${client.code})`)
  info(`${client.app.applicationId} → ${client.siteUrl}`)
  // The shell is told who it belongs to, so it skips the store gate entirely.
  process.env.INCONTROL_CLIENT_JSON = JSON.stringify({
    code: client.code, label: client.label, siteUrl: client.siteUrl,
  })
  // Read by capacitor.config.ts during `cap sync`, which is what actually writes
  // the app name and package into the Android project.
  process.env.INCONTROL_APP_ID = client.app.applicationId
  process.env.INCONTROL_APP_NAME = client.app.name
} else {
  info(`generic build — the store gate asks for a code (clients available: ${listClients().join(', ') || 'none'})`)
}

step('building the shell')
run('node', ['scripts/build-shell.mjs'])

step('syncing to the Android project')
run('npx', ['cap', 'sync', 'android'])

if (client) {
  const version = noBump || wantDebug
    ? client.version
    : bumpClientVersion(client.code)
  client.version = version
  step('applying the customer identity')
  info(`${client.app.name} ${version.name} (versionCode ${version.code})`)
  savedIdentity = true
  savedIcons = applyClient(client, version)
} else if (noBump || wantDebug) {
  info('version unchanged (--no-bump / --debug)')
} else {
  step('raising the version')
  const { nextCode, nextName } = bumpVersion()
  info(`${nextName} (versionCode ${nextCode})`)
}

const task = wantDebug ? 'assembleDebug' : wantAab ? 'bundleRelease' : 'assembleRelease'
step(`gradle ${task}`)
try {
  run('./gradlew', [task, '--no-daemon'], resolve(ROOT, 'android'))
} finally {
  // Whether it built or blew up, the repo goes back to the generic identity.
  if (savedIdentity) restoreIdentity()
}

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

  const name = client ? `${client.code}.apk` : 'incontrol.apk'
  const target = `${url}/storage/v1/object/app-releases/${name}`
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
  return `${url}/storage/v1/object/public/app-releases/${name}`
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
  // Read from the client file, not from gradle: gradle has already been put back
  // to the generic identity by the time this runs.
  const code = client ? client.version.code : Number(readFileSync(GRADLE_FILE, 'utf8').match(/versionCode\s+(\d+)/)?.[1] ?? 0)
  const name = client ? client.version.name : readFileSync(GRADLE_FILE, 'utf8').match(/versionName\s+"([^"]+)"/)?.[1] ?? '0.0.0'
  // Mirrors checkForUpdate() in src/lib/native.ts exactly: the app looks up its
  // manifest by the suffix of its own applicationId, so a build that keeps the
  // generic id writes the generic manifest. Two places, one rule — if one moves,
  // the app checks a file nobody writes.
  const suffix = client ? client.app.applicationId.split('.').pop() : null
  const file = resolve(ROOT, suffix && suffix !== 'incontrol'
    ? `public/app/app-version.${suffix}.json`
    : 'public/app/app-version.json')
  const previous = existsSync(file) ? JSON.parse(readFileSync(file, 'utf8')) : {}
  writeFileSync(file, JSON.stringify({ ...previous, versionCode: code, versionName: name, url: link }, null, 2) + '\n')
  info(`${file.replace(ROOT + '/', '')} → ${name} (versionCode ${code})`)
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
