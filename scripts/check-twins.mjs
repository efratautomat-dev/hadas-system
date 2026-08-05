#!/usr/bin/env node
// check-twins — the mechanical half of "these two files are twins".
//
// Some rules must exist twice. The frontend is bundled by Vite out of `src/`, the
// edge functions run on Deno, and `.vercelignore` keeps `supabase/` out of the
// frontend build — so neither side can import the other, and a shared rule has to
// be COPIED. spec/06-RULES.md §9 records what happens when such a copy is trusted
// to a comment: one ledger rule lived in three places and one supplier reported
// three different balances (9000 / 7000 / 6000).
//
// This script is the guard that a comment cannot be. It compares each twin pair
// below its header comment block and exits non-zero the moment they diverge.
//
//   node scripts/check-twins.mjs        (also runs as part of `npm run lint`)

import { readFileSync } from 'node:fs'
import { createHash } from 'node:crypto'
import { fileURLToPath } from 'node:url'
import { dirname, resolve } from 'node:path'

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..')

/**
 * The header comment block is the ONLY part allowed to differ: each copy needs to
 * say where it lives and which runtime it serves. It is defined as the run of
 * lines at the very top of the file that are blank or are `//` line comments, up
 * to the first line that is neither. Everything from that line on — including
 * every `//` comment inside the code — is compared byte for byte, after
 * normalising CRLF line endings and trailing blank lines (editor noise, not
 * logic). Deliberately narrow: no whitespace collapsing, no comment stripping, no
 * token normalisation, because every one of those would let a real behavioural
 * change slip through looking like formatting.
 */
function body(path) {
  const lines = readFileSync(resolve(ROOT, path), 'utf8').replace(/\r\n/g, '\n').split('\n')
  let i = 0
  while (i < lines.length && (lines[i].trim() === '' || lines[i].trim().startsWith('//'))) i++
  return lines.slice(i).join('\n').replace(/\s+$/, '') + '\n'
}

const sha = s => createHash('sha256').update(s).digest('hex').slice(0, 16)

const PAIRS = [
  {
    a: 'src/lib/ledgerEngine.ts',
    b: 'supabase/functions/_shared/ledgerEngine.ts',
    what: 'the supplier ledger engine (balance = opening + Σ invoices − Σ payments)',
  },
  {
    a: 'src/lib/vat.ts',
    b: 'supabase/functions/_shared/vat.ts',
    what: 'Israeli VAT bands + amount completion',
    // KNOWN DIVERGENT — not a byte copy, and pretending otherwise would be the
    // lie this script exists to prevent. The VAT BANDS and the hole-filling
    // branch order do agree; the files differ in surface and in scope:
    //   · the UI copy adds `vatPercentFor`, `VAT_RATE_TODAY`, `EditedAmount` and
    //     the whole `edited` path (which field the user just typed) — ingest has
    //     no user typing anything, so its copy stops at hole-filling;
    //   · `completeAmounts` therefore has a different signature on each side
    //     (`(input, { rate, edited })` vs `(input, rate)`);
    //   · the UI copy accepts a `Date`, the Deno copy only an ISO string;
    //   · Deno style: semicolons, `unknown` instead of the local `AmountLike`.
    // Widening the comparison rule until this passed would have hidden the very
    // drift it is meant to catch. So the divergence is PINNED instead: the exact
    // content of both files is fixed by digest, and touching either one fails
    // this check until a human re-reads both sides and re-pins on purpose.
    divergent: {
      reason: 'UI copy carries the `edited` path and display helpers that ingest has no use for',
      pins: { a: '3e6be3b1783da729', b: '0d3f18487860be6d' },
    },
  },
]

let failed = 0
const say = (...m) => console.log(...m)

for (const pair of PAIRS) {
  const [ba, bb] = [body(pair.a), body(pair.b)]

  if (!pair.divergent) {
    if (ba === bb) {
      say(`  ok        ${pair.a}  ==  ${pair.b}`)
      continue
    }
    failed++
    const la = ba.split('\n'), lb = bb.split('\n')
    let n = 0
    while (n < la.length && n < lb.length && la[n] === lb[n]) n++
    say('')
    say(`  DIVERGED  ${pair.what}`)
    say(`            ${pair.a}`)
    say(`            ${pair.b}`)
    say(`            first difference at body line ${n + 1}:`)
    say(`              ${pair.a}: ${JSON.stringify(la[n] ?? '<end of file>')}`)
    say(`              ${pair.b}: ${JSON.stringify(lb[n] ?? '<end of file>')}`)
    say('            These two files are twins: the same rule, copied because Vite and')
    say('            Deno cannot import across the boundary. Apply the change to BOTH,')
    say('            byte for byte below the header comment.')
    say('')
    continue
  }

  const [ha, hb] = [sha(ba), sha(bb)]
  const { pins, reason } = pair.divergent
  if (ha === pins.a && hb === pins.b) {
    say(`  pinned    ${pair.a}  !=  ${pair.b}  (known divergence: ${reason})`)
    continue
  }
  failed++
  say('')
  say(`  UNPINNED  ${pair.what}`)
  say(`            ${pair.a}          ${ha}  (pinned ${pins.a})`)
  say(`            ${pair.b}  ${hb}  (pinned ${pins.b})`)
  say(`            This pair is recorded as KNOWN DIVERGENT (${reason}) and its`)
  say('            content is pinned, because a divergent twin cannot be diffed. One')
  say('            side just changed. Read both files, make the matching change on the')
  say('            other side, then update the pins in scripts/check-twins.mjs to the')
  say('            digests printed above. If the two are now identical, delete the')
  say('            `divergent` block instead and let them be compared properly.')
  say('')
}

if (failed) {
  say(`check-twins: ${failed} twin pair(s) out of sync.`)
  process.exit(1)
}
say(`check-twins: ${PAIRS.length} twin pair(s) in order.`)
