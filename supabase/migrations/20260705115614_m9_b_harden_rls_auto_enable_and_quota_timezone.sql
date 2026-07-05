do $$
begin
  if to_regprocedure('public.rls_auto_enable()') is not null then
    execute 'revoke execute on function public.rls_auto_enable() from public';
    execute 'revoke execute on function public.rls_auto_enable() from anon';
    execute 'revoke execute on function public.rls_auto_enable() from authenticated';
  end if;
end;
$$;

alter table public.ai_daily_usage
alter column usage_date set default ((now() at time zone 'Asia/Shanghai')::date);

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
  today date := (now() at time zone 'Asia/Shanghai')::date;
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
      today as usage_date
    from (select current_user_id as user_id) base
    left join public.ai_daily_usage u on u.user_id = base.user_id and u.usage_date = today
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
  today date := (now() at time zone 'Asia/Shanghai')::date;
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

revoke all on function public.get_my_access_state() from public;
revoke all on function public.reserve_ai_daily_quota(text) from public;
grant execute on function public.get_my_access_state() to authenticated;
grant execute on function public.reserve_ai_daily_quota(text) to authenticated;
