<div align="center">

# 🎓 Oxford 3000 Flashcards

A flashcard app for learning the Oxford 3000 word list, with spaced repetition.

![JavaScript](https://img.shields.io/badge/JavaScript-F7DF1E?style=flat-square&logo=javascript&logoColor=black)
![HTML5](https://img.shields.io/badge/HTML5-E34F26?style=flat-square&logo=html5&logoColor=white)
![CSS3](https://img.shields.io/badge/CSS3-1572B6?style=flat-square&logo=css3&logoColor=white)
![Supabase](https://img.shields.io/badge/Supabase-3FCF8E?style=flat-square&logo=supabase&logoColor=white)
![PostgreSQL](https://img.shields.io/badge/PostgreSQL-4169E1?style=flat-square&logo=postgresql&logoColor=white)
![GitHub Pages](https://img.shields.io/badge/GitHub%20Pages-222222?style=flat-square&logo=githubpages&logoColor=white)

</div>

---

I wanted to actually work through the Oxford 3000, so I built a flashcard trainer that schedules reviews with the SM-2 algorithm — the same idea Anki uses, where words you keep getting wrong show up again sooner. The frontend is plain HTML/CSS/JS on GitHub Pages; everything else lives in Postgres on Supabase.

What it does:

- **Spaced repetition (SM-2)** — grade each card *ลืม / ยาก / ได้ / ง่าย* and the ease factor, interval and next-due date are recalculated. Each button shows the interval it will give you before you press it.
- **A cap on new words per day** — the part most SRS clones leave out. Deal yourself forty unseen words today and they all come back tomorrow on top of forty more; the backlog grows until you quit. `new_per_day` stops that.
- **Eight study modes** — the recognition ones (flip, pick from four meanings, type the Thai, say the word) and four that make you produce English: fill the word missing from its example sentence, Thai → English, dictation (hear the sentence, type it) and shadowing (hear it, say it back, scored word by word).
- **Leech drill** — the words you have forgotten three times or more, on their own.
- **Grammar** — 72 sentence patterns from A1 to C2 with Thai explanations and a five-question check each; passed lessons go on the same SM-2 schedule as words so they come back for review.
- **Graded reading** — 60 short texts, ten per level, with Thai translations, comprehension questions, and tap-any-word lookup that can drop the word into today's reviews.
- **Level check** — a five-minute CEFR placement test that estimates level and vocabulary size, keeps a history, and points the deck at the right level.
- **AI coach** — write a sentence with a word and get it corrected and explained in Thai, or role-play eight everyday scenes (restaurant, job interview, doctor…). Gemini's free tier behind an edge function with a per-day quota in Postgres.
- **Undo** — the last answer can be taken back, schedule and streak included.
- **Example sentences** — every word carries one, in English and Thai.
- **Pronunciation** — a Thai phonetic respelling on the card, plus the browser's own speech synthesis; no audio files, no API.
- **Stats** — a daily goal bar, a review streak, a year-long heatmap, a seven-day forecast of what is coming, and progress per CEFR level.
- **Filters and search** — study only A1, or only verbs; search all 12,733 words (A1–C2) in English or Thai.
- **Free and Pro** — Free gets A1–A2, flip and cloze, 10 new words a day and 5 AI coach calls. Pro opens B1–C2, lifts the new-card cap, adds every study mode, 40 AI coach calls a day, the full stats, and the leaderboard. The limits are enforced in SQL, not by hiding buttons.
- **Leaderboard and badges** — rank by reviews this week, streak, or words mastered; eleven badges track the long haul.
- **Sign in with an email address or Google**, with password reset. Accounts from the spreadsheet still sign in by username until they add an email.
- **Per-user progress, enforced by the database** — row level security means a user's card states and review log are unreadable to anyone else, even with the browser key in hand.
- **Installable and offline-tolerant** — a PWA, and reviews you make with no connection are queued and replayed when it comes back.
- **No framework, no build step** — plain ES modules, works as a static site.

## How it works

```
┌─────────────────┐     supabase-js (JWT)     ┌──────────────────────┐
│  Frontend       │ ────────────────────────▶ │  Supabase            │
│  (GitHub Pages) │ ◀──────────────────────── │  Auth + PostgREST    │
│  index.html     │          JSON             └──────────┬───────────┘
│  app.js · api.js│                                      │
└─────────────────┘                           ┌──────────▼───────────┐
                                              │  Postgres            │
                                              │  words · profiles    │
                                              │  card_states·reviews │
                                              │  + SM-2 in SQL, RLS  │
                                              └──────────────────────┘
```

Scheduling, queue building and stats all run **inside the database**, so one screen is one round trip:

| Function | What it does |
|---|---|
| `get_study_queue(limit, levels, pos)` | due cards first, topped up with unseen words within the daily new-card budget |
| `review_card(word_id, grade, mode)` | applies SM-2, writes the card state and the review log, atomically |
| `undo_last_review()` | rolls the last answer back to the state stored on the review row |
| `set_card_suspended(word_id, bool)` | the "จำได้แล้ว" list |
| `get_stats()` | counts, today, streak, 365-day heatmap, 7-day forecast, per-level progress, in one JSON |
| `search_words(query, levels, …)` | catalogue search, English or Thai, with your status per row |
| `get_quiz_options(word_id)` | three same-level distractors that do not share the answer's meaning |
| `register_user(username, password)` | sign-up by username (see *Auth* below) |
| `change_password(current, new)` | verifies the old password and rehashes the new one |
| `get_leaderboard(metric, limit)` | Pro only; ranks people who left themselves listed |
| `get_my_badges()` | eleven badges with progress towards each |
| `get_billing_config()` | prices and the Omise publishable key, for the upgrade screen |

Entitlement helpers (`is_pro`, `plan_of`, `user_metrics`) live in the `app_private` schema. PostgREST only exposes `public`, so they are reachable from the functions that need them and from nowhere else — `user_metrics(uuid)` would otherwise have let anyone with the browser key read any account's streak.

Files:

- **`api.js`** — every call to Supabase, plus the offline outbox.
- **`app.js`** — views, the study loop, keyboard shortcuts, speech.
- **`supabase/migrations/`** — the whole schema, the SM-2 implementation, the plan limits and the RLS policies.
- **`supabase/functions/`** — the two Edge Functions that talk to Omise.
- **[SETUP_BILLING.md](SETUP_BILLING.md)** — the keys and dashboard switches the owner has to set.
- **`supabase/seed/`** — the word catalogue as JSON: `words_01-07` the original Oxford 3000, `words_08+` 9,718 words from CEFR-J 1.5, Octanove C1/C2 and Words-CEFR-Dataset.

## Live

**https://oxford3000-flashcards.pages.dev** — Cloudflare Pages, built from `main` with `bash build.sh`, publishing `dist/`.

The Netlify site (`oxford3000-flashcards.netlify.app`) still builds from `main` when its team has credits; GitHub Pages only redirects to Cloudflare. All three talk to the same Supabase project, so accounts and progress are shared. Supabase Auth's redirect allow-list carries every one of them; its Site URL is the Cloudflare address.

## Setup

Full steps in **[QUICKSTART.md](QUICKSTART.md)**. Short version: create a Supabase project, run the migrations, load the seed, put your project URL and publishable key in `api.js`, and serve the folder as a static site.

There is no build step — the repository root *is* the site. `./build.sh` only exists to bundle the runtime files into a zip for a Netlify drag-and-drop deploy; connect the Git repository instead and every push deploys itself.

The publishable key is *meant* to be in the browser — RLS is what protects the data, and the policies are in `0001_core_schema.sql` if you want to check them.

## Keyboard

| Key | Action |
|---|---|
| `Space` | show / hide the translation |
| `1` `2` `3` `4` | ลืม / ยาก / ได้ / ง่าย |
| `S` | speak the word |
| `N` | skip to the back of the session |
| `Z` | undo the last answer |

## Auth

New accounts are ordinary Supabase Auth: a real email address, or Google. That matters for more than tidiness — password reset and payment receipts both need somewhere a person actually reads.

The four accounts inherited from the spreadsheet have no email, so they keep signing in by username through `legacy_login_email`, which resolves a name to its address **only while that address is still the synthetic `@oxford3000.local` one**. The moment a real email is attached the lookup stops answering, so it can never be used to discover somebody's real address. Those accounts see a banner asking them to add one.

An earlier version let anyone create an account through a `security definer` function that wrote to `auth.users` directly. That is gone.

## AI coach

`supabase/functions/ai-coach` calls Google Gemini. Set `GEMINI_API_KEY` (free from https://aistudio.google.com/apikey) under Supabase → Edge Functions → Secrets; `GEMINI_MODEL` is optional (default `gemini-2.5-flash`). Without the key the coach answers "not configured" and nothing else breaks.

`consume_ai_quota` is charged before Gemini is called, so a refused call never reaches the model: 5 a day on Free, 40 on Pro (`plan_limits.ai_per_day`). On the free tier Google may use prompts to improve its models.

## Billing

Omise, because the audience is Thai and PromptPay matters. Pro is stored as an expiry date rather than a subscription state machine: Omise can only auto-renew a saved card, PromptPay is one-time, and both end up doing the same thing — a successful charge pushes `pro_until` further out. A failed renewal degrades to Free on its own.

The browser never names a price; `create-charge` reads it from `billing_plans`. The webhook never trusts its payload; it re-fetches the charge from Omise with the secret key and decides from that, so a forged POST buys nothing. A replayed one buys nothing either — `billing_events.charge_id` is unique and claiming it is what gates the grant.

## Notes

This replaced a Google Sheet. The old version kept the word list and every user's progress in two tabs of a spreadsheet, with a Google Apps Script web app in front as the API, and it worked — but Apps Script re-read the entire sheet on every request and wrote back one cell at a time, so a cold call took seconds and the client had to cache aggressively to hide it. The same calls against Postgres come back in about 100ms, which is the whole reason for the move.

Two things about the old version worth recording. The API checked its shared key only on `POST`, and every real call went through `GET` — so anyone with the URL could read or overwrite any user's progress. And the README claimed SM-2, but no code ever computed it: the `ef`, `interval` and `next_due` columns sat at their defaults on all 190 rows. The scheduling in this version is real, and `0002_sm2_rpc.sql` is where it lives.

The word data came over in poor shape and most of the work since has gone into it. The spreadsheet had part-of-speech tags leaking into the word column (`our det.`, `fifteen number`), homograph markers leaking into the Thai column (`นำ1`, `แหวน2`), nine head words duplicated outright, pronunciations for 117 of 3,015 entries, and 834 words sharing a Thai gloss with some other word — which is what made the multiple-choice quiz ambiguous in the first place. `0005` through `0011` deal with each of those.

Every word now carries a Thai phonetic respelling and an example sentence in both languages. **No two words share a translation.** Some glosses are still loose where the source was — a few part-of-speech tags disagree with their own translation — and the transliterations were derived from the 117 originals rather than a dictionary, so treat them as a reading aid, not a reference.
