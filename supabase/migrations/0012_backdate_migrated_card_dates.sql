-- ============================================================
-- 0003 imported the spreadsheet progress without setting created_at, so every
-- migrated row took the default now(). 0008 then began reading created_at as
-- "new cards introduced today" to enforce the daily cap — which made 187 rows
-- of old progress look like today's work and left every migrated account with
-- a new-card budget of 0 before they had studied a single card. The study
-- screen went straight to its empty state.
--
-- Backdate exactly the rows written by that one migration statement; anything
-- created since is a real review and still counts against the cap.
--
-- 0003 now sets created_at itself, so a fresh install never hits this.
-- ============================================================
update public.card_states
set created_at = timestamptz '2026-09-16 04:00:36.557957+00' - interval '180 days'
where created_at = timestamptz '2026-09-16 04:00:36.557957+00';
