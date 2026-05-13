const BASE = `${import.meta.env.VITE_SUPABASE_URL}/functions/v1/hadas-api`
const KEY  = import.meta.env.VITE_HADAS_API_KEY as string

async function call(method: string, path: string, body?: unknown): Promise<unknown> {
  const res = await fetch(`${BASE}${path}`, {
    method,
    headers: { 'Content-Type': 'application/json', 'x-hadas-key': KEY },
    body: body !== undefined ? JSON.stringify(body) : undefined,
  })
  const data = await res.json().catch(() => ({}))
  if (!res.ok) throw new Error((data as any)?.error ?? `HTTP ${res.status}`)
  return data
}

export const api = {
  post:   (path: string, body: unknown) => call('POST',   path, body),
  put:    (path: string, body: unknown) => call('PUT',    path, body),
  delete: (path: string)                => call('DELETE', path),
}
