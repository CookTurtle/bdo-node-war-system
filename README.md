# BDO node war stats

A site for guild members to look up node war stats. Admins upload scoreboard screenshots, Gemini reads them, and the results are stored per player. It runs on Cloudflare Pages with Pages Functions and a D1 database.

## Run it locally

You need [Node.js](https://nodejs.org) 22 or newer.

```bash
npm install
```

```bash
npm run dev
```

Then open http://localhost:8788. The first run creates your config files and a local database with sample data. You can search for `TestPlayer` straight away.

Everything runs on your machine. These commands never touch the production database.

### Log in locally

You don't need a Discord app. With the server running, open a second terminal and run:

```bash
npm run token
```

Paste the snippet it prints into your browser's console. You're now logged in as the local admin.

## Commands

| Command | What it does |
|---------|--------------|
| `npm run dev` | Prepares the local environment and starts the server |
| `npm run token` | Prints a snippet that logs you in as the local admin |
| `npm run db:reset` | Deletes the local database and recreates it with sample data (stop the server first) |
| `npm run setup` | Prepares the local environment without starting the server |

## Project layout

| Path | What it holds |
|------|---------------|
| `public/` | Pages, styles and browser JS, served as they are with no build step |
| `functions/` | The API. File paths become routes, so `functions/api/players/[name].js` serves `/api/players/:name` |
| `lib/` | Code shared by the API handlers |
| `migrations/` | Database schema changes, applied in filename order |
| `seeds/dev.sql` | Sample data for local development |
| `scripts/` | Local setup tools |
| `docs/known-bugs.md` | Known bugs and project gaps |

## Changing the database

Add a new numbered file to `migrations/`, such as `0002_add_something.sql`. The next `npm run dev` applies it locally. Don't edit a migration that has already been applied.

## Optional features

These need your own credentials in `.dev.vars`. `.dev.vars.example` lists every setting. Restart the server after changing it.

- **Screenshot OCR:** set `GEMINI_API_KEY`.
- **Discord login:** set `DISCORD_CLIENT_ID` and `DISCORD_CLIENT_SECRET`, and add `http://localhost:8788/api/auth/callback` as a redirect URL in your Discord app. Your Discord ID must also be in the local `users` table.
- **Discord member sync:** set `DISCORD_BOT_TOKEN`, `DISCORD_GUILD_ID` and `DISCORD_MEMBER_ROLE_ID`.
