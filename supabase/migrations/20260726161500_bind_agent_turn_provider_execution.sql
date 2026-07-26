-- Forward-only follow-up to 20260726143030_harden_agent_turn_lease_causality.sql.
--
-- 1. A repeated first request with an identical initial hash no longer returns the
--    existing lease untouched. The route still executes a real Provider call on that
--    path, so the lease must count it: provider_call_count and next_provider_sequence
--    advance atomically, the daily text quota is still charged only once per turn, and
--    the 32-call safety ceiling now bounds real executions instead of lease rows.
--    Advancing the sequence also invalidates the superseded attempt's continuations.
-- 2. `postCompaction` becomes an explicit continuation kind so a fresh transcript built
--    after a conversation summary is no longer recorded as an exact Provider transcript
--    continuation. It stays a Provider call for counting and ceiling purposes.

alter table private.ai_agent_turn_leases
  drop constraint if exists ai_agent_turn_leases_continuation_kind_check;

alter table private.ai_agent_turn_leases
  add constraint ai_agent_turn_leases_continuation_kind_check
    check (
      last_continuation_kind is null or
      last_continuation_kind in (
        'providerContinuation',
        'conversationSummary',
        'webSearch',
        'postCompaction'
      )
    );

create or replace function public.start_agent_turn_lease(
  p_agent_turn_id text,
  p_initial_request_hash text,
  p_request_manifest_hash text,
  p_runtime_item_id text
)
returns table (
  allowed boolean,
  denial_reason text,
  lease_id uuid,
  expires_at timestamptz,
  provider_call_count integer,
  web_search_call_count integer,
  next_provider_sequence integer,
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
    p_agent_turn_id !~ '^[A-Za-z0-9._:-]+$' or
    p_runtime_item_id is null or char_length(p_runtime_item_id) not between 1 and 160 or
    p_runtime_item_id !~ '^[A-Za-z0-9._:-]+$' or
    p_initial_request_hash is null or p_initial_request_hash !~ '^[0-9a-f]{64}$' or
    p_request_manifest_hash is null or p_request_manifest_hash !~ '^[0-9a-f]{64}$' then
    raise exception 'invalid agent turn lease input' using errcode = '22023';
  end if;

  perform pg_catalog.pg_advisory_xact_lock(
    pg_catalog.hashtextextended(current_user_id::text || ':' || p_agent_turn_id, 0)
  );

  update private.ai_agent_turn_leases as lease
  set status = 'timedOut', terminal_outcome = 'timedOut', completed_at = now()
  where lease.user_id = current_user_id and lease.status = 'active' and lease.expires_at <= now();

  select lease.* into existing_lease
  from private.ai_agent_turn_leases as lease
  where lease.user_id = current_user_id and lease.agent_turn_id = p_agent_turn_id
  for update;

  if found then
    if existing_lease.status = 'active' and
      existing_lease.initial_request_hash = p_initial_request_hash then
      select daily_usage.* into usage_row
      from public.ai_daily_usage as daily_usage
      where daily_usage.user_id = current_user_id and daily_usage.usage_date = today;

      -- A retry of the same first request is a real Provider execution, not a free
      -- lookup. Bound it by the same ceiling as continuations before granting it.
      if existing_lease.provider_call_count >= 32 then
        return query
        select false, 'provider_limit', existing_lease.id, existing_lease.expires_at,
          existing_lease.provider_call_count, existing_lease.web_search_call_count,
          existing_lease.next_provider_sequence, coalesce(usage_row.text_request_count, 0);
        return;
      end if;

      update private.ai_agent_turn_leases as lease
      set
        provider_call_count = lease.provider_call_count + 1,
        next_provider_sequence = lease.next_provider_sequence + 1,
        last_request_hash = p_initial_request_hash,
        last_request_manifest_hash = p_request_manifest_hash,
        last_runtime_item_id = p_runtime_item_id,
        last_continuation_kind = null
      where lease.id = existing_lease.id
      returning lease.* into existing_lease;

      return query
      select true, null::text, existing_lease.id, existing_lease.expires_at,
        existing_lease.provider_call_count, existing_lease.web_search_call_count,
        existing_lease.next_provider_sequence, coalesce(usage_row.text_request_count, 0);
      return;
    end if;
    return query
    select false,
      case when existing_lease.status = 'active' then 'request_hash_conflict' else 'closed' end,
      existing_lease.id, existing_lease.expires_at,
      existing_lease.provider_call_count, existing_lease.web_search_call_count,
      existing_lease.next_provider_sequence, 0;
    return;
  end if;

  select * into access_row
  from public.app_user_access
  where user_id = current_user_id;
  if not found then
    return query select false, 'pending', null::uuid, null::timestamptz, 0, 0, 1, 0;
    return;
  end if;
  if access_row.status <> 'active' then
    return query select false, access_row.status, null::uuid, null::timestamptz, 0, 0, 1, 0;
    return;
  end if;

  insert into public.ai_daily_usage (user_id, usage_date)
  values (current_user_id, today)
  on conflict on constraint ai_daily_usage_pkey do nothing;

  select daily_usage.* into usage_row
  from public.ai_daily_usage as daily_usage
  where daily_usage.user_id = current_user_id and daily_usage.usage_date = today
  for update;

  if usage_row.text_request_count >= access_row.daily_text_limit then
    return query
    select false, 'quota_exceeded', null::uuid, null::timestamptz, 0, 0, 1,
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
    web_search_call_count,
    initial_request_hash,
    last_request_hash,
    last_request_manifest_hash,
    next_provider_sequence,
    last_runtime_item_id
  ) values (
    current_user_id,
    p_agent_turn_id,
    now() + interval '20 minutes',
    1,
    0,
    p_initial_request_hash,
    p_initial_request_hash,
    p_request_manifest_hash,
    1,
    p_runtime_item_id
  )
  returning * into created_lease;

  return query
  select true, null::text, created_lease.id, created_lease.expires_at,
    created_lease.provider_call_count, created_lease.web_search_call_count,
    created_lease.next_provider_sequence, usage_row.text_request_count;
end;
$$;

create or replace function public.continue_agent_turn_lease(
  p_lease_id uuid,
  p_agent_turn_id text,
  p_continuation_kind text,
  p_expected_sequence integer,
  p_request_hash text,
  p_request_manifest_hash text,
  p_runtime_item_id text default null
)
returns table (
  allowed boolean,
  denial_reason text,
  lease_id uuid,
  expires_at timestamptz,
  provider_call_count integer,
  web_search_call_count integer,
  next_provider_sequence integer
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
  if p_continuation_kind not in (
      'providerContinuation', 'conversationSummary', 'webSearch', 'postCompaction'
    ) or
    p_expected_sequence is null or p_expected_sequence not between 1 and 10000 or
    p_request_hash is null or p_request_hash !~ '^[0-9a-f]{64}$' or
    p_request_manifest_hash is null or p_request_manifest_hash !~ '^[0-9a-f]{64}$' or
    (p_runtime_item_id is not null and (
      char_length(p_runtime_item_id) not between 1 and 160 or
      p_runtime_item_id !~ '^[A-Za-z0-9._:-]+$'
    )) then
    raise exception 'invalid lease continuation input' using errcode = '22023';
  end if;
  if p_continuation_kind <> 'webSearch' and p_runtime_item_id is null then
    raise exception 'provider continuation requires runtime item' using errcode = '22023';
  end if;

  select lease.* into lease_row
  from private.ai_agent_turn_leases as lease
  where lease.id = p_lease_id
  for update;

  if not found or lease_row.user_id <> current_user_id or lease_row.agent_turn_id <> p_agent_turn_id then
    return query select false, 'invalid_lease', null::uuid, null::timestamptz, 0, 0, 0;
    return;
  end if;
  if lease_row.status <> 'active' then
    return query select false, 'closed', lease_row.id, lease_row.expires_at,
      lease_row.provider_call_count, lease_row.web_search_call_count, lease_row.next_provider_sequence;
    return;
  end if;
  if lease_row.expires_at <= now() then
    update private.ai_agent_turn_leases as lease
    set status = 'timedOut', terminal_outcome = 'timedOut', completed_at = now()
    where lease.id = lease_row.id
    returning lease.* into lease_row;
    return query select false, 'expired', lease_row.id, lease_row.expires_at,
      lease_row.provider_call_count, lease_row.web_search_call_count, lease_row.next_provider_sequence;
    return;
  end if;
  if p_expected_sequence < lease_row.next_provider_sequence then
    return query select false, 'sequence_replay', lease_row.id, lease_row.expires_at,
      lease_row.provider_call_count, lease_row.web_search_call_count, lease_row.next_provider_sequence;
    return;
  end if;
  if p_expected_sequence > lease_row.next_provider_sequence then
    return query select false, 'sequence_skip', lease_row.id, lease_row.expires_at,
      lease_row.provider_call_count, lease_row.web_search_call_count, lease_row.next_provider_sequence;
    return;
  end if;
  if p_continuation_kind <> 'webSearch' and lease_row.provider_call_count >= 32 then
    return query select false, 'provider_limit', lease_row.id, lease_row.expires_at,
      lease_row.provider_call_count, lease_row.web_search_call_count, lease_row.next_provider_sequence;
    return;
  end if;
  if p_continuation_kind = 'webSearch' and lease_row.web_search_call_count >= 32 then
    return query select false, 'web_search_limit', lease_row.id, lease_row.expires_at,
      lease_row.provider_call_count, lease_row.web_search_call_count, lease_row.next_provider_sequence;
    return;
  end if;

  update private.ai_agent_turn_leases as lease
  set
    provider_call_count = lease.provider_call_count +
      case when p_continuation_kind <> 'webSearch' then 1 else 0 end,
    web_search_call_count = lease.web_search_call_count +
      case when p_continuation_kind = 'webSearch' then 1 else 0 end,
    next_provider_sequence = lease.next_provider_sequence + 1,
    last_request_hash = p_request_hash,
    last_request_manifest_hash = p_request_manifest_hash,
    last_runtime_item_id = coalesce(p_runtime_item_id, lease.last_runtime_item_id),
    last_continuation_kind = p_continuation_kind
  where lease.id = lease_row.id
    and lease.next_provider_sequence = p_expected_sequence
  returning lease.* into lease_row;

  if not found then
    return query select false, 'sequence_replay', p_lease_id, null::timestamptz, 0, 0, 0;
    return;
  end if;

  return query select true, null::text, lease_row.id, lease_row.expires_at,
    lease_row.provider_call_count, lease_row.web_search_call_count, lease_row.next_provider_sequence;
end;
$$;

revoke all on function public.start_agent_turn_lease(text, text, text, text)
from public, anon;
revoke all on function public.continue_agent_turn_lease(uuid, text, text, integer, text, text, text)
from public, anon;

grant execute on function public.start_agent_turn_lease(text, text, text, text) to authenticated;
grant execute on function public.continue_agent_turn_lease(uuid, text, text, integer, text, text, text)
to authenticated;
