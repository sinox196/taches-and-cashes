import nodemailer from 'nodemailer';

/**
 * SMTP is optional. Unset in dev (and any environment that hasn't configured
 * it yet) — sendMail() logs what it would have sent and reports { sent: false }
 * rather than throwing, so a route calling this never has to special-case
 * "email isn't configured" itself. Callers that care about delivery (e.g. an
 * order confirmation) should surface `sent` back to the caller rather than
 * assuming success — unlike DATABASE_URL, a missing send here has no working
 * fallback, so silence would hide a real gap.
 */
let transporter: ReturnType<typeof nodemailer.createTransport> | null = null;

function getTransporter() {
  if (transporter) return transporter;
  const { SMTP_HOST, SMTP_PORT, SMTP_USER, SMTP_PASS } = process.env;
  if (!SMTP_HOST || !SMTP_PORT || !SMTP_USER || !SMTP_PASS) return null;
  transporter = nodemailer.createTransport({
    host: SMTP_HOST,
    port: Number(SMTP_PORT),
    secure: Number(SMTP_PORT) === 465,
    auth: { user: SMTP_USER, pass: SMTP_PASS },
  });
  return transporter;
}

/** Crude tag strip for the plain-text alternative — good enough for the
 *  short, simple transactional bodies this sends. A text/plain part isn't
 *  decorative: mail without one reads to spam filters as HTML-only bulk
 *  mail, which is exactly the pattern a first-party transactional sender
 *  wants to avoid. */
function toPlainText(html: string): string {
  return html
    .replace(/<br\s*\/?>/gi, '\n')
    .replace(/<\/p>/gi, '\n\n')
    .replace(/<[^>]+>/g, '')
    .replace(/[ \t]+\n/g, '\n')
    .replace(/\n{3,}/g, '\n\n')
    .trim();
}

export async function sendMail(opts: { to: string; subject: string; html: string; from?: string; fromName?: string; replyTo?: string }): Promise<{ sent: boolean }> {
  const t = getTransporter();
  const rawFrom = opts.from || process.env.SMTP_FROM || process.env.SMTP_USER;
  if (!t || !rawFrom) {
    console.warn(`[email] SMTP not configured — would have sent "${opts.subject}" to ${opts.to}`);
    return { sent: false };
  }
  // A bare address ("from") reads as bulk/automated mail to both spam
  // filters and the inbox UI; a named sender ("Name <address>") is what a
  // legitimate first-party sender looks like. `fromName` only relabels the
  // display name — the actual envelope address always stays whatever the
  // SMTP account is authorized to send as (most relays reject `MAIL FROM`
  // for anything else with a 550, regardless of what this header says).
  const from = rawFrom.includes('<') ? rawFrom : `"${opts.fromName || 'Tâches & Cash'}" <${rawFrom}>`;
  try {
    await t.sendMail({
      from,
      to: opts.to,
      replyTo: opts.replyTo || 'contact@taches-and-cash.com',
      subject: opts.subject,
      html: opts.html,
      text: toPlainText(opts.html),
    });
    return { sent: true };
  } catch (error) {
    console.error('[email] send failed:', error);
    return { sent: false };
  }
}
