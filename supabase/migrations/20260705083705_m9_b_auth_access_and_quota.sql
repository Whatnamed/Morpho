create schema if not exists private;

create table if not exists public.app_user_access (
  user_id uuid primary key references auth.users(id) on delete cascade,
  role text not null default 'tester',
  status text not null default 'pending',
  daily_text_limit integer not null default 20,
  daily_image_limit integer not null default 4,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint app_user_access_role_check check (role in ('owner', 'tester')),
  constraint app_user_access_status_check check (status in ('pending', 'active', 'blocked')),
  constraint app_user_access_text_limit_check check (daily_text_limit >= 0),
  constraint app_user_access_image_limit_check check (daily_image_limit >= 0)
);

create table if not exists public.ai_daily_usage (
  user_id uuid not null references auth.users(id) on delete cascade,
  usage_date date not null default current_date,
  text_request_count integer not null default 0,
  image_request_count integer not null default 0,
  updated_at timestamptz not null default now(),
  primary key (user_id, usage_date),
  constraint ai_daily_usage_text_count_check check (text_request_count >= 0),
  constraint ai_daily_usage_image_count_check check (image_request_count >= 0)
);

alter table public.app_user_access enable row level security;
alter table public.ai_daily_usage enable row level security;

revoke all on table public.app_user_access from anon, authenticated;
revoke all on table public.ai_daily_usage from anon, authenticated;
grant select on table public.app_user_access to authenticated;
grant select on table public.ai_daily_usage to authenticated;

drop policy if exists "Users can read their own access record" on public.app_user_access;
create policy "Users can read their own access record"
on public.app_user_access
for select
to authenticated
using ((select auth.uid()) = user_id);

drop policy if exists "Users can read their own usage record" on public.ai_daily_usage;
create policy "Users can read their own usage record"
on public.ai_daily_usage
for select
to authenticated
using ((select auth.uid()) = user_id);

create or replace function private.touch_updated_at()
returns trigger
language plpgsql
set search_path = private, public, pg_temp
as $$
begin
  new.updated_at = now();
  return new;
end;
$$;

drop trigger if exists app_user_access_touch_updated_at on public.app_user_access;
create trigger app_user_access_touch_updated_at
before update on public.app_user_access
for each row
execute function private.touch_updated_at();

drop trigger if exists ai_daily_usage_touch_updated_at on public.ai_daily_usage;
create trigger ai_daily_usage_touch_updated_at
before update on public.ai_daily_usage
for each row
execute function private.touch_updated_at();

create or replace function private.create_pending_access_for_new_user()
returns trigger
language plpgsql
security definer
set search_path = private, public, pg_temp
as $$
begin
  insert into public.app_user_access (user_id, role, status, daily_text_limit, daily_image_limit)
  values (new.id, 'tester', 'pending', 20, 4)
  on conflict (user_id) do nothing;
  return new;
end;
$$;

drop trigger if exists create_pending_access_for_new_user on auth.users;
create trigger create_pending_access_for_new_user
after insert on auth.users
for each row
execute function private.create_pending_access_for_new_user();

create or replace function public.get_my_access_state()
returns table (
  role_name text,
  status_name text,
  daily_text_limit integer,
  daily_image_limit integer,
  text_request_count integer,
  image_request_count integer,
  usage_date date
)
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  current_user_id uuid := auth.uid();
begin
  if current_user_id is null then
    raise exception 'not authenticated' using errcode = '28000';
  end if;

  return query
  with access_row as (
    select
      coalesce(a.role, 'tester') as role_name,
      coalesce(a.status, 'pending') as status_name,
      coalesce(a.daily_text_limit, 20) as daily_text_limit,
      coalesce(a.daily_image_limit, 4) as daily_image_limit
    from (select current_user_id as user_id) u
    left join public.app_user_access a on a.user_id = u.user_id
  ),
  usage_row as (
    select
      coalesce(u.text_request_count, 0) as text_request_count,
      coalesce(u.image_request_count, 0) as image_request_count,
      current_date as usage_date
    from (select current_user_id as user_id) base
    left join public.ai_daily_usage u on u.user_id = base.user_id and u.usage_date = current_date
  )
  select
    access_row.role_name,
    access_row.status_name,
    access_row.daily_text_limit,
    access_row.daily_image_limit,
    usage_row.text_request_count,
    usage_row.image_request_count,
    usage_row.usage_date
  from access_row
  cross join usage_row;
end;
$$;

create or replace function public.reserve_ai_daily_quota(request_kind text)
returns table (
  allowed boolean,
  denial_reason text,
  role_name text,
  status_name text,
  daily_text_limit integer,
  daily_image_limit integer,
  text_request_count integer,
  image_request_count integer,
  usage_date date
)
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  current_user_id uuid := auth.uid();
  access_row public.app_user_access%rowtype;
  usage_row public.ai_daily_usage%rowtype;
  today date := current_date;
begin
  if current_user_id is null then
    raise exception 'not authenticated' using errcode = '28000';
  end if;

  if request_kind not in ('text', 'image') then
    raise exception 'invalid quota kind' using errcode = '22023';
  end if;

  select *
  into access_row
  from public.app_user_access
  where user_id = current_user_id;

  if not found then
    return query select false, 'pending', 'tester', 'pending', 20, 4, 0, 0, today;
    return;
  end if;

  insert into public.ai_daily_usage (user_id, usage_date)
  values (current_user_id, today)
  on conflict (user_id, usage_date) do nothing;

  select *
  into usage_row
  from public.ai_daily_usage
  where user_id = current_user_id and usage_date = today
  for update;

  if access_row.status <> 'active' then
    return query
    select
      false,
      access_row.status,
      access_row.role,
      access_row.status,
      access_row.daily_text_limit,
      access_row.daily_image_limit,
      usage_row.text_request_count,
      usage_row.image_request_count,
      today;
    return;
  end if;

  if request_kind = 'text' and usage_row.text_request_count >= access_row.daily_text_limit then
    return query
    select false, 'quota_exceeded', access_row.role, access_row.status, access_row.daily_text_limit, access_row.daily_image_limit, usage_row.text_request_count, usage_row.image_request_count, today;
    return;
  end if;

  if request_kind = 'image' and usage_row.image_request_count >= access_row.daily_image_limit then
    return query
    select false, 'quota_exceeded', access_row.role, access_row.status, access_row.daily_text_limit, access_row.daily_image_limit, usage_row.text_request_count, usage_row.image_request_count, today;
    return;
  end if;

  -- Attempts are counted once reserved. If the upstream provider later fails, the reservation is intentionally kept.
  if request_kind = 'text' then
    update public.ai_daily_usage
    set text_request_count = text_request_count + 1
    where user_id = current_user_id and usage_date = today
    returning * into usage_row;
  else
    update public.ai_daily_usage
    set image_request_count = image_request_count + 1
    where user_id = current_user_id and usage_date = today
    returning * into usage_row;
  end if;

  return query
  select
    true,
    null::text,
    access_row.role,
    access_row.status,
    access_row.daily_text_limit,
    access_row.daily_image_limit,
    usage_row.text_request_count,
    usage_row.image_request_count,
    today;
end;
$$;

revoke all on function private.touch_updated_at() from public;
revoke all on function private.create_pending_access_for_new_user() from public;
revoke all on function public.get_my_access_state() from public;
revoke all on function public.reserve_ai_daily_quota(text) from public;
grant execute on function public.get_my_access_state() to authenticated;
grant execute on function public.reserve_ai_daily_quota(text) to authenticated;
