-- Sandalo schema — regenerated from live-DB introspection on 2026-08-17.
-- Safe to run in the Supabase SQL Editor on a fresh database (tables are
-- ordered so FK targets exist before their dependents).
--
-- RLS is ENABLED on every table; policies are not part of this file — they
-- live in supabase/migrations/ (see 20260805000000_rls_lockdown.sql).
--
-- To regenerate: run supabase/introspect.sql in the SQL Editor, export the
-- result as CSV, and rebuild this file from it.

-- ─── customers ────────────────────────────────────────────────────────────────
create table if not exists customers (
  id                 uuid    primary key default gen_random_uuid(),
  client_id          uuid    not null,
  first_name         text    not null,
  last_name          text    not null,
  email              text,
  phone              text,
  phone_alt          text,
  preferred_contact  text,
  notes              text,
  custom_fields      jsonb   not null default '{}'::jsonb,
  is_active          boolean not null default true,
  created_at         timestamptz not null default now(),
  preferred_language text    not null default 'en',
  middle_name        text,
  birthday           date,
  phone_whatsapp     boolean not null default false,
  address_street     text,
  address_city       text,
  address_state      text,
  address_zip        text,
  allergies          text,
  preferences        text
);

create index if not exists customers_client_id_idx on customers (client_id);
create index if not exists customers_email_idx     on customers (client_id, email);
create index if not exists customers_name_idx      on customers (client_id, last_name, first_name);
create index if not exists customers_phone_idx     on customers (client_id, phone);

-- ─── customer_field_defs ──────────────────────────────────────────────────────
create table if not exists customer_field_defs (
  id          uuid    primary key default gen_random_uuid(),
  client_id   uuid    not null,
  label       text    not null,
  field_key   text    not null,
  field_type  text    not null default 'text',
  options     jsonb,
  is_required boolean not null default false,
  sort_order  integer not null default 0,
  is_active   boolean not null default true,
  created_at  timestamptz not null default now(),
  unique (client_id, field_key)
);

create index if not exists customer_field_defs_client_id_idx
  on customer_field_defs (client_id);

-- ─── staff ────────────────────────────────────────────────────────────────────
create table if not exists staff (
  id                 uuid   primary key default gen_random_uuid(),
  client_id          uuid   not null,
  name               text   not null,
  role               text   not null,
  status             text   not null default 'Active',
  phone              text,
  email              text,
  notes              text,
  created_at         timestamptz not null default now(),
  employment_type    text   not null default 'contractor',
  commission_rate    numeric(5,4),
  roles              text[] not null default '{}'::text[],
  preferred_language text   not null default 'en',
  hourly_rate        numeric(10,2)
);

create index if not exists staff_client_id_idx on staff (client_id);
create unique index if not exists staff_client_name_unique on staff (client_id, name);

-- ─── staff_licenses ───────────────────────────────────────────────────────────
create table if not exists staff_licenses (
  id             uuid primary key default gen_random_uuid(),
  client_id      uuid not null,
  staff_id       uuid not null references staff (id) on delete cascade,
  license_type   text not null,
  license_number text,
  issued_date    date,
  expiry_date    date,
  status         text not null default 'active',
  notes          text,
  created_at     timestamptz not null default now()
);

create index if not exists staff_licenses_staff_id_idx on staff_licenses (staff_id);
create index if not exists staff_licenses_expiry_idx
  on staff_licenses (client_id, expiry_date) where status = 'active';

-- ─── resources ────────────────────────────────────────────────────────────────
create table if not exists resources (
  id         uuid    primary key default gen_random_uuid(),
  client_id  uuid    not null,
  name       text    not null,
  quantity   integer not null default 1,
  sort_order integer default 0,
  is_active  boolean default true,
  created_at timestamptz default now()
);

-- ─── service_categories ───────────────────────────────────────────────────────
create table if not exists service_categories (
  id         uuid    primary key default gen_random_uuid(),
  client_id  uuid    not null,
  name       text    not null,
  color      text    not null default '#4A7B6A',
  sort_order integer not null default 0,
  is_active  boolean not null default true,
  created_at timestamptz not null default now(),
  unique (client_id, name)
);

-- ─── services ─────────────────────────────────────────────────────────────────
create table if not exists services (
  id                    uuid    primary key default gen_random_uuid(),
  client_id             uuid    not null,
  name                  text    not null,
  category              text,
  duration_minutes      integer not null,
  buffer_minutes        integer not null default 0,
  price                 numeric(10,2),
  deposit_amount        numeric(10,2),
  sort_order            integer not null default 0,
  is_active             boolean not null default true,
  created_at            timestamptz not null default now(),
  name_es               text,
  required_license_type text,
  resource_id           uuid    references resources (id),
  buffer_before_minutes integer not null default 0,
  buffer_after_minutes  integer not null default 0,
  description           text,
  category_id           uuid    references service_categories (id),
  staff_count           integer not null default 1,
  customer_count        integer not null default 1
);

create index if not exists services_client_id_idx on services (client_id);

-- ─── service_addons ───────────────────────────────────────────────────────────
create table if not exists service_addons (
  id               uuid    primary key default gen_random_uuid(),
  client_id        uuid    not null,
  name             text    not null,
  name_es          text,
  description      text,
  price            numeric(10,2) not null default 0,
  duration_minutes integer not null default 0,
  is_active        boolean not null default true,
  sort_order       integer not null default 0,
  created_at       timestamptz not null default now()
);

-- ─── service_addon_categories ─────────────────────────────────────────────────
create table if not exists service_addon_categories (
  id          uuid primary key default gen_random_uuid(),
  addon_id    uuid not null references service_addons (id) on delete cascade,
  category_id uuid not null references service_categories (id) on delete cascade,
  unique (addon_id, category_id)
);

-- ─── staff_services ───────────────────────────────────────────────────────────
create table if not exists staff_services (
  id         uuid primary key default gen_random_uuid(),
  client_id  uuid not null,
  staff_id   uuid not null references staff (id) on delete cascade,
  service_id uuid not null references services (id) on delete cascade,
  unique (staff_id, service_id)
);

create index if not exists staff_services_staff_id_idx   on staff_services (staff_id);
create index if not exists staff_services_service_id_idx on staff_services (service_id);

-- ─── business_hours ───────────────────────────────────────────────────────────
create table if not exists business_hours (
  id          uuid     primary key default gen_random_uuid(),
  client_id   uuid     not null,
  day_of_week smallint not null check (day_of_week >= 0 and day_of_week <= 6),
  is_open     boolean  not null default true,
  open_time   time,
  close_time  time,
  created_at  timestamptz not null default now(),
  unique (client_id, day_of_week)
);

-- ─── time_blocks ──────────────────────────────────────────────────────────────
create table if not exists time_blocks (
  id              uuid not null primary key default gen_random_uuid(),
  client_id       uuid not null,
  staff_id        uuid not null references staff (id) on delete cascade,
  block_date      date not null,
  start_time      time not null,
  end_time        time not null,
  label           text default 'Blocked',
  notes           text,
  created_at      timestamptz not null default now(),
  type            text not null default 'shift'
                    check (type in ('shift', 'time_off', 'break')),
  time_off_reason text
                    check (time_off_reason in ('vacation', 'sick', 'personal', 'other')),
  check (end_time > start_time)
);

create index if not exists time_blocks_client_date on time_blocks (client_id, block_date);

-- ─── appointments ─────────────────────────────────────────────────────────────
create table if not exists appointments (
  id                    uuid primary key default gen_random_uuid(),
  client_id             uuid not null,
  customer_id           uuid not null references customers (id) on delete restrict,
  staff_id              uuid references staff (id) on delete restrict,
  service_id            uuid references services (id) on delete restrict,
  appointment_date      date not null,
  start_time            time,
  duration_minutes      integer,
  status                text not null default 'scheduled',
  price_charged         numeric(10,2),
  tip_amount            numeric(10,2) not null default 0,
  deposit_paid          numeric(10,2) not null default 0,
  payment_method        text,
  square_transaction_id text,
  notes                 text,
  created_at            timestamptz not null default now(),
  resource_id           uuid references resources (id),
  group_id              uuid,
  checked_in_at         timestamptz,
  checked_out_at        timestamptz
);

create index if not exists appointments_client_id_idx   on appointments (client_id);
create index if not exists appointments_customer_id_idx on appointments (customer_id);
create index if not exists appointments_staff_id_idx    on appointments (staff_id);
create index if not exists appointments_date_idx        on appointments (client_id, appointment_date);
create index if not exists appointments_group_id
  on appointments (group_id) where group_id is not null;

-- ─── appointment_addons ───────────────────────────────────────────────────────
create table if not exists appointment_addons (
  id             uuid primary key default gen_random_uuid(),
  client_id      uuid not null,
  appointment_id uuid not null references appointments (id) on delete cascade,
  addon_id       uuid not null references service_addons (id) on delete restrict,
  price_charged  numeric(10,2) not null,
  created_at     timestamptz not null default now(),
  unique (appointment_id, addon_id)
);

-- ─── membership_programs ──────────────────────────────────────────────────────
create table if not exists membership_programs (
  id                    uuid    primary key default gen_random_uuid(),
  client_id             uuid    not null,
  name                  text    not null,
  description           text,
  visit_limit           integer,
  limit_period          text,
  requires_verification boolean not null default false,
  claim_form_fields     jsonb   not null default '{}'::jsonb,
  is_active             boolean not null default true,
  created_at            timestamptz not null default now()
);

create index if not exists membership_programs_client_id_idx
  on membership_programs (client_id);

-- ─── customer_memberships ─────────────────────────────────────────────────────
create table if not exists customer_memberships (
  id          uuid    primary key default gen_random_uuid(),
  client_id   uuid    not null,
  customer_id uuid    not null references customers (id) on delete restrict,
  program_id  uuid    not null references membership_programs (id) on delete restrict,
  member_id   text    not null,
  verified_at date,
  valid_from  date,
  valid_until date,
  is_active   boolean not null default true,
  notes       text,
  created_at  timestamptz not null default now(),
  unique (customer_id, program_id)
);

create index if not exists customer_memberships_customer_id_idx
  on customer_memberships (customer_id);
create index if not exists customer_memberships_program_id_idx
  on customer_memberships (program_id);

-- ─── membership_visits ────────────────────────────────────────────────────────
create table if not exists membership_visits (
  id                     uuid    primary key default gen_random_uuid(),
  client_id              uuid    not null,
  appointment_id         uuid    not null references appointments (id) on delete restrict,
  customer_membership_id uuid    not null references customer_memberships (id) on delete restrict,
  calendar_year          integer not null,
  calendar_month         integer not null,
  status                 text    not null default 'pending',
  claim_data             jsonb   not null default '{}'::jsonb,
  created_at             timestamptz not null default now(),
  unique (appointment_id, customer_membership_id)
);

create index if not exists membership_visits_membership_id_idx
  on membership_visits (customer_membership_id);
create index if not exists membership_visits_period_idx
  on membership_visits (customer_membership_id, calendar_year, calendar_month);

-- ─── payment_methods ──────────────────────────────────────────────────────────
create table if not exists payment_methods (
  id         uuid    primary key default gen_random_uuid(),
  client_id  uuid    not null,
  name       text    not null,
  code       text    not null,
  is_active  boolean not null default true,
  sort_order integer not null default 0,
  created_at timestamptz not null default now(),
  unique (client_id, code)
);

-- ─── financial_accounts ───────────────────────────────────────────────────────
create table if not exists financial_accounts (
  id              uuid    primary key default gen_random_uuid(),
  client_id       uuid    not null,
  name            text    not null,
  institution     text,
  last_four       text,
  account_type    text    not null
                    check (account_type in ('checking', 'savings', 'credit_card', 'line_of_credit', 'other')),
  created_at      timestamptz default now(),
  parent_category text,
  sort_order      integer default 0
);

-- ─── bank_transactions ────────────────────────────────────────────────────────
create table if not exists bank_transactions (
  id                uuid primary key default gen_random_uuid(),
  client_id         uuid not null,
  transaction_date  date not null,
  description       text not null,
  amount            numeric(14,2) not null,
  account           text,
  category          text,
  reference_id      text,
  created_at        timestamptz not null default now(),
  splits            jsonb,
  source_account_id uuid references financial_accounts (id)
);

-- No row-level dedup index: two genuinely identical transactions (same date,
-- description, amount) are both real charges. Import ids number repeated rows
-- deterministically instead (see 20260811000000_allow_identical_transactions.sql).

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
  created_at         timestamptz not null default now(),
  total_fee          numeric,        -- flat-fee instruments (e.g. Pevez loan)
  default_rate       numeric
);

-- ─── loan_disbursements ───────────────────────────────────────────────────────
create table if not exists loan_disbursements (
  id                uuid primary key default gen_random_uuid(),
  client_id         uuid not null,
  loan_id           uuid not null references loans (id) on delete cascade,
  transaction_id    uuid references bank_transactions (id),
  disbursement_date date not null,
  amount            numeric(14,2) not null check (amount > 0),
  notes             text,
  created_at        timestamptz not null default now()
);

create index if not exists loan_disbursements_loan_id
  on loan_disbursements (loan_id, disbursement_date);

-- ─── loan_payments ────────────────────────────────────────────────────────────
create table if not exists loan_payments (
  id               uuid primary key default gen_random_uuid(),
  client_id        uuid not null,
  loan_id          uuid not null references loans (id) on delete cascade,
  transaction_id   text,  -- free-text link to bank_transactions.id; unlike
                          -- loan_disbursements.transaction_id, this is NOT a real FK
  payment_date     date not null,
  total_amount     numeric(14,2) not null,
  principal_amount numeric(14,2) not null,
  interest_amount  numeric(14,2) not null,
  fees_amount      numeric(14,2) not null default 0,
  notes            text,
  created_at       timestamptz not null default now()
);

-- ─── categories (chart of accounts) ───────────────────────────────────────────
create table if not exists categories (
  id         uuid    primary key default gen_random_uuid(),
  client_id  uuid    not null,
  name       text    not null,
  sort_order integer not null default 0,
  created_at timestamptz not null default now(),
  pl_section text,
  parent     text,
  loan_id    uuid    references loans (id) on delete set null,
  staff_id   uuid    references staff (id) on delete set null
);

-- Name uniqueness is GLOBAL, not per-client — matches the live DB.
create unique index if not exists categories_name_unique on categories (name);

-- ─── square_reports ───────────────────────────────────────────────────────────
create table if not exists square_reports (
  id            uuid primary key default gen_random_uuid(),
  client_id     uuid not null,
  period        text not null,   -- YYYY-MM
  gross_sales   numeric(14,2),
  returns       numeric(14,2),
  discounts     numeric(14,2),
  net_sales     numeric(14,2),
  tax_collected numeric(14,2),
  fees          numeric(14,2),
  net_total     numeric(14,2),
  cash_amount   numeric(14,2),
  card_amount   numeric(14,2),
  categories    jsonb,           -- [{ name, count, amount }]
  created_at    timestamptz not null default now()
);

create unique index if not exists square_reports_client_period
  on square_reports (client_id, period);

-- ─── square_connections ───────────────────────────────────────────────────────
create table if not exists square_connections (
  id            uuid primary key default gen_random_uuid(),
  client_id     uuid not null unique default '00000000-0000-0000-0000-000000000001'::uuid,
  environment   text not null default 'sandbox'
                  check (environment in ('sandbox', 'production')),
  access_token  text not null,
  merchant_id   text,
  merchant_name text,
  location_id   text,
  location_name text,
  token_last4   text,
  connected_at  timestamptz not null default now()
);

-- ─── profiles ─────────────────────────────────────────────────────────────────
create table if not exists profiles (
  id         uuid primary key references auth.users (id) on delete cascade,
  client_id  uuid not null default '00000000-0000-0000-0000-000000000001'::uuid,
  name       text not null,
  email      text not null,
  role       text not null default 'user'
               check (role in ('super_admin', 'admin', 'user')),
  is_active  boolean not null default true,
  created_at timestamptz not null default now(),
  staff_id   uuid references staff (id) on delete set null
);

-- ─── user_groups ──────────────────────────────────────────────────────────────
create table if not exists user_groups (
  id          uuid primary key default gen_random_uuid(),
  client_id   uuid not null default '00000000-0000-0000-0000-000000000001'::uuid,
  name        text not null,
  description text,
  created_at  timestamptz not null default now()
);

-- ─── group_permissions ────────────────────────────────────────────────────────
create table if not exists group_permissions (
  id        uuid    primary key default gen_random_uuid(),
  client_id uuid    not null default '00000000-0000-0000-0000-000000000001'::uuid,
  group_id  uuid    not null references user_groups (id) on delete cascade,
  resource  text    not null
              check (resource in ('dashboard', 'appointments', 'clients', 'services', 'staff', 'finance', 'settings')),
  can_read  boolean not null default true,
  can_write boolean not null default false,
  unique (group_id, resource)
);

-- ─── user_group_members ───────────────────────────────────────────────────────
create table if not exists user_group_members (
  id        uuid primary key default gen_random_uuid(),
  client_id uuid not null default '00000000-0000-0000-0000-000000000001'::uuid,
  user_id   uuid not null references profiles (id) on delete cascade,
  group_id  uuid not null references user_groups (id) on delete cascade,
  unique (user_id, group_id)
);
