/**
 * Command-line twin of the platform console's « Créer le compte démo »
 * button — the logic itself lives in src/server/demoAccount.ts.
 *
 * Usage, against the deployed PostgreSQL (one run does both phases):
 *
 *   SEED_BASE_URL="https://www.taches-and-cash.com" \
 *   SEED_ADMIN_USERNAME="…" SEED_ADMIN_PASSWORD="…"   # a platform admin
 *   DATABASE_URL="postgresql://…" \
 *   npm run db:seed-demo-account
 *
 * Locally, on the JSON file: phase 1 needs the app running, and phase 2 must
 * run with it **stopped** — the server keeps the file in memory and would
 * overwrite what phase 2 writes on its next save:
 *
 *   npm run dev                                   # terminal 1
 *   npm run db:seed-demo-account                  # terminal 2 — phase 1
 *   (stop npm run dev)
 *   npm run db:seed-demo-account -- --finish      # phase 2
 *
 * The console button has neither constraint: it runs inside the server and
 * shares its database.
 */

import { initDb } from '../src/server/database.js';
import {
  runDemoApiPhase, runDemoDirectPhase,
  DEMO_USERNAME, DEMO_PASSWORD, TEAM, TEAM_PASSWORD, PORTAL_PASSWORD,
} from '../src/server/demoAccount.js';

const BASE_URL = process.env.SEED_BASE_URL || 'http://localhost:3000';
const ADMIN_USERNAME = process.env.SEED_ADMIN_USERNAME || 'admin';
const ADMIN_PASSWORD = process.env.SEED_ADMIN_PASSWORD || 'admin123';

async function main() {
  const finishOnly = process.argv.includes('--finish');
  let portal: string[] = [];
  if (!finishOnly) {
    const res = await fetch(`${BASE_URL}/api/login`, {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ username: ADMIN_USERNAME, password: ADMIN_PASSWORD }),
    });
    const body = await res.json().catch(() => ({}));
    if (!res.ok || !body.token) throw new Error(`Connexion de ${ADMIN_USERNAME} refusée : ${body?.error || res.status}`);
    ({ portal } = await runDemoApiPhase(BASE_URL, body.token));
    if (!process.env.DATABASE_URL) {
      console.log('\nBase JSON locale : arrêtez le serveur (npm run dev), puis lancez');
      console.log('  npm run db:seed-demo-account -- --finish');
      console.log('pour le pointage de présence et le mot de passe « demo ».');
      return;
    }
  }
  await runDemoDirectPhase(await initDb());
  // The JSON engine coalesces writes on a timer; give it time to flush.
  await new Promise(r => setTimeout(r, 1500));

  console.log('\n' + '='.repeat(64));
  console.log(`  Administrateur : ${DEMO_USERNAME} / ${DEMO_PASSWORD}`);
  console.log(`  Équipe         : ${TEAM.map(t => t.username).join(', ')} / ${TEAM_PASSWORD}`);
  console.log(`  Portail client : demo.<client> / ${PORTAL_PASSWORD}${portal.length ? ` (${portal.join(', ')})` : ''}`);
  console.log('='.repeat(64));
}

main().catch((e) => {
  console.error('\nÉchec :', e.message || e);
  process.exit(1);
});
