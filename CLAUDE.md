# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## What this is

A fantasy football Start/Sit Advisor for Sleeper leagues. Served locally via a Node.js server — no build step, no framework.

## Running the app

```
node server.js
```

Then open `http://localhost:8080`. Requires a `.env` file in the project root (see below).

## Architecture

```
server.js         Local dev server — serves static files and injects .env keys as /config.js
index.html        App shell — three views: settings, loading, dashboard
styles.css        Dark theme, card layout, tier colors
app.js            Orchestrator: fetches all data, calls scorer and AI, renders cards
scorer.js         Scoring formula: projection × injury multiplier × defense factor
api/sleeper.js    Sleeper REST client (no auth) + localStorage cache
api/nfl.js        RapidAPI NFL Data client + cache (requires key)
api/groq.js       Groq chat completion client for AI explanations
```

## API keys

Keys live in `.env` (gitignored) and are injected at runtime by `server.js` as a dynamic `/config.js` response. The browser never touches the `.env` file directly.

```
GROQ_API_KEY=your_groq_key
RAPID_API_KEY=your_rapidapi_key
```

| Key | Where to get | Required? |
|---|---|---|
| GROQ_API_KEY | console.groq.com (free) | For AI explanations |
| RAPID_API_KEY | rapidapi.com → NFL API Data | For injuries & defense rankings |
| Sleeper | None — public API | Always |

## Data flow

1. User enters Sleeper username → `sleeper.js` fetches user ID → leagues
2. User picks league + week → `app.js` fetches rosters, matchups, projections, last-3-week stats (all via Sleeper, all cached)
3. NFL API called **only for rostered players** to protect the free-tier quota (~500 req/month)
4. `scorer.js` ranks players per position: `score = projPts × injuryMult × defFactor`
5. Single batched Groq call generates one-sentence explanations for all players
6. Dashboard renders position groups with START / FLEX / SIT tier cards

## Key constraints

- **RapidAPI quota** — cache aggressively; never fetch the same week twice. The `cacheGet`/`cacheSet` helpers in each `api/*.js` file handle this
- **Plain script tags** — no ES modules, no bundler. Load order in `index.html` matters: `config.js` → API clients → `scorer.js` → `app.js`
- **NFL API endpoint paths** — `api/nfl.js` uses best-guess paths from the RapidAPI docs; verify against the actual dashboard if endpoints return 404
