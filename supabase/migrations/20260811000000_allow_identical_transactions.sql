-- Allow two genuinely identical bank transactions to coexist.
--
-- The unique index on (client_id, transaction_date, description, amount)
-- silently collapsed real duplicate charges (e.g. two identical $5 card swipes
-- on the same day) and could abort whole import batches. The CSV importer now
-- numbers repeated identical rows within a file, giving each its own
-- deterministic id, so re-imports stay idempotent without this index.
--
-- Run in the Supabase SQL Editor (Database → SQL Editor → New query).

drop index if exists bank_transactions_dedup;

-- ─── Data patch: Pevez flat-fee note ─────────────────────────────────────────
-- The seed originally recorded interest_rate 0.30 with no total_fee; the note is
-- a pre-computed $30,000 flat finance charge. Idempotent: only touches rows that
-- still lack total_fee.

update loans
set total_fee = 30000, interest_rate = null
where lender = 'Pevez LLC' and total_fee is null;

-- ─── Sanity check ────────────────────────────────────────────────────────────
-- Should return exactly ONE row. If two appear, the one-time seed ran in more
-- than one browser before it was made idempotent — delete the copy that has no
-- payments linked to it.

select id, name, lender, original_principal, total_fee, interest_rate, start_date
from loans
where lender = 'Pevez LLC';
