-- ============================================================
-- Quiz distractors that are actually wrong, a cap on new cards per day,
-- undo for the last answer, and a seven-day forecast.
-- ============================================================

alter table public.profiles add column if not exists new_per_day int not null default 20
  check (new_per_day between 0 and 200);

-- Undo needs the state a card was in *before* a review, so record it.
alter table public.reviews add column if not exists prev_repetitions int;
alter table public.reviews add column if not exists prev_ef numeric(4,2);
alter table public.reviews add column if not exists prev_status text;
alter table public.reviews add column if not exists prev_due_at timestamptz;

-- ---------- distractors must not mean the same thing ----------
-- 834 head words share a Thai gloss with another word (ปิด covers close,
-- closed, off and shut), so three random same-level rows could put two correct
-- answers on screen and mark the right one wrong.
drop function if exists public.get_quiz_options(uuid);
create function public.get_quiz_options(p_word_id uuid)
returns table (id uuid, word text, translation text)
language sql security invoker
set search_path = public, pg_temp
as $fn$
  with target as (select level, translation from public.words where id = p_word_id)
  select w.id, w.word, w.translation
  from public.words w, target t
  where w.id <> p_word_id
    and w.translation is not null and w.translation <> ''
    and w.translation <> t.translation
    -- also reject a different gloss whose first sense is the same one
    and btrim(split_part(w.translation, '/', 1)) <> btrim(split_part(t.translation, '/', 1))
    and w.level is not distinct from t.level
  order by random()
  limit 3;
$fn$;

-- ---------- review_card now stores the pre-review state ----------
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
begin
  if v_uid is null then raise exception 'not authenticated' using errcode = '28000'; end if;
  if p_grade < 0 or p_grade > 5 then raise exception 'grade must be between 0 and 5'; end if;

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

-- ---------- undo the last answer ----------
-- A misclick used to be permanent. Roll the card back to the state recorded on
-- the review row and delete that row, so the stats and the streak follow.
create or replace function public.undo_last_review()
returns jsonb
language plpgsql security invoker
set search_path = public, pg_temp
as $fn$
declare
  v_uid uuid := auth.uid();
  v_rev public.reviews;
  v_word text;
begin
  if v_uid is null then raise exception 'not authenticated' using errcode = '28000'; end if;

  select * into v_rev from public.reviews
   where user_id = v_uid order by reviewed_at desc, id desc limit 1;

  if v_rev.id is null then
    return jsonb_build_object('ok', false, 'error', 'ไม่มีคำตอบให้ย้อนกลับ');
  end if;
  if v_rev.reviewed_at < now() - interval '1 day' then
    return jsonb_build_object('ok', false, 'error', 'ย้อนได้เฉพาะคำตอบภายใน 24 ชั่วโมง');
  end if;

  select word into v_word from public.words where id = v_rev.word_id;

  if v_rev.prev_status is null then
    -- the card did not exist before this review, so remove it entirely
    delete from public.card_states where user_id = v_uid and word_id = v_rev.word_id;
  else
    update public.card_states set
      status        = v_rev.prev_status,
      repetitions   = coalesce(v_rev.prev_repetitions, 0),
      interval_days = coalesce(v_rev.prev_interval, 0),
      ease_factor   = coalesce(v_rev.prev_ef, 2.50),
      due_at        = v_rev.prev_due_at,
      lapses        = greatest(0, lapses - case when v_rev.grade < 3 then 1 else 0 end),
      updated_at    = now()
    where user_id = v_uid and word_id = v_rev.word_id;
  end if;

  delete from public.reviews where id = v_rev.id;

  return jsonb_build_object('ok', true, 'word', v_word, 'word_id', v_rev.word_id);
end;
$fn$;

-- ---------- study queue: cap brand-new words per day ----------
-- Without a cap a first session hands out 40 unseen words, all of which come
-- back tomorrow on top of 40 more. The pile grows until the app is abandoned.
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
  prefs as (
    select coalesce((select new_per_day from public.profiles where id = (select uid from me)), 20) as cap,
           coalesce((select timezone   from public.profiles where id = (select uid from me)), 'Asia/Bangkok') as tz
  ),
  introduced_today as (
    select count(*)::int as n
    from public.card_states cs
    where cs.user_id = (select uid from me)
      and (cs.created_at at time zone (select tz from prefs))::date
          = (now() at time zone (select tz from prefs))::date
  ),
  filtered as (
    select w.* from public.words w
    where (p_levels is null or w.level = any(p_levels))
      and (p_pos    is null or w.pos   = any(p_pos))
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
      (select cap from prefs) - (select n from introduced_today)))
  )
  select * from (select * from due union all select * from fresh) q
  order by random() limit p_limit;
$fn$;

-- ---------- stats gain a forecast and the new-card budget ----------
create or replace function public.get_stats()
returns jsonb
language sql security invoker
set search_path = public, pg_temp
as $fn$
  with me as (select auth.uid() as uid),
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
        and due_at is not null
        and due_at < (now() + interval '8 days')
      group by 1
    ) f
  ),
  by_level as (
    select jsonb_object_agg(coalesce(lv, '?'), cnt) as j from (
      select w.level as lv, count(*) as cnt
      from public.card_states cs join public.words w on w.id = cs.word_id
      where cs.user_id = (select uid from me)
        and cs.status in ('mastered','review','learning','suspended')
      group by w.level) t
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
    'new_today',   coalesce((select new_today from totals), 0),
    'daily_goal',  coalesce((select daily_goal  from public.profiles where id = (select uid from me)), 20),
    'new_per_day', coalesce((select new_per_day from public.profiles where id = (select uid from me)), 20),
    'streak',      coalesce((select len from streak), 0),
    'heatmap',     coalesce((select jsonb_object_agg(d::text, n) from days), '{}'::jsonb),
    'forecast',    coalesce((select j from forecast), '{}'::jsonb),
    'by_level',    coalesce((select j from by_level), '{}'::jsonb)
  );
$fn$;

-- ---------- search returns the example too ----------
drop function if exists public.search_words(text, text[], int, int);
create function public.search_words(
  p_query text default null, p_levels text[] default null,
  p_limit int default 100, p_offset int default 0
)
returns table (id uuid, word text, pos text, level text, translation text,
               pronunciation text, example_en text, example_th text,
               status text, due_at timestamptz)
language sql security invoker
set search_path = public, pg_temp
as $fn$
  select w.id, w.word, w.pos, w.level, w.translation, w.pronunciation,
         w.example_en, w.example_th,
         coalesce(cs.status, 'new') as status, cs.due_at
  from public.words w
  left join public.card_states cs on cs.word_id = w.id and cs.user_id = auth.uid()
  where (p_levels is null or w.level = any(p_levels))
    and (p_query is null or p_query = ''
         or w.word ilike '%' || p_query || '%'
         or coalesce(w.translation, '') ilike '%' || p_query || '%')
  order by (w.word ilike p_query || '%') desc nulls last, w.word
  limit least(p_limit, 200) offset p_offset;
$fn$;

grant execute on function
  public.get_quiz_options(uuid),
  public.get_study_queue(int, text[], text[]),
  public.search_words(text, text[], int, int),
  public.undo_last_review()
to authenticated;
