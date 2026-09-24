-- ============================================================
-- Pro gets no daily ceiling on new words, a fourth study mode
-- (speak), and stats report per-level totals so the client stops
-- hard-coding them now that the catalogue covers A1-C2.
--
-- Before this, Pro was still capped by profiles.new_per_day (default
-- 20): once those were opened the queue only replayed due cards, which
-- felt like the deck looping. When the plan has no cap, the personal
-- preference no longer applies either.
-- ============================================================

alter table public.reviews drop constraint if exists reviews_mode_check;
alter table public.reviews add constraint reviews_mode_check
  check (mode in ('flip','quiz','typing','speak'));

update public.plan_limits set modes = array['flip','quiz','typing','speak'] where plan = 'pro';

create or replace function public.get_study_queue(
  p_limit int default 40, p_levels text[] default null, p_pos text[] default null
)
returns table (
  id uuid, word text, pos text, level text, translation text, pronunciation text,
  example_en text, example_th text,
  status text, repetitions int, interval_days int, ease_factor numeric,
  due_at timestamptz, is_new boolean)
language sql security invoker
set search_path = public, pg_temp
as $fn$
  with me as (select auth.uid() as uid),
  plan as (select * from app_private.plan_of((select uid from me))),
  prefs as (
    select coalesce((select new_per_day from public.profiles where id = (select uid from me)), 20) as want,
           coalesce((select timezone    from public.profiles where id = (select uid from me)), 'Asia/Bangkok') as tz
  ),
  cap as (
    select case when (select new_per_day_cap from plan) is null then 2147483647
                else least((select want from prefs), (select new_per_day_cap from plan)) end as n
  ),
  levels as (
    select case
             when (select levels from plan) is null then p_levels
             when p_levels is null then (select levels from plan)
             else array(select unnest(p_levels) intersect select unnest((select levels from plan)))
           end as allowed
  ),
  introduced_today as (
    select count(*)::int as n
    from public.card_states cs
    where cs.user_id = (select uid from me)
      and (cs.created_at at time zone (select tz from prefs))::date
          = (now() at time zone (select tz from prefs))::date
  ),
  filtered as (
    select w.* from public.words w cross join levels l
    where (l.allowed is null or w.level = any (l.allowed))
      and (p_pos is null or w.pos = any (p_pos))
  ),
  due as (
    select f.id, f.word, f.pos, f.level, f.translation, f.pronunciation,
           f.example_en, f.example_th,
           cs.status, cs.repetitions, cs.interval_days, cs.ease_factor, cs.due_at, false as is_new
    from filtered f
    join public.card_states cs on cs.word_id = f.id and cs.user_id = (select uid from me)
    where cs.status <> 'suspended' and cs.due_at is not null and cs.due_at <= now()
    order by cs.due_at asc
    limit p_limit
  ),
  fresh as (
    select f.id, f.word, f.pos, f.level, f.translation, f.pronunciation,
           f.example_en, f.example_th,
           'new'::text, 0, 0, 2.50::numeric, null::timestamptz, true as is_new
    from filtered f
    where not exists (
      select 1 from public.card_states cs
      where cs.word_id = f.id and cs.user_id = (select uid from me))
    order by random()
    limit greatest(0, least(
      p_limit - (select count(*) from due),
      (select n from cap) - (select n from introduced_today)))
  )
  select * from (select * from due union all select * from fresh) q
  order by random() limit p_limit;
$fn$;

create or replace function public.get_stats()
returns jsonb
language sql security invoker
set search_path = public, pg_temp
as $fn$
  with me as (select auth.uid() as uid),
  plan as (select * from app_private.plan_of((select uid from me))),
  tz as (select coalesce((select timezone from public.profiles where id = (select uid from me)),
                         'Asia/Bangkok') as z),
  today as (select (now() at time zone (select z from tz))::date as d),
  totals as (
    select count(*) filter (where status = 'suspended') as suspended,
           count(*) filter (where status = 'mastered')  as mastered,
           count(*) filter (where status = 'review')    as in_review,
           count(*) filter (where status = 'learning')  as learning,
           count(*) filter (where status in ('learning','review','mastered')
                              and due_at <= now())      as due_now,
           count(*) filter (where (created_at at time zone (select z from tz))::date
                                  = (select d from today)) as new_today
    from public.card_states where user_id = (select uid from me)
  ),
  days as (
    select (reviewed_at at time zone (select z from tz))::date as d, count(*) as n
    from public.reviews
    where user_id = (select uid from me) and reviewed_at > now() - interval '400 days'
    group by 1
  ),
  anchor as (
    select case when exists (select 1 from days where d = (select d from today))
                then (select d from today) else (select d from today) - 1 end as a
  ),
  streak as (
    select count(*)::int as len from (
      select d, d + (row_number() over (order by d desc))::int as grp
      from days where d <= (select a from anchor)
    ) s where grp = (select a from anchor) + 1
  ),
  forecast as (
    select jsonb_object_agg(day::text, n) as j from (
      select (due_at at time zone (select z from tz))::date as day, count(*) as n
      from public.card_states
      where user_id = (select uid from me)
        and status in ('learning','review','mastered')
        and due_at is not null and due_at < (now() + interval '8 days')
      group by 1) f
  ),
  by_level as (
    select jsonb_object_agg(coalesce(lv, '?'), cnt) as j from (
      select w.level as lv, count(*) as cnt
      from public.card_states cs join public.words w on w.id = cs.word_id
      where cs.user_id = (select uid from me)
        and cs.status in ('mastered','review','learning','suspended')
      group by w.level) t
  ),
  total_words as (
    select count(*)::int as n from public.words w cross join plan p
    where p.levels is null or w.level = any (p.levels)
  ),
  effective_cap as (
    select case when (select new_per_day_cap from plan) is null then null
                else least(coalesce((select new_per_day from public.profiles where id = (select uid from me)), 20),
                           (select new_per_day_cap from plan)) end as n
  ),
  level_totals as (
    select jsonb_object_agg(level, n) as j
    from (select level, count(*)::int as n from public.words where level is not null group by level) t
  )
  select jsonb_build_object(
    'plan',        (select plan from plan),
    'is_pro',      app_private.is_pro((select uid from me)),
    'pro_until',   (select pro_until from public.profiles where id = (select uid from me)),
    'modes',       to_jsonb((select modes  from plan)),
    'levels',      to_jsonb((select levels from plan)),
    'total_words', (select n from total_words),
    'suspended',   coalesce((select suspended from totals), 0),
    'mastered',    coalesce((select mastered  from totals), 0),
    'in_review',   coalesce((select in_review from totals), 0),
    'learning',    coalesce((select learning  from totals), 0),
    'due_now',     coalesce((select due_now   from totals), 0),
    'remaining',   (select n from total_words)
                     - coalesce((select suspended from totals), 0)
                     - coalesce((select mastered  from totals), 0),
    'today',       coalesce((select n from days where d = (select d from today)), 0),
    'new_today',   coalesce((select new_today from totals), 0),
    'daily_goal',  coalesce((select daily_goal from public.profiles where id = (select uid from me)), 20),
    'new_per_day', (select n from effective_cap),
    'new_per_day_wanted',
                   coalesce((select new_per_day from public.profiles where id = (select uid from me)), 20),
    'by_level',    coalesce((select j from by_level), '{}'::jsonb),
    'level_totals', coalesce((select j from level_totals), '{}'::jsonb),
    'streak',      case when (select full_stats from plan)
                        then coalesce((select len from streak), 0) else null end,
    'heatmap',     case when (select full_stats from plan)
                        then coalesce((select jsonb_object_agg(d::text, n) from days), '{}'::jsonb)
                        else null end,
    'forecast',    case when (select full_stats from plan)
                        then coalesce((select j from forecast), '{}'::jsonb) else null end
  );
$fn$;
