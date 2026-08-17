-- Schema introspection for regenerating schema.sql
-- Run in Supabase SQL Editor, then export the result as CSV to
-- supabase/introspection.csv (replaces the old truncated export).
--
-- Returns ONE row per table (columns / constraints / indexes are
-- newline-aggregated into single cells) so the SQL Editor's 100-row
-- display cap cannot truncate the export.

select
  t.relname as tbl,
  t.relrowsecurity as rls_enabled,
  (
    select string_agg(
             a.attname || ' : ' || format_type(a.atttypid, a.atttypmod)
             || case when a.attnotnull then ' not null' else '' end
             || coalesce(' default ' || pg_get_expr(d.adbin, d.adrelid), ''),
             e'\n' order by a.attnum)
    from pg_attribute a
    left join pg_attrdef d on d.adrelid = a.attrelid and d.adnum = a.attnum
    where a.attrelid = t.oid and a.attnum > 0 and not a.attisdropped
  ) as columns,
  (
    select string_agg(con.conname || ' : ' || pg_get_constraintdef(con.oid),
                      e'\n' order by con.conname)
    from pg_constraint con
    where con.conrelid = t.oid
  ) as constraints,
  (
    select string_agg(pg_get_indexdef(i.indexrelid), e'\n'
                      order by pg_get_indexdef(i.indexrelid))
    from pg_index i
    where i.indrelid = t.oid
  ) as indexes
from pg_class t
join pg_namespace n on n.oid = t.relnamespace
where n.nspname = 'public'
  and t.relkind in ('r', 'p')
order by t.relname;
