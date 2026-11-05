# Known bugs

Last reviewed: 2026-11-04

**How each bug was checked**

- **Reproduced:** seen happening on a local server (`wrangler pages dev`), not on the live site.
- **From code:** found by reading the code, not reproduced.

When you fix a bug, change its status and add the commit or PR.

| ID | Severity | Bug | Checked | Status |
|----|----------|-----|---------|--------|
| [BUG-1](#bug-1-write-endpoints-have-no-admin-check) | High | Write endpoints have no admin check | Reproduced | Open |
| [BUG-2](#bug-2-stats-can-be-read-without-logging-in) | Medium, if not intended | Stats can be read without logging in | Reproduced | Open: ask the owner |
| [BUG-3](#bug-3-deleting-more-than-100-matches-can-leave-empty-matches) | Medium | Deleting more than 100 matches can leave empty matches | From code | Open |
| [BUG-4](#bug-4-uploads-and-deletes-can-stop-halfway) | Low | Uploads and deletes can stop halfway | From code | Open |
| [BUG-5](#bug-5-extracss-is-missing) | Low | `extra.css` is missing | Reproduced | Open |
| [BUG-6](#bug-6-pressing-esc-in-the-date-dialog-does-not-cancel-the-upload) | Low | Pressing Esc in the date dialog does not cancel the upload | From code | Open |
| [BUG-7](#bug-7-session-signature-comparison-is-not-constant-time) | Low | Session signature comparison is not constant-time | From code | Open |

---

## BUG-1: Write endpoints have no admin check

**Where:** [`_middleware.js:4`](../functions/api/_middleware.js), [`matches.js`](../functions/api/matches.js) (POST, PATCH, DELETE), [`templates.js:6`](../functions/api/templates.js), [`ocr.js:64`](../functions/api/ocr.js)

**Problem:** The middleware only checks that the user is logged in. These handlers never check `role`, and the admin-only limit on `upload.html` and `edit.html` exists only in the browser ([`upload.js:246`](../public/upload.js), [`edit.js:100`](../public/edit.js)).

**Impact:** Any guild member can call the API directly to:

- delete match history
- overwrite or edit stats
- add bad icon templates
- use up the Gemini quota

**Reproduced with:** a session for a user with `role = 'member'`, calling the delete endpoint with a date range that held no data.

| Request | Logged in as | Result |
|---------|--------------|--------|
| `DELETE /api/matches` | Nobody | `401` |
| `DELETE /api/matches` | Member | `200`: the bug |
| `GET /api/members` | Member | `403`: this endpoint checks the role correctly |

**Suggested fix:** Check the role in the middleware, so a new endpoint can't forget it. Have the handlers in `members.js` rely on the same check. `/api/auth/*` must stay exempt, because `sync-role` does its own check.

**Intended behaviour:** The comments in the owner's schema say `member` is query-only and `admin` handles upload, cleanup and member management, so this is a bug. See [`0001_initial_schema.sql`](../migrations/0001_initial_schema.sql).

---

## BUG-2: Stats can be read without logging in

**Where:** [`_middleware.js:4`](../functions/api/_middleware.js), which skips every GET request

**Problem:** `index.html` says searching requires a Discord login with a guild role, but that limit exists only in the browser. These endpoints all respond without a session:

- `/api/players`
- `/api/players/<name>`
- `/api/matches`
- `/api/templates`

**Reproduced with:** a logged-out `GET /api/players/TestPlayer`, which returned the player's stats.

**Decide first:** Ask the owner whether this is intended. If not, require a logged-in user on GET requests too, except `/api/auth/*`.

---

## BUG-3: Deleting more than 100 matches can leave empty matches

**Where:** [`matches.js:93-94`](../functions/api/matches.js)

**Problem:** `player_stats` rows are deleted in chunks of 40, but the final `DELETE FROM matches` binds every ID in one statement. D1's documented limit is 100 bound parameters per query. There can be one match per date, so a range covering more than 100 match dates would go over it.

**Impact:** The final delete fails after the player stats are already gone. The matches remain with no players, and the user sees an error.

**Not reproduced:** Local D1 may not enforce the same limit, so a local test may not show it.

**Suggested fix:** Use the same chunking for `matches`. Fixing BUG-4 at the same time would also make the delete all-or-nothing. The schema's `ON DELETE CASCADE` removes a match's stats automatically, so the separate `player_stats` delete may no longer be needed if production has the same foreign key.

---

## BUG-4: Uploads and deletes can stop halfway

**Where:** [`matches.js:55-65`](../functions/api/matches.js) (upload), [`matches.js:87-94`](../functions/api/matches.js) (delete)

**Problem:** The match row, each batch of 50 players and the delete steps are all separate database calls, so they don't share a transaction.

**Impact:** A failure partway through can leave a match with only some of its players, or a delete only partly done. An upload can be repeated safely, since it replaces existing rows.

**Suggested fix:** Put all the statements into a single `env.DB.batch()` call, which D1 runs as one transaction.

---

## BUG-5: `extra.css` is missing

**Where:** [`index.html:4`](../public/index.html), [`admin.html:4`](../public/admin.html)

**Problem:** Both pages link to `extra.css`, which isn't in the repo. The server falls back to `index.html`, so the browser refuses it and logs a MIME type error.

**Impact:** `style.css` has no rules for the search suggestion list (`#sug`, `.search`, `.alts`, `.on`). The selected suggestion therefore isn't highlighted during keyboard navigation. Those rules were probably in the missing file, but that is a guess.

**Suggested fix:** Ask the owner for the file. If it's gone, write those rules again and remove the link from `admin.html` if nothing there needs it.

---

## BUG-6: Pressing Esc in the date dialog does not cancel the upload

**Where:** [`upload.js:165`](../public/upload.js)

**Problem:** The close handler only resolves when `dlg.returnValue === undefined`, but `returnValue` is always a string. Closing with Esc therefore never finishes the waiting promise.

**Impact:** The "upload cancelled" message never appears. No data is affected, and clicking upload again works.

**Suggested fix:** Have the close handler always call `resolve(null)`. Resolving a promise twice is harmless, so the OK and Cancel buttons keep working.

---

## BUG-7: Session signature comparison is not constant-time

**Where:** [`session.js:14`](../lib/session.js)

**Problem:** The signature is compared with `!==`. A timing attack is hard to pull off here, and the session secret itself is not exposed this way.

**Suggested fix:** Use `crypto.subtle.verify`, which checks the HMAC in constant time.

---

# Project gaps

These are missing pieces rather than bugs.

- **Schema may differ from production:** [`0001_initial_schema.sql`](../migrations/0001_initial_schema.sql) comes from the owner, but its header says it was compiled from the source code, so it may not be an export of the live database. The header also mentions a section for migrating existing databases, which isn't in the file.
- **`wrangler.toml` is local only:** it's generated from [`wrangler.toml.example`](../wrangler.toml.example) with a placeholder database ID. Sharing the real one needs the owner's agreement, because Cloudflare Pages can treat a committed file as the source of truth for the deployed site.
- **No tests or CI:** every change has to be checked by hand.
- **Unknown deploy process:** we don't yet know if merging to `main` deploys the site, or how adding a root `package.json` affects a Cloudflare Pages Git build.
- **One match per date:** `guild` and `node` are always empty, so the unique key effectively allows one match a day. See [`matches.js:55`](../functions/api/matches.js). This is a design limit that any feature tracking several matches a day has to change.
