-- Blood Drive Manager (MBDMS) - Supabase / Postgres schema
-- Run once: Supabase Dashboard -> SQL Editor -> New query -> paste -> Run.
-- Safe to re-run; it is compatible with databases created by earlier versions.

create table if not exists public.activities (
  id     bigint generated always as identity primary key,
  name   text   not null,
  date   date   not null,
  venue  text   not null,
  status text   not null default 'Scheduled'
);

create table if not exists public.donors (
  id        bigint generated always as identity primary key,
  first     text not null,
  last      text not null,
  birthdate date not null,
  contact   text not null
);

create table if not exists public.screenings (
  id          bigint generated always as identity primary key,
  donor_id    bigint not null references public.donors(id)     on delete cascade,
  activity_id bigint not null references public.activities(id) on delete cascade,
  outcome     text   not null check (outcome in ('Cleared', 'Not cleared'))
);

create table if not exists public.donations (
  id          bigint generated always as identity primary key,
  donor_id    bigint not null references public.donors(id)     on delete cascade,
  activity_id bigint not null references public.activities(id) on delete cascade,
  status      text   not null default 'Completed',
  unique (donor_id, activity_id)
);

create index if not exists screenings_donor_activity_idx
  on public.screenings (donor_id, activity_id);

-- Data API access. Newer Supabase projects no longer auto-grant table access to the API
-- roles, so without these GRANTs every query fails with "permission denied" (42501)
-- even when SUPABASE_URL and the key are correct. Only the server-side service_role is
-- granted access; anon/authenticated get nothing.
grant usage on schema public to service_role;
grant select, insert, update, delete on
  public.activities, public.donors, public.screenings, public.donations
  to service_role;
grant usage, select on all sequences in schema public to service_role;

-- Security: RLS on with no policies => the public anon key can read/write nothing.
-- Only the server (service_role key) can access the data.
alter table public.activities enable row level security;
alter table public.donors     enable row level security;
alter table public.screenings enable row level security;
alter table public.donations  enable row level security;

-- Demo data, also used by the "Reset demo data" button.
create or replace function public.reset_demo_data()
returns void
language plpgsql
security definer          -- TRUNCATE is not covered by the table GRANTs above
set search_path = public
as $$
begin
  truncate table public.donations, public.screenings, public.donors, public.activities
    restart identity cascade;

  insert into public.activities (name, date, venue, status) values
    ('University Blood Donation Drive', '2026-11-15', 'University Activity Center', 'Scheduled'),
    ('Community Donation Drive',        '2026-11-22', 'Community Hall',             'Scheduled');

  insert into public.donors (first, last, birthdate, contact) values
    ('Maria', 'Santos',     '2000-05-10', '000-000-0001'),
    ('Juan',  'Dela Cruz',  '1999-08-20', '000-000-0002'),
    ('Ana',   'Reyes',      '2001-03-15', '000-000-0003');

  insert into public.screenings (donor_id, activity_id, outcome) values
    (1, 1, 'Cleared'),
    (2, 1, 'Not cleared');

  insert into public.donations (donor_id, activity_id, status) values
    (1, 1, 'Completed');
end;
$$;

revoke execute on function public.reset_demo_data() from public, anon, authenticated;
grant  execute on function public.reset_demo_data() to service_role;

-- Load demo data on first run only (tables empty).
do $$
begin
  if not exists (select 1 from public.activities)
     and not exists (select 1 from public.donors) then
    perform public.reset_demo_data();
  end if;
end $$;
