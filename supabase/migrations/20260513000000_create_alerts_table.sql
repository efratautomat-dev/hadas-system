create table if not exists public.alerts (
  id          uuid primary key default gen_random_uuid(),
  type        text not null,
  message     text not null,
  details     jsonb,
  resolved    boolean not null default false,
  created_at  timestamptz not null default now()
);

alter table public.alerts enable row level security;

create policy "service role full access" on public.alerts
  using (true)
  with check (true);
