import nodemailer, { Transporter } from 'nodemailer';

let transporter: Transporter | null = null;
let loggedNoSmtpWarning = false;

function getTransporter(): Transporter | null {
  if (!process.env.SMTP_HOST) return null;
  if (!transporter) {
    transporter = nodemailer.createTransport({
      host: process.env.SMTP_HOST,
      port: Number(process.env.SMTP_PORT ?? 587),
      secure: Number(process.env.SMTP_PORT ?? 587) === 465,
      auth: process.env.SMTP_USER
        ? { user: process.env.SMTP_USER, pass: process.env.SMTP_PASS }
        : undefined,
    });
  }
  return transporter;
}

function verificationLink(token: string): string {
  const origin = process.env.FRONTEND_ORIGIN ?? 'http://localhost:5173';
  return `${origin}/?verifyToken=${token}`;
}

// Ohne SMTP_HOST wird der Link nur geloggt statt verschickt — sinnvoller Default für
// lokale Entwicklung und Tests, ohne dass ein echter Mail-Provider nötig ist.
export async function sendVerificationEmail(to: string, username: string, token: string): Promise<void> {
  const link = verificationLink(token);
  const t = getTransporter();

  if (!t) {
    if (!loggedNoSmtpWarning) {
      console.warn('[Mail] SMTP_HOST nicht gesetzt — Bestätigungslinks werden nur geloggt, nicht verschickt.');
      loggedNoSmtpWarning = true;
    }
    console.log(`[Mail] Bestätigungslink für ${to} (${username}): ${link}`);
    return;
  }

  await t.sendMail({
    from: process.env.SMTP_FROM ?? 'FieldFaction <no-reply@fieldfaction.local>',
    to,
    subject: 'Bestätige deine E-Mail-Adresse — FieldFaction',
    text: `Hallo ${username},\n\nbitte bestätige deine E-Mail-Adresse, um dein FieldFaction-Konto zu aktivieren:\n${link}\n\nDer Link ist 24 Stunden gültig.`,
    html: `<p>Hallo ${username},</p><p>bitte bestätige deine E-Mail-Adresse, um dein FieldFaction-Konto zu aktivieren:</p><p><a href="${link}">${link}</a></p><p>Der Link ist 24 Stunden gültig.</p>`,
  });
}
