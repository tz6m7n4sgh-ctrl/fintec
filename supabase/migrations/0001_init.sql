-- =====================================================================
-- Personal Finance & Termination-Readiness App — initial schema
--
-- Design notes
--  * Every table carries user_id, created_at, updated_at (NFR-1).
--  * Row-level security is enabled on EVERY table and keyed to auth.uid(),
--    so one user can never read another's financial data.
--  * Money is numeric(14,2) — never float. AED amounts must not drift.
--  * Dates that represent calendar days are `date`, not `timestamptz`, so a
--    deadline is the same day in every timezone (R-7).
-- =====================================================================

-- ---------------------------------------------------------------------
-- Shared helpers
-- ---------------------------------------------------------------------

create or replace function public.set_updated_at()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  new.updated_at := now();
  return new;
end;
$$;

comment on function public.set_updated_at is
  'Maintains updated_at on every row mutation (audit requirement NFR-1).';

-- ---------------------------------------------------------------------
-- Enumerated domains
-- ---------------------------------------------------------------------

create type public.debt_type       as enum ('carLoan','mortgage','personalLoan','creditCard','other');
create type public.payment_type    as enum ('cheque','transfer','autoDebit');
create type public.recurrence      as enum ('none','monthly','quarterly','termly','yearly');
create type public.payment_status  as enum ('upcoming','paid','atRisk');
create type public.income_freq     as enum ('monthly','oneOff');
create type public.budget_auto_src as enum ('debts','schoolFees');
create type public.upload_status   as enum ('uploaded','queued','processing','parsed','failed','reviewed');
create type public.file_type       as enum ('pdf','csv','xlsx');
create type public.txn_direction   as enum ('credit','debit');
create type public.txn_source      as enum ('statement','manual');
create type public.review_status   as enum ('pending','confirmed','edited');

-- ---------------------------------------------------------------------
-- §4.1 Profile — one row per user
-- ---------------------------------------------------------------------

create table public.profiles (
  id                        uuid primary key default gen_random_uuid(),
  user_id                   uuid not null references auth.users(id) on delete cascade,

  basic_salary              numeric(14,2) not null default 0 check (basic_salary >= 0),
  gross_salary              numeric(14,2) not null default 0 check (gross_salary >= 0),
  employment_start          date,
  expected_last_day         date,
  unpaid_leave_days         integer not null default 0 check (unpaid_leave_days >= 0),
  unused_leave_days         integer not null default 0 check (unused_leave_days >= 0),
  notice_period_days        integer not null default 30 check (notice_period_days >= 0),
  notice_days_paid_in_lieu  integer not null default 0 check (notice_days_paid_in_lieu >= 0),
  other_owed_to_employee    numeric(14,2) not null default 0,
  owed_to_employer          numeric(14,2) not null default 0,

  iloe_subscribed_12m       boolean not null default false,
  iloe_involuntary          boolean not null default false,
  iloe_avg_basic_6m         numeric(14,2) not null default 0 check (iloe_avg_basic_6m >= 0),

  cash_savings              numeric(14,2) not null default 0,
  other_liquid_assets       numeric(14,2) not null default 0,
  monthly_side_income       numeric(14,2) not null default 0,
  dependents                integer not null default 0 check (dependents >= 0),
  visa_grace_days           integer not null default 30 check (visa_grace_days >= 0),
  health_cover_months_after_end integer not null default 0 check (health_cover_months_after_end >= 0),

  created_at                timestamptz not null default now(),
  updated_at                timestamptz not null default now(),

  -- Build for one user, but keep the schema multi-user ready.
  constraint profiles_one_per_user unique (user_id),
  -- Gross salary includes allowances, so it can never be below basic.
  constraint profiles_gross_gte_basic check (gross_salary >= basic_salary),
  constraint profiles_employment_before_exit
    check (employment_start is null or expected_last_day is null
           or expected_last_day >= employment_start)
);

-- ---------------------------------------------------------------------
-- §4.2 IncomeStream
-- ---------------------------------------------------------------------

create table public.income_streams (
  id          uuid primary key default gen_random_uuid(),
  user_id     uuid not null references auth.users(id) on delete cascade,
  name        text not null check (length(trim(name)) > 0),
  amount      numeric(14,2) not null default 0 check (amount >= 0),
  frequency   public.income_freq not null default 'monthly',
  start_date  date,
  end_date    date,
  active      boolean not null default true,
  created_at  timestamptz not null default now(),
  updated_at  timestamptz not null default now(),
  constraint income_dates_ordered
    check (start_date is null or end_date is null or end_date >= start_date)
);

-- ---------------------------------------------------------------------
-- §4.3 BudgetCategory
-- ---------------------------------------------------------------------

create table public.budget_categories (
  id              uuid primary key default gen_random_uuid(),
  user_id         uuid not null references auth.users(id) on delete cascade,
  name            text not null check (length(trim(name)) > 0),
  current_amount  numeric(14,2) not null default 0 check (current_amount >= 0),
  survival_amount numeric(14,2) not null default 0 check (survival_amount >= 0),
  editable        boolean not null default true,
  -- Non-null marks a computed row: read-only in the UI, owned by another table.
  auto_source     public.budget_auto_src,
  sort_order      integer not null default 0,
  created_at      timestamptz not null default now(),
  updated_at      timestamptz not null default now(),
  -- A computed row is never editable.
  constraint budget_auto_not_editable check (auto_source is null or editable = false),
  -- At most one auto row per source per user, so auto values cannot double-count.
  constraint budget_name_unique_per_user unique (user_id, name)
);

create unique index budget_one_auto_row_per_source
  on public.budget_categories (user_id, auto_source)
  where auto_source is not null;

-- ---------------------------------------------------------------------
-- §4.4 Debt
-- ---------------------------------------------------------------------

create table public.debts (
  id                  uuid primary key default gen_random_uuid(),
  user_id             uuid not null references auth.users(id) on delete cascade,
  type                public.debt_type not null,
  name                text not null check (length(trim(name)) > 0),
  outstanding_balance numeric(14,2) not null default 0 check (outstanding_balance >= 0),
  monthly_payment     numeric(14,2) not null default 0 check (monthly_payment >= 0),
  months_remaining    integer not null default 0 check (months_remaining >= 0),
  lender              text not null default '',
  created_at          timestamptz not null default now(),
  updated_at          timestamptz not null default now()
);

-- ---------------------------------------------------------------------
-- §4.5 SchoolFee
-- ---------------------------------------------------------------------

create table public.school_fees (
  id              uuid primary key default gen_random_uuid(),
  user_id         uuid not null references auth.users(id) on delete cascade,
  child           text not null default '',
  school          text not null default '',
  term            text not null default '',
  due_date        date not null,
  amount          numeric(14,2) not null default 0 check (amount >= 0),
  paid_by_cheque  boolean not null default false,
  paid            boolean not null default false,
  created_at      timestamptz not null default now(),
  updated_at      timestamptz not null default now()
);

-- ---------------------------------------------------------------------
-- §4.7 BankAccount
-- ---------------------------------------------------------------------

create table public.bank_accounts (
  id               uuid primary key default gen_random_uuid(),
  user_id          uuid not null references auth.users(id) on delete cascade,
  bank_name        text not null check (length(trim(bank_name)) > 0),
  account_label    text not null default '',
  last4            text check (last4 is null or last4 ~ '^[0-9]{4}$'),
  currency         text not null default 'AED',
  current_balance  numeric(14,2),
  is_cheque_account boolean not null default false,
  -- Saved column mapping for repeat CSV/XLSX uploads from this bank (D2).
  parser_config    jsonb,
  created_at       timestamptz not null default now(),
  updated_at       timestamptz not null default now()
);

-- ---------------------------------------------------------------------
-- §4.6 ScheduledPayment (including post-dated cheques)
-- ---------------------------------------------------------------------

create table public.scheduled_payments (
  id                  uuid primary key default gen_random_uuid(),
  user_id             uuid not null references auth.users(id) on delete cascade,
  due_date            date not null,
  payee               text not null check (length(trim(payee)) > 0),
  purpose             text not null default '',
  amount              numeric(14,2) not null default 0 check (amount >= 0),
  bank_account_id     uuid references public.bank_accounts(id) on delete set null,
  account_label       text not null default '',
  type                public.payment_type not null,
  recurrence          public.recurrence not null default 'none',
  -- True when this amount already sits inside a monthly budget line. The cash
  -- projection must not subtract it again as a lump sum (G-1).
  included_in_budget  boolean not null default true,
  -- The single budget line this payment belongs to, enforcing the 1:1 rule (G-1).
  budget_category_id  uuid references public.budget_categories(id) on delete set null,
  status              public.payment_status not null default 'upcoming',
  created_at          timestamptz not null default now(),
  updated_at          timestamptz not null default now(),
  -- An in-budget payment must name the budget line it belongs to.
  constraint scheduled_in_budget_needs_category
    check (included_in_budget = false or budget_category_id is not null)
);

create index scheduled_payments_due on public.scheduled_payments (user_id, due_date);

-- ---------------------------------------------------------------------
-- §4.8 StatementUpload
-- ---------------------------------------------------------------------

create table public.statement_uploads (
  id                uuid primary key default gen_random_uuid(),
  user_id           uuid not null references auth.users(id) on delete cascade,
  bank_account_id   uuid references public.bank_accounts(id) on delete set null,
  file_name         text not null,
  storage_path      text not null,
  file_type         public.file_type not null,
  period_start      date,
  period_end        date,
  status            public.upload_status not null default 'uploaded',
  error_message     text,
  transaction_count integer,
  -- Per-file processing log surfaced in the UI (NFR-6).
  processing_log    jsonb not null default '[]'::jsonb,
  created_at        timestamptz not null default now(),
  updated_at        timestamptz not null default now(),
  -- A failed upload must explain itself (US-34).
  constraint upload_failed_needs_message
    check (status <> 'failed' or error_message is not null)
);

create index statement_uploads_queue on public.statement_uploads (status, created_at);

-- ---------------------------------------------------------------------
-- §4.9 Transaction
-- ---------------------------------------------------------------------

create table public.transactions (
  id                    uuid primary key default gen_random_uuid(),
  user_id               uuid not null references auth.users(id) on delete cascade,
  bank_account_id       uuid references public.bank_accounts(id) on delete set null,
  statement_upload_id   uuid references public.statement_uploads(id) on delete set null,
  date                  date not null,
  description           text not null default '',
  amount                numeric(14,2) not null check (amount >= 0),
  direction             public.txn_direction not null,
  balance_after         numeric(14,2),
  category_id           uuid references public.budget_categories(id) on delete set null,
  source                public.txn_source not null default 'statement',
  matched_scheduled_payment_id uuid references public.scheduled_payments(id) on delete set null,
  is_duplicate          boolean not null default false,
  review_status         public.review_status not null default 'pending',
  -- Dedupe key: hash of (account, date, amount, normalised description).
  dedupe_hash           text not null,
  created_at            timestamptz not null default now(),
  updated_at            timestamptz not null default now()
);

-- Re-uploading the same statement must create 0 new transactions (US-30).
-- The partial index lets a row be *marked* duplicate without blocking inserts.
create unique index transactions_dedupe
  on public.transactions (user_id, dedupe_hash)
  where is_duplicate = false;

create index transactions_ledger on public.transactions (user_id, date desc);
create index transactions_review on public.transactions (user_id, review_status);

-- ---------------------------------------------------------------------
-- Auto-categorisation rules the user can edit (§7.5)
-- ---------------------------------------------------------------------

create table public.category_rules (
  id           uuid primary key default gen_random_uuid(),
  user_id      uuid not null references auth.users(id) on delete cascade,
  keyword      text not null check (length(trim(keyword)) > 0),
  category_id  uuid not null references public.budget_categories(id) on delete cascade,
  priority     integer not null default 100,
  created_at   timestamptz not null default now(),
  updated_at   timestamptz not null default now(),
  constraint category_rules_keyword_unique unique (user_id, keyword)
);

-- ---------------------------------------------------------------------
-- §4.10 ChecklistItem — the seeded action plan (§8)
-- ---------------------------------------------------------------------

create table public.checklist_items (
  id             uuid primary key default gen_random_uuid(),
  user_id        uuid not null references auth.users(id) on delete cascade,
  title          text not null,
  detail         text not null default '',
  -- Symbolic deadline resolved by the engine, e.g. 'settlementDue'.
  deadline_key   text,
  deadline_date  date,
  done           boolean not null default false,
  sort_order     integer not null default 0,
  created_at     timestamptz not null default now(),
  updated_at     timestamptz not null default now()
);

-- ---------------------------------------------------------------------
-- Notification preferences (FR-I2) and delivery log
-- ---------------------------------------------------------------------

create table public.notification_prefs (
  id          uuid primary key default gen_random_uuid(),
  user_id     uuid not null references auth.users(id) on delete cascade,
  email_enabled boolean not null default true,
  push_enabled  boolean not null default false,
  -- Lead times in days before a due date, e.g. [7, 2].
  lead_days   integer[] not null default '{7,2}',
  push_subscription jsonb,
  created_at  timestamptz not null default now(),
  updated_at  timestamptz not null default now(),
  constraint notification_prefs_one_per_user unique (user_id)
);

create table public.notification_log (
  id                   uuid primary key default gen_random_uuid(),
  user_id              uuid not null references auth.users(id) on delete cascade,
  scheduled_payment_id uuid references public.scheduled_payments(id) on delete cascade,
  deadline_key         text,
  channel              text not null,
  lead_days            integer,
  sent_at              timestamptz not null default now(),
  created_at           timestamptz not null default now(),
  updated_at           timestamptz not null default now()
);

-- A given reminder is sent once per channel per lead time (idempotent job).
create unique index notification_log_once
  on public.notification_log (user_id, scheduled_payment_id, channel, lead_days)
  where scheduled_payment_id is not null;

-- ---------------------------------------------------------------------
-- updated_at triggers on every table
-- ---------------------------------------------------------------------

do $$
declare t text;
begin
  foreach t in array array[
    'profiles','income_streams','budget_categories','debts','school_fees',
    'bank_accounts','scheduled_payments','statement_uploads','transactions',
    'category_rules','checklist_items','notification_prefs','notification_log'
  ]
  loop
    execute format(
      'create trigger set_updated_at before update on public.%I
       for each row execute function public.set_updated_at()', t);
  end loop;
end $$;

-- ---------------------------------------------------------------------
-- Row-level security — every table, keyed to auth.uid()
-- ---------------------------------------------------------------------

do $$
declare t text;
begin
  foreach t in array array[
    'profiles','income_streams','budget_categories','debts','school_fees',
    'bank_accounts','scheduled_payments','statement_uploads','transactions',
    'category_rules','checklist_items','notification_prefs','notification_log'
  ]
  loop
    execute format('alter table public.%I enable row level security', t);
    execute format('alter table public.%I force row level security', t);

    -- Separate policies per command, each with an explicit role, so the
    -- intent is auditable rather than hidden behind FOR ALL.
    execute format($p$
      create policy %I on public.%I for select to authenticated
      using ((select auth.uid()) = user_id)$p$, t || '_select', t);

    execute format($p$
      create policy %I on public.%I for insert to authenticated
      with check ((select auth.uid()) = user_id)$p$, t || '_insert', t);

    execute format($p$
      create policy %I on public.%I for update to authenticated
      using ((select auth.uid()) = user_id)
      with check ((select auth.uid()) = user_id)$p$, t || '_update', t);

    execute format($p$
      create policy %I on public.%I for delete to authenticated
      using ((select auth.uid()) = user_id)$p$, t || '_delete', t);
  end loop;
end $$;
