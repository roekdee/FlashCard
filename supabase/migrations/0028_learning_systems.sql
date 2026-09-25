-- ============================================================
-- Learning systems beyond "see the word, recall the meaning":
--   * four more study modes (cloze, reverse, dictation, shadow)
--   * placement / level checks with history
--   * grammar lessons on the same SM-2 schedule as words
--   * a leech drill for words forgotten again and again
--   * queue_word: push a word met while reading into today's reviews
--   * a daily quota for the AI coach (edge function ai-coach)
-- ============================================================

-- ---------- study modes ----------
alter table public.reviews drop constraint if exists reviews_mode_check;
alter table public.reviews add constraint reviews_mode_check
  check (mode in ('flip','quiz','typing','speak','cloze','reverse','dictation','shadow'));

alter table public.plan_limits add column if not exists ai_per_day int not null default 0;

update public.plan_limits set modes = array['flip','cloze'], ai_per_day = 5 where plan = 'free';
update public.plan_limits
   set modes = array['flip','quiz','typing','speak','cloze','reverse','dictation','shadow'],
       ai_per_day = 40
 where plan = 'pro';

-- ---------- placement / level checks ----------
create table if not exists public.level_checks (
  id         bigint generated always as identity primary key,
  user_id    uuid not null references auth.users (id) on delete cascade,
  taken_at   timestamptz not null default now(),
  level      text not null check (level in ('A1','A2','B1','B2','C1','C2')),
  score      int  not null check (score between 0 and 100),
  vocab_size int  not null check (vocab_size >= 0)
);
create index if not exists level_checks_user_idx on public.level_checks (user_id, taken_at desc);
alter table public.level_checks enable row level security;
create policy level_checks_own_read on public.level_checks
  for select to authenticated using (user_id = (select auth.uid()));

alter table public.profiles add column if not exists placement_level text
  check (placement_level in ('A1','A2','B1','B2','C1','C2'));

-- Random words from every level, each with three wrong glosses from the same
-- level, so a test-taker cannot claim a word without showing they know it.
create or replace function public.get_placement_items(p_per_level int default 8)
returns table (id uuid, word text, level text, translation text, options text[])
language sql security invoker
set search_path = public, pg_temp
as $fn$
  with picked as (
    select w.*, row_number() over (partition by w.level order by random()) as rn
    from public.words w
    where w.level is not null and w.translation is not null
  )
  select p.id, p.word, p.level, p.translation,
         array(select d.translation from public.words d
               where d.level = p.level and d.id <> p.id and d.translation is not null
                 and split_part(d.translation, ' /', 1) <> split_part(p.translation, ' /', 1)
               order by random() limit 3) as options
  from picked p
  where p.rn <= least(greatest(p_per_level, 3), 15)
  order by array_position(array['A1','A2','B1','B2','C1','C2'], p.level), random();
$fn$;

create or replace function public.save_level_check(p_level text, p_score int, p_vocab int)
returns public.level_checks
language plpgsql security definer
set search_path = public, pg_temp
as $fn$
declare
  v_uid uuid := auth.uid();
  v_row public.level_checks;
begin
  if v_uid is null then raise exception 'not authenticated' using errcode = '28000'; end if;
  insert into public.level_checks (user_id, level, score, vocab_size)
  values (v_uid, p_level, least(greatest(p_score, 0), 100), greatest(p_vocab, 0))
  returning * into v_row;
  update public.profiles set placement_level = p_level where id = v_uid;
  return v_row;
end;
$fn$;

create or replace function public.get_level_checks()
returns setof public.level_checks
language sql security invoker
set search_path = public, pg_temp
as $fn$
  select * from public.level_checks where user_id = auth.uid() order by taken_at desc limit 50;
$fn$;

-- ---------- grammar on SM-2 ----------
create table if not exists public.grammar_progress (
  user_id       uuid not null references auth.users (id) on delete cascade,
  lesson_id     text not null check (char_length(lesson_id) between 3 and 80),
  repetitions   int  not null default 0,
  interval_days int  not null default 0,
  ease_factor   numeric(4,2) not null default 2.50,
  due_at        timestamptz,
  best_score    int  not null default 0,
  last_score    int  not null default 0,
  passed_at     timestamptz,
  updated_at    timestamptz not null default now(),
  primary key (user_id, lesson_id)
);
alter table public.grammar_progress enable row level security;
create policy grammar_progress_own_read on public.grammar_progress
  for select to authenticated using (user_id = (select auth.uid()));

-- p_score out of p_total: all right = 5, one wrong = 4, two wrong = 3, worse = 1.
create or replace function public.review_grammar(p_lesson_id text, p_score int, p_total int default 5)
returns public.grammar_progress
language plpgsql security definer
set search_path = public, pg_temp
as $fn$
declare
  v_uid   uuid := auth.uid();
  v_cur   public.grammar_progress;
  v_next  record;
  v_grade int;
  v_row   public.grammar_progress;
begin
  if v_uid is null then raise exception 'not authenticated' using errcode = '28000'; end if;
  if p_total < 1 or p_score < 0 or p_score > p_total then raise exception 'bad score'; end if;

  v_grade := case p_total - p_score when 0 then 5 when 1 then 4 when 2 then 3 else 1 end;
  select * into v_cur from public.grammar_progress where user_id = v_uid and lesson_id = p_lesson_id;
  select * into v_next from public.sm2_next(
    coalesce(v_cur.repetitions, 0), coalesce(v_cur.interval_days, 0),
    coalesce(v_cur.ease_factor, 2.50), v_grade);

  insert into public.grammar_progress as g (user_id, lesson_id, repetitions, interval_days, ease_factor,
                                            due_at, best_score, last_score, passed_at, updated_at)
  values (v_uid, p_lesson_id, v_next.repetitions, v_next.interval_days, v_next.ease_factor,
          now() + make_interval(days => v_next.interval_days),
          p_score, p_score, case when v_grade >= 4 then now() end, now())
  on conflict (user_id, lesson_id) do update set
    repetitions   = excluded.repetitions,
    interval_days = excluded.interval_days,
    ease_factor   = excluded.ease_factor,
    due_at        = excluded.due_at,
    best_score    = greatest(g.best_score, excluded.last_score),
    last_score    = excluded.last_score,
    passed_at     = coalesce(g.passed_at, excluded.passed_at),
    updated_at    = now()
  returning * into v_row;
  return v_row;
end;
$fn$;

create or replace function public.get_grammar_progress()
returns setof public.grammar_progress
language sql security invoker
set search_path = public, pg_temp
as $fn$
  select * from public.grammar_progress where user_id = auth.uid();
$fn$;

-- ---------- leech drill ----------
create or replace function public.get_leech_queue(p_limit int default 40, p_min_lapses int default 3)
returns table (
  id uuid, word text, pos text, level text, translation text, pronunciation text,
  example_en text, example_th text,
  status text, repetitions int, interval_days int, ease_factor numeric,
  due_at timestamptz, is_new boolean, lapses int)
language sql security invoker
set search_path = public, pg_temp
as $fn$
  select w.id, w.word, w.pos, w.level, w.translation, w.pronunciation,
         w.example_en, w.example_th,
         cs.status, cs.repetitions, cs.interval_days, cs.ease_factor, cs.due_at, false, cs.lapses
  from public.card_states cs join public.words w on w.id = cs.word_id
  where cs.user_id = auth.uid() and cs.status <> 'suspended' and cs.lapses >= greatest(p_min_lapses, 1)
  order by cs.lapses desc, cs.due_at nulls first
  limit least(greatest(p_limit, 1), 100);
$fn$;

-- ---------- a word met while reading goes into today's reviews ----------
create or replace function public.queue_word(p_word_id uuid)
returns public.card_states
language plpgsql security invoker
set search_path = public, pg_temp
as $fn$
declare
  v_uid    uuid := auth.uid();
  v_levels text[];
  v_level  text;
  v_row    public.card_states;
begin
  if v_uid is null then raise exception 'not authenticated' using errcode = '28000'; end if;
  select level into v_level from public.words where id = p_word_id;
  if not found then raise exception 'ไม่พบคำนี้'; end if;
  select levels into v_levels from app_private.plan_of(v_uid);
  if v_levels is not null and not (v_level = any (v_levels)) then
    raise exception 'คำระดับนี้ใช้ได้เฉพาะสมาชิก Pro' using errcode = '42501';
  end if;

  insert into public.card_states as cs (user_id, word_id, status, due_at)
  values (v_uid, p_word_id, 'learning', now())
  on conflict (user_id, word_id) do update set
    status     = case when cs.status = 'suspended' then 'learning' else cs.status end,
    due_at     = now(),
    updated_at = now()
  returning * into v_row;
  return v_row;
end;
$fn$;

-- ---------- AI coach quota (called by the edge function as service_role) ----------
create table if not exists public.ai_usage (
  user_id uuid not null references auth.users (id) on delete cascade,
  day     date not null,
  calls   int  not null default 0,
  primary key (user_id, day)
);
alter table public.ai_usage enable row level security;
create policy ai_usage_own_read on public.ai_usage
  for select to authenticated using (user_id = (select auth.uid()));

-- Returns calls left after this one, or -1 when the day's quota is spent.
create or replace function public.consume_ai_quota(p_user uuid)
returns int
language plpgsql security definer
set search_path = public, pg_temp
as $fn$
declare
  v_limit int;
  v_used  int;
  v_day   date := (now() at time zone 'Asia/Bangkok')::date;
begin
  select ai_per_day into v_limit from app_private.plan_of(p_user);
  insert into public.ai_usage (user_id, day, calls) values (p_user, v_day, 0)
  on conflict (user_id, day) do nothing;
  select calls into v_used from public.ai_usage where user_id = p_user and day = v_day for update;
  if v_used >= coalesce(v_limit, 0) then return -1; end if;
  update public.ai_usage set calls = calls + 1 where user_id = p_user and day = v_day;
  return coalesce(v_limit, 0) - v_used - 1;
end;
$fn$;

create or replace function public.get_ai_quota()
returns jsonb
language sql security invoker
set search_path = public, pg_temp
as $fn$
  select jsonb_build_object(
    'limit', (select ai_per_day from app_private.plan_of(auth.uid())),
    'used',  coalesce((select calls from public.ai_usage
                       where user_id = auth.uid()
                         and day = (now() at time zone 'Asia/Bangkok')::date), 0));
$fn$;

-- ---------- grants: new functions are EXECUTE-able by PUBLIC by default ----------
revoke all on function
  public.get_placement_items(int), public.save_level_check(text, int, int), public.get_level_checks(),
  public.review_grammar(text, int, int), public.get_grammar_progress(),
  public.get_leech_queue(int, int), public.queue_word(uuid),
  public.consume_ai_quota(uuid), public.get_ai_quota()
from public, anon;

grant execute on function
  public.get_placement_items(int), public.save_level_check(text, int, int), public.get_level_checks(),
  public.review_grammar(text, int, int), public.get_grammar_progress(),
  public.get_leech_queue(int, int), public.queue_word(uuid), public.get_ai_quota()
to authenticated;

grant execute on function public.consume_ai_quota(uuid) to service_role;
