-- Authentication only: no tracker schema or records. No real identifiers belong here.
-- Apply manually only after setup approval, using the project migration/admin role.
-- One reviewed setting row is entered privately after client registration.
begin;
create schema if not exists private;
revoke all on schema private from public, anon, authenticated;
create table private.mcp_oauth_settings (
  singleton boolean primary key default true check (singleton),
  client_id uuid not null,
  owner_id uuid not null,
  resource text not null check (resource ~ '^https://[a-z0-9.-]+/mcp$')
);
alter table private.mcp_oauth_settings enable row level security;
revoke all on private.mcp_oauth_settings from public, anon, authenticated, supabase_auth_admin;

-- SECURITY DEFINER is necessary only to read the private operator setting.
-- Empty search_path, fully qualified objects, no dynamic SQL or caller user metadata.
create function public.mcp_access_token_hook(event jsonb)
returns jsonb
language plpgsql stable security definer set search_path = ''
as $$
declare
  claims jsonb := event->'claims';
  settings private.mcp_oauth_settings%rowtype;
begin
  if claims is null or jsonb_typeof(claims) <> 'object' then
    raise exception 'Invalid access-token event';
  end if;
  -- Direct dashboard login/refresh has no OAuth client: preserve it byte-for-byte.
  if nullif(claims->>'client_id', '') is null then
    return event;
  end if;
  select * into settings from private.mcp_oauth_settings where singleton = true;
  if not found then
    raise exception 'MCP OAuth settings unavailable';
  end if;
  if claims->>'client_id' = settings.client_id::text then
    if claims->>'sub' is distinct from settings.owner_id::text
       or claims->>'role' is distinct from 'authenticated'
       or claims->'is_anonymous' is distinct from 'false'::jsonb then
      raise exception 'MCP owner authorization denied';
    end if;
    -- Fixed client-to-resource binding, including refresh issuance.
    -- Do not claim this implements arbitrary RFC 8707 resource negotiation.
    claims := jsonb_set(claims, '{aud}', to_jsonb(settings.resource));
    return jsonb_set(event, '{claims}', claims);
  end if;
  -- Other clients retain their normal audience and cannot pass our MCP verifier.
  return event;
end;
$$;
revoke all on function public.mcp_access_token_hook(jsonb) from public, anon, authenticated;
grant execute on function public.mcp_access_token_hook(jsonb) to supabase_auth_admin;
grant usage on schema public to supabase_auth_admin;
commit;
