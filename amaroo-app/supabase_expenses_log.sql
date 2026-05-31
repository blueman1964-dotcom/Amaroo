-- Expenses Log
-- Run this in the Supabase SQL editor: https://supabase.com/dashboard/project/toxyrffojkmxldccolzb/sql

create table if not exists public.expenses_log (
  id          bigint generated always as identity primary key,
  vessel_id   text not null default 'amaroo',
  date        date,
  description text,
  category    text,   -- registration, insurance, marina, haulout, chandlery, provisioning, other
  supplier    text,
  amount_aud  numeric(10,2),
  invoice_number text,
  notes       text,
  attachment_url text,
  created_at  timestamptz not null default now()
);

alter table public.expenses_log enable row level security;
create policy "Allow all" on public.expenses_log for all using (true) with check (true);
