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
  on conflict on constraint ai_daily_usage_pkey do nothing;

  select daily_usage.*
  into usage_row
  from public.ai_daily_usage as daily_usage
  where daily_usage.user_id = current_user_id and daily_usage.usage_date = today
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
    update public.ai_daily_usage as daily_usage
    set text_request_count = daily_usage.text_request_count + 1
    where daily_usage.user_id = current_user_id and daily_usage.usage_date = today
    returning daily_usage.* into usage_row;
  else
    update public.ai_daily_usage as daily_usage
    set image_request_count = daily_usage.image_request_count + 1
    where daily_usage.user_id = current_user_id and daily_usage.usage_date = today
    returning daily_usage.* into usage_row;
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

revoke all on function public.reserve_ai_daily_quota(text) from public;
grant execute on function public.reserve_ai_daily_quota(text) to authenticated;
