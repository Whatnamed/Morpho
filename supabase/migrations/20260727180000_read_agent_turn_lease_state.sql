-- Read-only recovery primitive for a client that lost the HTTP response after a
-- web-search request. It exposes only the live lease counters and sequence; it
-- never returns request hashes or payload data.

create or replace function public.read_agent_turn_lease_state(
  p_lease_id uuid,
  p_agent_turn_id text
)
returns table (
  active boolean,
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
  if p_lease_id is null or p_agent_turn_id is null or
    char_length(p_agent_turn_id) not between 1 and 160 or
    p_agent_turn_id !~ '^[A-Za-z0-9._:-]+$' then
    raise exception 'invalid agent turn lease state input' using errcode = '22023';
  end if;

  select lease.* into lease_row
  from private.ai_agent_turn_leases as lease
  where lease.id = p_lease_id
    and lease.user_id = current_user_id
    and lease.agent_turn_id = p_agent_turn_id;

  if not found or lease_row.status <> 'active' or lease_row.expires_at <= now() then
    return query select false, null::timestamptz, 0, 0, 0;
    return;
  end if;

  return query
  select true,
    lease_row.expires_at,
    lease_row.provider_call_count,
    lease_row.web_search_call_count,
    lease_row.next_provider_sequence;
end;
$$;

revoke all on function public.read_agent_turn_lease_state(uuid, text)
  from public, anon, authenticated;
grant execute on function public.read_agent_turn_lease_state(uuid, text)
  to authenticated;
