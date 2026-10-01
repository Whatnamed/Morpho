-- P3B: bounded raw input and result escrow. No legacy result/identity fabrication.
alter table public.external_effect add column if not exists result_reserved_bytes integer not null default 0;
alter table public.external_effect_attempt alter column frozen_request drop not null;
update public.external_effect_attempt a set frozen_request = null
from public.external_effect e where a.actor_user_id=e.actor_user_id and a.effect_id=e.effect_id
  and a.correction is null and a.frozen_request=e.frozen_request and a.request_digest=e.request_digest;

create table if not exists public.external_result (
  actor_user_id uuid not null,
  effect_id text not null,
  manifest jsonb not null,
  binding jsonb,
  published_at timestamptz,
  acknowledged_at timestamptz,
  created_at timestamptz not null default now(),
  expires_at timestamptz not null default now() + interval '24 hours',
  primary key(actor_user_id,effect_id),
  foreign key(actor_user_id,effect_id) references public.external_effect(actor_user_id,effect_id)
);
create table if not exists public.external_result_chunk (
  actor_user_id uuid not null, effect_id text not null, chunk_index integer not null,
  data bytea not null check(octet_length(data) between 1 and 524288),
  primary key(actor_user_id,effect_id,chunk_index),
  foreign key(actor_user_id,effect_id) references public.external_result(actor_user_id,effect_id) on delete cascade
);
create index if not exists external_result_expiry on public.external_result(expires_at);
alter table public.external_result enable row level security;
alter table public.external_result_chunk enable row level security;
revoke all on public.external_result,public.external_result_chunk from public,anon,authenticated;
grant all on public.external_result,public.external_result_chunk to service_role;

create or replace function public.cleanup_external_result_payloads(p_actor_user_id uuid default null)
returns void language plpgsql security definer set search_path='' as $$
begin
  delete from public.external_result_chunk c using public.external_result r
  where c.actor_user_id=r.actor_user_id and c.effect_id=r.effect_id and r.expires_at<=now()
    and (p_actor_user_id is null or r.actor_user_id=p_actor_user_id);
  update public.external_result set binding=null where expires_at<=now() and binding is not null
    and (p_actor_user_id is null or actor_user_id=p_actor_user_id);
  update public.external_effect set result_reserved_bytes=0 where created_at+interval '24 hours'<=now()
    and result_reserved_bytes<>0 and (p_actor_user_id is null or actor_user_id=p_actor_user_id);
  update public.external_effect set frozen_request=null where created_at+interval '24 hours'<=now()
    and frozen_request is not null and (p_actor_user_id is null or actor_user_id=p_actor_user_id);
  update public.external_effect_attempt a set frozen_request=null from public.external_effect e
    where a.actor_user_id=e.actor_user_id and a.effect_id=e.effect_id and e.created_at+interval '24 hours'<=now()
      and a.frozen_request is not null and (p_actor_user_id is null or a.actor_user_id=p_actor_user_id);
end; $$;
revoke all on function public.cleanup_external_result_payloads(uuid) from public,anon,authenticated;
grant execute on function public.cleanup_external_result_payloads(uuid) to service_role;

create or replace function public.operate_external_effect(
  p_actor_user_id uuid, p_effect_id text, p_kind text, p_operation text,
  p_payload jsonb default '{}'::jsonb
) returns jsonb
language plpgsql security definer set search_path = '' as $$
declare
  effect public.external_effect%rowtype;
  attempt public.external_effect_attempt%rowtype;
  next_attempt uuid;
  event_kind text;
  obs jsonb;
  granted boolean := false;
  inserted integer;
begin
  perform pg_advisory_xact_lock(hashtextextended(p_actor_user_id::text, 33));
  perform public.cleanup_external_result_payloads(p_actor_user_id);
  if p_actor_user_id is null or p_effect_id !~ '^effect:[0-9a-f]{64}$'
    or p_kind not in ('image', 'text', 'compaction')
    or p_operation not in ('register', 'correction', 'observe', 'read', 'cancel') then
    return jsonb_build_object('error', 'invalid_effect_identity');
  end if;
  if p_operation = 'register' and not exists (select 1 from public.external_effect
      where actor_user_id = p_actor_user_id and effect_id = p_effect_id) and
    (select coalesce(sum(octet_length(frozen_request)),0) from public.external_effect where actor_user_id = p_actor_user_id) +
    (select coalesce(sum(octet_length(frozen_request)),0) from public.external_effect_attempt where actor_user_id = p_actor_user_id) +
    coalesce(octet_length(p_payload->>'frozenRequest'),0) > 67108864 then
    return jsonb_build_object('error','effect_input_capacity_exceeded');
  end if;
  if p_operation='register' and not exists(select 1 from public.external_effect
    where actor_user_id=p_actor_user_id and effect_id=p_effect_id) and
    (select coalesce(sum((manifest->>'byteLength')::integer),0) from public.external_result
      where actor_user_id=p_actor_user_id and expires_at>now()) +
    (select coalesce(sum(result_reserved_bytes),0) from public.external_effect where actor_user_id=p_actor_user_id) + (case when p_kind='image' then 16777216 else 8388608 end) > 134217728 then
    return jsonb_build_object('error','result_capacity_exceeded');
  end if;
  if p_operation in ('register', 'cancel') then
    insert into public.external_effect(actor_user_id, effect_id, kind)
      values (p_actor_user_id, p_effect_id, p_kind) on conflict do nothing;
    get diagnostics inserted = row_count;
  end if;
  select * into effect from public.external_effect
    where actor_user_id = p_actor_user_id and effect_id = p_effect_id for update;
  if not found then
    return jsonb_build_object('snapshot', null, 'executionGranted', false);
  end if;
  if effect.kind <> p_kind or effect.contract_version <> 1 then
    return jsonb_build_object('error', 'effect_identity_conflict');
  end if;

  if p_operation in ('register', 'correction') then
    if p_payload->>'requestDigest' !~ '^[0-9a-f]{64}$'
      or jsonb_typeof(p_payload->'frozenRequest') <> 'string'
      or octet_length(p_payload->>'frozenRequest') > 8388608
      or jsonb_typeof(p_payload->'namespace') <> 'object'
      or p_payload->'namespace'->>'provider' not in ('grsai', 'openai-compatible')
      or p_payload->'namespace'->>'credentialScope' !~ '^[0-9a-f]{64}$'
      or p_payload->'namespace'->>'baseUrl' !~ '^https?://'
      or p_payload->>'attemptId' is null then
      return jsonb_build_object('error', 'invalid_effect_request');
    end if;
    next_attempt := (p_payload->>'attemptId')::uuid;
    if p_operation = 'register' then
      if effect.request_digest is not null and
        (effect.request_digest <> p_payload->>'requestDigest'
          or (effect.frozen_request is not null and effect.frozen_request <> p_payload->>'frozenRequest')
          or effect.provider_namespace <> p_payload->'namespace') then
        return jsonb_build_object('error', 'effect_request_conflict');
      end if;
      -- Only insertion into this registry authorizes the first attempt. Cancellation tombstones
      -- and existing rows (including unknown) cannot grant a paid resubmission.
      granted := inserted = 1 and effect.cancel_requested_at is null;
      if granted then update public.external_effect set result_reserved_bytes=
        case when p_kind='image' then 16777216 else 8388608 end
        where actor_user_id=p_actor_user_id and effect_id=p_effect_id; end if;
      if effect.request_digest is null then
        update public.external_effect set frozen_request = p_payload->>'frozenRequest',
          request_digest = p_payload->>'requestDigest', provider_namespace = p_payload->'namespace'
          where actor_user_id = p_actor_user_id and effect_id = p_effect_id;
      end if;
    else
      select * into attempt from public.external_effect_attempt
        where actor_user_id = p_actor_user_id and effect_id = p_effect_id
          and attempt_id = effect.latest_attempt_id;
      -- The server adapter alone establishes execution-before-rejection evidence. These are
      -- the existing P3S compatibility corrections, never transient-error automatic retries.
      granted := effect.created_at + interval '24 hours' > now() and effect.execution_state = 'failed' and effect.cancel_requested_at is null and effect.provider_namespace = p_payload->'namespace'
        and attempt.last_observation = 'rejected'
        and attempt.provider_task_id is null and attempt.provider_response_id is null
        and p_payload->>'correction' in ('cacheCompatibility', 'imageCompatibility')
        and not exists (select 1 from public.external_effect_attempt a
          where a.actor_user_id = p_actor_user_id and a.effect_id = p_effect_id
            and a.correction = p_payload->>'correction');
    end if;
    if granted and p_operation = 'correction' and
    (select coalesce(sum(octet_length(frozen_request)),0) from public.external_effect where actor_user_id = p_actor_user_id) +
    (select coalesce(sum(octet_length(frozen_request)),0) from public.external_effect_attempt where actor_user_id = p_actor_user_id) +
    octet_length(p_payload->>'frozenRequest') > 67108864 then
    return jsonb_build_object('error','effect_input_capacity_exceeded');
  end if;
  if granted then
      insert into public.external_effect_attempt(actor_user_id, effect_id, attempt_id,
        frozen_request, request_digest, correction)
        values (p_actor_user_id, p_effect_id, next_attempt, case when p_operation = 'correction' then p_payload->>'frozenRequest' else null end,
          p_payload->>'requestDigest', p_payload->>'correction');
      update public.external_effect set latest_attempt_id = next_attempt, execution_state = 'unknown',
        updated_at = now() where actor_user_id = p_actor_user_id and effect_id = p_effect_id;
    end if;
  elsif p_operation = 'cancel' then
    update public.external_effect set cancel_requested_at = coalesce(cancel_requested_at, now()),
      updated_at = now() where actor_user_id = p_actor_user_id and effect_id = p_effect_id;
  elsif p_operation = 'observe' then
    obs := p_payload->'observation';
    event_kind := obs->>'kind';
    if event_kind is null or event_kind not in ('submitted', 'unknown', 'running', 'succeeded',
        'failed', 'cancelled', 'rejected', 'localAbort')
      or p_payload->>'observationId' is null or p_payload->>'observationId' !~ '^[0-9a-f]{64}$'
      or octet_length(obs::text) > 4096
      or coalesce(length(obs->>'taskId'), 0) > 512
      or coalesce(length(obs->>'responseId'), 0) > 512 then
      return jsonb_build_object('error', 'invalid_effect_observation');
    end if;
    select * into attempt from public.external_effect_attempt
      where actor_user_id = p_actor_user_id and effect_id = p_effect_id
        and attempt_id = (p_payload->>'attemptId')::uuid;
    if not found then return jsonb_build_object('error', 'effect_attempt_conflict'); end if;
    if (obs->>'taskId' is not null and attempt.provider_task_id is not null
        and obs->>'taskId' <> attempt.provider_task_id)
      or (obs->>'responseId' is not null and attempt.provider_response_id is not null
        and obs->>'responseId' <> attempt.provider_response_id) then
      return jsonb_build_object('error', 'provider_identity_conflict');
    end if;
    insert into public.external_effect_observation(actor_user_id, effect_id, attempt_id, observation_id, observation)
      values (p_actor_user_id, p_effect_id, attempt.attempt_id, p_payload->>'observationId', obs)
      on conflict do nothing;
    get diagnostics inserted = row_count;
    if inserted = 1 then
      update public.external_effect_attempt set
        provider_task_id = coalesce(provider_task_id, obs->>'taskId'),
        provider_response_id = coalesce(provider_response_id, obs->>'responseId'),
        last_observation = case when event_kind in ('unknown', 'localAbort') then last_observation else event_kind end
        where actor_user_id = p_actor_user_id and effect_id = p_effect_id and attempt_id = attempt.attempt_id;
      -- Older rejected attempts cannot overwrite the current execution; late success is retained.
      update public.external_effect set execution_state = case
          when event_kind = 'succeeded' or execution_state = 'succeeded' then 'succeeded'
          when attempt.attempt_id <> latest_attempt_id then execution_state
          when execution_state in ('failed', 'cancelled') then execution_state
          when event_kind in ('failed', 'rejected') then 'failed'
          when event_kind = 'cancelled' then 'cancelled'
          when event_kind = 'running' and execution_state = 'unknown' then 'running'
          else execution_state end,
        local_abort_observed_at = case when event_kind = 'localAbort' then coalesce(local_abort_observed_at, now())
          else local_abort_observed_at end,
        updated_at = now() where actor_user_id = p_actor_user_id and effect_id = p_effect_id;
    end if;
  end if;
  select * into effect from public.external_effect
    where actor_user_id = p_actor_user_id and effect_id = p_effect_id;
  select * into attempt from public.external_effect_attempt
    where actor_user_id = p_actor_user_id and effect_id = p_effect_id and attempt_id = effect.latest_attempt_id;
  return jsonb_build_object('executionGranted', granted, 'snapshot', jsonb_build_object(
    'version', effect.contract_version, 'effectId', effect.effect_id, 'kind', effect.kind,
    'requestDigest', effect.request_digest, 'namespace', effect.provider_namespace,
    'executionState', effect.execution_state, 'cancelRequestedAt', effect.cancel_requested_at,
    'localAbortObservedAt', effect.local_abort_observed_at, 'attemptId', effect.latest_attempt_id,
    'taskId', attempt.provider_task_id, 'responseId', attempt.provider_response_id));
end;
$$;
revoke all on function public.operate_external_effect(uuid, text, text, text, jsonb) from public, anon, authenticated;
grant execute on function public.operate_external_effect(uuid, text, text, text, jsonb) to service_role;

create or replace function public.operate_external_result(
  p_actor_user_id uuid,p_effect_id text,p_kind text,p_operation text,p_payload jsonb default '{}'::jsonb
) returns jsonb language plpgsql security definer set search_path='' as $$
declare
  r public.external_result%rowtype;
  m jsonb;
  b jsonb;
  bytes bytea;
  previous bytea;
  idx integer;
  n integer;
  settlement record;
  journal_state text;
begin
  if p_actor_user_id is null or p_effect_id !~ '^effect:[0-9a-f]{64}$'
    or p_kind not in ('image','text','compaction') or p_operation not in
    ('probe','prepare','write','publish','read','chunk','ack') then
    return jsonb_build_object('error','invalid_result_identity');
  end if;
  perform pg_advisory_xact_lock(hashtextextended(p_actor_user_id::text,33));
  perform public.cleanup_external_result_payloads(p_actor_user_id);
  if p_operation='probe' then
    if not exists(select 1 from public.external_effect where actor_user_id=p_actor_user_id and effect_id=p_effect_id)
      and (select coalesce(sum((manifest->>'byteLength')::integer),0) from public.external_result
      where actor_user_id=p_actor_user_id and expires_at>now()) +
    (select coalesce(sum(result_reserved_bytes),0) from public.external_effect where actor_user_id=p_actor_user_id) + (case when p_kind='image' then 16777216 else 8388608 end)>134217728 then
      return jsonb_build_object('error','result_capacity_exceeded'); end if;
    return jsonb_build_object('ready',true);
  end if;
  if not exists (select 1 from public.external_effect e where e.actor_user_id=p_actor_user_id
      and e.effect_id=p_effect_id and e.kind=p_kind) then
    if p_operation='read' then return jsonb_build_object('state','absent'); end if;
    return jsonb_build_object('error','result_effect_unavailable');
  end if;
  if p_operation='prepare' then
    m:=p_payload->'manifest'; b:=nullif(p_payload->'binding','null'::jsonb);
    if m->>'effectId' is distinct from p_effect_id or m->>'kind' is distinct from p_kind or
      m->>'version' is distinct from '1' or coalesce(m->>'resultId','') !~ '^result:[0-9a-f]{64}$' or
      coalesce(m->>'sha256','') !~ '^[0-9a-f]{64}$' or
      coalesce((m->>'byteLength')::integer,0) not between 1 and
        (case when p_kind='image' then 16777216 else 8388608 end) or
      coalesce((m->>'chunkCount')::integer,0) <> ((m->>'byteLength')::integer+524287)/524288 or
      (p_kind='image' and coalesce(m->>'mimeType','') !~ '^image/(png|jpeg|webp|gif|avif)$') or
      (p_kind<>'image' and m->>'mimeType' is distinct from 'application/json') or
      octet_length(coalesce(b,'{}'::jsonb)::text)>32768 then
      return jsonb_build_object('error','invalid_result_manifest');
    end if;
    if not exists(select 1 from public.external_result where actor_user_id=p_actor_user_id and effect_id=p_effect_id)
      and (select coalesce(sum((manifest->>'byteLength')::integer),0) from public.external_result
      where actor_user_id=p_actor_user_id and expires_at>now()) +
    (select coalesce(sum(result_reserved_bytes),0) from public.external_effect where actor_user_id=p_actor_user_id) -
      (select result_reserved_bytes from public.external_effect where actor_user_id=p_actor_user_id and effect_id=p_effect_id) +
      (m->>'byteLength')::integer>134217728 then
      return jsonb_build_object('error','result_capacity_exceeded');
    end if;
    insert into public.external_result(actor_user_id,effect_id,manifest,binding)
      values(p_actor_user_id,p_effect_id,m,b) on conflict do nothing;
    update public.external_effect set result_reserved_bytes=0 where actor_user_id=p_actor_user_id and effect_id=p_effect_id;
  end if;
  select * into r from public.external_result where actor_user_id=p_actor_user_id and effect_id=p_effect_id for update;
  if not found then return jsonb_build_object('state','absent'); end if;
  if r.expires_at<=now() then return jsonb_build_object('state','expired'); end if;
  if p_operation='prepare' and (r.manifest<>m or r.binding is distinct from b) then
    return jsonb_build_object('error','result_identity_conflict');
  end if;
  if p_operation in ('write','publish','chunk','ack') and p_payload->>'resultId' is distinct from r.manifest->>'resultId' then
    return jsonb_build_object('error','result_identity_conflict');
  end if;
  if p_operation='write' then
    idx:=(p_payload->>'index')::integer;
    if idx is null or idx<0 or idx>=(r.manifest->>'chunkCount')::integer or
      coalesce(length(p_payload->>'base64'),0)>699052 then return jsonb_build_object('error','invalid_result_chunk'); end if;
    bytes:=decode(p_payload->>'base64','base64');
    if bytes is null or octet_length(bytes)<>least(524288,(r.manifest->>'byteLength')::integer-idx*524288) then
      return jsonb_build_object('error','invalid_result_chunk'); end if;
    select data into previous from public.external_result_chunk where actor_user_id=p_actor_user_id
      and effect_id=p_effect_id and chunk_index=idx;
    if found and previous<>bytes then return jsonb_build_object('error','result_chunk_conflict'); end if;
    insert into public.external_result_chunk values(p_actor_user_id,p_effect_id,idx,bytes) on conflict do nothing;
  elsif p_operation='publish' and r.published_at is null then
    select count(*)::integer,string_agg(data,''::bytea order by chunk_index) into n,bytes
      from public.external_result_chunk where actor_user_id=p_actor_user_id and effect_id=p_effect_id;
    if n<>(r.manifest->>'chunkCount')::integer or octet_length(bytes)<>(r.manifest->>'byteLength')::integer or
      encode(sha256(bytes),'hex')<>r.manifest->>'sha256' then
      return jsonb_build_object('error','result_incomplete'); end if;
    b:=r.binding;
    if b is not null then
      if not exists(select 1 from private.agent_turn_journal j where j.server_turn_id=(b->>'serverTurnId')::uuid
        and j.user_id=p_actor_user_id and j.local_project_id=b->>'localProjectId') then
        return jsonb_build_object('error','result_journal_binding_conflict'); end if;
      if p_kind='text' then
        select * into settlement from public.settle_agent_turn_request_with_verified_authority(
          p_actor_user_id,(b->>'serverTurnId')::uuid,b->>'localProjectId',b->>'requestId',(b->>'stepSequence')::integer,
          case when b->>'status'='awaitingNextRequest' then 'awaiting_next_request' else 'externally_completed' end,
          null,coalesce(b->'claims','[]'::jsonb));
      else
        perform set_config('request.jwt.claim.sub',p_actor_user_id::text,true);
        select * into settlement from public.settle_agent_turn_external_action(
          (b->>'serverTurnId')::uuid,b->>'localProjectId',b->>'requestId',(b->>'stepSequence')::integer,
          b->>'actionId',p_kind,b->>'actionHash','externally_completed',null,null);
      end if;
      -- Late results survive administrative closure. Never reopen or mint Tool claims after closure.
      if settlement.decision='denied' and settlement.denial_reason not in ('status_conflict','terminal_turn') then
        return jsonb_build_object('error','result_journal_binding_conflict'); end if;
    end if;
    update public.external_result set published_at=now() where actor_user_id=p_actor_user_id and effect_id=p_effect_id;
    r.published_at:=now();
  elsif p_operation='ack' then
    if r.published_at is null or p_payload->>'version' is distinct from '1' or
      p_payload->>'sha256' is distinct from r.manifest->>'sha256' then
      return jsonb_build_object('error','result_ack_conflict'); end if;
    update public.external_result set acknowledged_at=coalesce(acknowledged_at,now())
      where actor_user_id=p_actor_user_id and effect_id=p_effect_id;
    return jsonb_build_object('acknowledged',true);
  elsif p_operation='chunk' then
    if r.published_at is null then return jsonb_build_object('error','external_result_unavailable'); end if;
    select data into bytes from public.external_result_chunk where actor_user_id=p_actor_user_id
      and effect_id=p_effect_id and chunk_index=(p_payload->>'index')::integer;
    if not found then return jsonb_build_object('error','external_result_unavailable'); end if;
    return jsonb_build_object('base64',replace(encode(bytes,'base64'),E'\n',''));
  end if;
  return jsonb_build_object('state',case when r.published_at is null then 'unavailable' else 'available' end,
    'manifest',r.manifest||jsonb_build_object('expiresAt',r.expires_at),
    'acknowledged',r.acknowledged_at is not null,
    'providerTaskId',(select a.provider_task_id from public.external_effect_attempt a
      join public.external_effect e on e.actor_user_id=a.actor_user_id and e.effect_id=a.effect_id
        and e.latest_attempt_id=a.attempt_id
      where e.actor_user_id=p_actor_user_id and e.effect_id=p_effect_id));
end; $$;
revoke all on function public.operate_external_result(uuid,text,text,text,jsonb) from public,anon,authenticated;
grant execute on function public.operate_external_result(uuid,text,text,text,jsonb) to service_role;

-- Install cleanup only when the deployment already enables pg_cron. Without it, rollout must
-- schedule the service-only cleanup RPC externally. Access expiry does not depend on the schedule.
do $$ begin
  if exists(select 1 from pg_extension where extname='pg_cron') then
    perform cron.schedule('morpho-external-payload-cleanup','*/15 * * * *',
      'select public.cleanup_external_result_payloads();');
  end if;
end $$;
select public.cleanup_external_result_payloads();
