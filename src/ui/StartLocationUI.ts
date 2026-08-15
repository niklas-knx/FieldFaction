// Vollbild-Screen zwischen erfolgreicher Verifizierung und dem ersten Spiel: lässt den
// Spieler seinen kostenlosen Startort frei wählen, statt ihn fest auf München zu setzen.
// Stadtsuche via Nominatim/OpenStreetMap — gleicher Ansatz wie FarmUI's "Standort
// eröffnen" (dort kostet ein weiterer Standort Geld; hier ist es der kostenlose erste Hof).
type OnChosen = (city: string, farmName: string, lat: number, lon: number) => void;

export class StartLocationUI {
  private container: HTMLElement;
  private onChosen: OnChosen;
  private selected: { city: string; lat: number; lon: number } | null = null;
  private searchTimer: ReturnType<typeof setTimeout> | null = null;

  constructor(container: HTMLElement, onChosen: OnChosen) {
    this.container = container;
    this.onChosen = onChosen;
  }

  render(): void {
    this.container.innerHTML = `
      <div class="auth-backdrop start-loc-root">
        <div class="auth-card">
          <h1 class="auth-title">🌍 Wähle deinen Startort</h1>
          <p class="new-loc-cost">Kostenlos — such dir eine deutsche Stadt aus, um deinen ersten Hof zu gründen.</p>
          <div class="auth-form">
            <div class="new-loc-autocomplete-wrap">
              <input id="start-loc-city" class="auth-input new-loc-input" type="text" placeholder="Stadt suchen…" autocomplete="off" />
              <div id="start-loc-dropdown" class="new-loc-dropdown hidden"></div>
            </div>
            <input id="start-loc-name" class="auth-input new-loc-input" type="text" placeholder="Hofname (optional)" />
            <div id="start-loc-error" class="new-loc-error hidden"></div>
            <button class="auth-submit lp-submit" id="start-loc-confirm" type="button" disabled>Los geht's</button>
          </div>
        </div>
      </div>`;

    this.bindEvents();
  }

  private bindEvents(): void {
    const cityInput  = document.getElementById('start-loc-city') as HTMLInputElement;
    const dropdown   = document.getElementById('start-loc-dropdown')!;
    const confirmBtn = document.getElementById('start-loc-confirm') as HTMLButtonElement;
    const errorEl    = document.getElementById('start-loc-error')!;

    cityInput.addEventListener('input', () => {
      this.selected = null;
      confirmBtn.disabled = true;
      errorEl.classList.add('hidden');
      if (this.searchTimer) clearTimeout(this.searchTimer);
      const q = cityInput.value.trim();
      if (q.length < 2) { dropdown.classList.add('hidden'); return; }
      this.searchTimer = setTimeout(() => this.searchCities(q), 350);
    });

    confirmBtn.addEventListener('click', () => {
      if (!this.selected) return;
      const nameInput = document.getElementById('start-loc-name') as HTMLInputElement;
      const { city, lat, lon } = this.selected;
      const farmName = nameInput.value.trim() || `Gut ${city}`;
      confirmBtn.disabled = true;
      confirmBtn.textContent = 'Wird angelegt…';
      this.onChosen(city, farmName, lat, lon);
    });
  }

  private async searchCities(q: string): Promise<void> {
    const dropdown = document.getElementById('start-loc-dropdown');
    if (!dropdown) return;
    try {
      const url = `https://nominatim.openstreetmap.org/search?q=${encodeURIComponent(q)}&format=json&countrycodes=de&limit=10&addressdetails=1&accept-language=de`;
      const res  = await fetch(url, { headers: { 'User-Agent': 'FieldFaction/1.0' } });
      const data: any[] = await res.json();

      const places = data.filter(d => {
        const a = d.address ?? {};
        return a.country_code === 'de' && (a.city || a.town || a.village || a.hamlet);
      });

      const seen = new Set<string>();
      const unique = places.filter(d => {
        const name = d.address.city || d.address.town || d.address.village || d.address.hamlet;
        if (seen.has(name)) return false;
        seen.add(name);
        return true;
      });

      if (!unique.length) {
        dropdown.innerHTML = `<div class="new-loc-dd-empty">Keine Stadt in Deutschland gefunden</div>`;
        dropdown.classList.remove('hidden');
        return;
      }

      dropdown.innerHTML = unique.map((p, i) => {
        const a = p.address;
        const cityName = a.city || a.town || a.village || a.hamlet;
        const state    = a.state ?? '';
        return `<button class="new-loc-dd-item" data-idx="${i}">${cityName}${state ? `, ${state}` : ''}</button>`;
      }).join('');
      dropdown.classList.remove('hidden');

      dropdown.querySelectorAll('.new-loc-dd-item').forEach((btn, i) => {
        btn.addEventListener('click', () => {
          const p = unique[i];
          const cityName = p.address.city || p.address.town || p.address.village || p.address.hamlet;
          this.selected = { city: cityName, lat: parseFloat(p.lat), lon: parseFloat(p.lon) };
          (document.getElementById('start-loc-city') as HTMLInputElement).value = cityName;
          dropdown.classList.add('hidden');
          (document.getElementById('start-loc-confirm') as HTMLButtonElement).disabled = false;
        });
      });
    } catch {
      dropdown.classList.add('hidden');
    }
  }

  showError(msg: string): void {
    const el = document.getElementById('start-loc-error');
    const confirmBtn = document.getElementById('start-loc-confirm') as HTMLButtonElement | null;
    if (el) { el.textContent = msg; el.classList.remove('hidden'); }
    if (confirmBtn) { confirmBtn.disabled = false; confirmBtn.textContent = "Los geht's"; }
  }
}
