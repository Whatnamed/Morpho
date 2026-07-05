create or replace function private.create_pending_access_for_new_user()
returns trigger
language plpgsql
security definer
set search_path = private, public, pg_temp
as $$
begin
  insert into public.app_user_access (user_id, role, status, daily_text_limit, daily_image_limit)
  values (new.id, 'tester', 'active', 20, 4)
  on conflict (user_id) do nothing;
  return new;
end;
$$;
