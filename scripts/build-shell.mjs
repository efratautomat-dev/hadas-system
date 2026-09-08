#!/usr/bin/env node
// build:shell — copies `shell/` to `dist-shell/`, which is what the APK ships.
//
// There is no bundler here on purpose. The shell talks to Capacitor through the
// runtime global (`window.Capacitor.Plugins.*`) rather than through npm imports,
// so it has no dependencies to resolve and nothing to transpile. A copy is the
// honest build step, and it keeps the one page inside the APK readable by anyone
// who unzips it.
//
// The system itself is NOT in here — see capacitor.config.ts for why.

import { cpSync, existsSync, rmSync, readdirSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { dirname, resolve } from 'node:path'

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..')
const SRC = resolve(ROOT, 'shell')
const OUT = resolve(ROOT, 'dist-shell')

if (!existsSync(SRC)) {
  console.error('✗ shell/ is missing — nothing to build')
  process.exit(1)
}

// index.html and offline.html are both load-bearing: the first is the store gate,
// the second is what capacitor.config.ts points `server.errorPath` at. A build that
// silently produced only one of them would fail on the tablet, not here.
for (const required of ['index.html', 'offline.html', 'stores.json']) {
  if (!existsSync(resolve(SRC, required))) {
    console.error(`✗ shell/${required} is missing`)
    process.exit(1)
  }
}

rmSync(OUT, { recursive: true, force: true })
cpSync(SRC, OUT, { recursive: true })

console.log(`✓ dist-shell — ${readdirSync(OUT).join(', ')}`)
