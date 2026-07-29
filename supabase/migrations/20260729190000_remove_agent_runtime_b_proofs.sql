-- Stage 4 forward-only cleanup for the retired Agent Runtime B lease/proof model.
-- The A+ Server Turn Journal and External Action Journal remain authoritative.

drop function if exists public.read_agent_turn_lease_state(uuid, text);
drop function if exists public.read_agent_turn_closure_state(uuid, text, text, text);
drop function if exists public.mark_agent_turn_tool_execution_started(uuid, text);
drop function if exists public.mark_agent_turn_provider_failure(uuid, text, text, integer);
drop function if exists public.complete_agent_turn_lease(uuid, text, text, text, text, integer);
drop function if exists public.continue_agent_turn_lease(uuid, text, text, integer, text, text, text);
drop function if exists public.start_agent_turn_lease(text, text, text, text);

drop table if exists private.ai_agent_turn_leases;
