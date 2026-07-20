-- ============================================================================
-- Merge Suppliers — atomic in-app supplier de-duplication (replaces hand-run SQL)
-- ----------------------------------------------------------------------------
--   1. Convert suppliers.alt_names scalar `text` -> text[] (appendAltName /
--      findBestSupplier both treat it as an array). The suppliers_v masking view
--      depends on this column, so it is DROPPED before the ALTER and RECREATED
--      identically after (verified against the LIVE prod definition — same columns,
--      security_barrier, role-aware mask, grants). suppliers_v is the ONLY view
--      referencing alt_names; invoices_v / delivery_notes_v do not.
--   2. merge_suppliers(from, into) — re-points every FK table, folds the removed
--      name into the kept card's alt_names, carries hp, deletes the removed card,
--      ALL in one transaction (function body = one implicit transaction).
--
-- SECURITY: merge_suppliers is SECURITY DEFINER (bypasses RLS), so execute is
--   REVOKEd from public and granted ONLY to service_role — hadas-api (service key)
--   is the sole caller and enforces the manager-only gate.
-- ============================================================================

begin;

-- ── 1. alt_names -> text[] (drop → convert → recreate the dependent view) ─────
-- suppliers_v reads alt_names, so Postgres blocks the column type change while it
-- exists (ERROR 0A000). Drop it, convert, then recreate it exactly as it was.
drop view if exists public.suppliers_v;

alter table public.suppliers
  alter column alt_names type text[]
  using (
    case
      when alt_names is null or btrim(alt_names) = '' then null
      when alt_names like '{%}'                       then alt_names::text[]  -- already an array literal
      else array[alt_names]                                                   -- scalar -> single-element
    end
  );

-- Recreate suppliers_v EXACTLY as it is on prod (verified live definition):
--   security_barrier, owner-rights (no security_invoker), the manager-only mask on
--   opening_balance / opening_balance_date, the allowed-users gate in WHERE.
create view public.suppliers_v with (security_barrier = true) as
select
  id, name, alt_names, email, phone, category, notes, created_at, linked_invoices,
  case when current_user_role() = 'manager' then opening_balance      else null::numeric end as opening_balance,
  hp, contact,
  case when current_user_role() = 'manager' then opening_balance_date else null::date    end as opening_balance_date,
  active, needs_details
from suppliers
where current_user_role() is not null;

grant select on public.suppliers_v to anon, authenticated;

-- ── 2. merge_suppliers(from, into) ────────────────────────────────────────────
create or replace function public.merge_suppliers(p_from text, p_into text)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_from        suppliers%rowtype;
  v_into        suppliers%rowtype;
  c_invoices    int;
  c_payments    int;
  c_returns     int;
  c_delivery    int;
  c_statements  int;
  c_categories  int;
begin
  -- Guards (also enforced by the endpoint; re-asserted here as defense in depth).
  if p_from is null or p_into is null or p_from = p_into then
    raise exception 'merge_suppliers: from/into must be distinct and non-null';
  end if;

  -- Lock both rows for the duration of the transaction; a missing side aborts
  -- (and rolls back — nothing has been touched yet).
  select * into v_from from suppliers where id = p_from for update;
  if not found then raise exception 'merge_suppliers: source supplier % not found', p_from; end if;
  select * into v_into from suppliers where id = p_into for update;
  if not found then raise exception 'merge_suppliers: target supplier % not found', p_into; end if;

  -- Dependent counts (for the returned summary — the authoritative "moved" figures).
  select count(*) into c_invoices   from invoices          where supplier_id = p_from;
  select count(*) into c_payments   from payments          where supplier_id = p_from;
  select count(*) into c_returns    from returns           where supplier_id = p_from;
  select count(*) into c_delivery   from delivery_notes    where supplier_id = p_from;
  select count(*) into c_statements from vendor_statements where supplier_id = p_from;

  -- (a) Denormalized supplier_name → kept name. Done BEFORE the repoint so it is
  --     scoped to exactly the rows being moved.
  update invoices       set supplier_name = v_into.name where supplier_id = p_from;
  update delivery_notes set supplier_name = v_into.name where supplier_id = p_from;

  -- (b) supplier_categories has UNIQUE(supplier_id, category): a category present on
  --     BOTH cards would collide on repoint. Match the hand-run SQL — drop the
  --     removed card's duplicate row (do NOT sum usage_count), then repoint the rest.
  delete from supplier_categories sc
   where sc.supplier_id = p_from
     and exists (
       select 1 from supplier_categories x
        where x.supplier_id = p_into and x.category = sc.category
     );
  update supplier_categories set supplier_id = p_into where supplier_id = p_from;
  get diagnostics c_categories = row_count;

  -- (c) Re-point the FK tables from the removed card to the kept card.
  update invoices          set supplier_id = p_into where supplier_id = p_from;
  update payments          set supplier_id = p_into where supplier_id = p_from;
  update returns           set supplier_id = p_into where supplier_id = p_from;
  update delivery_notes    set supplier_id = p_into where supplier_id = p_from;
  update vendor_statements set supplier_id = p_into where supplier_id = p_from;

  -- (d) Fold the removed name (+ its own alt_names) into the kept card's alt_names,
  --     deduped, excluding the kept card's canonical name. This is how a future
  --     invoice for the removed spelling now matches the kept card (findBestSupplier).
  update suppliers
     set alt_names = (
       select array_agg(distinct n)
         from unnest(
                coalesce(v_into.alt_names, '{}'::text[])
                || array[v_from.name]
                || coalesce(v_from.alt_names, '{}'::text[])
              ) as n
        where n is not null and btrim(n) <> '' and n <> v_into.name
     )
   where id = p_into;

  -- (e) Carry the removed card's ח.פ over ONLY when the kept card lacks one.
  if nullif(btrim(coalesce(v_into.hp, '')), '') is null
     and nullif(btrim(coalesce(v_from.hp, '')), '') is not null then
    update suppliers set hp = v_from.hp where id = p_into;
  end if;

  -- (f) Delete the removed card (all its rows now point at the kept card).
  delete from suppliers where id = p_from;

  return jsonb_build_object(
    'invoices',            c_invoices,
    'payments',            c_payments,
    'returns',             c_returns,
    'delivery_notes',      c_delivery,
    'vendor_statements',   c_statements,
    'supplier_categories', c_categories
  );
end;
$$;

revoke all     on function public.merge_suppliers(text, text) from public;
grant  execute on function public.merge_suppliers(text, text) to service_role;

commit;
