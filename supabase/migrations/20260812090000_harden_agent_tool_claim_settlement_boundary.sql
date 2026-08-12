-- F02: every Provider settlement must cross one server-only authority boundary.
-- The existing routines remain the bounded state-machine implementation, but
-- are no longer callable by browser roles. The wrapper below is the only
-- privileged entry point and re-checks the authenticated actor explicitly.

revoke all on function public.settle_agent_turn_request(
  uuid, text, text, integer, text, text
)
from public, anon, authenticated, service_role;

revoke all on function public.settle_agent_turn_request_with_action_claims(
  uuid, text, text, integer, text, text, jsonb
)
from public, anon, authenticated, service_role;

create or replace function public.settle_agent_turn_request_with_verified_authority(
  p_actor_user_id uuid,
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
  turn_owned boolean;
begin
  if p_actor_user_id is null then
    raise exception 'invalid actor user' using errcode = '22023';
  end if;

  -- This is an explicit actor/project ownership check. The delegated state
  -- machine below performs the same check again through auth.uid().
  select exists (
    select 1
    from private.agent_turn_journal as journal
    where journal.server_turn_id = p_server_turn_id
      and journal.user_id = p_actor_user_id
      and journal.local_project_id = p_local_project_id
  ) into turn_owned;

  if not turn_owned then
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

  -- auth.uid() in the existing definer state machine reads this transaction-
  -- local claim. It cannot be supplied by the browser because this function is
  -- executable only by service_role, which is the role used by SUPABASE_SECRET_KEY.
  perform set_config('request.jwt.claim.sub', p_actor_user_id::text, true);

  return query
  select *
  from public.settle_agent_turn_request_with_action_claims(
    p_server_turn_id,
    p_local_project_id,
    p_request_id,
    p_step_sequence,
    p_status,
    p_failure_code,
    p_claims
  );
end;
$$;

revoke all on function public.settle_agent_turn_request_with_verified_authority(
  uuid, uuid, text, text, integer, text, text, jsonb
)
from public, anon, authenticated, service_role;

grant execute on function public.settle_agent_turn_request_with_verified_authority(
  uuid, uuid, text, text, integer, text, text, jsonb
)
to service_role;
