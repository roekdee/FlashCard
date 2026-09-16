-- ============================================================
-- Oxford 3000 Flashcards — core schema.
-- Replaces the Google Sheets / Apps Script backend.
-- ============================================================

create extension if not exists pg_trgm with schema extensions;

-- ---------- words: the shared vocabulary catalogue ----------
create table if not exists public.words (
  id            uuid primary key default gen_random_uuid(),
  word          text not null,
  pos           text,
  level         text check (level in ('A1','A2','B1','B2','C1','C2')),
  translation   text,
  pronunciation text,
  created_at    timestamptz not null default now()
);

create index if not exists words_level_idx on public.words (level);
create index if not exists words_pos_idx   on public.words (pos);
create index if not exists words_word_trgm on public.words using gin (word extensions.gin_trgm_ops);

-- ---------- profiles: one row per auth user ----------
create table if not exists public.profiles (
  id         uuid primary key references auth.users (id) on delete cascade,
  username   text not null unique check (char_length(username) between 3 and 32),
  daily_goal int  not null default 20 check (daily_goal between 1 and 500),
  timezone   text not null default 'Asia/Bangkok',
  created_at timestamptz not null default now()
);

-- ---------- card_states: SM-2 schedule, one row per user+word ----------
create table if not exists public.card_states (
  user_id          uuid not null references auth.users (id) on delete cascade,
  word_id          uuid not null references public.words (id) on delete cascade,
  status           text not null default 'new'
                     check (status in ('new','learning','review','mastered','suspended')),
  repetitions      int  not null default 0,
  interval_days    int  not null default 0,
  ease_factor      numeric(4,2) not null default 2.50 check (ease_factor >= 1.30),
  lapses           int  not null default 0,
  due_at           timestamptz,
  last_grade       smallint check (last_grade between 0 and 5),
  last_reviewed_at timestamptz,
  created_at       timestamptz not null default now(),
  updated_at       timestamptz not null default now(),
  primary key (user_id, word_id)
);

create index if not exists card_states_due_idx
  on public.card_states (user_id, due_at)
  where status in ('learning','review','mastered');

create index if not exists card_states_status_idx on public.card_states (user_id, status);

-- ---------- reviews: append-only log; powers stats, streak and heatmap ----------
create table if not exists public.reviews (
  id            bigint generated always as identity primary key,
  user_id       uuid not null references auth.users (id) on delete cascade,
  word_id       uuid not null references public.words (id) on delete cascade,
  grade         smallint not null check (grade between 0 and 5),
  mode          text not null default 'flip' check (mode in ('flip','quiz','typing')),
  prev_interval int,
  new_interval  int,
  reviewed_at   timestamptz not null default now()
);

create index if not exists reviews_user_time_idx on public.reviews (user_id, reviewed_at desc);

-- ---------- row level security ----------
alter table public.words       enable row level security;
alter table public.profiles    enable row level security;
alter table public.card_states enable row level security;
alter table public.reviews     enable row level security;

-- the catalogue is shared: anyone may read it, nobody may write it through the API
drop policy if exists words_read_all on public.words;
create policy words_read_all on public.words
  for select to anon, authenticated using (true);

drop policy if exists profiles_read_own on public.profiles;
create policy profiles_read_own on public.profiles
  for select to authenticated using (id = (select auth.uid()));

drop policy if exists profiles_update_own on public.profiles;
create policy profiles_update_own on public.profiles
  for update to authenticated
  using (id = (select auth.uid())) with check (id = (select auth.uid()));

drop policy if exists card_states_own on public.card_states;
create policy card_states_own on public.card_states
  for all to authenticated
  using (user_id = (select auth.uid())) with check (user_id = (select auth.uid()));

drop policy if exists reviews_own on public.reviews;
create policy reviews_own on public.reviews
  for all to authenticated
  using (user_id = (select auth.uid())) with check (user_id = (select auth.uid()));

-- ---------- every new signup gets a profile ----------
create or replace function public.handle_new_user()
returns trigger
language plpgsql
security definer
set search_path = public, pg_temp
as $fn$
begin
  insert into public.profiles (id, username)
  values (
    new.id,
    coalesce(new.raw_user_meta_data ->> 'username', split_part(new.email, '@', 1))
  )
  on conflict (id) do nothing;
  return new;
end;
$fn$;

drop trigger if exists on_auth_user_created on auth.users;
create trigger on_auth_user_created
  after insert on auth.users
  for each row execute function public.handle_new_user();
