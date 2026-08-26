#!/usr/bin/env node
// deploy — ships one change to BOTH places the system lives.
//
// The system has two deployment targets, and they show the same product to
// different people:
//
//   • vercel — the real system the business runs on. Real Supabase, real invoices,
//     behind a login. Deploys by pushing to `main`, which Vercel builds itself.
//   • demo   — https://incontrol.ctrlplusf.com, a static build on fictitious data
//     that anyone with the password can open. Lives on this Contabo server as an
//     nginx container behind the existing Coolify/Traefik proxy.
//
// A change that reaches only one of them is the failure this script exists to
// prevent: a demo that shows a system the business no longer uses, or a business
// running on code nobody can demonstrate. `npm run deploy` does both, in one go,
// and reports honestly on each.
//
//   npm run deploy                 both targets
//   npm run deploy:demo            demo only
//   npm run deploy:vercel          vercel only (push) only
//   npm run deploy -- --allow-dirty   skip the clean-tree check
//   npm run deploy -- --dry-run       print what would happen, change nothing
//
// See docs/08-DEMO-DEPLOYMENT.md.

import { execFileSync, execSync } from 'node:child_process'
import { existsSync, mkdirSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { dirname, resolve } from 'node:path'

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..')

// ── Where the demo lives on this host ────────────────────────────────────────
// The demo is served straight out of a bind-mounted directory (the same pattern as
// the other sites on this server), so publishing is a file sync — no container
// rebuild, no restart, no downtime.
const DEMO_DIR = process.env.DEMO_DIR ?? '/home/runner/hadas-demo'
const DEMO_HTML = `${DEMO_DIR}/html`
const DEMO_COMPOSE = `${DEMO_DIR}/docker-compose.yml`
const DEMO_URL = process.env.DEMO_URL ?? 'https://incontrol.ctrlplusf.com'
const DEMO_CONTAINER = 'hadas-demo-web-1'

const args = process.argv.slice(2)
const only = args.find((a) => a.startsWith('--only='))?.split('=')[1] ?? 'all'
const allowDirty = args.includes('--allow-dirty')
const dryRun = args.includes('--dry-run')

const wantVercel = only === 'all' || only === 'vercel'
const wantDemo = only === 'all' || only === 'demo'

const results = []

// ── helpers ──────────────────────────────────────────────────────────────────
const step = (msg) => console.log(`\n\x1b[1m▸ ${msg}\x1b[0m`)
const info = (msg) => console.log(`  ${msg}`)
const warn = (msg) => console.log(`  \x1b[33m! ${msg}\x1b[0m`)

function run(cmd, opts = {}) {
  if (dryRun) {
    info(`[dry-run] ${cmd}`)
    return ''
  }
  return execSync(cmd, { cwd: ROOT, stdio: 'inherit', ...opts })
}

function capture(cmd) {
  return execSync(cmd, { cwd: ROOT, encoding: 'utf8' }).trim()
}

function die(msg) {
  console.error(`\n\x1b[31m✗ ${msg}\x1b[0m\n`)
  process.exit(1)
}

// Talking to the docker daemon needs either membership in the `docker` group or
// sudo. Which one is true depends on the account and on whether the user has
// logged in again since being added to the group, so probe instead of assuming —
// a deploy failing on a permission detail is a bad way to find out.
function dockerCmd() {
  try {
    execSync('docker info', { stdio: 'ignore' })
    return 'docker'
  } catch {
    try {
      execSync('sudo -n docker info', { stdio: 'ignore' })
      return 'sudo -n docker'
    } catch {
      die(
        'אין גישה ל-docker: לא ישירות ולא דרך sudo.\n' +
          '  הריצי:  sudo usermod -aG docker $USER   ואז התחברי מחדש.',
      )
    }
  }
}

// ── gate: the tree must be clean and must typecheck ──────────────────────────
// Deploying a dirty tree publishes something that exists on no branch — the next
// person to look at git cannot tell what is actually live.
step('בדיקות שער')

const branch = capture('git rev-parse --abbrev-ref HEAD')
info(`ענף: ${branch}`)

const dirty = capture('git status --porcelain')
if (dirty && !allowDirty) {
  die(
    'יש שינויים שלא נשמרו ב-git. עשי commit, או הריצי עם --allow-dirty אם את יודעת מה את עושה.\n' +
      dirty.split('\n').slice(0, 10).map((l) => '    ' + l).join('\n'),
  )
}
if (dirty) warn('עץ לא נקי — ממשיכים בגלל --allow-dirty')

// check-twins + tsc run inside each build, but running them here fails fast,
// before anything is pushed anywhere.
try {
  execFileSync('node', ['scripts/check-twins.mjs'], { cwd: ROOT, stdio: 'inherit' })
} catch {
  die('check-twins נכשל — קבצי התאומים נפרדו. תקני לפני פריסה.')
}

// ── target: vercel ───────────────────────────────────────────────────────────
if (wantVercel) {
  step('יעד 1/2 — ורסל (המערכת האמיתית)')
  run(`git push origin ${branch}`)

  if (branch === 'main') {
    info('נדחף ל-main — ורסל בונה את הפרודקשן עכשיו.')
    results.push(['ורסל', `נדחף ל-main → בנייה אוטומטית`])
  } else {
    warn(`נדחף ל-${branch}, שאינו ענף הפרודקשן.`)
    warn('הפרודקשן בורסל יתעדכן רק אחרי מיזוג ל-main.')
    results.push(['ורסל', `נדחף ל-${branch} — טרם בפרודקשן (צריך מיזוג ל-main)`])
  }
}

// ── target: demo ─────────────────────────────────────────────────────────────
if (wantDemo) {
  step('יעד 2/2 — הדגמה (incontrol.ctrlplusf.com)')

  if (!existsSync(DEMO_COMPOSE) && !dryRun) {
    die(
      `לא נמצא ${DEMO_COMPOSE}.\n` +
        '  מריצים את הסקריפט על שרת אחר? הפריסה של ההדגמה עובדת רק מהשרת שמארח אותה.\n' +
        '  ההקמה מתועדת ב-docs/08-DEMO-DEPLOYMENT.md.',
    )
  }

  info('בונים את חבילת ההדגמה (.env.demo → dist-demo)')
  run('npm run build:demo')

  if (!dryRun) mkdirSync(DEMO_HTML, { recursive: true })

  info(`מסנכרנים ל-${DEMO_HTML}`)
  // --delete so a file removed from the app disappears from the live demo too;
  // without it the demo silently accumulates assets that no longer exist.
  run(`rsync -a --delete ${ROOT}/dist-demo/ ${DEMO_HTML}/`)

  // The container serves the mounted directory, so it only needs starting the
  // first time (or after the compose file changes). `up -d` is a no-op otherwise.
  info('מוודאים שהקונטיינר רץ')
  run(`${dockerCmd()} compose -f ${DEMO_COMPOSE} up -d`, { cwd: DEMO_DIR })

  if (!dryRun) {
    try {
      const code = capture(
        `curl -s -o /dev/null -w '%{http_code}' --max-time 20 ${DEMO_URL}`,
      )
      if (code === '200') {
        info(`בדיקת חיים: ${DEMO_URL} → ${code}`)
        results.push(['הדגמה', `${DEMO_URL} → ${code}`])
      } else {
        warn(`בדיקת חיים החזירה ${code}. ייתכן שהתעודה עוד נרקמת — בדקי שוב בעוד דקה.`)
        results.push(['הדגמה', `${DEMO_URL} → ${code} (בדקי שוב)`])
      }
    } catch {
      warn('בדיקת החיים נכשלה. הקבצים סונכרנו — בדקי את הקונטיינר ואת Traefik.')
      results.push(['הדגמה', 'סונכרן, בדיקת החיים נכשלה'])
    }
  }
}

// ── summary ──────────────────────────────────────────────────────────────────
step('סיכום')
if (dryRun) info('(dry-run — שום דבר לא נפרס בפועל)')
for (const [target, outcome] of results) {
  console.log(`  ${target.padEnd(8)} ${outcome}`)
}
if (only !== 'all') {
  warn(`נפרס יעד אחד בלבד (--only=${only}). היעד השני נשאר על גרסה קודמת.`)
}
console.log()
