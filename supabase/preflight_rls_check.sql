-- ─────────────────────────────────────────────────────────────────────────────
-- Preflight for 20260805000000_rls_lockdown.sql — READ ONLY, changes nothing.
--
-- Run this FIRST in the Supabase SQL Editor. It confirms the live schema matches
-- what the RLS migration assumes (the migration was written from the app code, not
-- from a live schema query). If anything below looks wrong, tell me before applying.
-- ─────────────────────────────────────────────────────────────────────────────

-- 1) Do the tables the migration targets actually exist?
select t as expected_table,
       to_regclass('public.' || t) is not null as exists
from unnest(array[
  'profiles','user_groups','group_permissions','user_group_members','square_connections',
  'appointments','appointment_addons','bank_transactions','business_hours','categories',
  'customers','customer_field_defs','financial_accounts','loans','loan_payments',
  'loan_disbursements','payment_methods','resources','services','service_addons',
  'service_addon_categories','service_categories','square_reports','staff','staff_licenses','time_blocks'
]) as t
order by exists, expected_table;

-- 2) Does `profiles` have the columns the policies rely on? (expect all four)
select column_name, data_type
from information_schema.columns
where table_schema = 'public' and table_name = 'profiles'
  and column_name in ('id', 'role', 'is_active', 'client_id')
order by column_name;

-- 3) Current RLS status + policy count for every public table (baseline before the change)
select c.relname       as table_name,
       c.relrowsecurity as rls_enabled,
       (select count(*) from pg_policies p
        where p.schemaname = 'public' and p.tablename = c.relname) as policy_count
from pg_class c
join pg_namespace n on n.oid = c.relnamespace
where n.nspname = 'public' and c.relkind = 'r'
order by c.relname;
