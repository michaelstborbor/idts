# IDTS Frontend — Milestone 7: standalone app talking to the real backend

This is a real, standalone web app (Vite + React) — not a Claude artifact
anymore. It talks to the Milestone 6 backend over plain HTTP/JSON with a
JWT login, the same way any real deployed app would.

## Verified, not just written

The whole workflow was driven through an actual headless Chrome browser
against the actual running backend — login, register a child (with the
real Ministry schedule and address field), watch a real defaulter status
get computed server-side, record a vaccination, edit the record, delete a
throwaway record, assign a defaulter (adding a brand-new CHW inline),
record a tracing attempt, run the vaccination summary report and download
it as CSV, check dashboard stats (given/fully-immunized), update account
profile, then sign in as an admin to create and deactivate a user. Every
step passed with zero console errors and zero failed network requests.
See `smoke_test.mjs` — you can rerun this yourself (instructions below).

## What changed from the in-chat prototype

| | In-chat prototype (Milestones 1–5) | This app |
|---|---|---|
| Where it runs | Inside a Claude conversation | Any browser, standalone |
| Data storage | Claude's `window.storage` | Real PostgreSQL/SQLite via the backend API |
| Schedule/defaulter logic | Duplicated in JavaScript | Computed once, server-side — single source of truth |
| Auth | None | Real login, JWT, roles enforced server-side |
| Facilities/geography | Fictional placeholders | **Real**: 108 actual health facilities across 14 chiefdoms in Kono District |
| CHWs | Fixed fictional names | Added on the fly by facility staff (no roster exists yet) |

## Running it yourself

```bash
npm install
cp .env.example .env.local   # point this at your backend's URL

# Terminal 1 — backend (see idts_backend/README.md)
cd ../idts_backend && PYTHONPATH=. uvicorn app.main:app --reload

# Terminal 2 — frontend
npm run dev
# Opens at http://127.0.0.1:5173
```

Log in with whatever the backend was seeded with (see the backend README
— by default `focal` / `dev-only-change-me`).

### Re-running the full-stack smoke test yourself

```bash
npm install   # includes playwright-core as a devDependency
npm run build
# Terminal 1: backend running with
#   IDTS_CORS_ORIGINS=http://127.0.0.1:4173 uvicorn app.main:app
# Terminal 2:
npm run preview -- --host 127.0.0.1 --port 4173
# Terminal 3:
node smoke_test.mjs
```

If you don't already have Chrome/Chromium installed at a path Playwright
can find automatically, set `SMOKE_TEST_CHROME_PATH` to point at one
(e.g. `SMOKE_TEST_CHROME_PATH=/usr/bin/chromium node smoke_test.mjs`), or
run `npx playwright install chromium` first.

## Deliberate scope decisions

- **No offline support yet.** This talks to the backend directly over the
  network on every action — there's no local queue for when connectivity
  drops. The backend's idempotency-key mechanism (tested) is the building
  block for that; the actual offline queue is real remaining work.
- **Dashboard numbers are computed client-side** from the due-list and
  cases endpoints rather than a dedicated `/api/v1/dashboard` aggregate
  endpoint. Fine at pilot scale; worth a real backend endpoint if this
  needs to scale to many more children.
- **CHWs have no login of their own yet** — "Add new CHW" creates a real
  user record (so it's ready for real credentials later) with a
  system-generated placeholder password nobody has. Tracing attempts are
  currently recorded by whoever's logged in (the Facility In-Charge),
  on the CHW's behalf.
- **The bundle is one JS file (~565KB, ~163KB gzipped)** — fine for a
  pilot; code-splitting is a reasonable later optimization, not a
  correctness issue.

## Not yet built

- Offline queue / conflict resolution (design doc §9)
- Actual PWA install prompt polish (icons exist now; a service worker for
  true offline asset caching doesn't yet)
- Hosting (Milestone 8 — needs you to create a hosting account; I'll walk
  through every step)
- Testing on a real Android device over a real network (Milestone 9)

## Before real data

Same caveat as the backend: the schedule needs verification against the
real Sierra Leone MoHS EPI schedule, and a data-protection/consent review
needs to happen, before any real child's information goes anywhere near
this — regardless of how solid the engineering is.
