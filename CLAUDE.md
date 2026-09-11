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

Seeded logins (created on first boot, see [database.ts:52-99](src/server/database.ts#L52-L99)): `admin` / `admin123` (ADMIN) and `collab` / `collab123` (COLLABORATOR). [Login.tsx](src/pages/Login.tsx) used to print both right under the form for convenience — removed at the user's request, since a production deployment shows the exact same screen and printing working credentials on a public login page is a real credential leak, not a demo convenience.

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

**The one deliberate exception is a manual correction from [EditTaskModal.tsx](src/components/EditTaskModal.tsx) ("Modifier"), and it now updates `dureeSeconds` (and therefore the cost, which is derived from it at every read) to match.** Retyping the start and/or end time used to be cosmetic — the table kept showing whatever duration/cost had already accumulated, so correcting an entry's hours looked like the Enregistrer button did nothing. `PUT /api/time-entries/:id` now detects a genuine edit by comparing the incoming `heureDebut`/`heureFin` against the stored values (`heureDebutChanged`/`heureFinChanged`), never by their mere presence in the body — the modal always resends both, touched or not, since it starts from a copy of the whole entry, and recomputing on every save (rather than only on an actual change) would have overwritten a task's real accumulated duration with its wall-clock span just for being marked "Terminée" without editing its hours. Those two are deliberately not the same measure: a task paused and resumed several times has a `heureDebut`→`heureFin` gap wider than the time it was actually worked, since the gap includes every pause. So the recompute (`(finMinutes − debutMinutes) × 60`, both parsed from `HH:MM`) only fires when at least one of the two fields actually changed, and only when both resolve to a valid time with the end after the start — a still-`RUNNING` task's blank `heureFin` or a reversed pair leaves `dureeSeconds` untouched rather than writing a negative or invented number.

`EditTaskModal`'s Statut `<select>` was also missing a `PAUSED` option — opening "Modifier" on a paused task left the field's React state correctly at `'PAUSED'`, but a controlled `<select>` with no matching `<option>` falls back to showing the *first* option as selected, `Terminée`. That read as "the task is already set to Terminée" when nothing had actually been chosen yet: saving without touching the dropdown sent the unchanged `PAUSED` status, which is what made an edit look like it silently did nothing. `PAUSED` (« En pause ») is now a real option, so the dropdown shows what the task actually is until the admin deliberately picks something else.

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

**[PausedTasksList.tsx](src/components/PausedTasksList.tsx) — "Tâches en pause" on Pointage — carries its own client-name search**, shown only past one entry (`entries.length > 1`; a single paused task needs no filter). It is a self-contained live filter over `myPausedEntries` (the caller's own PAUSED entries, already in memory — no network round-trip), not `SearchableSelect`: that component picks *one* option and writes it into a form field, closing on selection, whereas this narrows a list of *rows* as you type and has no "selected value" to hold. Typing folds accents the same way (`fold()`, duplicated locally rather than imported — the app's other accent-folding filters, the Échéances vocabulary picker included, each keep their own copy too) and matches anywhere in the client name, not just its start. A dropdown beneath the field lists the distinct client names still matching (derived from `entries`, deduplicated) — click one to fill the field exactly rather than retype it. An empty result shows "Aucune tâche en pause ne correspond à « … »" rather than silently emptying the card, so a stray character doesn't read as every paused task having vanished.

**The overtime alert fires on the task's own duration — at 2h, then 4h, 6h, …** ([App.tsx](src/App.tsx)). Once a running task crosses a 2h milestone it prompts "Toujours sur cette tâche ?"; no answer within the 2-minute grace pauses it automatically.

The milestone already asked about is recorded **on the entry** (`overtimeAckCycle`: 1 once asked at 2h, 2 at 4h, …), written when the popup is *shown* rather than when it is answered, so a reload while it is open does not bring it back. Keeping it on the entry rather than in the browser is what makes "every 2h" mean what it says: it survives a reload, it follows the task rather than the device (answering on a phone doesn't leave a laptop asking about the same 2h), and it tracks the work rather than the clock — a prompt lands when the task actually reaches 4h, not merely because two hours have passed since the last one.

Two earlier versions were wrong, both in ways that showed up as "the popup comes every time I open the app". A `useRef` of the milestone died on every remount, and since `dureeSeconds` is **accumulated, not continuous**, a task that had ever passed 2h was past it forever — so every page load re-fired it. Replacing that with a persisted *wall-clock* gap between prompts fixed the reload case but answered the wrong question: it asked "has it been 2h since I last asked", not "has this task done another 2h". Don't reintroduce either — the record has to be per-task, persisted, and keyed on duration.

A third bug showed up the opposite way: "the popup never comes at 2h, only at 4h". The check used to compare against **whichever milestone the duration currently sits at** (`Math.floor(dureeSeconds / 7200)`), not the next one still owed. That is indistinguishable from correct as long as the tab is watched continuously — the 1s local tick walks `dureeSeconds` through every value on the way up, so the effect always catches the milestone the moment it's crossed. But the detection is entirely client-driven, and a backgrounded tab throttles that tick (or a laptop gets closed mid-task); the next time the effect actually runs, `dureeSeconds` can have jumped straight from under 2h to past 4h in one observation. Asking about "the current cycle" in that case means the 2h prompt is never asked at all — it fires once, for 4h, and the 2h milestone is marked acknowledged as a side effect of setting `overtimeAckCycle` straight to 2. The fix asks for `(overtimeAckCycle || 0) + 1` instead — the next *unacknowledged* milestone — and only advances one at a time: a duration that already cleared two milestones gets two prompts, 2h then 4h, the second firing on the very next tick after the first is answered, not one prompt that silently absorbs both. The modal's own "depuis plus de Nh" label follows the same rule (reads `overtimeAckCycle`, not the raw duration) for the same reason — the two only diverge during catch-up, and it's exactly then that showing the duration's own cycle would repeat the bug in the label even with the counting fixed.

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

Default charge percentages come from `defaultSettings()` in [src/server/db-types.ts](src/server/db-types.ts) — CNSS **17.07%**, TFP 2%, FOPROLOS 1% (the rates a Tunisian services provider actually pays), accident du travail 0.5%.

**CNSS patronale used to default to 16.57% and was corrected to 17.07%.** `defaultSettings()` is only a seed for a brand-new company, so the code-level fix alone never touched an already-persisted settings row or a user row that already had its own explicit `cnss` saved — either one keeps the old value forever otherwise, since `employerHourlyRate()` prefers a stored value over the default at every read. Both engines carry a one-time, idempotent backfill run on every boot ([database.ts](src/server/database.ts) for the JSON file, [db-postgres.ts](src/server/db-postgres.ts) for Postgres): a settings row or a user still sitting at *exactly* the old hardcoded `16.57` is bumped to `17.07` — the same "recover a legacy shape" reasoning as `normalizeBalance()`. A company or collaborator with a genuinely different, deliberately-typed rate is untouched, since the check only matches the literal old default.

**Cost configuration lives only in the user form** ([UsersManagement.tsx](src/components/UsersManagement.tsx)). There is deliberately no Settings page: it was removed so there is exactly one place to reason about employer cost. `GET /api/settings` survives purely to seed that form's defaults — don't rebuild a global settings UI on top of it, and keep the form's `?? 2.0` style fallbacks in step with `defaultSettings()`.

### Gestion des paies

A monthly payslip (bulletin de paie) per (employee, year, month), generated from the "Gestion des paies" nav item ([PayrollManagement.tsx](src/components/payroll/PayrollManagement.tsx)), gated on `VIEW_PAYROLL` (read/print) / `MANAGE_PAYROLL` (generate/edit/delete) — its own permission group, not folded into `MANAGE_USERS`: a cabinet may want its accountant to print bulletins without being able to touch the Équipe roster. Reproduces the cabinet's own "Modèle de fiche de paie" template and its accompanying Excel cahier des charges (progressive IRPP barème, CNSS salariale, CSS LF2018, abattement forfaitaire, déductions communes) — both supplied by the user, not invented.

**`computePayslip()` in [server.ts](server.ts) is the single implementation of the calculation** — the same "one cascade, not N copies that drift" rule as `computeInvoiceTotals()`. `POST /api/payslips/preview` (no write) and `POST`/`PUT /api/payslips` (write) all call it, so a saved bulletin can never show a figure the preview hadn't already shown, and the client carries no second copy of the tax logic — the generation modal's "Calculer l'aperçu" button is a round-trip to the server, not a local mirror.

**« Salaire de base » comes from the Équipe fiche, not from a rate × hours.** `user.salaireBrut` (the existing monthly-gross field the employer-cost calculation already reads) prefills the bulletin's gains line the moment a collaborator is picked in the generator — this was the explicit ask, over deriving it from `salHeure`. It stays editable per bulletin without touching the employee's own record: a month can differ (an unpaid day, an avenant) without rewriting the reference salary. `salHeure` (one of the twelve "Gestion des paies" fields on the Équipe form — see below) is still snapshotted and still used, but only for the "Jours fériés" line.

**« Jours fériés » is chiffré at 8h/jour × `salHeure`** — an assumption, not a rule from the cahier des charges: the template gives no formula for that line, and 8h is what exactly reproduces the sample bulletin's own worked example (1 jour × 8h × 4,783 DT/h = 38,264, the printed value). Every other gains line (primes de présence/transport/encouragement) is a plain amount typed by the admin — inventing a proration formula the source documents don't give would be exactly the "un chiffre faux et crédible" trap `isTnd()`/`countsAsBilled()` exist to avoid elsewhere in this app.

**`nombreMois` (admin-entered, default 12) is not a contract duration — it's what the bulletin's gross salary is annualized over for the progressive brackets.** IRPP and CSS are bracket-based on an *annual* taxable base; computing that base from this month's own fluctuating gains (primes vary, a short month happens) would make the withholding see-saw month to month, which is not how a payslip's retenue à la source is supposed to behave. So the annual reference is `salaireBrutImposable(this bulletin) × nombreMois` — stable, and exactly what the Excel's own Annuel/Mensuel columns describe once accounted for `salaireBrut` being monthly-first in this app rather than annual-first like the spreadsheet. CNSS itself is *not* annualized — it is a flat rate on the actual monthly brut, per the cahier des charges' own `Retenue CNSS = (5) × (6)` at both granularities.

**That flat annualization silently assumes a constant salary all year — wrong the moment a collaborator's pay changes mid-year, and the Tunisian système fiscal has an actual answer for that case: progressive regularization.** The retenue à la source isn't a fixed monthly slice of a guessed annual figure; each bulletin recomputes the tax owed on *real* cumulative income since January and withholds only the gap against what was already taken. `computePayslip()` switches to this automatically whenever a **prior bulletin exists for the same collaborator, the same year** (`cumulAnterieur`, built by `buildPayslipDraft()`/`cumulAnterieurFor()` in server.ts from `db.getAllPayslips()`, filtered to `month < ce mois`) — the first bulletin of the year for someone falls back to the old flat `nombreMois` calc, for lack of any history to cumulate. For bulletin **M** (the collaborator's Mᵉ bulletin of the year): cumulative real income = sum of prior `salaireBrutImposable` + this month's; annualized = cumulative × 12 / M (replacing `salaireBrutImposable × nombreMois`); abattement/déductions/barème run exactly as before on that new base; tax owed for the elapsed period = annual IRPP estimate × M / 12; this month's retenue = that owed figure minus what prior bulletins already withheld (`cumulAnterieur.irppRetenu`) — the regularization. CSS follows the identical mechanism against `cumulAnterieur.cssRetenue`, since it's computed off the same annualized base. A negative result (pay dropped, and the cumulative already withheld now exceeds what's actually due) is clamped to 0 rather than issuing a negative retenue on the bulletin — an overpayment like that is a case for the annual tax return, not a refund printed on a payslip.

**This doesn't need to detect "did the salary change" as a separate branch, because the cumulative formula generalizes the flat one exactly.** With a constant salary, cumulative income at month M is `salaire × M`, so the annualized base is `salaire × M × 12 / M = salaire × 12` — identical to the flat calc with `nombreMois = 12`, every month, so the annual IRPP estimate never moves and the regularization never has anything to correct. That's what lets `computePayslip()` always use the cumulative path once history exists, rather than maintaining two calculations that could drift — same principle as `computeInvoiceTotals()` having one cascade, not N.

**Verified against the reported case**: 1 000 DT/mois de janvier à avril, puis 1 500 DT/mois en mai-juin. Fin mai: cumul réel `4 000 + 1 500 = 5 500` sur 5 bulletins → annualisé `5 500 × 12 / 5 = 13 200`. Fin juin: cumul réel `5 500 + 1 500 = 7 000` sur 6 bulletins → annualisé `7 000 × 12 / 6 = 14 000`. Both figures match a hand-worked example of the same scenario exactly, and generating that exact sequence through `POST /api/payslips` reproduces them (`imposableIrppAnnuel: 11880` in May and `12600` in June, after abattement) — a flat `nombreMois`-based calc would instead have extrapolated May's own 1 500 DT rate across all twelve months (`18 000`), overstating the year for the four months actually paid at 1 000.

**The generation modal surfaces this rather than leaving the switch invisible.** `Payslip`/the preview response carry `regularisationProgressive` plus the three cumul figures (`cumulAnterieurImposable`/`Irpp`/`Css`); [PayrollManagement.tsx](src/components/payroll/PayrollManagement.tsx) shows an indigo banner above the preview breakdown naming the prior bulletin count and cumul when it applies, and the "Nombre de mois" field's helper text says the field is ignored this time instead of silently doing nothing — a field that visibly does nothing is worse than one that says so. Editing a saved bulletin (`PUT /api/payslips/:id`) re-reads the cumul at edit time rather than reusing whatever was true at generation, for the same reason it already re-runs `computePayslip()` on every edit: the point is that a saved figure can never disagree with what the current inputs justify.

**The IRPP barème (`IRPP_BRACKETS`) is hardcoded from the cahier des charges Excel** — 0% to 5 000 DT, 15% to 10 000, 25% to 20 000, 30% to 30 000, 33% to 40 000, 36% to 50 000, 38% to 70 000, 40% beyond — applied progressively (`irppAnnuel()`): each bracket taxes only the slice of income that falls in it. CSS is a flat 0.5% on the same rounded-up taxable base as IRPP (`imposableIrppArrondi`, `Math.ceil` of the annual taxable income) — verified against the Excel's own worked example, not assumed. The abattement forfaitaire is 10% of the taxable base, capped at 2 000 DT/an.

**Déductions communes now cover the barème's full family-quotient table, via `deductionsCommunesAnnuelles()` in server.ts** — Marié(e) (300 DT/an, derived from the existing free-text `situationFamiliale` field — a case-insensitive match on "mari…" — rather than a separate checkbox: `situationFamiliale` already says whether someone is married, on the very same form, and a second field for the identical fact would have been the same information typed twice, one copy of which could drift from the other), Nombre d'enfants (`nombreEnfants`, 100/200/300/400 DT/an, capped at 4), Enfants infirmes/handicapés (`paieEnfantsInfirmes`, 2 000 DT/an **per child, no cap on count**), Enfants étudiants non boursiers <25 ans (`paieEnfantsEtudiants`, 1 000 DT/an per child, **capped at 4**), Parents à charge (`paieParentsACharge`, 0/1/2, each min(5% of a reference base, 450 DT/an)), Assurance vie and Compte épargne en actions (`paieAssuranceVie`/`paieCEA`, plain amounts each capped at 100 000 DT/an). "Ajouter déduction" — the Tableau's own open-ended extra-deduction row with no worked example and no fixed rule — is deliberately not built, same "not built, not guessed" line as the rest of this app's deferred scope.

**The IRPP barème above was verified line-by-line against the cabinet's own "Barème de l'Impôt sur le Revenu" sheet** — its eight tranches (0 % to 5 000 DT, 15 % to 10 000, 25 % to 20 000, 30 % to 30 000, 33 % to 40 000, 36 % to 50 000, 38 % to 70 000, 40 % beyond) match `IRPP_BRACKETS` exactly, threshold for threshold and rate for rate; no code change was needed there, since the two were already identical.

**Parents à charge's own formula (`Min((11) × 5%, 450)`) is circular as written** — "(11)" is the taxable base *after* déductions communes, and parents à charge is itself one of those déductions. Read literally it would require the total to compute one of its own parts. `deductionsCommunesAnnuelles()` resolves this by computing the 5% on `baseAvantDeductionsCommunes` — the annual taxable base after the abattement forfaitaire but **before** any déduction commune (including parents à charge itself) — a deliberate, documented interpretation rather than a literal transcription, since the Excel's own worked example doesn't exercise this case to disambiguate it.

**The fields live on the Équipe user form**, grouped in a collapsible "Gestion des paies" section (chevron toggle, own `useState`, collapsed by default — the same idiom the dashboard's five collapsible cards and the permission groups just below it already use) gated `formRole !== CLIENT_ROLE`: matricule, n° CIN, n° CNSS, qualification, département, banque/poste, numéro de compte, situation familiale, catégorie, échelon, salaire/heure — eleven purely-declarative dossier fields, none of which feed `employerHourlyRate()` or the pointage gate, only the bulletin. `nombreEnfants` used to sit here too but moved to "Paramètres de la paie" below (see next paragraph) — unlike the other eleven, it was never purely declarative: it has fed the enfants-à-charge deduction tier since before this section existed, so leaving it in the dossier-only group implied it did nothing to the calculation, which was never true. The modal widened from `max-w-md` to `max-w-2xl` to hold the two-column grid these fields need — a single column would have made an already long form scroll far past what a password/role/coût-employeur form used to require.

**A second collapsible section, "Paramètres de la paie", sits right below "Gestion des paies"** on the same form, same chevron idiom, own `useState`, collapsed by default, same `formRole !== CLIENT_ROLE` gate — the six déductions communes inputs above: `nombreEnfants` (moved here from "Gestion des paies", since it is a déduction parameter, not a dossier fact — see above), `paieEnfantsInfirmes`, `paieEnfantsEtudiants`, `paieParentsACharge` as a 0/1/2 `<select>`, `paieAssuranceVie`, `paieCEA` — each carrying its exact rule/cap as helper text so the admin never has to guess what a field does from its name alone. There is deliberately no "Marié(e)" input here: a note at the top of the section says the 300 DT/an deduction reads `situationFamiliale` in "Gestion des paies" instead, and that field's own helper text points back the other way — so the dependency is visible from wherever the admin happens to look first. The modal widened again, `max-w-2xl` → `max-w-4xl`, to keep the two-column grid legible with two stacked payroll sections instead of one.

**A bulletin snapshots the employee's payroll identity *and* payroll deduction parameters at generation time** — matricule, CIN, CNSS, qualification, département, banque, compte, situation familiale, nombre d'enfants, catégorie, échelon, salHeure, plus the six `paieXxx` fields — the same "copie figée" rule the mission/task-type snapshot on time entries and the client-flag snapshot on invoices already follow: correcting an employee's CIN, or their marital status, in Équipe next year must not silently rewrite a bulletin already handed out. Editing a saved bulletin (`PUT /api/payslips/:id`) only ever touches the editable gains/rates and re-runs `computePayslip()` against its own stored snapshot, never re-reads the employee row — a bulletin's year/month/employee are fixed at creation, like an invoice's number; regenerate rather than reassign. Creating a second bulletin for the same (employee, year, month) is refused server-side.

**`GET /api/payroll/employees` is a liste blanche projection**, not the full user row — id, username, role, and the payroll-relevant fields only (the eleven dossier fields plus `nombreEnfants` and the five other `paieXxx` déduction params), never permissions or the rest of the coût-employeur block, so a `VIEW_PAYROLL` holder without `MANAGE_USERS` can still pick an employee and see their payroll identity without being handed the whole Équipe fiche. `GET /api/payroll/company` reuses the exact same issuer identity as Cash (`companyBlock(getSettings())`) rather than a second copy — it is company identity, not invoicing-specific — behind its own `VIEW_PAYROLL` gate so a payroll-only viewer isn't forced through `VIEW_CASH` to print a bulletin's header.

**[payslipPdf.ts](src/components/payroll/payslipPdf.ts) draws the bulletin with jsPDF text primitives**, the same "real vector text, one renderer for download and print" rule [invoicePdf.ts](src/components/cash/invoicePdf.ts) already follows — reusing its `CompanyBlock` type and the print-via-hidden-iframe pattern rather than inventing a second one. **It reproduces the cabinet's own template literally, not a restyled adaptation of it**: a bordered Excel-style grid throughout (every cell its own bordered rect via a shared `box()` helper — never a separate divider line drawn on top of already-bordered cells, which the first version did and which crossed straight through "COMPTE BANQ / POSTE"'s text), plain black text and thin borders everywhere except the navy "BULLETIN DE PAIE" title, no filled dark header bars or colour-coded cards like the rest of this app's PDFs use. The identity grid matches the model's own row/column merges exactly — NOM ET PRENOM and the BANQUE/COMPTE BANQ POSTE row each span the full row width instead of splitting into a label/value pair, since that's what the model does. The RUBRIQUES table's TAUX column holds plain numbers as the model types them (`176`, `6.99`, `0.5`) — **never run through `money()`**, which forces a comma and three decimals and turned "6.99" into "6,990"; only GAINS/RETENUES are money-formatted. Every row prints at the same plain weight the model uses — no bolding on SALAIRE BRUTE/BRUTE IMPOSABLE/NET — except the header row and the final SALAIRE NET A PAYER row, which merges RUBRIQUES+TAUX into the label and GAINS+RETENUES into the amount, matching the model's own merge there.

**Nb Heures, N Heures, J.Congés, J.Absences and Solde Congé are purely informational** — admin-typed numbers printed on the bulletin's footer strip, exactly as the template has them, entering no calculation. `Jours fériés` is the one exception: the same number both prices the "Jours fériés" gains line and prints in the footer, since the template shows the identical figure in both places.

**This page no longer has its own nav entry — it is now the "Paie" tab of GRH & Paie**, merged into `HRManagement.tsx` at the user's request. See "GRH & Paie merges RH and Payroll" under "Navigation has no router" for the merge itself (the `embedded` prop `PayrollManagement.tsx` takes, the `canViewHr`/`canViewPayroll` split, why either `VIEW_HR` or `VIEW_PAYROLL` alone now reaches the page). Everything on this page described above — `computePayslip()`, the snapshot rules, the PDF renderer — is completely unchanged; only where the page is mounted moved.

### Presence (actif / absent / inactif)

Three states, defined in [src/constants/presence.ts](src/constants/presence.ts) and shared by both sides: **ACTIVE** (mouse or keyboard in use), **AWAY** (no input for `AWAY_AFTER_MS`, 10 min), **INACTIVE** (no heartbeat for `OFFLINE_AFTER_MS`, ~95 s — tab closed, logged out, or machine off).

**The server decides the state; the client only reports how long it has been idle.** A browser cannot report that its own machine is off — that is only observable here as heartbeats that stopped arriving, so `presenceStateOf()` derives all three from `lastSeenAt` + `lastActivityAt`. Never let a client declare its own status.

Presence is held in a **module-level `Map`, never in the JSON database**. Every user heartbeats every 30 s and each write rewrites the whole database file — persisting it would be the single heaviest thing the server does. Losing it on restart is correct: everyone shows inactive until their next heartbeat.

[PresenceContext](src/context/PresenceContext.tsx) tracks real input events, heartbeats on an interval, beats **immediately** when returning from away (the one transition that must feel instant), and fires a `keepalive` offline beacon on `pagehide`/logout so a closed tab doesn't linger for 95 s. Your own badge reads from local state rather than the poll, so it flips the moment you touch the mouse.

**The away delay is configurable; the inactive one is not.** It defaults to **30 minutes** and is set on the Users page ([PresenceSettingsCard](src/components/PresenceSettingsCard.tsx)) behind `MANAGE_PRESENCE_SETTINGS`, stored on settings as `awayAfterMinutes`, and served by `GET /api/presence/settings` (readable by anyone — the browser needs it for its own badge) / `PUT` (permission-gated, clamped to 1–480). The server caches it for 10 s rather than re-reading the database on every heartbeat from every user.

**Le battement rapporte aussi le type de poste.** `deviceFromRequest()` — le même helper qui estampille les tâches — est relu à *chaque* battement et rangé dans l'entrée de présence : quelqu'un qui passe de son poste à son téléphone change d'icône, au lieu de garder celle de sa première connexion. Le poste retombe à `null` en même temps que `idleMs` dès l'état INACTIVE : « était sur son téléphone » n'apprend rien sur quelqu'un dont on ne sait plus rien, et se lirait comme une information à jour. Comme le badge du pointage, c'est auto-déclaré par le navigateur et falsifiable — ça se lit, ça ne décide de rien — et l'icône n'apparaît **que lorsqu'un téléphone est en jeu**, le poste fixe étant le cas ordinaire.

Dans la **messagerie**, la présence (pastille + téléphone, et l'info-bulle qui détaille) est affichée sur l'avatar de chaque contact et dans l'en-tête d'un fil direct, **réservée à l'administrateur** — c'est une information d'encadrement, et un compte portail la verrait de toute façon fausse puisque `PresenceContext` neutralise son jeton.

`OFFLINE_AFTER_MS` stays a constant and must remain comfortably above three heartbeats — tightening it makes users flicker offline on one dropped request. That is why only the *away* threshold is exposed: it is derived from missing heartbeats, not from reported idleness.

**A heartbeat's `lastActivityAt` never moves backward.** `POST /api/presence` used to overwrite the in-memory record unconditionally on every beat — but the same account can be heartbeating from more than one browser tab at once (a forgotten background tab next to the one actually in use), each with its own independently-timed `setInterval`, and nothing guarantees their requests land at the server in the order they were sent. A stale tab's heartbeat (a large, growing `idleMs`) arriving just after the active tab's (`idleMs` near 0) overwrote the freshly-recorded activity with an older one — someone genuinely at their keyboard would flip to `AWAY` because of a tab they weren't even looking at. This read as "I'm working on my PC and it says Absent." The fix takes `Math.max(existing.lastActivityAt, now - idleMs)` instead of assigning outright: the record only ever advances to the most recent *known* activity, and a heartbeat reporting an older one is silently ignored rather than regressing it. `lastSeenAt` still gets a plain overwrite on every beat — "still connected" is a fact about *this* request, not something to take the max of.

**An approved leave overrides the badge, not the state.** `GET /api/presence` also returns `onLeaveUntil` per user — the last day of an `APPROVED` leave request that covers today (server's own civil date via `formatDateISO`, same rule as everywhere else timestamps get compared), or `null`. This is not a fourth presence state: `presenceStateOf()` is untouched, and someone on leave who still opens the app keeps ticking ACTIVE/AWAY underneath — the leave is a separate fact, computed from `getAllLeaveRequests()` in the same route rather than folded into the heartbeat map. `PresenceBadge.tsx` is where the two are reconciled: when `onLeaveUntil` is set it takes over the whole badge (a palm-tree icon, a muted "En congé" pill reusing the `pause` status-pill tokens — deliberately not a new hex, and not `late`/`run` which already mean something else) instead of showing next to actif/absent/inactif, because "on leave, but heartbeats say inactive since the 3rd" is not two facts worth showing at once. The tooltip carries the return date (`de retour le DD/MM/YYYY`, formatted by splitting the ISO string rather than through `Date`/`toLocaleDateString` — a bare `YYYY-MM-DD` has no time of its own, and letting the browser reinterpret it in local time is exactly the class of bug `civilDateKeyTN` already documents elsewhere). Wired at the same four call sites presence already reaches: Équipe, Pointage's Collaborateur column, Messages (admin-only, same gate as presence itself), and the dashboard's performance table.

### Cash (facturation)

Implements workflow #1 of the cahier des charges (`Facturation-Tous-les-types-de-facture-Tâches-Cash.xlsx`). Three selectors drive the form: **type de document** (facture légale / autre), **mode de facturation** (forfait hides Quantité & PU; détaillée derives the amount from Qté × PU), **régime de TVA** (droit commun / suspension → no VAT).

`computeInvoiceTotals()` in [server.ts](server.ts) is the **only** implementation of the numbered cascade — `(3)=(1)+(2)`, `(5)=(3)×(4)`, `(7)=(3)-(5)+(6)`, `(10)=(7)+(8)-(9)`. The editor mirrors it for live preview, but the stored document always takes the server's figures, so a saved document can't disagree with its own lines. Money is rounded to 3 decimals (millimes) at each step.

Numbering splits by document kind. A **facture légale** takes the next value of the legal sequence (`nextInvoiceNumber()`), which is never reassigned on edit. **Numbering and chronology must agree**: `legalSequenceDateError()` is the single implementation, called on create *and* on edit — editing skipped it entirely, so an invoice created in order could be moved to any date afterwards. It checks **both** neighbours by number: a new invoice is always last so it only has a predecessor, but an edited one sits mid-sequence and moving n° 2 past n° 3 breaks the ordering just as much as moving it before n° 1. Two invoices **may share a date** — only going backwards is refused. An **autre document** carries a free reference typed by the user: it does not follow the sequence, deliberately does not consume a number from it (that would punch gaps in the legal numbering), is exempt from the date rule, and may be corrected later. Both kinds reject a duplicate number. All of it is enforced server-side — a client-supplied number on a legal invoice is ignored.

**`countsAsBilled(inv)` in [server.ts](server.ts) is the single definition of « ce document compte comme des honoraires »** — `documentKind !== 'AUTRE_NON_FACTURABLE' && status !== 'DRAFT'`. It replaced five scattered copies of the same two conditions, in the client ledger, the batched `GET /api/clients`, the KPI dashboard and the executive endpoint: three screens that all claim to show the same figure, so a rule spelled out five times is a rule that will eventually disagree with itself. Anything new that sums invoices goes through it.

**`isTnd(inv)` is `countsAsBilled`'s companion guard, for the same reason.** `currency` is free text with no stored exchange rate, so summing `totalNetToPay` across documents in different currencies produces a number that is neither TND nor any other currency — plausible-looking and wrong. The executive dashboard's own "Grand-livre client" already excluded non-TND invoices this way; `enrichClientLedger()`, the batched `GET /api/clients` list (and its "Total Général" row), `/api/kpi/dashboard`'s per-client block, and the client portal's `/api/portal/summary`/`/api/portal/statement` did not, so a client with even one foreign-currency document showed a "Montant de facture" on the Clients page that silently included GBP or USD amounts as if they were dinars — visibly disagreeing with Facturation's own per-currency Total Général, which has always kept the three currencies apart. All five now filter through the same `isTnd()` before summing, so a client's ledger total is always TND-only, matching Facturation.

**A foreign-currency invoice isn't dropped from the Clients page, just kept out of the TND total.** `enrichClientLedger()` and the batched `GET /api/clients` list also build `montantFactureDevises` — the same per-client sum as `montantFacture`, but keyed by every currency the client was actually billed in (TND included, so the screen has one field to read). `ClientsManagement.tsx`'s `montantFacture` cell shows the TND figure as before, with a small line per other currency underneath (`otherCurrencies()`, alphabetical so the order doesn't reshuffle as documents come and go) — same treatment on the "Total Général" row, summed the same way across every client matching the current filters. The View Drawer's "Facturation par devise" section is the fuller version of the same data, one row per currency, and only renders when there's a non-TND amount to show. `montantFactureDevises` is stripped by `stripLedger()` like every other money field — `VIEW_CLIENT_FINANCIALS` gates it exactly like `montantFacture`. `/api/kpi/dashboard` and the portal routes were deliberately left TND-only: this breakdown answers "what did the Clients page hide," and only the Clients page hides anything here.

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

**Both the Brouillard de caisse and Règlements clients tables show the most recently added row first.** `GET /api/cash-journal` already sorts every row ascending — by date, then by `createdAt` as a tiebreak — which is what the daybook's running "Solde" needs to accumulate correctly. Both screens used to render that ascending order as-is, so a freshly added row landed at the *bottom* of a growing list instead of where the cabinet expects to see what it just typed. `CashJournal.tsx`'s `withSolde` still accumulates the balance over that ascending order first — that part has to stay chronological — and only reverses the finished `{row, solde}` list afterward, purely for display and pagination; `ClientPayments.tsx`, which carries no running balance, just reverses `filtered` directly. Because the server's tiebreak is a real `createdAt` timestamp rather than array position, two règlements entered on the same date still land in the order they were actually saved, last on top.

**The editable cells of a new or in-progress row carry a light turquoise fill (`bg-turquoise/10` / `border-turquoise/30`), not white.** A plain white `<input>` sitting inside a table already full of white cells was easy to miss as *the* place to type — reported as the add/edit fields not reading as clearly editable. `ClientSearchInput` and `CategoryPicker` — the two shared pickers that also appear read-only elsewhere in the app (the client-form dossier selector, for one) — take an optional `bgClassName` prop (default `bg-white`) so this only changes their look inside these two journal-row editors, not every call site. A disabled cell (`bankAccount` on an Espèce règlement) still falls back to `disabled:bg-gray-100`, unchanged.

**The row's own Enregistrer/Annuler buttons are filled, not bare icons.** Both used to be plain icon glyphs with no background at rest — `ClientPayments.tsx`'s pair in particular (a colored icon with no fill, a gray icon that only got a hover background) read as decoration rather than as the two buttons that actually commit or discard the row. Enregistrer is a solid `bg-navy` button (white check icon) in both `CashJournal.tsx` and `ClientPayments.tsx` — the same fill `CashJournal.tsx` already used, now matched on the other screen too — and Annuler is a filled, bordered `bg-gray-100 border border-gray-300` button rather than invisible-until-hover gray text, so the pair reads as two clearly clickable buttons rather than one visible icon and one that only appears on hover.

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

**Le panneau flottant se recalait mal quand il s'ouvrait vers le haut sur une mission à un seul type** (« RNE », un type de tâche unique) : la bascule et le placement utilisaient tous deux une estimation fixe de 320px de hauteur (`PANEL_MAX`) avant que le panneau réel — bien plus court — n'existe dans le DOM, laissant un vide entre le champ et la liste qui se lisait comme une liste ouverte en haut de l'écran. Le `ResizeObserver` censé remesurer la vraie hauteur une fois monté ne se déclenchait jamais : il dépendait d'un `useEffect` gardé sur `open` seul, qui s'exécute dans le même cycle que le calcul initial — avant que `pos` ne soit posé et donc avant que le panneau existe — et ne se redéclenche pas ensuite puisque `open` ne change plus tant que la liste reste ouverte. Le correctif ajoute un état `panelEl`, posé par le `ref` callback du panneau plutôt que par un simple `useRef`, et fait dépendre l'effet de `[open, panelEl]` : il se déclenche exactement au moment où le nœud DOM devient disponible.

### Ressources Métier

Implements the "Module Ressources Métier" cahier des charges' V1 scope, narrowed to what was actually asked for after two rounds of user feedback: **documents des modèles** (procédures were dropped from the UI entirely — the underlying `resourceTemplate.type` enum still accepts `'procedure'` and nothing stops a row of that type existing, but no screen creates one anymore), liens utiles, échéances — all under the **Ressources métier** nav item ([ResourcesManagement.tsx](src/components/resources/ResourcesManagement.tsx)), gated on `VIEW_RESOURCES` (read) / `MANAGE_RESOURCES` (référentiel CRUD). The spec's own multi-tenant scaffolding (`firm_id` on every table, a `sectors` relation) doesn't map onto this single-tenant app — dropped in favour of an optional free-text `sector` string used only for grouping. `isSystem` is now purely a "seeded by the app" display badge (a small lock icon) — it used to block editing/deleting a seeded template and force a "Dupliquer" step first; that gate was removed at the user's explicit request ("modifiable/removable, no need to duplicate"), so every template — seeded or not — is directly editable and removable, and the `/duplicate` route was deleted outright rather than left as unused dead code.

**Les onglets s'appellent « Modèles des procédures » et « Mes procédures en cours »**, dans cet ordre — le référentiel d'abord pour qui l'administre, puisque c'est là qu'on prépare ce que les autres suivront ; l'onglet par défaut suit cet ordre (`canManage ? 'documents' : 'work'`). Les composants gardent leurs noms de fichiers (`DocumentTemplatesManager`, `MyResourcesWork`) et les identifiants d'onglet (`documents`, `work`) : ce sont des libellés d'écran, pas un renommage du modèle.

**The page is split by audience, not by feature.** A plain `VIEW_RESOURCES` collaborator sees exactly one référentiel-free tab, "Mes procédures en cours" ([MyResourcesWork.tsx](src/components/resources/MyResourcesWork.tsx)) — search a client, pick a modèle already affected (or affect a new one), check items off. No tab bar is even rendered for them (`TABS.length > 1` guards it) — the référentiel tabs (Modèles des procédures, Liens utiles) only exist in the `TABS` array at all when `MANAGE_RESOURCES` is present — Échéances is there for everyone, read-only without it. This replaced an earlier "Suivi & Ressources" section buried in the Clients page's detail panel — one place to work a client's checklists now, not two. `AssignResourceModal` only ever affects a `document_checklist` template (it originally also handled procédures and a per-client "activer une échéance" action; both are gone — procédures with the tab, échéances because the grid has no per-client activation concept at all, just cells set directly). Its modèle picker is a type-ahead (type the first letters, pick from the filtered list) rather than a plain `<select>` — the same debounced-filter pattern the client search already used, just applied to the in-memory template list instead of a server round-trip.

**« Mes procédures en cours » porte un second sous-onglet, Historique** — « Mon travail » (le flux d'origine, un client à la fois) reste inchangé ; « Historique » liste toutes les instances en cours, tous clients confondus, avec ses propres filtres (année, mois, client, collaborateur, procédure) et sa pagination. C'est ce que « Mon travail » ne peut structurellement pas montrer, puisqu'il ne charge jamais qu'un seul client. `GET /api/client-resources/history` sert cette liste — une route distincte de `/api/resources/portfolio` juste en dessous dans server.ts, qui reste réservée au tableau de bord (`DASHBOARD_ROLES`) et n'a toujours pas d'appelant : l'historique, lui, est ouvert à `VIEW_RESOURCES` comme le reste de l'onglet, donc un simple collaborateur le voit aussi.

**Une instance dont le responsable est ADMIN n'apparaît qu'à un administrateur** — même règle que `visibleEntriesFor()` pour le pointage, appliquée ici à un collaborateur ordinaire aussi bien qu'à un compte SUPERVISEUR, pas seulement aux non-admins du tableau de bord. Le « responsable » est `instance.assignedTo` s'il est renseigné, sinon `instance.createdBy` — une instance affectée sans destinataire précis reste rattachée à qui l'a créée plutôt que de n'avoir personne. C'est aussi ce nom qui s'affiche en colonne « Utilisateur » et qui alimente le filtre par collaborateur ; le filtrage est fait côté serveur, avant la réponse, comme pour le pointage — masquer une ligne côté navigateur la laisserait partir dans le JSON.

**Les trois filtres client/collaborateur/procédure sont des `SearchableSelect`** (le même composant que le sélecteur de mission/type de tâche — voir « Missions and types de tâches » plus haut), pas des `<select>` natifs ni un champ de recherche à part. Leurs options sont dérivées des lignes déjà reçues (`Array.from(new Set(...))`, jamais un second appel réseau) — comme le filtre année de `usePeriodPage`, une liste qui ne porte que ce qui a effectivement une instance en cours, pas le fichier clients complet que la page Clients ne charge jamais en entier. Chaque liste porte en tête une option « Tous les clients » / « Tous les collaborateurs » / « Toutes les procédures » (id vide) : c'est elle qui remet le filtre à zéro, cherchable comme n'importe quelle autre valeur plutôt qu'un geste séparé.

**Il y a eu, puis il n'y a plus, un champ de recherche libre à côté des trois filtres.** Une première version ajoutait un champ texte portant sur les trois champs à la fois (client, procédure, utilisateur), et comme il était plus large que les `<select>` il obligeait la rangée à passer en défilement latéral sur un écran étroit (`flex-nowrap overflow-x-auto`) pour ne pas se scinder en deux bandeaux visuellement distincts — corrigeant un symptôme sans s'attaquer à sa cause. **Retiré à la demande de l'utilisateur**, qui ne voulait ni défilement horizontal ni recherche à part : chaque `<select>` est maintenant lui-même cherchable (taper la première lettre suggère, cliquer sélectionne), donc la recherche vit dans le filtre qu'elle sert plutôt qu'à côté, et la rangée revient à un `flex-wrap` ordinaire — plus rien n'y est assez large pour la forcer à défiler.

Année et mois réutilisent `usePeriodPage`/`PeriodFilter`/`PaginationBar` de [PeriodPager.tsx](src/components/PeriodPager.tsx) — même geste que les quatre onglets RH et le Brouillard de caisse — avec `HISTORY_PAGE_SIZE = 15` passé explicitement en troisième argument plutôt que `HR_PAGE_SIZE` (10) : rien n'empêche cette taille de différer d'un écran à l'autre, le hook l'accepte depuis toujours. La barre de pagination est de la même façon toujours visible, y compris sur une page unique. L'export CSV porte sur `historyPage.filtered` (tout ce que les filtres retiennent, pagination mise à part) et non sur la seule page affichée — la règle déjà suivie par les autres exports de l'app.

**Cliquer une ligne ouvre le même suivi document-par-document que « Mon travail »**, via `ResourceInstanceModal` réutilisé tel quel plutôt que dupliqué : `GET /api/client-resources/history` porte donc aussi `items` (chaque document, son statut) et `isSequential` par instance, pas seulement les compteurs `total`/`resolved` — borné de la même façon que `GET /api/client-resources?clientId=` l'envoie déjà pour un seul client, juste étendu à tous les clients à la fois. `onChanged` recharge l'historique ou la liste d'un client selon le sous-onglet actif (`subView`), puisque le modal est monté une fois, partagé par les deux vues, et ne sait pas laquelle l'a ouvert.

**« Modèles des procédures » is a master-detail screen, not a stack of expanded cards** ([DocumentTemplatesManager.tsx](src/components/resources/DocumentTemplatesManager.tsx)): a filterable, independently-scrolling list of modèle names on the left (`max-h-[65vh] overflow-y-auto`), the selected modèle's editable form on the right (secteur, titre, items, Enregistrer/Supprimer) — a cabinet with dozens of modèles scrolls a bounded list instead of the whole page, and can jump straight to one by typing part of its name. There is no modal in this flow at all; `ResourceTemplateEditorModal.tsx` (the earlier modal-based editor) was deleted rather than kept as a second, redundant path. The left list's title wraps (`break-words`/`leading-snug`) rather than `truncate`-ing — a long "Titre de la liste" used to be cut off with no way to read the rest without opening the modèle.

`resourceTemplate` (+ its `resourceTemplateItem` rows, each just `{label, sortOrder}`) is a réusable model; affecting it to a client creates a `clientResourceInstance` (+ `clientResourceItemStatus` rows) that is a **frozen copy** — editing the source template afterward never touches instances already affected, the same "copie figée" rule the mission/task-type snapshot on time entries already relies on. An item's status is a plain `done: boolean` — a "Document | Suivi" checkbox, deliberately not a richer obligatoire/facultatif/non-applicable model, because the cabinet's own reference spreadsheets are exactly that: two columns. `isSequential` still exists on the schema (blocking item *N* until every item before it has `done: true`, enforced server-side in `PUT /api/client-resource-items/:id`) but has no UI to set it now that procédures are gone — it only ever reads `false` for anything created today.

**A modèle can be created straight from the cabinet's own Excel/CSV sheet** — [ImportDocumentTemplateModal.tsx](src/components/resources/ImportDocumentTemplateModal.tsx) / [parseDocumentTemplateExcel.ts](src/components/resources/parseDocumentTemplateExcel.ts). The parser is deliberately lenient, not a strict format: it scans every row, recognises a `"Secteur :"` row and a `"Titre de la liste :"` row if present, skips a `"Document"` header row if present, and treats every other non-blank first cell as a document label — a bare list with no header rows at all still imports. The only hard requirement is at least one document row; a missing secteur or titre is just left blank for the admin to fill in on the preview screen (the "Importer" button itself stays disabled until a titre is typed, so nothing saves half-named). Parsing reads the sheet as `sheet_to_json(sheet, {header:1})` (array-of-arrays) rather than the header-row style `parseClientsWorkbook()` uses, since this format has no reliable header row to key off. The same dialog can affect the freshly-created template to any number of clients immediately (`POST /api/client-resources` once per selected client), collapsing "create the référentiel entry" and "affecter à un client" into one step.

**Échéances is a literal suivi mensuel grid, not a recurrence engine** ([EcheancesGrid.tsx](src/components/resources/EcheancesGrid.tsx)) — the cahier des charges' own recurring-template design (`deadline_template` → auto-generated `client_deadline_instance`, a derived à_venir/en_retard/réalisée status) was built, then **replaced outright** once the user described the cabinet's actual paper sheet: a wide table, one named column per échéance occurrence (`echeanceColumn`: `{year, month, label, sortOrder}`, e.g. "DM 12/2025", "CNSS TR04"), one row per client, one manually-set status cell per (client, column) (`echeanceStatus`: `{clientId, columnId, status}`). There is no due date, no derived status, and no generation step — every cell is exactly what the cabinet typed into it, or empty.

**The status vocabulary itself (`echeanceStatusOption`: `{id, label, sortOrder, color}`) is admin-editable, not hardcoded** — a value like "Oui" or "DEFAUT" can be renamed, recolored, or deleted from the cell's own floating menu, no separate settings screen. `PUT /api/echeance-statuses` validates a cell's status against the *current* set of option labels rather than a fixed array, so the vocabulary really can change. Deleting an option never touches cells already set to it — a cell just stops matching a known option and renders muted (`EMPTY_STYLE`) until re-set from the grid; this is deliberate (a bulk cascade over every cell using a deleted value would be the one unbounded write in this whole feature). `color` is a key into the app's own reserved status-pill tokens (`done`/`late`/`run`/`pause`/`admin`/`collab`, plus a `gray` neutral) — never a raw hex, so recoloring a value still can't invent a new color outside what the design system already reserves for exactly this purpose. Color is assigned by the option's row, not derived from its text, specifically so a rename doesn't repaint it. The four seeded values are `Oui`/done, `Client non concerné par l'échéance`/gray, `DEFAUT`/late, `Préparée (en attente de confirmation client)`/run — `CHEZ BC` was seeded originally and was later removed at the user's request, which is why `seedResourceLibrary` also backfills a `color` on any pre-existing option row that predates this field (the same "recover a legacy shape" idea as `normalizeBalance()`).

**Le crayon/la poubelle qui gèrent le vocabulaire n'apparaissent que lorsque le menu s'ouvre depuis le Tableau, jamais depuis « Calendrier par client ».** Ils s'affichaient dans les deux, juste à côté de la valeur qu'un clic dans cette vue sert normalement à *choisir pour ce client* — et cliquer la poubelle en pensant « effacer la case de ce client » supprimait en réalité la valeur du vocabulaire, ce qui rendait vide la case de **tous** les clients qui la portaient, tableau compris, jusqu'à ce qu'on la reposse. Cela se lisait exactement comme « retirer une échéance pour un client la retire pour tous les clients dans le calendrier », parce que depuis le calendrier le geste paraissait entièrement scopé à ce client alors qu'il ne l'était pas. `openMenu()` prend désormais un drapeau `allowVocabEdit` — `true` depuis les cellules du Tableau, `false` depuis les cartes du calendrier — et le menu ne rend le crayon/la poubelle que lorsqu'il est posé ; choisir une valeur ou revenir à « Vide » est inchangé dans les deux vues, puisque ce n'était pas là le bug. La confirmation de `removeStatusOption` a aussi été reformulée pour dire explicitement que la valeur disparaît pour tous les clients, plutôt que seulement « les cellules déjà réglées ne sont pas modifiées » — vrai, mais qui se lit facilement comme « rien d'autre ne se passe ».

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

**Le tableau de bord Admin n'a plus de carte Ressources métier.** `ResourcesProgressCard.tsx` en portait une, grouped by client, avec un drill-down sur `GET /api/client-resources?clientId=` — retirée à la demande de l'utilisateur, dans le même mouvement que les quatre graphiques de `DashboardCharts.tsx` (voir « Dashboard charts » plus bas) : un tableau de bord dont toutes les cartes ne répondent pas à la même question de filtre — celle-ci n'en respectait délibérément aucun, ni date ni collaborateur — casse la promesse que « le filtre du dashboard s'applique à tout ce qu'on y voit ». `GET /api/resources/portfolio` reste en place côté serveur (gated `VIEW_RESOURCES`, listé dans `PLAN_MODULE_ROUTES`) mais n'a plus d'appelant — un suivi des ressources par client reste consultable dans **Ressources métier** (« Mon travail » / le tableau de bord de la section elle-même), simplement plus dans ce tableau de bord-ci.

Deliberately deferred to V2/V3 per the spec's own phasing table (do not build without an explicit request): automatic task generation from an échéance into time entries, attachments on document items, automatic email/notification reminders, average document-receipt-delay statistics, and any cross-cabinet template sharing.

### Offres et sièges

Le catalogue vit dans [src/constants/plans.ts](src/constants/plans.ts) — une
seule liste, lue par la page publique, la console plateforme et `server.ts`,
comme `roles.ts` et `paymentModes.ts`. Changer un prix, c'est éditer une
ligne : une valeur corrigée sur la page de tarifs mais pas côté serveur
produirait une page qui annonce un montant et un e-mail de RIB qui en
demande un autre.

**Quatre offres, dans cet ordre** — Freelancer en tête, puis RH & Paie,
Facturation, Complet — chacune ouvrant un périmètre différent :

- **Freelancer** — gratuit, un siège, ADMIN, toutes les vues (`modules`
  absent). Voir plus bas.
- **RH & Paie** (`RH_PAIE`) — 20 DT/mois pour 1 utilisateur, +10 DT par
  utilisateur supplémentaire. `modules: ['HR', 'Payroll', 'Users']` — Équipe,
  RH et Gestion des paies, rien d'autre.
- **Facturation** (`FACTURATION`) — même tarif, `modules: ['Clients', 'Cash',
  'Users']` — Équipe, Clients et Cash.
- **Complet** (`COMPLET`) — 50 DT/mois pour **5 utilisateurs inclus**, +10 DT
  par utilisateur supplémentaire, `modules` absent (toutes les vues). Offre
  par défaut d'une inscription qui ne précise rien (`DEFAULT_PLAN_ID`).

**Pack 5/10/15 et l'ancien pack Facturation à 30 DT (un siège) ont été
supprimés du catalogue purement et simplement**, pas seulement retirés
(`legacy: true`) — décision explicite prise en connaissance du risque :
toute entreprise encore inscrite sous l'un de ces identifiants voit
`planMeta()` renvoyer `null`, ce qui la fait retomber sur les replis déjà en
place pour une offre inconnue (`planLabel()` affiche l'id brut,
`planAllowsModule()`/`planAllowsPermission()` ouvrent tout). Une offre
retirée qu'on veut au contraire préserver pour ses entreprises existantes
suit toujours le chemin `legacy: true` — voir `FREELANCE`/`EQUIPE`/
`CROISSANCE` ci-dessous, inchangé.

**Le tarif par utilisateur supplémentaire est le cœur du nouveau catalogue.**
`PlanMeta.pricePerExtraUserDT` (10 DT pour les trois offres non-Freelancer) et
`PlanMeta.baseSeats` définissent une offre **dynamique** — 1 pour RH & Paie et
Facturation, mais **5 pour Complet** : ses 50 DT couvrent d'emblée cinq
comptes, pas un seul. `planPriceForSeats(meta, seats)` dans plans.ts n'a rien
à savoir de cette différence — elle lit `baseSeats` par offre — et en est
l'unique implémentation : `priceDT` tel quel si `pricePerExtraUserDT` est
absent (Freelancer, ou une offre retirée), sinon `priceDT + (seats −
baseSeats) × pricePerExtraUserDT`. **Une seule fonction, appelée aux quatre
endroits qui
doivent absolument s'accorder** — le calculateur de la page Tarifs, l'aperçu
de prix dans la modale d'inscription, le mail de RIB
(`POST /api/platform/companies/:id/send-rib`) et la confirmation de paiement
(`POST /api/platform/companies/:id/confirm`) — sinon un montant annoncé au
client et un montant encaissé finiraient tôt ou tard par diverger, exactement
le piège que `computeInvoiceTotals()` évite déjà côté facturation.

**`PlanMeta.seatLimit` sur une offre dynamique n'est qu'un repli
d'affichage** (égal à `baseSeats` — 1 pour RH & Paie/Facturation, 5 pour
Complet) — **jamais** le nombre réellement
accordé à une entreprise. Ce nombre-là vit sur la fiche
(`company.seatLimit`), posé au nombre demandé à l'inscription
(`POST /api/signup`, champ `seats` du corps de la requête, borné par
`clampSeatsForPlan()` — entre `baseSeats` et `MAX_DYNAMIC_SEATS`, un
garde-fou anti-abus de 200, pas une vraie limite commerciale) ou négocié
ensuite depuis la console (`CompanyEditModal.tsx`, déjà éditable comme tout
le reste des sièges). `POST /api/platform/companies/:id/confirm` **ne
réécrit jamais `seatLimit`/`portalSeatLimit` depuis le catalogue statique
pour une offre dynamique** — seule une offre à prix plat (aucune sellable
aujourd'hui hormis Freelancer) reprend encore son `seatLimit` fixe à la
confirmation ; sans cette garde, confirmer une entreprise sur RH & Paie à 4
sièges l'aurait silencieusement ramenée à 1.

**Toute lecture de `seatLimit` côté client doit suivre le même ordre de
résolution que `seatLimitError()` côté serveur : la fiche d'abord, l'offre
ensuite.** `GET /api/me` porte donc `company.seatLimit` (le nombre réel, pas
le repli du catalogue) précisément pour ça —
[UsersManagement.tsx](src/components/UsersManagement.tsx)'s `singleSeatPlan`
(qui masque « Nouvel utilisateur »/« Exporter » d'Équipe sur un siège
unique) lit `user.company.seatLimit ?? planMeta(...).seatLimit`, jamais
`planMeta(...).seatLimit` seul — s'arrêter au catalogue aurait masqué ces
deux boutons pour *toute* entreprise sur une offre dynamique, même celle
ayant payé pour dix sièges, puisque le catalogue n'en affiche jamais que 1.
Même règle appliquée dans [PlatformAdmin.tsx](src/pages/PlatformAdmin.tsx),
qui affiche `c.seatLimit ?? meta.seatLimit` (jamais `meta.seatLimit` seul) à
côté du prix recalculé pour ce nombre de sièges.

**La page de tarifs porte un calculateur par carte** — un curseur
« Utilisateurs » (`+`/`−`, borné entre `baseSeats` et `SEAT_STEPPER_MAX`, une
limite d'affichage locale à Landing.tsx fixée à 50, bien en-deçà du
`MAX_DYNAMIC_SEATS` serveur) qui recalcule le prix affiché **instantanément**
via `planPriceForSeats()` — aucun aller-retour réseau, la même fonction que
le serveur rappelée à chaque clic. Le nombre choisi sur la carte est porté
jusqu'à la modale d'inscription (`initialSeats`), qui garde son propre champ
éditable et son propre aperçu de prix : le visiteur peut affiner le chiffre
là aussi sans revenir à la carte. `POST /api/signup` reçoit ce nombre dans
`seats` et l'écrit tel quel (borné) comme `seatLimit` de la nouvelle
entreprise — voir plus haut.

**Le pack Freelancer est gratuit pour de bon, pas seulement à l'essai.** Un
siège, ADMIN, `priceDT: 0`, et les mêmes vues que le pack Complet (`modules`
absent) — un indépendant y trouve tout le cabinet, juste sans personne
d'autre à ajouter, ce que le siège unique impose déjà par `seatLimitError()`
sans règle à part. « Gratuit, sans période d'essai » n'est pas ce que
`POST /api/signup` fait par défaut : toute inscription part `TRIAL` avec un
`trialEndsAt`, quelle que soit l'offre. Le Freelancer est donc reconnu à part
(`plan === 'FREELANCER'`) et posé `ACTIVE` d'emblée, `trialEndsAt: null` —
`expireTrialIfDue` ne touche que `status === 'TRIAL'`, donc un compte qui
n'y entre jamais n'expire jamais, et `documentQuotaFor()` rend `null` (aucun
plafond) exactement comme pour un abonnement payé confirmé. La page de
tarifs affiche « Gratuit » plutôt que « 0 DT/mois » pour la même offre — un
prix à zéro se lit comme un champ oublié, pas comme une promesse.

**Les offres retirées restent dans la liste** (`legacy: true`) — `FREELANCE`,
`EQUIPE`, `CROISSANCE`. Une entreprise inscrite sous l'ancien catalogue les
porte encore dans sa fiche ; les effacer lui ferait perdre son libellé et sa
limite de sièges du jour au lendemain. Elles ne sont simplement plus proposées,
ni sur la page publique, ni à l'inscription (`isSellablePlan`), et la console ne
garde leur option dans le `<select>` que pour l'entreprise qui les porte. Même
règle de récupération que `normalizeBalance()` : on lit la forme ancienne, on ne
la réécrit pas.

**Une offre peut n'ouvrir qu'une partie de l'application.** `PlanMeta.modules`
porte les vues qu'elle vend, désignées par l'identifiant que porte déjà leur
entrée de barre latérale (`Cash`, `Clients`, `HR`…) — **absent = toutes**, ce
qui est le cas de Freelancer et de Complet, et ce qui fait qu'ajouter une
offre restreinte n'a touché à rien de ce qui existait. Les deux offres
restreintes (RH & Paie, Facturation) suivent la même règle littérale que
l'ancien pack Facturation à un siège : **seules les vues explicitement
listées s'ouvrent**, Tableau de bord, Pointage, Ressources métier et
Messages compris — ce n'est pas un oubli, c'est ce que l'utilisateur a
demandé (« ken », *seulement*, dans sa description des deux offres). L'ordre
compte dans chaque liste : Facturation déclare `Clients` avant `Cash` avant
`Users`, parce que c'est le premier module de la liste qu'App.tsx ouvre par
défaut, et c'est le fichier clients qu'on veut voir en arrivant — pas un
formulaire de facture sans dossier encore choisi ; RH & Paie déclare `HR`
avant `Payroll` avant `Users`, parce que c'est l'écran de travail quotidien
de cette offre, la paie se générant moins souvent que les congés ne se
posent, et Équipe étant un écran de réglage plutôt qu'un écran d'usage
courant. `Users` (Équipe) figurant désormais dans ces deux offres — à la
différence de l'ancien pack Facturation à un siège, qui l'excluait faute de
personne à gérer — un cabinet sur l'une d'elles peut ajouter des
collaborateurs, ce qui est précisément ce que le tarif par utilisateur
supplémentaire vend.

**`Parrainage` figure en dernier dans les deux listes**, à côté de `Users` —
contrairement aux autres vues restreintes, ce n'est pas une fonctionnalité du
métier mais l'abonnement de l'entreprise lui-même qui est en jeu
(`canRefer`/`settleReferralOnPayment()`, voir « Parrainage » plus bas), donc
il n'y avait aucune raison de le réserver aux deux offres généralistes :
n'importe quel abonnement `ACTIVE` peut parrainer, quelle que soit l'offre
qu'il vend. Manquait initialement des deux listes — l'écran restait donc
invisible sur RH & Paie et Facturation alors que la logique serveur
(`/api/referral`, gardée par `MANAGE_USERS` et par `PLAN_MODULE_ROUTES` qui
mappe déjà `/api/referral` sur `Parrainage`) n'avait jamais rien d'autre à
changer pour l'ouvrir.

L'éditeur de document reste capable de se passer du fichier clients : il
demande `hasPermission('VIEW_CLIENTS')` — qui consulte déjà l'offre — et sans
lui la raison sociale devient un champ libre au lieu d'un type-ahead (une loupe
qui ne cherche nulle part se lirait comme une panne), la validation porte sur ce
qui est tapé, et le document part avec `clientId: null`, que le serveur accepte
depuis toujours. Aucune offre vendue n'est dans ce cas aujourd'hui, mais un
compte à qui on donne `MANAGE_CASH` sans `VIEW_CLIENTS` l'est.

Le périmètre se ferme à **trois endroits, et les trois sont nécessaires** :

- **`authenticate`**, par une table chemin → module (`PLAN_MODULE_ROUTES`),
  exactement comme le périmètre du portail client juste au-dessus, et pour la
  même raison : `requirePermission` ne suffit pas, parce qu'une bonne partie
  des routes ne portent que `authenticate` (le catalogue des missions que lit
  le formulaire de pointage, `/api/hr/balance`, les flux SSE…) et resteraient
  ouvertes. **Liste blanche** : un chemin qui ne correspond à aucun préfixe est
  refusé aux offres restreintes, donc une route ajoutée demain naît fermée pour
  elles — la contrepartie est qu'une nouvelle route doit être classée dans
  cette table. Seuls `PLAN_NEUTRAL_PREFIXES` (se connaître, la cloche, le push,
  le battement de présence, la réinitialisation de mot de passe, la console
  plateforme) échappent au classement. **Un préfixe ne vaut que sur une
  frontière de segment** (`pathUnderPrefix`) : avec un `startsWith()` nu,
  `/api/me` était le préfixe de `/api/messages` et la messagerie entière
  passait pour neutre — mesuré, `/api/messages/contacts` répondait 200 au pack
  Facturation. Tout nouveau préfixe passe par ce helper.
- **`requirePermission`**, par `planAllowsPermission` et la table
  `PERMISSION_MODULE` — **devant le court-circuit ADMIN**, comme le garde de
  secteur : c'est l'abonnement de l'entreprise qui décide, pas le rôle de la
  personne.
- **`hasPermission` côté client** (même appel, même table) et un filtre de
  module sur `mainNavItems`. Ce filtre-là couvre les deux cas qu'une permission
  ne couvre pas : **Tableau de bord, Tâches et Messages**, qui n'en portent
  aucune, et **Parrainage**, qui partage `MANAGE_USERS` avec Équipe alors que
  ce sont deux vues distinctes.

App.tsx dérive de tout ça la section réellement affichée (`activeNav`) : la
section mémorisée peut être fermée par l'offre — et l'est par défaut, le repli
du sélecteur étant « Équipe » —, auquel cas on retombe sur **la première vue
déclarée par l'offre** (`Clients` pour le pack Facturation, en tête de
`['Clients', 'Cash', 'Users']` ; `HR` pour RH & Paie, en tête de
`['HR', 'Payroll', 'Users']`), pas sur la première entrée de `NAV_IDS` qui se
trouve autorisée. `canShowNav` traite le même refus pour une seconde raison,
indépendante de l'offre : « Équipe » ferme aussi pour un utilisateur sans
`MANAGE_USERS`, exactement comme elle fermerait pour une offre qui ne la vend
pas — un collaborateur en première connexion sans ce droit retombe donc sur
la même chaîne de secours qu'un compte sur une offre qui ne vend pas Équipe,
plutôt que sur « section en cours de développement ».

**Le plafond de documents est ce que lève l'abonnement — aucune offre du
catalogue actuel n'en pose un.** `PlanMeta.trialDocumentQuota` plafonne les
documents **émis** par mois tant que l'entreprise n'est pas `ACTIVE` ;
`documentQuotaFor()` rend `null` dès qu'elle l'est — c'est précisément ce
qu'on vend. L'ancien pack Facturation à un siège en portait un (10/mois) ;
le pack Facturation qui l'a remplacé n'en a délibérément pas, comme les
trois autres offres — rien dans la demande n'en redemandait un, et le champ
reste disponible pour la prochaine offre qui en aura besoin. Trois
précisions qui décident du comportement, pour l'offre qui viendrait en
poser un :

- **Un brouillon ne compte pas** (`countsAgainstQuota` : tout sauf `DRAFT`).
  On en prépare autant qu'on veut ; c'est à l'**émission** que la place est
  consommée, donc le plafond est vérifié à la création d'un document non
  brouillon *et* dans `POST /api/invoices/:id/issue`. La règle est
  volontairement plus large que `countsAsBilled` : un « autre document (non
  facturable) » ne fait pas d'honoraires mais reste un document émis.
- **Le mois est celui de l'émission** (`issuedAt || createdAt`, dans le fuseau
  du cabinet), jamais `issueDate` : cette dernière se saisit à la main, donc un
  plafond adossé à elle se contournerait en la reculant d'un mois.
- **Un seul helper** (`documentQuotaState`) sert les deux refus *et*
  `GET /api/cash/document-quota`, que Cash affiche en badge : un compteur qui
  annoncerait une place restante devant un refus serait pire que pas de
  compteur. Le refus est un **402**, et son message part tel quel dans
  l'éditeur, qui affiche déjà `body.error`.

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

**Les trois offres dynamiques posent `portalSeatLimit: 0` au catalogue —
aucun chiffre n'a été demandé pour ce panier-là, seul le tarif par
utilisateur du back-office l'a été.** Zéro est le même défaut sûr que
« aucune offre » ci-dessus : ça n'empêche personne de négocier un quota par
fiche via `CompanyEditModal.tsx`, et ça n'invente pas un nombre qui
tromperait un vrai client sur ce qu'il achète. Facturation et Complet
ouvrent tous deux le module Clients (donc le portail client a un sens
fonctionnel pour eux, contrairement à RH & Paie) — si un chiffre est
souhaité pour ce panier, c'est une ligne à ajouter dans plans.ts, pas une
correction de bug.

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

**L'écran de parrainage met désormais le code en avant, pas le lien** — à la
demande de l'utilisateur. [ReferralPage.tsx](src/components/ReferralPage.tsx)
affiche un grand code en police mono avec un bouton « Copier », et n'affiche
plus le champ `link` du tout (le serveur continue de le calculer et de le
servir dans `GET /api/referral` — un lien `/?ref=CODE` reste valide pour qui
en reçoit un, la page n'en montre juste plus). C'est ce que l'alphabet sans
I/O/0/1 documentait déjà comme raison d'être (« le code se dicte au
téléphone ») sans que l'écran le suivait jusqu'ici : un code se donne aussi
bien à l'oral qu'à l'écrit, un lien non.

**Le formulaire d'inscription porte un champ « Code de parrainage »
saisissable à la main**, plutôt que de ne lire le code que dans l'URL
d'arrivée (`/?ref=CODE`). [RequestAccessModal.tsx](src/components/landing/RequestAccessModal.tsx)
pré-remplit `referralCodeInput` depuis cette URL quand il y en a une (le
geste par lien continue de marcher tel quel), mais le champ reste éditable :
un parrain qui a donné son code au téléphone n'a jamais eu de lien à suivre.
Le bandeau annonçant la remise se déclenche sur le champ (`referralCodeInput`),
pas sur la seule présence du paramètre d'URL — la remise s'annonce dès qu'un
code est renseigné, peu importe comment il y est arrivé. Rien ne change côté
serveur : `POST /api/signup` acceptait déjà `referralCode` dans le corps de
la requête, normalisé et validé de la même façon quelle que soit sa source.

Un code inconnu **n'échoue pas** l'inscription (un lien tronqué en route ne doit
pas coûter un client), et l'écriture de la ligne de parrainage se fait *après*
la création de l'entreprise, dans un `try/catch` : un parrainage perdu ne fait
jamais échouer une inscription déjà aboutie.

Le vocabulaire à l'écran parle de **commission** (« une commission équivalente à
1 mois d'abonnement »), pas de « mois gratuit » : c'est ce que le parrain
encaisse, et l'avoir de la console est ce qui le rend. Une seule phrase porte la
réserve, en pied de page — la commission n'est acquise qu'à la souscription
effective du filleul, pas à la création de son compte — parce que c'est la seule
règle qui décide si quelqu'un a gagné quelque chose ou non.

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

**Un administrateur ouvre l'espace d'un client sans connaître son mot de
passe, ni se déconnecter.** Le bouton « Espace client » de la fiche client
(`ClientsManagement.tsx`, derrière `MANAGE_USERS`) appelle
`POST /api/clients/:id/impersonate`, qui trouve le compte `CLIENT` rattaché à
ce dossier (le premier s'il y en a plusieurs) et émet un jeton pour lui,
exactement comme `/api/login` mais sans mot de passe — l'autorisation vient de
la permission, pas d'un secret. `AuthContext.impersonateClient()` range le
jeton admin sous une clé `localStorage` distincte (`impersonator_token`,
jamais dans `auth_token`, pour survivre à un rechargement pendant la bascule)
avant de basculer sur celui du client ; `stopImpersonating()` fait le chemin
inverse. `App.tsx` affiche une bannière fixe au-dessus du portail tant que
`isImpersonating` est vrai, avec le seul bouton de retour — sans elle,
l'admin resterait coincé dans une session client sans porte de sortie
visible. Un dossier sans aucun compte `CLIENT` renvoie une erreur affichée
dans le tiroir plutôt qu'une bascule silencieuse vers rien.

**« Comptes clients » est une sous-vue d'Équipe, pas un second écran.**
[UsersManagement.tsx](src/components/UsersManagement.tsx) porte deux onglets
sur la même liste déjà chargée (`GET /api/users`) — « Équipe » (tout sauf
`CLIENT_ROLE`) et « Comptes clients » (uniquement `CLIENT_ROLE`), avec un
compteur sur le second. Les deux populations ne se lisent jamais ensemble :
noyer une poignée de comptes portail parmi des dizaines de collaborateurs (ou
l'inverse) ne montre rien d'utile. La colonne « Rôle » n'existe pas dans cet
onglet — le rôle y est toujours `CLIENT`, donc l'afficher répéterait ce que
l'onglet dit déjà — et le tableau n'affiche que Utilisateur / Statut /
Actions, `<th>` et `<td>` conditionnés sur `teamTab !== 'clients'` de part et
d'autre. Elle portait un temps le dossier client rattaché à sa place (« La
colonne devient Dossier client »), **retirée à la demande de l'utilisateur** :
le nom d'utilisateur d'un compte client se pré-remplit sur le nom du dossier
choisi (voir plus bas), donc la colonne Utilisateur porte déjà quasiment
toujours la même information. `user.clientName` reste lu ailleurs — il
pré-remplit le sélecteur de dossier à l'édition — ce n'est que la colonne du
tableau qui a disparu, pas le champ. « Nouvel utilisateur » devient
« Nouveau compte client », qui ouvre le formulaire avec `Rôle` déjà sur
`Client`. Une recherche par nom d'utilisateur filtre les deux onglets.

`GET /api/users` résout `clientName` pour chaque compte `CLIENT` (un
`Map` sur `getAllClients`, pas un aller-retour par utilisateur) — sans quoi
la fiche d'édition d'un compte client affichait « Dossier n° 123 » au lieu du
nom du client, faute d'avoir jamais reçu autre chose que l'id.
`POST`/`PUT /api/users` répondent de même après écriture. Le nom d'utilisateur
d'un compte client se pré-remplit avec le nom du client choisi dans le
sélecteur — c'est ainsi qu'un compte portail se connecte, pas avec un
identifiant que l'admin invente — mais reste modifiable avant la création.

**Le champ « Rôle » vit juste sous nom d'utilisateur et mot de passe**, pas
après tout le bloc coût employeur / shift / congés : c'est lui qui décide si
ce bloc s'affiche ou s'efface au profit du sélecteur de dossier client, donc
le choisir en dernier obligeait à faire défiler tout un formulaire non
pertinent avant de trouver le réglage qui en changeait le contenu. Ce n'est
vrai que pour un collaborateur — voir l'ordre inversé ci-dessous pour un
compte client, où le rôle est déjà tranché avant même d'ouvrir la modale.

**Pour un compte client, le formulaire s'ouvre déjà tranché sur le rôle**
(`handleOpenCreate(CLIENT_ROLE)`, ce que « Nouveau compte client » appelle) —
le dossier client rattaché passe donc **en tête**, avant nom d'utilisateur et
mot de passe, et Rôle redescend en dernier. Ce n'est pas l'inverse arbitraire
de l'ordre collaborateur : choisir le dossier **remplit** le nom
d'utilisateur juste en dessous (`ClientSearchInput`'s `onChange`), donc le
champ qui en alimente un autre doit le précéder, pas le suivre — la
dépendance était déjà là, seul l'ordre à l'écran ne la suivait pas. Les deux
séquences (`usernameField`/`passwordField`/`roleField`/`dossierField`, dans
[UsersManagement.tsx](src/components/UsersManagement.tsx)) sont des fragments
JSX assemblés une seule fois par rendu, pas deux copies du formulaire : rien
ne duplique le balisage entre les deux ordres. Le rôle reste modifiable en
cours de saisie (l'admin peut rebasculer un `Nouvel utilisateur` en `Client`
depuis le `<select>` Rôle) et la réorganisation suit en direct, puisqu'elle
ne dépend que de `formRole`.

**La modale de création/édition porte une section « Gestion des paies »**,
douze champs (matricule, n° CIN, n° CNSS, qualification, département,
banque/poste, numéro de compte, situation familiale, nombre d'enfants,
catégorie, échelon, salaire/heure) purement déclaratifs — un dossier
administratif de paie, pas un calcul : aucun d'eux n'entre dans
`employerHourlyRate()`, dans le pointage ou dans quoi que ce soit d'autre
dans l'app. C'est délibéré : le cabinet a besoin de les *conserver* quelque
part, pas de les faire agir. Repliée par défaut (`paieCollapsed`, même
idiome chevron `ChevronRight`/`ChevronDown` que le tableau de bord et les
groupes de permissions juste en dessous — chaque section garde son propre
`useState`, pas d'abstraction partagée) : douze champs de plus, dépliés
d'office, auraient allongé le formulaire pour tout le monde alors que seule
la paie les consulte au quotidien. Gated `formRole !== CLIENT_ROLE` comme
Coût employeur/Shift/Congés — un compte portail n'est pas un employé du
cabinet. La modale elle-même est passée de `max-w-md` à `max-w-2xl` pour
cette section : douze champs sur une seule colonne auraient rendu le
formulaire interminable à faire défiler, la grille à deux colonnes n'a de
sens que sur une modale plus large. Les douze champs sont stockés tels
quels sur la fiche utilisateur (`matricule`, `numCin`, `numCnss`,
`qualification`, `departement`, `banque`, `numeroCompte`,
`situationFamiliale`, `nombreEnfants`, `categorie`, `echelon`, `salHeure` —
voir l'interface `User` dans [AuthContext.tsx](src/context/AuthContext.tsx))
et traversent `POST`/`PUT /api/users` par la même liste blanche explicite que
le reste du formulaire ; `publicUser()` les renvoie sans traitement
particulier puisqu'il ne fait que retirer `password` et parser
`permissions`.

**`nombreEnfants` a depuis migré vers « Paramètres de la paie »** (voir
« Gestion des paies » plus haut) : contrairement aux onze autres, il n'a
jamais été purement déclaratif — il alimente la tranche de déduction
enfants à charge depuis avant même que cette section existe — donc le
laisser ici à côté de champs qui, eux, n'agissent sur rien laissait croire
qu'il ne faisait rien non plus. Les onze champs restants de ce paragraphe
sont, eux, inchangés et toujours purement déclaratifs.

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

  **Ça ne tenait pas pour un `client.encaissements` hérité en simple
  nombre.** Un client jamais rouvert depuis que ce champ est devenu une liste
  datée le garde tel quel (« round-trip untouché » — voir plus haut) ;
  `sumEncaissements()`, côté back-office, le somme quand même. Mais
  `portalEncaissementsFor()` construisait sa liste avec `normalizeEncaissements()`,
  qui rend `[]` pour tout ce qui n'est pas déjà un tableau — un montant hérité
  disparaissait donc silencieusement, et le portail affichait « Total
  encaissé : 0 TND » pendant que la page Clients montrait le vrai total pour
  le même dossier. `portalEncaissementsFor()` récupère maintenant ce montant
  comme une ligne à part (`date: ''`, triée avant toute date réelle — `fdate()`
  côté client la rend « — » plutôt que d'inventer une date), au lieu de le
  laisser tomber : même principe que `normalizeBalance()`, on récupère la
  forme ancienne plutôt que de la deviner ou de la perdre. `/api/portal/summary`
  et `/api/portal/statement` partagent tous deux `portalEncaissementsFor()`,
  donc le correctif s'applique aux deux d'un coup.
- `/api/portal/tasks` — l'avancement **sans temps ni coût**. Le filtrage est
  dans la réponse, pas dans l'interface : masquer une colonne côté navigateur
  laisserait `dureeSeconds`/`hourlyRate`/`cost` partir dans le JSON. Les champs
  sont listés un par un — liste blanche, pour qu'un champ sensible ajouté
  demain à l'entrée ne se retrouve pas ici par défaut. Seules les tâches
  `COMPLETED` sont servies.
- `/api/portal/deliverables` — les modèles affectés au dossier, leur
  avancement et leurs items, jamais qui y a passé du temps.
- `/api/portal/echeances` — le calendrier d'échéances du dossier, en lecture
  seule. Rend les mêmes colonnes que `GET /api/echeance-columns` et le même
  vocabulaire de statuts (`statusOptions`, avec sa couleur) que la grille
  admin — pour que le portail dessine les mêmes pastilles — mais `statuses`
  n'est filtré qu'aux cellules de **ce** client, jamais celles des autres
  dossiers. Poser une valeur reste `MANAGE_RESOURCES`, réservé au cabinet :
  cette route ne sert que la lecture, il n'existe aucune route d'écriture
  côté portail.

**Un onglet « Échéances » dans le portail** ([ClientPortal.tsx](src/pages/ClientPortal.tsx))
rend ce calendrier sous la même forme que « Calendrier par client » de
l'écran admin ([EcheancesGrid.tsx](src/components/resources/EcheancesGrid.tsx))
— une carte par mois, le libellé de chaque colonne et sa pastille de statut
— mais sans recherche de client (le portail n'en a qu'un, le sien) ni menu
au clic sur une cellule (pas de crayon/poubelle, pas de sélection : c'est de
la lecture). Les couleurs viennent des mêmes tokens réservés que la grille
admin (`done`/`late`/`run`/`pause`/`admin`/`collab`), dupliqués localement en
une petite table plutôt qu'importés — le fichier admin n'exporte pas la
sienne, et sept lignes ne valent pas une extraction partagée.

**L'onglet n'apparaît que pour un secteur qui a Ressources métier** —
`companyHasResourcesModule(user.company?.secteur)`, la même garde que
`AuthContext.hasPermission` applique déjà à `VIEW_RESOURCES`/`MANAGE_RESOURCES`
côté back-office. Un secteur « Autres professions de services » n'a jamais eu
de grille d'échéances semée ; lui montrer l'onglet serait une carte
éternellement vide sans qu'aucun message n'explique pourquoi. La garde évite
aussi l'appel réseau correspondant quand l'onglet n'est de toute façon pas
montré, une requête de plus par chargement pour rien.

**Le client est notifié de quatre événements sur son propre dossier** —
échéance modifiée, facture émise, item de livrable coché, tâche terminée —
via le même mécanisme `notify()`/`notifications` que le reste de l'app, pas
un chemin à part. `portalUserIdsFor(companyId, clientId)` (server.ts, juste
après `notify()`) résout le ou les comptes `CLIENT` rattachés à un dossier —
plusieurs si le gérant et son comptable en ont chacun un — et chaque
déclencheur y notifie tous. Les quatre types (`PORTAL_ECHEANCE`,
`PORTAL_INVOICE`, `PORTAL_DELIVERABLE`, `PORTAL_TASK_DONE`) ne partent
jamais que vers un compte `CLIENT` :

- **Échéance** — `PUT /api/echeance-statuses`, via `notifyEcheanceChange()`.
  Seul un statut posé à une valeur **non vide** notifie ; un effacement
  (retour à « Vide ») est une correction interne, pas une nouvelle à
  transmettre.
- **Facture** — `notifyPortalInvoice()`, appelée à la fois par la création
  directe (`POST /api/invoices`) et par l'émission d'un brouillon
  (`POST /api/invoices/:id/issue`), puisque les deux font naître un document
  au même sens. La garde est `countsAsBilled(inv)` — le même filtre que
  `/api/portal/statement` — pour qu'un client ne soit jamais notifié d'un
  document qui n'apparaît de toute façon pas dans son relevé (un brouillon,
  ou un « autre document non facturable »).
- **Livrable** — `PUT /api/client-resource-items/:id`, uniquement sur la
  transition `false → true` (cocher un item déjà coché, ou le décocher, ne
  renvoie rien : ce n'est pas un progrès à signaler).
- **Travaux** — `PUT /api/time-entries/:id`, uniquement sur la transition
  `existing.statut !== 'COMPLETED' && req.body.statut === 'COMPLETED'` —
  le même garde-fou qui pose déjà `heureFin` juste au-dessus dans cette
  route, pour qu'une tâche qui reste `COMPLETED` d'un PUT à l'autre ne
  renvoie pas une seconde notification.

Chacun résout le dossier via `clientId` (jamais un nom de client texte
libre, qu'aucun compte portail ne peut porter) et n'aboutit à rien si le
dossier n'a pas de compte `CLIENT` — silencieusement, ce n'est pas une
erreur. **`NotificationBell.tsx`** porte les quatre types dans `TYPE_META`/
`TOAST_VARIANT` comme tout le reste, et **`PUSH_NAV_FOR_TYPE`** côté
serveur pour le Web Push. Leur `nav` désigne un onglet du **portail**
(`Echeances`/`Statement`/`Deliverables`/`Tasks`), jamais une section du
back-office comme les autres entrées de ces tables — `ClientPortal.tsx`
traduit via `PORTAL_NAV_TO_TAB` avant d'appeler `setTab()`. Cette table a
aussi corrigé un bug latent : `onNavigate` y était câblé en dur sur
`() => setTab('messages')`, donc n'importe quelle notification (même une
tâche assignée) atterrissait sur Messages — invisible tant qu'aucun type
de notification n'atteignait un compte client, ce qui n'était le cas
d'aucun avant ces quatre-là.

**Une ligne « Facture » du relevé s'ouvre au clic** et affiche le document
complet, réutilisant [InvoicePreview.tsx](src/components/cash/InvoicePreview.tsx)
— le même rendu que Cash, boutons Télécharger PDF / Imprimer compris, mais
sans `onEdit`/`onDelete` (jamais passés depuis le portail : un client ne
modifie ni ne supprime ses propres factures). Deux routes le rendent possible
sans emprunter les routes Cash, gardées par `VIEW_CASH`/`MANAGE_CASH` qu'un
compte `CLIENT` n'a pas : `GET /api/portal/invoices/:id` revérifie
l'appartenance au dossier via `portalInvoicesFor` — la même liste blanche que
le relevé — plutôt que de faire confiance à l'id de la requête, et
`GET /api/portal/company` rend le bloc émetteur (identité, RIB, signature)
que porte déjà chaque facture reçue, donc rien de plus n'y est exposé.
`InvoicePreview` accepte un `companyEndpoint` (par défaut `/api/cash/company`)
pour ce second cas plutôt que de dupliquer le composant.

**Une ligne « ENCAISSEMENT » du relevé s'ouvre au clic elle aussi**, sur les
mêmes champs que Règlements clients côté Cash (objet du règlement, mode de
règlement, compte bancaire, référence, montant) — contrairement à une facture,
un règlement n'a pas de document séparé à charger : `/api/portal/statement`
porte déjà tout ce qu'il faut sur chaque ligne (`portalEncaissementsFor()`
renvoie l'objet complet, seule une partie était forwardée dans la ligne avant
ce correctif), donc `ReglementDetailModal` dans ClientPortal.tsx s'ouvre sans
round-trip réseau. Seul le montant hérité en simple nombre (voir plus haut)
n'a pas d'id réel à rouvrir et reste non cliquable.

**L'accès « Espace client » est sa propre permission**
(`ACCESS_CLIENT_PORTAL`, groupe Clients), pas un sous-effet de `MANAGE_USERS` :
un cabinet qui veut déléguer l'ouverture du portail — sans donner accès à la
gestion complète des comptes — le peut. Gardée aux deux bouts comme tout le
reste : `hasPermission('ACCESS_CLIENT_PORTAL')` sur le bouton
(`ClientsManagement.tsx`) et `requirePermission('ACCESS_CLIENT_PORTAL')` sur
`POST /api/clients/:id/impersonate`, plus une entrée dans `PERMISSION_MODULE`
(`plans.ts`) — sans elle une offre restreinte l'aurait refusée par défaut à
tout le monde, liste blanche oblige.

**Les libellés de permissions sont en français, sans suffixe anglais.**
`VIEW`/`EDIT`/`DELETE` s'affichaient « Voir (VIEW) », « Modifier (EDIT) »,
« Supprimer (DELETE) » dans `PERMISSIONS_GROUPED` — un reliquat du nom
technique de la permission collé au libellé. Le nom technique (`id`) reste
inchangé pour ne pas invalider les permissions déjà enregistrées sur des
comptes existants ; seul le `label` affiché a changé.

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

**La liste des conversations se filtre par recherche**, groupes et contacts
ensemble, avec le même repliage d'accents que le reste de l'app
([ChatPage.tsx](src/components/chat/ChatPage.tsx)). C'est un filtre purement
local sur les listes déjà chargées — pas de nouvelle route — puisque
`GET /api/messages/contacts` et `/groups` rendent déjà tout ce que le compte
peut voir. Le fil ouvert reste affiché même s'il ne matche plus la saisie en
cours : filtrer la conversation qu'on regarde serait surprenant.

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

**The export is what the screen shows** — the rows after filters, search and sort, not the whole collection. Exporting everything would be a trap: filter on one month, export, and end up with the year without noticing. It follows that the export is a *client-side* operation over the rows already fetched — for a screen that loads its whole filtered set into memory up front (RH, Brouillard de caisse, Règlements clients, Échéances), that's simply `rows`. The button disables itself when there is nothing to export rather than producing an empty file that reads as a bug.

**A screen that paginates server-side used to export only the page it had on screen — reported as "Export sur Clients ne sort que les clients de la première page, pareil sur Cash et RH".** RH was never actually affected (its four tabs load their whole filtered set client-side and always exported `pager.filtered`, not a page slice), but Clients and Cash's Facturation tab do paginate server-side, and their `rows` genuinely only ever held the loaded page. `ExportButton` now takes an optional `fetchAllRows: () => Promise<T[]>`: when present, a click fetches everything matching the *same* filters — not the whole collection — before exporting, instead of exporting what happens to be loaded in memory; `rows` still drives the disabled state and the tooltip (an empty loaded page is still the simplest "nothing to export" signal), and the button shows a spinner while the fetch is in flight so a second click can't fire a second export mid-request. Two different fetch shapes, because the two routes disagree on how far a single call can reach:

- **`ClientsManagement.tsx`'s `fetchAllFilteredClients()`** builds the same query params as the normal fetch but omits `page` — `GET /api/clients` already has a bare-array branch for exactly that case (`req.query.page ? enrichedAll.slice(...) : enrichedAll`, kept for other unpaginated callers like the autocomplete), so omitting `page` alone gets the whole filtered set in one request, unsliced.
- **`CashManagement.tsx`'s `fetchAllFilteredInvoices()`** loops instead: `GET /api/invoices` caps `limit` at 500 per call with no unpaginated branch, so it pages through in chunks of 500 (same `q`/`kind` filters each time) until it's pulled everything the first response's `total` promised — the same "keep asking for more until you have it all" shape `App.tsx`'s "Charger plus" uses for the 200-row time-entries cap, just automatic instead of a button click.
- **`TimeTrackingTable.tsx`'s `fetchAllFilteredEntries()`** is the same chunked-loop shape as Cash's, against `GET /api/time-entries?limit=1000&offset=…` (1000 being that route's own per-call ceiling — see Scale constraints). Pointage's Export was the one screen left out when `fetchAllRows` was first built here: it kept exporting `filteredEntries`, capped by whatever "Charger plus" had loaded, which is the same 1000-row screen ceiling this section otherwise exists to route around. The loop's result is run back through the loaded page's own `matchesFilters()` predicate (status/client/mission/collaborateur/date range) — one function, not a second copy that could disagree with what's on screen — and deduplicated by id, since a RUNNING/PAUSED entry the server pins to the front of `offset=0` (see Scale constraints) would otherwise also turn up again at its natural position in a later chunk.

### Filtres de période et pagination (RH)

The four HR tabs — congés, autorisations, prêts, avances — share one implementation, [PeriodPager.tsx](src/components/PeriodPager.tsx): `usePeriodPage()` plus `<PeriodFilter>` and `<PaginationBar>`. Four copies would eventually answer "which month am I looking at" four different ways. Filtering is **year then month**, the order the Brouillard de caisse and the Échéances grid already use, so one gesture works everywhere. The date each tab filters on differs (`startDate`, `date`, `dateGranted`) and is passed in as `dateOf`.

Two things are load-bearing:

- **Call it with its explicit type argument** — `usePeriodPage<LeaveRow>(rows, dateOf)`. Left to inference, the `rows` / `dateOf` pair (the latter usually from a `useCallback`) collapses to `unknown` and the rendered rows lose their type, with the error surfacing in the JSX far from its cause.
- **The pagination bar sits outside the scrolling area and is `shrink-0`**, exactly like the Brouillard's. A `sticky bottom-0` inside the scrolling container is *not* equivalent and was the first attempt: its containing block was the same height as the scrollport, so there was no room to stick and the bar rendered below the fold — measured at y=1093 in an 850px viewport. Making the table the scrolling element is what actually pins it. The bar renders even on a single page — it carries the "X à Y sur Z" count, and a bar that appears and disappears makes the table jump.
- **Chaque scrollport porte un plancher (`sm:min-h-[260px]`), et la chaîne au-dessus ne force plus la descente.** `min-h-0` de bout en bout — sur le `<main>` de `HRManagement`, sur la carte et sur le scrollport — laissait le tableau se faire écraser par ce qui le précède : **mesuré à 112 px sur un 1280×720**, soit l'en-tête du tableau et une ligne et demie, et il n'y avait plus rien où défiler (c'est le symptôme remonté sur l'onglet Pointage, dont la carte d'arrivée/départ est le plus haut des blocs fixes). Le plancher remplace `min-h-0` sur le scrollport et `main`/carte gardent `flex-1` sans lui : sur un écran assez haut rien ne change (le tableau prend toute la place restante — 361 px à 1920×950), sur un écran court le contenu dépasse et c'est la colonne de l'application qui défile, la barre de pagination suivant le tableau dans le flux comme sur téléphone. Ne pas « réparer » cela en remettant `min-h-0` partout.

### Scale constraints

Sized for **hundreds of clients and dozens of users**. The rules that keep it there — breaking any one of them reintroduces a payload that grows without bound:

- **Nothing unbounded crosses the wire.** `GET /api/time-entries` returns a capped page (`ENTRIES_PAGE_SIZE`, newest first) as `{ data, total }`, and the SSE broadcast sends that same page — never the whole history. The KPI summary carries **aggregates only**: per-task lists come from `/api/kpi/client-tasks` and `/api/kpi/employee-tasks` on expand. Inlining a task list back into the summary took it from 219 KB to 3.2 MB at 300 clients / 6000 entries.

  **The cap was already lifted server-side (`?limit=`, up to 1000) — Pointage's "Suivi des tâches de l'équipe" just never asked for more than the default 200.** Past that count the table quietly dropped the oldest entries with no way to reach them from the screen — reported as tasks that showed up in the dashboard's aggregates (computed over the *whole* filtered set, never capped) but not in this table's own list. The fix stays client-side, not a bigger default: `App.tsx` tracks `entriesLimit` (starts at `ENTRIES_PAGE_SIZE`) and a **"Charger plus"** button in `TimeTrackingTable.tsx`'s footer — shown only while `totalEntries > entries.length` and the page hasn't hit the server's own 1000-row ceiling — raises it by another `ENTRIES_PAGE_SIZE` and re-fetches. A single `?limit=N` re-fetch can safely replace `timeEntries` wholesale (it's a superset of what's already shown), but the **SSE frame can't**: it always carries only the newest 200 regardless of what the client last asked for, so a live push right after "Charger plus" used to snap the list back down to 200. `onmessage` now merges instead of replacing — the fresh frame plus whatever was already loaded beyond it (`prev.filter(e => !frameIds.has(e.id))`), so a live update to a recent row can't silently evict older ones the user just pulled in. This is the "load more" shape, not the `PeriodPager` prev/next pagination the HR tabs and Brouillard use — that idiom assumes a static filtered set, and this table's head is constantly rewritten by the broadcast, which a page-flip UI can't represent cleanly.

  **A Du/Au date range sits in the same header**, the same idiom as the dashboard's own range picker — two `<input type="date">`, ISO by construction, compared as plain strings against `entry.date` rearranged from `DD/MM/YYYY` to `YYYY-MM-DD` (`toIsoDateKey()`), never through a `Date` object — the same "no timezone to get wrong" reasoning as `civilDateKeyTN` elsewhere. Like the status/client/mission filters already in this header, it's client-side over whatever's currently loaded: it doesn't fetch a narrower page from the server, so reaching further back than what's loaded means clicking "Charger plus" first, same as it always did before there was a date filter at all.

  **Pointage's own Export button used to be capped by this same 1000-row screen ceiling — it exported `filteredEntries`, i.e. only what "Charger plus" had already pulled into the browser.** A cabinet with 10 000 activities and a Du/Au range of "1 janvier – 31 mars" would export at most whatever was loaded, silently missing anything past it — the exact `fetchAllRows`-shaped gap the Export CSV section documents for Clients/Cash, just not yet fixed here. `TimeTrackingTable.tsx` now passes `fetchAllRows={fetchAllFilteredEntries}` to `<ExportButton>`, mirroring `CashManagement.tsx`'s `fetchAllFilteredInvoices()`: it loops `GET /api/time-entries?limit=1000&offset=…` in chunks of 1000 (the server's own per-call ceiling) until it has pulled everything `total` promised, then applies the *same* `matchesFilters()` predicate the loaded page already uses (status/client/mission/collaborateur/date range) — refactored out of the inline `filteredEntries` assignment into a named function so the loaded-page filter and the full-export filter can't drift apart. The 1000-row screen cap governs what "Charger plus" can reach on-screen; it no longer governs what Exporter can put in a file — a filtered export can cover the whole history regardless of how many activities exist.

  **Two time entries can never become unreachable inside the 1000-row window, however far back "Charger plus" would otherwise have to page to find them: whichever one is `RUNNING`, and every `PAUSED` one up to a cap of 100 — and all of them group together at the very top of the table, not just the ones that would otherwise have fallen outside the loaded page.** `withPinnedActiveEntries(all, page)` in server.ts runs on `GET /api/time-entries` (only at `offset === 0` — "Charger plus" and the initial load never ask for a nonzero offset, so this always covers the real default page without ever distorting an offset-walked page mid-scroll) and inside `doBroadcast()`'s per-role SSE frame. Nothing about the entry changes — not its `date`, not its position in the underlying array — only the *order of what this one response returns*; `total` still reports the true unbounded count for pagination. `PINNED_PAUSED_CAP = 100` is a safety valve the RUNNING side doesn't need: at most one entry per user can ever be RUNNING (`pauseOtherRunningEntries()`), but nothing bounds how many a user leaves PAUSED over time, and "nothing unbounded crosses the wire" (this section's own first rule) would otherwise be exactly what an unpaused backlog violates.

  **The first version only pinned RUNNING/PAUSED entries the natural newest-first slice had left out — one still in reach of `page` on its own stayed at its natural position, mixed in among `COMPLETED` rows.** That read as a half-applied rule: some paused tasks sat at the very top, others further down the table, with nothing distinguishing which got which treatment except how much other activity had happened since. `withPinnedActiveEntries()` now always computes the *full* set of RUNNING/PAUSED entries from `all` first — whether or not they were already inside `page` — and only then removes any of `page`'s own rows that duplicate one of those (`rest = page.filter(e => !pinnedIds.has(e.id))`), so nothing is ever counted or sent twice. The response length is unchanged either way; only the grouping is — every active/paused task now sits together at the top, always, and only `COMPLETED` rows can end up further down.

  **`TimeTrackingTable.tsx` used to re-group the server's own order into collapsible month buckets (newest month first), and that grouping quietly undid the pinning guarantee above.** A `RUNNING` task dated in an older calendar month sorted *under* `COMPLETED` rows from a newer month, because the table grouped by `entry.date` before it ever looked at `statut` — the exact "some tasks pinned to the top, some not" symptom the pinning fix above exists to prevent, reintroduced one layer up. Removed outright at the user's request: the table now renders `filteredEntries` as one flat `<tbody>`, in the order the server already sent, with no grouping, no month header row, and no collapse state (`collapsedMonths`/`toggleMonth`/`MONTHS`/`groupedEntries`/`sortedMonthKeys` are gone, not merely hidden). `filteredEntries = entries.filter(matchesFilters)` — `Array.prototype.filter` never reorders — so RUNNING-then-PAUSED-then-rest survives filtering intact; a single-status filter (e.g. "Terminées") makes the ordering moot for that view, same as before.
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

**L'échéance se saisit à la main, donc elle doit se voir quand elle manque.**
`dueDateOf()` (fin d'essai tant que rien n'est payé, fin d'abonnement ensuite)
est l'unique définition, lue par la colonne *et* par le filtre « Toutes les
échéances / à saisir / passée / sous 30 jours » — deux copies finiraient par ne
plus désigner la même date. Un compte en essai ou actif sans échéance affiche
**« À définir »** en ambre plutôt qu'un tiret muet : c'est précisément la ligne
qu'on cherche pour relancer, et un tiret la laissait passer inaperçue. Un compte
expiré ou suspendu garde le tiret — il n'y a rien à y échoir.

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

**« Missions & types de tâche » ([TaskIntelligence.tsx](src/components/dashboard/TaskIntelligence.tsx)) dit où part le temps — jamais une rentabilité.** `missions` dans la réponse d'`/api/dashboard/executive` agrège les mêmes `entries` déjà filtrées, par `pole` puis par `taskType` à l'intérieur de chaque mission (un type de tâche se juge dans sa mission, même règle que partout ailleurs dans l'app) : heures, tâches, collaborateurs et clients distincts, durée moyenne, et `cout` **seulement** quand `showMoney` — la même garde que le reste de la route, jamais envoyé à un non-ADMIN plutôt que simplement masqué. Délibérément aucune marge ni rentabilité par mission ou type : rien ne relie une tâche à une facture (Q-03 ci-dessus), donc en inventer une ici serait exactement ce que la règle des taux interdit. C'est un outil opérationnel — un type de tâche qui consomme 30 % du temps se voit — pas un outil de tarification.

**Le tableau de performance affiche enfin la capacité et l'occupation que les alertes A7/A8 lui reprochent déjà.** `exec.collaborateurs` (capacité nette, taux d'occupation, évolution) était calculé depuis le début pour ces deux alertes, mais jamais transporté jusqu'à [EmployeeTable.tsx](src/components/dashboard/EmployeeTable.tsx), qui lit `/api/kpi/dashboard` — une route distincte, sans ces champs. `AdminDashboard.tsx` fusionne les deux par `userId` avant de les passer au tableau plutôt que de dupliquer le calcul côté serveur, pour que les deux routes gardent leur périmètre propre. `exec.collaborateurs` ne porte pas la ligne ADMIN (construit sur `employees`/`STAFF_ROLES`, sans le complément que `performanceUsers` ajoute dans `/api/kpi/dashboard`) : la ligne d'un administrateur dans le tableau affiche donc « — » en occupation, ce qui est correct — cette donnée n'existe simplement pas pour lui à cet endroit.

### Dashboard charts

**`DashboardCharts.tsx` (Congés, Autorisations d'absence, Volume de tâches par collaborateur, Taux de réalisation) a été retiré du tableau de bord Admin, à la demande de l'utilisateur — le fichier a été supprimé, pas laissé en dead code.** Ce que ces quatre graphiques montraient reste lisible ailleurs sous une forme plus dense : le volume de tâches et le taux de réalisation sont des colonnes de [EmployeeTable.tsx](src/components/dashboard/EmployeeTable.tsx) ; les congés et les autorisations vivent dans leurs propres onglets RH. Ne pas les reconstruire ici sans demande explicite — c'était précisément le doublon qu'on a retiré.

Le seul graphique restant sur ce tableau de bord est le nuage de points de [ClientProfitability.tsx](src/components/dashboard/ClientProfitability.tsx) (heures × taux de marge, taille du point = honoraires), et il suit toujours les règles dataviz du projet : **catégories dans un ordre fixe, jamais recyclées** ; **une légende dès qu'il y a ≥ 2 séries** ; **une seule mesure par axe** ; et **couleur par entité, jamais par rang** — ses quatre zones (Perte/Marge faible/Saine/Non facturé) sont assignées par la situation du client, pas par sa position dans le tri, pour ne pas repeindre le nuage à chaque changement de tri ou de filtre.

Le per-client breakdown ([ClientBreakdown.tsx](src/components/dashboard/ClientBreakdown.tsx)) reste une **table, pas un graphique** — plusieurs mesures par ligne plus un drill-down, c'est du travail tabulaire. Les montants y utilisent `formatCostTND` partout, y compris le total de ligne, pour qu'un total et ses parties ne soient jamais affichés à des précisions différentes.

**Trois tables ont maintenant des en-têtes de colonne cliquables avec flèche de tri** ([ClientProfitability.tsx](src/components/dashboard/ClientProfitability.tsx), [TaskIntelligence.tsx](src/components/dashboard/TaskIntelligence.tsx), [ClientBreakdown.tsx](src/components/dashboard/ClientBreakdown.tsx)) — le même idiome que [EmployeeTable.tsx](src/components/dashboard/EmployeeTable.tsx) pratiquait déjà seul (`ArrowUpDown` au repos, `ArrowUp`/`ArrowDown` une fois la colonne active, un second clic inverse le sens). Les deux premières avaient un `<select>` de tri à la place — retiré, parce que deux façons de faire la même chose sur le même écran finissent par ne plus être lues comme équivalentes. Une valeur `null` (taux de marge « n/a », honoraires/heure indéfini) va **toujours en fin de liste, quel que soit le sens du tri** — elle n'est ni la plus grande ni la plus petite, elle est hors classement, et la mêler au tri numérique la ferait lire comme un zéro qu'elle n'est pas.

**Le tableau de bord Admin se lit maintenant comme une suite de questions, pas une pile de cartes.** `SectionHeading` (dans `AdminDashboard.tsx`, pas un fichier à part — trop petit pour ça) place un intitulé au-dessus de chaque groupe de cartes qui répond ensemble à une seule question : « 01 · Vue d'ensemble — Comment va l'entreprise ? », « 02 · Rentabilité — Où est l'argent ? », « 03 · Opérations — Où part le temps ? », « 04 · Clients & équipe — Qui fait quoi ? ». C'est un cran au-dessus des en-têtes de carte existants (« RENTABILITÉ DU PORTEFEUILLE », « MISSIONS & TYPES DE TÂCHE »…), qui eux nomment une carte — celui-ci nomme le groupe, et le titre est la question elle-même plutôt qu'un nom de module.

**Le filtre du tableau de bord (période, collaborateur, client) s'applique à tout ce qui s'y affiche, sans exception.** C'était déjà vrai de tout ce qui vient de `/api/kpi/dashboard` et `/api/dashboard/executive` — les deux routes reçoivent le même corps de filtres depuis `fetchKPIs()`. La carte Ressources métier retirée ci-dessus était le seul bloc qui n'en respectait aucun ; sa suppression ferme cet écart-là.

**« Reste à encaisser » a d'abord été un stock, tous exercices, avant de suivre le filtre de dates lui aussi — à la demande explicite de l'utilisateur.** `resteAEncaisser`/`creancesEchues` calculaient à l'origine le solde global de chaque client (mêmes chiffres que la page Clients, pour que les deux écrans ne puissent jamais se contredire), délibérément hors du filtre de période puisque c'était un stock et non une grandeur de la période. En pratique, un mois sans aucune activité gardait alors la même valeur qu'un mois chargé — ce qui se lisait comme un chiffre figé plutôt que comme un solde global assumé, même une fois une mention « toutes périodes » ajoutée à la carte. « Grand-livre client » dans `/api/dashboard/executive` calcule désormais **facturé moins encaissé sur la période sélectionnée** : `periodInvoices` (déjà filtré par dates, client et devise, comme pour `honoraires`) net des règlements — journal de caisse et encaissements manuels du client — dont la date tombe dans la même période. `soldeAnterieur`, un solde d'ouverture sans date propre, est délibérément exclu de ce calcul : l'additionner à chaque période l'aurait fait compter indéfiniment, mois après mois, ce qui n'est pas ce qu'un filtre demande. Les créances échues suivent la même restriction : seules les factures **émises sur la période** entrent dans le majorant, plafonné au reste dû sur cette même période.

Ce chiffre peut désormais diverger de celui de la page Clients — et c'est assumé : les deux répondent à des questions différentes (« combien reste dû au total, depuis toujours » contre « combien a été facturé et encaissé net sur cette période »), pas à la même. Le filtre **client** continue de s'appliquer normalement par-dessus — restreindre à un ou plusieurs clients ne change pas ce que vaut le solde-période de chacun, seulement combien on en additionne.

**Cinq cartes sont repliées par défaut** — Ce qui demande une décision
(`AlertsPanel.tsx`), Rentabilité du portefeuille (`ClientProfitability.tsx`),
Concentration du portefeuille (`ConcentrationCard.tsx`), Missions & types de
tâche (`TaskIntelligence.tsx`), Activité par client (`ClientBreakdown.tsx`) —
chacune derrière un chevron dans son propre en-tête (`ChevronRight` replié,
`ChevronDown` déplié, le même idiome que le sous-toggle « Détail par
client »/« Détail par mission » que Rentabilité et Missions portaient déjà).
Aucun `CollapsibleCard` partagé : cinq en-têtes déjà différents (badges,
recherche, case à cocher) auraient forcé une abstraction avant qu'elle ne
serve à rien d'autre — chaque carte porte son propre `useState`.

**Trois de ces cinq sont contrôlées depuis `AdminDashboard.tsx`, pas en
interne** — Ce qui demande une décision, Rentabilité du portefeuille et
Activité par client, parce que trois raccourcis d'écran pointent directement
dessus : les liens de l'`ExecutiveBar` (« Ce qui demande une décision »,
un total de clients en alerte), le clic sur une alerte dont l'entité est un
client, et `focusOnClient()` (déclenché aussi depuis une ligne de
Rentabilité). Chacun de ces trois fait défiler l'écran vers un `id` ancre
(`dashboard-alertes`/`dashboard-rentabilite`/`dashboard-activite-client`) —
et sans forcer aussi `open` à `true` au même moment, le raccourci amènerait
sur un en-tête replié, vide de tout contenu : exactement la régression que
ces trois auraient introduite si l'état était resté local à chaque carte
comme pour Concentration et Missions, qu'aucun raccourci ne cible.

**Le filtre de dates porte un bouton « Aujourd'hui »**, au même rang que
« Filtrer par mois »/« Filtrer par année » — le plus fin des trois raccourcis
(jour, puis mois, puis année), qui écrit dans les mêmes `startDate`/`endDate`
que les deux autres et se désélectionne donc pareil dès qu'on touche une
date ou choisit un mois/une année.

### Task assignments and notifications

An admin (gated on `ASSIGN_TASKS`, not a raw role check — the permission can be delegated the same way `MANAGE_SERVICES`/`ASSIGN_TASKS` etc. already are) hands a mission + type de tâche to a staff member from a button in Pointage ([AssignTaskModal.tsx](src/components/AssignTaskModal.tsx)), which reuses the same client-search-and-mission-cascade UI as [NewTaskCard.tsx](src/components/NewTaskCard.tsx).

L'assignation reste **en attente** — dans **Tâches**, sous ses sous-vues [TaskSubviews.tsx](src/components/TaskSubviews.tsx) : « Mes tâches planifiées » (ce que vous vous êtes réservé), « Tâches déléguées » (ce qu'on vous a délégué), et pour qui tient `ASSIGN_TASKS`, « Déléguées par moi ». Les deux premières vivaient dans une carte du tableau de bord (`AssignedTasksCard`, montée sur les *deux* tableaux de bord parce que `STAFF_ROLES` déborde des rôles qui voient MyDashboard) ; elles sont maintenant là où on les démarre, puisque démarrer une tâche crée une entrée de pointage — c'est-à-dire l'onglet d'à côté, et non plus une traversée « tableau de bord → Tâches ». La carte a été **supprimée**, pas laissée en double : deux endroits qui listent les mêmes tâches finissent par n'en montrer qu'un des deux à jour.

**Le délégateur avait un bouton pour déléguer et aucun moyen de savoir ce qu'il en était advenu ensuite.** `/api/task-assignments/mine` ne répond qu'à « qu'est-ce qui m'est assigné » (`assignedToUserId === moi`), donc une tâche confiée à quelqu'un d'autre — pendante ou démarrée — n'apparaissait nulle part côté délégateur. `GET /api/task-assignments/delegated` comble ça : tout ce que `assignedByUserId === moi` a confié à un tiers, en lecture seule (démarrer/annuler restent l'affaire de l'assignataire, ou du délégateur pendant que c'est encore `PENDING`, via la route `DELETE` existante). Le statut qu'il rend n'est **jamais** celui, figé, de l'assignation elle-même — `PENDING`/`STARTED` ne racontent que la moitié de l'histoire une fois démarrée. Une fois `STARTED`, la route relit le `statut` (`RUNNING`/`PAUSED`/`COMPLETED`) de l'entrée de pointage que le démarrage a fait naître (`timeEntryId`), la même source que Pointage lui-même, pour que le délégateur voie une progression vivante et pas un « démarrée » qui ne bouge plus. L'onglet n'existe dans `TABS` que pour qui a `ASSIGN_TASKS` — comme le bouton « Déléguer une tâche » lui-même, un onglet toujours vide n'apprend rien à qui ne délègue jamais.

**« Déléguées par moi » porte quatre filtres cherchables** (`DelegatedByMeList` dans [TaskSubviews.tsx](src/components/TaskSubviews.tsx)) — collaborateur, mission, type de tâche, statut — chacun un `SearchableSelect` (le même composant que le sélecteur de mission/type de tâche de Pointage, et que les filtres de l'Historique de Ressources métier) plutôt qu'un `<select>` natif : taper la première lettre suggère, cliquer sélectionne, une option « Tous… » en tête remet le filtre à zéro. Les options sont dérivées des lignes déjà reçues (jamais un second appel réseau), et le filtre statut lit ses libellés dans `DELEGATED_STATUS_LABEL` (« En attente »/« En cours »/« En pause »/« Terminée ») plutôt que dans les codes bruts `PENDING`/`RUNNING`/`PAUSED`/`COMPLETED`, pour rester cohérent avec le badge déjà affiché sur chaque ligne.

La liste filtrée est **paginée à 15 lignes**, via `usePeriodPage`/`PaginationBar` de [PeriodPager.tsx](src/components/PeriodPager.tsx) — réutilisé pour sa seule mécanique de pagination, sans rendre son filtre année/mois que rien n'a demandé ici. Chaque changement de filtre remet la page à 1, même règle que l'Historique de Ressources métier — sinon un filtre qui réduit le nombre de pages laisserait la liste sur une page devenue vide. La barre est **toujours visible**, y compris sur une page unique : même règle que le Brouillard de caisse et les onglets RH, pour qu'elle n'apparaisse ni ne disparaisse au gré du nombre de lignes.

**« Toujours visible » veut dire atteignable sans faire défiler la page, pas seulement toujours rendue.** Un premier jet laissait la carte grandir avec la liste et comptait sur le défilement de la page pour atteindre « Suivant » — sur 15 lignes ça tenait dans l'écran, mais c'était déjà le piège que `sticky bottom-0` documente ailleurs : la barre existait toujours dans le DOM sans être toujours *visible*. La liste défile maintenant dans son propre cadre (`overflow-auto flex-1 min-h-0 sm:min-h-[260px]`), et la barre reste hors de ce cadre, `shrink-0` par construction du flux — même montage que les onglets RH et le Brouillard de caisse. Ça remonte toute la chaîne : le `<main>` Tâches d'[App.tsx](src/App.tsx) porte `sm:min-h-0`, le conteneur racine de `TaskSubviews` et son bloc d'onglet actif portent `sm:flex-1 sm:min-h-0`, jusqu'à la carte de `DelegatedByMeList`. Le `sm:` préserve le mobile, qui continue de défiler la page entière comme HRManagement le fait déjà pour ses propres onglets.

Trois choses à garder dans ce montage :

- **Une seule liste au serveur, deux sous-vues à l'écran.** `/api/task-assignments/mine` rend tout ce qui vous est assigné et en attente ; ce qui les sépare est `assignedByUserId` — vous, ou quelqu'un d'autre. C'est la distinction que l'ancienne carte imprimait ligne par ligne (« Planifiée par vous » / « Assignée par X »), rendue en onglets plutôt qu'en mentions à lire.
- **Un seul chargement pour les deux**, à l'ouverture de Tâches et quel que soit l'onglet : les compteurs des onglets doivent être justes *avant* qu'on clique dessus, sinon rien ne signale la tâche qui attend. C'est aussi ce chargement qui déclenche les **rappels** — la route les transforme paresseusement en notification, faute de balayage périodique dans cette app — là où c'était l'ouverture du tableau de bord qui s'en chargeait.
- **L'en-tête et ses deux boutons restent au-dessus de la barre d'onglets** : « Planifier une tâche » se clique aussi bien depuis la liste des tâches planifiées, et un état vide qui renvoie à un bouton caché ne sert à rien.

**Starting** an assignment (`PUT /api/task-assignments/:id/start`, assignee-only) does not create a second kind of record — it calls `createRunningEntryForUser()`, the exact same helper `POST /api/time-entries` calls, so it obeys the one-running-task-per-person rule. Comme la sous-vue est désormais dans la même page que le chrono, le démarrage **rebascule sur « Mon chrono » et redemande les entrées** (`onStarted`) : la tâche part de la liste, il faut qu'elle réapparaisse quelque part, sinon le clic se lit comme une suppression. Toujours pas de poussée en direct pour autant — c'est un `fetch` de plus au clic, pas un flux, et le SSE ne se connecte que sur Pointage.

**Planifier/déléguer une tâche recharge la liste sans qu'on ait à rafraîchir la page.** `PlanTaskModal`/`AssignTaskModal` sont montées par `App.tsx` au niveau de la page — au-dessus de `TaskSubviews`, pas dedans — donc une création n'a aucun moyen d'appeler son `load()` directement. Un événement `refresh-task-assignments` sur `window` comble ça, même idiome que `refresh-hr-balance` pour le solde de congés : les deux modales le déclenchent après une création réussie, `TaskSubviews` l'écoute en plus de son chargement au montage. Sans lui la nouvelle tâche n'apparaissait qu'au prochain montage du composant — en pratique, au rechargement de la page.

**`AssignTaskModal` délègue à plusieurs collaborateurs à la fois.** Le champ « Collaborateur » était un `<select>` à choix unique ; c'est maintenant une liste à cocher (même idiome que le sélecteur de participants de [GroupModal.tsx](src/components/chat/GroupModal.tsx) — bordée, défilante, un compteur « N sélectionné(s) », une recherche repliant les accents dès que l'effectif dépasse six). `POST /api/task-assignments` reste inchangé côté serveur — un seul `assignedToUserId` par appel — parce que le reste du système (démarrage, statut, progression) raisonne par assignation individuelle ; le client envoie donc une requête par collaborateur coché (`Promise.allSettled`, en parallèle plutôt qu'une par une), et un refus isolé n'empêche pas les autres délégations de réussir. L'écran de fin et le toast s'accordent au pluriel (« Tâche déléguée à 3 collaborateurs. ») quand plusieurs ont réussi.

**Cliquer la notification d'une tâche déléguée amenait sur le tableau de bord, plus sur Tâches.** `TYPE_META.TASK_ASSIGNED.nav` (et `TASK_REMINDER`, même bug) pointait encore vers `'Dashboard'` — un reliquat d'avant le retrait d'`AssignedTasksCard` du tableau de bord (voir plus haut) : la carte est partie, la destination de la notification n'avait jamais suivi. Les deux pointent maintenant vers `'Time Tracking'`, l'id de nav sous lequel vit **Tâches** (le libellé affiché dans la barre latérale ; il n'existe pas d'id de nav séparé pour Tâches — voir « Navigation has no router »), aussi bien côté `NotificationBell.tsx` (clic en direct) que côté serveur (`PUSH_NAV_FOR_TYPE`, pour un push reçu app fermée).

Atterrir sur la bonne page ne suffit pas : **Tâches** n'a pas de sous-onglet dans l'URL — `TaskSubviews.tsx` garde « Mon chrono »/« Mes tâches planifiées »/« Tâches déléguées » en état local, remis à zéro à chaque montage. `NotificationBell.tsx` pousse donc le sous-onglet voulu en plus de la section (`TASK_ASSIGNED` → `assigned`, une tâche qu'on vous a déléguée ; `TASK_REMINDER` → `planned`, un rappel sur une tâche que vous vous étiez planifiée), par deux voies complémentaires : un `sessionStorage` lu une fois par l'état initial de `tab` dans `TaskSubviews` — même idiome que le `?nav=` qu'un push app-fermée laisse à App.tsx pour son propre `activeSidebarItem` — pour le cas où Tâches n'est pas encore montée, et un événement `open-task-subview` sur `window`, écouté en plus, pour le cas où elle l'est déjà (l'utilisateur regardait Pointage quand la notification est arrivée).

**Le vocabulaire de la notification et de l'écran suit « déléguer », plus « assigner ».** Le titre server-side (`'Nouvelle tâche assignée'` → `'Nouvelle tâche déléguée'`), le corps (« vous a assigné » → « vous a délégué »), le toast de confirmation d'App.tsx et la mention « Assignée par X » de la liste « Tâches déléguées » ont tous été réalignés — l'onglet s'appelle « Tâches déléguées » et le bouton « Déléguer une tâche » depuis le début, « assignée » n'était qu'un reliquat du nom de route (`/api/task-assignments`, resté inchangé : c'est un identifiant technique, pas un libellé).

Notifications (`notifications` collection, `GET/PUT /api/notifications*`) are generic — `type` decides both the icon and where the bell sends you on click (`TYPE_META` in [NotificationBell.tsx](src/components/NotificationBell.tsx)). Wired at four more places besides task assignment: a leave/absence request notifies its chosen `approverId` directly (no need to scan every user's permissions — the requester already picked one approver), and an approve/reject decision notifies the requester back. The `notify()` helper in server.ts is a `function` declaration, not a `const` arrow — it has to be callable from the HR routes, which are registered earlier in `startServer()` than the point where it is defined; declarations are hoisted through the whole function body, a `const` would not be visible yet at that point in execution.

**Une notification RH atterrissait sur RH, mais pas forcément sur le bon onglet.** `nav: 'HR'` dans `TYPE_META` n'ouvre que la page — comme pour Tâches (voir juste au-dessus), RH n'a pas de sous-onglet dans l'URL : [HRManagement.tsx](src/components/hr/HRManagement.tsx) garde `activeTab` en état local, par défaut sur « Congés ». Une notification `ABSENCE_REQUEST`/`ABSENCE_DECISION` cliquée retombait donc systématiquement sur « Congés » au lieu de « Autorisations d'absence » — le bug remonté. `HR_TAB_FOR_TYPE` dans NotificationBell.tsx mappe chaque type RH vers l'onglet qui le montre réellement (`LEAVE_REQUEST`/`LEAVE_DECISION` → `leaves`, `ABSENCE_REQUEST`/`ABSENCE_DECISION` → `absences`, `LOAN_REQUEST`/`LOAN_DECISION` → `loans`, `ADVANCE_REQUEST`/`ADVANCE_DECISION` → `advances`), et `openNotification()` le pousse par les **mêmes deux voies** que `open-task-subview` : un `sessionStorage` (`open_hr_subview`) lu une fois par l'état initial d'`activeTab` — pour le cas où RH n'est pas encore montée — et un événement `open-hr-subview` sur `window`, écouté en plus, pour le cas où elle l'est déjà (l'utilisateur regardait un autre onglet RH, ou une autre page ouverte dans un second onglet du navigateur, quand la notification est arrivée). Aucune notification ne cible aujourd'hui Pointage/Prêts/Jours fériés autrement qu'en tombant sur leur onglet par défaut respectif, donc rien de plus n'était à câbler pour l'instant ; le même schéma (type de notification → sous-onglet, sessionStorage + événement `window`) s'applique tel quel si une nouvelle sous-vue en a un jour besoin.

**Un rappel mensuel prévient ADMIN et SUPERVISEUR de mettre à jour la grille des échéances.** Même idiome que le rappel de tâche planifiée et que les semis de catalogue : il n'existe aucun balayage périodique dans cette application, donc « un nouveau mois a commencé » se détecte paresseusement — dans `authenticate`, à la prochaine requête de **n'importe quel** compte de l'entreprise, pas seulement celle d'un administrateur, exactement comme `seedSectorMissions`/`seedResourceLibraryFor` juste à côté. `maybeSendEcheanceReminder()` compare le mois civil courant (`formatDateISO`, donc dans `APP_TIMEZONE`) à `company.echeanceReminderSentMonth` ; s'ils diffèrent, une notification `ECHEANCE_REMINDER` part vers chaque compte `DASHBOARD_ROLES` (ADMIN + SUPERVISEUR — le même duo que le tableau de bord, pas une nouvelle liste), puis le mois est écrit sur la fiche entreprise **après coup**, comme les autres semis, pour qu'une exécution interrompue avant d'avoir notifié tout le monde se rejoue plutôt que de marquer le mois comme fait à tort. Une pose en vol par entreprise (`echeanceReminderInFlight`) évite qu'une rafale de requêtes simultanées au tout début du mois n'envoie chacune sa propre salve. Réservé aux secteurs où `companyHasResourcesModule` ouvre déjà Ressources métier — écrire ce rappel pour un secteur qui n'a pas cet écran n'aurait aucun sens. `ECHEANCE_REMINDER` suit le même câblage que tout le reste : `TYPE_META`/`TOAST_VARIANT` dans NotificationBell.tsx, `PUSH_NAV_FOR_TYPE` côté serveur, tous les deux pointant vers Ressources métier.

**Deux gardes de plus, ajoutées après coup.** Le rappel partait pour une entreprise tout juste créée — sur son tout premier login, avant même la moindre fiche client — parce que la seule garde jusque-là était sectorielle. Deux cas manquaient : une offre restreinte (RH & Paie, Facturation) qui ne vend pas le module Ressources ne voit pas l'écran Échéances non plus, donc `maybeSendEcheanceReminder()` refuse maintenant aussi quand `planAllowsModule(company.plan, 'Ressources')` est faux — même garde que celle qui ferme déjà les routes du module dans `authenticate`, juste répétée ici puisque le rappel part en dehors du chemin des routes. Et une entreprise sans le moindre client n'a rien à porter sur une grille qui se lit par client : le rappel attend maintenant `(await db.getAllClients(company.id)).length > 0` avant d'envoyer quoi que ce soit. Les deux `return` précoces sautent aussi l'écriture d'`echeanceReminderSentMonth` — sans client, le mois n'est jamais marqué fait, donc le premier client créé fait naître le rappel à la requête suivante, dans le mois civil en cours, sans qu'il ait fallu attendre le mois d'après.

**Chat unread counts are not duplicated into notifications.** The bell reads `GET /api/messages/contacts` directly (the same endpoint ChatPage already uses) and synthesizes a "message" row per contact with unread messages, rather than writing a notification row on every message sent that would then need to be kept in sync with `readAt` on the thread. One source of truth for "is this message read", not two.

**The toast for a new message used to disappear on every page reload, not just at first-ever login.** `NotificationBell` tracks two things purely to decide when to fire a toast: which notification ids have already been announced (`notifiedIds`), and the last unread count seen per contact (`lastUnreadByContact`) — a genuine increase is what triggers a toast. Both lived only in a `useRef`, seeded silently (no toast) on whichever poll happened to be the first one the component ever ran, specifically so opening the app didn't replay a backlog as a burst of toasts. The bug: a `useRef` starts over on **every remount**, and a full page reload is a remount — so the "first poll ever" guard actually fired on every reload, silently absorbing whatever was unread *at that exact instant* as the new baseline. A message that arrived and was reloaded past before the next 20s poll got announced never — while the same message, had the tab stayed open, would have toasted normally. That is exactly what read as "sometimes it arrives, sometimes not": it depended on whether the admin's tab happened to already be open when the client's message landed. The fix persists both sets to `localStorage`, scoped per user (`notif_seen_<id>` / `msg_unread_seen_<id>`, plus a `_init` flag marking that the true first-ever seed already happened on this device) — a reload now continues comparing against where the previous session left off instead of re-seeding, while a genuinely new device/login still gets the original silent-seed behaviour once. `notifiedIds` is pruned to whatever ids are still in the current `/api/notifications` response before being persisted, so it can't grow without bound on an account that stays logged in for months.

**A push notification could arrive on the phone (the OS-level toast) without ever showing up in the bell once the app was reopened.** `notify()` always writes the durable `notifications` row *before* attempting the push fan-out, so the row was never actually missing server-side — `GET /api/notifications` always had it. The gap was on the client: `NotificationBell.tsx`'s `refresh()` only ran on mount plus every 20s via `setInterval`, and a backgrounded mobile tab (screen locked, app minimised) can have that interval throttled or fully suspended by the browser — so reopening the app could sit on stale `items` for minutes before the next tick, which reads exactly like "I get the notification on my phone but I can't find it in the platform." A `visibilitychange`/`focus` listener now calls `refresh()` immediately whenever the page comes back to the foreground — the same "beat immediately on the transition that must feel instant" idiom `PresenceContext` already uses for AWAY→ACTIVE. This also covers the other half of the same symptom for free: when `sw.js`'s `notificationclick` handler finds an existing tab and calls `existing.focus()` rather than opening a new one, that focus is exactly what fires `visibilitychange` in that tab — no change to `sw.js` needed.

### Leave balances

### Leave balances

A balance is stored as `{ userId, entitlement, used }` — **`available` is always derived** (`entitlement - used`), never stored. `entitlement` is the annual allowance the admin sets per user in the Users form (`soldeConge` on the users API); `used` is the only thing approve/cancel move. `normalizeBalance()` in [database.ts](src/server/database.ts) migrates legacy rows that stored a decrementing `available` by recovering `entitlement = available + used`.

Never subtract `daysTaken` from `available` when displaying a remainder — `available` is already net of it. Doing so was double-counting and made the dashboard disagree with the HR page for the same user.

**A leave's `duration` is inclusive of both endpoints.** [LeavesTab.tsx](src/components/hr/LeavesTab.tsx) computes it client-side from the two date pickers as `(end - start) / 86400000 + 1` — a leave from the 14th to the 15th is two calendar days off, not the one-day gap a bare timestamp subtraction gives. Before the `+ 1` a same-day request (start === end) came out to zero, which is why the form also carried a warning telling the user the dates couldn't be identical; that warning is gone now that a single day is a valid, correctly-priced request. `POST /api/hr/leaves` takes `duration` as sent by the client and does not recompute it — nothing here is server-derived.

**Le motif est obligatoire, sur les deux formulaires.** [LeavesTab.tsx](src/components/hr/LeavesTab.tsx) (`Motif`, un texte libre) et [AbsencesTab.tsx](src/components/hr/AbsencesTab.tsx) (`Motif`, une liste de catégories qui n'a jamais de valeur vide — `Commentaire` reste, lui, optionnel) portent déjà `required` côté champ, mais rien n'empêchait d'appeler `POST /api/hr/leaves` ou `POST /api/hr/authorizations` directement avec un motif vide ou blanc. Les deux routes le refusent maintenant (`400`, « Le motif est obligatoire ») — ceinture et bretelles, comme le reste de la validation serveur dans l'app.

### Calendrier des jours fériés

Un sixième onglet RH, [HolidaysTab.tsx](src/components/hr/HolidaysTab.tsx), tient la liste des jours fériés du cabinet — `{id, date: 'YYYY-MM-DD', label}` sur `publicHolidays`, groupée par année, admin-éditable via `GET/POST/PUT/DELETE /api/hr/holidays`. Lecture derrière `VIEW_HR` (le même que le reste de RH), écriture derrière `MANAGE_LEAVE_REQUESTS` — pas une permission dédiée : c'est déjà le rôle « gère la RH » que porte l'admin ou un responsable RH délégué, et `requirePermission` court-circuite de toute façon pour ADMIN.

**C'est un calendrier de référence, pas une règle appliquée.** Aucune route de pointage (`/api/time-entries`, `/api/attendance`) ne lit `publicHolidays` — une date qui y figure ne bloque aucune saisie, n'en pré-remplit aucune, et n'entre dans aucun calcul de capacité ou de retard. C'était la demande explicite : le pointage d'un utilisateur reste entièrement indépendant de ce calendrier. Le composant l'affiche en toutes lettres au-dessus de la liste, pour que ça ne se lise pas comme un oubli. `EcheancesGrid`'s capacity note ("les jours fériés ne sont pas modélisés") reste donc exacte pour la capacité nette du tableau de bord — ce calendrier ne l'alimente pas.

La date est une date civile pure, saisie via `<input type="date">` (ISO `YYYY-MM-DD`), jamais un instant — `fmtHoliday()` la parse à la main (`y, m, d` puis `new Date(y, m-1, d)` pour le jour de la semaine) plutôt que via `new Date('YYYY-MM-DD')`, qui l'interprète en UTC et peut afficher la veille selon le fuseau du navigateur, le même piège que `civilDateKeyTN` documente ailleurs.

### Navigation has no router

[App.tsx](src/App.tsx) is a chain of ternaries on the `activeSidebarItem` string (`'Dashboard' | 'Clients' | 'Time Tracking' | 'Messages' | 'Missions' | 'Ressources' | 'Cash' | 'HR' | 'Users'`), persisted to `localStorage.active_nav` so a refresh keeps you in place. (`'Payroll'` used to be a nav id of its own — see "GRH & Paie merges RH and Payroll" below for why it no longer is.) Adding a page = add an entry to `mainNavItems` in [Sidebar.tsx](src/components/Sidebar.tsx) (with its permission guard), a branch in App.tsx with the matching guard, **and** the id to `NAV_IDS` — an id missing from that list silently fails to restore. (A "Reports" nav entry existed with no matching App.tsx branch — clicking it rendered nothing — and was removed outright rather than wired up, since nothing had asked for a Reports page.)

Because there is no URL state, anything that remounts the app loses the current page. That is why the watcher note above matters.

**The internal nav ids (`'Time Tracking'`, `'Ressources'`, `'Cash'`) and their displayed labels are two different things, and only the labels were ever meant to change.** The sidebar shows "Gestion des tâches" / "Outils de travail" / "Facturation & Trésorerie" today — renamed at the user's request from "Tâches" / "Ressources métier" / "Cash" — but `NAV_IDS`, `activeSidebarItem`, `PlanModule`, `PLAN_MODULE_ROUTES`, `PERMISSION_MODULE` and every `activeNav === 'Cash'`-style comparison still key on the old short ids: renaming those too would mean re-threading the same string through `authenticate`'s module whitelist, every plan's `modules` array and every permission-group mapping in server.ts and plans.ts for no user-visible benefit — exactly the "un troisième vocabulaire pour dire « la page Cash » finirait par ne plus désigner la même page" trap plans.ts already documents. So only the label strings moved: `Sidebar.tsx`'s `mainNavItems` labels, `translations.ts`'s `nav.timeTracking` (both locales), the two page `<h1>`s ([CashManagement.tsx](src/components/cash/CashManagement.tsx), [ResourcesManagement.tsx](src/components/resources/ResourcesManagement.tsx)), the matching permission-group headers in [UsersManagement.tsx](src/components/UsersManagement.tsx) ("Ressources Métier"/"Cash (Facturation)" → "Outils de travail"/"Facturation & Trésorerie"), a handful of literal in-app pointers ("apparaît maintenant dans Tâches → …", "se saisissent dans Cash → …") in `PlanTaskModal.tsx`/`AssignTaskModal.tsx`/`ClientsManagement.tsx`, the landing page's module-grid card title and pricing bullet for Ressources métier, and the hero headline (see below) — never the ids these all still route through. Doc comments referencing "Ressources Métier" as the feature's name (this file's own `### Ressources Métier` section heading included) are deliberately untouched — same "technical identifier, not a label" reasoning already applied to `/api/task-assignments` keeping its route name after "assignée" became "déléguée" on screen.

**The landing hero headline dropped its `whitespace-nowrap` underline-highlight decoration when the wording changed.** The original two-line "Toute votre entreprise, *d'une seule vision.*" fit its 3-word highlighted phrase on one line inside the hero column's `maxWidth: 560`; the replacement, "Logiciel de gestion — *pour tous les professionnels des services.*" (the new tagline, at the user's request), is a 6-word phrase that the same `whitespace-nowrap` forced onto one line regardless of the column width, overflowing straight into the phone-mockup illustration beside it. The decorative underline bar (`absolute … bg-turquoise/25`) was built for a single-line span and can't follow text across a wrap either, so both were dropped rather than patched — the phrase now wraps like ordinary text.

**"Facturation & Trésorerie" (25 characters, longer than every other nav label) was clipped to "Facturation & Trésor…" in the sidebar's original 212px rail.** Every `mainNavItems` row shares one `truncate` (single-line, ellipsis) treatment on both its flex container and its label `<span>` — safe while every label happened to fit on one line, but this one no longer did. A first fix let the label wrap to two lines instead of truncating; the second, current fix widens the rail (`212px` → `226px`, both the `w-`/`min-w-` on `<aside>`) instead — the user wanted the label to stay on **one** line, not grow the row — measured against the label's own natural (unconstrained, `white-space: nowrap`) rendered width (~149px at the rail's `12.5px` font) versus what a 212px rail actually leaves after the icon, the `gap-2.5` and the button's `px-3` padding (~142px), so 14px of extra rail width was the real gap to close. `truncate` on the row is otherwise unchanged and still the fallback for anything longer still.

**The sidebar is grouped under three headers, at the user's own explicit layout** ([Sidebar.tsx](src/components/Sidebar.tsx)): **Pilotage & Production** (Tableau de bord, Clients, Missions, Gestion des tâches), **Finance & RH** (Facturation & Trésorerie, Équipe de travail, GRH & Paie), **Outils & Collaboration** (Outils de travail, Messages, Parrainage) — plus Plateforme, ungrouped, superadmin-only. `NAV_GROUPS` carries the fixed header text and item order; each item's `id`, permission guard and plan-module gate are completely unchanged from the flat list before it — grouping is purely a rendering concern, never a re-routing of anything `App.tsx` or `plans.ts` key on. `navGroups` filters each group's items through the existing `planAllowsModule` check exactly as the old flat `navItems` did, then **drops any group left with zero items** (header included) — a restricted plan that sells none of a group's modules doesn't leave a bare, pointless heading behind. `NavButton` is the row markup extracted once so the grouped list and the ungrouped Plateforme entry can't drift into two different button styles.

**GRH & Paie merges the RH and Payroll pages into one, at the user's explicit request** — there is no longer a standalone "Gestion des paies" nav entry or `Payroll` nav id; **Paie is now HRManagement's seventh tab**, alongside Congés/Autorisations d'absence/Pointage/Prêts/Avances/Jours fériés. The single remaining nav id is `'HR'`, gated on `hasPermission('VIEW_HR') || hasPermission('VIEW_PAYROLL')` in both [Sidebar.tsx](src/components/Sidebar.tsx) and the `App.tsx` render branch — **either permission alone is enough to reach the page**, since an accountant with `VIEW_PAYROLL` but not `VIEW_HR` (a real, already-documented case — see "Gestion des paies" above: "a cabinet may want its accountant to print bulletins without being able to touch the Équipe roster") must still be able to open it. [HRManagement.tsx](src/components/hr/HRManagement.tsx) does the corresponding split internally: `canViewHr`/`canViewPayroll` each gate their own half — the six original tabs plus the leave-balance stat cards behind `canViewHr`, the new Paie tab behind `canViewPayroll` — so a payroll-only account never sees a `leaves`-tab route it has no permission to see data on, and the default `activeTab` falls back to `'paie'` rather than `'leaves'` for that account specifically (an effect keyed on `[canViewHr, canViewPayroll]` corrects the initial guess once those two are known, since the `sessionStorage`/`open_hr_subview` restore logic that seeds `activeTab` runs before permissions are available to consult). `/api/payslips`/`/api/payroll` staying mapped to the `'Payroll'` `PlanModule` in `PLAN_MODULE_ROUTES` (server.ts) and `PERMISSION_MODULE` (plans.ts) is **unchanged** — that mapping governs API-route access, not UI nav structure, and still has to exist independently of whether Payroll has its own sidebar entry.

**[PayrollManagement.tsx](src/components/payroll/PayrollManagement.tsx) takes an `embedded` prop for this reuse**, rather than forking into two components. `embedded` (used only by the Paie tab) drops the page's own icon+title+subtitle header block and its outer `p-4 sm:p-6 lg:p-8` padding — the host page (HRManagement) already supplies both (its own "GRH & Paie" header, and the shared `p-4` every tab's content sits in) — while the Export/Nouveau-bulletin action row, the filters, the table, the generation modal and the PDF viewer are all identical either way. This is the same "one component, a prop for where it's mounted" shape `InvoicePreview`'s `companyEndpoint` prop already uses for the client portal — not a second copy of the page that could drift from the first.

### Bulk client import

`POST /api/clients/import` ([ClientsManagement.tsx](src/components/clients/ClientsManagement.tsx), [ImportClientsModal.tsx](src/components/clients/ImportClientsModal.tsx), [parseClientsExcel.ts](src/components/clients/parseClientsExcel.ts)) bulk-creates from an uploaded spreadsheet. The file is parsed **entirely in the browser** (SheetJS) — the server never sees the file, only an array of already-mapped rows shaped exactly like a single `POST /api/clients` body. That is what keeps the route from needing upload middleware, and keeps the mapping the user confirmed in the dialog from ever being reinterpreted server-side.

**xlsx is dynamically imported** inside `parseClientsWorkbook()`, not statically — it is several hundred kB and would otherwise ship to every visitor who never touches the import dialog. It only loads once a file is actually picked.

Any Excel column the user does not map to a native field (name/taxId/email/phone/address/city/country) becomes a `customField`, keyed by its own (whitespace-normalised) header — the same free-form column set the Clients screen has always rendered. `guessMapping()` only pre-fills a starting guess by header name; the user confirms or overrides every field before importing, so a misnamed column never silently maps to the wrong one.

Duplicate detection compares the matricule fiscal (`taxId`) case/whitespace-insensitively against both the existing database and earlier rows in the same file — two rows in one sheet sharing a tax ID do not both become clients. A row with no tax ID falls back to an exact name match. Rows are created via `Promise.allSettled`, not one at a time: `saveDb()`'s write-coalescing collapses that into roughly one file write regardless of row count, the same property every other bulk mutation in this app already relies on.

Import ids are `Date.now() * 1000 + index` rather than bare `Date.now()` (what single-client creation uses) — a fast loop of a few hundred rows can land multiple creates in the same millisecond, which single-creation never has to worry about but a bulk import always will.

### Clients have user-defined columns

**Une colonne personnalisée se renomme et se supprime pour *tous* les clients**, depuis le sélecteur « Colonnes » de la page Clients — crayon et poubelle sur les seules colonnes personnalisées, derrière `MANAGE_CLIENT_FIELDS`. `PUT /api/clients/fields` (`{from, to}`) et `DELETE /api/clients/fields?name=` sont les deux routes ; `renameClientCustomField`/`deleteClientCustomField` les servent en **une** instruction sous Postgres (JSONB, `jsonb_exists` plutôt que l'opérateur `?` que plus d'un pilote lit comme un paramètre) et en une passe mémoire sous JSON. Le travail est côté serveur et non une boucle de PUT depuis le navigateur : une colonne n'existe nulle part ailleurs qu'en clé de `customFields` sur chaque fiche, donc un onglet fermé au milieu laisserait « Tel » sur la moitié des clients et « Téléphone » sur l'autre. Le nom voyage en query et non dans le chemin — un en-tête de tableur contient volontiers « / » ou « . ».

Quatre refus, tous côté serveur : un nom vide, une colonne inexistante, une collision **insensible à la casse** avec une autre colonne (les fusionner perdrait une valeur par fiche sans dire laquelle), et un nom de champ natif — le filtre et le tri ne retombent sur `customFields` que lorsque la propriété de premier niveau est absente, donc une colonne nommée `email` serait inatteignable. Le nom est normalisé comme à l'import (espaces repliés, 60 caractères).

Côté écran, `applyColumnKeyChange()` suit le renommage dans les **colonnes visibles, le tri et les filtres actifs** : tous désignent la colonne par sa clé, donc sans lui un renommage vidait la liste (tri sur une clé disparue) ou masquait la colonne qu'on venait de renommer. Les icônes sont **toujours visibles**, jamais révélées au survol — la grille des échéances a déjà retiré une poubelle au survol, inatteignable sur tablette — et l'erreur s'affiche **sous la ligne concernée**, pas en tête du panneau : le sélecteur défile, et un bandeau en haut se retrouve hors écran juste après la touche Entrée (le même piège que l'éditeur de Cash).

Clients carry a free-form `customFields` object. `GET /api/clients/fields` derives the available column set from the union of all clients' `customFields` keys, and the list endpoint's filtering/sorting falls back to `customFields[key]` when a top-level property is missing ([server.ts:314-359](server.ts#L314-L359)). Pagination only kicks in when `?page=` is passed; otherwise a bare array is returned (backward compatibility).

**`availableFields` (the client-side copy of that key set) is only fetched once on mount, plus after a rename/delete — a plain client create/edit used to leave it stale.** A brand-new custom field typed on a single client's form (or the first client to carry a column that had never been renamed/deleted before) landed in that client's `customFields` on save, but `ClientsManagement.tsx`'s `handleSubmit` never called `fetchAvailableFields()` afterward — the column existed in the database from that moment, yet the « Colonnes » picker kept showing the list it had fetched at page load until a full reload. That read as "I added a value for this client but I can't find the column anywhere to manage it" — a column and a value that both exist server-side but are invisible in the one screen meant to surface them. `handleSubmit` now refreshes `availableFields` on every successful save, the same way `ImportClientsModal`'s `onImported` already did (the bulk-import path never had this bug — only the single-client one did).

**The per-client "Champs personnalisés" editor only ever listed keys already present on *that* client** — so a column created for one client and left blank on every other was invisible in *their* forms too, with no way to attach a value to it short of retyping its exact name into "Nom du nouveau champ" and hoping for no typo (a near-miss silently creates a second, near-duplicate column instead of reusing the real one). `fieldSuggestions` in `ClientsManagement.tsx` now offers a small, accent-folded, type-ahead list of existing columns (from `availableFields`) not yet set on the client being edited, filtered as the admin types; clicking one calls the same `addCustomFieldToClient()` the "Ajouter" button uses, so it can't diverge from manually typing the identical name.

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
  et se rend, côté client, dans le fuseau du cabinet — jamais dans celui de
  l'appareil qui regarde.

**Le fuseau se possède aussi côté navigateur.** `toLocaleTimeString()` /
`toLocaleDateString()` sans option `timeZone` rendent un instant dans le
fuseau *de l'appareil qui affiche*, pas celui du cabinet — et un appareil mal
réglé (une VM restée en UTC, un poste dont le fuseau système n'est pas
Africa/Tunis) décale l'affichage d'une heure pile, exactement comme le
serveur avant ce correctif, alors même que `checkinAt` est un instant
parfaitement correct. Le symptôme se voit surtout en le comparant à Pointage,
dont l'heure de début est une chaîne déjà écrite en heure de Tunis côté
serveur : les deux écrans parlent du même instant et n'affichent pas la même
heure. `formatTimeTN` / `formatDateTimeTN` / `civilDateKeyTN` dans
[formatters.ts](src/utils/formatters.ts) épinglent donc explicitement
`Africa/Tunis`, la contrepartie client d'`APP_TIMEZONE` — utilisés par
l'heure d'entrée/sortie du pointage de présence
([AttendanceTab.tsx](src/components/hr/AttendanceTab.tsx)), le « modifié le »
de [EntryDeviceBadge.tsx](src/components/EntryDeviceBadge.tsx), et l'heure
plus le regroupement Aujourd'hui/Hier de la messagerie
([ChatPage.tsx](src/components/chat/ChatPage.tsx), dont le regroupement par
jour comparait `toDateString()` — même piège que `civilDateKeyTN` documente :
un message envoyé à 00h15 heure de Tunis se rangeait sous la veille sur un
appareil resté en UTC). Une chaîne déjà écrite par le serveur (`date`,
`heureDebut`, `heureFin`) n'a pas besoin de ce traitement — elle est déjà en
heure de Tunis, la rendre demanderait de la reparser puis de la reformater
pour rien.

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
### Page d'accueil publique

[Landing.tsx](src/pages/Landing.tsx) porte trois vues (`home` / `tarifs` / `apropos`) sans routeur, comme le reste de l'application. La page valorise les **douze modules** — pas une sélection : une page qui ne montre que le pointage laisse croire que le reste n'existe pas. Six d'entre eux ont leur section en grand (pointage, facturation) ou leur bandeau (parrainage) ; les six autres passent par [ModuleExplorer.tsx](src/components/landing/ModuleExplorer.tsx), un panneau à onglets — six sections de plus en pleine largeur feraient une page qu'on ne finit pas, et ces écrans se comparent. Ses maquettes sont **dessinées en HTML**, pas exportées en images : elles suivent les tokens de la charte, restent nettes à tout zoom, et un libellé qui change dans l'application se corrige sans repasser par un export.

**« À propos » (`view === 'apropos'`, `goToAPropos()`) reprend le contenu réel remis par l'utilisateur** — histoire/constat, mission, quatre piliers (`ABOUT_PILLARS`), trois chiffres d'impact — pas du remplissage, même règle que le reste des maquettes de cette page. Elle réutilise les briques déjà en place plutôt que d'en inventer de nouvelles : `Reveal`/`CountUp` pour les animations (`CountUp` n'avait encore aucun appelant — les deux premiers chiffres d'impact, 12 modules et 100 % de conformité, sont son premier usage réel), la même carte à icône que la section Fonctionnalités pour les piliers, et la carte navy déjà utilisée pour les offres mises en avant pour la citation de mission. Le bandeau CTA partagé en bas de page (rendu après les trois vues, pas dans leur ternaire) porte désormais un titre et un sous-titre à trois branches (`view === 'apropos'` ajouté à côté de `'home'`/`'tarifs'`) et un second bouton « Découvrir les modules » (`goToAnchor('modules')`) qui n'apparaît que sur cette vue — les deux autres vues gardent un seul bouton, inchangé. Le lien de nav vit entre Tarifs et Contact ; le lien de pied de page vit dans la colonne Entreprise, au-dessus de Contact.

**« Notre histoire » porte un motion graphic, à la demande explicite de l'utilisateur** — le texte, jusque-là seul dans une colonne centrée, partage désormais la section avec une petite composition animée (`flex-wrap-reverse`, même charpente que la section TIME TRACKING SHOWCASE : `Reveal direction="left"` pour l'image, `Reveal direction="right"` pour le texte). Elle ne mobilise **aucune animation nouvelle** — trois cartes « Tableurs dispersés » / « Heures oubliées » / « Relances manuelles » flottent avec `landingFloatA`/`B`/`C` (déjà utilisées par les cartes flottantes du hero), un halo respire derrière elles avec `landingBreathe` (déjà le halo du hero et du bandeau CTA), et la carte de résultat « Tâches & Cash » porte un point qui bat avec `landingPulseDot` — le même signal « à jour en direct » que la carte « Nouvelle tâche assignée » du hero, pas une nouvelle métaphore. Le récit tient dans la mise en scène plutôt que dans un texte qui l'expliquerait : le chaos flotte de façon désordonnée, la réponse est immobile et nette.

**Les animations d'apparition passent par [Reveal.tsx](src/components/landing/Reveal.tsx)**, jamais par une classe CSS seule. Une animation d'entrée rate toujours de la même façon — en laissant du contenu invisible — donc trois règles y sont câblées : `prefers-reduced-motion` rend le bloc **visible immédiatement** (et non « figé à l'état de départ », c'est-à-dire à `opacity: 0`) ; sans `IntersectionObserver` l'état initial est *visible*, le défaut étant de montrer ; et l'observation s'arrête à la première apparition, sans quoi un défilement normal devient un clignotement. `CountUp` suit les mêmes règles et écrit la valeur finale telle quelle sous réglage réduit. Le décor purement décoratif (aurores du hero, ruban défilant, liseré de la chaîne de valeur) vit en `@keyframes landing*` dans [index.css](src/index.css), où un seul bloc `prefers-reduced-motion` les coupe toutes — sûr parce qu'aucune ne porte l'état visible de son élément.

Deux pièges déjà rencontrés : des barres de graphique en hauteur `%` dans un conteneur `items-end` ne se résolvent contre rien (la colonne prend sa hauteur de contenu) — le graphique disparaît ; et la chaîne de valeur à cinq pastilles doit rétrécir sous `sm`, sinon les libellés se chevauchent sur un téléphone.

**Tous les boutons « Commencez gratuitement » hors des cartes de tarifs mènent à la page Tarifs, jamais directement à l'inscription.** Ils appelaient `setModalPlan(FEATURED_PLAN)` — l'offre la plus mise en avant, choisie sans que le visiteur ait rien décidé — et ouvraient le formulaire de création de compte directement dessus : le hero, la bannière de fin de page, les CTA « Essayer le suivi du temps » / « Créer une facture » et celui du `ModuleExplorer` créaient tous un compte sur la même offre par défaut, sans jamais montrer les autres. Ils appellent maintenant `goToTarifs()`, la même fonction que le lien « Tarifs » de la nav — le visiteur choisit son offre sur une carte (`onClick={() => setModalPlan(plan.name)}`, seul point d'entrée qui reste vers `RequestAccessModal`) avant que le formulaire ne s'ouvre. `goToTarifs()` reste sûr à appeler depuis la page Tarifs elle-même (le bouton de la bannière de fin de page, par exemple) : il ne fait alors que remonter en haut de la page, au-dessus des cartes.

**Il n'y a plus de section « Avis clients ».** `Testimonials.tsx` en portait une — un carrousel de citations dont le tableau `TESTIMONIALS` et la note `RATING` étaient explicitement des exemples de mise en page (« Exemple à remplacer » en guise d'auteur), jamais de vrais avis : publier un témoignage inventé sous le nom d'un cabinet qui ne l'a pas donné trompe le visiteur, et relève de la pratique commerciale déloyale à peu près partout. **Retirée à la demande de l'utilisateur** plutôt que remplie de vraies citations — le fichier a été supprimé, pas laissé en dead code, même règle que `DashboardCharts.tsx` plus haut. Le lien « Avis » de la nav et « Avis clients » du pied de page ont disparu avec elle plutôt que de pointer vers une ancre qui n'existe plus. Si des avis réels sont un jour recueillis, la section se reconstruit plutôt que se démasque.

**Le bandeau « Ils nous font confiance » ([ClientLogos.tsx](src/components/landing/ClientLogos.tsx)) ne contient aucun logo réel.** Les fichiers se déposent dans `public/logos/clients/` (servi sur `/logos/clients/…`, comme les logos CNSS/ANETI/TEJ déjà en place) et se déclarent dans `CLIENT_LOGOS`. Une entrée sans `src` — ou dont le fichier est introuvable, `onError` reprenant la main — s'affiche en **emplacement vide identifié**, jamais en icône d'image cassée : une faute de frappe dans un nom de fichier se voit tout de suite. Même principe que les avis retirés ci-dessus : afficher le logo d'une entreprise qui n'est pas cliente lui fait dire qu'elle vous recommande. Les logos s'affichent **en couleur**, pas en nuances de gris : la moitié d'entre eux sont dans des bleus et des verts clairs qui, désaturés, deviennent illisibles sur fond blanc (comparé à l'écran avant de trancher). Le bandeau **remplace** l'ancien ruban navy des noms de modules, qui occupait cette place — le ruban défilant (`landing-marquee`/`landingMarquee`) et sa pause au survol restent à ce bandeau-là ; `landingMarqueeBack`/`landingStarPop`, propres au carrousel d'avis, sont partis avec lui.

**[AnimatedLogo.tsx](src/components/landing/AnimatedLogo.tsx) reprend les coordonnées de [Logo.tsx](src/components/Logo.tsx) à l'identique** — c'est le même dessin animé, pas une seconde marque qui finirait par diverger de la charte. L'anneau et son point tournent dans **un seul groupe** : le point marque le trou de l'anneau, les séparer le détacherait du dessin. Sous `prefers-reduced-motion` la marque est **finie et immobile**, jamais figée à son état de départ — un anneau non dessiné n'est pas un logo.

**Une piste défilante ne prend jamais le raccourci `animation` en style en ligne.** Le raccourci pose aussi `animation-play-state: running`, et un style en ligne l'emporte sur la feuille : la pause au survol (`.landing-marquee:hover`) ne s'appliquait jamais. Les propriétés se posent une par une (`animationName`, `animationDuration`…). Même piège pour tout ce qui veut suspendre une animation depuis une classe.

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

**Cash, RH and Tâches (Pointage) were brought in line with a newer pass of the same design file, each keeping its own accent colour.** The refresh only ever restyles existing screens — no field, route or flow changed:

- **Cash's header carries an icon badge** (a `w-10 h-10 rounded-lg bg-gray-100` box around the `Receipt` icon) instead of the icon sitting inline with the `<h1>` text — the same treatment [HRManagement.tsx](src/components/hr/HRManagement.tsx) and Tâches already used elsewhere, now consistent across all three.
- **Cash's three subviews each carry their own colour, on both the tab bar and their own total** (`CASH_TAB_COLOR` in [CashManagement.tsx](src/components/cash/CashManagement.tsx)) — Facturation blue, Règlements clients emerald, Brouillard de caisse violet. An earlier pass gave Cash a single shared accent on the grounds that the three tabs are views onto the same underlying data; that read as the layout itself changing shape when switching tabs (a card above the table on Facturation, nothing of the kind on the other two) rather than as one section with three views, so it was dropped in favour of the same per-subview idiom Tâches and RH already use — see below.
- **A shared "accent card" pattern**: a white `rounded-xl` card with a 3px coloured top border (`border-t-[3px] border-t-{accent}`) and a tinted header strip (`bg-{accent}-50/60 border-b border-{accent}-100`) carrying a bold label. Two instances exist so far — Cash's **Total Général** ([CashManagement.tsx](src/components/cash/CashManagement.tsx), blue) and Tâches' **TÂCHES EN PAUSE** ([PausedTasksList.tsx](src/components/PausedTasksList.tsx), sky, matching the "Mon chrono" tab it lives under) — and any new "headline figure" card in these sections should follow it rather than inventing a new treatment.
  - Cash's version replaced a sticky `<tr>` that used to live inside the table's `<thead>` (pinned with a `top-[42px]` offset under the column headers). Moving it to a standalone card above the table means the headline figures read before any horizontal scrolling, and collapses to a **"Voir le détail"** toggle (`showTotalDetail` state) that reveals the per-currency document count — the one figure the two totals alone don't answer. The two always-visible figures (Total HT, Montant de facture) and the sum-per-filtered-set behaviour are unchanged from the old sticky row. Règlements clients and Brouillard de caisse don't need the same standalone-card treatment — a single total line, no per-currency breakdown to collapse — so they instead sit as a row inside the table's own `<thead>` (see below), which is what "respecting the layout from one subview to the next" actually meant here: the total is always reachable without scrolling, on every one of the three tabs, not necessarily drawn with the exact same markup.
  - `PausedTasksList.tsx`'s card used to be amber — a leftover from before Tâches' subviews were colour-coded, which put "Tâches en pause" (drawn under the "Mon chrono" tab) at odds with that tab's own sky accent. It now matches: `border-t-sky-600`, `bg-sky-50/60`, the pulse dot and the "Reprendre" button both `bg-sky-500`.
- **RH's stat-card grid dropped `lg:grid-cols-4` for a plain `grid-cols-2`** — there are only ever two cards (congés disponibles / congés pris), and the four-column grid left the right half of a desktop-width row empty instead of letting the pair fill it.
- **RH's six tabs (Congés, Autorisations d'absence, Pointage, Prêts, Avances, Jours fériés) are now generated from an array of `{id, label, icon, border, text}` and mapped**, rather than six hand-written buttons, each carrying an icon the same way Cash's and Tâches' tab bars already did — RH's tabs previously had no icons at all. The row is left-aligned and horizontally scrolling (`overflow-x-auto`, not `flex-1`) — the same idiom Cash and Tâches already used — instead of stretching to fill the row, which used to wrap "Autorisations d'absence" onto two lines on a narrower desktop window.

**Cash's, Tâches' and RH's sub-tabs each carry their own colour, matched on the table header (or standalone total) of the content they show** — so a glance at either the active tab or the table underneath says which subview you're in without reading the label. Cash (`CASH_TAB_COLOR` in [CashManagement.tsx](src/components/cash/CashManagement.tsx)) is `documents` blue, `reglements` emerald, `journal` violet. Tâches (`TAB_COLOR` in [TaskSubviews.tsx](src/components/TaskSubviews.tsx)) is `chrono` sky, `planned` amber, `assigned` violet, `delegatedByMe` emerald — the same record also colours the `border-l-4` accent on `AssignmentList`'s and `DelegatedByMeList`'s cards. RH is `leaves` indigo, `absences` rose, `attendance` orange, `loans` teal, `advances` cyan, `holidays` fuchsia (tab-bar only — [HolidaysTab.tsx](src/components/hr/HolidaysTab.tsx) is a card list with no `<thead>` to match); each of the other five colours is also applied to that tab's own `<thead>` in [LeavesTab.tsx](src/components/hr/LeavesTab.tsx)/[AbsencesTab.tsx](src/components/hr/AbsencesTab.tsx)/[AttendanceTab.tsx](src/components/hr/AttendanceTab.tsx)/[LoansTab.tsx](src/components/hr/LoansTab.tsx)/[AdvancesTab.tsx](src/components/hr/AdvancesTab.tsx) (`bg-{color}-50`/`text-{color}-700`, scoped to the header row only — the body stays neutral). None of these reuse the reserved `run`/`done`/`pause`/`late`/`admin`/`collab` tokens.

**Règlements clients' and Brouillard de caisse's totals both live inside the table's own `<thead>`, immediately under the column headers — never a `<tfoot>` at the bottom.** Règlements clients used to carry its total as a sticky `<tfoot>` row, reachable only after scrolling to the end of a long list; it's now a second `<tr>` inside the same `<thead>` as [CashJournal.tsx](src/components/cash/CashJournal.tsx)'s own "Total général" row, both pinned together by the `sticky top-0` on the `<thead>` element itself (not per-`<th>`, unlike Facturation's table). Règlements clients' total is emerald (`bg-emerald-50 border-emerald-200`), matching its tab; Brouillard de caisse's is violet (`bg-violet-50 border-violet-200`) — both used to blend into (or hide below) the rows they summed. Brouillard's entrée/sortie cells keep their `done`/`late` status colours inside that violet row; only the row's own background and label change.

- Path alias `@/*` maps to the project root (both [vite.config.ts](vite.config.ts) and [tsconfig.json](tsconfig.json)). Tailwind v4 is configured entirely through the Vite plugin — there is no `tailwind.config.js`.
- `DISABLE_HMR=true` turns off HMR *and* file watching in [vite.config.ts](vite.config.ts) — it exists so agent edits don't cause flicker.
- `local.db.json` is gitignored (it holds bcrypt hashes and real client data) and generated on first run; treat it as disposable *local* state — delete it to reseed the default accounts. Deployments do not use it at all.
