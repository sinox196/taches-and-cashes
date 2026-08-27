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

**The chronometer is reachable from every page**, not just Pointage — [FloatingTimer.tsx](src/components/FloatingTimer.tsx), a corner card mounted in App.tsx *outside* the page switch, carrying the clock plus pause / resume / stop. It does **not** open an SSE stream to stay fresh: that broadcast carries a whole page of every user's entries and holding it open on every screen is exactly the payload the scale rules forbid. Off Pointage it polls `GET /api/time-entries/active` every 30 s instead — one row, the caller's own, so it stays bounded however large the history grows — and merges it into the same `timeEntries` state, which is why the existing local 1s tick, `updateTimeEntryApi` and the overtime alert all keep working unchanged. The 30 s cadence only has to catch changes made *elsewhere* (another device, an admin pausing your task); the tick does the counting.

With nothing running it falls back to a task paused **in this session only** (`justPausedId`), so pausing from the card doesn't make it vanish and strand you with no way to resume without walking back to Pointage. Deliberately not "the most recent paused entry" — that would park a task paused days ago in the corner of every page forever.

**Off the app entirely, the clock has two more carriers**, both in App.tsx: the **tab title** (`⏱ HH:MM:SS · CLIENT`, RUNNING only — a frozen time in the title reads as a stuck page), and an **ongoing OS notification** (`showTimerNotification` in [osNotifications.ts](src/utils/osNotifications.ts)) carrying Pause / Reprendre / Arrêter buttons. The notification is shown *only while `document.visibilityState === 'hidden'`* and taken down on return, so it never duplicates the floating card, and it is redrawn on the 30 s interval from a **ref** rather than an effect keyed on `dureeSeconds` — the latter would redraw it once a second.

The worker cannot apply those buttons itself: the JWT lives in the page's `localStorage`, which a service worker cannot read. So `sw.js` posts `{type:'timer-action'}` to an open window and the app applies it through the same `updateTimeEntryApi` path (no `confirm()` on stop — a dialog on a hidden page is never seen, and the tap on Arrêter *is* the confirmation). With no window open it opens the app instead of dropping the tap. `pagehide` closes the notification, since `requireInteraction` otherwise leaves it up after the tab is gone, showing a frozen time above buttons nothing can apply.

One limit worth knowing before "fixing" it: a backgrounded page's timers are clamped to roughly **one tick a minute**, so the notification's time lags by up to a minute (it answers "still running, roughly how long", not a live second hand).

**With the browser fully closed, the clock is delivered by the server** — [push.ts](src/server/push.ts) plus the `push` handler in [sw.js](public/sw.js). No page script runs then, so this is the *only* mechanism that can work; a client-side timer is not an alternative. A sweep every 15 minutes (`CHRONO_PUSH_INTERVAL_MS`) redraws the notification on every device whose owner has a task running, and `syncChronoPush()` also fires on each status change so stopping a task in the app takes the phone's notification down instead of leaving a stale "en cours". Both group their reads per company, so it is one entries scan per company with a subscribed device, not one per device. It **cannot tick**: between sweeps the figure is simply up to 15 minutes stale, by design — a per-second push would be one message per second per running task to a third-party push service.

`POST /api/push/timer-action` is deliberately **not** behind `authenticate`: with the browser closed there is no page, so the worker has no access to the JWT in `localStorage`. The push subscription endpoint is the credential instead — a long unguessable URL minted by the push service, known only to that browser and to us, revoked when the subscription is dropped — and it can only ever act on its own owner's current task. It applies the transition through `applyEntryStatus()`, which mirrors `PUT /api/time-entries/:id` exactly; duplicating those rules loosely would let a task stopped from a notification bank a different duration than the same task stopped from the app.

`VAPID_PUBLIC_KEY`/`VAPID_PRIVATE_KEY` are optional the same way SMTP is — unset, `pushEnabled()` is false and every send is a no-op, so nothing else has to special-case it. Never rotate them once issued: it silently invalidates every device subscription. Two platform limits are not bugs: **iOS** only delivers Web Push to a site installed to the Home Screen (16.4+), and a device that is off or offline gets nothing.

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

Numbering splits by document kind. A **facture légale** takes the next value of the legal sequence (`nextInvoiceNumber()`), which is never reassigned on edit. **Numbering and chronology must agree**: `legalSequenceDateError()` is the single implementation, called on create *and* on edit — editing skipped it entirely, so an invoice created in order could be moved to any date afterwards. It checks **both** neighbours by number: a new invoice is always last so it only has a predecessor, but an edited one sits mid-sequence and moving n° 2 past n° 3 breaks the ordering just as much as moving it before n° 1. Two invoices **may share a date** — only going backwards is refused. An **autre document** carries a free reference typed by the user: it does not follow the sequence, deliberately does not consume a number from it (that would punch gaps in the legal numbering), is exempt from the date rule, and may be corrected later. Both kinds reject a duplicate number. All of it is enforced server-side — a client-supplied number on a legal invoice is ignored.

**[invoicePdf.ts](src/components/cash/invoicePdf.ts) is the only renderer.** It draws the document with jsPDF text primitives, so the output is real vector text — selectable, searchable, sharp when printed — where an html2canvas-style renderer would have produced a picture of an invoice. Download saves that document and print sends the *same* document to the printer via a hidden iframe, so what is filed and what is printed cannot differ, and the print dialog previews the PDF rather than the surrounding page.

Two traps in there: fr-FR groups thousands with a narrow no-break space that the PDF standard fonts do not have (it printed `1 500,000` as `1 / 5 0 0 , 0 0 0`), so `money()` normalises it; and the issuer footer is drawn on **every** page after the body, not inline.

The issuer block — company details, bank details, signature — lives in settings behind `GET/PUT /api/cash/company` (read with `VIEW_CASH`, write with `MANAGE_CASH`) and is edited from [CompanySettings.tsx](src/components/cash/CompanySettings.tsx) inside Cash, not a global settings page. It is **not** snapshotted onto each invoice, so correcting an IBAN fixes every document at once — the trade-off being that it also changes documents already issued. The signature is an inline data URL, refused unless it is PNG/JPEG/WEBP (an SVG could carry script) and capped at 400 kB; `express.json` carries a 1 mb limit for it.

[amountToWords.ts](src/utils/amountToWords.ts) produces the mandatory footer wording; its reference case is the spec's own example, `1379.1 → "Mille Trois Cent Soixante-Dix-Neuf Dinars Et Cent Millimes"`.

`printInvoicePdf()` in [downloadInvoice.ts](src/components/cash/downloadInvoice.ts) renders the document into an **offscreen iframe and prints that**, not the page: the output carries only the document and does not depend on the app's `@media print` rules, which only know how to isolate the preview modal. No PDF library on purpose — the print engine emits real vector text, while html2canvas-style renderers rasterise it. The iframe's `<title>` is the document name, so "Enregistrer au format PDF" is pre-named. `downloadInvoice()` still saves standalone HTML as an archive copy, and both share one renderer so they cannot diverge.

**Brouillard de caisse** ([CashJournal.tsx](src/components/cash/CashJournal.tsx), second tab of Cash) is the cabinet's cash daybook, modelled on their own sheet — one row per movement: `entree` (money in) or `sortie` (money out), plus date, **objet**, description and client. The stored field behind Description is `label`.

The **objet** picklist is its own collection (`cashCategories`), not a constant: the cabinet adds its own, so a new one must never need a code change — the same reason `echeanceStatusOption` is editable. `GET /api/cash-categories` seeds the fifteen they gave on first read and returns them sorted `localeCompare(…, 'fr')`. [CategoryPicker.tsx](src/components/cash/CategoryPicker.tsx) is a searchable list rather than a `<select>` (fifteen-plus options on every line is a lot to scroll), and its search is **accent-folded** — half the list carries accents, and someone typing `tele` means *Télécommunications* as much as *TELECOM*. Adding is inline: type something new, "Ajouter « … »". A label that already exists case-insensitively returns the existing row instead of a near-duplicate. Deleting an objet leaves rows that already carry it untouched — the label is stored on the row, so history stays readable.

Filters are **year then month**, and the list is **paginated** (`PAGE_SIZE` 20). The running balance is computed over the whole filtered set *before* slicing the page, so page 2 continues from page 1 rather than restarting at zero. The pagination bar sits outside the scrolling area and `shrink-0`, so it stays on screen however long the journal gets.

**A row with no amount at all is deliberately allowed.** Their journal records a bill received (STEG, OOREDOO, loyer) before it is paid: the row exists, both money columns are empty, and the running balance carries through unchanged. An earlier version refused it as "a movement that moves nothing" — that was wrong about how the cabinet actually works. What *is* still refused is a row carrying both an entrée and a sortie: one line cannot be a receipt and a payment. The **Solde** column is computed from the rows in display order, never stored: it is purely a function of what precedes it, and storing it would be a second copy to fix on every insert in the middle.

**An `entree` tied to a client *is* that client's encaissement on the Clients page** — merged on read by `journalEncaissementsByClient()`, never copied onto the client record. One movement, one row: editing the journal updates the client, and there is no second copy to keep in step. The merge happens in three places that must agree, since each claims to show the same ledger: `enrichClientLedger()` (single client), the batched `GET /api/clients` list (one journal scan per request, like the invoice scan beside it, including its "Total Général" row), and the KPI dashboard's per-client block. Journal-sourced encaissements reach the client as `journalEncaissements`, each carrying `source: 'BROUILLARD'`, and the Clients view renders them **turquoise with a "caisse" badge** and read-only — the manual list stays editable there, the journal ones are edited in Cash. A row may not be both an entrée and a sortie, and a row moving no money at all is refused: it would sit in the journal contributing nothing while breaking the running balance.

[ClientSearchInput.tsx](src/components/cash/ClientSearchInput.tsx) is the shared debounced client type-ahead (the client list is never fully loaded — see the scale rules). It was extracted while building the journal rather than adding a seventh inline copy of the same `?q=`-and-debounce block; the older call sites still carry their own.

Validation errors surface **next to the submit button**, not at the top of the form: the editor scrolls and its footer is sticky, so a banner at the top was off-screen behind the button the user had just pressed.

Gated on `VIEW_CASH` / `MANAGE_CASH`.

### Missions and types de tâches

A **mission** is a `service` row; a **type de tâche** is a `taskTypes` row pointing at one via `serviceId`. The Pointage form cascades: pick a client → pick a mission → the type dropdown offers only that mission's types. A mission with no types configured still works (the field is optional), so adding this didn't break existing missions — the type only becomes required once types exist for the chosen mission.

Both are managed from [MissionsManagement.tsx](src/components/missions/MissionsManagement.tsx) through **one modal that handles a mission and its types together**. Type edits are staged locally (`formTypes` + `removedTypeIds`) and only flushed on save — mission first, then deletions, then creates/renames — which is what lets you define types for a mission that doesn't exist yet. Keep that ordering: the types need the mission's id.

It is gated on **`MANAGE_SERVICES`** — that single permission is what the admin grants to let another role add/update/remove them, so keep every mutating route (`/api/services`, `/api/task-types`) behind it while leaving the GETs open to any authenticated user (the Pointage form needs to read them). Deleting a mission cascades to its types in `deleteService()`.

Time entries snapshot the type's **name** (`taskType`) alongside its id, the same way `pole` snapshots the mission name — renaming a type later must not rewrite history.

### Ressources Métier

Implements the "Module Ressources Métier" cahier des charges' V1 scope, narrowed to what was actually asked for after two rounds of user feedback: **documents des modèles** (procédures were dropped from the UI entirely — the underlying `resourceTemplate.type` enum still accepts `'procedure'` and nothing stops a row of that type existing, but no screen creates one anymore), liens utiles, échéances — all under the **Ressources métier** nav item ([ResourcesManagement.tsx](src/components/resources/ResourcesManagement.tsx)), gated on `VIEW_RESOURCES` (read) / `MANAGE_RESOURCES` (référentiel CRUD). The spec's own multi-tenant scaffolding (`firm_id` on every table, a `sectors` relation) doesn't map onto this single-tenant app — dropped in favour of an optional free-text `sector` string used only for grouping. `isSystem` is now purely a "seeded by the app" display badge (a small lock icon) — it used to block editing/deleting a seeded template and force a "Dupliquer" step first; that gate was removed at the user's explicit request ("modifiable/removable, no need to duplicate"), so every template — seeded or not — is directly editable and removable, and the `/duplicate` route was deleted outright rather than left as unused dead code.

**The page is split by audience, not by feature.** A plain `VIEW_RESOURCES` collaborator sees exactly one tab, "Mon travail" ([MyResourcesWork.tsx](src/components/resources/MyResourcesWork.tsx)) — search a client, pick a modèle already affected (or affect a new one), check items off. No tab bar is even rendered for them (`TABS.length > 1` guards it) — the référentiel tabs (Documents des modèles, Liens utiles, Échéances) only exist in the `TABS` array at all when `MANAGE_RESOURCES` is present. This replaced an earlier "Suivi & Ressources" section buried in the Clients page's detail panel — one place to work a client's checklists now, not two. `AssignResourceModal` only ever affects a `document_checklist` template (it originally also handled procédures and a per-client "activer une échéance" action; both are gone — procédures with the tab, échéances because the grid has no per-client activation concept at all, just cells set directly). Its modèle picker is a type-ahead (type the first letters, pick from the filtered list) rather than a plain `<select>` — the same debounced-filter pattern the client search already used, just applied to the in-memory template list instead of a server round-trip.

**Documents des modèles is a master-detail screen, not a stack of expanded cards** ([DocumentTemplatesManager.tsx](src/components/resources/DocumentTemplatesManager.tsx)): a filterable, independently-scrolling list of modèle names on the left (`max-h-[65vh] overflow-y-auto`), the selected modèle's editable form on the right (secteur, titre, items, Enregistrer/Supprimer) — a cabinet with dozens of modèles scrolls a bounded list instead of the whole page, and can jump straight to one by typing part of its name. There is no modal in this flow at all; `ResourceTemplateEditorModal.tsx` (the earlier modal-based editor) was deleted rather than kept as a second, redundant path. The left list's title wraps (`break-words`/`leading-snug`) rather than `truncate`-ing — a long "Titre de la liste" used to be cut off with no way to read the rest without opening the modèle.

`resourceTemplate` (+ its `resourceTemplateItem` rows, each just `{label, sortOrder}`) is a réusable model; affecting it to a client creates a `clientResourceInstance` (+ `clientResourceItemStatus` rows) that is a **frozen copy** — editing the source template afterward never touches instances already affected, the same "copie figée" rule the mission/task-type snapshot on time entries already relies on. An item's status is a plain `done: boolean` — a "Document | Suivi" checkbox, deliberately not a richer obligatoire/facultatif/non-applicable model, because the cabinet's own reference spreadsheets are exactly that: two columns. `isSequential` still exists on the schema (blocking item *N* until every item before it has `done: true`, enforced server-side in `PUT /api/client-resource-items/:id`) but has no UI to set it now that procédures are gone — it only ever reads `false` for anything created today.

**A modèle can be created straight from the cabinet's own Excel/CSV sheet** — [ImportDocumentTemplateModal.tsx](src/components/resources/ImportDocumentTemplateModal.tsx) / [parseDocumentTemplateExcel.ts](src/components/resources/parseDocumentTemplateExcel.ts). The parser is deliberately lenient, not a strict format: it scans every row, recognises a `"Secteur :"` row and a `"Titre de la liste :"` row if present, skips a `"Document"` header row if present, and treats every other non-blank first cell as a document label — a bare list with no header rows at all still imports. The only hard requirement is at least one document row; a missing secteur or titre is just left blank for the admin to fill in on the preview screen (the "Importer" button itself stays disabled until a titre is typed, so nothing saves half-named). Parsing reads the sheet as `sheet_to_json(sheet, {header:1})` (array-of-arrays) rather than the header-row style `parseClientsWorkbook()` uses, since this format has no reliable header row to key off. The same dialog can affect the freshly-created template to any number of clients immediately (`POST /api/client-resources` once per selected client), collapsing "create the référentiel entry" and "affecter à un client" into one step.

**Échéances is a literal suivi mensuel grid, not a recurrence engine** ([EcheancesGrid.tsx](src/components/resources/EcheancesGrid.tsx)) — the cahier des charges' own recurring-template design (`deadline_template` → auto-generated `client_deadline_instance`, a derived à_venir/en_retard/réalisée status) was built, then **replaced outright** once the user described the cabinet's actual paper sheet: a wide table, one named column per échéance occurrence (`echeanceColumn`: `{year, month, label, sortOrder}`, e.g. "DM 12/2025", "CNSS TR04"), one row per client, one manually-set status cell per (client, column) (`echeanceStatus`: `{clientId, columnId, status}`). There is no due date, no derived status, and no generation step — every cell is exactly what the cabinet typed into it, or empty.

**The status vocabulary itself (`echeanceStatusOption`: `{id, label, sortOrder, color}`) is admin-editable, not hardcoded** — a value like "Oui" or "DEFAUT" can be renamed, recolored, or deleted from the cell's own floating menu, no separate settings screen. `PUT /api/echeance-statuses` validates a cell's status against the *current* set of option labels rather than a fixed array, so the vocabulary really can change. Deleting an option never touches cells already set to it — a cell just stops matching a known option and renders muted (`EMPTY_STYLE`) until re-set from the grid; this is deliberate (a bulk cascade over every cell using a deleted value would be the one unbounded write in this whole feature). `color` is a key into the app's own reserved status-pill tokens (`done`/`late`/`run`/`pause`/`admin`/`collab`, plus a `gray` neutral) — never a raw hex, so recoloring a value still can't invent a new color outside what the design system already reserves for exactly this purpose. Color is assigned by the option's row, not derived from its text, specifically so a rename doesn't repaint it. The four seeded values are `Oui`/done, `Client non concerné par l'échéance`/gray, `DEFAUT`/late, `Préparée (en attente de confirmation client)`/run — `CHEZ BC` was seeded originally and was later removed at the user's request, which is why `seedResourceLibrary` also backfills a `color` on any pre-existing option row that predates this field (the same "recover a legacy shape" idea as `normalizeBalance()`).

At cabinet scale (hundreds of clients × ~30 colonnes, thousands of cells) the grid renders **buttons, not native `<select>`s** in the body — one shared floating menu (position computed from the clicked cell's bounding rect) instead of one live form control per cell — and keeps the first two columns (N°, Nom) and both header rows (mois, then précis label) `sticky` so the sheet scrolls in both directions without losing track of which row or column a cell belongs to. The "N°" column reads the client's `customFields['Numéro']` (the number the cabinet's own sheet already used) rather than the app's internal id, falling back to the id only when that field is absent; rows sort by that same numéro.

**Every cell carries a full `border` (all four sides), not just `border-b`/`border-r`.** On the `border-collapse` table this reads as a classic Excel-style grid rather than a row-striped list — the look the cabinet's own paper sheet has. The calendrier-par-client cards mirror it: each échéance row is a two-column bordered box (`border-t` + a `border-r` between the libellé and the status chip) instead of a plain divided list, so the two views read as the same grid at different zoom levels rather than two different visual languages.

**A column's month and label are editable in place, and the column is removable** — clicking a column header (both header rows, mois + libellé, are one clickable unit) opens the same shared floating popover pattern the status cells use (`editingColumn`/`editPos`), with a mois `<select>` and a libellé text input, Enregistrer/Annuler, and a trash icon that deletes the column (confirmed, cascading its cells via `deleteEcheanceColumn`). There is deliberately no separate hover-trash-icon-only affordance anymore — one click surface does both rename and delete. Switching between Tableau and Calendrier view closes any open column popover/status menu rather than leaving it floating over the new view.

**Filtering is year first, then month.** The year `<select>` defaults to the real current calendar year (`new Date().getFullYear()`), not the newest year that happens to have columns — so opening the tab in January of a new year lands on that year even before any échéances have been created for it (the empty state then reads "Aucune échéance définie pour 2027"). The option list is columns' years ∪ the current year ∪ any year picked via the trailing **"Autre année…"** option, which swaps the `<select>` for a plain number input (`pickingYear`/`yearInput`) so the cabinet can jump to *any* year — past or future, with or without columns yet — not just the two that happen to already exist; a year picked this way (`customYears`) stays in the dropdown for the rest of the session. A month `<select>` ("Tous les mois" + the 12 names) narrows `yearColumns` to a single month's colonnes regardless of year, so a large multi-year sheet can be read one month at a time without losing the year boundary. Because a cell is just a value with no due-date semantics, the Échéances tab carries no dashboard portfolio widget — that belonged to the old derived-status design and was removed with it — but the grid itself has a second, transposed way to read one client's year: **"Calendrier par client"** (`view: 'grid' | 'calendar'` toggle) searches for a single client, then renders their `yearColumns` as one card per month (mois name, each colonne's libellé + status pill, "Vide" for an empty cell) — the same shared status-menu click target as the grid, just laid out for one client instead of one wide row. This is for reading a single client's year at a glance, not for bulk editing many clients at once (that stays the grid's job).

Column management (add/edit/remove a colonne, cascading its cells on delete) and every cell edit are both gated `MANAGE_RESOURCES`, consistent with the Échéances tab being admin-only. There is deliberately no bulk Excel/CSV import for échéances (it was built, then dropped at the user's request) — every colonne and cell is entered through the grid itself.

**Seed content is real, not placeholder**: the 6 system document checklists are the cabinet's own SARL/SUARL formation procedures (numéros de copies folded straight into each item's label, e.g. "CIN du gérant (4 copies)" — there is no separate help-text field to hold that) and the bank investment-regularisation checklist. The 3 seeded liens utiles are the cabinet's real CNSS/ANETI/TEJ portals, each with a clickable logo copied into [public/logos/](public/logos/) and referenced by a plain `/logos/*.png` path on `usefulLink.icon` — no base64 in the database for these. The 28 seeded échéance columns are the cabinet's own 2025 suivi mensuel sheet, verbatim (DM 12/2025, D SUSP TVA TR04, CNSS TR04, … Acompte 3) — every cell starts empty for the cabinet to fill in from the grid.

**The admin dashboard carries a Ressources métier section independent of Pointage** — [ResourcesProgressCard.tsx](src/components/dashboard/ResourcesProgressCard.tsx), mounted in `AdminDashboard.tsx` above the Pointage-driven KPI block, not inside it. It is **grouped by client** (one row per client, aggregate progress across all their modèles), not one row per instance — expanding a row fetches that client's own `GET /api/client-resources?clientId=` (the same endpoint "Mon travail" uses) and renders each modèle's actual per-document checklist inline, mirroring the summary/drill-down split the KPI dashboard already uses for per-client tasks rather than shipping every item to every viewer up front. It **does** respect the dashboard's client multi-select filter (`selectedClients` prop, narrowing which client rows show) — it deliberately does **not** respect the date-range filter, since a checklist's current completion state has no date to filter by. The summary endpoint (`GET /api/resources/portfolio`) still returns aggregates only (`resolved`/`total` per instance, never the item list) — the same "nothing unbounded crosses the wire" rule the KPI dashboard follows. This card is about documents/procédures only — échéances have no dashboard widget of their own (see above).

Deliberately deferred to V2/V3 per the spec's own phasing table (do not build without an explicit request): automatic task generation from an échéance into time entries, attachments on document items, automatic email/notification reminders, average document-receipt-delay statistics, and any cross-cabinet template sharing.

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

### Task assignments and notifications

An admin (gated on `ASSIGN_TASKS`, not a raw role check — the permission can be delegated the same way `MANAGE_SERVICES`/`ASSIGN_TASKS` etc. already are) hands a mission + type de tâche to a staff member from a button in Pointage ([AssignTaskModal.tsx](src/components/AssignTaskModal.tsx)), which reuses the same client-search-and-mission-cascade UI as [NewTaskCard.tsx](src/components/NewTaskCard.tsx).

The assignment sits **pending** — visible on the assignee's dashboard via [AssignedTasksCard.tsx](src/components/dashboard/AssignedTasksCard.tsx), mounted on **both** MyDashboard and AdminDashboard. That duplication is deliberate: `STAFF_ROLES` (who can be assigned work) is a superset of the roles that see MyDashboard — a SUPERVISEUR is staff but sees the team-wide AdminDashboard instead, so without mounting it there too, a SUPERVISEUR could be assigned work and never see it.

**Starting** an assignment (`PUT /api/task-assignments/:id/start`, assignee-only) does not create a second kind of record — it calls `createRunningEntryForUser()`, the exact same helper `POST /api/time-entries` calls, so it obeys the one-running-task-per-person rule and the entry appears in Pointage the moment that page fetches. There is deliberately no live-push into Pointage from the dashboard: starting an assignment while looking at the dashboard behaves like starting a task any other way — go to Pointage and it is there — which matches the existing rule that the SSE stream only connects while Pointage is the active tab.

Notifications (`notifications` collection, `GET/PUT /api/notifications*`) are generic — `type` decides both the icon and where the bell sends you on click (`TYPE_META` in [NotificationBell.tsx](src/components/NotificationBell.tsx)). Wired at four more places besides task assignment: a leave/absence request notifies its chosen `approverId` directly (no need to scan every user's permissions — the requester already picked one approver), and an approve/reject decision notifies the requester back. The `notify()` helper in server.ts is a `function` declaration, not a `const` arrow — it has to be callable from the HR routes, which are registered earlier in `startServer()` than the point where it is defined; declarations are hoisted through the whole function body, a `const` would not be visible yet at that point in execution.

**Chat unread counts are not duplicated into notifications.** The bell reads `GET /api/messages/contacts` directly (the same endpoint ChatPage already uses) and synthesizes a "message" row per contact with unread messages, rather than writing a notification row on every message sent that would then need to be kept in sync with `readAt` on the thread. One source of truth for "is this message read", not two.

### Leave balances

### Leave balances

A balance is stored as `{ userId, entitlement, used }` — **`available` is always derived** (`entitlement - used`), never stored. `entitlement` is the annual allowance the admin sets per user in the Users form (`soldeConge` on the users API); `used` is the only thing approve/cancel move. `normalizeBalance()` in [database.ts](src/server/database.ts) migrates legacy rows that stored a decrementing `available` by recovering `entitlement = available + used`.

Never subtract `daysTaken` from `available` when displaying a remainder — `available` is already net of it. Doing so was double-counting and made the dashboard disagree with the HR page for the same user.

### Navigation has no router

[App.tsx](src/App.tsx) is a chain of ternaries on the `activeSidebarItem` string (`'Dashboard' | 'Clients' | 'Time Tracking' | 'Messages' | 'Missions' | 'Ressources' | 'Cash' | 'HR' | 'Users'`), persisted to `localStorage.active_nav` so a refresh keeps you in place. Adding a page = add an entry to `mainNavItems` in [Sidebar.tsx](src/components/Sidebar.tsx) (with its permission guard), a branch in App.tsx with the matching guard, **and** the id to `NAV_IDS` — an id missing from that list silently fails to restore. (A "Reports" nav entry existed with no matching App.tsx branch — clicking it rendered nothing — and was removed outright rather than wired up, since nothing had asked for a Reports page.)

Because there is no URL state, anything that remounts the app loses the current page. That is why the watcher note above matters.

### Bulk client import

`POST /api/clients/import` ([ClientsManagement.tsx](src/components/clients/ClientsManagement.tsx), [ImportClientsModal.tsx](src/components/clients/ImportClientsModal.tsx), [parseClientsExcel.ts](src/components/clients/parseClientsExcel.ts)) bulk-creates from an uploaded spreadsheet. The file is parsed **entirely in the browser** (SheetJS) — the server never sees the file, only an array of already-mapped rows shaped exactly like a single `POST /api/clients` body. That is what keeps the route from needing upload middleware, and keeps the mapping the user confirmed in the dialog from ever being reinterpreted server-side.

**xlsx is dynamically imported** inside `parseClientsWorkbook()`, not statically — it is several hundred kB and would otherwise ship to every visitor who never touches the import dialog. It only loads once a file is actually picked.

Any Excel column the user does not map to a native field (name/taxId/email/phone/address/city/country) becomes a `customField`, keyed by its own (whitespace-normalised) header — the same free-form column set the Clients screen has always rendered. `guessMapping()` only pre-fills a starting guess by header name; the user confirms or overrides every field before importing, so a misnamed column never silently maps to the wrong one.

Duplicate detection compares the matricule fiscal (`taxId`) case/whitespace-insensitively against both the existing database and earlier rows in the same file — two rows in one sheet sharing a tax ID do not both become clients. A row with no tax ID falls back to an exact name match. Rows are created via `Promise.allSettled`, not one at a time: `saveDb()`'s write-coalescing collapses that into roughly one file write regardless of row count, the same property every other bulk mutation in this app already relies on.

Import ids are `Date.now() * 1000 + index` rather than bare `Date.now()` (what single-client creation uses) — a fast loop of a few hundred rows can land multiple creates in the same millisecond, which single-creation never has to worry about but a bulk import always will.

### Clients have user-defined columns

Clients carry a free-form `customFields` object. `GET /api/clients/fields` derives the available column set from the union of all clients' `customFields` keys, and the list endpoint's filtering/sorting falls back to `customFields[key]` when a top-level property is missing ([server.ts:314-359](server.ts#L314-L359)). Pagination only kicks in when `?page=` is passed; otherwise a bare array is returned (backward compatibility).

### Date formats are mixed

Time entries store French `DD/MM/YYYY` display strings in `date`; HR records use ISO `YYYY-MM-DD`. The KPI endpoint carries both `parseFrenchDate` and `parseIsoDate` for this reason ([server.ts:455](server.ts#L455)). Durations/costs are formatted with `fr-FR` locale helpers in [src/utils/formatters.ts](src/utils/formatters.ts).

### i18n

`LanguageContext` + [src/translations.ts](src/translations.ts) provide `t(key, fallback)`, default locale `fr`, persisted in `localStorage`. Coverage is partial — plenty of components still hardcode French strings. Prefer `t()` for new UI.

## Repo hygiene notes

- The ~50 `patch_*.cjs` / `fix_*.cjs` / `modify_app.*` scripts at the repo root are **one-off codemods** that were used to generate the current `server.ts` and components by string-splicing. They are not part of build or runtime, they are not idempotent, and re-running them will corrupt the sources. Edit the real files instead. They explain oddities like the KPI routes at [server.ts:417](server.ts#L417) sitting at column 0 inside `startServer()`.
- [README.md](README.md) is the untouched Google AI Studio template; `GEMINI_API_KEY` and the `@google/genai` dependency are unused leftovers.
### Brand identity

The palette and mark come from the official charte graphique, not the earlier Claude Design import — `--color-navy` (`#0D1B2A`, Bleu Profond), `--color-turquoise` (`#00B3A6`) and `--color-canvas`/`--color-gray-50` (`#F2F4F7`, Gris Clair) in [src/index.css](src/index.css) are the brand's exact hex values, not approximations — check against the sheet before nudging any of them. `--color-growth` (`#22C55E`) is declared but not retrofitted onto the existing status pills (run/done/pause/late): those were validated separately for contrast/CVD and swapping them to match the charte without re-running that validation would regress an already-checked property.

[Logo.tsx](src/components/Logo.tsx) draws the mark itself — ring, checkmark, three ascending growth bars, and the turquoise dot marking the ring's gap — rather than shipping it as an image asset. `variant="white"` is for navy surfaces (sidebar badge, login badge): ink flips to white, but the turquoise stays turquoise, matching the charte's own dark lockup where the accent survives against a dark background and only the ink inverts. **The growth bars drop out below 32px** (`showBars = size >= 32`) — they read as a smudge, not a shape, at the sizes this app actually uses the mark (16px sidebar, 28px login); ring + check + dot alone stay legible at any size and are what `favicon.svg`'s hand-built markup (inlined as a base64 data URI in [index.html](index.html) — no separate asset file to keep in sync) also settles for.

### Design tokens

### Design tokens

The visual system comes from the Claude Design project *Taches & Cash Redesign*
(`1494b2cb-e71f-417d-8e83-daa6c860e9ea`) and lives entirely in the `@theme` block
of [src/index.css](src/index.css) — palette, Inter, radii. Nothing else was taken
from it: no field, label, route or behaviour.

Two of those tokens deliberately **override Tailwind's own scale**, and that is
what applies the design across the app without editing components:
`--color-gray-*` (the design's slightly blue-cast neutrals) and `--radius-xl`
(14px cards). So `text-gray-500` and `rounded-xl` are already on-design — don't
reintroduce raw hex to "fix" a colour.

The brand navy is `bg-navy` / `hover:bg-navy-hover`, not `bg-[#101828]`; the old
literal was replaced everywhere. Status pills have reserved pairs
(`run`/`done`/`pause`/`late`/`admin`/`collab`, each `-bg` and `-fg`) which must
never be reused as a categorical series colour.

**Chart series colours are not part of this.** `SERIES_1`/`SERIES_2` in
[DashboardCharts.tsx](src/components/dashboard/DashboardCharts.tsx) stay as they
are — they were validated as a CVD-safe pair against a white surface, and the
design file carries no equivalently validated categorical ramp.

- Path alias `@/*` maps to the project root (both [vite.config.ts](vite.config.ts) and [tsconfig.json](tsconfig.json)). Tailwind v4 is configured entirely through the Vite plugin — there is no `tailwind.config.js`.
- `DISABLE_HMR=true` turns off HMR *and* file watching in [vite.config.ts](vite.config.ts) — it exists so agent edits don't cause flicker.
- `local.db.json` is gitignored (it holds bcrypt hashes and real client data) and generated on first run; treat it as disposable *local* state — delete it to reseed the default accounts. Deployments do not use it at all.
