create table if not exists private.agent_turn_journal (
  server_turn_id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  local_project_id text not null,
  creation_idempotency_key text not null,
  server_execution_status text not null default 'created',
  latest_step_sequence integer not null default 0,
  latest_request_id text,
  latest_request_hash text,
  provider_call_count integer not null default 0,
  web_search_call_count integer not null default 0,
  image_call_count integer not null default 0,
  bounded_failure_code text,
  revision bigint not null default 0,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  terminal_at timestamptz,
  constraint agent_turn_journal_local_project_id_check
    check (char_length(local_project_id) between 1 and 160 and local_project_id ~ '^[A-Za-z0-9._:-]+$'),
  constraint agent_turn_journal_creation_key_check
    check (char_length(creation_idempotency_key) between 1 and 160 and creation_idempotency_key ~ '^[A-Za-z0-9._:-]+$'),
  constraint agent_turn_journal_status_check
    check (server_execution_status in (
      'created',
      'provider_running',
      'awaiting_next_request',
      'externally_completed',
      'externally_cancelled',
      'externally_failed'
    )),
  constraint agent_turn_journal_sequence_check
    check (latest_step_sequence between 0 and 10000),
  constraint agent_turn_journal_latest_request_check
    check (
      (latest_step_sequence = 0 and latest_request_id is null and latest_request_hash is null) or
      (
        latest_step_sequence > 0 and
        latest_request_id is not null and
        latest_request_hash is not null and
        char_length(latest_request_id) between 1 and 160 and
        latest_request_id ~ '^[A-Za-z0-9._:-]+$' and
        latest_request_hash ~ '^[0-9a-f]{64}$'
      )
    ),
  constraint agent_turn_journal_counters_check
    check (
      provider_call_count between 0 and 32 and
      web_search_call_count between 0 and 32 and
      image_call_count between 0 and 32
    ),
  constraint agent_turn_journal_failure_code_check
    check (
      bounded_failure_code is null or
      (
        char_length(bounded_failure_code) between 1 and 80 and
        bounded_failure_code ~ '^[A-Za-z0-9._:-]+$'
      )
    ),
  constraint agent_turn_journal_terminal_check
    check (
      (
        server_execution_status in ('externally_completed', 'externally_cancelled', 'externally_failed') and
        terminal_at is not null
      ) or
      (
        server_execution_status not in ('externally_completed', 'externally_cancelled', 'externally_failed') and
        terminal_at is null
      )
    ),
  constraint agent_turn_journal_failure_status_check
    check (
      (server_execution_status = 'externally_failed' and bounded_failure_code is not null) or
      (server_execution_status <> 'externally_failed' and bounded_failure_code is null)
    ),
  unique (user_id, creation_idempotency_key)
);

create index if not exists agent_turn_journal_user_turn_idx
on private.agent_turn_journal (user_id, server_turn_id);

create table if not exists private.agent_turn_request_journal (
  server_turn_id uuid not null references private.agent_turn_journal(server_turn_id) on delete cascade,
  request_id text not null,
  step_sequence integer not null,
  request_hash text not null,
  execution_status text not null default 'provider_running',
  bounded_failure_code text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  terminal_at timestamptz,
  primary key (server_turn_id, request_id),
  unique (server_turn_id, step_sequence),
  constraint agent_turn_request_id_check
    check (char_length(request_id) between 1 and 160 and request_id ~ '^[A-Za-z0-9._:-]+$'),
  constraint agent_turn_request_sequence_check
    check (step_sequence between 1 and 10000),
  constraint agent_turn_request_hash_check
    check (request_hash ~ '^[0-9a-f]{64}$'),
  constraint agent_turn_request_status_check
    check (execution_status in (
      'provider_running',
      'awaiting_next_request',
      'externally_completed',
      'externally_cancelled',
      'externally_failed'
    )),
  constraint agent_turn_request_failure_code_check
    check (
      bounded_failure_code is null or
      (
        char_length(bounded_failure_code) between 1 and 80 and
        bounded_failure_code ~ '^[A-Za-z0-9._:-]+$'
      )
    ),
  constraint agent_turn_request_terminal_check
    check (
      (
        execution_status in ('externally_completed', 'externally_cancelled', 'externally_failed') and
        terminal_at is not null
      ) or
      (
        execution_status not in ('externally_completed', 'externally_cancelled', 'externally_failed') and
        terminal_at is null
      )
    ),
  constraint agent_turn_request_failure_status_check
    check (
      (execution_status = 'externally_failed' and bounded_failure_code is not null) or
      (execution_status <> 'externally_failed' and bounded_failure_code is null)
    )
);

revoke all on table private.agent_turn_journal from public, anon, authenticated;
revoke all on table private.agent_turn_request_journal from public, anon, authenticated;

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
  journal_row private.agent_turn_journal%rowtype;
  result_decision text;
  result_denial text;
begin
  if current_user_id is null then
    raise exception 'not authenticated' using errcode = '28000';
  end if;
  if p_local_project_id is null or char_length(p_local_project_id) not between 1 and 160 or
    p_local_project_id !~ '^[A-Za-z0-9._:-]+$' or
    p_creation_idempotency_key is null or
    char_length(p_creation_idempotency_key) not between 1 and 160 or
    p_creation_idempotency_key !~ '^[A-Za-z0-9._:-]+$' then
    raise exception 'invalid journal identifier' using errcode = '22023';
  end if;

  insert into private.agent_turn_journal (
    user_id,
    local_project_id,
    creation_idempotency_key
  )
  values (
    current_user_id,
    p_local_project_id,
    p_creation_idempotency_key
  )
  on conflict (user_id, creation_idempotency_key) do nothing
  returning * into journal_row;

  if found then
    result_decision := 'created';
    result_denial := null;
  else
    select journal.*
    into journal_row
    from private.agent_turn_journal as journal
    where journal.user_id = current_user_id
      and journal.creation_idempotency_key = p_creation_idempotency_key
    for update;

    if journal_row.local_project_id <> p_local_project_id then
      result_decision := 'denied';
      result_denial := 'creation_key_conflict';
    else
      result_decision := 'replayed';
      result_denial := null;
    end if;
  end if;

  return query select
    result_decision,
    result_denial,
    journal_row.server_turn_id,
    case when result_denial is null then journal_row.local_project_id else p_local_project_id end,
    journal_row.server_execution_status,
    journal_row.latest_request_id,
    journal_row.latest_step_sequence,
    journal_row.provider_call_count,
    journal_row.web_search_call_count,
    journal_row.image_call_count,
    journal_row.created_at,
    journal_row.updated_at,
    journal_row.terminal_at,
    journal_row.bounded_failure_code;
end;
$$;

create or replace function public.read_agent_turn_journal(
  p_server_turn_id uuid,
  p_local_project_id text
)
returns table (
  visible boolean,
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
  journal_row private.agent_turn_journal%rowtype;
begin
  if current_user_id is null then
    raise exception 'not authenticated' using errcode = '28000';
  end if;

  select journal.*
  into journal_row
  from private.agent_turn_journal as journal
  where journal.server_turn_id = p_server_turn_id
    and journal.user_id = current_user_id
    and journal.local_project_id = p_local_project_id;

  if not found then
    return query select
      false,
      null::uuid,
      null::text,
      null::text,
      null::text,
      null::integer,
      null::integer,
      null::integer,
      null::integer,
      null::timestamptz,
      null::timestamptz,
      null::timestamptz,
      null::text;
    return;
  end if;

  return query select
    true,
    journal_row.server_turn_id,
    journal_row.local_project_id,
    journal_row.server_execution_status,
    journal_row.latest_request_id,
    journal_row.latest_step_sequence,
    journal_row.provider_call_count,
    journal_row.web_search_call_count,
    journal_row.image_call_count,
    journal_row.created_at,
    journal_row.updated_at,
    journal_row.terminal_at,
    journal_row.bounded_failure_code;
end;
$$;

create or replace function public.acquire_agent_turn_request(
  p_server_turn_id uuid,
  p_local_project_id text,
  p_request_id text,
  p_step_sequence integer,
  p_request_hash text
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
  journal_row private.agent_turn_journal%rowtype;
  request_by_id private.agent_turn_request_journal%rowtype;
  request_by_sequence private.agent_turn_request_journal%rowtype;
  quota_allowed boolean;
  quota_denial text;
  result_decision text := 'denied';
  result_denial text;
begin
  if current_user_id is null then
    raise exception 'not authenticated' using errcode = '28000';
  end if;
  if p_request_id is null or char_length(p_request_id) not between 1 and 160 or
    p_request_id !~ '^[A-Za-z0-9._:-]+$' or
    p_step_sequence is null or p_step_sequence not between 1 and 10000 or
    p_request_hash is null or p_request_hash !~ '^[0-9a-f]{64}$' then
    raise exception 'invalid request identity' using errcode = '22023';
  end if;

  select journal.*
  into journal_row
  from private.agent_turn_journal as journal
  where journal.server_turn_id = p_server_turn_id
    and journal.user_id = current_user_id
    and journal.local_project_id = p_local_project_id
  for update;

  if not found then
    return query select
      'denied'::text,
      'invalid_turn'::text,
      p_server_turn_id,
      p_local_project_id,
      'created'::text,
      null::text,
      0,
      0,
      0,
      0,
      now(),
      now(),
      null::timestamptz,
      null::text;
    return;
  end if;

  select request.*
  into request_by_id
  from private.agent_turn_request_journal as request
  where request.server_turn_id = p_server_turn_id
    and request.request_id = p_request_id;

  if found then
    if request_by_id.step_sequence = p_step_sequence and request_by_id.request_hash = p_request_hash then
      result_decision := 'replayed';
      result_denial := null;
    else
      result_denial := 'request_id_conflict';
    end if;
  else
    select request.*
    into request_by_sequence
    from private.agent_turn_request_journal as request
    where request.server_turn_id = p_server_turn_id
      and request.step_sequence = p_step_sequence;

    if found then
      result_denial := 'sequence_conflict';
    elsif journal_row.server_execution_status in (
      'externally_completed', 'externally_cancelled', 'externally_failed'
    ) then
      result_denial := 'terminal_turn';
    elsif p_step_sequence <= journal_row.latest_step_sequence then
      result_denial := 'sequence_replay';
    elsif p_step_sequence > journal_row.latest_step_sequence + 1 then
      result_denial := 'sequence_skip';
    elsif p_step_sequence = 1 and (
      journal_row.latest_step_sequence <> 0 or journal_row.server_execution_status <> 'created'
    ) then
      result_denial := 'status_conflict';
    elsif p_step_sequence > 1 and journal_row.server_execution_status <> 'awaiting_next_request' then
      result_denial := 'status_conflict';
    elsif journal_row.provider_call_count >= 32 then
      result_denial := 'provider_limit';
    else
      select quota.allowed, quota.denial_reason
      into quota_allowed, quota_denial
      from public.reserve_ai_daily_quota('text') as quota;

      if not quota_allowed then
        result_denial := coalesce(quota_denial, 'quota_exceeded');
      else
        insert into private.agent_turn_request_journal (
          server_turn_id,
          request_id,
          step_sequence,
          request_hash,
          execution_status
        ) values (
          p_server_turn_id,
          p_request_id,
          p_step_sequence,
          p_request_hash,
          'provider_running'
        );

        update private.agent_turn_journal as journal
        set
          server_execution_status = 'provider_running',
          latest_step_sequence = p_step_sequence,
          latest_request_id = p_request_id,
          latest_request_hash = p_request_hash,
          provider_call_count = journal.provider_call_count + 1,
          bounded_failure_code = null,
          terminal_at = null,
          revision = journal.revision + 1,
          updated_at = now()
        where journal.server_turn_id = p_server_turn_id
        returning journal.* into journal_row;

        result_decision := 'acquired';
        result_denial := null;
      end if;
    end if;
  end if;

  return query select
    result_decision,
    result_denial,
    journal_row.server_turn_id,
    journal_row.local_project_id,
    journal_row.server_execution_status,
    journal_row.latest_request_id,
    journal_row.latest_step_sequence,
    journal_row.provider_call_count,
    journal_row.web_search_call_count,
    journal_row.image_call_count,
    journal_row.created_at,
    journal_row.updated_at,
    journal_row.terminal_at,
    journal_row.bounded_failure_code;
end;
$$;

create or replace function public.settle_agent_turn_request(
  p_server_turn_id uuid,
  p_local_project_id text,
  p_request_id text,
  p_step_sequence integer,
  p_status text,
  p_failure_code text default null
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
  journal_row private.agent_turn_journal%rowtype;
  request_row private.agent_turn_request_journal%rowtype;
  next_terminal_at timestamptz;
  result_decision text := 'denied';
  result_denial text;
begin
  if current_user_id is null then
    raise exception 'not authenticated' using errcode = '28000';
  end if;
  if p_status not in (
    'awaiting_next_request', 'externally_completed', 'externally_cancelled', 'externally_failed'
  ) or
    (p_status = 'externally_failed' and (
      p_failure_code is null or
      char_length(p_failure_code) not between 1 and 80 or
      p_failure_code !~ '^[A-Za-z0-9._:-]+$'
    )) or
    (p_status <> 'externally_failed' and p_failure_code is not null) then
    raise exception 'invalid request settlement' using errcode = '22023';
  end if;

  select journal.*
  into journal_row
  from private.agent_turn_journal as journal
  where journal.server_turn_id = p_server_turn_id
    and journal.user_id = current_user_id
    and journal.local_project_id = p_local_project_id
  for update;

  if not found then
    return query select
      'denied'::text,
      'invalid_turn'::text,
      p_server_turn_id,
      p_local_project_id,
      'created'::text,
      null::text,
      0,
      0,
      0,
      0,
      now(),
      now(),
      null::timestamptz,
      null::text;
    return;
  end if;

  select request.*
  into request_row
  from private.agent_turn_request_journal as request
  where request.server_turn_id = p_server_turn_id
    and request.request_id = p_request_id
    and request.step_sequence = p_step_sequence
  for update;

  if not found then
    result_denial := 'request_id_conflict';
  elsif journal_row.latest_request_id <> p_request_id or
    journal_row.latest_step_sequence <> p_step_sequence then
    result_denial := 'request_not_latest';
  elsif request_row.execution_status = p_status and
    request_row.bounded_failure_code is not distinct from p_failure_code then
    result_decision := 'replayed';
    result_denial := null;
  elsif request_row.execution_status <> 'provider_running' or
    journal_row.server_execution_status <> 'provider_running' then
    result_denial := 'status_conflict';
  else
    next_terminal_at := case
      when p_status in ('externally_completed', 'externally_cancelled', 'externally_failed') then now()
      else null
    end;

    update private.agent_turn_request_journal as request
    set
      execution_status = p_status,
      bounded_failure_code = p_failure_code,
      updated_at = now(),
      terminal_at = next_terminal_at
    where request.server_turn_id = p_server_turn_id
      and request.request_id = p_request_id;

    update private.agent_turn_journal as journal
    set
      server_execution_status = p_status,
      bounded_failure_code = p_failure_code,
      terminal_at = next_terminal_at,
      revision = journal.revision + 1,
      updated_at = now()
    where journal.server_turn_id = p_server_turn_id
    returning journal.* into journal_row;

    result_decision := 'updated';
    result_denial := null;
  end if;

  return query select
    result_decision,
    result_denial,
    journal_row.server_turn_id,
    journal_row.local_project_id,
    journal_row.server_execution_status,
    journal_row.latest_request_id,
    journal_row.latest_step_sequence,
    journal_row.provider_call_count,
    journal_row.web_search_call_count,
    journal_row.image_call_count,
    journal_row.created_at,
    journal_row.updated_at,
    journal_row.terminal_at,
    journal_row.bounded_failure_code;
end;
$$;

revoke all on function public.create_agent_turn_journal(text, text) from public, anon, authenticated;
revoke all on function public.read_agent_turn_journal(uuid, text) from public, anon, authenticated;
revoke all on function public.acquire_agent_turn_request(uuid, text, text, integer, text)
  from public, anon, authenticated;
revoke all on function public.settle_agent_turn_request(uuid, text, text, integer, text, text)
  from public, anon, authenticated;

grant execute on function public.create_agent_turn_journal(text, text) to authenticated;
grant execute on function public.read_agent_turn_journal(uuid, text) to authenticated;
grant execute on function public.acquire_agent_turn_request(uuid, text, text, integer, text)
  to authenticated;
grant execute on function public.settle_agent_turn_request(uuid, text, text, integer, text, text)
  to authenticated;
