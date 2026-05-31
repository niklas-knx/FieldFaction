import { apiLogin, apiRegister } from '../api';

type OnSuccess = (token: string, username: string) => void;

export class AuthUI {
  private container: HTMLElement;
  private onSuccess: OnSuccess;
  private mode: 'login' | 'register' = 'login';

  constructor(container: HTMLElement, onSuccess: OnSuccess) {
    this.container = container;
    this.onSuccess = onSuccess;
  }

  render(): void {
    this.container.innerHTML = `
      <div class="auth-backdrop">
        <div class="auth-card">
          <h1 class="auth-title">🌿 FarmTycoon</h1>
          <div class="auth-tabs">
            <button class="auth-tab ${this.mode === 'login' ? 'auth-tab-active' : ''}" id="tab-login">Anmelden</button>
            <button class="auth-tab ${this.mode === 'register' ? 'auth-tab-active' : ''}" id="tab-register">Registrieren</button>
          </div>

          ${this.mode === 'login' ? this.loginForm() : this.registerForm()}

          <div id="auth-error" class="auth-error hidden"></div>
        </div>
      </div>`;

    this.container.querySelector('#tab-login')!.addEventListener('click', () => {
      this.mode = 'login'; this.render();
    });
    this.container.querySelector('#tab-register')!.addEventListener('click', () => {
      this.mode = 'register'; this.render();
    });
    this.container.querySelector('#auth-form')!.addEventListener('submit', e => {
      e.preventDefault();
      this.mode === 'login' ? this.handleLogin() : this.handleRegister();
    });
  }

  private loginForm(): string {
    return `
      <form id="auth-form" class="auth-form">
        <input class="auth-input" id="f-login" type="text" placeholder="Benutzername oder E-Mail" autocomplete="username" required>
        <input class="auth-input" id="f-password" type="password" placeholder="Passwort" autocomplete="current-password" required>
        <button class="auth-submit" type="submit">Anmelden</button>
      </form>`;
  }

  private registerForm(): string {
    return `
      <form id="auth-form" class="auth-form">
        <input class="auth-input" id="f-username" type="text" placeholder="Benutzername (3–30 Zeichen)" autocomplete="username" required>
        <input class="auth-input" id="f-email" type="email" placeholder="E-Mail-Adresse" autocomplete="email" required>
        <input class="auth-input" id="f-password" type="password" placeholder="Passwort (min. 8 Zeichen)" autocomplete="new-password" required>
        <button class="auth-submit" type="submit">Konto erstellen</button>
      </form>`;
  }

  private showError(msg: string): void {
    const el = this.container.querySelector<HTMLElement>('#auth-error')!;
    el.textContent = msg;
    el.classList.remove('hidden');
  }

  private setLoading(loading: boolean): void {
    const btn = this.container.querySelector<HTMLButtonElement>('.auth-submit')!;
    btn.disabled = loading;
    btn.textContent = loading ? 'Bitte warten…' : (this.mode === 'login' ? 'Anmelden' : 'Konto erstellen');
  }

  private async handleLogin(): Promise<void> {
    const login    = (this.container.querySelector<HTMLInputElement>('#f-login')!).value.trim();
    const password = (this.container.querySelector<HTMLInputElement>('#f-password')!).value;
    this.setLoading(true);
    try {
      const { token, username } = await apiLogin(login, password);
      this.onSuccess(token, username);
    } catch (err: any) {
      this.showError(err.message);
      this.setLoading(false);
    }
  }

  private async handleRegister(): Promise<void> {
    const username = (this.container.querySelector<HTMLInputElement>('#f-username')!).value.trim();
    const email    = (this.container.querySelector<HTMLInputElement>('#f-email')!).value.trim();
    const password = (this.container.querySelector<HTMLInputElement>('#f-password')!).value;
    this.setLoading(true);
    try {
      const { token, username: uname } = await apiRegister(username, email, password);
      this.onSuccess(token, uname);
    } catch (err: any) {
      this.showError(err.message);
      this.setLoading(false);
    }
  }
}
