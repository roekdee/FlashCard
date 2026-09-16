-- ============================================================
-- Leaderboard and badges (Pro).
-- Only a self-chosen username and a number are ever shown, and only for
-- people who left show_on_leaderboard on.
-- ============================================================

create table if not exists public.badges (
  code      text primary key,
  name_th   text not null,
  detail_th text not null,
  icon      text not null,
  metric    text not null check (metric in ('streak','mastered','reviews_total','suspended','days_studied')),
  threshold int  not null,
  sort      int  not null default 0
);

insert into public.badges (code, name_th, detail_th, icon, metric, threshold, sort) values
  ('streak_3',      'สามวันติด',     'ทบทวนต่อเนื่อง 3 วัน',        '🔥', 'streak',        3,   10),
  ('streak_7',      'หนึ่งสัปดาห์',   'ทบทวนต่อเนื่อง 7 วัน',        '🔥', 'streak',        7,   11),
  ('streak_30',     'หนึ่งเดือนเต็ม', 'ทบทวนต่อเนื่อง 30 วัน',       '🏅', 'streak',        30,  12),
  ('streak_100',    'ร้อยวัน',        'ทบทวนต่อเนื่อง 100 วัน',      '👑', 'streak',        100, 13),
  ('mastered_50',   'เริ่มแม่น',      'จำแม่น 50 คำ',                '🌱', 'mastered',      50,  20),
  ('mastered_250',  'คลังศัพท์แน่น',  'จำแม่น 250 คำ',               '🌳', 'mastered',      250, 21),
  ('mastered_1000', 'พันคำ',          'จำแม่น 1,000 คำ',             '🏆', 'mastered',      1000,22),
  ('reviews_100',   'ขยันทบทวน',      'ทบทวนครบ 100 ครั้ง',          '📖', 'reviews_total', 100, 30),
  ('reviews_1000',  'นักอ่านตัวยง',   'ทบทวนครบ 1,000 ครั้ง',        '📚', 'reviews_total', 1000,31),
  ('days_30',       'สามสิบวัน',      'เข้ามาเรียนรวม 30 วัน',       '📅', 'days_studied',  30,  40),
  ('suspended_100', 'เก็บครบร้อย',    'กด "จำได้แล้ว" ครบ 100 คำ',   '🎯', 'suspended',     100, 50)
on conflict (code) do update set
  name_th = excluded.name_th, detail_th = excluded.detail_th,
  icon = excluded.icon, metric = excluded.metric,
  threshold = excluded.threshold, sort = excluded.sort;

alter table public.badges enable row level security;
drop policy if exists badges_read on public.badges;
create policy badges_read on public.badges
  for select to anon, authenticated using (true);

-- ---------- one user's metrics, reused by badges and the leaderboard ----------
create or replace function public.user_metrics(p_user uuid)
returns table (streak int, mastered int, reviews_total int, suspended int,
               days_studied int, reviews_week int)
language sql stable security definer
set search_path = public, pg_temp
as $fn$
  with tz as (select coalesce((select timezone from public.profiles where id = p_user),
                              'Asia/Bangkok') as z),
  today as (select (now() at time zone (select z from tz))::date as d),
  days as (
    select (reviewed_at at time zone (select z from tz))::date as d, count(*) as n
    from public.reviews where user_id = p_user
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
  cards as (
    select count(*) filter (where status = 'mastered')::int  as mastered,
           count(*) filter (where status = 'suspended')::int as suspended
    from public.card_states where user_id = p_user
  )
  select coalesce((select len from streak), 0),
         coalesce((select mastered from cards), 0),
         (select count(*)::int from public.reviews where user_id = p_user),
         coalesce((select suspended from cards), 0),
         (select count(*)::int from days),
         (select coalesce(sum(n), 0)::int from days where d > (select d from today) - 7);
$fn$;

-- ---------- badges ----------
create or replace function public.get_my_badges()
returns jsonb
language sql stable security invoker
set search_path = public, pg_temp
as $fn$
  with m as (select * from public.user_metrics(auth.uid()))
  select coalesce(jsonb_agg(jsonb_build_object(
    'code', b.code, 'name', b.name_th, 'detail', b.detail_th, 'icon', b.icon,
    'threshold', b.threshold,
    'value', v.value,
    'earned', v.value >= b.threshold,
    'progress', least(1.0, round(v.value::numeric / b.threshold, 3))
  ) order by b.sort), '[]'::jsonb)
  from public.badges b
  cross join m
  cross join lateral (select case b.metric
      when 'streak'        then m.streak
      when 'mastered'      then m.mastered
      when 'reviews_total' then m.reviews_total
      when 'suspended'     then m.suspended
      when 'days_studied'  then m.days_studied
    end as value) v;
$fn$;

-- ---------- leaderboard ----------
create or replace function public.get_leaderboard(p_metric text default 'week', p_limit int default 20)
returns jsonb
language plpgsql stable security definer
set search_path = public, pg_temp
as $fn$
declare
  v_uid uuid := auth.uid();
  v_result jsonb;
begin
  if v_uid is null then raise exception 'not authenticated' using errcode = '28000'; end if;
  if not public.is_pro(v_uid) then
    raise exception 'กระดานจัดอันดับใช้ได้เฉพาะสมาชิก Pro' using errcode = '42501';
  end if;
  if p_metric not in ('week', 'streak', 'mastered') then
    raise exception 'unknown metric';
  end if;

  with scored as (
    select p.id,
           p.username,
           case p_metric
             when 'week'     then m.reviews_week
             when 'streak'   then m.streak
             when 'mastered' then m.mastered
           end as value
    from public.profiles p
    cross join lateral public.user_metrics(p.id) m
    where p.show_on_leaderboard
  ),
  ranked as (
    select id, username, value,
           rank() over (order by value desc, username) as rank
    from scored where value > 0
  )
  select jsonb_build_object(
    'metric', p_metric,
    'top', coalesce((
      select jsonb_agg(jsonb_build_object(
        'rank', rank, 'username', username, 'value', value, 'is_me', id = v_uid)
        order by rank)
      from (select * from ranked order by rank limit p_limit) t), '[]'::jsonb),
    'me', (select jsonb_build_object('rank', rank, 'value', value)
           from ranked where id = v_uid),
    'listed', (select show_on_leaderboard from public.profiles where id = v_uid)
  ) into v_result;

  return v_result;
end;
$fn$;

grant execute on function public.get_my_badges(), public.get_leaderboard(text, int) to authenticated;
grant execute on function public.user_metrics(uuid) to authenticated;;
