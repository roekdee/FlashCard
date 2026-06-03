<div align="center">

# 🎓 Oxford 3000 Flashcards

A flashcard app for learning the Oxford 3000 word list, with spaced repetition.

![JavaScript](https://img.shields.io/badge/JavaScript-F7DF1E?style=flat-square&logo=javascript&logoColor=black)
![HTML5](https://img.shields.io/badge/HTML5-E34F26?style=flat-square&logo=html5&logoColor=white)
![CSS3](https://img.shields.io/badge/CSS3-1572B6?style=flat-square&logo=css3&logoColor=white)
![Google Apps Script](https://img.shields.io/badge/Google%20Apps%20Script-4285F4?style=flat-square&logo=google&logoColor=white)
![GitHub Pages](https://img.shields.io/badge/GitHub%20Pages-222222?style=flat-square&logo=githubpages&logoColor=white)

</div>

---

I wanted to actually work through the Oxford 3000, so I built a flashcard trainer that schedules reviews with the SM-2 algorithm — the same idea Anki uses, where words you keep getting wrong show up again sooner. Progress is saved per user in a Google Sheet, and a Google Apps Script web app sits in front of it as the API. The frontend is plain HTML/CSS/JS hosted on GitHub Pages.

What it does:

- **Spaced repetition (SM-2)** — each card tracks its ease factor, interval, repetition count, and next-due date.
- **Per-user progress** — log in with a username and password; your learned and hidden cards and your schedule are kept separately per user.
- **Google Sheets as the database** — the Apps Script reads and writes the sheet, so there's no server to run.
- **API key + CORS check** — the Apps Script endpoint checks a shared key and an allowed origin before it answers.
- **No framework** — vanilla HTML/CSS/JS, works as a static site.

## How it works

```
┌─────────────────┐      fetch (API key)      ┌──────────────────────┐
│  Frontend       │ ────────────────────────▶ │  Google Apps Script  │
│  (GitHub Pages) │ ◀──────────────────────── │  Web App (doGet/doPost)
│  index.html     │        JSON                └──────────┬───────────┘
│  app.js         │                                       │ read / write
└─────────────────┘                            ┌──────────▼───────────┐
                                                │  Google Sheets       │
                                                │  words · user_state  │
                                                └──────────────────────┘
```

- **`words`** sheet — the vocabulary (`id | word | translation`).
- **`user_state`** sheet — one row per user/word with the SM-2 fields (`learned`, `repetitions`, `interval`, `ef`, `next_due`, …).
- **`Code.gs`** — the Apps Script API: auth check, fetch due cards, save review results.
- **`app.js`** — the SRS logic, login flow, and card UI.

## Setup

The full step-by-step (exact sheet headers and deployment settings) is in **[QUICKSTART.md](QUICKSTART.md)**. Short version:

1. Create a Google Sheet with `words` and `user_state` tabs.
2. Open **Extensions → Apps Script**, paste in `Code.gs`, and fill in the `CONFIG` block (spreadsheet ID, API key, CORS origin).
3. **Deploy → Web app** (execute as *me*, access *anyone*) and copy the URL.
4. Put that URL and API key into `app.js`, then host `index.html`, `app.js`, and `styles.css` on GitHub Pages.

## Tech

Vanilla JavaScript, HTML5, CSS3, Google Apps Script, Google Sheets, GitHub Pages.

## Notes

Using Apps Script + a Sheet as the backend was the main call here. It meant I could ship a real per-user app without standing up or paying for a server, and the data is right there in a spreadsheet I can open and edit by hand.

The trade-offs are real, though. Auth is basic — a username/password row in a sheet plus a shared API key, which is fine for a personal study tool but I wouldn't put anything sensitive behind it. It also depends on a Google Sheet you set up yourself, so there's no one-click install; you have to follow the QUICKSTART. And Apps Script can be slow on a cold request, which is why there's caching on the client. If I kept going I'd look at batching the writes and maybe moving off Sheets if the word/user count grew.
