#!/usr/bin/env node
// build-mirror — publishes a customer's own copy of the system on the vendor server.
//
// Why a copy exists at all: the shop's tablet WebView would not load the Vercel
// deployment, on a device whose Chrome loaded it without trouble. Rather than keep
// guessing at the difference, the app points at a copy served from the same host
// that the WebView demonstrably does load. Same code, same Supabase project, same
// data — only the origin differs.
//
// The copy is therefore NOT a second system. It is the same build, and the only
// thing that can go wrong with it is falling behind — which is invisible from the
// outside and shows up as "but on my computer it looks different". That is exactly
// why this runs as part of `npm run deploy` instead of being remembered.
//
//   node scripts/build-mirror.mjs            every client that has a mirror
//   node scripts/build-mirror.mjs hadas      one of them
//
// Each client's connection settings live in `.env.<code>` (gitignored — it holds
// the public anon key, which is public by design, but it is still per-customer
// configuration and does not belong in the repo).

import { execFileSync } from 'node:child_process'
import { existsSync, readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { dirname, resolve } from 'node:path'
import { listClients, loadClient } from './lib/clients.mjs'

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..')
const MIRROR_ROOT = process.env.MIRROR_DIR ?? '/home/runner/hadas-demo/html'

const step = (msg) => console.log(`\n\x1b[1m▸ ${msg}\x1b[0m`)
const info = (msg) => console.log(`  ${msg}`)
const warn = (msg) => console.log(`  \x1b[33m! ${msg}\x1b[0m`)

/** A client has a mirror when its site is served from this very server. */
function mirrorPath(client) {
  const m = String(client.siteUrl).match(/^https:\/\/[^/]+\/([^/]+)\/?$/)
  return m ? m[1] : null
}

const only = process.argv[2]
const codes = only ? [only] : listClients()
let built = 0

for (const code of codes) {
  const client = loadClient(code)
  const sub = mirrorPath(client)
  if (!sub) continue

  const envFile = resolve(ROOT, `.env.${code}`)
  if (!existsSync(envFile)) {
    warn(`${code}: ${`.env.${code}`} is missing — cannot build the mirror without its connection settings`)
    continue
  }

  step(`mirror — ${client.label} → ${client.siteUrl}`)

  // Read the per-customer settings rather than inheriting whatever .env happens
  // to say: the repo's own .env points at the DEV project, and a mirror built
  // against it would look right and show the wrong data.
  const env = { ...process.env }
  for (const line of readFileSync(envFile, 'utf8').split('\n')) {
    const m = line.match(/^\s*([A-Z0-9_]+)\s*=\s*(.*)\s*$/)
    if (m) env[m[1]] = m[2].replace(/^["']|["']$/g, '')
  }

  const out = `dist-${code}`
  execFileSync('npx', ['vite', 'build', `--base=/${sub}/`, '--outDir', out], { cwd: ROOT, env, stdio: 'inherit' })
  execFileSync('rsync', ['-a', '--delete', `${ROOT}/${out}/`, `${MIRROR_ROOT}/${sub}/`], { stdio: 'inherit' })

  info(`${client.siteUrl} updated`)
  built += 1
}

if (built === 0 && !only) info('no client is mirrored on this server — nothing to do')
