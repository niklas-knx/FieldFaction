import { apiLogin, apiRegister, apiResendVerification } from '../api';

type OnSuccess = (token: string, username: string) => void;

export class LandingUI {
  private container: HTMLElement;
  private onSuccess: OnSuccess;
  private mode: 'login' | 'register' | 'check-email' = 'login';
  // Username/E-Mail, für die zuletzt eine Verifizierung nötig war — Ziel des
  // "Erneut senden"-Buttons (Login akzeptiert beides, siehe apiResendVerification).
  private pendingVerificationLogin = '';
  private initialError?: string;

  constructor(container: HTMLElement, onSuccess: OnSuccess, initialError?: string) {
    this.container = container;
    this.onSuccess = onSuccess;
    this.initialError = initialError;
  }

  render(): void {
    this.container.innerHTML = `
      <div class="lp-root">

        <!-- NAV -->
        <nav class="lp-nav">
          <span class="lp-nav-logo">🌿 FarmTycoon</span>
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
            <h1 class="lp-headline">
              Baue dein<br>
              <span class="lp-headline-accent">Landwirtschafts-Imperium.</span>
            </h1>
            <p class="lp-subline">
              Echtzeit-Strategie. Echter Wettbewerb.<br>
              Pflanze, ernte und sichere dir die besten Marktpreise — gegen echte Spieler.
            </p>
            <a href="#auth" class="lp-cta-btn">
              Jetzt kostenlos spielen
              <span class="lp-cta-arrow">→</span>
            </a>
          </div>
        </section>

        <!-- FEATURES -->
        <section class="lp-features">
          <div class="lp-features-grid">
            <div class="lp-feature-card">
              <div class="lp-feature-icon">📈</div>
              <h3>Echtzeit-Markt</h3>
              <p>Kunden posten Anfragen — du bietest. Wer Preis und Reputation kombiniert, gewinnt den Auftrag.</p>
            </div>
            <div class="lp-feature-card">
              <div class="lp-feature-icon">⏳</div>
              <h3>Echte Wachstumszeiten</h3>
              <p>Weizen braucht 5 Tage. Du planst im Voraus — und erntest auch wenn du offline bist.</p>
            </div>
            <div class="lp-feature-card">
              <div class="lp-feature-icon">🌍</div>
              <h3>Mehrere Standorte</h3>
              <p>Eröffne Höfe in ganz Deutschland. Jede Stadt hat ihren eigenen Markt-Charakter.</p>
            </div>
            <div class="lp-feature-card">
              <div class="lp-feature-icon">🏪</div>
              <h3>Eigener Hofladen</h3>
              <p>Setz deine Preise selbst. Kunden zahlen mehr — wenn sie dir vertrauen.</p>
            </div>
            <div class="lp-feature-card">
              <div class="lp-feature-icon">⭐</div>
              <h3>Reputation</h3>
              <p>Zuverlässigkeit zahlt sich aus. Höhere Reputation = bessere Preise und mehr Chancen.</p>
            </div>
            <div class="lp-feature-card">
              <div class="lp-feature-icon">🐄</div>
              <h3>Tiere & Verarbeitung</h3>
              <p>Vom Feld zur Molkerei zur Käserei. Je mehr Verarbeitung, desto höher die Marge.</p>
            </div>
          </div>
        </section>

        <!-- HOW IT WORKS -->
        <section class="lp-how">
          <h2 class="lp-section-title">So funktioniert's</h2>
          <div class="lp-steps">
            <div class="lp-step">
              <div class="lp-step-num">01</div>
              <div class="lp-step-text">
                <strong>Hof aufbauen</strong>
                <span>Kaufe Parzellen, pflüge, säe — und warte auf die Ernte.</span>
              </div>
            </div>
            <div class="lp-step-line"></div>
            <div class="lp-step">
              <div class="lp-step-num">02</div>
              <div class="lp-step-text">
                <strong>Marktanfragen beobachten</strong>
                <span>Kunden suchen jede Minute neue Lieferanten in deiner Region.</span>
              </div>
            </div>
            <div class="lp-step-line"></div>
            <div class="lp-step">
              <div class="lp-step-num">03</div>
              <div class="lp-step-text">
                <strong>Angebot abgeben</strong>
                <span>Biete Preis + Menge. Score = dein Preisvorteil × deine Reputation.</span>
              </div>
            </div>
            <div class="lp-step-line"></div>
            <div class="lp-step">
              <div class="lp-step-num">04</div>
              <div class="lp-step-text">
                <strong>Wachsen</strong>
                <span>Erweitere auf neue Städte, baue Verarbeitungsketten auf, dominiere den Markt.</span>
              </div>
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
              ${this.mode === 'check-email' ? '' : `
              <div class="lp-auth-tabs">
                <button class="lp-auth-tab ${this.mode === 'login' ? 'lp-auth-tab-active' : ''}" id="tab-login">Anmelden</button>
                <button class="lp-auth-tab ${this.mode === 'register' ? 'lp-auth-tab-active' : ''}" id="tab-register">Registrieren</button>
              </div>`}
              ${this.mode === 'login' ? this.loginForm()
                : this.mode === 'register' ? this.registerForm()
                : this.checkEmailScreen()}
              <div id="auth-error" class="auth-error ${this.initialError ? '' : 'hidden'}">${this.initialError ?? ''}</div>
            </div>
          </div>
        </section>

        <!-- FOOTER -->
        <footer class="lp-footer">
          <span class="lp-footer-logo">🌿 FarmTycoon</span>
          <span class="lp-footer-copy">Early Access · Feedback willkommen</span>
        </footer>

      </div>`;

    this.bindEvents();
  }

  private loginForm(): string {
    return `
      <form id="auth-form" class="auth-form">
        <input class="auth-input" id="f-login" type="text" placeholder="Benutzername oder E-Mail" autocomplete="username" required>
        <input class="auth-input" id="f-password" type="password" placeholder="Passwort" autocomplete="current-password" required>
        <button class="auth-submit lp-submit" type="submit">Anmelden</button>
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
        <p>Wir haben dir einen Bestätigungslink an <strong>${this.pendingVerificationLogin}</strong> geschickt.
        Klicke ihn an, um dein Konto zu aktivieren.</p>
        <button class="btn btn-secondary lp-submit" id="resend-verification-btn" type="button">Erneut senden</button>
        <a href="#" id="back-to-login-link" class="lp-back-link">Zurück zum Login</a>
      </div>`;
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
      this.mode === 'login' ? this.handleLogin() : this.handleRegister();
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
      this.initialError = undefined;
      this.mode = 'login'; this.render();
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
    btn.textContent = loading ? 'Bitte warten…' : (this.mode === 'login' ? 'Anmelden' : 'Konto erstellen & spielen');
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
}
