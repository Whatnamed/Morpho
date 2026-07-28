-- Forward-only Agent Turn Closure hardening.
-- Stores only execution flags, opaque identifiers, hashes and terminal state.

alter table private.ai_agent_turn_leases
  add column if not exists tool_execution_started boolean not null default false,
  add column if not exists closure_request_id text,
  add column if not exists closure_request_hash text,
  add column if not exists closure_outcome text;

alter table private.ai_agent_turn_leases
  drop constraint if exists ai_agent_turn_leases_closure_request_id_check,
  add constraint ai_agent_turn_leases_closure_request_id_check
    check (
      closure_request_id is null or (
        char_length(closure_request_id) between 1 and 160 and
        closure_request_id ~ '^[A-Za-z0-9._:-]+$'
      )
    ),
  drop constraint if exists ai_agent_turn_leases_closure_request_hash_check,
  add constraint ai_agent_turn_leases_closure_request_hash_check
    check (closure_request_hash is null or closure_request_hash ~ '^[0-9a-f]{64}$'),
  drop constraint if exists ai_agent_turn_leases_closure_outcome_check,
  add constraint ai_agent_turn_leases_closure_outcome_check
    check (
      closure_outcome is null or closure_outcome in (
        'success',
        'cancelledBeforeExecution',
        'failedBeforeExecution',
        'partialSuccess',
        'pendingConfirmation'
      )
    ),
  drop constraint if exists ai_agent_turn_leases_closure_fields_together_check,
  add constraint ai_agent_turn_leases_closure_fields_together_check
    check (
      (closure_request_id is null and closure_request_hash is null and closure_outcome is null) or
      (closure_request_id is not null and closure_request_hash is not null and closure_outcome is not null)
    );

create or replace function public.mark_agent_turn_tool_execution_started(
  p_lease_id uuid,
  p_agent_turn_id text
)
returns table (
  marked boolean,
  denial_reason text
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
  if p_lease_id is null or p_agent_turn_id is null or
    char_length(p_agent_turn_id) not between 1 and 160 or
    p_agent_turn_id !~ '^[A-Za-z0-9._:-]+$' then
    raise exception 'invalid agent tool execution input' using errcode = '22023';
  end if;

  select lease.* into lease_row
  from private.ai_agent_turn_leases as lease
  where lease.id = p_lease_id
  for update;

  if not found or lease_row.user_id <> current_user_id or lease_row.agent_turn_id <> p_agent_turn_id then
    return query select false, 'invalid_lease';
    return;
  end if;
  if lease_row.status <> 'active' or lease_row.expires_at <= now() then
    return query select false, 'closed';
    return;
  end if;

  update private.ai_agent_turn_leases as lease
  set tool_execution_started = true
  where lease.id = lease_row.id;
  return query select true, null::text;
end;
$$;

drop function if exists public.complete_agent_turn_lease(uuid, text, text);

create or replace function public.complete_agent_turn_lease(
  p_lease_id uuid,
  p_agent_turn_id text,
  p_outcome text,
  p_closure_request_id text,
  p_closure_request_hash text
)
returns table (
  completed boolean,
  status_name text,
  replayed boolean,
  denial_reason text
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
  if p_lease_id is null or p_agent_turn_id is null or
    char_length(p_agent_turn_id) not between 1 and 160 or
    p_agent_turn_id !~ '^[A-Za-z0-9._:-]+$' or
    p_closure_request_id is null or char_length(p_closure_request_id) not between 1 and 160 or
    p_closure_request_id !~ '^[A-Za-z0-9._:-]+$' or
    p_closure_request_hash is null or p_closure_request_hash !~ '^[0-9a-f]{64}$' or
    p_outcome not in (
      'success', 'cancelledBeforeExecution', 'failedBeforeExecution',
      'partialSuccess', 'pendingConfirmation'
    ) then
    raise exception 'invalid agent turn closure input' using errcode = '22023';
  end if;

  select lease.* into lease_row
  from private.ai_agent_turn_leases as lease
  where lease.id = p_lease_id
  for update;

  if not found or lease_row.user_id <> current_user_id or lease_row.agent_turn_id <> p_agent_turn_id then
    return query select false, 'invalid_lease', false, 'invalid_lease';
    return;
  end if;

  if lease_row.closure_request_id is not null then
    if lease_row.closure_request_id = p_closure_request_id and
      lease_row.closure_request_hash = p_closure_request_hash and
      lease_row.closure_outcome = p_outcome then
      return query select true, lease_row.status, true, null::text;
    else
      return query select false, lease_row.status, false, 'closure_conflict';
    end if;
    return;
  end if;

  if lease_row.status <> 'active' then
    return query select false, lease_row.status, false, 'closed_without_closure';
    return;
  end if;

  if p_outcome in ('cancelledBeforeExecution', 'failedBeforeExecution') and (
    lease_row.provider_call_count > 0 or
    lease_row.web_search_call_count > 0 or
    lease_row.tool_execution_started
  ) then
    return query select false, lease_row.status, false, 'execution_already_started';
    return;
  end if;

  update private.ai_agent_turn_leases as lease
  set
    status = p_outcome,
    terminal_outcome = p_outcome,
    closure_request_id = p_closure_request_id,
    closure_request_hash = p_closure_request_hash,
    closure_outcome = p_outcome,
    completed_at = now()
  where lease.id = lease_row.id
  returning lease.* into lease_row;

  return query select true, lease_row.status, false, null::text;
end;
$$;

create or replace function public.read_agent_turn_closure_state(
  p_lease_id uuid,
  p_agent_turn_id text,
  p_closure_request_id text,
  p_closure_request_hash text
)
returns table (
  state_name text,
  status_name text,
  closure_outcome text
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
  if p_lease_id is null or p_agent_turn_id is null or
    char_length(p_agent_turn_id) not between 1 and 160 or
    p_agent_turn_id !~ '^[A-Za-z0-9._:-]+$' or
    p_closure_request_id is null or char_length(p_closure_request_id) not between 1 and 160 or
    p_closure_request_id !~ '^[A-Za-z0-9._:-]+$' or
    p_closure_request_hash is null or p_closure_request_hash !~ '^[0-9a-f]{64}$' then
    raise exception 'invalid agent turn closure state input' using errcode = '22023';
  end if;

  select lease.* into lease_row
  from private.ai_agent_turn_leases as lease
  where lease.id = p_lease_id
    and lease.user_id = current_user_id
    and lease.agent_turn_id = p_agent_turn_id;

  if not found then
    return query select 'invalid_lease', null::text, null::text;
  elsif lease_row.closure_request_id is null then
    return query select 'none', lease_row.status, null::text;
  elsif lease_row.closure_request_id = p_closure_request_id and
    lease_row.closure_request_hash = p_closure_request_hash then
    return query select 'match', lease_row.status, lease_row.closure_outcome;
  else
    return query select 'conflict', lease_row.status, lease_row.closure_outcome;
  end if;
end;
$$;

revoke all on function public.mark_agent_turn_tool_execution_started(uuid, text)
  from public, anon, authenticated;
revoke all on function public.complete_agent_turn_lease(uuid, text, text, text, text)
  from public, anon, authenticated;
revoke all on function public.read_agent_turn_closure_state(uuid, text, text, text)
  from public, anon, authenticated;
grant execute on function public.mark_agent_turn_tool_execution_started(uuid, text) to authenticated;
grant execute on function public.complete_agent_turn_lease(uuid, text, text, text, text) to authenticated;
grant execute on function public.read_agent_turn_closure_state(uuid, text, text, text) to authenticated;
