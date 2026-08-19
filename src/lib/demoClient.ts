// ─── STUBBED SUPABASE CLIENT (demo mode only) ────────────────────────────────
// A drop-in replacement for the real supabase-js client that serves the
// fictitious demo dataset entirely from memory. It implements just enough of the
// query-builder, auth and storage surface that this app touches, so every hook
// and component keeps working with ZERO network calls to Supabase.
//
// Reads return seed rows; writes are accepted and resolved as no-ops. Auth
// reports the fictitious "דנה לוי" manager so the full UI renders with no login.

import { demoTables, demoUser } from '../data/demoData'

type Row = Record<string, unknown>

// A thenable query builder: every filter/order method returns the builder so
// chains like .select().eq().order() work, and awaiting it resolves to the
// Supabase-shaped { data, error }. single()/maybeSingle() resolve to one row.
function query(rows: Row[]) {
  // `.eq()` FILTERS, it does not just return the builder.
  //
  // Every other stub here is a no-op because the hooks that use them filter in
  // the client after the read. supplier_notes is the first query that relies on
  // the DATABASE to narrow rows — and with eq() ignored it showed one supplier's
  // notes under every supplier. A filter that silently matches everything is
  // worse than one that throws.
  let filtered = rows
  const eqFilter = (col: string, val: unknown) => {
    filtered = filtered.filter(r => {
      const v = (r as Record<string, unknown>)[col]
      // Loose compare: demo ids are strings, some callers pass numbers.
      return v === val || String(v ?? '') === String(val ?? '')
    })
    return builder
  }
  const thenable = () => Promise.resolve({ data: filtered, error: null })
  const builder: Record<string, unknown> = {
    select: () => builder,
    order: () => builder,
    eq: (col: string, val: unknown) => eqFilter(col, val),
    neq: () => builder,
    is: () => builder,
    in: () => builder,
    gt: () => builder,
    gte: () => builder,
    lt: () => builder,
    lte: () => builder,
    like: () => builder,
    ilike: () => builder,
    or: () => builder,
    not: () => builder,
    contains: () => builder,
    range: () => builder,
    limit: () => builder,
    single: () => Promise.resolve({ data: filtered[0] ?? null, error: null }),
    maybeSingle: () => Promise.resolve({ data: filtered[0] ?? null, error: null }),
    insert: () => Promise.resolve({ data: filtered[0] ?? null, error: null }),
    update: () => builder,
    upsert: () => Promise.resolve({ data: null, error: null }),
    delete: () => builder,
    then: (onF: unknown, onR: unknown) =>
      thenable().then(onF as never, onR as never),
    catch: (onR: unknown) => thenable().catch(onR as never),
    finally: (onF: unknown) => thenable().finally(onF as never),
  }
  return builder
}

export function createDemoClient() {
  return {
    // Alias role-aware masking views (invoices_v / suppliers_v / delivery_notes_v)
    // back to their base demo dataset — demo mode has no roles/RLS to enforce.
    from: (table: string) => query(demoTables[table] ?? demoTables[table.replace(/_v$/, '')] ?? []),

    auth: {
      onAuthStateChange: (cb: (event: string, session: unknown) => void) => {
        // Mimic supabase-js: replay INITIAL_SESSION asynchronously with the
        // injected demo manager so useAuth resolves straight into the app.
        setTimeout(() => cb('INITIAL_SESSION', { user: demoUser }), 0)
        return { data: { subscription: { unsubscribe: () => {} } } }
      },
      getSession: () =>
        Promise.resolve({ data: { session: { user: demoUser } }, error: null }),
      getUser: () =>
        Promise.resolve({ data: { user: demoUser }, error: null }),
      signInWithOtp: () => Promise.resolve({ data: {}, error: null }),
      signOut: () => Promise.resolve({ error: null }),
    },

    storage: {
      from: () => ({
        // Return the path as-is — demo documents are real bundled URLs, so the
        // preview iframe can load them directly without signing anything.
        createSignedUrl: (path: string) =>
          Promise.resolve({ data: { signedUrl: path }, error: null }),
        getPublicUrl: (path: string) => ({ data: { publicUrl: path } }),
        upload: () => Promise.resolve({ data: { path: 'demo' }, error: null }),
        download: () => Promise.resolve({ data: null, error: null }),
        remove: () => Promise.resolve({ data: null, error: null }),
      }),
    },
  }
}
