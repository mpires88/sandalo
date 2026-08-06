-- ─────────────────────────────────────────────────────────────────────────────
-- RLS lockdown  (Phase 1 security fix)
--
-- WHY: the app's permission model was enforced only in the browser. RLS was off
-- (seeds ran ALTER TABLE ... DISABLE ROW LEVEL SECURITY) and the client writes
-- user_groups / group_permissions / user_group_members with the anon key, so any
-- signed-in user could add themselves to a privileged group. square_connections
-- stores a plaintext Square access token that a client could read directly.
--
-- WHAT THIS DOES:
--   * is_admin() / is_active_user() helpers (SECURITY DEFINER, bypass RLS safely)
--   * profiles:            client may READ own row / admins read all; NO client writes
--                          (all profile writes go through the service-role API route,
--                           which enforces the role hierarchy)
--   * user_groups,
--     group_permissions,
--     user_group_members:  authenticated READ; writes gated by is_admin()
--   * square_connections:  RLS on, ZERO client policies → all anon/authenticated
--                          access denied; only the service-role API can touch it
--   * business tables:     authenticated + active staff may read/write
--
-- SAFE TO RUN MORE THAN ONCE. Every table is guarded by to_regclass, so tables that
-- don't exist in your project are skipped rather than erroring.
--
-- BEFORE APPLYING: skim the business-table list at the bottom against your live
-- schema. Apply in the Supabase SQL Editor (Database → SQL Editor) or via the CLI.
-- ─────────────────────────────────────────────────────────────────────────────

-- ── Helper functions ─────────────────────────────────────────────────────────
-- SECURITY DEFINER + a pinned search_path means these read `profiles` as the
-- function owner, bypassing RLS on profiles and avoiding policy recursion.

create or replace function public.is_admin()
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select exists (
    select 1 from public.profiles
    where id = auth.uid()
      and role in ('super_admin', 'admin')
      and coalesce(is_active, true)
  );
$$;

create or replace function public.is_active_user()
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select exists (
    select 1 from public.profiles
    where id = auth.uid()
      and coalesce(is_active, true)
  );
$$;

revoke all on function public.is_admin()       from public;
revoke all on function public.is_active_user() from public;
grant execute on function public.is_admin()       to authenticated;
grant execute on function public.is_active_user() to authenticated;

-- ── profiles: read-only for clients, all writes via service-role API ─────────
do $$ begin
  if to_regclass('public.profiles') is not null then
    execute 'alter table public.profiles enable row level security';
    execute 'drop policy if exists profiles_select on public.profiles';
    execute $p$
      create policy profiles_select on public.profiles for select to authenticated
      using ( id = auth.uid() or public.is_admin() )
    $p$;
    -- Intentionally NO insert/update/delete policy: with RLS on, that denies all
    -- client writes. The /api/admin/users route uses the service-role key (which
    -- bypasses RLS) and is the only place the role hierarchy is enforced.
  end if;
end $$;

-- ── permission tables: authenticated read, admin-only write ──────────────────
do $$
declare t text;
begin
  foreach t in array array['user_groups', 'group_permissions', 'user_group_members'] loop
    if to_regclass('public.' || t) is not null then
      execute format('alter table public.%I enable row level security', t);
      execute format('drop policy if exists %I on public.%I', t || '_select', t);
      execute format('drop policy if exists %I on public.%I', t || '_write',  t);
      execute format(
        'create policy %I on public.%I for select to authenticated using (true)',
        t || '_select', t);
      execute format(
        'create policy %I on public.%I for all to authenticated using (public.is_admin()) with check (public.is_admin())',
        t || '_write', t);
    end if;
  end loop;
end $$;

-- ── square_connections: deny ALL client access (holds a plaintext token) ─────
do $$ begin
  if to_regclass('public.square_connections') is not null then
    execute 'alter table public.square_connections enable row level security';
    execute 'drop policy if exists square_connections_select on public.square_connections';
    execute 'drop policy if exists square_connections_write  on public.square_connections';
    -- No policies at all → every anon/authenticated request is denied.
    -- The /api/integrations/square route reaches it with the service-role key.
  end if;
end $$;

-- ── business tables: any active, authenticated staff member ──────────────────
-- Single-tenant app: everyone who logs in works for the one client, so row access
-- is gated on "is the caller an active user" rather than per-row client_id. The
-- policy references no table columns, so it is safe regardless of each table's shape.
do $$
declare
  t text;
  business_tables text[] := array[
    'appointments', 'appointment_addons', 'bank_transactions', 'business_hours',
    'categories', 'customers', 'customer_field_defs', 'financial_accounts',
    'loans', 'loan_payments', 'loan_disbursements', 'payment_methods',
    'resources', 'services', 'service_addons', 'service_addon_categories',
    'service_categories', 'square_reports', 'staff', 'staff_licenses', 'time_blocks'
  ];
begin
  foreach t in array business_tables loop
    if to_regclass('public.' || t) is not null then
      execute format('alter table public.%I enable row level security', t);
      execute format('drop policy if exists %I on public.%I', t || '_rw', t);
      execute format(
        'create policy %I on public.%I for all to authenticated using (public.is_active_user()) with check (public.is_active_user())',
        t || '_rw', t);
    end if;
  end loop;
end $$;
