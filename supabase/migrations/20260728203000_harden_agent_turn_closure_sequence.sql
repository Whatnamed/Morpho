-- Forward-only Agent Turn Closure sequencing and Provider-failure proof.
--
-- Closure proofs are valid only for the exact Provider sequence that created
-- them. A Provider transport failure is recorded under the same lease lock so
-- it can close an already-started turn without fabricating an execution proof.

alter table private.ai_agent_turn_leases
  add column if not exists closure_provider_sequence integer,
  add column if not exists provider_failure_outcome text,
  add column if not exists provider_failure_sequence integer;

-- Existing closures predate the sequence binding. Their current sequence is
-- immutable because the lease is already closed, so it is the only valid
-- historical binding for replay detection after this migration.
update private.ai_agent_turn_leases as lease
set closure_provider_sequence = lease.next_provider_sequence
where lease.closure_request_id is not null
  and lease.closure_provider_sequence is null;

alter table private.ai_agent_turn_leases
  drop constraint if exists ai_agent_turn_leases_status_check,
  add constraint ai_agent_turn_leases_status_check
    check (status in (
      'active',
      'success',
      'cancelledBeforeExecution',
      'failedBeforeExecution',
      'cancelledDuringProvider',
      'failedDuringProvider',
      'partialSuccess',
      'pendingConfirmation',
      'timedOut'
    )),
  drop constraint if exists ai_agent_turn_leases_closure_outcome_check,
  add constraint ai_agent_turn_leases_closure_outcome_check
    check (
      closure_outcome is null or closure_outcome in (
        'success',
        'cancelledBeforeExecution',
        'failedBeforeExecution',
        'cancelledDuringProvider',
        'failedDuringProvider',
        'partialSuccess',
        'pendingConfirmation'
      )
    ),
  drop constraint if exists ai_agent_turn_leases_closure_fields_together_check,
  add constraint ai_agent_turn_leases_closure_fields_together_check
    check (
      (
        closure_request_id is null and closure_request_hash is null and
        closure_outcome is null and closure_provider_sequence is null
      ) or (
        closure_request_id is not null and closure_request_hash is not null and
        closure_outcome is not null and closure_provider_sequence is not null and
        closure_provider_sequence between 0 and 10000
      )
    ),
  drop constraint if exists ai_agent_turn_leases_provider_failure_fields_together_check,
  add constraint ai_agent_turn_leases_provider_failure_fields_together_check
    check (
      (provider_failure_outcome is null and provider_failure_sequence is null) or
      (
        provider_failure_outcome is not null and provider_failure_sequence is not null and
        provider_failure_outcome in ('cancelledDuringProvider', 'failedDuringProvider') and
        provider_failure_sequence between 1 and 10000
      )
    );

create or replace function public.mark_agent_turn_provider_failure(
  p_lease_id uuid,
  p_agent_turn_id text,
  p_outcome text,
  p_expected_provider_sequence integer
)
returns table (
  marked boolean,
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
    p_outcome not in ('cancelledDuringProvider', 'failedDuringProvider') or
    p_expected_provider_sequence is null or
    p_expected_provider_sequence not between 1 and 10000 then
    raise exception 'invalid agent provider failure input' using errcode = '22023';
  end if;

  select lease.* into lease_row
  from private.ai_agent_turn_leases as lease
  where lease.id = p_lease_id
  for update;

  if not found or lease_row.user_id <> current_user_id or lease_row.agent_turn_id <> p_agent_turn_id then
    return query select false, false, 'invalid_lease';
    return;
  end if;
  if lease_row.provider_failure_outcome is not null then
    if lease_row.provider_failure_outcome = p_outcome and
      lease_row.provider_failure_sequence = p_expected_provider_sequence then
      return query select true, true, null::text;
    end if;
    return query select false, false, 'provider_failure_conflict';
    return;
  end if;
  if lease_row.status <> 'active' or lease_row.expires_at <= now() then
    return query select false, false, 'closed';
    return;
  end if;
  if lease_row.provider_call_count < 1 or
    lease_row.next_provider_sequence <> p_expected_provider_sequence then
    return query select false, false, 'sequence_conflict';
    return;
  end if;

  update private.ai_agent_turn_leases as lease
  set
    provider_failure_outcome = p_outcome,
    provider_failure_sequence = p_expected_provider_sequence
  where lease.id = lease_row.id
  returning lease.* into lease_row;

  return query select true, false, null::text;
end;
$$;

drop function if exists public.complete_agent_turn_lease(uuid, text, text, text, text);

create or replace function public.complete_agent_turn_lease(
  p_lease_id uuid,
  p_agent_turn_id text,
  p_outcome text,
  p_closure_request_id text,
  p_closure_request_hash text,
  p_expected_provider_sequence integer
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
    p_expected_provider_sequence is null or p_expected_provider_sequence not between 0 and 10000 or
    p_outcome not in (
      'success', 'cancelledBeforeExecution', 'failedBeforeExecution',
      'cancelledDuringProvider', 'failedDuringProvider',
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
      lease_row.closure_outcome = p_outcome and
      lease_row.closure_provider_sequence = p_expected_provider_sequence then
      return query select true, lease_row.status, true, null::text;
    end if;
    return query select false, lease_row.status, false, 'closure_conflict';
    return;
  end if;

  if lease_row.status <> 'active' or lease_row.expires_at <= now() then
    return query select false, lease_row.status, false, 'closed_without_closure';
    return;
  end if;

  if p_outcome in ('cancelledBeforeExecution', 'failedBeforeExecution') then
    if p_expected_provider_sequence <> 0 or lease_row.provider_call_count > 0 or
      lease_row.web_search_call_count > 0 or lease_row.tool_execution_started then
      return query select false, lease_row.status, false, 'execution_already_started';
      return;
    end if;
  elsif p_outcome in ('cancelledDuringProvider', 'failedDuringProvider') then
    if lease_row.next_provider_sequence <> p_expected_provider_sequence then
      return query select false, lease_row.status, false, 'sequence_conflict';
      return;
    end if;
    if lease_row.provider_failure_outcome is distinct from p_outcome or
      lease_row.provider_failure_sequence is distinct from p_expected_provider_sequence then
      return query select false, lease_row.status, false, 'provider_failure_unverified';
      return;
    end if;
  elsif p_expected_provider_sequence < 1 or
    lease_row.next_provider_sequence <> p_expected_provider_sequence then
    return query select false, lease_row.status, false, 'sequence_conflict';
    return;
  end if;

  update private.ai_agent_turn_leases as lease
  set
    status = p_outcome,
    terminal_outcome = p_outcome,
    closure_request_id = p_closure_request_id,
    closure_request_hash = p_closure_request_hash,
    closure_outcome = p_outcome,
    closure_provider_sequence = p_expected_provider_sequence,
    completed_at = now()
  where lease.id = lease_row.id
  returning lease.* into lease_row;

  return query select true, lease_row.status, false, null::text;
end;
$$;

revoke all on function public.mark_agent_turn_provider_failure(uuid, text, text, integer)
  from public, anon, authenticated;
revoke all on function public.complete_agent_turn_lease(uuid, text, text, text, text, integer)
  from public, anon, authenticated;
grant execute on function public.mark_agent_turn_provider_failure(uuid, text, text, integer) to authenticated;
grant execute on function public.complete_agent_turn_lease(uuid, text, text, text, text, integer) to authenticated;
