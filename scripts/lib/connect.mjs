// Shared connection setup for the read-only report scripts.
//
// Extracted because three scripts had three copies of it, and one of those copies
// had a precedence bug that cost a live debugging session: the repo's `.env`
// carries VITE_SUPABASE_ANON_KEY for the TEST project, the resolution order
// checked that BEFORE the SUPABASE_ANON_KEY passed on the command line, and so a
// run explicitly aimed at PRODUCTION quietly used the TEST key. The server
// answered "Invalid API key", which says nothing about what actually happened.
//
// Two rules come out of that and are enforced here:
//   1. What the caller passes on the command line WINS over anything in `.env`.
//   2. The project in the URL and the project in the key must MATCH, and a
//      mismatch is reported as itself rather than as an authentication failure.

import { createClient } from '@supabase/supabase-js'
import { existsSync } from 'node:fs'
import { resolve } from 'node:path'

/** The `ref` claim inside a legacy Supabase JWT — i.e. which project it belongs to. */
function keyProjectRef(key) {
  const parts = String(key).split('.')
  if (parts.length !== 3) return null   // new-style sb_publishable_… keys carry no claims
  try {
    return JSON.parse(Buffer.from(parts[1], 'base64url').toString('utf8'))?.ref ?? null
  } catch { return null }
}

/** Service-role / secret keys bypass RLS and can write. Read-only reports must not hold one. */
function isPrivilegedKey(k) {
  if (/^sb_secret_/.test(k)) return true
  const parts = String(k).split('.')
  if (parts.length !== 3) return false
  try {
    const p = JSON.parse(Buffer.from(parts[1], 'base64url').toString('utf8'))
    return p?.role === 'service_role' || p?.role === 'supabase_admin'
  } catch { return false }
}

export function urlProjectRef(url) {
  return (String(url).match(/https:\/\/([a-z0-9]+)\.supabase\.co/) || [])[1] || String(url)
}

/**
 * Resolve credentials, verify them against each other, and sign in.
 * @param {string} root  repo root
 * @param {string} name  script name, for error messages
 */
export async function connect(root, name) {
  const die = msg => { console.error(`${name}: ${msg}`); process.exit(1) }

  // Snapshot what the CALLER supplied before `.env` can add anything, so the
  // command line always wins over the file.
  const shell = { ...process.env }
  if (existsSync(resolve(root, '.env'))) {
    try { process.loadEnvFile(resolve(root, '.env')) } catch { /* shell env only */ }
  }
  const pick = (...names) => {
    for (const n of names) if (shell[n]) return { value: shell[n], from: 'the command line' }
    for (const n of names) if (process.env[n]) return { value: process.env[n], from: '.env' }
    return { value: '', from: null }
  }

  const u = pick('SUPABASE_URL', 'VITE_SUPABASE_URL')
  const k = pick('SUPABASE_ANON_KEY', 'VITE_SUPABASE_ANON_KEY')

  if (!u.value) die('no project URL. Set SUPABASE_URL (or VITE_SUPABASE_URL).')
  if (!k.value) die('no anon key. Set SUPABASE_ANON_KEY (or VITE_SUPABASE_ANON_KEY).')

  if (isPrivilegedKey(k.value)) {
    die('that is a SERVICE-ROLE key, and these reports refuse to run with one.\n' +
        '  It bypasses RLS and carries write authority; a read-only report must not\n' +
        '  be able to do more than it needs. Use the anon / publishable key.')
  }

  const urlRef = urlProjectRef(u.value)
  const keyRef = keyProjectRef(k.value)
  if (keyRef && keyRef !== urlRef) {
    die(
      `the URL and the key belong to DIFFERENT projects.\n` +
      `    URL points at : ${urlRef}   (from ${u.from})\n` +
      `    key belongs to: ${keyRef}   (from ${k.from})\n` +
      '  Nothing can authenticate across two projects, and the server reports this\n' +
      '  as "Invalid API key", which hides what is really wrong. Supply the key\n' +
      '  belonging to the project you are aiming at.\n' +
      "  Note the repo's .env holds the TEST project's key — pass the production\n" +
      '  key explicitly on the command line when you mean production.',
    )
  }

  const supabase = createClient(u.value, k.value, {
    auth: { persistSession: false, autoRefreshToken: false },
  })

  const email = shell.HADAS_REPORT_EMAIL || process.env.HADAS_REPORT_EMAIL || ''
  const password = shell.HADAS_REPORT_PASSWORD || process.env.HADAS_REPORT_PASSWORD || ''
  if (email && password) {
    const { error } = await supabase.auth.signInWithPassword({ email, password })
    if (error) {
      die(`sign-in failed for ${email}: ${error.message}\n` +
          `  Project: ${urlRef}. TEST and PRODUCTION are separate projects with separate\n` +
          '  user lists — a password created on one does not exist on the other.')
    }
  }

  const read = async (table, columns) => {
    const { data, error } = await supabase.from(table).select(columns)
    if (error) {
      const denied = /permission denied|row-level security|RLS/i.test(error.message)
      die(`read of ${table} failed: ${error.message}` +
          (denied && !(email && password)
            ? '\n  This is RLS, not a bug: the anon key alone cannot read this table.\n' +
              '  Set HADAS_REPORT_EMAIL / HADAS_REPORT_PASSWORD to a MANAGER login.'
            : ''))
    }
    return data ?? []
  }

  return { supabase, read, die, projectRef: urlRef, signedIn: Boolean(email && password), email }
}
