create unique index if not exists agent_turn_request_identity_idx
on private.agent_turn_request_journal (server_turn_id, request_id, step_sequence);

create table if not exists private.agent_turn_external_action_claim (
  server_turn_id uuid not null,
  request_id text not null,
  step_sequence integer not null,
  tool_call_id text not null,
  action_kind text not null,
  claim_hash text not null,
  max_action_count integer not null,
  consumed_action_count integer not null default 0,
  created_at timestamptz not null default now(),
  primary key (server_turn_id, request_id, step_sequence, tool_call_id),
  foreign key (server_turn_id, request_id, step_sequence)
    references private.agent_turn_request_journal (server_turn_id, request_id, step_sequence)
    on delete cascade,
  constraint agent_turn_external_action_claim_call_id_check
    check (char_length(tool_call_id) between 1 and 160 and tool_call_id ~ '^[A-Za-z0-9._:-]+$'),
  constraint agent_turn_external_action_claim_kind_check
    check (action_kind in ('web_search', 'image')),
  constraint agent_turn_external_action_claim_hash_check
    check (claim_hash ~ '^[0-9a-f]{64}$'),
  constraint agent_turn_external_action_claim_count_check
    check (
      max_action_count between 1 and 32 and
      consumed_action_count between 0 and max_action_count
    )
);

alter table private.agent_turn_external_action_claim enable row level security;
revoke all on table private.agent_turn_external_action_claim from public, anon, authenticated;

create table if not exists private.agent_turn_external_action_journal (
  server_turn_id uuid not null,
  request_id text not null,
  step_sequence integer not null,
  action_id text not null,
  action_kind text not null,
  claim_call_id text,
  action_hash text not null,
  execution_status text not null default 'running',
  execution_started_at timestamptz not null default now(),
  execution_expires_at timestamptz not null,
  bounded_failure_code text,
  result_receipt jsonb,
  receipt_expires_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  terminal_at timestamptz,
  primary key (server_turn_id, action_id),
  foreign key (server_turn_id)
    references private.agent_turn_journal (server_turn_id)
    on delete cascade,
  constraint agent_turn_external_action_id_check
    check (char_length(action_id) between 1 and 160 and action_id ~ '^[A-Za-z0-9._:-]+$'),
  constraint agent_turn_external_action_kind_check
    check (action_kind in ('web_search', 'image', 'compaction')),
  constraint agent_turn_external_action_claim_binding_check
    check (
      (action_kind = 'compaction' and claim_call_id is null) or
      (
        action_kind in ('web_search', 'image') and
        claim_call_id is not null and
        char_length(claim_call_id) between 1 and 160 and
        claim_call_id ~ '^[A-Za-z0-9._:-]+$'
      )
    ),
  constraint agent_turn_external_action_hash_check
    check (action_hash ~ '^[0-9a-f]{64}$'),
  constraint agent_turn_external_action_sequence_check
    check (step_sequence between 1 and 10000),
  constraint agent_turn_external_action_window_check
    check (execution_expires_at > execution_started_at),
  constraint agent_turn_external_action_status_check
    check (execution_status in ('running', 'externally_completed', 'externally_cancelled', 'externally_failed')),
  constraint agent_turn_external_action_terminal_check
    check (
      (execution_status = 'running' and terminal_at is null) or
      (execution_status <> 'running' and terminal_at is not null)
    ),
  constraint agent_turn_external_action_failure_check
    check (
      (
        execution_status = 'externally_failed' and
        bounded_failure_code is not null and
        char_length(bounded_failure_code) between 1 and 80 and
        bounded_failure_code ~ '^[A-Za-z0-9._:-]+$'
      ) or
      (execution_status <> 'externally_failed' and bounded_failure_code is null)
    ),
  constraint agent_turn_external_action_receipt_check
    check (
      (result_receipt is null and receipt_expires_at is null) or
      (
        action_kind = 'web_search' and
        execution_status = 'externally_completed' and
        jsonb_typeof(result_receipt) = 'object' and
        octet_length(result_receipt::text) <= 32768 and
        receipt_expires_at is not null
      )
    )
);

create index if not exists agent_turn_external_action_request_idx
on private.agent_turn_external_action_journal (server_turn_id, request_id, step_sequence);

alter table private.agent_turn_external_action_journal enable row level security;
revoke all on table private.agent_turn_external_action_journal from public, anon, authenticated;

create or replace function public.settle_agent_turn_request_with_action_claims(
  p_server_turn_id uuid,
  p_local_project_id text,
  p_request_id text,
  p_step_sequence integer,
  p_status text,
  p_failure_code text default null,
  p_claims jsonb default '[]'::jsonb
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
  settlement record;
  claim jsonb;
  claim_row private.agent_turn_external_action_claim%rowtype;
  provided_claim_count integer;
  stored_claim_count integer;
begin
  if p_claims is null or jsonb_typeof(p_claims) <> 'array' or jsonb_array_length(p_claims) > 64 then
    raise exception 'invalid external action claims' using errcode = '22023';
  end if;
  if p_status <> 'awaiting_next_request' and jsonb_array_length(p_claims) <> 0 then
    raise exception 'terminal request cannot create action claims' using errcode = '22023';
  end if;

  select * into settlement
  from public.settle_agent_turn_request(
    p_server_turn_id,
    p_local_project_id,
    p_request_id,
    p_step_sequence,
    p_status,
    p_failure_code
  );

  if settlement.decision <> 'denied' and p_status = 'awaiting_next_request' then
    for claim in select value from jsonb_array_elements(p_claims)
    loop
      if jsonb_typeof(claim) <> 'object' or
        not (claim ?& array['toolCallId', 'actionKind', 'claimHash', 'maxActionCount']) or
        (select count(*) from jsonb_object_keys(claim)) <> 4 or
        char_length(claim->>'toolCallId') not between 1 and 160 or
        (claim->>'toolCallId') !~ '^[A-Za-z0-9._:-]+$' or
        (claim->>'actionKind') not in ('web_search', 'image') or
        (claim->>'claimHash') !~ '^[0-9a-f]{64}$' or
        jsonb_typeof(claim->'maxActionCount') <> 'number' or
        (claim->>'maxActionCount')::integer not between 1 and 32 then
        raise exception 'invalid external action claim' using errcode = '22023';
      end if;

      insert into private.agent_turn_external_action_claim (
        server_turn_id,
        request_id,
        step_sequence,
        tool_call_id,
        action_kind,
        claim_hash,
        max_action_count
      ) values (
        p_server_turn_id,
        p_request_id,
        p_step_sequence,
        claim->>'toolCallId',
        claim->>'actionKind',
        claim->>'claimHash',
        (claim->>'maxActionCount')::integer
      ) on conflict do nothing;

      select stored.* into claim_row
      from private.agent_turn_external_action_claim as stored
      where stored.server_turn_id = p_server_turn_id
        and stored.request_id = p_request_id
        and stored.step_sequence = p_step_sequence
        and stored.tool_call_id = claim->>'toolCallId'
      for update;

      if claim_row.action_kind <> claim->>'actionKind' or
        claim_row.claim_hash <> claim->>'claimHash' or
        claim_row.max_action_count <> (claim->>'maxActionCount')::integer then
        raise exception 'external action claim replay conflict' using errcode = '23505';
      end if;
    end loop;

    provided_claim_count := jsonb_array_length(p_claims);
    select count(*) into stored_claim_count
    from private.agent_turn_external_action_claim as stored
    where stored.server_turn_id = p_server_turn_id
      and stored.request_id = p_request_id
      and stored.step_sequence = p_step_sequence;
    if stored_claim_count <> provided_claim_count then
      raise exception 'external action claim set conflict' using errcode = '23505';
    end if;
  end if;

  return query select
    settlement.decision,
    settlement.denial_reason,
    settlement.server_turn_id,
    settlement.local_project_id,
    settlement.status_name,
    settlement.latest_request_id,
    settlement.latest_step_sequence,
    settlement.provider_call_count,
    settlement.web_search_call_count,
    settlement.image_call_count,
    settlement.created_at,
    settlement.updated_at,
    settlement.terminal_at,
    settlement.failure_code;
end;
$$;

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
  turn_row private.agent_turn_journal%rowtype;
  request_row private.agent_turn_request_journal%rowtype;
  action_row private.agent_turn_external_action_journal%rowtype;
  claim_row private.agent_turn_external_action_claim%rowtype;
  request_found boolean := false;
  request_authorized boolean := false;
  claim_authorized boolean := false;
  quota_allowed boolean;
  quota_denial text;
  result_decision text := 'denied';
  result_denial text;
  action_expiry interval;
begin
  if current_user_id is null then
    raise exception 'not authenticated' using errcode = '28000';
  end if;
  if p_local_project_id is null or char_length(p_local_project_id) not between 1 and 160 or
    p_local_project_id !~ '^[A-Za-z0-9._:-]+$' or
    p_request_id is null or char_length(p_request_id) not between 1 and 160 or
    p_request_id !~ '^[A-Za-z0-9._:-]+$' or
    p_step_sequence is null or p_step_sequence not between 1 and 10000 or
    p_action_id is null or char_length(p_action_id) not between 1 and 160 or
    p_action_id !~ '^[A-Za-z0-9._:-]+$' or
    p_action_kind not in ('web_search', 'image', 'compaction') or
    p_action_hash is null or p_action_hash !~ '^[0-9a-f]{64}$' or
    (
      p_action_kind = 'compaction' and
      (p_claim_call_id is not null or p_claim_hash is not null)
    ) or
    (
      p_action_kind in ('web_search', 'image') and
      (
        p_claim_call_id is null or char_length(p_claim_call_id) not between 1 and 160 or
        p_claim_call_id !~ '^[A-Za-z0-9._:-]+$' or
        p_claim_hash is null or p_claim_hash !~ '^[0-9a-f]{64}$'
      )
    ) then
    raise exception 'invalid external action identity' using errcode = '22023';
  end if;

  select turn_record.* into turn_row
  from private.agent_turn_journal as turn_record
  where turn_record.server_turn_id = p_server_turn_id
    and turn_record.user_id = current_user_id
    and turn_record.local_project_id = p_local_project_id
  for update;

  if not found then
    return query select 'denied'::text, 'invalid_turn'::text, p_server_turn_id,
      p_request_id, p_step_sequence, p_action_id, p_action_kind, 'running'::text,
      now(), now(), null::timestamptz, null::text, null::jsonb;
    return;
  end if;

  select action_record.* into action_row
  from private.agent_turn_external_action_journal as action_record
  where action_record.server_turn_id = p_server_turn_id
    and action_record.action_id = p_action_id
  for update;

  if found then
    if action_row.result_receipt is not null and action_row.receipt_expires_at <= now() then
      update private.agent_turn_external_action_journal as action_record
      set result_receipt = null, receipt_expires_at = null, updated_at = now()
      where action_record.server_turn_id = p_server_turn_id
        and action_record.action_id = p_action_id
      returning action_record.* into action_row;
    end if;
    if action_row.execution_status = 'running' and action_row.execution_expires_at <= now() then
      update private.agent_turn_external_action_journal as action_record
      set execution_status = 'externally_failed',
          bounded_failure_code = 'external_execution_state_unknown',
          terminal_at = now(),
          updated_at = now()
      where action_record.server_turn_id = p_server_turn_id
        and action_record.action_id = p_action_id
      returning action_record.* into action_row;
    end if;
    if action_row.request_id = p_request_id and
      action_row.step_sequence = p_step_sequence and
      action_row.action_kind = p_action_kind and
      action_row.claim_call_id is not distinct from p_claim_call_id and
      action_row.action_hash = p_action_hash then
      result_decision := 'replayed';
      result_denial := null;
    elsif action_row.action_hash <> p_action_hash then
      result_denial := 'external_action_hash_conflict';
    else
      result_denial := 'external_action_identity_conflict';
    end if;
  else
    if p_action_kind = 'compaction' and
      turn_row.server_execution_status = 'created' and
      turn_row.latest_step_sequence = 0 and p_step_sequence = 1 then
      request_found := true;
      request_authorized := true;
    else
      select request_record.* into request_row
      from private.agent_turn_request_journal as request_record
      where request_record.server_turn_id = p_server_turn_id
        and request_record.request_id = p_request_id
        and request_record.step_sequence = p_step_sequence
      for update;
      request_found := found;
      request_authorized := request_found and request_row.execution_status = 'awaiting_next_request';
    end if;

    if p_action_kind <> 'compaction' then
      select claim_record.* into claim_row
      from private.agent_turn_external_action_claim as claim_record
      where claim_record.server_turn_id = p_server_turn_id
        and claim_record.request_id = p_request_id
        and claim_record.step_sequence = p_step_sequence
        and claim_record.tool_call_id = p_claim_call_id
      for update;
      claim_authorized := found and
        claim_row.action_kind = p_action_kind and
        claim_row.claim_hash = p_claim_hash and
        claim_row.consumed_action_count < claim_row.max_action_count;
    else
      claim_authorized := true;
    end if;

    if not request_found or
      (
        turn_row.latest_step_sequence > 0 and
        (turn_row.latest_request_id <> p_request_id or turn_row.latest_step_sequence <> p_step_sequence)
      ) then
      result_denial := 'request_not_latest';
    elsif turn_row.server_execution_status not in ('created', 'awaiting_next_request') then
      result_denial := case
        when turn_row.server_execution_status in ('externally_completed', 'externally_cancelled', 'externally_failed')
          then 'terminal_turn'
        else 'status_conflict'
      end;
    elsif not request_authorized then
      result_denial := 'status_conflict';
    elsif p_action_kind <> 'compaction' and claim_row.server_turn_id is null then
      result_denial := 'tool_action_not_claimed';
    elsif p_action_kind <> 'compaction' and (
      claim_row.action_kind <> p_action_kind or claim_row.claim_hash <> p_claim_hash
    ) then
      result_denial := 'tool_action_claim_conflict';
    elsif not claim_authorized then
      result_denial := 'action_limit';
    elsif (p_action_kind = 'web_search' and turn_row.web_search_call_count >= 32) or
      (p_action_kind = 'image' and turn_row.image_call_count >= 32) or
      (p_action_kind = 'compaction' and turn_row.provider_call_count >= 32) then
      result_denial := 'action_limit';
    else
      quota_allowed := true;
      quota_denial := null;
      if p_action_kind = 'image' then
        select quota.allowed, quota.denial_reason into quota_allowed, quota_denial
        from public.reserve_ai_daily_quota('image') as quota;
      elsif p_action_kind = 'compaction' then
        select quota.allowed, quota.denial_reason into quota_allowed, quota_denial
        from public.reserve_ai_daily_quota('text') as quota;
      end if;

      if not quota_allowed then
        result_denial := coalesce(quota_denial, 'quota_exceeded');
      else
        action_expiry := case
          when p_action_kind = 'web_search' then interval '2 minutes'
          else interval '15 minutes'
        end;
        insert into private.agent_turn_external_action_journal (
          server_turn_id, request_id, step_sequence, action_id, action_kind,
          claim_call_id, action_hash, execution_started_at, execution_expires_at
        ) values (
          p_server_turn_id, p_request_id, p_step_sequence, p_action_id, p_action_kind,
          p_claim_call_id, p_action_hash, now(), now() + action_expiry
        ) returning * into action_row;

        if p_action_kind <> 'compaction' then
          update private.agent_turn_external_action_claim as claim_record
          set consumed_action_count = claim_record.consumed_action_count + 1
          where claim_record.server_turn_id = p_server_turn_id
            and claim_record.request_id = p_request_id
            and claim_record.step_sequence = p_step_sequence
            and claim_record.tool_call_id = p_claim_call_id;
        end if;

        update private.agent_turn_journal as turn_record
        set web_search_call_count = turn_record.web_search_call_count +
              case when p_action_kind = 'web_search' then 1 else 0 end,
            image_call_count = turn_record.image_call_count +
              case when p_action_kind = 'image' then 1 else 0 end,
            provider_call_count = turn_record.provider_call_count +
              case when p_action_kind = 'compaction' then 1 else 0 end,
            revision = turn_record.revision + 1,
            updated_at = now()
        where turn_record.server_turn_id = p_server_turn_id;

        result_decision := 'acquired';
        result_denial := null;
      end if;
    end if;
  end if;

  if action_row.server_turn_id is null then
    action_row.server_turn_id := p_server_turn_id;
    action_row.request_id := p_request_id;
    action_row.step_sequence := p_step_sequence;
    action_row.action_id := p_action_id;
    action_row.action_kind := p_action_kind;
    action_row.execution_status := 'running';
    action_row.created_at := now();
    action_row.updated_at := now();
  end if;

  return query select result_decision, result_denial, action_row.server_turn_id,
    action_row.request_id, action_row.step_sequence, action_row.action_id,
    action_row.action_kind, action_row.execution_status, action_row.created_at,
    action_row.updated_at, action_row.terminal_at, action_row.bounded_failure_code,
    action_row.result_receipt;
end;
$$;

create or replace function public.read_agent_turn_external_action(
  p_server_turn_id uuid,
  p_local_project_id text,
  p_action_id text
)
returns table (
  visible boolean,
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
  turn_row private.agent_turn_journal%rowtype;
  action_row private.agent_turn_external_action_journal%rowtype;
begin
  if current_user_id is null then
    raise exception 'not authenticated' using errcode = '28000';
  end if;
  select turn_record.* into turn_row
  from private.agent_turn_journal as turn_record
  where turn_record.server_turn_id = p_server_turn_id
    and turn_record.user_id = current_user_id
    and turn_record.local_project_id = p_local_project_id
  for update;

  if not found then
    return query select false, null::uuid, null::text, null::integer, null::text,
      null::text, null::text, null::timestamptz, null::timestamptz,
      null::timestamptz, null::text, null::jsonb;
    return;
  end if;

  select action_record.* into action_row
  from private.agent_turn_external_action_journal as action_record
  where action_record.server_turn_id = p_server_turn_id
    and action_record.action_id = p_action_id
  for update;

  if not found then
    return query select false, null::uuid, null::text, null::integer, null::text,
      null::text, null::text, null::timestamptz, null::timestamptz,
      null::timestamptz, null::text, null::jsonb;
    return;
  end if;

  if action_row.execution_status = 'running' and action_row.execution_expires_at <= now() then
    update private.agent_turn_external_action_journal as action_record
    set execution_status = 'externally_failed',
        bounded_failure_code = 'external_execution_state_unknown',
        terminal_at = now(),
        updated_at = now()
    where action_record.server_turn_id = p_server_turn_id
      and action_record.action_id = p_action_id
    returning action_record.* into action_row;
  end if;
  if action_row.result_receipt is not null and action_row.receipt_expires_at <= now() then
    update private.agent_turn_external_action_journal as action_record
    set result_receipt = null, receipt_expires_at = null, updated_at = now()
    where action_record.server_turn_id = p_server_turn_id
      and action_record.action_id = p_action_id
    returning action_record.* into action_row;
  end if;

  return query select true, action_row.server_turn_id, action_row.request_id,
    action_row.step_sequence, action_row.action_id, action_row.action_kind,
    action_row.execution_status, action_row.created_at, action_row.updated_at,
    action_row.terminal_at, action_row.bounded_failure_code, action_row.result_receipt;
end;
$$;

create or replace function public.settle_agent_turn_external_action(
  p_server_turn_id uuid,
  p_local_project_id text,
  p_request_id text,
  p_step_sequence integer,
  p_action_id text,
  p_action_kind text,
  p_action_hash text,
  p_status text,
  p_failure_code text default null,
  p_result_receipt jsonb default null
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
  turn_row private.agent_turn_journal%rowtype;
  action_row private.agent_turn_external_action_journal%rowtype;
  result_decision text := 'denied';
  result_denial text;
begin
  if current_user_id is null then
    raise exception 'not authenticated' using errcode = '28000';
  end if;
  if p_status not in ('externally_completed', 'externally_cancelled', 'externally_failed') or
    (p_status = 'externally_failed' and (
      p_failure_code is null or char_length(p_failure_code) not between 1 and 80 or
      p_failure_code !~ '^[A-Za-z0-9._:-]+$'
    )) or
    (p_status <> 'externally_failed' and p_failure_code is not null) or
    (p_result_receipt is not null and (
      p_action_kind <> 'web_search' or p_status <> 'externally_completed' or
      jsonb_typeof(p_result_receipt) <> 'object' or octet_length(p_result_receipt::text) > 32768
    )) then
    raise exception 'invalid external action settlement' using errcode = '22023';
  end if;

  select turn_record.* into turn_row
  from private.agent_turn_journal as turn_record
  where turn_record.server_turn_id = p_server_turn_id
    and turn_record.user_id = current_user_id
    and turn_record.local_project_id = p_local_project_id
  for update;

  if not found then
    return query select 'denied'::text, 'invalid_turn'::text, p_server_turn_id,
      p_request_id, p_step_sequence, p_action_id, p_action_kind, 'running'::text,
      now(), now(), null::timestamptz, null::text, null::jsonb;
    return;
  end if;

  select action_record.* into action_row
  from private.agent_turn_external_action_journal as action_record
  where action_record.server_turn_id = p_server_turn_id
    and action_record.action_id = p_action_id
  for update;

  if not found then
    result_denial := 'external_action_identity_conflict';
  elsif action_row.request_id <> p_request_id or
    action_row.step_sequence <> p_step_sequence or
    action_row.action_kind <> p_action_kind then
    result_denial := 'external_action_identity_conflict';
  elsif action_row.action_hash <> p_action_hash then
    result_denial := 'external_action_hash_conflict';
  elsif action_row.execution_status = p_status and
    action_row.bounded_failure_code is not distinct from p_failure_code and
    action_row.result_receipt is not distinct from p_result_receipt then
    result_decision := 'replayed';
    result_denial := null;
  elsif action_row.execution_status = 'running' and action_row.execution_expires_at <= now() then
    update private.agent_turn_external_action_journal as action_record
    set execution_status = 'externally_failed',
        bounded_failure_code = 'external_execution_state_unknown',
        terminal_at = now(), updated_at = now()
    where action_record.server_turn_id = p_server_turn_id
      and action_record.action_id = p_action_id
    returning action_record.* into action_row;
    result_denial := 'status_conflict';
  elsif action_row.execution_status <> 'running' then
    result_denial := 'status_conflict';
  else
    update private.agent_turn_external_action_journal as action_record
    set execution_status = p_status,
        bounded_failure_code = p_failure_code,
        result_receipt = p_result_receipt,
        receipt_expires_at = case when p_result_receipt is not null then now() + interval '24 hours' else null end,
        terminal_at = now(),
        updated_at = now()
    where action_record.server_turn_id = p_server_turn_id
      and action_record.action_id = p_action_id
    returning action_record.* into action_row;
    result_decision := 'updated';
    result_denial := null;
  end if;

  if action_row.server_turn_id is null then
    action_row.server_turn_id := p_server_turn_id;
    action_row.request_id := p_request_id;
    action_row.step_sequence := p_step_sequence;
    action_row.action_id := p_action_id;
    action_row.action_kind := p_action_kind;
    action_row.execution_status := 'running';
    action_row.created_at := now();
    action_row.updated_at := now();
  end if;

  return query select result_decision, result_denial, action_row.server_turn_id,
    action_row.request_id, action_row.step_sequence, action_row.action_id,
    action_row.action_kind, action_row.execution_status, action_row.created_at,
    action_row.updated_at, action_row.terminal_at, action_row.bounded_failure_code,
    action_row.result_receipt;
end;
$$;

revoke all on function public.settle_agent_turn_request_with_action_claims(uuid, text, text, integer, text, text, jsonb)
  from public, anon, authenticated;
revoke all on function public.acquire_agent_turn_external_action(uuid, text, text, integer, text, text, text, text, text)
  from public, anon, authenticated;
revoke all on function public.read_agent_turn_external_action(uuid, text, text)
  from public, anon, authenticated;
revoke all on function public.settle_agent_turn_external_action(uuid, text, text, integer, text, text, text, text, text, jsonb)
  from public, anon, authenticated;

grant execute on function public.settle_agent_turn_request_with_action_claims(uuid, text, text, integer, text, text, jsonb)
  to authenticated;
grant execute on function public.acquire_agent_turn_external_action(uuid, text, text, integer, text, text, text, text, text)
  to authenticated;
grant execute on function public.read_agent_turn_external_action(uuid, text, text)
  to authenticated;
grant execute on function public.settle_agent_turn_external_action(uuid, text, text, integer, text, text, text, text, text, jsonb)
  to authenticated;
