-- Forward-only hardening for A+ Journal admission and External Action access.
-- Existing RPC bodies remain the compatibility implementation, but are moved
-- behind private wrappers so every public entry point gets the new checks.

create index if not exists agent_turn_journal_user_created_idx
on private.agent_turn_journal (user_id, created_at desc);

create index if not exists agent_turn_journal_user_status_updated_idx
on private.agent_turn_journal (user_id, server_execution_status, updated_at desc);

alter function public.create_agent_turn_journal(text, text) set schema private;
alter function private.create_agent_turn_journal(text, text)
  rename to create_agent_turn_journal_unchecked_20260729;
revoke all on function private.create_agent_turn_journal_unchecked_20260729(text, text)
  from public, anon, authenticated;

create or replace function public.create_agent_turn_journal(
  p_local_project_id text,
  p_creation_idempotency_key text
)
returns table (
  decision text,
  denial_reason text,
  server_turn_id uuid,
  local_project_id text,
  status_name text,
  latest_request_id text,
  latest_step_sequence integer,
  provider_call_count integer,
  web_search_call_count integer,
  image_call_count integer,
  created_at timestamptz,
  updated_at timestamptz,
  terminal_at timestamptz,
  failure_code text
)
language plpgsql
security definer
set search_path = ''
as $$
declare
  current_user_id uuid := auth.uid();
  current_access_status text;
  existing_row private.agent_turn_journal%rowtype;
  active_turn_count bigint;
  recent_creation_count bigint;
  retained_turn_count bigint;
  abandoned_turn_ids uuid[] := array[]::uuid[];
  denial text;
  observed_at timestamptz := now();
begin
  if current_user_id is null then
    raise exception 'not authenticated' using errcode = '28000';
  end if;

  select access.status into current_access_status
  from public.app_user_access as access
  where access.user_id = current_user_id
  for share;

  if current_access_status is distinct from 'active' then
    denial := case when current_access_status = 'blocked' then 'blocked' else 'pending' end;
    return query select
      'denied'::text, denial, '00000000-0000-0000-0000-000000000000'::uuid,
      coalesce(p_local_project_id, ''), 'created'::text, null::text, 0, 0, 0, 0,
      observed_at, observed_at, null::timestamptz, null::text;
    return;
  end if;

  -- Serialize the count checks and the nested insert per user.
  perform pg_catalog.pg_advisory_xact_lock(
    pg_catalog.hashtextextended(current_user_id::text, 0)
  );

  -- A stale non-terminal Turn is first converged to a terminal tombstone. Its
  -- identity must remain queryable so a durable browser Recovery Record can
  -- close deterministically without replaying external work. Tombstones and
  -- other terminal history are physically removed only after 30 days.
  select coalesce(array_agg(stale.server_turn_id), array[]::uuid[])
  into abandoned_turn_ids
  from (
    select journal.server_turn_id
    from private.agent_turn_journal as journal
    where journal.user_id = current_user_id
      and journal.terminal_at is null
      and journal.updated_at < observed_at - interval '24 hours'
    for update
  ) as stale;

  update private.agent_turn_external_action_journal as action
  set execution_status = 'externally_failed',
      bounded_failure_code = 'turn_abandoned',
      result_receipt = null,
      receipt_expires_at = null,
      terminal_at = observed_at,
      updated_at = observed_at
  where action.server_turn_id = any(abandoned_turn_ids)
    and action.execution_status = 'running';

  delete from private.agent_turn_external_action_claim as claim
  where claim.server_turn_id = any(abandoned_turn_ids);

  update private.agent_turn_request_journal as request
  set execution_status = 'externally_failed',
      bounded_failure_code = 'turn_abandoned',
      terminal_at = observed_at,
      updated_at = observed_at
  where request.server_turn_id = any(abandoned_turn_ids)
    and request.execution_status in ('provider_running', 'awaiting_next_request');

  update private.agent_turn_journal as journal
  set server_execution_status = 'externally_failed',
      bounded_failure_code = 'turn_abandoned',
      terminal_at = observed_at,
      updated_at = observed_at,
      revision = journal.revision + 1
  where journal.server_turn_id = any(abandoned_turn_ids)
    and journal.terminal_at is null;

  delete from private.agent_turn_journal as journal
  where journal.user_id = current_user_id
    and journal.terminal_at is not null
    and journal.terminal_at < observed_at - interval '30 days';

  select journal.* into existing_row
  from private.agent_turn_journal as journal
  where journal.user_id = current_user_id
    and journal.creation_idempotency_key = p_creation_idempotency_key
  for update;

  if found then
    return query select *
    from private.create_agent_turn_journal_unchecked_20260729(
      p_local_project_id,
      p_creation_idempotency_key
    );
    return;
  end if;

  select
    count(*) filter (where journal.server_execution_status in (
      'created', 'provider_running', 'awaiting_next_request'
    )),
    count(*) filter (where journal.created_at >= observed_at - interval '1 hour'),
    count(*)
  into active_turn_count, recent_creation_count, retained_turn_count
  from private.agent_turn_journal as journal
  where journal.user_id = current_user_id;

  denial := case
    when active_turn_count >= 16 then 'active_turn_limit'
    when recent_creation_count >= 120 then 'creation_rate_limit'
    when retained_turn_count >= 2000 then 'journal_capacity_limit'
    else null
  end;
  if denial is not null then
    return query select
      'denied'::text, denial, '00000000-0000-0000-0000-000000000000'::uuid,
      p_local_project_id, 'created'::text, null::text, 0, 0, 0, 0,
      observed_at, observed_at, null::timestamptz, null::text;
    return;
  end if;

  return query select *
  from private.create_agent_turn_journal_unchecked_20260729(
    p_local_project_id,
    p_creation_idempotency_key
  );
end;
$$;

revoke all on function public.create_agent_turn_journal(text, text)
  from public, anon, authenticated;
grant execute on function public.create_agent_turn_journal(text, text)
  to authenticated;

alter function public.acquire_agent_turn_external_action(
  uuid, text, text, integer, text, text, text, text, text
) set schema private;
alter function private.acquire_agent_turn_external_action(
  uuid, text, text, integer, text, text, text, text, text
) rename to acquire_agent_turn_external_action_unchecked_20260729;
revoke all on function private.acquire_agent_turn_external_action_unchecked_20260729(
  uuid, text, text, integer, text, text, text, text, text
) from public, anon, authenticated;

create or replace function public.acquire_agent_turn_external_action(
  p_server_turn_id uuid,
  p_local_project_id text,
  p_request_id text,
  p_step_sequence integer,
  p_action_id text,
  p_action_kind text,
  p_action_hash text,
  p_claim_call_id text default null,
  p_claim_hash text default null
)
returns table (
  decision text,
  denial_reason text,
  server_turn_id uuid,
  request_id text,
  step_sequence integer,
  action_id text,
  action_kind text,
  status_name text,
  created_at timestamptz,
  updated_at timestamptz,
  terminal_at timestamptz,
  failure_code text,
  result_receipt jsonb
)
language plpgsql
security definer
set search_path = ''
as $$
declare
  current_user_id uuid := auth.uid();
  current_access_status text;
  denial text;
  observed_at timestamptz := now();
begin
  if current_user_id is null then
    raise exception 'not authenticated' using errcode = '28000';
  end if;

  select access.status into current_access_status
  from public.app_user_access as access
  where access.user_id = current_user_id
  for share;

  if current_access_status is distinct from 'active' then
    denial := case when current_access_status = 'blocked' then 'blocked' else 'pending' end;
    return query select
      'denied'::text, denial, p_server_turn_id, p_request_id, p_step_sequence,
      p_action_id, coalesce(p_action_kind, ''), 'running'::text,
      observed_at, observed_at, null::timestamptz, null::text, null::jsonb;
    return;
  end if;

  return query select *
  from private.acquire_agent_turn_external_action_unchecked_20260729(
    p_server_turn_id,
    p_local_project_id,
    p_request_id,
    p_step_sequence,
    p_action_id,
    p_action_kind,
    p_action_hash,
    p_claim_call_id,
    p_claim_hash
  );
end;
$$;

revoke all on function public.acquire_agent_turn_external_action(
  uuid, text, text, integer, text, text, text, text, text
) from public, anon, authenticated;
grant execute on function public.acquire_agent_turn_external_action(
  uuid, text, text, integer, text, text, text, text, text
) to authenticated;

create or replace function private.invalidate_agent_turn_actions_on_access_revocation()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  if old.status = 'active' and new.status <> 'active' then
    update private.agent_turn_external_action_journal as action
    set execution_status = 'externally_failed',
        bounded_failure_code = 'access_revoked',
        terminal_at = now(),
        updated_at = now()
    from private.agent_turn_journal as turn_record
    where turn_record.server_turn_id = action.server_turn_id
      and turn_record.user_id = new.user_id
      and action.execution_status = 'running';

    delete from private.agent_turn_external_action_claim as claim
    using private.agent_turn_journal as turn_record
    where turn_record.server_turn_id = claim.server_turn_id
      and turn_record.user_id = new.user_id;
  end if;
  return new;
end;
$$;

revoke all on function private.invalidate_agent_turn_actions_on_access_revocation()
  from public, anon, authenticated;

drop trigger if exists invalidate_agent_turn_actions_on_access_revocation
on public.app_user_access;
create trigger invalidate_agent_turn_actions_on_access_revocation
after update of status on public.app_user_access
for each row
execute function private.invalidate_agent_turn_actions_on_access_revocation();
