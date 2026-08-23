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

export async function sendMail(opts: { to: string; subject: string; html: string; from?: string }): Promise<{ sent: boolean }> {
  const t = getTransporter();
  const from = opts.from || process.env.SMTP_FROM || process.env.SMTP_USER;
  if (!t || !from) {
    console.warn(`[email] SMTP not configured — would have sent "${opts.subject}" to ${opts.to}`);
    return { sent: false };
  }
  try {
    await t.sendMail({ from, to: opts.to, subject: opts.subject, html: opts.html });
    return { sent: true };
  } catch (error) {
    console.error('[email] send failed:', error);
    return { sent: false };
  }
}
