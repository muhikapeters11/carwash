-- Ensure login_with_pin is callable from the web app (anon key).
-- Safe to re-run.

create extension if not exists pgcrypto with schema extensions;

create or replace function public.login_with_pin(p_pin text)
returns json
language plpgsql
security definer
set search_path = public, extensions
as $$
declare
  v_user public.profiles%rowtype;
begin
  if p_pin is null or length(trim(p_pin)) < 4 then
    return json_build_object('ok', false, 'error', 'Invalid PIN');
  end if;

  select * into v_user
  from public.profiles
  where is_active is not false
    and pin_hash is not null
    and pin_hash = crypt(trim(p_pin), pin_hash)
  limit 1;

  if not found then
    return json_build_object('ok', false, 'error', 'Invalid PIN');
  end if;

  return json_build_object(
    'ok', true,
    'user', json_build_object(
      'id', v_user.id,
      'email', v_user.email,
      'full_name', v_user.full_name,
      'role', v_user.role,
      'permissions', coalesce(v_user.permissions, array[]::text[])
    )
  );
end;
$$;

revoke all on function public.login_with_pin(text) from public;
grant execute on function public.login_with_pin(text) to anon, authenticated, service_role;

grant select on public.profiles to anon, authenticated;
