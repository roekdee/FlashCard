-- ============================================================
-- SM-2 scheduling, study queue and stats — all server side.
-- Everything a screen needs is one round trip.
-- ============================================================

-- ---------- pure SM-2 step ----------
-- Next (repetitions, interval_days, ease_factor) for a grade 0..5.
create or replace function public.sm2_next(
  p_repetitions int,
  p_interval    int,
  p_ef          numeric,
  p_grade       int
)
returns table (repetitions int, interval_days int, ease_factor numeric)
language plpgsql
immutable
as $fn$
declare
  v_ef numeric;
begin
  -- SuperMemo-2 ease update, clamped at the classic 1.3 floor
  v_ef := greatest(1.30, p_ef + (0.1 - (5 - p_grade) * (0.08 + (5 - p_grade) * 0.02)));

  if p_grade < 3 then
    -- lapse: relearn tomorrow, keep the (reduced) ease
    return query select 0, 1, v_ef;
  elsif p_repetitions <= 0 then
    return query select 1, 1, v_ef;
  elsif p_repetitions = 1 then
    return query select 2, 6, v_ef;
  else
    return query select
      p_repetitions + 1,
      greatest(1, round(p_interval * v_ef))::int,
      v_ef;
  end if;
end;
$fn$;

-- ---------- record one review ----------
create or replace function public.review_card(
  p_word_id uuid,
  p_grade   int,
  p_mode    text default 'flip'
)
returns public.card_states
language plpgsql
security invoker
set search_path = public, pg_temp
as $fn$
declare
  v_uid  uuid := auth.uid();
  v_cur  public.card_states;
  v_next record;
  v_prev int;
  v_row  public.card_states;
begin
  if v_uid is null then
    raise exception 'not authenticated' using errcode = '28000';
  end if;
  if p_grade < 0 or p_grade > 5 then
    raise exception 'grade must be between 0 and 5';
  end if;

  select * into v_cur from public.card_states
   where user_id = v_uid and word_id = p_word_id;

  v_prev := coalesce(v_cur.interval_days, 0);

  select * into v_next from public.sm2_next(
    coalesce(v_cur.repetitions, 0),
    v_prev,
    coalesce(v_cur.ease_factor, 2.50),
    p_grade
  );

  insert into public.card_states as cs (
    user_id, word_id, status, repetitions, interval_days, ease_factor,
    lapses, due_at, last_grade, last_reviewed_at, updated_at
  )
  values (
    v_uid, p_word_id,
    case
      when v_next.interval_days >= 21 then 'mastered'
      when v_next.repetitions  >  0   then 'review'
      else 'learning'
    end,
    v_next.repetitions, v_next.interval_days, v_next.ease_factor,
    case when p_grade < 3 then 1 else 0 end,
    now() + make_interval(days => v_next.interval_days),
    p_grade, now(), now()
  )
  on conflict (user_id, word_id) do update set
    status = case
      when excluded.interval_days >= 21 then 'mastered'
      when excluded.repetitions   >  0  then 'review'
      else 'learning'
    end,
    repetitions      = excluded.repetitions,
    interval_days    = excluded.interval_days,
    ease_factor      = excluded.ease_factor,
    lapses           = cs.lapses + case when p_grade < 3 then 1 else 0 end,
    due_at           = excluded.due_at,
    last_grade       = excluded.last_grade,
    last_reviewed_at = excluded.last_reviewed_at,
    updated_at       = now()
  returning * into v_row;

  insert into public.reviews (user_id, word_id, grade, mode, prev_interval, new_interval)
  values (v_uid, p_word_id, p_grade, p_mode, v_prev, v_next.interval_days);

  return v_row;
end;
$fn$;

-- ---------- suspend / unsuspend ("จำได้แล้ว" / "ยกเลิกการจำ") ----------
create or replace function public.set_card_suspended(
  p_word_id   uuid,
  p_suspended boolean
)
returns public.card_states
language plpgsql
security invoker
set search_path = public, pg_temp
as $fn$
declare
  v_uid uuid := auth.uid();
  v_row public.card_states;
begin
  if v_uid is null then
    raise exception 'not authenticated' using errcode = '28000';
  end if;

  if p_suspended then
    insert into public.card_states as cs (user_id, word_id, status, due_at, updated_at)
    values (v_uid, p_word_id, 'suspended', null, now())
    on conflict (user_id, word_id) do update
      set status = 'suspended', due_at = null, updated_at = now()
    returning * into v_row;
  else
    -- back into rotation, due now, SM-2 history preserved
    update public.card_states set
      status = case
                 when interval_days >= 21 then 'mastered'
                 when repetitions   >  0  then 'review'
                 else 'learning'
               end,
      due_at     = now(),
      updated_at = now()
    where user_id = v_uid and word_id = p_word_id
    returning * into v_row;
  end if;

  return v_row;
end;
$fn$;

-- ---------- the study queue ----------
-- Due cards first (most overdue), topped up with unseen words.
create or replace function public.get_study_queue(
  p_limit  int    default 40,
  p_levels text[] default null,
  p_pos    text[] default null
)
-- returns due cards first, topped up with unseen words
returns table (
  id uuid, word text, pos text, level text,
  translation text, pronunciation text,
  status text, repetitions int, interval_days int,
  ease_factor numeric, due_at timestamptz, is_new boolean
)
language sql
security invoker
set search_path = public, pg_temp
as $fn$
  with me as (select auth.uid() as uid),
  filtered as (
    select w.* from public.words w
    where (p_levels is null or w.level = any(p_levels))
      and (p_pos    is null or w.pos   = any(p_pos))
  ),
  due as (
    select f.id, f.word, f.pos, f.level, f.translation, f.pronunciation,
           cs.status, cs.repetitions, cs.interval_days, cs.ease_factor, cs.due_at,
           false as is_new
    from filtered f
    join public.card_states cs
      on cs.word_id = f.id and cs.user_id = (select uid from me)
    where cs.status <> 'suspended'
      and cs.due_at is not null
      and cs.due_at <= now()
    order by cs.due_at asc
    limit p_limit
  ),
  fresh as (
    select f.id, f.word, f.pos, f.level, f.translation, f.pronunciation,
           'new'::text, 0, 0, 2.50::numeric, null::timestamptz,
           true as is_new
    from filtered f
    where not exists (
      select 1 from public.card_states cs
      where cs.word_id = f.id and cs.user_id = (select uid from me)
    )
    order by random()
    limit greatest(0, p_limit - (select count(*) from due))
  )
  select * from (select * from due union all select * from fresh) q
  order by random()
  limit p_limit;
$fn$;

-- ---------- suspended list ("คำที่จำได้แล้ว") ----------
create or replace function public.get_suspended_words(
  p_search text default null,
  p_limit  int  default 500
)
returns table (id uuid, word text, pos text, level text, translation text)
language sql
security invoker
set search_path = public, pg_temp
as $fn$
  select w.id, w.word, w.pos, w.level, w.translation
  from public.card_states cs
  join public.words w on w.id = cs.word_id
  where cs.user_id = auth.uid()
    and cs.status = 'suspended'
    and (p_search is null or p_search = ''
         or w.word ilike '%' || p_search || '%'
         or coalesce(w.translation, '') ilike '%' || p_search || '%')
  order by w.word
  limit p_limit;
$fn$;

-- ---------- quiz distractors: 3 wrong meanings, same CEFR level ----------
create or replace function public.get_quiz_options(p_word_id uuid)
returns table (id uuid, word text, translation text)
language sql
security invoker
set search_path = public, pg_temp
as $fn$
  select w.id, w.word, w.translation
  from public.words w
  where w.id <> p_word_id
    and w.translation is not null and w.translation <> ''
    and w.level is not distinct from (select level from public.words where id = p_word_id)
  order by random()
  limit 3;
$fn$;

-- ---------- part-of-speech filter options ----------
create or replace function public.get_pos_list()
returns table (pos text, n int)
language sql stable security invoker
set search_path = public, pg_temp
as $fn$
  select w.pos, count(*)::int as n
  from public.words w
  where w.pos is not null and w.pos <> ''
  group by w.pos
  having count(*) >= 5
  order by count(*) desc;
$fn$;

-- ---------- dashboard stats: counts, streak, heatmap, level breakdown ----------
create or replace function public.get_stats()
returns jsonb
language sql
security invoker
set search_path = public, pg_temp
as $fn$
  with me as (select auth.uid() as uid),
  tz as (
    select coalesce(
      (select timezone from public.profiles where id = (select uid from me)),
      'Asia/Bangkok'
    ) as z
  ),
  today as (select (now() at time zone (select z from tz))::date as d),
  totals as (
    select
      count(*) filter (where status = 'suspended') as suspended,
      count(*) filter (where status = 'mastered')  as mastered,
      count(*) filter (where status = 'review')    as in_review,
      count(*) filter (where status = 'learning')  as learning,
      count(*) filter (where status in ('learning','review','mastered')
                         and due_at <= now())      as due_now
    from public.card_states where user_id = (select uid from me)
  ),
  days as (
    select (reviewed_at at time zone (select z from tz))::date as d, count(*) as n
    from public.reviews
    where user_id = (select uid from me)
      and reviewed_at > now() - interval '400 days'
    group by 1
  ),
  -- streak anchors on today, or yesterday so an unstarted today doesn't zero it
  anchor as (
    select case when exists (select 1 from days where d = (select d from today))
                then (select d from today)
                else (select d from today) - 1 end as a
  ),
  streak as (
    -- gaps-and-islands: consecutive days share (date + row_number)
    select count(*)::int as len
    from (
      select d, d + (row_number() over (order by d desc))::int as grp
      from days where d <= (select a from anchor)
    ) s
    where grp = (select a from anchor) + 1
  ),
  by_level as (
    select jsonb_object_agg(coalesce(lv, '?'), cnt) as j from (
      select w.level as lv, count(*) as cnt
      from public.card_states cs join public.words w on w.id = cs.word_id
      where cs.user_id = (select uid from me)
        and cs.status in ('mastered','review','learning','suspended')
      group by w.level
    ) t
  ),
  total_words as (select count(*)::int as n from public.words)
  select jsonb_build_object(
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
    'daily_goal',  coalesce((select daily_goal from public.profiles where id = (select uid from me)), 20),
    'streak',      coalesce((select len from streak), 0),
    'heatmap',     coalesce((select jsonb_object_agg(d::text, n) from days), '{}'::jsonb),
    'by_level',    coalesce((select j from by_level), '{}'::jsonb)
  );
$fn$;

-- ---------- browse / search the whole catalogue ----------
create or replace function public.search_words(
  p_query  text   default null,
  p_levels text[] default null,
  p_limit  int    default 100,
  p_offset int    default 0
)
returns table (
  id uuid, word text, pos text, level text, translation text,
  pronunciation text, status text, due_at timestamptz
)
language sql
security invoker
set search_path = public, pg_temp
as $fn$
  select w.id, w.word, w.pos, w.level, w.translation, w.pronunciation,
         coalesce(cs.status, 'new') as status, cs.due_at
  from public.words w
  left join public.card_states cs
    on cs.word_id = w.id and cs.user_id = auth.uid()
  where (p_levels is null or w.level = any(p_levels))
    and (p_query is null or p_query = ''
         or w.word ilike '%' || p_query || '%'
         or coalesce(w.translation, '') ilike '%' || p_query || '%')
  order by (w.word ilike p_query || '%') desc nulls last, w.word
  limit least(p_limit, 200) offset p_offset;
$fn$;

grant execute on function
  public.review_card(uuid, int, text),
  public.set_card_suspended(uuid, boolean),
  public.get_study_queue(int, text[], text[]),
  public.get_suspended_words(text, int),
  public.get_quiz_options(uuid),
  public.get_pos_list(),
  public.get_stats(),
  public.search_words(text, text[], int, int)
to authenticated;
