import type { GameState, Plot, StallSize, FarmMeta, MarketRequest, MarketBid, HofladenOffer } from '../types';
import * as L from 'leaflet';
import { CROPS, CROP_LIST } from '../data/crops';
import { ANIMALS, ANIMAL_LIST, happinessLabel, happinessHearts, computeYield, getMaxAnimals, getBuyCost, getBreedingCycle } from '../data/animals';
import { PRODUCTS, formatAmount, productValue, totalStorageValue } from '../data/products';
import {
  growthProgress, slotProgress, slotBreedProgress, seasonName, farmReadyCount, nextBuyablePlot,
  setActiveFarm, unlockFarm, openNewFarm, buyPlot, tillPlot, plantCrop, harvestPlot,
  buildStall, buildSecondHalfStall, collectStall, buyAnimal, sellFromStorage,
  buildProcessingBuilding, loadProcessing, collectProcessingOutput, procProgress,
  setSlaughterTarget, setSlaughterAnimal, countFarmAnimals,
  buyVehicle, moveVehicle, buyImplement, moveImplement,
  designateField, demolishPlot, sellToMerchant,
  TICKS_PER_DAY, DAYS_PER_SEASON,
} from '../farm/Farm';
import { VEHICLE_LIST, VEHICLES, TASK_LABELS } from '../data/vehicles';
import { IMPLEMENT_LIST, IMPLEMENTS, IMPLEMENT_TASK_LABELS } from '../data/implements';
import { MERCHANTS, CITY_MERCHANTS, merchantPrice, topOffers } from '../data/merchants';
import { NEW_LOCATION_COST } from '../data/farmLocations';
import {
  PROCESSING_BUILDINGS, PROCESSING_LIST, PROCESSING_BASES,
  freeSpaceUnits, sizeLabel, sizeHa, freeUnitsLabel, processingSpaceUnits,
} from '../data/processing';
import type { StallSlot } from '../types';
import { bus } from '../core/EventBus';
import {
  apiGetMarketRequests, apiSubmitBid, apiGetMyBids, apiCancelBid,
  apiGetReputation,
} from '../api';
import { CITY_PROFILES } from '../data/cityProfiles';

const navExpanded: Record<string, boolean> = { agriculture: true };

export class FarmUI {
  private container: HTMLElement;
  private state!: GameState;
  private onStateChange: (s: GameState) => void;
  private currentView: 'farm' | 'map' | 'vehicles' | 'market' = 'farm';
  private selectedMerchantId: string | null = null;
  private selectedMerchantFarmId: string | null = null;
  private leafletMap: L.Map | null = null;
  private leafletMarkers: L.Marker[] = [];
  private pendingBuyCategory: 'vehicle' | 'implement' = 'vehicle';
  private pendingBuyDefId: string | null = null;
  // eslint-disable-next-line @typescript-eslint/no-unused-vars
  private pendingPlotId: number | null = null;
  // Markt-System
  private marketTab: 'anfragen' | 'hofladen' | 'reputation' = 'anfragen';
  private marketRequests: MarketRequest[] = [];
  private marketBids: MarketBid[] = [];
  private marketReputation: Record<string, number> = {};
  private expandedRequestId: number | null = null;

  constructor(container: HTMLElement, onStateChange: (s: GameState) => void) {
    this.container = container;
    this.onStateChange = onStateChange;
    this.buildShell();
    bus.on<string>('notification', text => this.showNotification(text));
  }

  private buildShell(): void {
    this.container.innerHTML = `
      <div class="game-wrapper">
        <header class="top-bar">
          <div class="top-bar-left"><span class="game-title">🌿 FarmTycoon</span></div>
          <div class="top-bar-right" id="hud-money"></div>
        </header>
        <div class="game-body">
          <nav class="nav-sidebar" id="nav-sidebar"></nav>
          <main class="farm-area" id="farm-area"></main>
          <div class="info-sidebar" id="info-sidebar"></div>
        </div>
        <div id="notification" class="notification hidden"></div>

        <!-- Crop picker -->
        <div id="crop-picker" class="modal hidden">
          <div class="modal-card">
            <h3>Pflanze wählen</h3>
            <div id="crop-picker-list" class="crop-picker-list"></div>
            <button class="btn btn-secondary" id="crop-picker-cancel">Abbrechen</button>
          </div>
        </div>

        <!-- Plot use picker (Feld / Stall / Verarbeitung) -->
        <div id="plot-use-picker" class="modal hidden">
          <div class="modal-card modal-card-narrow">
            <h3>Was soll auf diesem Feld entstehen?</h3>
            <div class="plot-use-grid" id="plot-use-grid"></div>
            <button class="btn btn-secondary" id="plot-use-cancel">Abbrechen</button>
          </div>
        </div>

        <!-- Stall builder -->
        <div id="stall-builder" class="modal hidden">
          <div class="modal-card">
            <h3 id="stall-builder-title">Stall bauen</h3>
            <div id="stall-size-choice" class="stall-size-choice"></div>
            <button class="btn btn-secondary" id="stall-builder-cancel">Zurück</button>
          </div>
        </div>

        <!-- Vehicle farm picker -->
        <div id="vehicle-farm-picker" class="modal hidden">
          <div class="modal-card modal-card-narrow">
            <h3>Wohin soll das Fahrzeug?</h3>
            <div id="vfp-farm-list"></div>
            <button class="btn btn-secondary" id="vfp-cancel">Abbrechen</button>
          </div>
        </div>

        <!-- Processing builder -->
        <div id="processing-builder" class="modal hidden">
          <div class="modal-card">
            <h3 id="processing-builder-title">Verarbeitungsgebäude bauen</h3>
            <div id="processing-builder-list" class="processing-builder-list"></div>
            <button class="btn btn-secondary" id="processing-builder-cancel">Abbrechen</button>
          </div>
        </div>

        <!-- Standort eröffnen -->
        <div id="new-location-modal" class="modal hidden">
          <div class="modal-card modal-card-narrow">
            <h3>Standort eröffnen</h3>
            <p class="new-loc-cost">Kosten: ${NEW_LOCATION_COST.toLocaleString('de-DE')} €</p>
            <div class="new-loc-autocomplete-wrap">
              <input id="new-loc-city" class="new-loc-input" type="text" placeholder="Stadt suchen…" autocomplete="off" />
              <div id="new-loc-dropdown" class="new-loc-dropdown hidden"></div>
            </div>
            <input id="new-loc-name" class="new-loc-input" type="text" placeholder="Hofname (optional)" />
            <div id="new-loc-error" class="new-loc-error hidden"></div>
            <div class="new-loc-buttons">
              <button class="btn btn-secondary" id="new-loc-cancel">Abbrechen</button>
              <button class="btn btn-primary" id="new-loc-confirm" disabled>Eröffnen</button>
            </div>
          </div>
        </div>

        <!-- Marktauftrag aufgeben -->
        <div id="market-order-modal" class="modal hidden">
          <div class="modal-card modal-card-narrow">
            <h3>Marktauftrag aufgeben</h3>
            <div id="market-order-form"></div>
            <div class="new-loc-buttons">
              <button class="btn btn-secondary" id="market-order-cancel">Abbrechen</button>
              <button class="btn btn-success" id="market-order-confirm">Auftrag aufgeben</button>
            </div>
          </div>
        </div>

      </div>`;

    document.getElementById('new-loc-cancel')!.addEventListener('click', () => this.closeModals());
    document.getElementById('new-loc-confirm')!.addEventListener('click', () => this.handleNewLocation());
    document.getElementById('crop-picker-cancel')!.addEventListener('click', () => this.closeModals());
    document.getElementById('plot-use-cancel')!.addEventListener('click', () => this.closeModals());
    document.getElementById('stall-builder-cancel')!.addEventListener('click', () => {
      document.getElementById('stall-builder')!.classList.add('hidden');
      document.getElementById('plot-use-picker')!.classList.remove('hidden');
    });
    document.getElementById('vfp-cancel')!.addEventListener('click', () => this.closeModals());
    document.getElementById('processing-builder-cancel')!.addEventListener('click', () => this.closeModals());
    document.getElementById('market-order-cancel')!.addEventListener('click', () => this.closeModals());
    document.getElementById('market-order-confirm')!.addEventListener('click', () => this.submitMarketOrder());
  }

  render(state: GameState): void {
    this.state = state;
    this.renderHUD();
    this.renderNav();
    if (this.currentView === 'map') {
      this.renderMapView();
      const sidebarEl = document.getElementById('info-sidebar');
      if (sidebarEl) sidebarEl.innerHTML = '';
    } else if (this.currentView === 'vehicles') {
      this.destroyLeafletMap();
      this.renderVehicleShop();
      const sidebarEl = document.getElementById('info-sidebar');
      if (sidebarEl) sidebarEl.innerHTML = '';
    } else if (this.currentView === 'market') {
      this.destroyLeafletMap();
      this.renderMarketView();
    } else {
      this.destroyLeafletMap();
      this.renderFarmArea();
      this.renderInfoSidebar();
    }
  }

  // ── HUD ─────────────────────────────────────────────────────────────────

  private renderHUD(): void {
    const moneyEl = document.getElementById('hud-money');
    if (!moneyEl) return;
    moneyEl.innerHTML = `<span class="hud-money-value">💰 ${this.state.money.toLocaleString('de-DE')} €</span>`;
  }

  // ── Nav ──────────────────────────────────────────────────────────────────

  private renderNav(): void {
    const el = document.getElementById('nav-sidebar');
    if (!el) return;
    const agriOpen = navExpanded['agriculture'] !== false;

    const farmItems = this.state.farmMeta
      .filter(meta => meta.unlocked)
      .map(meta => {
        const farm    = this.state.farms[meta.id];
        const isActive = meta.id === this.state.activeFarmId;
        const ready   = farm ? farmReadyCount(farm) : 0;
        const owned   = farm?.plots.filter(p => !p.locked).length ?? 0;
        return `<button class="nav-item ${isActive ? 'nav-item-active' : ''}" data-nav-farm="${meta.id}">
          <span class="nav-item-dot ${ready > 0 ? 'nav-dot-ready' : ''}"></span>
          <span class="nav-item-text">
            <span class="nav-item-name">${meta.name}</span>
            <span class="nav-item-city">${meta.city} · ${owned} Parz.</span>
          </span>
          ${ready > 0 ? `<span class="nav-badge">${ready}</span>` : ''}
        </button>`;
      }).join('');

    const canAffordLocation = this.state.money >= NEW_LOCATION_COST;
    const newLocationBtn = `<button class="nav-item nav-item-new-location ${canAffordLocation ? '' : 'nav-item-locked'}" id="nav-new-location">
      <span class="nav-item-dot"></span>
      <span class="nav-item-text">
        <span class="nav-item-name">+ Standort eröffnen</span>
        <span class="nav-item-city">${NEW_LOCATION_COST.toLocaleString('de-DE')} €</span>
      </span>
    </button>`;

    const isMapActive = this.currentView === 'map';
    el.innerHTML = `
      <div class="nav-section">
        <button class="nav-section-header" id="nav-toggle-agriculture">
          <span class="nav-chevron ${agriOpen ? 'open' : ''}">›</span>
          <span class="nav-section-icon">🌾</span>
          <span class="nav-section-title">Landwirtschaft</span>
        </button>
        <div class="nav-section-body ${agriOpen ? '' : 'collapsed'}">${farmItems}${newLocationBtn}</div>
      </div>
      <div class="nav-section">
        <button class="nav-section-header ${isMapActive ? 'nav-section-map-active' : ''}" id="nav-karte-btn">
          <span class="nav-section-icon">🗺</span>
          <span class="nav-section-title">Karte</span>
          <span class="nav-section-soon">${this.state.farmMeta.filter(m => m.unlocked).length} Standorte</span>
        </button>
      </div>
      <div class="nav-section">
        <button class="nav-section-header ${this.currentView === 'vehicles' ? 'nav-section-map-active' : ''}" id="nav-vehicles-btn">
          <span class="nav-section-icon">🚜</span>
          <span class="nav-section-title">Fahrzeuge</span>
          <span class="nav-section-soon">${this.state.vehicles.length} im Besitz</span>
        </button>
      </div>
      <div class="nav-section">
        <button class="nav-section-header ${this.currentView === 'market' ? 'nav-section-map-active' : ''}" id="nav-market-btn">
          <span class="nav-section-icon">📈</span>
          <span class="nav-section-title">Markt</span>
          <span class="nav-section-soon">${this.state.farmMeta.filter(m => m.unlocked).length} Standorte</span>
        </button>
      </div>
      ${['⚙️ Verarbeitung','🚛 Logistik'].map(t => `
        <div class="nav-section">
          <button class="nav-section-header nav-section-disabled">
            <span class="nav-chevron">›</span>
            <span class="nav-section-title">${t}</span>
            <span class="nav-section-soon">bald</span>
          </button>
        </div>`).join('')}
      <div class="nav-footer">
        <div class="nav-stat"><span>Geerntet</span><strong>${this.state.stats.totalHarvested}×</strong></div>
        <div class="nav-stat"><span>Einnahmen</span><strong>${this.state.stats.totalEarned.toLocaleString('de-DE')} €</strong></div>
      </div>`;

    document.getElementById('nav-toggle-agriculture')?.addEventListener('click', () => {
      navExpanded['agriculture'] = !agriOpen; this.renderNav();
    });
    el.querySelectorAll('[data-nav-farm]').forEach(b => b.addEventListener('click', () => {
      this.state = setActiveFarm(this.state, (b as HTMLElement).dataset.navFarm!);
      this.currentView = 'farm';
      this.onStateChange(this.state);
      this.render(this.state);
    }));
    el.querySelectorAll('[data-nav-unlock]').forEach(b => b.addEventListener('click', () => {
      this.state = unlockFarm(this.state, (b as HTMLElement).dataset.navUnlock!);
      this.currentView = 'farm';
      this.onStateChange(this.state);
      this.render(this.state);
    }));
    document.getElementById('nav-new-location')?.addEventListener('click', () => {
      (document.getElementById('new-loc-city') as HTMLInputElement).value = '';
      (document.getElementById('new-loc-name') as HTMLInputElement).value = '';
      document.getElementById('new-loc-error')!.classList.add('hidden');
      document.getElementById('new-loc-dropdown')!.classList.add('hidden');
      (document.getElementById('new-loc-confirm') as HTMLButtonElement).disabled = true;
      this.selectedLocation = null;
      document.getElementById('new-location-modal')!.classList.remove('hidden');
      this.initNewLocationModal();
    });
    document.getElementById('nav-karte-btn')?.addEventListener('click', () => {
      this.currentView = this.currentView === 'map' ? 'farm' : 'map';
      this.render(this.state);
    });
    document.getElementById('nav-vehicles-btn')?.addEventListener('click', () => {
      this.currentView = this.currentView === 'vehicles' ? 'farm' : 'vehicles';
      this.render(this.state);
    });
    document.getElementById('nav-market-btn')?.addEventListener('click', () => {
      this.currentView = this.currentView === 'market' ? 'farm' : 'market';
      this.render(this.state);
    });
  }

  // ── Farm Area ────────────────────────────────────────────────────────────

  private renderFarmArea(): void {
    const el   = document.getElementById('farm-area');
    if (!el) return;
    const farmId = this.state.activeFarmId;
    const farm   = this.state.farms[farmId];
    const meta   = this.state.farmMeta.find(m => m.id === farmId);
    if (!farm || !meta) { el.innerHTML = '<div class="farm-empty">Kein Betrieb</div>'; return; }

    const owned = farm.plots.filter(p => !p.locked);
    const next  = nextBuyablePlot(farm);
    const canBuy = next ? this.state.money >= next.unlockCost : false;

    el.innerHTML = `
      <div class="farm-header">
        <div class="farm-breadcrumb">
          <span class="breadcrumb-section">🌾 Landwirtschaft</span>
          <span class="breadcrumb-sep">›</span>
          <span class="breadcrumb-current">${meta.name}</span>
          <span class="breadcrumb-city">${meta.city}</span>
        </div>
        <div class="farm-header-meta">
          <span class="farm-field-count">${owned.length} / 12 Parzellen</span>
          <span class="farm-area-size">${(owned.length * 0.1).toFixed(1)} ha</span>
        </div>
      </div>
      <div class="fields-grid" id="fields-grid"></div>
      ${next ? `<div class="buy-field-row">
        <button class="btn-buy-field ${canBuy ? '' : 'disabled'}" id="buy-next-plot" ${canBuy ? '' : 'disabled'}>
          <span class="buy-field-icon">＋</span>
          <span class="buy-field-text">
            <span>Parzelle ${next.id + 1} kaufen</span>
            <span class="buy-field-size">0,1 ha · ${next.unlockCost.toLocaleString('de-DE')} €</span>
          </span>
        </button>
        ${!canBuy ? `<span class="buy-field-hint">Noch ${(next.unlockCost - this.state.money).toLocaleString('de-DE')} € fehlen</span>` : ''}
      </div>` : ''}`;

    const grid = document.getElementById('fields-grid')!;
    owned.forEach(plot => grid.appendChild(this.buildPlotCard(plot)));

    document.getElementById('buy-next-plot')?.addEventListener('click', () => {
      if (!next) return;
      this.state = buyPlot(this.state, farmId, next.id);
      this.onStateChange(this.state);
      this.renderHUD(); this.renderNav(); this.renderFarmArea(); this.renderInfoSidebar();
    });

    // Fleet section for this farm
    const farmVehicles   = this.state.vehicles.filter(v => v.farmId === farmId);
    const farmImplements = this.state.implements.filter(i => i.farmId === farmId);
    const unlockedFarms  = this.state.farmMeta.filter(m => m.unlocked);
    const total = farmVehicles.length + farmImplements.length;

    const relocateSelect = (uid: number, isFarm: boolean) =>
      unlockedFarms.length > 1
        ? `<select class="${isFarm ? 'fleet-card-relocate' : 'fleet-card-relocate fleet-card-relocate-impl'}"
            data-${isFarm ? 'vehicle' : 'implement'}-uid="${uid}">
            ${unlockedFarms.map(m => `<option value="${m.id}" ${m.id === farmId ? 'selected' : ''}>${m.city}</option>`).join('')}
          </select>`
        : '';

    const vehicleRows = farmVehicles.map(v => {
      const def = VEHICLES[v.defId];
      if (!def) return '';
      const free = v.inUseUntilTick <= this.state.tick;
      return `<div class="farm-fleet-card">
        <span class="fleet-card-emoji">${def.emoji}</span>
        <div class="fleet-card-info">
          <span class="fleet-card-name">${def.name}</span>
          <span class="fleet-card-tasks">${def.tasks.map(t => TASK_LABELS[t]).join(' · ')}</span>
        </div>
        <span class="fleet-status ${free ? 'fleet-status-free' : 'fleet-status-busy'}">${free ? 'Frei' : 'Belegt'}</span>
        ${relocateSelect(v.uid, true)}
      </div>`;
    }).join('');

    const implementRows = farmImplements.map(i => {
      const def = IMPLEMENTS[i.defId];
      if (!def) return '';
      const free = i.inUseUntilTick <= this.state.tick;
      return `<div class="farm-fleet-card farm-fleet-card-impl">
        <span class="fleet-card-emoji">${def.emoji}</span>
        <div class="fleet-card-info">
          <span class="fleet-card-name">${def.name}</span>
          <span class="fleet-card-tasks">${IMPLEMENT_TASK_LABELS[def.task]} · Traktor erforderlich</span>
        </div>
        <span class="fleet-status ${free ? 'fleet-status-free' : 'fleet-status-busy'}">${free ? 'Frei' : 'Belegt'}</span>
        ${relocateSelect(i.uid, false)}
      </div>`;
    }).join('');

    const fleetEl = document.createElement('div');
    fleetEl.className = 'farm-fleet-section';
    fleetEl.innerHTML = `
      <div class="farm-fleet-header">
        <span class="farm-fleet-title">🚜 Fuhrpark & Geräte</span>
        <span class="farm-fleet-count">${total} gesamt · <a class="fleet-shop-link" href="#">Shop</a></span>
      </div>
      ${total === 0
        ? '<p class="text-muted farm-fleet-empty">Keine Fahrzeuge hier · <a class="fleet-shop-link-2" href="#">Im Shop kaufen</a></p>'
        : `${farmVehicles.length > 0 ? vehicleRows : ''}
           ${farmImplements.length > 0 ? `<div class="fleet-impl-sep">Anbaugeräte</div>${implementRows}` : ''}`}`;

    el.appendChild(fleetEl);

    fleetEl.querySelectorAll('.fleet-shop-link, .fleet-shop-link-2').forEach(a => {
      a.addEventListener('click', e => { e.preventDefault(); this.currentView = 'vehicles'; this.render(this.state); });
    });
    fleetEl.querySelectorAll('[data-vehicle-uid]').forEach(sel => {
      sel.addEventListener('change', () => {
        const uid = parseInt((sel as HTMLSelectElement).dataset.vehicleUid!);
        this.state = moveVehicle(this.state, uid, (sel as HTMLSelectElement).value);
        this.onStateChange(this.state); this.renderHUD(); this.renderNav(); this.renderFarmArea();
      });
    });
    fleetEl.querySelectorAll('[data-implement-uid]').forEach(sel => {
      sel.addEventListener('change', () => {
        const uid = parseInt((sel as HTMLSelectElement).dataset.implementUid!);
        this.state = moveImplement(this.state, uid, (sel as HTMLSelectElement).value);
        this.onStateChange(this.state); this.renderHUD(); this.renderNav(); this.renderFarmArea();
      });
    });
  }

  // ── Vehicle Shop ──────────────────────────────────────────────────────────────

  private renderVehicleShop(): void {
    const el = document.getElementById('farm-area');
    if (!el) return;

    const totalOwned = this.state.vehicles.length + this.state.implements.length;

    // Overview: all owned items grouped by farm
    const byFarm = this.state.farmMeta.filter(m => m.unlocked).map(meta => {
      const veh  = this.state.vehicles.filter(v => v.farmId === meta.id);
      const impl = this.state.implements.filter(i => i.farmId === meta.id);
      return { meta, veh, impl };
    }).filter(g => g.veh.length > 0 || g.impl.length > 0);

    const overviewHTML = byFarm.length === 0
      ? '<p class="text-muted" style="padding:4px 0">Noch nichts gekauft.</p>'
      : byFarm.map(({ meta, veh, impl }) => `
          <div class="fleet-overview-row">
            <span class="fleet-farm-name">📍 ${meta.city}</span>
            <span class="fleet-tags">
              ${veh.map(v  => `<span class="fleet-tag">${VEHICLES[v.defId]?.emoji ?? '🚜'} ${VEHICLES[v.defId]?.name ?? ''}</span>`).join('')}
              ${impl.map(i => `<span class="fleet-tag fleet-tag-impl">${IMPLEMENTS[i.defId]?.emoji ?? '🔧'} ${IMPLEMENTS[i.defId]?.name ?? ''}</span>`).join('')}
            </span>
          </div>`).join('');

    const makeCard = (emoji: string, name: string, desc: string, tags: string[], price: number, buyAttr: string, defId: string) => {
      const canAfford = this.state.money >= price;
      return `<div class="vshop-card ${canAfford ? '' : 'vshop-card-locked'}">
        <div class="vshop-emoji">${emoji}</div>
        <div class="vshop-info">
          <div class="vshop-name">${name}</div>
          <div class="vshop-desc">${desc}</div>
          <div class="vshop-tasks">${tags.map(t => `<span class="vshop-task">${t}</span>`).join('')}</div>
        </div>
        <div class="vshop-right">
          <div class="vshop-price">${price.toLocaleString('de-DE')} €</div>
          <button class="btn btn-primary vshop-buy-btn ${canAfford ? '' : 'disabled'}"
            data-${buyAttr}="${defId}" ${canAfford ? '' : 'disabled'}>Kaufen</button>
        </div>
      </div>`;
    };

    const vehicleCardsHTML = VEHICLE_LIST.map(def =>
      makeCard(def.emoji, def.name, def.description, def.tasks.map(t => TASK_LABELS[t]), def.price, 'buy-vehicle', def.id)
    ).join('');

    const implementCardsHTML = IMPLEMENT_LIST.map(def =>
      makeCard(def.emoji, def.name, def.description,
        [`${IMPLEMENT_TASK_LABELS[def.task]}`, `🚜 Benötigt: ${def.requiresVehicle.join(', ')}`],
        def.price, 'buy-implement', def.id)
    ).join('');

    el.innerHTML = `
      <div class="farm-header">
        <div class="farm-breadcrumb">
          <span class="breadcrumb-section">🚜 Fahrzeuge</span>
          <span class="breadcrumb-sep">›</span>
          <span class="breadcrumb-current">Shop & Fuhrpark</span>
        </div>
        <div class="farm-header-meta">
          <span class="farm-field-count">${totalOwned} Fahrzeuge & Geräte</span>
        </div>
      </div>
      <div class="vshop-layout">
        <div class="panel vshop-fleet-panel">
          <h4 class="panel-title">Dein Fuhrpark</h4>
          ${overviewHTML}
        </div>
        <div class="vshop-catalog">
          <div class="vshop-section-label">🚜 Fahrzeuge</div>
          ${vehicleCardsHTML}
          <div class="vshop-section-label" style="margin-top:16px">🔧 Anbaugeräte <span style="font-size:10px;opacity:0.6;font-weight:400">— hängen am Traktor</span></div>
          ${implementCardsHTML}
        </div>
      </div>`;

    el.querySelectorAll('[data-buy-vehicle]').forEach(btn => {
      btn.addEventListener('click', () => {
        this.pendingBuyCategory = 'vehicle';
        this.pendingBuyDefId = (btn as HTMLElement).dataset.buyVehicle!;
        this.openVehicleFarmPicker();
      });
    });
    el.querySelectorAll('[data-buy-implement]').forEach(btn => {
      btn.addEventListener('click', () => {
        this.pendingBuyCategory = 'implement';
        this.pendingBuyDefId = (btn as HTMLElement).dataset.buyImplement!;
        this.openVehicleFarmPicker();
      });
    });
  }

  private openVehicleFarmPicker(): void {
    const isImpl = this.pendingBuyCategory === 'implement';
    const defId  = this.pendingBuyDefId;
    if (!defId) return;

    const def = isImpl ? IMPLEMENTS[defId] : VEHICLES[defId];
    document.getElementById('vehicle-farm-picker')!.querySelector('h3')!.textContent =
      `Wohin soll ${isImpl ? 'das Anbaugerät' : 'das Fahrzeug'}?`;

    const unlocked = this.state.farmMeta.filter(m => m.unlocked);

    // Direct buy if only one farm
    if (unlocked.length === 1) {
      this.closeModals();
      this.executeBuy(defId, unlocked[0].id);
      return;
    }

    const listEl = document.getElementById('vfp-farm-list')!;
    listEl.innerHTML = unlocked.map(meta => {
      const vCount = this.state.vehicles.filter(v => v.farmId === meta.id).length;
      const iCount = this.state.implements.filter(i => i.farmId === meta.id).length;
      return `<button class="vfp-farm-btn" data-vfp-farm="${meta.id}">
        <span class="vfp-farm-emoji">${def?.emoji ?? '🏡'}</span>
        <div>
          <div class="vfp-farm-name">${meta.city}</div>
          <div class="vfp-farm-sub">${meta.name} · ${vCount} Fzg. · ${iCount} Geräte</div>
        </div>
      </button>`;
    }).join('');
    document.getElementById('vehicle-farm-picker')!.classList.remove('hidden');

    listEl.querySelectorAll('[data-vfp-farm]').forEach(btn => {
      btn.addEventListener('click', () => {
        const farmId = (btn as HTMLElement).dataset.vfpFarm!;
        this.closeModals();
        this.executeBuy(defId, farmId);
      });
    });
  }

  private executeBuy(defId: string, farmId: string): void {
    if (this.pendingBuyCategory === 'implement') {
      this.state = buyImplement(this.state, defId, farmId);
    } else {
      this.state = buyVehicle(this.state, defId, farmId);
    }
    this.pendingBuyDefId = null;
    this.onStateChange(this.state);
    this.renderHUD(); this.renderNav(); this.renderVehicleShop();
  }

  // ── Market View ──────────────────────────────────────────────────────────────

  private renderMarketView(): void {
    const el = document.getElementById('farm-area');
    if (!el) return;

    const pendingBids = this.marketBids.filter(b => b.status === 'pending').length;
    type MarketTabId = 'anfragen' | 'hofladen' | 'reputation';
    const tabs: Array<{ id: MarketTabId; label: string; badge?: number }> = [
      { id: 'anfragen',   label: 'Anfragen', badge: pendingBids || undefined },
      { id: 'hofladen',   label: 'Hofladen' },
      { id: 'reputation', label: 'Reputation' },
    ];

    const tabHtml = tabs.map(t => `
      <button class="market-tab-btn ${this.marketTab === t.id ? 'market-tab-active' : ''}" data-tab="${t.id}">
        ${t.label}${t.badge ? ` <span class="market-tab-badge">${t.badge}</span>` : ''}
      </button>`).join('');

    el.innerHTML = `
      <div class="farm-header">
        <div class="farm-breadcrumb">
          <span class="breadcrumb-section">📈 Markt</span>
        </div>
      </div>
      <div class="market-tabs">${tabHtml}</div>
      <div id="market-tab-content"></div>`;

    el.querySelectorAll('.market-tab-btn').forEach(btn => {
      btn.addEventListener('click', () => {
        this.marketTab = (btn as HTMLElement).dataset.tab as typeof this.marketTab;
        this.refreshMarketData();
      });
    });

    this.refreshMarketData();
  }

  private renderMarketTabContent(): void {
    const el = document.getElementById('market-tab-content');
    if (!el) return;
    const sidebarEl = document.getElementById('info-sidebar');
    if (sidebarEl) sidebarEl.innerHTML = '';

    if (this.marketTab === 'anfragen')   this.renderAnfragenTab(el);
    if (this.marketTab === 'hofladen')   this.renderMarketHofladenTab(el);
    if (this.marketTab === 'reputation') this.renderMarketReputationTab(el);
  }

  private refreshMarketData(): void {
    const cities = this.state.farmMeta.filter(m => m.unlocked).map(m => m.id);
    Promise.all([
      apiGetMarketRequests(cities).then(({ requests }) => { this.marketRequests = requests; }),
      apiGetMyBids().then(({ bids }) => { this.marketBids = bids; }),
      apiGetReputation().then(({ reputation }) => { this.marketReputation = reputation; }),
    ]).catch(() => {}).finally(() => this.renderMarketTabContent());
  }

  // ── Tab: Anfragen ──────────────────────────────────────────────────────────

  private clientScore(reputation: number, price: number, maxPrice: number): number {
    const rep   = Math.pow(Math.min(100, Math.max(0, reputation)) / 100, 0.7);
    const pr    = Math.max(0, 1 - price / maxPrice);
    return rep * 0.55 + pr * 0.45;
  }

  private renderAnfragenTab(el: HTMLElement): void {
    const cities = this.state.farmMeta.filter(m => m.unlocked).map(m => m.id);
    const myBidMap = new Map(this.marketBids.filter(b => b.status === 'pending').map(b => [b.requestId, b]));
    const wonBids  = this.marketBids.filter(b => b.status === 'won');
    const lostBids = this.marketBids.filter(b => b.status === 'lost');

    // Offene Anfragen nach Stadt gruppieren
    const cityGroups: Record<string, MarketRequest[]> = {};
    for (const req of this.marketRequests) {
      if (!cities.includes(req.city)) continue;
      (cityGroups[req.city] ??= []).push(req);
    }

    const requestCards = Object.entries(cityGroups).map(([cityId, reqs]) => {
      const meta    = this.state.farmMeta.find(m => m.id === cityId);
      const profile = CITY_PROFILES[cityId];
      const cards = reqs.map(req => this.renderRequestCard(req, myBidMap.get(req.id))).join('');
      return `<div class="market-section-card">
        <div class="market-section-title" style="display:flex;align-items:center;gap:8px">
          <span>📍 ${meta?.city ?? cityId}</span>
          ${profile ? `<span class="city-profile-badge">${profile.emoji} ${profile.label}</span>` : ''}
        </div>
        <div class="request-list">${cards}</div>
      </div>`;
    }).join('');

    // Ergebnis-Section
    const resultRows = [...wonBids, ...lostBids].slice(0, 10).map(bid => {
      const prod = PRODUCTS[bid.request.productId];
      const m    = MERCHANTS[bid.request.merchantId];
      const won  = bid.status === 'won';
      return `<div class="order-row">
        <div class="order-row-left">
          <span class="order-prod">${prod?.emoji ?? '?'} ${prod?.name ?? bid.request.productId}</span>
          <span class="order-meta">${m?.emoji ?? ''} ${m?.name ?? bid.request.merchantId} · ${bid.request.city}</span>
        </div>
        <div class="order-row-right">
          <span class="order-amt">${formatAmount(bid.quantityOffered, prod?.unit ?? '')} · ${bid.pricePerUnit.toFixed(2)} €</span>
          ${won
            ? `<span class="order-badge order-filled">Gewonnen</span>`
            : `<span class="order-badge order-expired">Verloren · ${(bid.score * 100).toFixed(0)}% Score</span>`
          }
        </div>
      </div>`;
    }).join('');

    el.innerHTML = `<div class="market-layout">
      <p class="text-muted" style="font-size:11px;margin-bottom:8px">
        Kunden suchen Anbieter · Score = 55% Reputation + 45% Preisvorteil · Ware wird erst bei Gewinn abgezogen
      </p>
      ${Object.keys(cityGroups).length === 0
        ? `<div class="market-section-card"><p class="text-muted" style="text-align:center;padding:24px 0">
             Keine offenen Anfragen — der Server generiert jede Minute neue.
           </p></div>`
        : requestCards}
      ${resultRows ? `<div class="market-section-card">
        <div class="market-section-title">Letzte Ergebnisse</div>
        <div class="order-list">${resultRows}</div>
      </div>` : ''}
    </div>`;

    this.attachBidFormListeners(el, myBidMap);
  }

  private renderRequestCard(req: MarketRequest, myBid?: MarketBid): string {
    const prod    = PRODUCTS[req.productId];
    const m       = MERCHANTS[req.merchantId];
    const timeLeft = Math.max(0, Math.round((req.expiresAt - Date.now()) / 1000));
    const timeStr  = timeLeft > 60 ? `${Math.floor(timeLeft / 60)}m` : `${timeLeft}s`;
    const expanded = this.expandedRequestId === req.id;
    const rep      = this.marketReputation[req.city] ?? 10;

    // Score-Vorschau bei aktuellem max-Preis minus 15%
    const defaultPrice = req.maxPricePerUnit * 0.85;
    const defaultScore = this.clientScore(rep, defaultPrice, req.maxPricePerUnit);
    const scoreColor   = defaultScore > 0.6 ? '#5fbf80' : defaultScore > 0.35 ? '#f0b429' : '#e07060';

    const bidForm = expanded ? `
      <div class="bid-form" data-req="${req.id}" data-farm="${this.state.activeFarmId}" data-max="${req.maxPricePerUnit}">
        <div class="bid-form-row">
          <label class="bid-label">Mein Preis</label>
          <input class="bid-price-inp" type="range"
            min="${(req.maxPricePerUnit * 0.3).toFixed(3)}"
            max="${req.maxPricePerUnit.toFixed(3)}"
            step="${(req.maxPricePerUnit * 0.01).toFixed(3)}"
            value="${myBid ? myBid.pricePerUnit : defaultPrice.toFixed(3)}" />
          <span class="bid-price-display">${(myBid ? myBid.pricePerUnit : defaultPrice).toFixed(2)} €/${prod?.unit ?? ''}</span>
        </div>
        <div class="bid-form-row">
          <label class="bid-label">Menge</label>
          <input class="bid-qty-inp" type="number" min="1" max="${req.quantity}"
            value="${myBid ? myBid.quantityOffered : Math.min(req.quantity, Math.floor(this.state.farms[this.state.activeFarmId]?.storage[req.productId] ?? 0))}" />
          <span class="bid-qty-unit">${prod?.unit ?? ''}</span>
        </div>
        <div class="bid-score-row">
          <span class="bid-score-label">Score-Vorschau:</span>
          <div class="bid-score-bar-wrap">
            <div class="bid-score-bar-fill" style="width:${(defaultScore * 100).toFixed(0)}%;background:${scoreColor}"></div>
          </div>
          <span class="bid-score-pct" style="color:${scoreColor}">${(defaultScore * 100).toFixed(0)}%</span>
        </div>
        <div class="bid-form-actions">
          <button class="btn btn-success bid-submit-btn" data-req="${req.id}">
            ${myBid ? 'Angebot aktualisieren' : 'Angebot abgeben'}
          </button>
          ${myBid ? `<button class="btn btn-secondary bid-cancel-btn" data-bid="${myBid.id}">Zurückziehen</button>` : ''}
        </div>
      </div>` : '';

    return `<div class="request-card ${expanded ? 'request-card-expanded' : ''}">
      <div class="request-card-main" data-expand="${req.id}">
        <div class="request-card-left">
          <span class="request-prod">${prod?.emoji ?? '?'} ${prod?.name ?? req.productId}</span>
          <span class="request-merchant">${m?.emoji ?? ''} ${m?.name ?? req.merchantId}</span>
        </div>
        <div class="request-card-right">
          <span class="request-qty">${formatAmount(req.quantity, prod?.unit ?? '')}</span>
          <span class="request-price">bis ${req.maxPricePerUnit.toFixed(2)} €/${prod?.unit ?? ''}</span>
          <span class="request-time">⏱ ${timeStr}</span>
          ${req.bidCount > 0 ? `<span class="request-bid-count">${req.bidCount} Gebot${req.bidCount !== 1 ? 'e' : ''}</span>` : ''}
          ${myBid ? `<span class="order-badge order-pending">Mein Gebot: ${myBid.pricePerUnit.toFixed(2)} €</span>` : ''}
          <span class="request-score-hint" style="color:${scoreColor}">▲ ${(defaultScore * 100).toFixed(0)}%</span>
        </div>
      </div>
      ${bidForm}
    </div>`;
  }

  private attachBidFormListeners(el: HTMLElement, myBidMap: Map<number, MarketBid>): void {
    // Karte aufklappen
    el.querySelectorAll('[data-expand]').forEach(btn => {
      btn.addEventListener('click', () => {
        const id = Number((btn as HTMLElement).dataset.expand);
        this.expandedRequestId = this.expandedRequestId === id ? null : id;
        this.renderMarketTabContent();
      });
    });

    // Preis-Slider live updaten
    el.querySelectorAll('.bid-price-inp').forEach(slider => {
      const form = slider.closest('.bid-form')!;
      const updateDisplay = () => {
        const price    = Number((slider as HTMLInputElement).value);
        const maxPrice = Number((form as HTMLElement).dataset.max);
        const reqId    = Number((form as HTMLElement).dataset.req);
        const req      = this.marketRequests.find(r => r.id === reqId);
        const prod     = req ? PRODUCTS[req.productId] : null;
        const rep      = req ? (this.marketReputation[req.city] ?? 10) : 10;
        const score    = this.clientScore(rep, price, maxPrice);
        const color    = score > 0.6 ? '#5fbf80' : score > 0.35 ? '#f0b429' : '#e07060';

        const display = form.querySelector('.bid-price-display');
        if (display) display.textContent = `${price.toFixed(2)} €/${prod?.unit ?? ''}`;
        const fill = form.querySelector('.bid-score-bar-fill') as HTMLElement;
        if (fill) { fill.style.width = `${(score * 100).toFixed(0)}%`; fill.style.background = color; }
        const pct = form.querySelector('.bid-score-pct') as HTMLElement;
        if (pct) { pct.textContent = `${(score * 100).toFixed(0)}%`; pct.style.color = color; }
      };
      slider.addEventListener('input', updateDisplay);
    });

    // Angebot absenden
    el.querySelectorAll('.bid-submit-btn').forEach(btn => {
      btn.addEventListener('click', async () => {
        const reqId = Number((btn as HTMLElement).dataset.req);
        const form  = btn.closest('.bid-form')! as HTMLElement;
        const farmId   = form.dataset.farm!;
        const price    = Number((form.querySelector('.bid-price-inp') as HTMLInputElement).value);
        const qty      = Number((form.querySelector('.bid-qty-inp') as HTMLInputElement).value);

        if (!price || !qty) { bus.emit('notification', '❌ Preis und Menge eingeben'); return; }
        const available = Math.floor(this.state.farms[farmId]?.storage[
          this.marketRequests.find(r => r.id === reqId)?.productId ?? ''
        ] ?? 0);
        if (qty > available) { bus.emit('notification', '❌ Nicht genug im Lager'); return; }

        try {
          await apiSubmitBid(reqId, farmId, price, qty);
          bus.emit('notification', `📋 Angebot abgegeben · ${qty} zum Preis von ${price.toFixed(2)} €`);
          this.expandedRequestId = null;
          this.refreshMarketData();
        } catch (e: any) {
          bus.emit('notification', `❌ ${e.message ?? 'Fehler'}`);
        }
      });
    });

    // Angebot zurückziehen
    el.querySelectorAll('.bid-cancel-btn').forEach(btn => {
      btn.addEventListener('click', async () => {
        const bidId = Number((btn as HTMLElement).dataset.bid);
        await apiCancelBid(bidId).catch(() => {});
        this.expandedRequestId = null;
        this.refreshMarketData();
      });
    });
  }

  // ── Tab: Hofladen ──────────────────────────────────────────────────────────

  private renderMarketHofladenTab(el: HTMLElement): void {
    const sections = this.state.farmMeta.filter(m => m.unlocked).map(meta => {
      const farmId = meta.id;
      const config = this.state.hofladen[farmId] ?? { unlocked: false, offers: [] };
      const farm   = this.state.farms[farmId];

      if (!config.unlocked) {
        return `<div class="market-section-card">
          <div class="market-section-title">📍 ${meta.city} — ${meta.name}</div>
          <div class="hofladen-locked">
            <div class="hofladen-locked-icon">🏪</div>
            <div>Eröffne deinen Hofladen für Direktvermarktung an Endkunden.</div>
            <div class="hofladen-locked-perks">
              <span>✓ Selbst Preise setzen</span>
              <span>✓ Reputation steigt schneller</span>
              <span>✓ Bis zu 1,8× Basispreis</span>
            </div>
            <button class="btn btn-primary hofladen-unlock-btn" data-farm="${farmId}">
              Hofladen eröffnen (kostenlos)
            </button>
          </div>
        </div>`;
      }

      // Offer-Zeilen
      const offerRows = config.offers.map((offer, idx) => {
        const prod     = PRODUCTS[offer.productId];
        const base     = prod?.sellPricePerUnit ?? 1;
        const pctAbove = Math.round(((offer.pricePerUnit / base) - 1) * 100);
        const available = Math.floor(farm?.storage[offer.productId] ?? 0);
        return `<div class="hofladen-offer-row">
          <span class="hofladen-offer-prod">${prod?.emoji ?? '?'} ${prod?.name ?? offer.productId}</span>
          <span class="hofladen-offer-price">
            ${offer.pricePerUnit.toFixed(2).replace('.',',')} €/${prod?.unit ?? ''}
            <small class="market-price-good">+${pctAbove}%</small>
          </span>
          <span class="hofladen-offer-limit">${formatAmount(offer.limitPerRound, prod?.unit ?? '')} /Runde</span>
          <span class="hofladen-offer-stock">${available > 0 ? formatAmount(available, prod?.unit ?? '') + ' vorrätig' : '<span class="text-muted">kein Lager</span>'}</span>
          <button class="btn-icon-sm hofladen-remove-btn" data-farm="${farmId}" data-idx="${idx}" title="Entfernen">✕</button>
        </div>`;
      }).join('');

      // Add-Offer-Formular
      const storageOptions = Object.entries(farm?.storage ?? {})
        .filter(([, v]) => v > 0)
        .map(([pid]) => {
          const p = PRODUCTS[pid];
          return `<option value="${pid}">${p?.emoji ?? ''} ${p?.name ?? pid}</option>`;
        }).join('');

      return `<div class="market-section-card">
        <div class="market-section-title">🏪 Hofladen · ${meta.city}</div>
        ${config.offers.length > 0 ? `<div class="hofladen-offers">${offerRows}</div>` : ''}
        <div class="hofladen-add-form" data-farm="${farmId}">
          <select class="order-select hofladen-prod-sel" data-farm="${farmId}">
            <option value="">Produkt wählen…</option>${storageOptions}
          </select>
          <input class="order-amount-input hofladen-price-inp" data-farm="${farmId}"
            type="number" min="0.01" step="0.01" placeholder="Preis / Einheit" />
          <input class="order-amount-input hofladen-limit-inp" data-farm="${farmId}"
            type="number" min="1" placeholder="Limit /Runde" />
          <button class="btn btn-secondary hofladen-add-btn" data-farm="${farmId}">+ Angebot</button>
        </div>
      </div>`;
    }).join('');

    el.innerHTML = `<div class="market-layout">
      <p class="text-muted" style="font-size:11px;margin-bottom:8px">
        Kunden kaufen jede Runde (~60s) bis zur Kapazität. Preis-Elastizität: zu hohe Preise senken die Nachfrage.
      </p>
      ${sections}
    </div>`;

    // Hofladen freischalten
    el.querySelectorAll('.hofladen-unlock-btn').forEach(btn => {
      btn.addEventListener('click', () => {
        const farmId = (btn as HTMLElement).dataset.farm!;
        this.state = {
          ...this.state,
          hofladen: { ...this.state.hofladen, [farmId]: { unlocked: true, offers: [] } },
        };
        this.onStateChange(this.state);
        this.renderMarketHofladenTab(el);
      });
    });

    // Angebot entfernen
    el.querySelectorAll('.hofladen-remove-btn').forEach(btn => {
      btn.addEventListener('click', () => {
        const farmId = (btn as HTMLElement).dataset.farm!;
        const idx    = Number((btn as HTMLElement).dataset.idx);
        const config = this.state.hofladen[farmId];
        if (!config) return;
        const newOffers = config.offers.filter((_, i) => i !== idx);
        this.state = {
          ...this.state,
          hofladen: { ...this.state.hofladen, [farmId]: { ...config, offers: newOffers } },
        };
        this.onStateChange(this.state);
        this.renderMarketHofladenTab(el);
      });
    });

    // Angebot hinzufügen
    el.querySelectorAll('.hofladen-add-btn').forEach(btn => {
      btn.addEventListener('click', () => {
        const farmId  = (btn as HTMLElement).dataset.farm!;
        const form    = btn.closest('.hofladen-add-form')!;
        const prodSel = form.querySelector('.hofladen-prod-sel') as HTMLSelectElement;
        const priceInp = form.querySelector('.hofladen-price-inp') as HTMLInputElement;
        const limitInp = form.querySelector('.hofladen-limit-inp') as HTMLInputElement;

        const productId    = prodSel.value;
        const pricePerUnit = Number(priceInp.value);
        const limitPerRound = Number(limitInp.value) || 100;

        if (!productId || pricePerUnit <= 0) { bus.emit('notification', '❌ Preis eingeben'); return; }
        const base    = PRODUCTS[productId]?.sellPricePerUnit ?? 1;
        const maxPrice = base * 1.8;
        if (pricePerUnit > maxPrice) { bus.emit('notification', `❌ Max. ${maxPrice.toFixed(2)} € (1,8× Basispreis)`); return; }

        const config = this.state.hofladen[farmId] ?? { unlocked: true, offers: [] };
        const existing = config.offers.findIndex(o => o.productId === productId);
        let newOffers: HofladenOffer[];
        if (existing >= 0) {
          newOffers = config.offers.map((o, i) => i === existing ? { productId, pricePerUnit, limitPerRound } : o);
        } else {
          newOffers = [...config.offers, { productId, pricePerUnit, limitPerRound }];
        }
        this.state = {
          ...this.state,
          hofladen: { ...this.state.hofladen, [farmId]: { ...config, offers: newOffers } },
        };
        this.onStateChange(this.state);
        this.renderMarketHofladenTab(el);
      });
    });
  }

  // ── Tab: Reputation ────────────────────────────────────────────────────────

  private renderMarketReputationTab(el: HTMLElement): void {
    const rows = this.state.farmMeta.filter(m => m.unlocked).map(meta => {
      const score   = this.marketReputation[meta.id] ?? 10;
      const profile = CITY_PROFILES[meta.id];
      const pct     = Math.min(100, score);
      const color   = score >= 70 ? '#5fbf80' : score >= 40 ? '#f0b429' : '#e07060';
      const priceBonus = ((score / 100) * 0.15 * 100).toFixed(1);
      const traffic = Math.floor(20 + score * 2);
      return `<div class="reputation-row">
        <div class="reputation-row-city">
          <span class="reputation-city-name">
            📍 ${meta.city}
            ${profile ? `<span class="city-profile-badge">${profile.emoji} ${profile.label}</span>` : ''}
          </span>
          <span class="reputation-score" style="color:${color}">${score.toFixed(1)} / 100</span>
        </div>
        <div class="reputation-bar-wrap">
          <div class="reputation-bar-fill" style="width:${pct}%;background:${color}"></div>
        </div>
        <div class="reputation-effects">
          <span>💰 +${priceBonus}% Preisbonus bei Händlern</span>
          <span>🏪 ${traffic} Kunden /Runde im Hofladen</span>
        </div>
      </div>`;
    }).join('');

    el.innerHTML = `<div class="market-layout">
      <p class="text-muted" style="font-size:11px;margin-bottom:8px">
        Reputation steigt durch gewonnene Angebote (+0,5) und Hofladen-Verkäufe (+1,0). Abgelaufene Gebote ohne Gewinn kosten nichts.
      </p>
      ${rows || '<p class="text-muted" style="text-align:center;padding:24px 0">Keine Standorte freigeschaltet</p>'}
    </div>`;
  }

  private submitMarketOrder(): void {
    this.closeModals();
  }

  // ── Map View ─────────────────────────────────────────────────────────────────

  private renderMapView(): void {
    const el = document.getElementById('farm-area');
    if (!el) return;

    if (!this.leafletMap) {
      const unlocked = this.state.farmMeta.filter(m => m.unlocked).length;
      el.innerHTML = `
        <div class="farm-header">
          <div class="farm-breadcrumb">
            <span class="breadcrumb-section">🗺 Karte</span>
            <span class="breadcrumb-sep">›</span>
            <span class="breadcrumb-current">Deutschland</span>
          </div>
          <div class="farm-header-meta">
            <span class="farm-field-count">${unlocked} / ${this.state.farmMeta.length} Standorte</span>
          </div>
        </div>
        <div id="leaflet-map" class="leaflet-map-container"></div>`;

      this.leafletMap = L.map('leaflet-map', {
        center: [51.3, 10.5], zoom: 6, minZoom: 5, maxZoom: 12,
      });
      L.tileLayer('https://{s}.basemaps.cartocdn.com/dark_all/{z}/{x}/{y}{r}.png', {
        attribution: '© <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a> © <a href="https://carto.com/attributions">CARTO</a>',
        subdomains: 'abcd',
      }).addTo(this.leafletMap);
    }

    this.refreshLeafletMarkers();
  }

  private refreshLeafletMarkers(): void {
    if (!this.leafletMap) return;
    this.leafletMarkers.forEach(m => m.remove());
    this.leafletMarkers = [];

    this.state.farmMeta.forEach((meta: FarmMeta) => {
      const farm    = this.state.farms[meta.id];
      const ready   = farm ? farmReadyCount(farm) : 0;
      const owned   = farm?.plots.filter(p => !p.locked).length ?? 0;
      const isActive = meta.id === this.state.activeFarmId;
      const canBuy  = this.state.money >= meta.unlockCost;

      let dotCls: string, nameCls = '', subText: string;
      if (meta.unlocked) {
        dotCls  = isActive ? 'map-pin-dot-active map-pin-dot-home' : 'map-pin-dot-active';
        nameCls = isActive ? 'map-pin-name-home' : '';
        subText = `${meta.name} · ${owned} Parz.${ready > 0 ? ` · <b style="color:#f0b429">${ready} bereit</b>` : ''}`;
      } else if (canBuy) {
        dotCls = 'map-pin-dot-buyable'; nameCls = 'map-pin-name-buyable';
        subText = `🔓 ${meta.unlockCost.toLocaleString('de-DE')} €`;
      } else {
        dotCls = 'map-pin-dot-locked';
        subText = `🔒 ${meta.unlockCost.toLocaleString('de-DE')} €`;
      }

      const icon = L.divIcon({
        className: '',
        html: `<div class="lf-pin">
          <div class="map-pin-dot ${dotCls}"></div>
          ${ready > 0 ? `<div class="map-pin-badge">${ready}</div>` : ''}
          <div class="map-pin-label">
            <span class="map-pin-name ${nameCls}">${meta.city}</span>
            <span class="map-pin-sub">${subText}</span>
          </div>
        </div>`,
        iconSize: [160, 36], iconAnchor: [6, 6],
      });

      const marker = L.marker([meta.lat, meta.lon], { icon }).addTo(this.leafletMap!);
      if (meta.unlocked) {
        marker.on('click', () => {
          this.state = setActiveFarm(this.state, meta.id);
          this.onStateChange(this.state);
          this.currentView = 'farm';
          this.render(this.state);
        });
      } else if (canBuy) {
        marker.on('click', () => {
          this.state = unlockFarm(this.state, meta.id);
          this.onStateChange(this.state);
          this.renderHUD(); this.renderNav(); this.refreshLeafletMarkers();
        });
      }
      this.leafletMarkers.push(marker);
    });
  }

  private destroyLeafletMap(): void {
    if (this.leafletMap) {
      this.leafletMap.remove();
      this.leafletMap = null;
      this.leafletMarkers = [];
    }
  }

  // ── Plot Card ────────────────────────────────────────────────────────────

  private buildPlotCard(plot: Plot): HTMLElement {
    if (plot.plotType === 'stall')       return this.buildStallCard(plot);
    if (plot.plotType === 'processing')  return this.buildProcessingCard(plot);
    return this.buildFieldCard(plot);
  }

  private buildFieldCard(plot: Plot): HTMLElement {
    const card = document.createElement('div');
    const crop = plot.cropId ? CROPS[plot.cropId] : null;
    const prog = growthProgress(plot, this.state.tick);
    card.className = `field-card field-card-${plot.fieldState}`;

    if (['empty','fallow','tilled','ready'].includes(plot.fieldState))
      card.addEventListener('click', () => this.handlePlotClick(plot.id));
    // being_tilled / being_planted / being_harvested: not clickable

    let body = '';
    if (plot.fieldState === 'empty') {
      body = `<div class="fc-body fc-body-empty">
        <span class="fc-action-icon">🪧</span><span class="fc-action-label">Feld / Stall / Verarbeitung</span>
      </div>`;
    } else if (plot.fieldState === 'fallow') {
      body = `<div class="fc-body fc-body-fallow">
        <span class="fc-action-icon">🌿</span><span class="fc-action-label">Pflügen</span>
        <span class="fc-action-hint">Traktor + Pflug</span>
        <button class="fc-demolish-btn" data-demolish="${plot.id}">↩ Zurückbauen</button>
      </div>`;
    } else if (plot.fieldState === 'being_tilled' || plot.fieldState === 'being_planted' || plot.fieldState === 'being_harvested') {
      const actionProg = plot.actionDurationTicks > 0
        ? Math.min(1, (this.state.tick - plot.actionStartTick) / plot.actionDurationTicks) : 0;
      const remSec = Math.max(0, Math.ceil((1 - actionProg) * plot.actionDurationTicks));
      const [icon, label, color] = plot.fieldState === 'being_tilled'
        ? ['🚜', 'Pflügen…', '#c47a30']
        : plot.fieldState === 'being_planted'
        ? ['🚜', `Säen… ${crop ? crop.name : ''}`, '#5fbf80']
        : ['🚜', `Ernten… ${crop ? crop.emoji : ''}`, '#f0b429'];
      body = `<div class="fc-body fc-body-working">
        <span class="fc-action-icon">${icon}</span>
        <span class="fc-action-label">${label}</span>
        <div class="fc-progress-wrap">
          <div class="fc-progress-bar"><div class="fc-progress-fill" style="width:${actionProg*100}%;background:${color}"></div></div>
          <span class="fc-time-remain">${remSec}s</span>
        </div>
      </div>`;
    } else if (plot.fieldState === 'tilled') {
      body = `<div class="fc-body fc-body-tilled">
        <span class="fc-action-icon">🌱</span><span class="fc-action-label">Bepflanzen</span>
      </div>`;
    } else if (plot.fieldState === 'planted' && crop) {
      const stage = prog < 0.33 ? '🌱' : prog < 0.66 ? '🌿' : crop.emoji;
      const rem   = Math.ceil((1-prog) * plot.growthTicks);
      const remStr = rem >= 60 ? `${Math.ceil(rem/60)} min` : `${rem} s`;
      body = `<div class="fc-body fc-body-planted">
        <span class="fc-crop-emoji">${stage}</span>
        <div class="fc-progress-wrap">
          <div class="fc-progress-bar"><div class="fc-progress-fill" style="width:${prog*100}%;background:${crop.color}"></div></div>
          <span class="fc-time-remain">${remStr}</span>
        </div>
        <span class="fc-yield-hint">${crop.yieldKg >= 1000 ? (crop.yieldKg/1000).toFixed(1)+'t' : crop.yieldKg+'kg'} erwartet</span>
      </div>`;
    } else if (plot.fieldState === 'ready' && crop) {
      const kgStr = crop.yieldKg >= 1000 ? (crop.yieldKg/1000).toFixed(1)+'t' : crop.yieldKg+'kg';
      body = `<div class="fc-body fc-body-ready">
        <span class="fc-crop-emoji fc-ready-pulse">${crop.emoji}</span>
        <span class="fc-yield-amount">${kgStr}</span>
        <span class="fc-yield-value">≈ ${Math.round(crop.yieldKg * crop.sellPricePerKg).toLocaleString('de-DE')} €</span>
      </div>`;
    }

    const stateTag = plot.fieldState === 'fallow'          ? '<span class="fc-state-tag fc-state-fallow">Brache</span>'
      : plot.fieldState === 'being_tilled'   ? '<span class="fc-state-tag fc-state-working">🚜 Pflügen</span>'
      : plot.fieldState === 'tilled'         ? '<span class="fc-state-tag">gepflügt</span>'
      : plot.fieldState === 'being_planted'  ? `<span class="fc-state-tag fc-state-working">🚜 Säen</span>`
      : plot.fieldState === 'being_harvested'? '<span class="fc-state-tag fc-state-working">🚜 Ernten</span>'
      : plot.fieldState === 'ready'          ? '<span class="fc-ready-tag">Erntereif</span>'
      : plot.fieldState === 'planted' && crop ? `<span class="fc-crop-name">${crop.name}</span>`
      : '<span class="fc-size">0,1 ha</span>';

    card.innerHTML = `<div class="fc-header"><span class="fc-num">Feld ${plot.id + 1}</span>${stateTag}</div>${body}`;

    card.querySelector('[data-demolish]')?.addEventListener('click', e => {
      e.stopPropagation();
      this.state = demolishPlot(this.state, this.state.activeFarmId, plot.id);
      this.onStateChange(this.state);
      this.renderFarmArea(); this.renderHUD();
    });

    return card;
  }

  private buildStallCard(plot: Plot): HTMLElement {
    const card   = document.createElement('div');
    const farmId = this.state.activeFarmId;
    const isSplit = plot.stallSize === 'half';
    const anyReady = plot.stallA.productionReady || (plot.stallB?.productionReady ?? false);
    card.className = `field-card stall-card ${anyReady ? 'stall-card-ready' : ''}`;

    const tagLabel = isSplit
      ? (plot.stallB ? '🏭 ½+½ Massen' : '🏭 Halbstall')
      : '🌿 Freilandhaltung';
    const tagClass = isSplit ? 'stall-tag-half' : 'stall-tag-full';

    let bodyHTML = '';

    // ── Render one slot section ──
    const renderSlotSection = (slot: StallSlot, slotIdx: 0 | 1): string => {
      const animal = slot.animalId ? ANIMALS[slot.animalId] : null;
      if (!animal || !slot.animalId) {
        return `<div class="stall-slot-empty" data-add-slot="${plot.id}">
          <span class="stall-add-icon">＋</span>
          <span class="stall-add-label">Zweiten Stall bauen</span>
          <span class="stall-add-sub">ab 700 €</span>
        </div>`;
      }
      const count     = slot.animalCount;
      const max       = getMaxAnimals(slot.animalId, plot.stallSize);
      const buyCost   = getBuyCost(slot.animalId, plot.stallSize);
      const breedCyc  = getBreedingCycle(slot.animalId, plot.stallSize);
      const yield_    = computeYield(slot.animalId, count, plot.stallSize);
      const val       = Math.round(yield_ * animal.sellPricePerUnit);
      const canBuy    = count < max && this.state.money >= buyCost;
      const prog      = slotProgress(slot, this.state.tick);
      const breedProg = slotBreedProgress(slot, plot.stallSize, this.state.tick);
      const breedSec  = count < max ? Math.ceil((1 - breedProg) * breedCyc) : 0;
      const sid       = `s${plot.id}-${slotIdx}`;

      return `<div class="stall-slot">
        <div class="stall-animal-row">
          <span class="stall-emoji">${animal.emoji}</span>
          <div class="stall-info">
            <span class="stall-name">${animal.name}</span>
            <span class="stall-happiness">${happinessHearts(plot.stallSize)} ${happinessLabel(plot.stallSize)}</span>
          </div>
        </div>
        <div class="stall-count-row">
          <span class="stall-count-label"><strong>${count}</strong>/${max}</span>
          <div class="stall-count-bar"><div class="stall-count-fill" style="width:${(count/max)*100}%"></div></div>
        </div>
        ${count < max ? `<div class="stall-breed-row">
          <span class="stall-breed-icon">🍼</span>
          <div class="stall-breed-bar-wrap">
            <div class="stall-breed-bar"><div class="stall-breed-fill" style="width:${breedProg*100}%"></div></div>
            <span class="stall-breed-time">${breedSec}s</span>
          </div>
        </div>` : `<span class="stall-full-badge">Stall voll</span>`}
        <button class="stall-buy-btn ${canBuy ? '' : 'stall-buy-disabled'}"
          id="${sid}-buy" ${canBuy ? '' : 'disabled'}>
          + Tier · ${buyCost} €
        </button>
        ${animal.noProductCycle ? '' : slot.productionReady ? `
          <div class="stall-ready-row">
            <span>${animal.productEmoji} <strong>${yield_} ${animal.productUnit}</strong></span>
            <span class="stall-val">+${val} €</span>
          </div>
          <button class="stall-collect-btn" id="${sid}-collect">Einlagern</button>
        ` : count > 0 ? `
          <div class="fc-progress-wrap">
            <div class="fc-progress-bar">
              <div class="fc-progress-fill" style="width:${prog*100}%;background:#c47a30"></div>
            </div>
            <span class="fc-time-remain">${Math.ceil((1-prog)*animal.cycleSeconds)}s · ${yield_} ${animal.productUnit}</span>
          </div>` : `<span class="fc-yield-hint">Keine Tiere</span>`}
      </div>`;
    };

    bodyHTML = `<div class="stall-slots ${isSplit ? 'stall-slots-split' : ''}">
      ${renderSlotSection(plot.stallA, 0)}
      ${isSplit ? `<div class="stall-slot-divider"></div>${
        plot.stallB
          ? renderSlotSection(plot.stallB, 1)
          : renderSlotSection({ animalId: null, animalCount: 0, productionReady: false, lastCollectedAt: 0, lastBreedingAt: 0 }, 1)
      }` : ''}
    </div>`;

    card.innerHTML = `
      <div class="fc-header">
        <span class="fc-num">Parzelle ${plot.id + 1}</span>
        <span class="stall-tag ${tagClass}">${tagLabel}</span>
      </div>
      ${bodyHTML}`;

    // Wire up buttons
    card.querySelector(`#s${plot.id}-0-buy`)?.addEventListener('click', e => {
      e.stopPropagation();
      this.state = buyAnimal(this.state, farmId, plot.id, 0);
      this.onStateChange(this.state);
      this.renderFarmArea(); this.renderHUD();
    });
    card.querySelector(`#s${plot.id}-1-buy`)?.addEventListener('click', e => {
      e.stopPropagation();
      this.state = buyAnimal(this.state, farmId, plot.id, 1);
      this.onStateChange(this.state);
      this.renderFarmArea(); this.renderHUD();
    });
    card.querySelector(`#s${plot.id}-0-collect`)?.addEventListener('click', e => {
      e.stopPropagation();
      this.state = collectStall(this.state, farmId, plot.id, 0);
      this.onStateChange(this.state);
      this.renderFarmArea(); this.renderInfoSidebar(); this.renderHUD(); this.renderNav();
    });
    card.querySelector(`#s${plot.id}-1-collect`)?.addEventListener('click', e => {
      e.stopPropagation();
      this.state = collectStall(this.state, farmId, plot.id, 1);
      this.onStateChange(this.state);
      this.renderFarmArea(); this.renderInfoSidebar(); this.renderHUD(); this.renderNav();
    });
    card.querySelector(`[data-add-slot]`)?.addEventListener('click', e => {
      e.stopPropagation();
      this.openSecondStallBuilder(plot.id);
    });

    return card;
  }

  // Gespeicherte Auswahl aus dem Autocomplete-Dropdown
  private selectedLocation: { city: string; lat: number; lon: number } | null = null;
  private locSearchTimer: ReturnType<typeof setTimeout> | null = null;

  initNewLocationModal(): void {
    const cityInput  = document.getElementById('new-loc-city') as HTMLInputElement;
    const dropdown   = document.getElementById('new-loc-dropdown')!;
    const confirmBtn = document.getElementById('new-loc-confirm') as HTMLButtonElement;
    const errorEl    = document.getElementById('new-loc-error')!;

    cityInput.addEventListener('input', () => {
      this.selectedLocation = null;
      confirmBtn.disabled = true;
      errorEl.classList.add('hidden');
      if (this.locSearchTimer) clearTimeout(this.locSearchTimer);
      const q = cityInput.value.trim();
      if (q.length < 2) { dropdown.classList.add('hidden'); return; }
      this.locSearchTimer = setTimeout(() => this.searchCities(q), 350);
    });
  }

  private async searchCities(q: string): Promise<void> {
    const dropdown = document.getElementById('new-loc-dropdown')!;
    try {
      const url  = `https://nominatim.openstreetmap.org/search?q=${encodeURIComponent(q)}&format=json&countrycodes=de&limit=10&addressdetails=1&accept-language=de`;
      const res  = await fetch(url, { headers: { 'User-Agent': 'FarmTycoon/1.0' } });
      const data: any[] = await res.json();

      // Nur echte Ortschaften: muss city/town/village/hamlet im address-Objekt haben
      const places = data.filter(d => {
        const a = d.address ?? {};
        return a.country_code === 'de' && (a.city || a.town || a.village || a.hamlet);
      });

      // Duplikate nach Ortsname entfernen
      const seen = new Set<string>();
      const unique = places.filter(d => {
        const a = d.address;
        const name = a.city || a.town || a.village || a.hamlet;
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
          const a = p.address;
          const cityName = a.city || a.town || a.village || a.hamlet;
          this.selectedLocation = { city: cityName, lat: parseFloat(p.lat), lon: parseFloat(p.lon) };
          (document.getElementById('new-loc-city') as HTMLInputElement).value = cityName;
          dropdown.classList.add('hidden');
          (document.getElementById('new-loc-confirm') as HTMLButtonElement).disabled = false;
        });
      });
    } catch {
      dropdown.classList.add('hidden');
    }
  }

  private handleNewLocation(): void {
    if (!this.selectedLocation) return;
    const nameInput = document.getElementById('new-loc-name') as HTMLInputElement;
    const { city, lat, lon } = this.selectedLocation;
    const farmName = nameInput.value.trim() || `Gut ${city}`;
    this.state = openNewFarm(this.state, city, farmName, lat, lon, NEW_LOCATION_COST);
    this.onStateChange(this.state);
    this.selectedLocation = null;
    this.closeModals();
    this.currentView = 'farm';
    this.render(this.state);
  }

  private openSecondStallBuilder(plotId: number): void {
    const el    = document.getElementById('stall-size-choice')!;
    const modal = document.getElementById('stall-builder')!;
    const title = document.getElementById('stall-builder-title')!;
    title.textContent = 'Zweiten Stall bauen (½ der Parzelle)';

    el.innerHTML = ANIMAL_LIST.map(animal => {
      const canAfford  = this.state.money >= animal.buildCostHalf;
      const halfYield  = Math.floor(animal.maxHalf * animal.yieldPerAnimalPerCycle * animal.happinessHalf);
      return `<div class="stall-animal-choice">
        <div class="stall-choice-header">
          <span class="stall-choice-emoji">${animal.emoji}</span>
          <span class="stall-choice-name">${animal.name}</span>
        </div>
        <button class="stall-size-btn stall-size-massen ${canAfford ? '' : 'stall-size-disabled'}"
          data-animal="${animal.id}" data-plot="${plotId}">
          <span class="stall-size-label">🏭 Massentierhaltung · 0,05 ha</span>
          <span class="stall-size-yield">${animal.productEmoji} max ${halfYield} ${animal.productUnit}/Zyklus</span>
          <span class="stall-size-happiness">♥░░░░ beengt · ${animal.maxHalf} Tiere max</span>
          <span class="stall-size-cost">${animal.buildCostHalf.toLocaleString('de-DE')} € · Tier ${animal.buyCostHalf} €</span>
        </button>
      </div>`;
    }).join('<div class="stall-divider"></div>');

    modal.classList.remove('hidden');
    el.querySelectorAll('[data-animal]').forEach(btn => {
      btn.addEventListener('click', () => {
        const animalId = (btn as HTMLElement).dataset.animal!;
        const pId      = parseInt((btn as HTMLElement).dataset.plot!);
        this.closeModals();
        this.state = buildSecondHalfStall(this.state, this.state.activeFarmId, pId, animalId);
        this.onStateChange(this.state);
        this.renderFarmArea(); this.renderHUD(); this.renderInfoSidebar();
      });
    });
  }

  private buildProcessingCard(plot: Plot): HTMLElement {
    const card    = document.createElement('div');
    const farmId  = this.state.activeFarmId;
    const farm    = this.state.farms[farmId];
    const free    = freeSpaceUnits(plot.processingSlots);
    const anyReady = plot.processingSlots.some(s => s.outputReady > 0);
    card.className = `field-card processing-card ${anyReady ? 'processing-card-ready' : ''}`;

    const slotsHTML = plot.processingSlots.map((slot, idx) => {
      const b       = PROCESSING_BUILDINGS[slot.buildingId];
      if (!b) return '';
      const outProd = PRODUCTS[b.outputProductId];
      const prog    = procProgress(slot, this.state.tick);
      const remSec  = slot.isProcessing ? Math.ceil((1 - prog) * b.cycleSeconds) : 0;
      const sid     = `proc-${plot.id}-${idx}`;

      // ── Schlachthof-Karte ──────────────────────────────────────────────
      if (b.inputFromStall) {
        const selectedId = slot.slaughterAnimalId ?? 'pig';
        const selAnimal  = ANIMALS[selectedId];
        const available  = countFarmAnimals(farm, selectedId);
        const target     = slot.slaughterTarget ?? 1;
        const canStart   = !slot.isProcessing && available >= 1;
        const taken      = Math.min(target, available);
        const kgPerAnimal = selAnimal?.slaughterKgPerAnimal ?? 0;
        const expKg      = taken * kgPerAnimal;
        const selOutProd = PRODUCTS[selAnimal?.slaughterProductId ?? ''];
        const pendingKg  = slot.customOutputAmount ?? expKg;
        const activeOutProd = slot.isProcessing
          ? PRODUCTS[ANIMALS[slot.slaughterAnimalId ?? '']?.slaughterProductId ?? ''] ?? selOutProd
          : selOutProd;

        const animalBtns = ANIMAL_LIST.map(a =>
          `<button class="slaughter-animal-btn ${a.id === selectedId ? 'slaughter-animal-active' : ''}"
            id="${sid}-animal-${a.id}" ${slot.isProcessing ? 'disabled' : ''}>
            ${a.emoji}
          </button>`
        ).join('');

        return `<div class="proc-slot">
          <div class="proc-slot-header">
            <span class="proc-slot-emoji">${b.emoji}</span>
            <span class="proc-slot-name">${b.name}</span>
            <span class="proc-size-badge">${sizeLabel(b.size)}</span>
          </div>
          <div class="slaughter-animal-row">${animalBtns}</div>
          <div class="proc-chain">${selAnimal?.emoji ?? '🐾'} im Stall: <strong>${available}</strong></div>
          <div class="slaughter-target-row">
            <button class="slaughter-adj-btn" id="${sid}-minus" ${slot.isProcessing ? 'disabled' : ''}>−</button>
            <span class="slaughter-target-label">${target} Tier${target !== 1 ? 'e' : ''} → ${selOutProd?.emoji ?? ''} ${expKg} ${selOutProd?.unit ?? 'kg'}</span>
            <button class="slaughter-adj-btn" id="${sid}-plus" ${slot.isProcessing ? 'disabled' : ''}>+</button>
          </div>
          ${slot.isProcessing ? `
            <div class="fc-progress-wrap">
              <div class="fc-progress-bar"><div class="fc-progress-fill" style="width:${prog*100}%;background:#e05555"></div></div>
              <span class="fc-time-remain">${remSec}s · ${activeOutProd?.emoji ?? ''} ${pendingKg} ${activeOutProd?.unit ?? 'kg'}</span>
            </div>` : ''}
          ${slot.outputReady > 0 ? `
            <div class="proc-output-row">
              <span>${activeOutProd?.emoji ?? ''} <strong>${slot.outputReady} ${activeOutProd?.unit ?? 'kg'}</strong> ${activeOutProd?.name ?? ''}</span>
              <button class="proc-collect-btn" id="${sid}-collect">Einlagern</button>
            </div>` : ''}
          ${!slot.isProcessing ? `
            <button class="proc-load-btn ${canStart ? '' : 'proc-load-disabled'}" id="${sid}-load" ${canStart ? '' : 'disabled'}>
              ${canStart ? `🔪 Schlachten (${taken} Tier${taken !== 1 ? 'e' : ''})` : `Keine ${selAnimal?.name ?? 'Tiere'} im Stall`}
            </button>` : ''}
        </div>`;
      }

      // ── Standard-Verarbeitungskarte ────────────────────────────────────
      const inProd  = PRODUCTS[b.inputProductId];
      const stored  = farm?.storage[b.inputProductId] ?? 0;
      const canLoad = !slot.isProcessing && stored >= b.inputAmount;

      return `<div class="proc-slot">
        <div class="proc-slot-header">
          <span class="proc-slot-emoji">${b.emoji}</span>
          <span class="proc-slot-name">${b.name}</span>
          <span class="proc-size-badge">${sizeLabel(b.size)}</span>
        </div>
        <div class="proc-chain">${inProd?.emoji ?? ''} ${b.inputAmount} ${inProd?.unit ?? ''} → ${outProd?.emoji ?? ''} ${b.outputAmount} ${outProd?.unit ?? ''}</div>
        ${slot.isProcessing ? `
          <div class="fc-progress-wrap">
            <div class="fc-progress-bar"><div class="fc-progress-fill" style="width:${prog*100}%;background:#9b7cff"></div></div>
            <span class="fc-time-remain">${remSec}s · ${outProd?.emoji ?? ''} ${b.outputAmount} ${outProd?.unit ?? ''}</span>
          </div>` : ''}
        ${slot.outputReady > 0 ? `
          <div class="proc-output-row">
            <span>${outProd?.emoji ?? ''} <strong>${slot.outputReady} ${outProd?.unit ?? ''}</strong> ${outProd?.name ?? ''}</span>
            <button class="proc-collect-btn" id="${sid}-collect">Einlagern</button>
          </div>` : ''}
        ${!slot.isProcessing ? `
          <button class="proc-load-btn ${canLoad ? '' : 'proc-load-disabled'}"
            id="${sid}-load" ${canLoad ? '' : 'disabled'}>
            ${canLoad
              ? `▶ Laden: ${b.inputAmount} ${inProd?.unit ?? ''} ${inProd?.name ?? ''}`
              : `Lager: ${stored}/${b.inputAmount} ${inProd?.unit ?? ''} ${inProd?.name ?? ''}`}
          </button>` : ''}
      </div>`;
    }).join('<div class="proc-slot-divider"></div>');

    const addSection = free > 0
      ? `<div class="proc-add-section" id="proc-add-${plot.id}">
          <span class="proc-add-icon">＋</span>
          <div>
            <div class="proc-add-label">Weiteres Gebäude</div>
            <div class="proc-add-sub">${freeUnitsLabel(free)} Platz frei</div>
          </div>
        </div>`
      : `<div class="proc-space-full">Parzelle voll belegt</div>`;

    card.innerHTML = `
      <div class="fc-header">
        <span class="fc-num">Parzelle ${plot.id + 1}</span>
        <span class="processing-tag">⚙️ Verarbeitung</span>
      </div>
      ${slotsHTML || ''}
      ${addSection}`;

    // Wire buttons
    plot.processingSlots.forEach((slot, idx) => {
      const sid = `proc-${plot.id}-${idx}`;
      card.querySelector(`#${sid}-load`)?.addEventListener('click', e => {
        e.stopPropagation();
        this.state = loadProcessing(this.state, farmId, plot.id, idx);
        this.onStateChange(this.state);
        this.renderFarmArea(); this.renderHUD();
      });
      card.querySelector(`#${sid}-collect`)?.addEventListener('click', e => {
        e.stopPropagation();
        this.state = collectProcessingOutput(this.state, farmId, plot.id, idx);
        this.onStateChange(this.state);
        this.renderFarmArea(); this.renderInfoSidebar(); this.renderHUD(); this.renderNav();
      });
      card.querySelector(`#${sid}-minus`)?.addEventListener('click', e => {
        e.stopPropagation();
        this.state = setSlaughterTarget(this.state, farmId, plot.id, idx, (slot.slaughterTarget ?? 1) - 1);
        this.onStateChange(this.state);
        this.renderFarmArea();
      });
      card.querySelector(`#${sid}-plus`)?.addEventListener('click', e => {
        e.stopPropagation();
        this.state = setSlaughterTarget(this.state, farmId, plot.id, idx, (slot.slaughterTarget ?? 1) + 1);
        this.onStateChange(this.state);
        this.renderFarmArea();
      });
      ANIMAL_LIST.forEach(a => {
        card.querySelector(`#${sid}-animal-${a.id}`)?.addEventListener('click', e => {
          e.stopPropagation();
          this.state = setSlaughterAnimal(this.state, farmId, plot.id, idx, a.id);
          this.onStateChange(this.state);
          this.renderFarmArea();
        });
      });
    });
    card.querySelector(`#proc-add-${plot.id}`)?.addEventListener('click', e => {
      e.stopPropagation();
      this.openProcessingBuilder(plot.id, true);
    });

    return card;
  }

  private openProcessingBuilder(plotId: number, addingToExisting = false): void {
    this.pendingPlotId = plotId;
    const farm  = this.state.farms[this.state.activeFarmId];
    const plot  = farm?.plots.find(p => p.id === plotId);
    const currentSlots = (plot?.plotType === 'processing') ? plot.processingSlots : [];
    const freeUnits = freeSpaceUnits(currentSlots);

    document.getElementById('processing-builder-title')!.textContent =
      addingToExisting ? 'Weiteres Gebäude bauen' : 'Verarbeitungsgebäude wählen';

    const listEl = document.getElementById('processing-builder-list')!;

    listEl.innerHTML = PROCESSING_BASES.map(baseId => {
      const normal = PROCESSING_LIST.find(b => b.baseId === baseId && b.tier === 'normal');
      const large  = PROCESSING_LIST.find(b => b.baseId === baseId && b.tier === 'large');
      if (!normal) return '';

      const inProd  = PRODUCTS[normal.inputProductId];
      const outProd = PRODUCTS[normal.outputProductId];
      const isSlaughterhouse = !!normal.inputFromStall;
      const ioLabel    = isSlaughterhouse
        ? `🐷🐄🐓 aus Stall → Fleisch`
        : `${inProd?.emoji ?? ''} ${normal.inputAmount} → ${outProd?.emoji ?? ''} ${normal.outputAmount}`;
      const chainLabel = isSlaughterhouse
        ? `Schweine, Kühe, Hühner · ${normal.cycleSeconds}s`
        : `${inProd?.name ?? ''} → ${outProd?.name ?? ''} · ${normal.cycleSeconds}s`;

      const renderBtn = (b: typeof normal) => {
        const needed    = processingSpaceUnits(b.size);
        const canFit    = freeUnits >= needed;
        const canAfford = this.state.money >= b.buildCost;
        const disabled  = !canFit || !canAfford;
        const reason    = !canFit ? 'kein Platz' : !canAfford ? 'zu teuer' : '';
        const bIoLabel  = b.inputFromStall
          ? `🐷🐄🐓 aus Stall → Fleisch`
          : `${inProd?.emoji ?? ''} ${b.inputAmount} → ${outProd?.emoji ?? ''} ${b.outputAmount}`;
        return `<button class="proc-tier-btn${disabled ? ' proc-tier-disabled' : ''}"
          data-building="${b.id}" ${disabled ? 'disabled' : ''}>
          <div class="proc-tier-label">${b.tier === 'large' ? '⬆ Groß' : 'Normal'}</div>
          <div class="proc-tier-size">${sizeLabel(b.size)} · ${sizeHa(b.size)}</div>
          <div class="proc-tier-io">${bIoLabel}</div>
          <div class="proc-tier-cost">${b.buildCost.toLocaleString('de-DE')} €</div>
          ${reason ? `<div class="proc-tier-reason">${reason}</div>` : ''}
        </button>`;
      };

      return `<div class="proc-builder-row">
        <div class="proc-builder-label">
          <span class="proc-builder-emoji">${normal.emoji}</span>
          <div>
            <div class="proc-builder-name">${normal.name.replace(' (Groß)', '')}</div>
            <div class="proc-builder-chain">${chainLabel}</div>
          </div>
        </div>
        <div class="proc-tier-choice">
          ${renderBtn(normal)}
          ${large ? renderBtn(large) : ''}
        </div>
      </div>`;
    }).join('');

    document.getElementById('processing-builder')!.classList.remove('hidden');

    listEl.querySelectorAll('[data-building]').forEach(btn => {
      btn.addEventListener('click', () => {
        const buildingId = (btn as HTMLElement).dataset.building!;
        this.closeModals();
        this.state = buildProcessingBuilding(this.state, this.state.activeFarmId, plotId, buildingId);
        this.onStateChange(this.state);
        this.renderFarmArea(); this.renderHUD(); this.renderInfoSidebar(); this.renderNav();
      });
    });
  }

  // ── Click handling ────────────────────────────────────────────────────────

  private handlePlotClick(plotId: number): void {
    const farmId = this.state.activeFarmId;
    const plot   = this.state.farms[farmId]?.plots.find(p => p.id === plotId);
    if (!plot || plot.locked) return;

    if (plot.plotType === 'field') {
      if (plot.fieldState === 'empty') {
        this.openPlotUsePicker(plotId);
      } else if (plot.fieldState === 'fallow') {
        this.state = tillPlot(this.state, farmId, plotId);
        this.onStateChange(this.state);
        this.renderFarmArea(); this.renderHUD();
      } else if (plot.fieldState === 'tilled') {
        this.openCropPicker(plotId);
      } else if (plot.fieldState === 'ready') {
        this.state = harvestPlot(this.state, farmId, plotId);
        this.onStateChange(this.state);
        this.renderFarmArea(); this.renderHUD(); this.renderInfoSidebar(); this.renderNav();
      }
    }
  }

  // ── Plot use picker (Feld / Stall / Verarbeitung) ─────────────────────────

  private openPlotUsePicker(plotId: number): void {
    this.pendingPlotId = plotId;
    const grid  = document.getElementById('plot-use-grid')!;
    const modal = document.getElementById('plot-use-picker')!;

    grid.innerHTML = `
      <button class="plot-use-btn" id="pup-field">
        <span class="pup-icon">🪧</span>
        <span class="pup-title">Feld anlegen</span>
        <span class="pup-desc">Umgraben & Pflanzen</span>
        <span class="pup-cost">Kostenlos</span>
      </button>
      <button class="plot-use-btn" id="pup-stall">
        <span class="pup-icon">🏠</span>
        <span class="pup-title">Stall bauen</span>
        <span class="pup-desc">Tiere halten</span>
        <span class="pup-cost">ab 700 €</span>
      </button>
      <button class="plot-use-btn" id="pup-processing">
        <span class="pup-icon">⚙️</span>
        <span class="pup-title">Verarbeitung</span>
        <span class="pup-desc">Rohstoffe weiterverarbeiten</span>
        <span class="pup-cost">ab 400 €</span>
      </button>`;

    modal.classList.remove('hidden');

    document.getElementById('pup-field')!.addEventListener('click', () => {
      this.closeModals();
      this.state = designateField(this.state, this.state.activeFarmId, plotId);
      this.onStateChange(this.state);
      this.renderFarmArea(); this.renderHUD();
    });
    document.getElementById('pup-stall')!.addEventListener('click', () => {
      document.getElementById('plot-use-picker')!.classList.add('hidden');
      this.openStallBuilder(plotId);
    });
    document.getElementById('pup-processing')!.addEventListener('click', () => {
      this.closeModals();
      this.openProcessingBuilder(plotId);
    });
  }

  // ── Stall builder ─────────────────────────────────────────────────────────

  private openStallBuilder(plotId: number): void {
    this.pendingPlotId = plotId;
    const el    = document.getElementById('stall-size-choice')!;
    const modal = document.getElementById('stall-builder')!;

    el.innerHTML = ANIMAL_LIST.map(animal => {
      const fullYield = Math.floor(animal.maxFull * animal.yieldPerAnimalPerCycle * animal.happinessFull);
      const halfYield = Math.floor(animal.maxHalf * animal.yieldPerAnimalPerCycle * animal.happinessHalf);
      return `
      <div class="stall-animal-choice">
        <div class="stall-choice-header">
          <span class="stall-choice-emoji">${animal.emoji}</span>
          <span class="stall-choice-name">${animal.name}</span>
        </div>
        <div class="stall-size-row">
          <button class="stall-size-btn stall-size-freiland ${this.state.money >= animal.buildCostFull ? '' : 'stall-size-disabled'}"
            data-animal="${animal.id}" data-size="full">
            <span class="stall-size-label">🌿 Freilandhaltung</span>
            <span class="stall-size-ha">0,1 ha · max ${animal.maxFull} Tiere</span>
            <span class="stall-size-yield">${animal.productEmoji} max ${fullYield} ${animal.productUnit}/Zyklus</span>
            <span class="stall-size-happiness">♥♥♥♥♥ artgerecht</span>
            <span class="stall-size-cost">${animal.buildCostFull.toLocaleString('de-DE')} € · Tier ${animal.buyCostFull} €</span>
          </button>
          <button class="stall-size-btn stall-size-massen ${this.state.money >= animal.buildCostHalf ? '' : 'stall-size-disabled'}"
            data-animal="${animal.id}" data-size="half">
            <span class="stall-size-label">🏭 Massentierhaltung</span>
            <span class="stall-size-ha">0,05 ha · max ${animal.maxHalf} Tiere</span>
            <span class="stall-size-yield">${animal.productEmoji} max ${halfYield} ${animal.productUnit}/Zyklus</span>
            <span class="stall-size-happiness">♥░░░░ beengt</span>
            <span class="stall-size-cost">${animal.buildCostHalf.toLocaleString('de-DE')} € · Tier ${animal.buyCostHalf} €</span>
          </button>
        </div>
      </div>`;
    }).join('<div class="stall-divider"></div>');

    modal.classList.remove('hidden');

    el.querySelectorAll('[data-animal]').forEach(btn => {
      btn.addEventListener('click', () => {
        const animalId = (btn as HTMLElement).dataset.animal!;
        const size     = (btn as HTMLElement).dataset.size as StallSize;
        this.closeModals();
        this.state = buildStall(this.state, this.state.activeFarmId, plotId, animalId, size);
        this.onStateChange(this.state);
        this.renderFarmArea(); this.renderHUD(); this.renderInfoSidebar(); this.renderNav();
      });
    });
  }

  // ── Crop picker ───────────────────────────────────────────────────────────

  private openCropPicker(plotId: number): void {
    this.pendingPlotId = plotId;
    const listEl = document.getElementById('crop-picker-list')!;
    const modal  = document.getElementById('crop-picker')!;
    listEl.innerHTML = '';
    CROP_LIST.forEach(crop => {
      const canAfford = this.state.money >= crop.seedCost;
      const profit = Math.round(crop.yieldKg * crop.sellPricePerKg) - crop.seedCost;
      const minStr = Math.ceil(crop.growthTicks / 60) + ' min';
      const yieldStr = crop.yieldKg >= 1000 ? (crop.yieldKg/1000).toFixed(1)+'t' : crop.yieldKg+'kg';
      const btn = document.createElement('button');
      btn.className = `crop-option${canAfford ? '' : ' crop-option-disabled'}`;
      btn.innerHTML = `
        <span class="crop-option-emoji">${crop.emoji}</span>
        <div class="crop-option-info">
          <strong>${crop.name}</strong>
          <span class="crop-option-desc">${crop.description}</span>
          <div class="crop-option-meta">
            <span class="cost">🪙 ${crop.seedCost} €</span>
            <span class="yield">📦 ${yieldStr}</span>
            <span class="sell">💵 ${crop.sellPricePerKg.toFixed(2).replace('.',',')} €/kg</span>
            <span class="profit">📈 +${profit.toLocaleString('de-DE')} €</span>
            <span class="time">⏱ ${minStr}</span>
          </div>
        </div>`;
      if (canAfford) btn.addEventListener('click', () => {
        this.state = plantCrop(this.state, this.state.activeFarmId, plotId, crop.id);
        this.onStateChange(this.state);
        this.closeModals();
        this.renderFarmArea(); this.renderHUD(); this.renderInfoSidebar(); this.renderNav();
      });
      listEl.appendChild(btn);
    });
    modal.classList.remove('hidden');
  }

  private closeModals(): void {
    ['crop-picker','plot-use-picker','stall-builder','processing-builder','vehicle-farm-picker','new-location-modal'].forEach(id =>
      document.getElementById(id)?.classList.add('hidden'));
    this.pendingPlotId = null;
  }

  // ── Info Sidebar ──────────────────────────────────────────────────────────

  private renderInfoSidebar(): void {
    const el = document.getElementById('info-sidebar');
    if (!el) return;
    const farmId = this.state.activeFarmId;
    const farm   = this.state.farms[farmId];
    if (!farm) { el.innerHTML = ''; return; }

    const storageEntries = Object.entries(farm.storage).filter(([,v]) => v > 0);
    const totalVal       = totalStorageValue(farm.storage);
    const readyPlots     = farm.plots.filter(p => !p.locked &&
      ((p.plotType === 'field' && p.fieldState === 'ready') ||
       (p.plotType === 'stall' && (p.stallA.productionReady || (p.stallB?.productionReady ?? false))) ||
       (p.plotType === 'processing' && p.processingSlots.some(s => s.outputReady > 0))));

    el.innerHTML = `
      <div class="panel">
        <h4 class="panel-title">🏪 Lager <span class="panel-title-sub">${this.state.farmMeta.find(m => m.id === farmId)?.name ?? ''}</span></h4>
        ${storageEntries.length === 0 ? '<p class="text-muted">Lager ist leer</p>' : `
          ${storageEntries.map(([pid, amt]) => {
            const prod = PRODUCTS[pid];
            if (!prod) return '';
            return `<div class="storage-row">
              <span class="storage-crop">${prod.emoji} ${prod.name}</span>
              <span class="storage-tons">${formatAmount(amt, prod.unit)}</span>
            </div>`;
          }).join('')}
          <div class="storage-total">
            <span>Gesamtwert</span><strong>${Math.round(totalVal).toLocaleString('de-DE')} €</strong>
          </div>
        `}
      </div>
      <div class="panel">
        <h4 class="panel-title">✅ Aktionen nötig</h4>
        ${readyPlots.length === 0 ? '<p class="text-muted">Nichts zu tun</p>' : `
          <p class="text-success"><strong>${readyPlots.length}</strong> bereit</p>
          <button class="btn btn-harvest btn-full" id="harvest-all-btn">Alles einsammeln</button>`}
      </div>
      <div class="panel">
        <h4 class="panel-title">📋 Pflanzen & Preise</h4>
        ${CROP_LIST.map(c => {
          const rev = Math.round(c.yieldKg * c.sellPricePerKg);
          const yStr = c.yieldKg >= 1000 ? (c.yieldKg/1000).toFixed(1)+'t' : c.yieldKg+'kg';
          return `<div class="crop-legend-row">
            <span>${c.emoji}</span><span class="crop-legend-name">${c.name}</span>
            <span class="text-muted">${yStr}</span>
            <span class="crop-legend-rev">≈${rev} €</span>
          </div>`;
        }).join('')}
      </div>
      <div class="panel">
        <h4 class="panel-title">🐄 Tierprodukte</h4>
        ${ANIMAL_LIST.map(a => `<div class="crop-legend-row">
          <span>${a.emoji}</span><span class="crop-legend-name">${a.name}</span>
          <span class="text-muted">${a.productEmoji} ${a.sellPricePerUnit.toFixed(2).replace('.',',')} €/${a.productUnit}</span>
        </div>`).join('')}
      </div>
      <div class="panel">
        <h4 class="panel-title">📊 Statistiken</h4>
        <div class="stat-row"><span>Einnahmen</span><strong>${this.state.stats.totalEarned.toLocaleString('de-DE')} €</strong></div>
        <div class="stat-row"><span>Geerntet</span><strong>${this.state.stats.totalHarvested}×</strong></div>
      </div>`;

    document.getElementById('harvest-all-btn')?.addEventListener('click', () => {
      let s = this.state;
      readyPlots.forEach(p => {
        if (p.plotType === 'field' && p.fieldState === 'ready') s = harvestPlot(s, farmId, p.id);
        if (p.plotType === 'stall') {
          if (p.stallA.productionReady) s = collectStall(s, farmId, p.id, 0);
          if (p.stallB?.productionReady) s = collectStall(s, farmId, p.id, 1);
        }
        if (p.plotType === 'processing') {
          p.processingSlots.forEach((slot, i) => {
            if (slot.outputReady > 0) s = collectProcessingOutput(s, farmId, p.id, i);
          });
        }
      });
      this.state = s; this.onStateChange(s);
      this.renderFarmArea(); this.renderInfoSidebar(); this.renderHUD(); this.renderNav();
    });
  }

  showNotification(text: string): void {
    const el = document.getElementById('notification');
    if (!el) return;
    el.textContent = text;
    el.classList.remove('hidden', 'fade-out');
    setTimeout(() => el.classList.add('fade-out'), 2200);
  }

  bindKeyboard(getState: () => GameState, update: (s: GameState) => void): void {
    document.addEventListener('keydown', e => {
      const s = getState();
      if (e.code === 'KeyM' && e.ctrlKey) { e.preventDefault(); update({ ...s, money: s.money + 1_000_000 }); this.showNotification('💰 +1.000.000 € (Cheat)'); }
    });
  }
}
