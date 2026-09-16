-- ============================================================
-- Enforce the plan in the database, not in the browser. Hiding a button is a
-- hint; this is the gate.
-- ============================================================

drop function if exists public.get_study_queue(int, text[], text[]);
create function public.get_study_queue(
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
  plan as (select * from public.plan_of((select uid from me))),
  prefs as (
    select coalesce((select new_per_day from public.profiles where id = (select uid from me)), 20) as want,
           coalesce((select timezone    from public.profiles where id = (select uid from me)), 'Asia/Bangkok') as tz
  ),
  cap as (
    select least((select want from prefs),
                 coalesce((select new_per_day_cap from plan), 2147483647)) as n
  ),
  -- the caller's level filter, narrowed to what the plan allows
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

-- ---------- quiz and typing are Pro modes ----------
create or replace function public.review_card(
  p_word_id uuid, p_grade int, p_mode text default 'flip'
)
returns public.card_states
language plpgsql security invoker
set search_path = public, pg_temp
as $fn$
declare
  v_uid uuid := auth.uid();
  v_cur public.card_states;
  v_next record;
  v_row public.card_states;
  v_modes text[];
begin
  if v_uid is null then raise exception 'not authenticated' using errcode = '28000'; end if;
  if p_grade < 0 or p_grade > 5 then raise exception 'grade must be between 0 and 5'; end if;

  select modes into v_modes from public.plan_of(v_uid);
  if not (p_mode = any (v_modes)) then
    raise exception 'โหมดนี้ใช้ได้เฉพาะสมาชิก Pro' using errcode = '42501';
  end if;

  select * into v_cur from public.card_states where user_id = v_uid and word_id = p_word_id;

  select * into v_next from public.sm2_next(
    coalesce(v_cur.repetitions, 0), coalesce(v_cur.interval_days, 0),
    coalesce(v_cur.ease_factor, 2.50), p_grade);

  insert into public.card_states as cs (
    user_id, word_id, status, repetitions, interval_days, ease_factor,
    lapses, due_at, last_grade, last_reviewed_at, updated_at)
  values (
    v_uid, p_word_id,
    case when v_next.interval_days >= 21 then 'mastered'
         when v_next.repetitions  >  0   then 'review'
         else 'learning' end,
    v_next.repetitions, v_next.interval_days, v_next.ease_factor,
    case when p_grade < 3 then 1 else 0 end,
    now() + make_interval(days => v_next.interval_days),
    p_grade, now(), now())
  on conflict (user_id, word_id) do update set
    status = case when excluded.interval_days >= 21 then 'mastered'
                  when excluded.repetitions   >  0  then 'review'
                  else 'learning' end,
    repetitions      = excluded.repetitions,
    interval_days    = excluded.interval_days,
    ease_factor      = excluded.ease_factor,
    lapses           = cs.lapses + case when p_grade < 3 then 1 else 0 end,
    due_at           = excluded.due_at,
    last_grade       = excluded.last_grade,
    last_reviewed_at = excluded.last_reviewed_at,
    updated_at       = now()
  returning * into v_row;

  insert into public.reviews (user_id, word_id, grade, mode,
                              prev_interval, new_interval,
                              prev_repetitions, prev_ef, prev_status, prev_due_at)
  values (v_uid, p_word_id, p_grade, p_mode,
          coalesce(v_cur.interval_days, 0), v_next.interval_days,
          v_cur.repetitions, v_cur.ease_factor, v_cur.status, v_cur.due_at);

  return v_row;
end;
$fn$;

-- distractors are pointless without the quiz mode
create or replace function public.get_quiz_options(p_word_id uuid)
returns table (id uuid, word text, translation text)
language sql security invoker
set search_path = public, pg_temp
as $fn$
  with plan as (select * from public.plan_of(auth.uid())),
       target as (select level, translation from public.words where id = p_word_id)
  select w.id, w.word, w.translation
  from public.words w, target t, plan p
  where 'quiz' = any (p.modes)
    and w.id <> p_word_id
    and w.translation is not null and w.translation <> ''
    and w.translation <> t.translation
    and btrim(split_part(w.translation, '/', 1)) <> btrim(split_part(t.translation, '/', 1))
    and w.level is not distinct from t.level
  order by random()
  limit 3;
$fn$;

-- ---------- stats: heatmap, forecast and streak are Pro ----------
create or replace function public.get_stats()
returns jsonb
language sql security invoker
set search_path = public, pg_temp
as $fn$
  with me as (select auth.uid() as uid),
  plan as (select * from public.plan_of((select uid from me))),
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
  -- Free only counts the part of the catalogue it may actually study
  total_words as (
    select count(*)::int as n from public.words w cross join plan p
    where p.levels is null or w.level = any (p.levels)
  ),
  effective_cap as (
    select least(coalesce((select new_per_day from public.profiles where id = (select uid from me)), 20),
                 coalesce((select new_per_day_cap from plan), 2147483647)) as n
  )
  select jsonb_build_object(
    'plan',        (select plan from plan),
    'is_pro',      public.is_pro((select uid from me)),
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
    'streak',      case when (select full_stats from plan)
                        then coalesce((select len from streak), 0) else null end,
    'heatmap',     case when (select full_stats from plan)
                        then coalesce((select jsonb_object_agg(d::text, n) from days), '{}'::jsonb)
                        else null end,
    'forecast',    case when (select full_stats from plan)
                        then coalesce((select j from forecast), '{}'::jsonb) else null end
  );
$fn$;

grant execute on function
  public.get_study_queue(int, text[], text[]),
  public.get_quiz_options(uuid),
  public.review_card(uuid, int, text),
  public.get_stats()
to authenticated;;
