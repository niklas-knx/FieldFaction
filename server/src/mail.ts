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

function frontendLink(param: string, token: string): string {
  const origin = process.env.FRONTEND_ORIGIN ?? 'http://localhost:5173';
  return `${origin}/?${param}=${token}`;
}

// Ohne SMTP_HOST wird der Link nur geloggt statt verschickt — sinnvoller Default für
// lokale Entwicklung und Tests, ohne dass ein echter Mail-Provider nötig ist.
async function sendMail(to: string, subject: string, text: string, html: string, logLabel: string, link: string): Promise<void> {
  const t = getTransporter();

  if (!t) {
    if (!loggedNoSmtpWarning) {
      console.warn('[Mail] SMTP_HOST nicht gesetzt — Mail-Links werden nur geloggt, nicht verschickt.');
      loggedNoSmtpWarning = true;
    }
    console.log(`[Mail] ${logLabel} für ${to}: ${link}`);
    return;
  }

  await t.sendMail({
    from: process.env.SMTP_FROM ?? 'FieldFaction <no-reply@fieldfaction.local>',
    to,
    subject,
    text,
    html,
  });
}

export async function sendVerificationEmail(to: string, username: string, token: string): Promise<void> {
  const link = frontendLink('verifyToken', token);
  await sendMail(
    to,
    'Bestätige deine E-Mail-Adresse — FieldFaction',
    `Hallo ${username},\n\nbitte bestätige deine E-Mail-Adresse, um dein FieldFaction-Konto zu aktivieren:\n${link}\n\nDer Link ist 24 Stunden gültig.`,
    `<p>Hallo ${username},</p><p>bitte bestätige deine E-Mail-Adresse, um dein FieldFaction-Konto zu aktivieren:</p><p><a href="${link}">${link}</a></p><p>Der Link ist 24 Stunden gültig.</p>`,
    `Bestätigungslink (${username})`,
    link,
  );
}

export async function sendPasswordResetEmail(to: string, username: string, token: string): Promise<void> {
  const link = frontendLink('resetToken', token);
  await sendMail(
    to,
    'Passwort zurücksetzen — FieldFaction',
    `Hallo ${username},\n\ndu hast angefordert, dein FieldFaction-Passwort zurückzusetzen. Über diesen Link kannst du ein neues Passwort vergeben:\n${link}\n\nDer Link ist 1 Stunde gültig. Falls du das nicht warst, kannst du diese Mail einfach ignorieren — dein Passwort bleibt dann unverändert.`,
    `<p>Hallo ${username},</p><p>du hast angefordert, dein FieldFaction-Passwort zurückzusetzen. Über diesen Link kannst du ein neues Passwort vergeben:</p><p><a href="${link}">${link}</a></p><p>Der Link ist 1 Stunde gültig. Falls du das nicht warst, kannst du diese Mail einfach ignorieren — dein Passwort bleibt dann unverändert.</p>`,
    `Passwort-Reset-Link (${username})`,
    link,
  );
}
