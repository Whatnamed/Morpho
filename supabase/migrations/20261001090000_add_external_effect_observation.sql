-- P3A: additive execution facts, independent of legacy Turn/Action terminal absorption.
-- No legacy backfill, cascading cleanup, result payload/locator store, ACK or retention policy.
create table if not exists public.external_effect (
  actor_user_id uuid not null references auth.users(id),
  effect_id text not null,
  kind text not null check (kind in ('image', 'text', 'compaction')),
  contract_version integer not null default 1,
  frozen_request text,
  request_digest text,
  provider_namespace jsonb,
  execution_state text not null default 'unknown'
    check (execution_state in ('unknown', 'running', 'succeeded', 'failed', 'cancelled')),
  cancel_requested_at timestamptz,
  local_abort_observed_at timestamptz,
  latest_attempt_id uuid,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  primary key (actor_user_id, effect_id)
);

create table if not exists public.external_effect_attempt (
  actor_user_id uuid not null,
  effect_id text not null,
  attempt_id uuid not null,
  frozen_request text not null,
  request_digest text not null,
  correction text,
  provider_task_id text,
  provider_response_id text,
  last_observation text,
  created_at timestamptz not null default now(),
  primary key (actor_user_id, effect_id, attempt_id),
  foreign key (actor_user_id, effect_id) references public.external_effect(actor_user_id, effect_id)
);

create table if not exists public.external_effect_observation (
  actor_user_id uuid not null,
  effect_id text not null,
  attempt_id uuid not null,
  observation_id text not null,
  observation jsonb not null,
  observed_at timestamptz not null default now(),
  primary key (actor_user_id, effect_id, observation_id),
  foreign key (actor_user_id, effect_id, attempt_id)
    references public.external_effect_attempt(actor_user_id, effect_id, attempt_id)
);

alter table public.external_effect enable row level security;
alter table public.external_effect_attempt enable row level security;
alter table public.external_effect_observation enable row level security;
revoke all on public.external_effect, public.external_effect_attempt,
  public.external_effect_observation from public, anon, authenticated;
grant all on public.external_effect, public.external_effect_attempt,
  public.external_effect_observation to service_role;

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
  if p_actor_user_id is null or p_effect_id !~ '^effect:[0-9a-f]{64}$'
    or p_kind not in ('image', 'text', 'compaction')
    or p_operation not in ('register', 'correction', 'observe', 'read', 'cancel') then
    return jsonb_build_object('error', 'invalid_effect_identity');
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
      or octet_length(p_payload->>'frozenRequest') > 37748736
      or jsonb_typeof(p_payload->'namespace') <> 'object'
      or p_payload->'namespace'->>'provider' not in ('grsai', 'openai-compatible')
      or p_payload->'namespace'->>'credentialScope' !~ '^[0-9a-f]{64}$'
      or p_payload->'namespace'->>'baseUrl' !~ '^https?://'
      or p_payload->>'attemptId' is null then
      return jsonb_build_object('error', 'invalid_effect_request');
    end if;
    next_attempt := (p_payload->>'attemptId')::uuid;
    if p_operation = 'register' then
      if effect.frozen_request is not null and
        (effect.request_digest <> p_payload->>'requestDigest'
          or effect.frozen_request <> p_payload->>'frozenRequest'
          or effect.provider_namespace <> p_payload->'namespace') then
        return jsonb_build_object('error', 'effect_request_conflict');
      end if;
      -- Only insertion into this registry authorizes the first attempt. Cancellation tombstones
      -- and existing rows (including unknown) cannot grant a paid resubmission.
      granted := inserted = 1 and effect.cancel_requested_at is null;
      if effect.frozen_request is null then
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
      granted := effect.execution_state = 'failed' and effect.cancel_requested_at is null and effect.provider_namespace = p_payload->'namespace'
        and attempt.last_observation = 'rejected'
        and attempt.provider_task_id is null and attempt.provider_response_id is null
        and p_payload->>'correction' in ('cacheCompatibility', 'imageCompatibility')
        and not exists (select 1 from public.external_effect_attempt a
          where a.actor_user_id = p_actor_user_id and a.effect_id = p_effect_id
            and a.correction = p_payload->>'correction');
    end if;
    if granted then
      insert into public.external_effect_attempt(actor_user_id, effect_id, attempt_id,
        frozen_request, request_digest, correction)
        values (p_actor_user_id, p_effect_id, next_attempt, p_payload->>'frozenRequest',
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
