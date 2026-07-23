create or replace function public.start_agent_turn_lease(p_agent_turn_id text)
returns table (
  allowed boolean,
  denial_reason text,
  lease_id uuid,
  expires_at timestamptz,
  provider_call_count integer,
  web_search_call_count integer,
  text_request_count integer
)
language plpgsql
security definer
set search_path = ''
as $$
declare
  current_user_id uuid := auth.uid();
  access_row public.app_user_access%rowtype;
  usage_row public.ai_daily_usage%rowtype;
  existing_lease private.ai_agent_turn_leases%rowtype;
  created_lease private.ai_agent_turn_leases%rowtype;
  today date := (now() at time zone 'Asia/Shanghai')::date;
begin
  if current_user_id is null then
    raise exception 'not authenticated' using errcode = '28000';
  end if;
  if p_agent_turn_id is null or char_length(p_agent_turn_id) not between 1 and 160 or
    p_agent_turn_id !~ '^[A-Za-z0-9._:-]+$' then
    raise exception 'invalid agent turn id' using errcode = '22023';
  end if;

  update private.ai_agent_turn_leases as lease
  set status = 'timedOut', terminal_outcome = 'timedOut', completed_at = now()
  where lease.user_id = current_user_id and lease.status = 'active' and lease.expires_at <= now();

  select * into access_row
  from public.app_user_access
  where user_id = current_user_id;

  if not found then
    return query select false, 'pending', null::uuid, null::timestamptz, 0, 0, 0;
    return;
  end if;
  if access_row.status <> 'active' then
    return query select false, access_row.status, null::uuid, null::timestamptz, 0, 0, 0;
    return;
  end if;

  insert into public.ai_daily_usage (user_id, usage_date)
  values (current_user_id, today)
  on conflict on constraint ai_daily_usage_pkey do nothing;

  select daily_usage.* into usage_row
  from public.ai_daily_usage as daily_usage
  where daily_usage.user_id = current_user_id and daily_usage.usage_date = today
  for update;

  select lease.* into existing_lease
  from private.ai_agent_turn_leases as lease
  where lease.user_id = current_user_id and lease.agent_turn_id = p_agent_turn_id
  for update;

  if found then
    return query
    select false, 'turn_exists', existing_lease.id, existing_lease.expires_at,
      existing_lease.provider_call_count, existing_lease.web_search_call_count,
      usage_row.text_request_count;
    return;
  end if;
  if usage_row.text_request_count >= access_row.daily_text_limit then
    return query
    select false, 'quota_exceeded', null::uuid, null::timestamptz, 0, 0,
      usage_row.text_request_count;
    return;
  end if;

  update public.ai_daily_usage as daily_usage
  set text_request_count = daily_usage.text_request_count + 1
  where daily_usage.user_id = current_user_id and daily_usage.usage_date = today
  returning daily_usage.* into usage_row;

  insert into private.ai_agent_turn_leases (
    user_id,
    agent_turn_id,
    expires_at,
    provider_call_count,
    web_search_call_count
  ) values (
    current_user_id,
    p_agent_turn_id,
    now() + interval '20 minutes',
    1,
    0
  )
  returning * into created_lease;

  return query
  select true, null::text, created_lease.id, created_lease.expires_at,
    created_lease.provider_call_count, created_lease.web_search_call_count,
    usage_row.text_request_count;
end;
$$;

create or replace function public.continue_agent_turn_lease(
  p_lease_id uuid,
  p_agent_turn_id text,
  p_call_kind text
)
returns table (
  allowed boolean,
  denial_reason text,
  lease_id uuid,
  expires_at timestamptz,
  provider_call_count integer,
  web_search_call_count integer
)
language plpgsql
security definer
set search_path = ''
as $$
declare
  current_user_id uuid := auth.uid();
  lease_row private.ai_agent_turn_leases%rowtype;
begin
  if current_user_id is null then
    raise exception 'not authenticated' using errcode = '28000';
  end if;
  if p_call_kind not in ('provider', 'web_search') then
    raise exception 'invalid lease call kind' using errcode = '22023';
  end if;

  select lease.* into lease_row
  from private.ai_agent_turn_leases as lease
  where lease.id = p_lease_id
  for update;

  if not found or lease_row.user_id <> current_user_id or lease_row.agent_turn_id <> p_agent_turn_id then
    return query select false, 'invalid_lease', null::uuid, null::timestamptz, 0, 0;
    return;
  end if;
  if lease_row.status <> 'active' then
    return query select false, 'closed', lease_row.id, lease_row.expires_at,
      lease_row.provider_call_count, lease_row.web_search_call_count;
    return;
  end if;
  if lease_row.expires_at <= now() then
    update private.ai_agent_turn_leases as lease
    set status = 'timedOut', terminal_outcome = 'timedOut', completed_at = now()
    where lease.id = lease_row.id
    returning lease.* into lease_row;
    return query select false, 'expired', lease_row.id, lease_row.expires_at,
      lease_row.provider_call_count, lease_row.web_search_call_count;
    return;
  end if;
  if p_call_kind = 'provider' and lease_row.provider_call_count >= 32 then
    return query select false, 'provider_limit', lease_row.id, lease_row.expires_at,
      lease_row.provider_call_count, lease_row.web_search_call_count;
    return;
  end if;
  if p_call_kind = 'web_search' and lease_row.web_search_call_count >= 8 then
    return query select false, 'web_search_limit', lease_row.id, lease_row.expires_at,
      lease_row.provider_call_count, lease_row.web_search_call_count;
    return;
  end if;

  update private.ai_agent_turn_leases as lease
  set
    provider_call_count = lease.provider_call_count + case when p_call_kind = 'provider' then 1 else 0 end,
    web_search_call_count = lease.web_search_call_count + case when p_call_kind = 'web_search' then 1 else 0 end
  where lease.id = lease_row.id
  returning lease.* into lease_row;

  return query select true, null::text, lease_row.id, lease_row.expires_at,
    lease_row.provider_call_count, lease_row.web_search_call_count;
end;
$$;

revoke all on function public.start_agent_turn_lease(text) from public, anon, authenticated;
revoke all on function public.continue_agent_turn_lease(uuid, text, text) from public, anon, authenticated;
grant execute on function public.start_agent_turn_lease(text) to authenticated;
grant execute on function public.continue_agent_turn_lease(uuid, text, text) to authenticated;
