-- =====================================================================
-- Owner account management without Edge Functions:
-- the owner creates login accounts (any role) and resets passwords from the app.
-- =====================================================================

create or replace function public.admin_create_user(
  p_email text,
  p_password text,
  p_full_name text,
  p_role public.app_role,
  p_phone text default '',
  p_pin text default null,
  p_employee_id uuid default null
)
returns uuid
language plpgsql
security definer
set search_path = public, extensions, auth
as $$
declare
  v_id uuid := gen_random_uuid();
  v_email text := lower(trim(coalesce(p_email, '')));
  v_name text := trim(coalesce(p_full_name, ''));
  v_label text := case p_role when 'owner' then 'المالك' when 'manager' then 'مدير' when 'cashier' then 'كاشير'
                              when 'kitchen' then 'مطبخ' else 'مسؤول مخزون' end;
begin
  perform public.require_role('owner');
  if v_email !~ '^[^\s@]+@[^\s@]+\.[^\s@]+$' then
    raise exception 'INVALID_EMAIL' using errcode = '22023';
  end if;
  if char_length(coalesce(p_password, '')) < 8 then
    raise exception 'WEAK_PASSWORD' using errcode = '22023';
  end if;
  if char_length(v_name) < 2 or char_length(v_name) > 120 then
    raise exception 'INVALID_NAME' using errcode = '22023';
  end if;
  if p_pin is not null and p_pin <> '' and p_pin !~ '^[0-9]{4,6}$' then
    raise exception 'INVALID_PIN' using errcode = '22023';
  end if;
  if exists (select 1 from auth.users where lower(email) = v_email) then
    raise exception 'EMAIL_TAKEN' using errcode = '23505';
  end if;
  if p_pin is not null and p_pin <> '' and exists (
    select 1 from public.profiles where is_active and pin_hash is not null and pin_hash = extensions.crypt(p_pin, pin_hash)
  ) then
    raise exception 'PIN_TAKEN' using errcode = '23505';
  end if;

  insert into auth.users (
    instance_id, id, aud, role, email, encrypted_password, email_confirmed_at,
    raw_app_meta_data, raw_user_meta_data, created_at, updated_at,
    confirmation_token, email_change, email_change_token_new, recovery_token
  ) values (
    '00000000-0000-0000-0000-000000000000', v_id, 'authenticated', 'authenticated', v_email,
    extensions.crypt(p_password, extensions.gen_salt('bf')), now(),
    jsonb_build_object('provider', 'email', 'providers', array['email'], 'role', p_role, 'full_name', v_name, 'language', 'ar'),
    jsonb_build_object('full_name', v_name), now(), now(), '', '', '', ''
  );
  insert into auth.identities (id, user_id, provider_id, identity_data, provider, last_sign_in_at, created_at, updated_at)
  values (gen_random_uuid(), v_id, v_id::text,
          jsonb_build_object('sub', v_id::text, 'email', v_email, 'email_verified', true),
          'email', now(), now(), now());
  -- public.profiles row is created by the on_auth_user_created trigger

  if p_pin is not null and p_pin <> '' then
    update public.profiles set pin_hash = extensions.crypt(p_pin, extensions.gen_salt('bf', 8)) where id = v_id;
  end if;

  if p_employee_id is not null then
    update public.employees_meta set profile_id = v_id, phone = coalesce(nullif(trim(p_phone), ''), phone)
    where id = p_employee_id and profile_id is null;
  else
    insert into public.employees_meta (profile_id, full_name, position, phone)
    values (v_id, v_name, v_label, trim(coalesce(p_phone, '')));
  end if;

  perform public.write_audit('create_user', 'profile', v_id, jsonb_build_object('email', v_email, 'role', p_role));
  return v_id;
end;
$$;

create or replace function public.admin_set_password(p_user_id uuid, p_password text)
returns void
language plpgsql
security definer
set search_path = public, extensions, auth
as $$
begin
  perform public.require_role('owner');
  if char_length(coalesce(p_password, '')) < 8 then
    raise exception 'WEAK_PASSWORD' using errcode = '22023';
  end if;
  update auth.users set encrypted_password = extensions.crypt(p_password, extensions.gen_salt('bf')), updated_at = now()
  where id = p_user_id;
  if not found then
    raise exception 'NOT_FOUND' using errcode = 'P0002';
  end if;
  perform public.write_audit('reset_password', 'profile', p_user_id, '{}');
end;
$$;

revoke all on function public.admin_create_user(text, text, text, public.app_role, text, text, uuid) from public, anon;
revoke all on function public.admin_set_password(uuid, text) from public, anon;
grant execute on function public.admin_create_user(text, text, text, public.app_role, text, text, uuid) to authenticated;
grant execute on function public.admin_set_password(uuid, text) to authenticated;
