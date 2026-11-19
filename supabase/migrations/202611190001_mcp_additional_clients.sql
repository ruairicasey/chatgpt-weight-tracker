-- Authentication only: allow further reviewed OAuth clients (e.g. Claude) to receive the
-- fixed MCP audience. Owner, role and anonymity checks are unchanged for every client.
-- Rows are entered privately after client registration. No real identifiers belong here.
begin;
create table private.mcp_oauth_additional_clients (
  client_id uuid primary key,
  label text not null check (label in ('Claude'))
);
alter table private.mcp_oauth_additional_clients enable row level security;
alter table private.mcp_oauth_additional_clients force row level security;
revoke all on private.mcp_oauth_additional_clients from public, anon, authenticated, supabase_auth_admin;

create or replace function public.mcp_access_token_hook(event jsonb)
returns jsonb
language plpgsql stable security definer set search_path = ''
as $$
declare
  claims jsonb := event->'claims';
  settings private.mcp_oauth_settings%rowtype;
  approved boolean;
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
  approved := claims->>'client_id' = settings.client_id::text
    or exists (select 1 from private.mcp_oauth_additional_clients c where c.client_id::text = claims->>'client_id');
  if approved then
    if claims->>'sub' is distinct from settings.owner_id::text
       or claims->>'role' is distinct from 'authenticated'
       or claims->'is_anonymous' is distinct from 'false'::jsonb then
      raise exception 'MCP owner authorization denied';
    end if;
    claims := jsonb_set(claims, '{aud}', to_jsonb(settings.resource));
    return jsonb_set(event, '{claims}', claims);
  end if;
  -- Other clients retain their normal audience and cannot pass our MCP verifier.
  return event;
end;
$$;
revoke all on function public.mcp_access_token_hook(jsonb) from public, anon, authenticated;
grant execute on function public.mcp_access_token_hook(jsonb) to supabase_auth_admin;
commit;
