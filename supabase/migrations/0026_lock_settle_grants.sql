-- `revoke ... from public` does not undo Supabase's default privileges, which
-- grant EXECUTE on every new function in this schema to anon and authenticated
-- by name. Until these are revoked by name, any signed-in visitor could call
-- settle_promptpay on their own pending intent and hand themselves Pro.
--
-- Found by calling it with an ordinary user's token during testing; it
-- returned {"status":"paid"}.
revoke execute on function public.settle_promptpay(uuid, text, jsonb, text)
  from anon, authenticated, public;
revoke execute on function public.reject_promptpay(uuid, text)
  from anon, authenticated, public;

grant execute on function public.settle_promptpay(uuid, text, jsonb, text) to service_role;
grant execute on function public.reject_promptpay(uuid, text) to service_role;

-- extend_pro is the other door into the same room, so make that explicit
-- rather than inherited.
revoke execute on function public.extend_pro(uuid, integer)
  from anon, authenticated, public;
grant execute on function public.extend_pro(uuid, integer) to service_role;
