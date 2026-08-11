-- Sandalo schema
-- Run this in the Supabase SQL Editor (Database → SQL Editor → New query)

-- ─── bank_transactions ────────────────────────────────────────────────────────
create table if not exists bank_transactions (
  id               uuid        primary key default gen_random_uuid(),
  client_id        uuid        not null,
  transaction_date date        not null,
  description      text        not null,
  amount           numeric(14,2) not null,
  account          text,
  category         text,
  reference_id     text,
  created_at       timestamptz not null default now()
);

-- No row-level dedup index: two genuinely identical transactions (same date,
-- description, amount) are both real charges. Import ids number repeated rows
-- deterministically instead (see 20260811000000_allow_identical_transactions.sql).

-- ─── categories (chart of accounts) ──────────────────────────────────────────
create table if not exists categories (
  id         uuid    primary key default gen_random_uuid(),
  client_id  uuid    not null,
  name       text    not null,
  sort_order integer not null default 0,
  created_at timestamptz not null default now()
);

create unique index if not exists categories_name_unique
  on categories (name);

-- ─── square_reports ───────────────────────────────────────────────────────────
create table if not exists square_reports (
  id            uuid    primary key default gen_random_uuid(),
  client_id     uuid    not null,
  period        text    not null,   -- YYYY-MM
  gross_sales   numeric(14,2),
  returns       numeric(14,2),
  discounts     numeric(14,2),
  net_sales     numeric(14,2),
  tax_collected numeric(14,2),
  fees          numeric(14,2),
  net_total     numeric(14,2),
  cash_amount   numeric(14,2),
  card_amount   numeric(14,2),
  categories    jsonb,              -- [{ name, count, amount }]
  created_at    timestamptz not null default now()
);

create unique index if not exists square_reports_client_period
  on square_reports (client_id, period);

-- ─── loans ────────────────────────────────────────────────────────────────────
create table if not exists loans (
  id                 uuid    primary key default gen_random_uuid(),
  client_id          uuid    not null,
  name               text    not null,
  lender             text,
  instrument_type    text    not null default 'term_loan',
  loan_type          text    not null default 'amortizing',
  original_principal numeric(14,2) not null,
  interest_rate      numeric(10,6),  -- annual decimal, e.g. 0.065
  factor_rate        numeric(10,4),  -- MCA multiplier, e.g. 1.35
  holdback_pct       numeric(10,4),  -- daily sales pct, e.g. 0.12
  start_date         date    not null,
  term_months        integer not null default 0,
  payment_frequency  text    not null default 'monthly',
  payment_amount     numeric(14,2) not null default 0,
  balloon_amount     numeric(14,2),
  notes              text,
  created_at         timestamptz not null default now()
);

-- ─── loan_payments ────────────────────────────────────────────────────────────
create table if not exists loan_payments (
  id                uuid    primary key default gen_random_uuid(),
  client_id         uuid    not null,
  loan_id           uuid    not null references loans (id) on delete cascade,
  transaction_id    text,           -- optional link to bank_transactions.id
  payment_date      date    not null,
  total_amount      numeric(14,2) not null,
  principal_amount  numeric(14,2) not null,
  interest_amount   numeric(14,2) not null,
  fees_amount       numeric(14,2) not null default 0,
  notes             text,
  created_at        timestamptz not null default now()
);

-- ─── staff ────────────────────────────────────────────────────────────────────
create table if not exists staff (
  id         uuid  primary key default gen_random_uuid(),
  client_id  uuid  not null,
  name       text  not null,
  role       text  not null,
  status     text  not null default 'Active',
  phone      text,
  email      text,
  notes      text,
  created_at timestamptz not null default now()
);
