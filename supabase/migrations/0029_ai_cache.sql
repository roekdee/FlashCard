-- ============================================================
-- Reuse AI coach answers. The same sentence checked against the same word,
-- or the same conversation so far in the same scene and level, gets the
-- stored answer instead of a new Gemini call — no model quota, no charge to
-- the learner's daily AI allowance, and an instant reply.
--
-- The key is a SHA-256 of the normalised request, computed in the edge
-- function. Only service_role touches this table (no RLS policies at all).
-- ============================================================

create table if not exists public.ai_cache (
  key        text primary key check (char_length(key) = 64),
  action     text not null check (action in ('check','chat')),
  response   jsonb not null,
  hits       int  not null default 0,
  created_at timestamptz not null default now(),
  last_hit   timestamptz
);
alter table public.ai_cache enable row level security;
revoke all on public.ai_cache from anon, authenticated;

create or replace function public.bump_ai_cache_hit(p_key text)
returns void
language sql security definer
set search_path = public, pg_temp
as $fn$
  update public.ai_cache set hits = hits + 1, last_hit = now() where key = p_key;
$fn$;
revoke all on function public.bump_ai_cache_hit(text) from public, anon, authenticated;
grant execute on function public.bump_ai_cache_hit(text) to service_role;
