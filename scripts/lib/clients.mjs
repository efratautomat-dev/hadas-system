// clients — the one place that knows a customer apart from any other.
//
// The system is NOT multi-tenant: every customer runs on their own server and
// their own database. What differs between them is an address and a name, and
// that is exactly what a file in `clients/` holds. Nothing else in the codebase
// branches on which customer it is, and nothing should start.
//
// A build with no client is the GENERIC app: one APK, the store gate asks for a
// code, and one file (public/app/stores.json) turns codes into addresses. A build
// with `--client=<code>` is that customer's own app: their icon, their name on
// the home screen, their address baked in, and no gate to pass.

import { existsSync, readFileSync, writeFileSync, readdirSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { dirname, resolve } from 'node:path'

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '../..')
const DIR = resolve(ROOT, 'clients')

export function clientPath(code) {
  return resolve(DIR, `${code}.json`)
}

export function listClients() {
  if (!existsSync(DIR)) return []
  return readdirSync(DIR)
    .filter((f) => f.endsWith('.json'))
    .map((f) => f.replace(/\.json$/, ''))
}

export function loadClient(code) {
  const file = clientPath(code)
  if (!existsSync(file)) {
    const known = listClients()
    throw new Error(
      `unknown client "${code}" — clients/${code}.json does not exist.\n` +
      (known.length ? `  known: ${known.join(', ')}` : '  no client files yet')
    )
  }
  const client = JSON.parse(readFileSync(file, 'utf8'))

  // A half-filled client file would produce an APK that installs and then cannot
  // reach anything, which is far more expensive to diagnose on a tablet in a shop
  // than to refuse here.
  for (const [path, value] of [
    ['siteUrl', client.siteUrl],
    ['app.applicationId', client.app?.applicationId],
    ['app.name', client.app?.name],
  ]) {
    if (!value) throw new Error(`clients/${code}.json is missing "${path}"`)
  }
  if (!/^https:\/\//.test(client.siteUrl)) {
    throw new Error(`clients/${code}.json: siteUrl must be https — got "${client.siteUrl}"`)
  }

  return client
}

/**
 * Moves this customer's version forward and writes it back to their file.
 *
 * Each customer has their OWN counter: Android compares versionCode against what
 * is installed on that device, so a shared sequence would either skip numbers or
 * — worse — hand two customers the same one.
 */
export function bumpClientVersion(code) {
  const file = clientPath(code)
  const client = JSON.parse(readFileSync(file, 'utf8'))
  const version = client.version ?? { code: 0, name: '1.0.0' }

  const parts = String(version.name ?? '1.0.0').split('.').map((n) => parseInt(n, 10) || 0)
  while (parts.length < 3) parts.push(0)
  parts[2] += 1

  client.version = { ...version, code: (version.code ?? 0) + 1, name: parts.join('.') }
  writeFileSync(file, JSON.stringify(client, null, 2) + '\n')
  return client.version
}
