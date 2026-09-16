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
- **Three study modes** — flip the card, pick from four meanings, or type the translation.
- **Pronunciation** — the browser's own speech synthesis reads the word out; no audio files, no API.
- **Stats** — a daily goal bar, a review streak, a year-long heatmap and progress per CEFR level.
- **Filters and search** — study only A1, or only verbs; search all 3,025 words in English or Thai.
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
| `get_study_queue(limit, levels, pos)` | due cards first, topped up with unseen words |
| `review_card(word_id, grade, mode)` | applies SM-2, writes the card state and the review log, atomically |
| `set_card_suspended(word_id, bool)` | the "จำได้แล้ว" list |
| `get_stats()` | counts, today, streak, 365-day heatmap, per-level progress, in one JSON |
| `search_words(query, levels, …)` | catalogue search, English or Thai, with your status per row |
| `get_quiz_options(word_id)` | three same-level distractors for the quiz mode |
| `register_user(username, password)` | sign-up by username (see *Auth* below) |

Files:

- **`api.js`** — every call to Supabase, plus the offline outbox.
- **`app.js`** — views, the study loop, keyboard shortcuts, speech.
- **`supabase/migrations/`** — the whole schema, the SM-2 implementation and the RLS policies.
- **`supabase/seed/`** — the 3,025-word catalogue as JSON.

## Live

**https://oxford3000-flashcards.netlify.app**

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

## Auth

Sign-in is by username, which Supabase Auth cannot do directly — it wants an email. Accounts therefore use a synthetic `<username>@oxford3000.local` address, and sign-up goes through the `register_user` database function rather than `auth.signUp`, because GoTrue rejects that domain and, on the free tier, would try to send a confirmation mail capped at about two an hour.

That function is `security definer` and writes to `auth.users` itself. It validates the username and password and caps the project at 500 accounts, but it is still the one place in this app where an unauthenticated caller writes to an auth table — worth reading before you deploy it somewhere that matters. Swap it for ordinary email sign-up if you would rather not have it.

## Notes

This replaced a Google Sheet. The old version kept the word list and every user's progress in two tabs of a spreadsheet, with a Google Apps Script web app in front as the API, and it worked — but Apps Script re-read the entire sheet on every request and wrote back one cell at a time, so a cold call took seconds and the client had to cache aggressively to hide it. The same calls against Postgres come back in about 100ms, which is the whole reason for the move.

Two things about the old version worth recording. The API checked its shared key only on `POST`, and every real call went through `GET` — so anyone with the URL could read or overwrite any user's progress. And the README claimed SM-2, but no code ever computed it: the `ef`, `interval` and `next_due` columns sat at their defaults on all 190 rows. The scheduling in this version is real, and `0002_sm2_rpc.sql` is where it lives.

The word data came over as-is and is not perfect. Pronunciations exist for 117 of 3,025 words, and a few translations are plainly wrong (`bank (river)` is glossed as *ธนาคาร*). The part-of-speech tags that had leaked into the word column — `our det.`, `fifteen number` — are cleaned up in `0005_clean_word_column.sql`.
