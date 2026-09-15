import { apiLogin, apiRegister, apiResendVerification, apiRequestPasswordReset, apiResetPassword } from '../api';

type OnSuccess = (token: string, username: string) => void;
type Mode = 'login' | 'register' | 'check-email' | 'forgot' | 'forgot-sent' | 'reset';

const SUBMIT_LABELS: Partial<Record<Mode, string>> = {
  login: 'Anmelden',
  register: 'Konto erstellen & spielen',
  forgot: 'Link anfordern',
  reset: 'Passwort speichern & spielen',
};

function escapeHtml(s: string): string {
  return s.replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]!));
}

export class LandingUI {
  private container: HTMLElement;
  private onSuccess: OnSuccess;
  private mode: Mode = 'login';
  // Username/E-Mail, für die zuletzt eine Verifizierung nötig war — Ziel des
  // "Erneut senden"-Buttons (Login akzeptiert beides, siehe apiResendVerification).
  private pendingVerificationLogin = '';
  // Username/E-Mail, für die zuletzt ein Reset-Link angefordert wurde (nur zur Anzeige).
  private pendingResetLogin = '';
  // Token aus dem Link der "Passwort vergessen"-Mail — gesetzt ⇒ Formular fürs neue Passwort.
  private resetToken?: string;
  private initialError?: string;

  constructor(container: HTMLElement, onSuccess: OnSuccess, initialError?: string, resetToken?: string) {
    this.container = container;
    this.onSuccess = onSuccess;
    this.initialError = initialError;
    this.resetToken = resetToken;
    if (resetToken) this.mode = 'reset';
  }

  render(): void {
    const showTabs = this.mode === 'login' || this.mode === 'register';
    this.container.innerHTML = `
      <div class="lp-root">

        <!-- NAV -->
        <nav class="lp-nav">
          <span class="lp-nav-logo">🌿 FieldFaction</span>
          <a href="#auth" class="lp-nav-btn">Anmelden</a>
        </nav>

        <!-- HERO -->
        <section class="lp-hero">
          <div class="lp-field-bg" aria-hidden="true">
            ${Array.from({length: 12}, (_, i) => `<div class="lp-field-row lp-row-${i % 6}"></div>`).join('')}
          </div>
          <div class="lp-hero-content">
            <!-- EARLY ACCESS HINWEIS -->
            <div class="lp-ea-banner">
              <span class="lp-ea-badge">🧪 Early Access</span>
              <span class="lp-ea-text">
                Das Spiel befindet sich in einer frühen Testphase. Schau gern rein und probier alles aus —
                aber alle Spielstände werden zurückgesetzt, sobald die finale Version live geht.
              </span>
            </div>
            <div class="lp-crop-row" aria-hidden="true">
              <span>🌾</span><span>🚜</span><span>🐄</span><span>🌽</span><span>🍅</span><span>🌻</span><span>🏪</span>
            </div>
            <h1 class="lp-headline">FieldFaction</h1>
            <p class="lp-subline">
              Ein Landwirtschaftsspiel im Browser: Felder bestellen, Tiere halten, Rohstoffe
              verarbeiten und auf einem gemeinsamen Markt verkaufen, auf dem auch andere Spieler bieten.
            </p>
            <a href="#auth" class="lp-cta-btn">Jetzt spielen</a>
          </div>
        </section>

        <!-- FEATURES -->
        <section class="lp-features">
          <div class="lp-features-grid">
            <div class="lp-feature-card">
              <h3>Markt</h3>
              <p>Kunden posten Anfragen, Spieler bieten darauf. Den Zuschlag bekommt, wer Preis und
              Reputation am besten kombiniert. Neue Anfragen kommen laufend dazu.</p>
            </div>
            <div class="lp-feature-card">
              <h3>Echte Wachstumszeiten</h3>
              <p>Weizen braucht zum Beispiel 5 Tage. Du planst im Voraus und erntest auch, wenn du
              gerade nicht online bist.</p>
            </div>
            <div class="lp-feature-card">
              <h3>Mehrere Standorte</h3>
              <p>Höfe in unterschiedlichen Städten eröffnen — jede Stadt hat ein eigenes Preisniveau
              und eigene Nachfrage.</p>
            </div>
            <div class="lp-feature-card">
              <h3>Hofladen</h3>
              <p>Eigene Preise für den Direktverkauf festlegen. Vertrauen bei Kunden zahlt sich mit der
              Zeit aus.</p>
            </div>
            <div class="lp-feature-card">
              <h3>Reputation</h3>
              <p>Zuverlässige Lieferungen verbessern deine Reputation — das bringt bessere Preise und
              mehr Zuschläge bei Ausschreibungen.</p>
            </div>
            <div class="lp-feature-card">
              <h3>Tierhaltung & Verarbeitung</h3>
              <p>Vom Rohstoff zum verarbeiteten Produkt, z.B. Milch zu Käse — je mehr Verarbeitung, desto
              höher der Verkaufspreis.</p>
            </div>
          </div>
        </section>

        <!-- AUTH -->
        <section class="lp-auth" id="auth">
          <div class="lp-auth-wrap">
            <div class="lp-auth-headline">
              <h2>Bereit zum Spielen?</h2>
              <p>Kostenlos — kein Download nötig.</p>
            </div>
            <div class="lp-auth-card">
              ${showTabs ? `
              <div class="lp-auth-tabs">
                <button class="lp-auth-tab ${this.mode === 'login' ? 'lp-auth-tab-active' : ''}" id="tab-login">Anmelden</button>
                <button class="lp-auth-tab ${this.mode === 'register' ? 'lp-auth-tab-active' : ''}" id="tab-register">Registrieren</button>
              </div>` : ''}
              ${this.cardContent()}
              <div id="auth-error" class="auth-error ${this.initialError ? '' : 'hidden'}">${this.initialError ?? ''}</div>
            </div>
          </div>
        </section>

        <!-- FOOTER -->
        <footer class="lp-footer">
          <span class="lp-footer-logo">🌿 FieldFaction</span>
          <span class="lp-footer-copy">Early Access · Feedback willkommen</span>
        </footer>

      </div>`;

    this.bindEvents();
  }

  private cardContent(): string {
    switch (this.mode) {
      case 'login':       return this.loginForm();
      case 'register':    return this.registerForm();
      case 'check-email': return this.checkEmailScreen();
      case 'forgot':      return this.forgotForm();
      case 'forgot-sent': return this.forgotSentScreen();
      case 'reset':       return this.resetForm();
    }
  }

  private loginForm(): string {
    return `
      <form id="auth-form" class="auth-form">
        <input class="auth-input" id="f-login" type="text" placeholder="Benutzername oder E-Mail" autocomplete="username" required>
        <input class="auth-input" id="f-password" type="password" placeholder="Passwort" autocomplete="current-password" required>
        <button class="auth-submit lp-submit" type="submit">Anmelden</button>
        <a href="#" id="forgot-password-link" class="lp-back-link">Passwort vergessen?</a>
      </form>`;
  }

  private registerForm(): string {
    return `
      <form id="auth-form" class="auth-form">
        <input class="auth-input" id="f-username" type="text" placeholder="Benutzername (3–30 Zeichen)" autocomplete="username" required>
        <input class="auth-input" id="f-email" type="email" placeholder="E-Mail-Adresse" autocomplete="email" required>
        <input class="auth-input" id="f-password" type="password" placeholder="Passwort (min. 8 Zeichen)" autocomplete="new-password" required>
        <button class="auth-submit lp-submit" type="submit">Konto erstellen &amp; spielen</button>
      </form>`;
  }

  private checkEmailScreen(): string {
    return `
      <div class="auth-check-email">
        <p>Wir haben dir einen Bestätigungslink an <strong>${escapeHtml(this.pendingVerificationLogin)}</strong> geschickt.
        Klicke ihn an, um dein Konto zu aktivieren.</p>
        <button class="btn btn-secondary lp-submit" id="resend-verification-btn" type="button">Erneut senden</button>
        <a href="#" id="back-to-login-link" class="lp-back-link">Zurück zum Login</a>
      </div>`;
  }

  private forgotForm(): string {
    return `
      <form id="auth-form" class="auth-form">
        <p class="auth-hint">Gib deinen Benutzernamen oder deine E-Mail-Adresse ein — wir schicken dir einen Link,
        mit dem du ein neues Passwort vergeben kannst.</p>
        <input class="auth-input" id="f-login" type="text" placeholder="Benutzername oder E-Mail" autocomplete="username" required>
        <button class="auth-submit lp-submit" type="submit">Link anfordern</button>
        <a href="#" id="back-to-login-link" class="lp-back-link">Zurück zum Login</a>
      </form>`;
  }

  private forgotSentScreen(): string {
    return `
      <div class="auth-check-email">
        <p>Falls es ein Konto zu <strong>${escapeHtml(this.pendingResetLogin)}</strong> gibt, haben wir dir eine Mail
        mit einem Link zum Zurücksetzen geschickt. Der Link ist 1 Stunde gültig.</p>
        <a href="#" id="back-to-login-link" class="lp-back-link">Zurück zum Login</a>
      </div>`;
  }

  private resetForm(): string {
    return `
      <form id="auth-form" class="auth-form">
        <p class="auth-hint">Vergib ein neues Passwort für dein Konto.</p>
        <input class="auth-input" id="f-password" type="password" placeholder="Neues Passwort (min. 8 Zeichen)" autocomplete="new-password" minlength="8" required>
        <input class="auth-input" id="f-password-confirm" type="password" placeholder="Neues Passwort wiederholen" autocomplete="new-password" minlength="8" required>
        <button class="auth-submit lp-submit" type="submit">Passwort speichern &amp; spielen</button>
        <a href="#" id="forgot-password-link" class="lp-back-link">Neuen Link anfordern</a>
      </form>`;
  }

  private switchMode(mode: Mode): void {
    this.initialError = undefined;
    this.mode = mode;
    this.render();
  }

  private bindEvents(): void {
    this.container.querySelector('#tab-login')?.addEventListener('click', () => {
      this.mode = 'login'; this.render();
      document.getElementById('auth')?.scrollIntoView({ behavior: 'smooth' });
    });
    this.container.querySelector('#tab-register')?.addEventListener('click', () => {
      this.mode = 'register'; this.render();
      document.getElementById('auth')?.scrollIntoView({ behavior: 'smooth' });
    });
    this.container.querySelector('#auth-form')?.addEventListener('submit', e => {
      e.preventDefault();
      switch (this.mode) {
        case 'login':    this.handleLogin(); break;
        case 'register': this.handleRegister(); break;
        case 'forgot':   this.handleForgotPassword(); break;
        case 'reset':    this.handleResetPassword(); break;
      }
    });
    this.container.querySelector('#resend-verification-btn')?.addEventListener('click', async () => {
      const btn = this.container.querySelector<HTMLButtonElement>('#resend-verification-btn')!;
      btn.disabled = true;
      btn.textContent = 'Wird gesendet…';
      await apiResendVerification(this.pendingVerificationLogin).catch(() => {});
      btn.textContent = 'Erneut gesendet ✓';
    });
    this.container.querySelector('#back-to-login-link')?.addEventListener('click', e => {
      e.preventDefault();
      this.switchMode('login');
    });
    this.container.querySelector('#forgot-password-link')?.addEventListener('click', e => {
      e.preventDefault();
      // Schon getippten Login übernehmen, damit man ihn nicht doppelt eingeben muss.
      const typed = this.container.querySelector<HTMLInputElement>('#f-login')?.value.trim() ?? '';
      this.switchMode('forgot');
      if (typed) this.container.querySelector<HTMLInputElement>('#f-login')!.value = typed;
      this.container.querySelector<HTMLInputElement>('#f-login')?.focus();
    });
    this.container.querySelectorAll('a[href="#auth"]').forEach(a => {
      a.addEventListener('click', e => {
        e.preventDefault();
        document.getElementById('auth')?.scrollIntoView({ behavior: 'smooth' });
        setTimeout(() => this.container.querySelector<HTMLInputElement>('#f-login, #f-username')?.focus(), 400);
      });
    });
  }

  private showError(msg: string): void {
    const el = this.container.querySelector<HTMLElement>('#auth-error');
    if (!el) return;
    el.textContent = msg;
    el.classList.remove('hidden');
  }

  private setLoading(loading: boolean): void {
    const btn = this.container.querySelector<HTMLButtonElement>('.auth-submit');
    if (!btn) return;
    btn.disabled = loading;
    btn.textContent = loading ? 'Bitte warten…' : (SUBMIT_LABELS[this.mode] ?? '');
  }

  private async handleLogin(): Promise<void> {
    const login    = this.container.querySelector<HTMLInputElement>('#f-login')!.value.trim();
    const password = this.container.querySelector<HTMLInputElement>('#f-password')!.value;
    this.setLoading(true);
    try {
      const { token, username } = await apiLogin(login, password);
      this.onSuccess(token, username);
    } catch (err: any) {
      if (err.code === 'email_not_verified') {
        this.pendingVerificationLogin = login;
        this.mode = 'check-email';
        this.render();
        return;
      }
      this.showError(err.message);
      this.setLoading(false);
    }
  }

  private async handleRegister(): Promise<void> {
    const username = this.container.querySelector<HTMLInputElement>('#f-username')!.value.trim();
    const email    = this.container.querySelector<HTMLInputElement>('#f-email')!.value.trim();
    const password = this.container.querySelector<HTMLInputElement>('#f-password')!.value;
    this.setLoading(true);
    try {
      const { email: confirmedEmail } = await apiRegister(username, email, password);
      this.pendingVerificationLogin = confirmedEmail;
      this.mode = 'check-email';
      this.render();
    } catch (err: any) {
      this.showError(err.message);
      this.setLoading(false);
    }
  }

  private async handleForgotPassword(): Promise<void> {
    const login = this.container.querySelector<HTMLInputElement>('#f-login')!.value.trim();
    this.setLoading(true);
    try {
      await apiRequestPasswordReset(login);
      this.pendingResetLogin = login;
      this.switchMode('forgot-sent');
    } catch (err: any) {
      this.showError(err.message);
      this.setLoading(false);
    }
  }

  private async handleResetPassword(): Promise<void> {
    const password = this.container.querySelector<HTMLInputElement>('#f-password')!.value;
    const confirm  = this.container.querySelector<HTMLInputElement>('#f-password-confirm')!.value;
    if (password.length < 8) return this.showError('Passwort muss mindestens 8 Zeichen haben');
    if (password !== confirm) return this.showError('Die Passwörter stimmen nicht überein');

    this.setLoading(true);
    try {
      const { token, username } = await apiResetPassword(this.resetToken!, password);
      this.onSuccess(token, username);
    } catch (err: any) {
      this.showError(err.message);
      this.setLoading(false);
    }
  }
}
