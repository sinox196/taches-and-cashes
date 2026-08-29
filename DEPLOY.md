# Deployment

The app stores its data in **PostgreSQL** whenever `DATABASE_URL` is set, and in
a local JSON file otherwise. In production it refuses to start without
`DATABASE_URL` rather than silently running on the JSON file, which has no
backups and loses everything if the process is killed mid-write.

Nothing else changes between the two: same code, same records, same behaviour.
Local development still needs no database running.

## Environment

| Variable | Required | Notes |
|---|---|---|
| `DATABASE_URL` | **yes in production** | `postgresql://user:pass@host:5432/db`. Injected automatically by both Railway and Render when you attach their managed PostgreSQL. |
| `JWT_SECRET` | **yes** | Set it once and never change it — rotating it invalidates every issued login token, and everyone gets `401` until they log in again. |
| `NODE_ENV` | yes | `production`, so the server serves `dist/` instead of running Vite. |
| `PORT` | no | Set by the platform; the app binds it. Defaults to 3000 locally. |
| `SMTP_HOST` / `SMTP_PORT` / `SMTP_USER` / `SMTP_PASS` / `SMTP_FROM` | no | Transactional email (signup notice, RIB, payment confirmation, password reset). Unset, sends are logged and skipped instead of failing. **`SMTP_FROM` must be an address the relay is authorised to send as** — anything else is rejected with `550 sender address rejected`. |
| `VAPID_PUBLIC_KEY` / `VAPID_PRIVATE_KEY` | no | Web Push. Without them the running chronometer still shows in the app, the tab title and (while the browser is open) a system notification — but it cannot reach a **closed** browser. Generate once with `node -e "console.log(JSON.stringify(require('web-push').generateVAPIDKeys()))"` and never rotate them: changing the keys silently invalidates every device subscription already issued. |
| `VAPID_SUBJECT` | no | `mailto:` address for the push service to contact. Defaults to `mailto:support@taches-and-cash.com`. |

## Railway (the production target)

1. Create the project from the GitHub repo. `railway.json` supplies the build
   and start commands.
2. **+ New → Database → PostgreSQL.** Railway injects `DATABASE_URL` into the
   web service automatically — do not paste it by hand.
3. Add `JWT_SECRET` (any long random string) and `NODE_ENV=production` as
   service variables.
4. Deploy. The schema is created on first boot; there is no migration step.
5. Import existing data, if any — see below.

Railway takes **automated backups of the PostgreSQL volume**; check the retention
on your plan and keep your own dumps as well (below).

## Render (currently the test deployment)

`render.yaml` declares the web service *and* a managed PostgreSQL instance, and
wires `DATABASE_URL` between them. Note that Render's **free** PostgreSQL plan is
deleted after 30 days — fine for testing, not for real data.

## Moving existing data in

The old `local.db.json` (or any `npm run db:backup` output) loads into an empty
database:

```bash
DATABASE_URL="postgresql://..." npm run db:import -- local.db.json
```

It refuses to run if the target already holds rows, so it cannot overwrite live
data by accident. Order is preserved, including the newest-first ordering of
time entries and invoices, and the legal invoice counter carries over so
numbering continues rather than restarting.

## Backups

Two layers, and you want both:

1. **The platform's managed backups** — the primary mechanism. They cover the
   case where the instance itself is lost. Confirm they are actually enabled on
   your plan; do not assume.
2. **Your own portable dump** — an off-platform copy you hold:

```bash
DATABASE_URL="postgresql://..." npm run db:backup            # -> backups/backup-<timestamp>.json
DATABASE_URL="postgresql://..." npm run db:backup -- /some/dir
```

It needs no `pg_dump` binary installed, and writes the same shape `db:import`
reads, so restoring is:

```bash
# create an empty database first, then:
DATABASE_URL="postgresql://...new..." npm run db:import -- backups/backup-2026-08-19T10-43-01.json
```

That round-trip is verified to restore every collection identically, invoice
sequence included.

**The dump contains bcrypt password hashes and real client data.** Keep it
private; `backups/` is gitignored.

A backup nobody has ever restored is not a backup — run the restore into a
throwaway database once, so you know the procedure works before you need it.
