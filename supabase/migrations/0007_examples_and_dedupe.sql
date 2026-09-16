-- ============================================================
-- Example sentences, and removal of the duplicate head words that the
-- spreadsheet carried over.
-- ============================================================

-- Seeing a word in a sentence teaches more than a bare gloss does.
alter table public.words add column if not exists example_en text;
alter table public.words add column if not exists example_th text;

-- Nine head words appeared twice (`used` three times) with an identical Thai
-- gloss, so the same card came round again with nothing to tell the two apart.
-- Keep the oldest row, move any progress onto it, drop the rest.
with ranked as (
  select id,
         row_number() over (partition by lower(word), coalesce(translation, '')
                            order by created_at, id) as rn,
         first_value(id) over (partition by lower(word), coalesce(translation, '')
                               order by created_at, id) as keep_id
  from public.words
),
dupes as (select id, keep_id from ranked where rn > 1),
moved_states as (
  update public.card_states cs
     set word_id = d.keep_id
    from dupes d
   where cs.word_id = d.id
     -- skip when the user already has the surviving card, or the primary key collides
     and not exists (
       select 1 from public.card_states other
       where other.user_id = cs.user_id and other.word_id = d.keep_id)
  returning 1
),
moved_reviews as (
  update public.reviews r set word_id = d.keep_id
    from dupes d where r.word_id = d.id
  returning 1
)
delete from public.words w using dupes d where w.id = d.id;
