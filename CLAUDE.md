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

**An admin typing a password *for someone else* must not be offered a suggested one.** Every such field (the user form, the platform users modal, the access-request modal) carries `autoComplete="off"` plus `data-lpignore` / `data-1p-ignore` / `data-form-type="other"` — one attribute is not enough, because each password manager honours a different one, and the browser's own generator only backs off on the standard attribute. The field an admin fills in is not their own credential: a saved suggestion would be stored against the admin's account for a login they will never use, and the person it belongs to would never learn the password. Don't "fix" these fields by giving them a `new-password` autocomplete — that is the value that *invites* the suggestion.

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

**Resuming a task while another one is running asks first.** `handleSelectAsActive` used to silently mark the running task `COMPLETED` and start the other one — a destructive choice made on the user's behalf, and the wrong one most of the time: an interruption is a pause, not the end of the work, and a task wrongly closed has to be reopened by hand. It now raises `switchPrompt` (`{from, to}` in [App.tsx](src/App.tsx)) offering the three real answers: **mettre en pause et basculer**, **arrêter et basculer**, or **annuler** and stay on the current task. `resolveSwitch()` applies the decision by writing the chosen status to the outgoing task and *then* starting the incoming one — in that order, so `pauseOtherRunningEntries()` never has two candidates to arbitrate. Pausing this way also sets `justPausedId`, so the task you just left stays reachable from [FloatingTimer.tsx](src/components/FloatingTimer.tsx) instead of vanishing. The server-side one-running-task-per-user rule is unchanged and still authoritative — this prompt decides *what happens to the other task*, it is not what enforces the invariant.

**The chronometer is reachable from every page**, not just Pointage — [FloatingTimer.tsx](src/components/FloatingTimer.tsx), a corner card mounted in App.tsx *outside* the page switch, carrying the clock plus pause / resume / stop. It does **not** open an SSE stream to stay fresh: that broadcast carries a whole page of every user's entries and holding it open on every screen is exactly the payload the scale rules forbid. Off Pointage it polls `GET /api/time-entries/active` every 30 s instead — one row, the caller's own, so it stays bounded however large the history grows — and merges it into the same `timeEntries` state, which is why the existing local 1s tick, `updateTimeEntryApi` and the overtime alert all keep working unchanged. The 30 s cadence only has to catch changes made *elsewhere* (another device, an admin pausing your task); the tick does the counting.

With nothing running it falls back to a task paused **in this session only** (`justPausedId`), so pausing from the card doesn't make it vanish and strand you with no way to resume without walking back to Pointage. Deliberately not "the most recent paused entry" — that would park a task paused days ago in the corner of every page forever.

**The overtime alert fires on the task's own duration — at 2h, then 4h, 6h, …** ([App.tsx](src/App.tsx)). Once a running task crosses a 2h milestone it prompts "Toujours sur cette tâche ?"; no answer within the 2-minute grace pauses it automatically.

The milestone already asked about is recorded **on the entry** (`overtimeAckCycle`: 1 once asked at 2h, 2 at 4h, …), written when the popup is *shown* rather than when it is answered, so a reload while it is open does not bring it back. Keeping it on the entry rather than in the browser is what makes "every 2h" mean what it says: it survives a reload, it follows the task rather than the device (answering on a phone doesn't leave a laptop asking about the same 2h), and it tracks the work rather than the clock — a prompt lands when the task actually reaches 4h, not merely because two hours have passed since the last one.

Two earlier versions were wrong, both in ways that showed up as "the popup comes every time I open the app". A `useRef` of the milestone died on every remount, and since `dureeSeconds` is **accumulated, not continuous**, a task that had ever passed 2h was past it forever — so every page load re-fired it. Replacing that with a persisted *wall-clock* gap between prompts fixed the reload case but answered the wrong question: it asked "has it been 2h since I last asked", not "has this task done another 2h". Don't reintroduce either — the record has to be per-task, persisted, and keyed on duration.

`PUT /api/time-entries/:id` only runs its status-transition logic when the body actually carries `statut` (`isStatusChange`). Without that guard, writing a single field to a running task — which is exactly what recording the milestone does — folded the elapsed time in and nulled `lastStartedAt`, freezing the clock on a task still marked RUNNING.

**A task records the kind of device it was worked from.** `deviceFromRequest()` in server.ts reads `Sec-CH-UA-Mobile` where the browser sends it and falls back to a User-Agent regex, and the result is stamped on the entry: `createdVia` at creation (never rewritten — editing from a laptop doesn't change where the task was *started*), and `lastEditedVia` / `lastEditedBy` / `lastEditedAt` on every PUT. `lastEditedBy` is not optional detail: an admin pausing someone else's task from a laptop would otherwise read as that collaborator having done it. A PUT carrying **only** `overtimeAckCycle` is skipped — that is the 2h popup recording itself, not a person editing the task, and letting it through marks a task "modified" that nobody touched. [EntryDeviceBadge.tsx](src/components/EntryDeviceBadge.tsx) draws it in the Pointage table's Collaborateur cell, and **only when a phone is involved on either end** — desk-started-and-desk-edited is the ordinary case, so the badge appearing at all is the signal. Both signals are self-reported by the browser and spoofable: this reads the timesheet, nothing is ever gated on it.

**Off the app entirely, the clock has exactly one carrier**: the **tab title** (`⏱ HH:MM:SS · CLIENT`, RUNNING only — a frozen time in the title reads as a stuck page), set in App.tsx.

**There is deliberately no chronometer notification, and re-adding one needs an explicit request.** Two used to exist and both were removed at the user's own request: an ongoing OS notification carrying Pause / Reprendre / Arrêter, drawn while `document.visibilityState === 'hidden'`, and a server-pushed one that survived the browser being closed (a 15-minute sweep plus a `syncChronoPush()` on every status change, with an unauthenticated `POST /api/push/timer-action` behind the buttons, since a service worker cannot read the JWT out of the page's `localStorage`). The objection was to the app putting a control surface in front of someone who had deliberately left it — not to any detail of how it was built, so a "fixed" version is not what was wanted either. The chronometer belongs in the app: [FloatingTimer.tsx](src/components/FloatingTimer.tsx) on every page, and Pointage.

Removing it left one loose end worth knowing about: that notification was drawn with `requireInteraction: true`, so the OS keeps it until something closes it — and every call that did went with the feature. A device that had one on screen would keep it indefinitely, frozen at its last time, above buttons now hitting a route that 404s. `closeLingeringTimerNotification()` (called once on app start), the `activate` handler in [sw.js](public/sw.js), and the worker's `push` handler — which closes them on any `elapsed`/`closed` payload rather than merely ignoring it, so a server still running the old build's 15-minute sweep clears the notification instead of re-showing it — all close anything still carrying the `active-timer` tag. Both are **transitional cleanup, not a feature** — deletable once every device has opened the app since.

**Web Push itself stays**, and is still the only way to reach a device with the browser closed — it now carries *ordinary* notifications only (task assigned, leave decisions, HR requests, new messages), sent from `notify()` and the message-send route. `subscribeToPush`/`unsubscribeFromPush` in [osNotifications.ts](src/utils/osNotifications.ts), `GET /api/push/public-key` + `POST /api/push/subscribe|unsubscribe`, and the `payload.title` branch of the `push` handler in [sw.js](public/sw.js) are that path; the worker's chrono branches (`payload.elapsed` / `payload.closed`) and its timer-action plumbing are gone.

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

**Zéro dinar et « on ne sait pas » ne s'affichent pas pareil.** La carte « Coût employeur » du tableau de bord montre « Non configuré » quand *aucune* tâche de la période n'a de taux (`pricedTasks === 0`), au lieu d'un « 0 TND » qui affirme que le travail n'a rien coûté — la colonne du tableau des collaborateurs le faisait déjà, pas la carte. Le cas se rencontre surtout sur l'**administrateur** : c'est le compte semé, il pointe avant que quiconque n'ait rempli la section « Coût employeur » de sa propre fiche, et comme le taux est figé à la création, ses tâches d'avant restent non chiffrées pour toujours.

Le serveur formate les montants avec un `formatCostTND` aligné sur celui du client, et non plus `Math.round()` : arrondir à l'entier affichait « 0 TND » sous un demi-dinar, donc pour toute tâche courte. Même règle dans la rentabilité par client, où `money()` ne garde les décimales que lorsqu'un montant non nul s'arrondirait à zéro — le tableau est large et les millimes y sont du bruit partout ailleurs.

**A client can be flagged `nonFacturable`** (a checkbox on the client form): work logged for them still costs the cabinet, it is simply never invoiced — pro bono, internal work, a client handled as a favour. The flag is **snapshotted onto each time entry as `facturable`** at creation, in `createRunningEntryForUser()`, exactly like `hourlyRate` and `pole`: ticking the box later must not retroactively requalify work already logged, and unticking it must not make billable what was not. The gate is the client, not the mission — that is what was asked for, and it is the coarser of the two, so anything finer-grained is a new decision rather than a tweak. Reads never resolve the flag live: `heuresFacturables` / `heuresNonFacturables` / `coutNonFacturable` on the executive endpoint all read `entry.facturable === false`, so an entry created before the field existed reads as billable — the assumption that was implicit until now. The Pointage table badges a non-billable row's client cell « non fact. ».

Default charge percentages come from `defaultSettings()` in [src/server/database.ts](src/server/database.ts) — CNSS 16.57%, **TFP 2%, FOPROLOS 1%** (the rates a Tunisian services provider actually pays), accident du travail 0.5%.

**Cost configuration lives only in the user form** ([UsersManagement.tsx](src/components/UsersManagement.tsx)). There is deliberately no Settings page: it was removed so there is exactly one place to reason about employer cost. `GET /api/settings` survives purely to seed that form's defaults — don't rebuild a global settings UI on top of it, and keep the form's `?? 2.0` style fallbacks in step with `defaultSettings()`.

### Presence (actif / absent / inactif)

Three states, defined in [src/constants/presence.ts](src/constants/presence.ts) and shared by both sides: **ACTIVE** (mouse or keyboard in use), **AWAY** (no input for `AWAY_AFTER_MS`, 10 min), **INACTIVE** (no heartbeat for `OFFLINE_AFTER_MS`, ~95 s — tab closed, logged out, or machine off).

**The server decides the state; the client only reports how long it has been idle.** A browser cannot report that its own machine is off — that is only observable here as heartbeats that stopped arriving, so `presenceStateOf()` derives all three from `lastSeenAt` + `lastActivityAt`. Never let a client declare its own status.

Presence is held in a **module-level `Map`, never in the JSON database**. Every user heartbeats every 30 s and each write rewrites the whole database file — persisting it would be the single heaviest thing the server does. Losing it on restart is correct: everyone shows inactive until their next heartbeat.

[PresenceContext](src/context/PresenceContext.tsx) tracks real input events, heartbeats on an interval, beats **immediately** when returning from away (the one transition that must feel instant), and fires a `keepalive` offline beacon on `pagehide`/logout so a closed tab doesn't linger for 95 s. Your own badge reads from local state rather than the poll, so it flips the moment you touch the mouse.

**The away delay is configurable; the inactive one is not.** It defaults to **30 minutes** and is set on the Users page ([PresenceSettingsCard](src/components/PresenceSettingsCard.tsx)) behind `MANAGE_PRESENCE_SETTINGS`, stored on settings as `awayAfterMinutes`, and served by `GET /api/presence/settings` (readable by anyone — the browser needs it for its own badge) / `PUT` (permission-gated, clamped to 1–480). The server caches it for 10 s rather than re-reading the database on every heartbeat from every user.

**Le battement rapporte aussi le type de poste.** `deviceFromRequest()` — le même helper qui estampille les tâches — est relu à *chaque* battement et rangé dans l'entrée de présence : quelqu'un qui passe de son poste à son téléphone change d'icône, au lieu de garder celle de sa première connexion. Le poste retombe à `null` en même temps que `idleMs` dès l'état INACTIVE : « était sur son téléphone » n'apprend rien sur quelqu'un dont on ne sait plus rien, et se lirait comme une information à jour. Comme le badge du pointage, c'est auto-déclaré par le navigateur et falsifiable — ça se lit, ça ne décide de rien — et l'icône n'apparaît **que lorsqu'un téléphone est en jeu**, le poste fixe étant le cas ordinaire.

Dans la **messagerie**, la présence (pastille + téléphone, et l'info-bulle qui détaille) est affichée sur l'avatar de chaque contact et dans l'en-tête d'un fil direct, **réservée à l'administrateur** — c'est une information d'encadrement, et un compte portail la verrait de toute façon fausse puisque `PresenceContext` neutralise son jeton.

`OFFLINE_AFTER_MS` stays a constant and must remain comfortably above three heartbeats — tightening it makes users flicker offline on one dropped request. That is why only the *away* threshold is exposed: it is derived from missing heartbeats, not from reported idleness.

### Cash (facturation)

Implements workflow #1 of the cahier des charges (`Facturation-Tous-les-types-de-facture-Tâches-Cash.xlsx`). Three selectors drive the form: **type de document** (facture légale / autre), **mode de facturation** (forfait hides Quantité & PU; détaillée derives the amount from Qté × PU), **régime de TVA** (droit commun / suspension → no VAT).

`computeInvoiceTotals()` in [server.ts](server.ts) is the **only** implementation of the numbered cascade — `(3)=(1)+(2)`, `(5)=(3)×(4)`, `(7)=(3)-(5)+(6)`, `(10)=(7)+(8)-(9)`. The editor mirrors it for live preview, but the stored document always takes the server's figures, so a saved document can't disagree with its own lines. Money is rounded to 3 decimals (millimes) at each step.

Numbering splits by document kind. A **facture légale** takes the next value of the legal sequence (`nextInvoiceNumber()`), which is never reassigned on edit. **Numbering and chronology must agree**: `legalSequenceDateError()` is the single implementation, called on create *and* on edit — editing skipped it entirely, so an invoice created in order could be moved to any date afterwards. It checks **both** neighbours by number: a new invoice is always last so it only has a predecessor, but an edited one sits mid-sequence and moving n° 2 past n° 3 breaks the ordering just as much as moving it before n° 1. Two invoices **may share a date** — only going backwards is refused. An **autre document** carries a free reference typed by the user: it does not follow the sequence, deliberately does not consume a number from it (that would punch gaps in the legal numbering), is exempt from the date rule, and may be corrected later. Both kinds reject a duplicate number. All of it is enforced server-side — a client-supplied number on a legal invoice is ignored.

**`countsAsBilled(inv)` in [server.ts](server.ts) is the single definition of « ce document compte comme des honoraires »** — `documentKind !== 'AUTRE_NON_FACTURABLE' && status !== 'DRAFT'`. It replaced five scattered copies of the same two conditions, in the client ledger, the batched `GET /api/clients`, the KPI dashboard and the executive endpoint: three screens that all claim to show the same figure, so a rule spelled out five times is a rule that will eventually disagree with itself. Anything new that sums invoices goes through it.

**A document can be saved as a brouillon** (`status: 'DRAFT'`, drawn amber with a left border in the Cash table). The point of the draft is the *numbering*: a brouillon carries a provisional `BR-<timestamp>` reference, takes **no** number from the legal sequence, is exempt from the chronology rule, and is excluded from every total by `countsAsBilled()`. Preparing an invoice in advance therefore cannot punch a gap in the legal numbering nor inflate the turnover with documents that do not exist yet. `POST /api/invoices/:id/issue` is what assigns the real number — the legal sequence's next value for a facture légale (re-checking `legalSequenceDateError()` at *that* moment, since the draft may have sat for weeks), or a free reference it demands from the caller for an autre document. Editing a draft deliberately cannot change its status or its number: `PUT` forces `merged.status = existing.status` and keeps the provisional reference, so there is exactly one route that can put a number on a document.

**`POST /api/invoices/:id/convert-to-legal` turns an autre document into a facture légale.** It takes the next sequence number and drops the free reference — which never belonged to the sequence — so the converted document lands *last*, and the chronology rule applies from that instant like any other legal invoice (a document dated before the current last invoice is refused, with a message telling the user to fix the date first). Two details are load-bearing: the original reference is kept as `convertedFromNumber` (+ `convertedAt`), because anyone who knew the document under its old number would otherwise never find it again; and `computeInvoiceTotals()` is re-run, since becoming a facture légale can change the retenue and the timbre and therefore the net à payer. A brouillon is refused here — issue it *as* a legal invoice rather than converting it, so there is still only one path that consumes a sequence number.

**Remboursement de débours carries several lines**, each `{label, amount}` on `disbursementsLines` (labels capped at 120 chars, 20 lines per document). Frais de greffe and timbres advanced on the same file are two distinct expenses; folding them into one figure forces the client to phone for the detail. `(8)` in the cascade is their **sum**, recomputed server-side — a `disbursements` total sent by the client is ignored, so a total can never contradict its own detail.

`normalizeDisbursementLines()` in [src/constants/disbursements.ts](src/constants/disbursements.ts) is the single normaliser, read by both sides like `roles.ts` and `paymentModes.ts`: the server sums it into the cascade, and the editor, the preview and the PDF draw the same lines from it, so what is previewed and what is printed cannot diverge. A document written before this carries a single `disbursements` + `disbursementsLabel` pair and is **read back** as one line rather than rewritten in the database — the same "recover a legacy shape" rule as `normalizeBalance()`. `disbursementsLabel` is blanked on any document this version writes, so there is exactly one carrier going forward; that blanking happens **after** `computeInvoiceTotals()`, never before, since it is that call which reads the legacy label to build the single line — doing it first silently erased the label of an old invoice whose débours nobody had touched.

**[invoicePdf.ts](src/components/cash/invoicePdf.ts) is the only renderer.** It draws the document with jsPDF text primitives, so the output is real vector text — selectable, searchable, sharp when printed — where an html2canvas-style renderer would have produced a picture of an invoice. Download saves that document and print sends the *same* document to the printer via a hidden iframe, so what is filed and what is printed cannot differ, and the print dialog previews the PDF rather than the surrounding page.

Two traps in there: fr-FR groups thousands with a narrow no-break space that the PDF standard fonts do not have (it printed `1 500,000` as `1 / 5 0 0 , 0 0 0`), so `money()` normalises it; and the issuer footer is drawn on **every** page after the body, not inline.

The issuer block — company details, bank details, signature — lives in settings behind `GET/PUT /api/cash/company` (read with `VIEW_CASH`, write with `MANAGE_CASH`) and is edited from [CompanySettings.tsx](src/components/cash/CompanySettings.tsx) inside Cash, not a global settings page. It is **not** snapshotted onto each invoice, so correcting an IBAN fixes every document at once — the trade-off being that it also changes documents already issued. The signature is an inline data URL, refused unless it is PNG/JPEG/WEBP (an SVG could carry script) and capped at 400 kB; `express.json` carries a 1 mb limit for it.

[amountToWords.ts](src/utils/amountToWords.ts) produces the mandatory footer wording; its reference case is the spec's own example, `1379.1 → "Mille Trois Cent Soixante-Dix-Neuf Dinars Et Cent Millimes"`.

`printInvoicePdf()` in [downloadInvoice.ts](src/components/cash/downloadInvoice.ts) renders the document into an **offscreen iframe and prints that**, not the page: the output carries only the document and does not depend on the app's `@media print` rules, which only know how to isolate the preview modal. No PDF library on purpose — the print engine emits real vector text, while html2canvas-style renderers rasterise it. The iframe's `<title>` is the document name, so "Enregistrer au format PDF" is pre-named. `downloadInvoice()` still saves standalone HTML as an archive copy, and both share one renderer so they cannot diverge.

**Brouillard de caisse** ([CashJournal.tsx](src/components/cash/CashJournal.tsx), third tab of Cash) is the cabinet's cash daybook, modelled on their own sheet — one row per movement: `entree` (money in) or `sortie` (money out) — labelled **Montant encaissé** / **Montant décaissé** in the UI, though the field names on the record stay `entree`/`sortie` throughout the server — plus date, **objet**, description and client. The stored field behind Description is `label`.

The **objet** picklist is its own collection (`cashCategories`), not a constant: the cabinet adds its own, so a new one must never need a code change — the same reason `echeanceStatusOption` is editable. `GET /api/cash-categories` seeds the fifteen they gave on first read and returns them sorted `localeCompare(…, 'fr')`. [CategoryPicker.tsx](src/components/cash/CategoryPicker.tsx) is a searchable list rather than a `<select>` (fifteen-plus options on every line is a lot to scroll), and its search is **accent-folded** — half the list carries accents, and someone typing `tele` means *Télécommunications* as much as *TELECOM*. Adding is inline: type something new, "Ajouter « … »". A label that already exists case-insensitively returns the existing row instead of a near-duplicate. Deleting an objet leaves rows that already carry it untouched — the label is stored on the row, so history stays readable.

Filters are **year then month**, and the list is **paginated** (`PAGE_SIZE` 20). The running balance is computed over the whole filtered set *before* slicing the page, so page 2 continues from page 1 rather than restarting at zero. The pagination bar sits outside the scrolling area and `shrink-0`, so it stays on screen however long the journal gets, and it renders unconditionally rather than only past one page — it carries the "showing X to Y of Z" count, which is worth seeing on a short list too, and a bar that appears and disappears makes the table jump. Règlements clients follows the same three rules: year-then-month filters, the same page size, and the same always-visible bar.

**A row with no amount at all is deliberately allowed.** Their journal records a bill received (STEG, OOREDOO, loyer) before it is paid: the row exists, both money columns are empty, and the running balance carries through unchanged. An earlier version refused it as "a movement that moves nothing" — that was wrong about how the cabinet actually works. What *is* still refused is a row carrying both an entrée and a sortie: one line cannot be a receipt and a payment. The **Solde** column is computed from the rows in display order, never stored: it is purely a function of what precedes it, and storing it would be a second copy to fix on every insert in the middle.

**An `entree` tied to a client *is* that client's encaissement on the Clients page** — merged on read by `journalEncaissementsByClient()`, never copied onto the client record. One movement, one row: editing the journal updates the client, and there is no second copy to keep in step. The merge happens in three places that must agree, since each claims to show the same ledger: `enrichClientLedger()` (single client), the batched `GET /api/clients` list (one journal scan per request, like the invoice scan beside it, including its "Total Général" row), and the KPI dashboard's per-client block. Journal-sourced encaissements reach the client as `journalEncaissements`, each carrying `source: 'BROUILLARD'`. **The Clients page no longer records encaissements at all** — the client form's manual editor ("Ajouter un versement") is gone, leaving a read-only total, because two entry points meant two records of one payment. Entries already stored on a client from before are still summed, still listed in the drawer, and still round-trip untouched through save; new ones are entered in Cash. A row may not be both an entrée and a sortie.

**The Clients table cell shows the total encaissé and nothing else** — never the individual dated entries, and no longer a count of versements either. Listing every entry inline stretched one client's row far past every other and made the table unreadable; the count that replaced it said nothing about how much the client had actually paid while competing for attention with the figure that did. The cell is read-only: encaissements are recorded in Cash (Règlements clients or the journal), never typed into this table. The cell (and the client's name) opens the **View Drawer**, whose "Encaissements" section is the one place the full dated list is shown — pre-existing manual entries and Cash-sourced ones together, each badged **caisse** or with its mode de règlement, capped at `max-h-64` with its own scroll. The client *form* shows the same figure as a plain read-only total, nothing more.

**`VIEW_CLIENT_FINANCIALS` gates the whole client ledger, not just the totals bar.** Without it the four ledger columns (Solde antérieur, Montant de facture, Encaissements, Reste à payer) are absent from the Clients table *and* from its "Affichage des colonnes" picker, the "Total Général" row is gone, the client form drops Solde antérieur and Total encaissé, and the View Drawer drops its Encaissements section. The enforcement is server-side, the same rule ADMIN-only cost follows: `stripLedger()` removes those fields (plus `journalEncaissements`) from every client response, `totals` is omitted, and sorting or filtering by a ledger field falls back to `name` — otherwise the row order alone would leak the figures. `userCan(req, permission)` is the in-route twin of `requirePermission`, for a permission that decides which *fields* a response carries rather than whether the route may be called; it re-reads the user row for the same reason. One trap: `PUT /api/clients/:id` must **keep** the stored `soldeAnterieur`/`encaissements` for a caller without the permission — their form never received those fields, so taking them from the body zeroed a client's balance every time someone edited a phone number.

[ClientSearchInput.tsx](src/components/cash/ClientSearchInput.tsx) is the shared debounced client type-ahead (the client list is never fully loaded — see the scale rules). It was extracted while building the journal rather than adding a seventh inline copy of the same `?q=`-and-debounce block; the older call sites still carry their own.

Validation errors surface **next to the submit button**, not at the top of the form: the editor scrolls and its footer is sticky, so a banner at the top was off-screen behind the button the user had just pressed.

**Règlements clients** ([ClientPayments.tsx](src/components/cash/ClientPayments.tsx), second tab of Cash) is what each client has paid and by what means: date, client, objet du règlement ("Facture N° …", "Avance"), **mode de règlement**, compte bancaire, référence, montant.

It is **not a collection of its own**. A règlement *is* a brouillard row with an `entree` tied to a client, seen through the fields that matter here — so the two screens agree by construction and the "one movement, one row" rule above still holds: a règlement corrected here is corrected in the daybook and in the client's encaissements, with no second copy to keep in step. The tab simply filters the journal to rows that are money in from a named client (`entree > 0` and a client); the daybook's own movements — loyer, STEG, alimentation de caisse — are sorties or carry no client and are not règlements.

The **mode de règlement** ([paymentModes.ts](src/constants/paymentModes.ts), a single list read by both sides like `roles.ts`) decides where the règlement shows up next. Only **Espèce** reaches the till, so it is the only mode that appears in the Brouillard de caisse — a virement or a chèque never passed through the caisse, and leaving it in the daybook would put money in the running solde the caisse never held. Every mode counts towards the client's encaissements either way: the Clients column is the total of the règlements' Montant, whatever the means.

Two rules that are easy to get wrong:

- **An unset mode reads as cash** (`isCashMode`). The daybook's own movements carry no mode at all, as does everything entered before the field existed; treating "unset" as non-cash would empty the journal of every row the cabinet has already keyed in.
- **`bankAccount` is blanked server-side on an Espèce row.** Money that went into the till did not go to an account, and keeping a stale IBAN from before the mode was switched would be a lie the UI then renders. The client disables the field for the same reason; the server is what enforces it.

`journalEncaissementsByClient()` carries `isCaisse` onto each merged entry, which is what the Clients drawer badges on — badging every Cash-sourced entry "caisse" (the old rule, back when `source: 'BROUILLARD'` was the only signal) now mislabels a virement.

Gated on `VIEW_CASH` / `MANAGE_CASH`.

### Missions and types de tâches

A **mission** is a `service` row; a **type de tâche** is a `taskTypes` row pointing at one via `serviceId`. The Pointage form cascades: pick a client → pick a mission → the type dropdown offers only that mission's types. A mission with no types configured still works (the field is optional), so adding this didn't break existing missions — the type only becomes required once types exist for the chosen mission.

Both are managed from [MissionsManagement.tsx](src/components/missions/MissionsManagement.tsx) through **one modal that handles a mission and its types together**. Type edits are staged locally (`formTypes` + `removedTypeIds`) and only flushed on save — mission first, then deletions, then creates/renames — which is what lets you define types for a mission that doesn't exist yet. Keep that ordering: the types need the mission's id.

It is gated on **`MANAGE_SERVICES`** — that single permission is what the admin grants to let another role add/update/remove them, so keep every mutating route (`/api/services`, `/api/task-types`) behind it while leaving the GETs open to any authenticated user (the Pointage form needs to read them). Deleting a mission cascades to its types in `deleteService()`.

Time entries snapshot the type's **name** (`taskType`) alongside its id, the same way `pole` snapshots the mission name — renaming a type later must not rewrite history.

**Aucun doublon de mission.** `missionKey()` dans server.ts — casse, espaces multiples et accents repliés — est l'unique définition : « Comptabilité », « comptabilite » et « Comptabilité  » sont la même mission, et ce sont les trois façons dont le même intitulé revient d'un tableur à l'autre. Elle garde la création, la modification, l'import et la copie du catalogue de secteur, sans quoi l'un accepterait ce qu'un autre refuse. Pour un type de tâche le doublon se juge **dans sa mission** : deux missions peuvent légitimement avoir un type « Saisie ».

**Le catalogue livré d'office** vit dans [src/constants/sectorMissions.ts](src/constants/sectorMissions.ts) : les 8 missions et 67 types du tableau « Missions et tâches » du cabinet, repris tels quels — du contenu réel, pas du remplissage, même règle que les modèles de documents et les colonnes d'échéances de Ressources métier. Les intitulés datés (« Mois 1/2026 », « Trimestre 1/2026 ») sont **volontairement** en dur : c'est un catalogue d'intitulés, pas un moteur de récurrence — rien ne génère d'occurrence ni ne calcule d'échéance, exactement comme la grille des échéances.

`seedSectorMissions()` en donne **une copie figée** à chaque entreprise. Le secteur choisit la liste (`missionsForSecteur`), mais **aucun secteur ne repart les mains vides** : à défaut d'une liste à lui il reçoit celle du cabinet. `CABINET` était seul servi au départ, et une entreprise inscrite sous « Autres professions de services » se retrouvait donc devant un écran Missions vide sans que rien ne le lui dise — un catalogue qu'on n'utilise pas se supprime en trois clics, un écran vide sans explication ne se répare pas tout seul. Même règle que le modèle de ressource affecté à un client : ce que l'entreprise en fait ensuite lui appartient. Appelée depuis `authenticate` — donc à **chaque requête**, pas seulement à la connexion : un jeton vit 24 h, donc quelqu'un déjà connecté ne repasse pas par `/api/login` et ne verrait jamais arriver le catalogue après une mise en service (c'est exactement le symptôme « Aucune mission pour le moment » qui a été remonté). La fiche entreprise y est déjà chargée pour l'expiration d'essai, et le drapeau court-circuite en une comparaison dès la deuxième fois. Un `Map` de poses **en vol** (`sectorSeedInFlight`) déduplique les requêtes simultanées : l'application en tire plusieurs de front au chargement d'une page, et sans lui toutes verraient le drapeau encore absent et créeraient chacune les 8 missions — le drapeau seul ne suffit pas, il n'est posé qu'à la fin (pour qu'une pose interrompue puisse se rejouer). Ce qui est mémorisé sur la fiche est la **signature du catalogue** (`sectorMissionsCatalogueVersion`, `8m-67t` — nombre de missions et de types, donc elle change d'elle-même dès qu'on touche au contenu) et non un simple « déjà posé » : une mission délibérément supprimée ne revient pas, mais un drapeau posé à tort par une version antérieure, une pose partielle, ou une correction du catalogue se rattrapent d'eux-mêmes à la requête suivante — la pose restant additive, la rejouer ne duplique rien. `sectorMissionsSeededAt` ne garde plus que la date, pour l'affichage. C'est une `function` déclarée et non un `const` : la route de connexion, enregistrée bien plus haut dans `startServer()`, l'appelle — même raison que `notify()`. `applyMissionCatalogue()` pose le catalogue sans jamais créer de doublon, et est strictement additif.

**Il n'y a délibérément pas d'import de tableur pour les missions.** Il a été construit (bouton « Importer », parseur SheetJS, `POST /api/services/import`, une collection globale `sectorMissions` alimentée depuis l'écran) puis **retiré à la demande de l'utilisateur** au profit du catalogue en dur ci-dessus : une seule liste, la même pour tout le monde, sans écran pour la charger. Ne pas le reconstruire sans demande explicite.

**L'état vide de l'écran Missions s'explique.** `GET /api/services/catalogue-status` rend le secteur, la signature attendue et celle réellement posée, et l'écran s'en sert pour distinguer les trois cas qui produisaient tous « Aucune mission pour le moment » : catalogue jamais livré, catalogue livré puis vidé, ou requête en échec (une réponse qui n'est pas un tableau est désormais une **erreur** affichée, pas une liste vide — le contraire a rendu un diagnostic impossible pendant trois allers-retours).

**Mission et type de tâche se choisissent par recherche**, pas dans un `<select>` : [SearchableSelect.tsx](src/components/SearchableSelect.tsx), partagé par [NewTaskCard](src/components/NewTaskCard.tsx), [AssignTaskModal](src/components/AssignTaskModal.tsx), [PlanTaskModal](src/components/PlanTaskModal.tsx) et [EditTaskModal](src/components/EditTaskModal.tsx) — quatre copies finiraient par chercher différemment. Le natif convenait tant qu'une mission avait trois types ; le catalogue livré en compte **32 sous « Fiscalité » et 20 sous « CNSS »**, tous préfixés pareil (« Préparation déclaration Mois 1/2026 »…). La recherche est **accent-repliée** (comme le sélecteur d'objet du brouillard) et porte sur **n'importe quel morceau** de l'intitulé, pas seulement son début : ce qui distingue deux voisins est à la fin (« 7/2026 »). Les intitulés passent à la ligne au lieu d'être tronqués, sinon deux voisins seraient coupés au même endroit. La touche Échap est capturée pour fermer la liste et **non** la modale qui la contient.

### Ressources Métier

Implements the "Module Ressources Métier" cahier des charges' V1 scope, narrowed to what was actually asked for after two rounds of user feedback: **documents des modèles** (procédures were dropped from the UI entirely — the underlying `resourceTemplate.type` enum still accepts `'procedure'` and nothing stops a row of that type existing, but no screen creates one anymore), liens utiles, échéances — all under the **Ressources métier** nav item ([ResourcesManagement.tsx](src/components/resources/ResourcesManagement.tsx)), gated on `VIEW_RESOURCES` (read) / `MANAGE_RESOURCES` (référentiel CRUD). The spec's own multi-tenant scaffolding (`firm_id` on every table, a `sectors` relation) doesn't map onto this single-tenant app — dropped in favour of an optional free-text `sector` string used only for grouping. `isSystem` is now purely a "seeded by the app" display badge (a small lock icon) — it used to block editing/deleting a seeded template and force a "Dupliquer" step first; that gate was removed at the user's explicit request ("modifiable/removable, no need to duplicate"), so every template — seeded or not — is directly editable and removable, and the `/duplicate` route was deleted outright rather than left as unused dead code.

**The page is split by audience, not by feature.** A plain `VIEW_RESOURCES` collaborator sees exactly one tab, "Mon travail" ([MyResourcesWork.tsx](src/components/resources/MyResourcesWork.tsx)) — search a client, pick a modèle already affected (or affect a new one), check items off. No tab bar is even rendered for them (`TABS.length > 1` guards it) — the référentiel tabs (Documents des modèles, Liens utiles, Échéances) only exist in the `TABS` array at all when `MANAGE_RESOURCES` is present. This replaced an earlier "Suivi & Ressources" section buried in the Clients page's detail panel — one place to work a client's checklists now, not two. `AssignResourceModal` only ever affects a `document_checklist` template (it originally also handled procédures and a per-client "activer une échéance" action; both are gone — procédures with the tab, échéances because the grid has no per-client activation concept at all, just cells set directly). Its modèle picker is a type-ahead (type the first letters, pick from the filtered list) rather than a plain `<select>` — the same debounced-filter pattern the client search already used, just applied to the in-memory template list instead of a server round-trip.

**Documents des modèles is a master-detail screen, not a stack of expanded cards** ([DocumentTemplatesManager.tsx](src/components/resources/DocumentTemplatesManager.tsx)): a filterable, independently-scrolling list of modèle names on the left (`max-h-[65vh] overflow-y-auto`), the selected modèle's editable form on the right (secteur, titre, items, Enregistrer/Supprimer) — a cabinet with dozens of modèles scrolls a bounded list instead of the whole page, and can jump straight to one by typing part of its name. There is no modal in this flow at all; `ResourceTemplateEditorModal.tsx` (the earlier modal-based editor) was deleted rather than kept as a second, redundant path. The left list's title wraps (`break-words`/`leading-snug`) rather than `truncate`-ing — a long "Titre de la liste" used to be cut off with no way to read the rest without opening the modèle.

`resourceTemplate` (+ its `resourceTemplateItem` rows, each just `{label, sortOrder}`) is a réusable model; affecting it to a client creates a `clientResourceInstance` (+ `clientResourceItemStatus` rows) that is a **frozen copy** — editing the source template afterward never touches instances already affected, the same "copie figée" rule the mission/task-type snapshot on time entries already relies on. An item's status is a plain `done: boolean` — a "Document | Suivi" checkbox, deliberately not a richer obligatoire/facultatif/non-applicable model, because the cabinet's own reference spreadsheets are exactly that: two columns. `isSequential` still exists on the schema (blocking item *N* until every item before it has `done: true`, enforced server-side in `PUT /api/client-resource-items/:id`) but has no UI to set it now that procédures are gone — it only ever reads `false` for anything created today.

**A modèle can be created straight from the cabinet's own Excel/CSV sheet** — [ImportDocumentTemplateModal.tsx](src/components/resources/ImportDocumentTemplateModal.tsx) / [parseDocumentTemplateExcel.ts](src/components/resources/parseDocumentTemplateExcel.ts). The parser is deliberately lenient, not a strict format: it scans every row, recognises a `"Secteur :"` row and a `"Titre de la liste :"` row if present, skips a `"Document"` header row if present, and treats every other non-blank first cell as a document label — a bare list with no header rows at all still imports. The only hard requirement is at least one document row; a missing secteur or titre is just left blank for the admin to fill in on the preview screen (the "Importer" button itself stays disabled until a titre is typed, so nothing saves half-named). Parsing reads the sheet as `sheet_to_json(sheet, {header:1})` (array-of-arrays) rather than the header-row style `parseClientsWorkbook()` uses, since this format has no reliable header row to key off. The same dialog can affect the freshly-created template to any number of clients immediately (`POST /api/client-resources` once per selected client), collapsing "create the référentiel entry" and "affecter à un client" into one step.

**Échéances is a literal suivi mensuel grid, not a recurrence engine** ([EcheancesGrid.tsx](src/components/resources/EcheancesGrid.tsx)) — the cahier des charges' own recurring-template design (`deadline_template` → auto-generated `client_deadline_instance`, a derived à_venir/en_retard/réalisée status) was built, then **replaced outright** once the user described the cabinet's actual paper sheet: a wide table, one named column per échéance occurrence (`echeanceColumn`: `{year, month, label, sortOrder}`, e.g. "DM 12/2025", "CNSS TR04"), one row per client, one manually-set status cell per (client, column) (`echeanceStatus`: `{clientId, columnId, status}`). There is no due date, no derived status, and no generation step — every cell is exactly what the cabinet typed into it, or empty.

**The status vocabulary itself (`echeanceStatusOption`: `{id, label, sortOrder, color}`) is admin-editable, not hardcoded** — a value like "Oui" or "DEFAUT" can be renamed, recolored, or deleted from the cell's own floating menu, no separate settings screen. `PUT /api/echeance-statuses` validates a cell's status against the *current* set of option labels rather than a fixed array, so the vocabulary really can change. Deleting an option never touches cells already set to it — a cell just stops matching a known option and renders muted (`EMPTY_STYLE`) until re-set from the grid; this is deliberate (a bulk cascade over every cell using a deleted value would be the one unbounded write in this whole feature). `color` is a key into the app's own reserved status-pill tokens (`done`/`late`/`run`/`pause`/`admin`/`collab`, plus a `gray` neutral) — never a raw hex, so recoloring a value still can't invent a new color outside what the design system already reserves for exactly this purpose. Color is assigned by the option's row, not derived from its text, specifically so a rename doesn't repaint it. The four seeded values are `Oui`/done, `Client non concerné par l'échéance`/gray, `DEFAUT`/late, `Préparée (en attente de confirmation client)`/run — `CHEZ BC` was seeded originally and was later removed at the user's request, which is why `seedResourceLibrary` also backfills a `color` on any pre-existing option row that predates this field (the same "recover a legacy shape" idea as `normalizeBalance()`).

At cabinet scale (hundreds of clients × ~30 colonnes, thousands of cells) the grid renders **buttons, not native `<select>`s** in the body — one shared floating menu (position computed from the clicked cell's bounding rect) instead of one live form control per cell — and keeps the first two columns (N°, Nom) and both header rows (mois, then précis label) `sticky` so the sheet scrolls in both directions without losing track of which row or column a cell belongs to. Il n'y a **pas** de colonne « N° » : elle a été retirée à la demande de l'utilisateur, du tableau comme de l'export CSV. Les lignes restent triées par le `customFields['Numéro']` du client (le numéro de la propre feuille du cabinet), à défaut par nom — l'ordre des lignes ne change donc pas du fait de ce retrait ; seule la colonne a disparu.

**Every cell carries a full `border` (all four sides), not just `border-b`/`border-r`.** On the `border-collapse` table this reads as a classic Excel-style grid rather than a row-striped list — the look the cabinet's own paper sheet has. The calendrier-par-client cards mirror it: each échéance row is a two-column bordered box (`border-t` + a `border-r` between the libellé and the status chip) instead of a plain divided list, so the two views read as the same grid at different zoom levels rather than two different visual languages.

**A column's month and label are editable in place, and the column is removable** — clicking a column header (both header rows, mois + libellé, are one clickable unit) opens the same shared floating popover pattern the status cells use (`editingColumn`/`editPos`), with a mois `<select>` and a libellé text input, Enregistrer/Annuler, and a trash icon that deletes the column (confirmed, cascading its cells via `deleteEcheanceColumn`). There is deliberately no separate hover-trash-icon-only affordance anymore — one click surface does both rename and delete. Switching between Tableau and Calendrier view closes any open column popover/status menu rather than leaving it floating over the new view.

**Filtering is year first, then month.** The year `<select>` defaults to the real current calendar year (`new Date().getFullYear()`), not the newest year that happens to have columns — so opening the tab in January of a new year lands on that year even before any échéances have been created for it (the empty state then reads "Aucune échéance définie pour 2027"). The option list is columns' years ∪ the current year ∪ any year picked via the trailing **"Autre année…"** option, which swaps the `<select>` for a plain number input (`pickingYear`/`yearInput`) so the cabinet can jump to *any* year — past or future, with or without columns yet — not just the two that happen to already exist; a year picked this way (`customYears`) stays in the dropdown for the rest of the session. A month `<select>` ("Tous les mois" + the 12 names) narrows `yearColumns` to a single month's colonnes regardless of year, so a large multi-year sheet can be read one month at a time without losing the year boundary. Because a cell is just a value with no due-date semantics, the Échéances tab carries no dashboard portfolio widget — that belonged to the old derived-status design and was removed with it — but the grid itself has a second, transposed way to read one client's year: **"Calendrier par client"** (`view: 'grid' | 'calendar'` toggle) searches for a single client, then renders their `yearColumns` as one card per month (mois name, each colonne's libellé + status pill, "Vide" for an empty cell) — the same shared status-menu click target as the grid, just laid out for one client instead of one wide row. This is for reading a single client's year at a glance, not for bulk editing many clients at once (that stays the grid's job).

Column management (add/edit/remove a colonne, cascading its cells on delete) and every cell edit are both gated `MANAGE_RESOURCES`, consistent with the Échéances tab being admin-only. There is deliberately no bulk Excel/CSV import for échéances (it was built, then dropped at the user's request) — every colonne and cell is entered through the grid itself.

**Les échéances sont livrées sur plusieurs exercices.** `ECHEANCE_TEMPLATE` porte la grille d'une année — les 28 colonnes du suivi mensuel du cabinet — et `ECHEANCE_YEARS` dit lesquels sont posés (2025 à 2028). Un exercice se déduit du modèle : ce sont les mêmes échéances d'une année sur l'autre, et quatre listes recopiées à la main seraient quatre listes à corriger. Ajouter une année, c'est ajouter un nombre — la pose est idempotente par id, donc les colonnes déjà là et surtout les **cellules remplies** ne bougent pas.

**`{PREV}` dans un libellé est l'exercice *déclaré*, pas l'année de la colonne** : ce qu'on dépose pendant une année porte sur la précédente. La grille 2028 s'écrit donc « DM 12/2027 » (la déclaration mensuelle de janvier couvre décembre d'avant), « IS 2027 », « IRPP 2027-COMMERCE », « DEC EMPLOYEUR 2027 » (les salaires de l'an passé), « IRPP 2027-SERVICE… » et « RNE Bilan 2027 » (les comptes de l'an passé) — les six libellés datés suivent la même règle. Les autres (DM 1 à 11, CNSS TR, D SUSP TVA, Acompte) ne portent pas d'année du tout et sont identiques d'un exercice à l'autre. Le jeton remplace une année écrite en dur : avec « 2025 » dans le modèle, celui-ci était en fait la grille de l'exercice 2026 et le décalage d'un an restait invisible — c'est comme ça qu'il s'était glissé.

**Une colonne déjà posée voit son libellé corrigé, pas seulement sauté.** C'est le seul chemin par lequel une correction du modèle atteint une entreprise déjà servie : la signature de contenu ne fait que rejouer la pose, qui sans ça ne ferait rien. Les cellules ne bougent pas — elles désignent la colonne par son id, jamais par son intitulé. En contrepartie, un libellé renommé à la main sur une colonne semée est ramené au modèle : rien sur la ligne ne distingue une correction d'un renommage délibéré. `seed-year` applique la même réparation, sans quoi un exercice installé depuis l'écran avant une correction garderait ses vieux libellés sans moyen de les rattraper.

**Un exercice vide se répare depuis l'écran.** `POST /api/echeance-columns/seed-year` pose la grille type d'une année à la demande (`MANAGE_RESOURCES`), et l'état vide de la grille propose « Installer la grille type pour <année> ». C'est ce qui récupère une année manquante sans attendre une mise en service — une entreprise dont la pose initiale date d'avant l'ajout des exercices suivants, ou simplement l'année prochaine quand elle arrivera. Idempotent par id : la réponse dit combien de colonnes ont réellement été créées, et un second clic n'en crée aucune.

**La bibliothèque est posée par entreprise, pas seulement pour l'entreprise historique.** `seedResourceLibrary` n'était appelée qu'avec `LEGACY_COMPANY_ID` au démarrage : une entreprise inscrite par le formulaire public n'avait donc aucune échéance, aucun modèle et aucun lien, alors que le compte de démonstration en montrait vingt-huit. `seedResourceLibraryFor()` la pose depuis `authenticate`, même mécanique que `seedSectorMissions` — signature de contenu (`resourceLibraryVersion`) plutôt qu'un « déjà posé », `Map` de poses en vol pour dédupliquer les requêtes simultanées, drapeau écrit à la fin pour qu'une pose interrompue se rejoue. Réservée aux secteurs qui voient le module : l'écrire pour « Autres professions de services » créerait des lignes qu'aucun écran n'affiche.

**Les ids de semis sont portés par l'entreprise (`seedIdFor`/`ownedSeedId`), parce que `id` est la clé primaire de chaque table toutes entreprises confondues.** Un id fixe comme `tpl-seed-patente` ou `ec-seed-2025-0` ne peut donc appartenir qu'à une seule entreprise : la première semée les prenait tous, et chacune des suivantes butait sur `duplicate key value violates unique constraint` dès son **premier** modèle — c'est-à-dire avant la moindre colonne d'échéance, les modèles étant semés en premier. Le drapeau de version ne s'écrivant qu'au succès, l'entreprise restait sans échéances, sans modèles et sans liens **en rejouant la même erreur à chaque requête**, indéfiniment. C'est le même piège que la clé composite `(company_id, user_id)` de `leave_balances` évite déjà. La forme non suffixée reste celle de qui la détient déjà : ces lignes sont désignées par leur id ailleurs — une cellule pointe sa colonne, un item son modèle — donc les renommer orphelinerait le travail déjà saisi. Un semis qui doit rester aligné entre deux appelants (le semis livré d'office et `seed-year`) doit passer par `ownedSeedId` des deux côtés, sinon un clic repose sous un autre id des colonnes déjà là. Ne jamais réintroduire un id de semis littéral dans une table multi-entreprises.

**Lire la grille est ouvert à `VIEW_RESOURCES` ; l'écrire reste `MANAGE_RESOURCES`.** Le suivi mensuel dit qui doit quoi et quand — c'est ce qu'un collaborateur a besoin de consulter pour savoir où il en est, et le lui refuser l'obligeait à passer par l'administrateur. Seuls les trois GET ont bougé ; poser une valeur, ajouter ou supprimer une colonne, renommer un statut sont inchangés. `EcheancesGrid` reçoit `canManage` et n'ouvre alors ni menu de cellule, ni éditeur de colonne, ni bouton d'ajout — il affiche « Consultation » à la place, parce qu'une grille qui semble cliquable sans l'être est pire qu'une grille qui le dit.

**Seed content is real, not placeholder**: the 6 system document checklists are the cabinet's own SARL/SUARL formation procedures (numéros de copies folded straight into each item's label, e.g. "CIN du gérant (4 copies)" — there is no separate help-text field to hold that) and the bank investment-regularisation checklist. The 3 seeded liens utiles are the cabinet's real CNSS/ANETI/TEJ portals, each with a clickable logo copied into [public/logos/](public/logos/) and referenced by a plain `/logos/*.png` path on `usefulLink.icon` — no base64 in the database for these. The 28 seeded échéance columns are the cabinet's own 2025 suivi mensuel sheet, verbatim (DM 12/2025, D SUSP TVA TR04, CNSS TR04, … Acompte 3) — every cell starts empty for the cabinet to fill in from the grid.

**The admin dashboard carries a Ressources métier section independent of Pointage** — [ResourcesProgressCard.tsx](src/components/dashboard/ResourcesProgressCard.tsx), mounted in `AdminDashboard.tsx` above the Pointage-driven KPI block, not inside it. It is **grouped by client** (one row per client, aggregate progress across all their modèles), not one row per instance — expanding a row fetches that client's own `GET /api/client-resources?clientId=` (the same endpoint "Mon travail" uses) and renders each modèle's actual per-document checklist inline, mirroring the summary/drill-down split the KPI dashboard already uses for per-client tasks rather than shipping every item to every viewer up front. It **does** respect the dashboard's client multi-select filter (`selectedClients` prop, narrowing which client rows show) — it deliberately does **not** respect the date-range filter, since a checklist's current completion state has no date to filter by. The summary endpoint (`GET /api/resources/portfolio`) still returns aggregates only (`resolved`/`total` per instance, never the item list) — the same "nothing unbounded crosses the wire" rule the KPI dashboard follows. This card is about documents/procédures only — échéances have no dashboard widget of their own (see above).

Deliberately deferred to V2/V3 per the spec's own phasing table (do not build without an explicit request): automatic task generation from an échéance into time entries, attachments on document items, automatic email/notification reminders, average document-receipt-delay statistics, and any cross-cabinet template sharing.

### Offres et sièges

Le catalogue vit dans [src/constants/plans.ts](src/constants/plans.ts) — une
seule liste, lue par la page publique, la console plateforme et `server.ts`,
comme `roles.ts` et `paymentModes.ts`. Trois packs : **Pack 5 / 70 DT**,
**Pack 10 / 100 DT**, **Pack 15 / 130 DT**, chacun avec dix fois son nombre de
sièges en comptes portail client (50 / 100 / 150) et l'intégralité des vues,
factures comprises et sans plafond. Changer un prix, c'est éditer une ligne :
une valeur corrigée sur la page de tarifs mais pas côté serveur produirait une
page qui annonce un montant et un e-mail de RIB qui en demande un autre.

**Les offres retirées restent dans la liste** (`legacy: true`) — `FREELANCE`,
`EQUIPE`, `CROISSANCE`. Une entreprise inscrite sous l'ancien catalogue les
porte encore dans sa fiche ; les effacer lui ferait perdre son libellé et sa
limite de sièges du jour au lendemain. Elles ne sont simplement plus proposées,
ni sur la page publique, ni à l'inscription (`isSellablePlan`), et la console ne
garde leur option dans le `<select>` que pour l'entreprise qui les porte. Même
règle de récupération que `normalizeBalance()` : on lit la forme ancienne, on ne
la réécrit pas.

**Les sièges se comptent en deux paniers séparés** : le back-office
(`seatLimit`) et le portail client (`portalSeatLimit`), et `seatLimitError()`
dans server.ts est leur unique arbitre. Un comptage unique — ce qu'il y avait —
laissait cinquante clients connectés manger les cinq sièges de l'équipe.
`PUT /api/users/:id` revérifie au **changement de rôle** : sans ça la limite se
contournait en créant un compte portail puis en le repassant collaborateur.
L'ordre de résolution est fiche entreprise (un cabinet peut négocier plus que
son offre), puis offre vendue, puis **rien du tout** — ce dernier cas n'est pas
un oubli : une entreprise sur une offre retirée, ou l'entreprise historique,
n'a jamais souscrit de quota de comptes portail et lui en imposer un
casserait un portail déjà en service. Un `0` écrit sur la fiche, lui, veut bien
dire zéro : c'est une valeur saisie, pas une absence.

### Parrainage

Une entreprise partage un lien (`/?ref=CODE`). Page
[ReferralPage.tsx](src/components/ReferralPage.tsx), entrée de nav
« Parrainage » derrière `MANAGE_USERS` — c'est l'abonnement de l'entreprise qui
est en jeu.

**Seule une entreprise dont l'abonnement est actif peut parrainer.** Un compte
en essai n'a encore rien payé ; lui laisser distribuer des mois gratuits ferait
du parrainage une machine à prolonger un essai avec de faux comptes. Le
`referralCode` n'est donc pas créé tant que le statut n'est pas `ACTIVE`
(`canRefer`), la page affiche un état verrouillé au lieu d'un lien sans valeur,
et `/api/signup` **revérifie le statut du parrain** : un lien partagé reste
valide indéfiniment, l'abonnement non.

**Rien n'est accordé à l'inscription.** Les deux récompenses tombent au moment
où le filleul paie, c'est-à-dire à `POST /api/platform/companies/:id/confirm` :
le filleul obtient **10 % de remise** sur son premier abonnement
(`REFERRAL_DISCOUNT_PERCENT`), le parrain gagne **un mois gratuit**. Si le
filleul ne souscrit jamais, personne ne gagne rien. C'est ce qui rend le
dispositif inabusable par de fausses inscriptions — la version précédente
créditait dès la création du compte, et le disait elle-même comme sa limite
connue.

Le chemin est donc en deux temps, et chacun a sa fonction :
`recordPendingReferral()` écrit à l'inscription une ligne `referrals` en
`status: 'PENDING'` — elle dit « quelqu'un s'est inscrit avec votre lien », ce
que le parrain a le droit de voir, et rien de plus ; `settleReferralOnPayment()`
la passe `CONFIRMED` et crédite. **C'est cette ligne qui rend l'opération
idempotente** : elle n'agit que sur un `PENDING`, donc reconfirmer une
entreprise (ré-appuyer sur le bouton, corriger l'offre) ne crédite pas un
deuxième mois. Elle ne lève jamais : une activation d'abonnement déjà décidée
ne doit pas échouer sur un parrainage.

**La remise est promise à l'inscription, consommée à la confirmation.**
`referralDiscountPercent` est posé sur la fiche du filleul, et
`referralDiscountUsedAt` la retire une fois la première échéance passée — c'est
une remise de bienvenue, pas un tarif. Entre les deux, elle doit se **voir là
où on encaisse** : l'e-mail de RIB annonce le montant remisé (annoncer le prix
plein puis facturer moins est la meilleure façon de rater un encaissement), et
la console plateforme l'affiche sous l'offre. Le prix retenu est figé sur la
fiche (`subscriptionPriceDT`) à la confirmation, pour ne pas bouger quand le
catalogue bougera.

**Ce que « un mois gratuit » veut dire dépend de l'état du parrain.** Par la
règle ci-dessus il est actif, donc `trialEndsAt: null` (la confirmation de
paiement l'efface) et sa facturation vit hors de l'app : la récompense est un
avoir, `referralCreditMonths`, **affiché dans la console plateforme** pour que
l'admin l'applique à la prochaine échéance. Sans cet affichage le mois promis
n'existerait jamais. La branche « essai prolongé » (`TRIAL_EXTENDED`, +30 jours
depuis la fin d'essai en cours et non depuis aujourd'hui) ne sert plus qu'aux
lignes écrites avant cette règle, et reste là pour elles — comme se lit
`status` absent, qui vaut `CONFIRMED` : un parrainage déjà acquis ne doit pas
repasser « en attente » à l'écran.

**« Actif » veut dire deux choses à l'écran, et les confondre a fait passer le
parrainage pour cassé.** Le bandeau du haut affiche le badge de *présence*
(actif / absent / inactif — la souris et le clavier), tandis qu'une entreprise
en essai n'affichait nulle part qu'elle était en essai : un filleul tout juste
inscrit se lisait donc comme déjà abonné, et le parrain comme déjà crédité.
[SubscriptionBadge.tsx](src/components/SubscriptionBadge.tsx) montre désormais
« Essai · N j » (ambre) à côté, et **rien du tout** pour un abonnement payé —
même règle que le badge de téléphone : il n'apparaît que lorsqu'il y a quelque
chose à dire. Le comportement du serveur, lui, était et reste celui décrit
ci-dessus.

Le `referralCode` est créé **à la première consultation** de la page, pas à
l'inscription : les entreprises déjà en base n'en ont pas, et une migration
pour un champ que personne n'a regardé serait du travail pour rien. Alphabet
sans I, O, 0 ni 1 — le code se dicte au téléphone.

Le lien est construit côté serveur depuis l'origine réellement appelée : codé
en dur il serait faux en local comme sur un domaine personnalisé.

Un code inconnu **n'échoue pas** l'inscription (un lien tronqué en route ne doit
pas coûter un client), et l'écriture de la ligne de parrainage se fait *après*
la création de l'entreprise, dans un `try/catch` : un parrainage perdu ne fait
jamais échouer une inscription déjà aboutie.

**Ce qui n'est délibérément pas construit** : on ne se parraine pas soi-même sur
la seule base de l'adresse de contact — c'est le garde-fou minimal, pas une
politique anti-fraude. Il n'existe pas non plus d'écran pour appliquer l'avoir :
la facturation vit hors de l'app, la console l'affiche et un humain le déduit.

### Portail client

Un client du cabinet peut avoir son propre accès. Il se connecte par le **même
écran** que les collaborateurs — c'est son rôle qui l'amène sur le portail
([ClientPortal.tsx](src/pages/ClientPortal.tsx)) au lieu du back-office, via un
branchement placé dans [App.tsx](src/App.tsx) *avant* toute la coquille interne.

**Le rattachement porte sur l'utilisateur, pas sur le client.** `user.clientId`
plutôt que `clients.userId` : plusieurs comptes peuvent viser le même dossier —
le gérant et son comptable — sans table pivot, et un compte ne peut par
construction en viser qu'un seul. `CLIENT_ROLE` vit dans
[roles.ts](src/constants/roles.ts) et sert des deux côtés.

**La sécurité est un périmètre global, pas un filtre par route.** Un compte
`CLIENT` n'a aucune permission, donc `requirePermission` le refuse déjà partout
où il est posé — mais beaucoup de routes ne portent que `authenticate` et lui
seraient ouvertes. `authenticate` refuse donc **par défaut** tout chemin absent
de `CLIENT_ALLOWED_EXACT` / `CLIENT_ALLOWED_PREFIXES` (`/api/portal/*`, plus
`/api/me`, `/api/logout`, `/api/notifications*`, `/api/messages*`). Une liste
blanche, jamais noire : **une route ajoutée demain naît fermée au portail**.
Chaque exception ouverte hors `/api/portal` porte son propre filtrage par
utilisateur.

Les routes du portail prennent le dossier **dans le jeton**, jamais dans un
paramètre : il n'y a aucun `?clientId=` à falsifier.

- `/api/portal/summary` — identité du dossier et situation financière.
- `/api/portal/statement` — le relevé de compte : une ligne par facture ou
  règlement, dans l'ordre chronologique, avec le solde qui court. Le solde
  antérieur ouvre le relevé comme une ligne à part entière. Une facture et son
  règlement le même jour se lisent facture d'abord, sinon le solde plonge puis
  remonte et se lit comme un trop-perçu qui n'a jamais existé. Les chiffres
  sortent des mêmes helpers que la page Clients (`countsAsBilled`,
  `journalEncaissementsByClient`, `sumEncaissements`) : le solde annoncé au
  client et celui du back-office ne peuvent pas diverger.
- `/api/portal/tasks` — l'avancement **sans temps ni coût**. Le filtrage est
  dans la réponse, pas dans l'interface : masquer une colonne côté navigateur
  laisserait `dureeSeconds`/`hourlyRate`/`cost` partir dans le JSON. Les champs
  sont listés un par un — liste blanche, pour qu'un champ sensible ajouté
  demain à l'entrée ne se retrouve pas ici par défaut. Seules les tâches
  `COMPLETED` sont servies.
- `/api/portal/deliverables` — les modèles affectés au dossier, leur
  avancement et leurs items, jamais qui y a passé du temps.

**Les conversations de groupe** ([GroupModal.tsx](src/components/chat/GroupModal.tsx), routes `/api/messages/groups*` et `/api/messages/group/:id`) vivent dans le même module que les messages directs : un groupe est un nom plus une liste de membres, et un message de groupe porte `groupId` au lieu de `toUserId`. Une seule route d'envoi pour les deux — la validation, la diffusion SSE et la notification poussée sont identiques, et les dédoubler aurait fait deux endroits à corriger.

**La lecture d'un message de groupe se note dans `readBy`** (un tableau d'ids), pas dans `readAt` : un message direct a un lecteur, un message de groupe en a N, et les compresser dans un seul horodatage aurait fait passer le fil pour lu dès que le premier membre l'ouvre. Sous Postgres l'ajout se fait en JSONB (`|| to_jsonb(...)`) plutôt qu'en lisant puis réécrivant la ligne, pour que deux membres qui ouvrent le fil au même instant ne s'effacent pas l'un l'autre. L'auteur naît dans `readBy` de son propre message, sinon il se compterait dans ses propres non-lus. La double coche n'apparaît **que** sur un fil direct : dans un groupe « lu » n'a pas de réponse unique.

**Les groupes sont internes au cabinet** : un compte `CLIENT` n'en crée pas, n'en voit aucun, ne peut ni lire ni écrire dans un fil de groupe, et est écarté de la liste des membres même si son id est envoyé. C'est le cas que `isInternal` annonçait depuis le début — dans un fil à plusieurs, l'appartenance au fil ne suffit plus à tenir une note interne hors de portée. Refusé côté serveur, pas seulement absent de l'écran. N'importe quel membre peut renommer le groupe et changer ses membres (c'est une conversation d'équipe, pas la propriété de qui l'a ouverte) ; **supprimer** — qui efface la conversation pour tout le monde — reste au créateur ou à un administrateur, et emporte les messages dans une transaction.

Les fils directs filtrent `!m.groupId` : un message de groupe porte bien un `fromUserId` mais pas de destinataire unique, et sans ce filtre il remontait dans le fil direct de son auteur. Le badge de la barre latérale additionne les deux — un total qui ignore la moitié des conversations ne veut plus rien dire.

**Messagerie : le module existant, pas un second.** Le fil est déjà filtré par
participant. Deux ajouts : la liste de contacts d'un client est réduite aux
comptes du cabinet — sans quoi elle lui rendait **tous** les utilisateurs, les
autres clients compris — et les messages portent `isInternal`, filtré côté
serveur pour un client. Dans le modèle actuel (messages directs à deux) un
échange entre collaborateurs est déjà hors de portée ; le drapeau est là pour
que la règle tienne le jour où un fil accueillera plusieurs personnes.

**Les effets du back-office doivent être éteints à la source.** Un `return`
anticipé dans le rendu n'empêche pas les `useEffect` de tourner — les hooks
s'exécutent avant lui, quelle que soit la branche rendue. Le sondage des
services, le flux SSE du pointage et le battement de présence partaient donc
pour un compte client et se faisaient refuser en 403 en boucle. Ils sont gardés
par `isClientUser` dans App.tsx et par un jeton neutralisé dans
[PresenceContext](src/context/PresenceContext.tsx) — la présence est un outil
interne, un client n'y a pas sa place.

**Pas encore construit**, faute de donnée ou de mécanisme dans l'app : les
rappels d'échéance de paiement à J-7/J-1 (il n'existe aucun balayage
périodique), les notifications par e-mail et leurs préférences par utilisateur
(les notifications in-app existantes s'affichent déjà dans la cloche), et le
téléchargement de documents livrés avec historique de versions — le modèle de
ressource métier ne porte ni fichier ni version.

### Export CSV

Every table screen carries an **Exporter** button: Clients, Pointage, the four HR tabs, Cash (facturation, règlements, brouillard) and the Échéances grid. One implementation for all of them — [exportCsv.ts](src/utils/exportCsv.ts) builds the file, [ExportButton.tsx](src/components/ExportButton.tsx) is the button — because three variants would eventually produce three files that do not open the same way.

Two details decide whether the file opens correctly in the cabinet's Excel, and both are easy to drop:

- **The separator is `;`, not `,`.** In a French locale Excel reads the comma as the decimal separator, so `1 234,500` in a comma-separated file splits across two cells.
- **The file starts with a UTF-8 BOM.** Without it Excel opens it as ANSI and « Échéance » arrives as « Ã‰chÃ©ance ». Numbers go through `csvNumber()`, which emits a comma decimal separator and no thousands separator for the same reason.

**The export is what the screen shows** — the rows after filters, search and sort, not the whole collection. Exporting everything would be a trap: filter on one month, export, and end up with the year without noticing. It follows that the export is a *client-side* operation over the rows already fetched; a screen that paginates server-side exports the page it has, which is the same thing the user is looking at. The button disables itself when there is nothing to export rather than producing an empty file that reads as a bug.

### Filtres de période et pagination (RH)

The four HR tabs — congés, autorisations, prêts, avances — share one implementation, [PeriodPager.tsx](src/components/PeriodPager.tsx): `usePeriodPage()` plus `<PeriodFilter>` and `<PaginationBar>`. Four copies would eventually answer "which month am I looking at" four different ways. Filtering is **year then month**, the order the Brouillard de caisse and the Échéances grid already use, so one gesture works everywhere. The date each tab filters on differs (`startDate`, `date`, `dateGranted`) and is passed in as `dateOf`.

Two things are load-bearing:

- **Call it with its explicit type argument** — `usePeriodPage<LeaveRow>(rows, dateOf)`. Left to inference, the `rows` / `dateOf` pair (the latter usually from a `useCallback`) collapses to `unknown` and the rendered rows lose their type, with the error surfacing in the JSX far from its cause.
- **The pagination bar sits outside the scrolling area and is `shrink-0`**, exactly like the Brouillard's. A `sticky bottom-0` inside the scrolling container is *not* equivalent and was the first attempt: its containing block was the same height as the scrollport, so there was no room to stick and the bar rendered below the fold — measured at y=1093 in an 850px viewport. Making the table the scrolling element (and `min-h-0` on `HRManagement`'s `<main>` and card, since a `flex-1` child cannot shrink below its content without it) is what actually pins it. The bar renders even on a single page — it carries the "X à Y sur Z" count, and a bar that appears and disappears makes the table jump.

### Scale constraints

Sized for **hundreds of clients and dozens of users**. The rules that keep it there — breaking any one of them reintroduces a payload that grows without bound:

- **Nothing unbounded crosses the wire.** `GET /api/time-entries` returns a capped page (`ENTRIES_PAGE_SIZE`, newest first) as `{ data, total }`, and the SSE broadcast sends that same page — never the whole history. The KPI summary carries **aggregates only**: per-task lists come from `/api/kpi/client-tasks` and `/api/kpi/employee-tasks` on expand. Inlining a task list back into the summary took it from 219 KB to 3.2 MB at 300 clients / 6000 entries.
- **Filters live in `filterKpiEntries()`**, shared by the summary and both drill-down endpoints, so a drill-down can never disagree with the row it came from.
- **SSE broadcasts are coalesced** (~120 ms) and built once per role, not per subscriber. Five rapid mutations produce two frames, not five.
- **No linear scans inside per-task loops** — index into a `Map` first (`usersById`, `clientsById`).
- **The client list is never fully loaded.** Both the Clients page and the Pointage autocomplete query the server (`?q=`, `?page=&limit=`); the autocomplete is debounced and asks for 8 rows.
- **`saveDb()` coalesces writes.** Every mutation still rewrites the whole JSON file — that is the real ceiling here. If this outgrows a single file, move to SQLite rather than optimising around it further.

### Console plateforme

La ligne d'une entreprise porte **Modifier** et **Supprimer** — le bouton « Utilisateurs » qui s'y trouvait a bougé *dans* la fiche de modification, il n'a pas disparu.

La ligne porte aussi la **date d'inscription** (`createdAt`) et l'**échéance** :
la fin d'essai tant que rien n'est payé, la fin de l'abonnement ensuite
(`subscriptionEndsAt`, posée à la confirmation à un mois de là — les trois
packs sont mensuels). Une échéance dépassée s'affiche en rouge et **c'est
tout** : rien côté serveur ne la surveille, aucun accès ne se ferme quand elle
passe. Couper l'accès reste une décision prise à la main, par la route dédiée —
une coupure automatique le jour où un virement traîne coûterait un client, et
l'app ne sait pas ce qui a été encaissé. L'échéance se repousse à chaque
règlement depuis la fiche, et c'est là qu'on applique un mois offert gagné par
parrainage. À ne pas confondre avec `trialEndsAt`, qui lui **bloque** la
connexion à son terme (`expireTrialIfDue`) : un essai non payé n'a jamais donné
de droits, un abonnement en cours de renouvellement si.

`PUT /api/platform/companies/:id` travaille sur une **liste blanche** : nom, contact, email, téléphone, secteur, sièges, fin d'essai. `status` et `plan` en sont volontairement absents — ils se changent par la confirmation de paiement, qui porte ses propres effets de bord ; les accepter ici ouvrirait un second chemin capable d'activer un compte sans paiement.

`DELETE /api/platform/companies/:id` supprime **le tenant entier** : `deleteCompany()` purge chaque collection portant un `companyId`, plus `settingsByCompany` (indexé par `id`, que le filtre générique n'attrape pas) et, sous Postgres, `leave_balances` et `settings` qui ont leur propre colonne `company_id` — le tout dans une transaction, une purge à moitié faite laisserait des utilisateurs sans entreprise. `orders` n'est jamais touché : une demande d'accès précède l'entreprise et ne porte pas de `companyId`.

Trois garde-fous, tous côté serveur : `LEGACY_COMPANY_ID` est indestructible et non modifiable depuis cette console ; la requête doit renvoyer le **nom exact** dans `confirmName`, parce qu'une console plateforme s'appelle aussi au curl et qu'une boîte de dialogue du navigateur ne protège rien ; et la suppression est journalisée avec le nom, l'id, le nombre d'utilisateurs et l'auteur.

**Suspendre un accès n'est pas supprimer.** `PUT /api/platform/companies/:id/access` ferme la connexion à toute une entreprise **sans toucher à une seule ligne de données** : la connexion est refusée avec un message distinct de « identifiants invalides », et tout est encore là à la réactivation. C'est une route à part, et non un champ de plus dans le PUT à liste blanche, pour la raison même qui en exclut `status` : réactiver ne doit jamais pouvoir *créer* un abonnement payé. La suspension mémorise le statut d'avant dans `statusBeforeSuspension` et le restaure tel quel — un essai suspendu redevient un essai, jamais un compte actif. À défaut (compte suspendu avant l'existence du champ) le repli est `EXPIRED`, le seul statut qui n'accorde aucun droit non payé. `LEGACY_COMPANY_ID` ne peut pas être suspendue, et la suspension est journalisée.

### Tableau de bord Direction

`POST /api/dashboard/executive` sert les agrégats du bandeau exécutif, des alertes, de la rentabilité par client et de la concentration. Il vit à côté de `/api/kpi/dashboard`, qu'il **ne remplace pas** : les deux sont appelés en parallèle par [AdminDashboard.tsx](src/components/dashboard/AdminDashboard.tsx) avec le même corps de filtres, et l'ancien continue d'alimenter KPICards / ClientBreakdown / DashboardCharts / EmployeeTable.

L'indicateur central est la **marge sur temps** = honoraires facturés − coût employeur du temps passé. Les deux moitiés existaient déjà séparément ; c'est leur croisement qui est neuf, et il ne demande aucun nouveau champ. Trois précautions le rendent honnête, et les retirer produirait un chiffre faux et crédible :

- **Taux historiques.** Le coût d'une tâche vient du `hourlyRate` figé à sa création. Une augmentation de salaire ne re-tarife pas le passé.
- **Les tâches non chiffrées valent `null`, pas zéro.** Elles sont exclues du coût et comptées à part (`tachesSansTaux`), et le bandeau affiche un avertissement : sans lui, une marge calculée sur un coût amputé se lit comme une bonne nouvelle.
- **Le taux de marge est `null` quand rien n'a été facturé**, jamais 0 % ni −100 %. L'interface écrit « n/a ».

Trois règles de périmètre, chacune corrigeant une façon de mentir avec des chiffres justes :

- **Un filtre collaborateur supprime tous les montants** (`financialsFiltered`). Une facture n'a pas d'auteur : comparer les honoraires de tout le monde au coût d'une personne donne une marge spectaculairement fausse. Le serveur ne la calcule pas, et l'interface dit pourquoi.
- **Seule la TND est agrégée.** `currency` est un texte libre ; les autres devises sont exclues et comptées (`devisesExclues`) plutôt que converties à un taux qu'on ne stocke pas.
- **Les créances échues sont un majorant.** Aucun règlement ne porte d'`invoiceId`, donc on ne sait pas si une facture précise est soldée : on somme les factures dont `dueDate` est dépassée (fin de journée), **plafonnées au reste réellement dû par le client**.

La **capacité nette** vient de `regimeHoraire` (volume *hebdomadaire*, 48 h par défaut — la même valeur que le coût horaire multiplie par 4,33 pour un mois), ramenée au jour ouvré et diminuée des congés approuvés. Les jours fériés ne sont pas modélisés : la capacité est donc légèrement surévaluée, ce qui sous-évalue le taux d'occupation. L'info-bulle le dit.

Les **seuils d'alerte** vivent dans `settings.alertThresholds`, avec des valeurs par défaut dans la route — jamais de constante en dur, même règle que les statuts d'échéance et les objets de caisse. Il n'y a pas encore d'écran pour les éditer.

**Le drill-down par client ne crée pas de deuxième chemin.** Cliquer une ligne de « Rentabilité du portefeuille » (ou une alerte client) passe `focusClient` à `ClientBreakdown`, qui filtre sur le nom et déplie la ligne : le détail des tâches par client reste au seul endroit qui le savait déjà faire. Les clés viennent du même `clientBucketKey` côté serveur, donc la ligne visée est exactement celle du bloc d'origine.

**Les administrateurs ont leur ligne dans le tableau de performance — pour un administrateur seulement.** `employees` (l'effectif) reste bâti sur `STAFF_ROLES` : un administrateur est un compte, pas une tête à compter, et le faire entrer dans « Effectif » changerait un chiffre déjà en place. Mais il pointe du temps comme les autres, et ce temps entrait dans les totaux globaux sans qu'aucune ligne ne dise qui l'avait fait. `performanceUsers` ajoute donc les ADMIN, **uniquement quand le lecteur est lui-même ADMIN** : « les tâches d'un administrateur ne sont pas montrées aux autres » vaut ici comme dans Pointage, sans quoi un SUPERVISEUR lirait dans ce tableau ce que `visibleEntriesFor()` lui refuse à l'écran d'à côté. La règle est reprise aux deux autres bouts du chemin : `/api/kpi/employee-tasks` refuse le drill-down sur un ADMIN à un non-admin (la route s'appelle avec un `userId` quelconque — le refus appartient au serveur, pas à l'absence de bouton), et `/api/kpi/users/search` ne propose les administrateurs qu'à un administrateur.

**Le temps non facturable est affiché, pas seulement calculé.** `heuresNonFacturables` existait déjà ; s'y ajoutent `tachesNonFacturables` et `clientsNonFacturables` — « 12 tâches » se relie à ce que Pointage montre là où « 30 h » ne se retrouve dans aucune liste. Le chiffre vit dans le **pied de la carte « Heures produites »** plutôt que dans une huitième carte : c'est un sous-ensemble de ces heures, pas une mesure de plus, et le bandeau tient à sept cartes pour rester lisible d'un coup d'œil. Le coût correspondant (`coutNonFacturable`) apparaît dans un bandeau sous les cartes et **seulement pour un ADMIN**, comme tout montant. Quand les tâches concernées n'ont pas de taux, ce coût vaut 0 et le bandeau ne s'affiche pas : l'avertissement `tachesSansTaux` dit déjà pourquoi, et inventer un coût serait exactement ce que la règle des taux interdit.

**Le filtre par année** est le raccourci d'un cran au-dessus du filtre par mois : il écrit dans les mêmes `startDate`/`endDate` que la plage libre Du/Au, plafonne la fin à aujourd'hui, et se désélectionne dès qu'on touche un mois ou une date — il ne cherche pas à refléter une plage quelconque, pas plus que celui par mois.

**Ce qui n'est délibérément pas construit**, faute de donnée ou de règle tranchée : heures facturables, taux d'utilisation et valeur produite (il n'existe ni indicateur `facturable` ni tarif de vente) ; travail non facturé (rien ne relie une tâche à une facture) ; dépassement de budget (aucun budget stocké) ; écart aux objectifs (aucune cible stockée) ; prévision de trésorerie. Ces manques sont documentés dans la spécification fonctionnelle, pas comblés par des hypothèses.

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

### Le serveur ne lit jamais l'heure de sa machine

`getHours()` / `getDate()` rendent l'heure locale **du processus**. En
production le conteneur tourne en UTC : une tâche démarrée à 08h42 à Tunis
était donc enregistrée « 07:42 », et le pointage de présence comptait 13
minutes d'avance là où il y avait 47 minutes de retard.

Toute date ou heure **civile** que le serveur estampille passe par
`civilParts()` et ses dérivés (`formatDateFR`, `formatTimeFR`, `formatDateISO`,
`isoDaysAgo`, `minutesFromShift`), qui nomment le fuseau explicitement —
`APP_TIMEZONE`, `Africa/Tunis` par défaut, surchargeable par l'environnement et
validé au démarrage (un fuseau inconnu ferait lever `Intl` : on retombe sur
Tunis en le disant). C'est la contrepartie de « le serveur possède `date`,
`heureDebut` et `heureFin` » : posséder l'horloge, c'est aussi posséder le
fuseau, et le `TZ` de la machine ne doit rien changer au résultat.

Deux distinctions à garder :

- Un **instant** (`createdAt`, `checkinAt`, `lastStartedAt`…) reste en ISO/UTC
  et se rend dans le fuseau du lecteur par le navigateur. C'est une date
  civile — « quel jour, quelle heure murale » — qui a besoin du fuseau du
  cabinet, parce qu'elle sert de clé (`date` d'une entrée, jour du pointage) ou
  se compare à un horaire saisi en heure murale.
**Rattraper l'historique** : `npm run db:fix-timezone -- --before "<instant ISO>"` ([scripts/fix-timezone-history.ts](scripts/fix-timezone-history.ts)), l'instant étant la mise en service du correctif. Sans `--apply` il ne fait que lister. Deux traitements, parce que les deux familles n'offrent pas la même matière : le **pointage de présence** porte `checkinAt`/`checkoutAt`, de vrais instants, donc le jour et le retard sont **recalculés** — idempotent par construction ; une **entrée de temps** ne porte aucun instant de création (`lastStartedAt` est réécrit à chaque reprise), donc elle est **décalée**, ce qui n'est pas idempotent — d'où la coupure obligatoire et une marque `tzFixedAt` par ligne, qu'une seconde exécution respecte. Le décalage est calculé pour la date de chaque ligne, jamais « +1 h » en dur. `dateGranted` d'un prêt ou d'une avance n'est délibérément pas touché : la valeur par défaut était fausse une heure par jour, mais elle peut aussi avoir été saisie à la main et rien ne distingue les deux.

- `minutesFromShift()` compare des **heures murales**, pas des instants :
  `setHours()` posait la borne dans le fuseau du processus. Le filtre par
  période, lui, reste en UTC de bout en bout (`parseFrenchDateTs` et les bornes
  du corps de requête mappent toutes deux une date civile sur minuit UTC), donc
  le décalage s'y annule — ne pas « corriger » ce round-trip.

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
