# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Commands

```bash
npm install
npm run dev      # tsx server.ts — Express + Vite middleware on http://localhost:3000
npm run lint     # tsc --noEmit (the only check in the repo)
npm run build    # vite build  +  esbuild bundle of server.ts -> dist/server.cjs
npm start        # node dist/server.cjs (set NODE_ENV=production so it serves dist/ instead of Vite)

# Database (PostgreSQL — see DEPLOY.md)
DATABASE_URL="postgresql://..." npm run db:import -- local.db.json   # JSON snapshot -> empty Postgres
DATABASE_URL="postgresql://..." npm run db:backup                     # Postgres -> backups/backup-<ts>.json
```

There is **no test runner and no test suite** — don't invent test commands. `npm run lint` is the verification step.

`npm run dev` starts *one* process: Vite runs in middleware mode inside Express. Never start a separate `vite dev` — the API and the SPA must share port 3000, since the frontend calls `/api/*` on same-origin relative URLs.

**The dev watcher must keep ignoring `local.db.json`** ([vite.config.ts](vite.config.ts)). The JSON database is written to the project root on every mutation; with it unignored, Vite full-reloads the SPA after *every* create/update, remounting the app and throwing the user back to the default page mid-task. It presents as "saving a client kicks me to Pointage" and is easy to misdiagnose as a routing bug. Any new server-written file in the repo root needs the same treatment.

Both `bun.lock` and `package-lock.json` exist; npm is the working path.

Seeded logins (created on first boot, see [database.ts:52-99](src/server/database.ts#L52-L99)): `admin` / `admin123` (ADMIN) and `collab` / `collab123` (COLLABORATOR).

## Architecture

React 19 + Vite 6 + Tailwind v4 SPA in [src/](src/), served by a single-file Express API in [server.ts](server.ts) (~1275 lines, all routes inside one `startServer()`).

### Two storage backends behind one interface

`server.ts` only ever talks to a `Database` ([src/server/db-types.ts](src/server/db-types.ts)). Which engine sits behind it is decided once, in `initDb()`:

- **`DATABASE_URL` set → PostgreSQL** ([src/server/db-postgres.ts](src/server/db-postgres.ts)). The deployed configuration. In `NODE_ENV=production` the server **refuses to start** without it rather than quietly running on a file with no backups.
- **unset → the JSON file** ([src/server/database.ts](src/server/database.ts)), so `npm run dev` needs no database running. Development only.

Both are declared as `Database`, which is what stops them drifting: a method added to one and forgotten in the other fails `npm run lint`. **Adding a collection means adding it to both**, plus the shared interface. Seeding is shared too — `seedDefaults()` is written against the interface, so there is one copy of it, not one per engine.

Records are stored **identically in both**: Postgres keeps each one as `(id TEXT PRIMARY KEY, seq BIGSERIAL, data JSONB)` rather than a column per field. That is deliberate — the records are already document-shaped (free-form `customFields`, JSON-stringified `permissions`, nested invoice lines, dates as display strings in two formats), so normalising them would have meant rewriting every read in `server.ts` and putting the invoice cascade and the historical rates in the blast radius. Keeping the shape identical is what let the backend swap without touching `server.ts` at all.

Things that bite in both:

- `db.get('SELECT * FROM users WHERE id = ?', param)` is a **fake SQL shim** that only recognizes `WHERE username = ?` and `WHERE id = ?`, and only over `users`. Any other SQL string silently returns `null`. Everything else goes through named methods (`getAllClients`, `createTimeEntry`, `updateLeaveBalance`, …).
- `permissions` is stored **JSON-stringified** on the user row. Every user-facing response must go through `publicUser()` in [server.ts](server.ts), which strips the password and parses it back to an array — a route that returns the raw row hands the client a string where it expects an array and crashes the users table on `.map`.
- The seeded `admin`/`collab` accounts use fixed ids `1` and `2`. Keep them fixed: with `Date.now()` ids, reseeding silently invalidated every issued JWT and every request came back `401 Unauthorized`.
- **Ordering is load-bearing.** `createTimeEntry`/`createInvoice` prepend (newest first); everything else appends. Postgres reproduces that with `ORDER BY seq DESC` for those two tables only, which is also why the import inserts them reversed. Get it wrong and history silently displays backwards.
- Methods return **copies** under Postgres, not live references. Nothing may mutate a returned object and expect it to persist — call the update method.
- `available` on a leave balance is **derived, never stored**, in both engines.

**PostgreSQL-only properties** (the reasons to use it): transactional writes, so a crash cannot corrupt anything; `nextInvoiceNumber()` is a single atomic `UPDATE … RETURNING`, so two documents created at the same instant can't take the same legal number; row-level updates instead of rewriting the whole file; safe across multiple instances; and the platform's managed backups. Untyped `NULL` parameters must be **cast explicitly** (`$2::float8`) — Postgres assumes `text` and the statement fails.

**JSON-file-only caveats:** no transactions and no concurrent-write safety, whole-array scans, and the whole file is rewritten on every mutation (~12 MB per write at 300 clients / 6000 entries). Writes go to a `.tmp` and are `rename`d into place, keeping the previous copy as `local.db.json.bak`, because writing in place meant a crash mid-write left truncated JSON. A file that exists but won't parse **aborts the boot** — it used to be swallowed, leaving `db` empty, which then saved an empty database over the damaged one.

See [DEPLOY.md](DEPLOY.md) for provisioning, `npm run db:import` (JSON snapshot → empty Postgres) and `npm run db:backup` (Postgres → portable JSON dump; needs no `pg_dump`).

### Auth and permissions

JWT (`jsonwebtoken`, secret from `JWT_SECRET`, dev fallback hardcoded at [server.ts:8](server.ts#L8)) stored in `localStorage.auth_token`. The `authenticate` middleware accepts the token from `Authorization: Bearer` **or** `?token=` query — the query form exists because `EventSource` cannot set headers ([App.tsx:70](src/App.tsx#L70)).

Two parallel gating mechanisms, and both must be updated together when adding a gated feature:

- Server: `requirePermission('X')` re-reads the user row on every request (so permission edits take effect immediately) and **short-circuits for `role === 'ADMIN'`**.
- Client: `hasPermission` in [AuthContext.tsx](src/context/AuthContext.tsx#L79) mirrors that logic, including the ADMIN bypass.

Roles live in [src/constants/roles.ts](src/constants/roles.ts) — a single list (`ADMIN`, `SUPERVISEUR`, `COLLABORATOR`, `STAGIAIRE`) carrying each role's label, badge classes, and capability flags. Both the client and `server.ts` import it, so **adding a role is one entry there**: the user form, role badges, dashboard headcount, and the server-side gates all derive from it. Never reintroduce a literal `role === 'SUPERVISEUR'` comparison — use `roleMeta`/`roleLabel` or the derived `DASHBOARD_ROLES` / `STAFF_ROLES` / `HR_APPROVER_ROLES` lists.

Note the inconsistency: the KPI/dashboard routes gate on **role** (`DASHBOARD_ROLES`, [server.ts:417-451](server.ts#L417-L451)) while everything else gates on permission strings (`VIEW`, `EDIT`, `MODIFY`, `DELETE`, `MANAGE_USERS`, `VIEW_CLIENTS`, `CREATE_CLIENTS`, `EDIT_CLIENTS`, `DELETE_CLIENTS`, `MANAGE_CLIENT_FIELDS`, `MANAGE_SERVICES`, `VIEW_HR`, `CREATE_LEAVE_REQUEST`, `MANAGE_LEAVE_REQUESTS`, `CREATE_ABSENCE_AUTHORIZATION`, `MANAGE_ABSENCE_AUTHORIZATIONS`). Permissions are stored **JSON-stringified** in the user row and parsed at every use site.

### Live timers: server clock + local tick

A running task is stored as `dureeSeconds` (accumulated) plus `lastStartedAt` (epoch ms). Elapsed time is computed on read — both `GET /api/time-entries` and `broadcastTimeEntries()` add `(Date.now() - lastStartedAt)/1000` before responding, and `PUT /api/time-entries/:id` folds that delta into `dureeSeconds` when a task leaves `RUNNING` ([server.ts:1108](server.ts#L1108), [server.ts:1202](server.ts#L1202)).

`heureFin` is only ever set on a task that has actually completed — the server stamps it on the `RUNNING → COMPLETED` transition and blanks it again if the task resumes. The table renders `—` for an empty one. Don't let the client invent `date`, `heureDebut`, or `heureFin`; the server owns all three so there is one clock and one format.

**An admin's own tasks are hidden from everyone else.** `visibleEntriesFor()` drops ADMIN-owned rows for non-admin viewers, in both `GET /api/time-entries` and the broadcast, and **before pagination** so `total` describes what the viewer can actually see. Both the cost split and this visibility split are admin/non-admin, so the broadcast still builds exactly two frames.

**The server owns the entry id.** The client sends one so it can insert optimistically, but a body without it no longer produces a row with `id: undefined` — such a row could never be updated or deleted (every route looks it up by id) and broke React's keys in the table. `statut` defaults to `RUNNING` the same way.

**The activity description is optional.** A task starts with a client and a mission; the mission and type de tâche identify the work, and the running-timer card shows those rather than the free-text description. Anything rendering `description` must tolerate an empty string.

Every mutating time-entry route calls `broadcastTimeEntries()`, which pushes the **full list of all users' entries** to every SSE subscriber. The client then ticks locally once a second and *keeps its own count* when it differs from the server by <5s, to avoid visible stutter. If you change duration semantics, change all four places.

Two invariants keep that tick honest, both of which were previously broken and are easy to break again:
- The `EventSource` **must reconnect** with backoff and refetch on reconnect ([App.tsx](src/App.tsx)). The local tick never stops, so a permanently dead stream leaves the screen counting up while pause/stop silently do nothing server-side — the UI looks alive and is lying.
- Mutations apply **optimistically** to local state before the request, and refetch on failure. Without that, pause/stop only take effect once the round-trip and broadcast land.

`activeTimer` is not state — it is derived each render from `timeEntries.find(userId === me && statut === 'RUNNING')`. **At most one RUNNING entry per user** is enforced server-side by `pauseOtherRunningEntries()`, which runs on create and on any transition into `RUNNING`; don't rely on the client to maintain it, since an admin can start/resume someone else's task.

Admins get per-row pause / resume / stop controls on *any* collaborator's task (`onChangeStatus` in [TimeTrackingTable.tsx](src/components/TimeTrackingTable.tsx)). That path deliberately bypasses `handleSelectAsActive`, which is about adopting a task into *your own* timer.

### Employer cost

```
charges     = salaireBrut * (cnss + tfp + foprolos + accidentTravail) / 100
coutTotal   = salaireBrut + charges + primesFraisNonCotisables
hourlyRate  = coutTotal / (regimeHoraire * 4.33)
```

`employerHourlyRate(user, settings)` in [server.ts](server.ts) is the **single implementation** — per-user percentages override the global defaults, and it returns **`null` when the collaborator has no salary configured**. Never substitute a placeholder rate for `null`: the old code defaulted to `5.812` DT/h, which silently priced every unconfigured collaborator at a made-up number that looked entirely plausible in the UI.

**Rates are historical.** Each entry stores the rate in force when it was created, and every read costs it at *that* rate — never at the collaborator's current rate. Raising a salary must not retroactively re-price work already logged; only tasks created after the change use the new rate. So a single employee's total is a sum of tasks at differing rates, not `hours × current_rate`. `emp.hourlyRate` on the dashboard is the *current* rate (what future tasks will cost), which is why it is labelled "taux actuel" and is not used to compute totals.

**Cost is ADMIN-only, and stripped server-side.** `enrichEntries(entries, forAdmin)` omits `hourlyRate`/`cost` for non-admins, the SSE broadcast builds a separate payload per subscriber based on `client.isAdmin`, and the KPI endpoint strips every money field for non-admin viewers (a SUPERVISEUR gets the full dashboard minus cost). Hiding cost in the UI alone is not sufficient — it would still ship over the wire.

`null` propagates to the UI as an explicit "non configuré" state — a dash in the Pointage Coût column, `Non configuré` in the employee table, and a `tasksWithoutRate` count on the Coût employeur KPI tile and the Pointage footer. Unpriced work is **excluded** from totals rather than counted at a guess. `calculateCostDT` deliberately has no default rate parameter so this can't regress.

Default charge percentages come from `defaultSettings()` in [src/server/database.ts](src/server/database.ts) — CNSS 16.57%, **TFP 2%, FOPROLOS 1%** (the rates a Tunisian services provider actually pays), accident du travail 0.5%.

**Cost configuration lives only in the user form** ([UsersManagement.tsx](src/components/UsersManagement.tsx)). There is deliberately no Settings page: it was removed so there is exactly one place to reason about employer cost. `GET /api/settings` survives purely to seed that form's defaults — don't rebuild a global settings UI on top of it, and keep the form's `?? 2.0` style fallbacks in step with `defaultSettings()`.

### Presence (actif / absent / inactif)

Three states, defined in [src/constants/presence.ts](src/constants/presence.ts) and shared by both sides: **ACTIVE** (mouse or keyboard in use), **AWAY** (no input for `AWAY_AFTER_MS`, 10 min), **INACTIVE** (no heartbeat for `OFFLINE_AFTER_MS`, ~95 s — tab closed, logged out, or machine off).

**The server decides the state; the client only reports how long it has been idle.** A browser cannot report that its own machine is off — that is only observable here as heartbeats that stopped arriving, so `presenceStateOf()` derives all three from `lastSeenAt` + `lastActivityAt`. Never let a client declare its own status.

Presence is held in a **module-level `Map`, never in the JSON database**. Every user heartbeats every 30 s and each write rewrites the whole database file — persisting it would be the single heaviest thing the server does. Losing it on restart is correct: everyone shows inactive until their next heartbeat.

[PresenceContext](src/context/PresenceContext.tsx) tracks real input events, heartbeats on an interval, beats **immediately** when returning from away (the one transition that must feel instant), and fires a `keepalive` offline beacon on `pagehide`/logout so a closed tab doesn't linger for 95 s. Your own badge reads from local state rather than the poll, so it flips the moment you touch the mouse.

**The away delay is configurable; the inactive one is not.** It defaults to **30 minutes** and is set on the Users page ([PresenceSettingsCard](src/components/PresenceSettingsCard.tsx)) behind `MANAGE_PRESENCE_SETTINGS`, stored on settings as `awayAfterMinutes`, and served by `GET /api/presence/settings` (readable by anyone — the browser needs it for its own badge) / `PUT` (permission-gated, clamped to 1–480). The server caches it for 10 s rather than re-reading the database on every heartbeat from every user.

`OFFLINE_AFTER_MS` stays a constant and must remain comfortably above three heartbeats — tightening it makes users flicker offline on one dropped request. That is why only the *away* threshold is exposed: it is derived from missing heartbeats, not from reported idleness.

### Cash (facturation)

Implements workflow #1 of the cahier des charges (`Facturation-Tous-les-types-de-facture-Tâches-Cash.xlsx`). Three selectors drive the form: **type de document** (facture légale / autre), **mode de facturation** (forfait hides Quantité & PU; détaillée derives the amount from Qté × PU), **régime de TVA** (droit commun / suspension → no VAT).

`computeInvoiceTotals()` in [server.ts](server.ts) is the **only** implementation of the numbered cascade — `(3)=(1)+(2)`, `(5)=(3)×(4)`, `(7)=(3)-(5)+(6)`, `(10)=(7)+(8)-(9)`. The editor mirrors it for live preview, but the stored document always takes the server's figures, so a saved document can't disagree with its own lines. Money is rounded to 3 decimals (millimes) at each step.

Numbering splits by document kind. A **facture légale** takes the next value of the legal sequence (`nextInvoiceNumber()`), which is never reassigned on edit, and its date **may not precede the previous invoice's**. An **autre document** carries a free reference typed by the user: it does not follow the sequence, deliberately does not consume a number from it (that would punch gaps in the legal numbering), is exempt from the date rule, and may be corrected later. Both kinds reject a duplicate number. All of it is enforced server-side — a client-supplied number on a legal invoice is ignored.

[amountToWords.ts](src/utils/amountToWords.ts) produces the mandatory footer wording; its reference case is the spec's own example, `1379.1 → "Mille Trois Cent Soixante-Dix-Neuf Dinars Et Cent Millimes"`.

`printInvoicePdf()` in [downloadInvoice.ts](src/components/cash/downloadInvoice.ts) renders the document into an **offscreen iframe and prints that**, not the page: the output carries only the document and does not depend on the app's `@media print` rules, which only know how to isolate the preview modal. No PDF library on purpose — the print engine emits real vector text, while html2canvas-style renderers rasterise it. The iframe's `<title>` is the document name, so "Enregistrer au format PDF" is pre-named. `downloadInvoice()` still saves standalone HTML as an archive copy, and both share one renderer so they cannot diverge.

Validation errors surface **next to the submit button**, not at the top of the form: the editor scrolls and its footer is sticky, so a banner at the top was off-screen behind the button the user had just pressed.

Gated on `VIEW_CASH` / `MANAGE_CASH`.

### Missions and types de tâches

A **mission** is a `service` row; a **type de tâche** is a `taskTypes` row pointing at one via `serviceId`. The Pointage form cascades: pick a client → pick a mission → the type dropdown offers only that mission's types. A mission with no types configured still works (the field is optional), so adding this didn't break existing missions — the type only becomes required once types exist for the chosen mission.

Both are managed from [MissionsManagement.tsx](src/components/missions/MissionsManagement.tsx) through **one modal that handles a mission and its types together**. Type edits are staged locally (`formTypes` + `removedTypeIds`) and only flushed on save — mission first, then deletions, then creates/renames — which is what lets you define types for a mission that doesn't exist yet. Keep that ordering: the types need the mission's id.

It is gated on **`MANAGE_SERVICES`** — that single permission is what the admin grants to let another role add/update/remove them, so keep every mutating route (`/api/services`, `/api/task-types`) behind it while leaving the GETs open to any authenticated user (the Pointage form needs to read them). Deleting a mission cascades to its types in `deleteService()`.

Time entries snapshot the type's **name** (`taskType`) alongside its id, the same way `pole` snapshots the mission name — renaming a type later must not rewrite history.

### Scale constraints

Sized for **hundreds of clients and dozens of users**. The rules that keep it there — breaking any one of them reintroduces a payload that grows without bound:

- **Nothing unbounded crosses the wire.** `GET /api/time-entries` returns a capped page (`ENTRIES_PAGE_SIZE`, newest first) as `{ data, total }`, and the SSE broadcast sends that same page — never the whole history. The KPI summary carries **aggregates only**: per-task lists come from `/api/kpi/client-tasks` and `/api/kpi/employee-tasks` on expand. Inlining a task list back into the summary took it from 219 KB to 3.2 MB at 300 clients / 6000 entries.
- **Filters live in `filterKpiEntries()`**, shared by the summary and both drill-down endpoints, so a drill-down can never disagree with the row it came from.
- **SSE broadcasts are coalesced** (~120 ms) and built once per role, not per subscriber. Five rapid mutations produce two frames, not five.
- **No linear scans inside per-task loops** — index into a `Map` first (`usersById`, `clientsById`).
- **The client list is never fully loaded.** Both the Clients page and the Pointage autocomplete query the server (`?q=`, `?page=&limit=`); the autocomplete is debounced and asks for 8 rows.
- **`saveDb()` coalesces writes.** Every mutation still rewrites the whole JSON file — that is the real ceiling here. If this outgrows a single file, move to SQLite rather than optimising around it further.

### Dashboard charts

Charts live in [DashboardCharts.tsx](src/components/dashboard/DashboardCharts.tsx) and follow the project's dataviz rules — they were rewritten because the originals broke all of them. When touching them, keep: **categorical slots assigned in fixed order and never cycled** (`SERIES_1` blue `#2a78d6`, `SERIES_2` orange `#eb6834`, validated as a pair against a white surface); **a legend whenever there are ≥ 2 series**; **one measure per axis** (the Autorisations chart used to put a count bar and an hours line on the same scale); and **colour by entity, never by rank** (the Taux-de-réalisation bars used to recolour green/amber/red by their own value, which repainted on every filter change and stole the reserved status colours).

The per-client breakdown is a **table, not a chart** — several measures per row plus a drill-down is tabular work. Cost figures inside it use `formatCostTND` throughout, including the row total, so a total and its parts are never shown at different precisions.

### Leave balances

A balance is stored as `{ userId, entitlement, used }` — **`available` is always derived** (`entitlement - used`), never stored. `entitlement` is the annual allowance the admin sets per user in the Users form (`soldeConge` on the users API); `used` is the only thing approve/cancel move. `normalizeBalance()` in [database.ts](src/server/database.ts) migrates legacy rows that stored a decrementing `available` by recovering `entitlement = available + used`.

Never subtract `daysTaken` from `available` when displaying a remainder — `available` is already net of it. Doing so was double-counting and made the dashboard disagree with the HR page for the same user.

### Navigation has no router

[App.tsx](src/App.tsx) is a chain of ternaries on the `activeSidebarItem` string (`'Dashboard' | 'Clients' | 'Time Tracking' | 'Invoicing' | 'HR' | 'Reports' | 'Users'`), persisted to `localStorage.active_nav` so a refresh keeps you in place. Adding a page = add an entry to `mainNavItems` in [Sidebar.tsx](src/components/Sidebar.tsx) (with its permission guard), a branch in App.tsx with the matching guard, **and** the id to `NAV_IDS` — an id missing from that list silently fails to restore.

Because there is no URL state, anything that remounts the app loses the current page. That is why the watcher note above matters.

### Clients have user-defined columns

Clients carry a free-form `customFields` object. `GET /api/clients/fields` derives the available column set from the union of all clients' `customFields` keys, and the list endpoint's filtering/sorting falls back to `customFields[key]` when a top-level property is missing ([server.ts:314-359](server.ts#L314-L359)). Pagination only kicks in when `?page=` is passed; otherwise a bare array is returned (backward compatibility).

### Date formats are mixed

Time entries store French `DD/MM/YYYY` display strings in `date`; HR records use ISO `YYYY-MM-DD`. The KPI endpoint carries both `parseFrenchDate` and `parseIsoDate` for this reason ([server.ts:455](server.ts#L455)). Durations/costs are formatted with `fr-FR` locale helpers in [src/utils/formatters.ts](src/utils/formatters.ts).

### i18n

`LanguageContext` + [src/translations.ts](src/translations.ts) provide `t(key, fallback)`, default locale `fr`, persisted in `localStorage`. Coverage is partial — plenty of components still hardcode French strings. Prefer `t()` for new UI.

## Repo hygiene notes

- The ~50 `patch_*.cjs` / `fix_*.cjs` / `modify_app.*` scripts at the repo root are **one-off codemods** that were used to generate the current `server.ts` and components by string-splicing. They are not part of build or runtime, they are not idempotent, and re-running them will corrupt the sources. Edit the real files instead. They explain oddities like the KPI routes at [server.ts:417](server.ts#L417) sitting at column 0 inside `startServer()`.
- [README.md](README.md) is the untouched Google AI Studio template; `GEMINI_API_KEY` and the `@google/genai` dependency are unused leftovers.
- Path alias `@/*` maps to the project root (both [vite.config.ts](vite.config.ts) and [tsconfig.json](tsconfig.json)). Tailwind v4 is configured entirely through the Vite plugin — there is no `tailwind.config.js`.
- `DISABLE_HMR=true` turns off HMR *and* file watching in [vite.config.ts](vite.config.ts) — it exists so agent edits don't cause flicker.
- `local.db.json` is gitignored (it holds bcrypt hashes and real client data) and generated on first run; treat it as disposable *local* state — delete it to reseed the default accounts. Deployments do not use it at all.
