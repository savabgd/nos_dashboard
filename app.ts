/**
 * ============================================================
 * app.ts — GLAVNA APLIKACIJA (mozak dashboarda)
 * ============================================================
 *
 * ODGOVARA ZA SVE osim mape (mapa je odvojena u network-map.ts):
 *  1. Dohvat podataka  — fetch sa API-ja, SSE live stream, mock fallback
 *  2. KPI kartice      — gornjih 5 kartica + delte ↑↓
 *  3. Domeni           — RAN/IMS/Transport/Core kartice + sparkline timeline
 *  4. Tabela ćelija    — pretraga, filter "samo kritično", domen filter
 *  5. Chart.js grafikoni — access fail, drop rate, integrity, Erlang
 *  6. NOC panel        — health ring, SLA bar, alarmi, incidenti, uptime
 *  7. Detail drawer    — desni panel sa detaljima (ćelija/stanica/okrug/domen)
 *  8. Sidebar navigacija — levi meni (pregled, domeni, alati)
 *  9. Tema, toast notifikacije, CSV export
 *
 * POKRETANJE: index.html učitava ovaj fajl kao module; na dnu fajla
 * stoji DOMContentLoaded listener koji pokreće sve (boot sekvenca).
 *
 * TOK PODATAKA:
 *   loadData() → fetch API → kpiData[] → updateDashboard()
 *   SSE 'kpis' event (svakih ~30s) → applyKpiPayload() → updateDashboard()
 *   Ako API ne radi → generateMockData() (crveni LIVE badge upozorava)
 *
 * @author CETIN
 * @version 1.1.0
 */

import Chart from 'chart.js/auto';
import {
  NETWORK_LINKS,
  NETWORK_STATIONS,
  DISTRICT_META,
  DOMAIN_META,
  CORE_HUB_STATIONS,
  stationDomain,
} from './stations';
import type { NetworkDomain } from './stations';

// ============================================================================
// TIPOVI — oblici podataka koje aplikacija koristi
// ============================================================================

/** Jedna ćelija (sektor jednog frekventnog opsega jedne stanice) — red iz API-ja. */
interface KpiCell {
  celija: string;   // ID ćelije, npr. "BGD_CEN_001_1800_1"
  stanica: string;  // ID stanice kojoj pripada
  klaster: string;  // klaster (grupa stanica)
  band: string;     // frekventni opseg: "800" | "1800" | "2100" MHz
  volteAccessFailureRate: number; // % neuspešnih uspostavljanja poziva
  volteDropRate: number;          // % otpuštenih poziva
  volteCellIntegrity: number;     // % integritet ćelije (viši = bolji)
  volteErlang: number;            // opterećenje (Erlang)
  volteSuccCalls: number;         // broj uspešnih poziva
  volteMobilitySR: number;        // % uspeh handover-a
  pdcchErrorRateVolte: number;    // % PDCCH greške
  volteDropsCount: number;        // apsolutan broj otpuštenih poziva
  // opciona polja (ne moraju svi izvori da ih šalju):
  volteQci1AddSuccRate?: number;
  volteQci1InitSuccRate?: number;
  volteQci5AddSuccRate?: number;
  volteQci5InitSuccRate?: number;
  status?: 'GOOD' | 'WARNING' | 'BAD'; // status računat na backendu
  datetime?: string;                   // vreme merenja
}

/** Zbirni (agregirani) pokazatelji cele mreže — za gornje KPI kartice. */
interface KpiMetrics {
  dropRate: number;       // prosečan drop rate
  accessFailRate: number; // prosečan access fail
  cellIntegrity: number;  // prosečan integritet
  erlang: number;         // ukupan Erlang
}

/** SLA pragovi — iznad/ispod njih se boje vrednosti i računa status. */
interface SlaThresholds {
  accessFailRate: number;
  dropRate: number;
  cellIntegrity: number;
  pdcchError: number;
  erlangPerSector: number;
}

/** Oblik odgovora API-ja: { success, data: [...], metrics, count, timestamp }. */
interface ApiResponse {
  success: boolean;
  data: KpiCell[];
  metrics?: KpiMetrics;
  count: number;
  timestamp: string;
}

/** Oblik greške API-ja. */
export interface ApiError {
  success: boolean;
  error: string;
  code: number;
  details?: any;
  timestamp: string;
}

// ============================================================================
// KONFIGURACIJA — čita se iz .env / Vite env varijabli (VITE_*)
// ============================================================================

// import.meta.env su Vite-ove env varijable (iz .env fajla pored projekta)
const metaEnv = (import.meta as any).env || {};
const CONFIG = {
  API_BASE_URL: metaEnv.VITE_API_BASE_URL ?? 'http://localhost:8080', // adresa backend-a
  AUTO_REFRESH_INTERVAL: parseInt(metaEnv.VITE_AUTO_REFRESH_INTERVAL || '300000'), // polling ms (ako SSE isključen)
  USE_SSE: (metaEnv.VITE_SSE_ENABLED ?? 'true') === 'true',  // live stream uključen?
  SSE_PUSH_INTERVAL: parseInt(metaEnv.VITE_SSE_INTERVAL || '30'), // sekundi između SSE push-eva
};

// SLA pragovi — vrednosti iznad/ispod njih dobijaju crveno/žuto/zeleno.
// (U produkciji ih backend čita iz env-a; frontend ih koristi za bojenje.)
const SLA: SlaThresholds = {
  accessFailRate: 2.0,   // % — iznad = WARNING
  dropRate: 1.5,         // % — iznad = WARNING
  cellIntegrity: 97,     // % — ispod = WARNING
  pdcchError: 3.0,       // % — iznad = WARNING
  erlangPerSector: 40,   // Erl — iznad = upozorenje za opterećenje
};

// ============================================================================
// GLOBALNO STANJE — promenljive koje žive dok je stranica otvorena
// ============================================================================

let kpiData: KpiCell[] = [];                     // ← GLAVNI niz podataka (sve ćelije)
const charts: Record<string, Chart> = {};        // Chart.js instance (za destroy/update)
let autoRefreshInterval: number | null = null;   // polling timer (ako SSE isključen)
let prevMetrics: KpiMetrics | null = null;       // prethodni snapshot (za delte ↑↓)
let sseSource: EventSource | null = null;        // aktivna SSE veza
let networkMapModule: typeof import('./network-map') | null = null; // lenjo učitana mapa
let activeDomainFilter: NetworkDomain | null = null; // aktivan domen filter (null = svi)

// ── NOC panel stanje ──
let soundEnabled = false;               // da li alarm zvuk (zvučni signal) radi
const nocStartTime = Date.now();        // za "Uptime" brojač
interface Alarm { id: string; severity: 'critical' | 'major'; text: string; time: Date; }
interface Incident { id: string; title: string; status: 'active' | 'investigating' | 'resolved'; time: Date; meta: string; }
let activeAlarms: Alarm[] = [];         // trenutno aktivni alarmi (iz kpiData)
let recentIncidents: Incident[] = [];   // izvedeni incidenti za timeline

// ============================================================================
// UTILITETI — male pomoćne funkcije koje se koriste svuda
// ============================================================================

/** Pretvori bilo šta u broj; ako ne može (NaN/undefined/null) → 0. */
function toNumber(value: any): number {
  const num = Number(value);
  return Number.isFinite(num) ? num : 0;
}

/**
 * Format percentage value
 */
function formatPercent(value: number | null | undefined): string {
  if (value === null || value === undefined) return 'N/A';
  return `${value.toFixed(2)}%`;
}

/**
 * Set text content of an element
 */
function setText(elementId: string, value: string | number): void {
  const element = document.getElementById(elementId);
  if (element) {
    element.textContent = String(value);
  }
}

/** Uzme slučajan element iz niza (koristi ga generator mock podataka). */
function pick<T>(items: T[]): T {
  return items[Math.floor(Math.random() * items.length)];
}

/** Pročita izabrani vremenski opseg iz dropdown-a (1h / 24h / 168h). */
function getSelectedHours(): number {
  const select = document.getElementById('timeRange') as HTMLSelectElement;
  return Number(select?.value || 24);
}

/**
 * Očisti i normalizuj jedan red podataka iz API-ja:
 * sva polja moraju postojati i imati pravi tip (brojevi kao brojevi).
 * Zove se pre SVAKOG korišćenja podataka — štiti od rušenja na lošim podacima.
 */
function normalizeCell(cell: { [K in keyof KpiCell]?: KpiCell[K] | string }): KpiCell {
  return {
    celija: String(cell.celija ?? ''),
    stanica: String(cell.stanica ?? ''),
    klaster: String(cell.klaster ?? ''),
    band: String(cell.band ?? ''),
    volteAccessFailureRate: toNumber(cell.volteAccessFailureRate),
    volteDropRate: toNumber(cell.volteDropRate),
    volteCellIntegrity: toNumber(cell.volteCellIntegrity),
    volteErlang: toNumber(cell.volteErlang),
    volteSuccCalls: Math.trunc(toNumber(cell.volteSuccCalls)),
    volteMobilitySR: toNumber(cell.volteMobilitySR),
    pdcchErrorRateVolte: toNumber(cell.pdcchErrorRateVolte),
    volteDropsCount: Math.trunc(toNumber(cell.volteDropsCount)),
    status: cell.status as KpiCell['status'],
    datetime: cell.datetime,
  };
}

/**
 * Izračunaj prosek svih ključnih KPI-jeva preko svih ćelija.
 * Vraća null ako nema podataka. Koriste ga KPI kartice i delte.
 */
function computeMetrics(data: KpiCell[] | null): KpiMetrics | null {
  if (!data || !data.length) return null;
  
  const valid = data.map(normalizeCell);
  const n = valid.length;
  
  return {
    dropRate: valid.reduce((sum, cell) => sum + cell.volteDropRate, 0) / n,
    accessFailRate: valid.reduce((sum, cell) => sum + cell.volteAccessFailureRate, 0) / n,
    cellIntegrity: valid.reduce((sum, cell) => sum + cell.volteCellIntegrity, 0) / n,
    erlang: valid.reduce((sum, cell) => sum + cell.volteErlang, 0),
  };
}

// ============================================================================
// STATUS ĆELIJE — bojenje po SLA pragovima
// ============================================================================

/**
 * Status jedne ćelije po pragovima:
 *   BAD     → drop>3% ili accessFail>5% ili integritet<95%  (hard SLA prekršaj)
 *   WARNING → bilo koji SLA prag iz CONFIG-a prekoračen
 *   GOOD    → sve u granicama
 */
function getCellStatus(c: KpiCell): 'GOOD' | 'WARNING' | 'BAD' {
  if (c.volteDropRate > 3 || c.volteAccessFailureRate > 5 || c.volteCellIntegrity < 95) return 'BAD';
  if (c.volteDropRate > SLA.dropRate || c.volteAccessFailureRate > SLA.accessFailRate || c.volteCellIntegrity < SLA.cellIntegrity) return 'WARNING';
  return 'GOOD';
}

/**
 * Vrati CSS klasu boje za vrednost: 'kpi-good' / 'kpi-warning' / 'kpi-bad'.
 * higherIsBetter=true za metrike gde je više bolje (npr. integritet).
 */
function getKpiClass(value: number, goodThreshold: number, badThreshold: number, higherIsBetter: boolean = false): string | null {
  if (higherIsBetter) {
    if (value >= goodThreshold) return 'kpi-good';
    if (value <= badThreshold) return 'kpi-bad';
    return 'kpi-warning';
  }
  if (value <= goodThreshold) return 'kpi-good';
  if (value >= badThreshold) return 'kpi-bad';
  return 'kpi-warning';
}

// ============================================================================
// DELTE — strelice ↑↓ pored KPI vrednosti (uporedba sa prethodnim snapshot-om)
// ============================================================================

/**
 * Prikaži razliku između trenutne i prethodne vrednosti:
 *   ↓ zeleno = popravilo se, ↑ crveno = pogoršalo, "-> 0" = isto.
 * lowerIsBetter=true za metrike gde je pad dobra vest (drop, access fail).
 */
function updateDelta(elementId: string, current: number, previous: number | null | undefined, lowerIsBetter: boolean = true): void {
  const element = document.getElementById(elementId);
  if (!element) return;
  
  element.textContent = '';
  element.className = 'kpi-delta';
  
  if (previous === null || previous === undefined) return;
  
  const diff = current - previous;
  element.classList.add('delta');
  
  if (Math.abs(diff) < 0.01) {
    element.classList.add('neutral');
    element.textContent = '-> 0';
    return;
  }
  
  const isImproving = lowerIsBetter ? diff < 0 : diff > 0;
  element.classList.add(isImproving ? 'positive' : 'negative');
  element.textContent = `${isImproving ? '\u2193' : '\u2191'} ${diff > 0 ? '+' : ''}${diff.toFixed(2)}%`;
}

// ============================================================================
// TABELA — pretraga, filteri i render redova
// ============================================================================

/** Dodaj jedan <td> u red (opciono sa CSS klasom boje i bold tekstom). */
function appendCell(row: HTMLTableRowElement, value: string | number, className: string | null = null, strong: boolean = false): void {
  const td = document.createElement('td');
  if (className) td.className = className;
  
  if (strong) {
    const bold = document.createElement('strong');
    bold.textContent = String(value);
    td.appendChild(bold);
  } else {
    td.textContent = String(value);
  }
  
  row.appendChild(td);
}

/**
 * Update the KPI data table (search + critical-only filters applied)
 */
// Stanje tablice: max redova (performanse), aktivna pretraga i filter kritičnih
const MAX_TABLE_ROWS = 500;
let tableSearch = '';
let showOnlyCritical = false;
let searchTimer: number | null = null; // debounce za kucanje u pretragu

/**
 * Filtriraj ćelije po: aktivnom DOMENU, "samo kritično" i pretrazi.
 * Pretraga gleda u celija/stanica/klaster (case-insensitive).
 * Vraća max 500 redova — tabela ne sme da se zaglavi na hiljadama redova.
 */
function filterCells(cells: KpiCell[], query: string, showBadOnly: boolean): KpiCell[] {
  const q = query.trim().toLowerCase();
  return cells.filter(cell => {
    if (activeDomainFilter && stationDomain(cell.stanica) !== activeDomainFilter) return false;
    if (showBadOnly && getCellStatus(cell) !== 'BAD') return false;
    if (!q) return true;
    return cell.celija.toLowerCase().includes(q)
      || cell.stanica.toLowerCase().includes(q)
      || cell.klaster.toLowerCase().includes(q);
  }).slice(0, MAX_TABLE_ROWS);
}

/** Skraćenica: filtriraj globalni kpiData trenutnim filterima. */
function getFilteredCells(): KpiCell[] {
  return filterCells(kpiData, tableSearch, showOnlyCritical);
}

/**
 * Iscrtaj tabelu iznova (briše sve <tr> pa dodaje nove).
 * Svaki red dobija data-stanica i data-celija atribute —
 * klik delegat (u setupEventListeners) preko njih otvara drawer.
 */
function updateTable(): void {
  const tbody = document.getElementById('tableBody');
  if (!tbody) return;
  
  tbody.replaceChildren();
  
  getFilteredCells().forEach(cell => {
    const row = document.createElement('tr');
    row.dataset.station = cell.stanica;
    row.dataset.celija = cell.celija;
    const status = getCellStatus(cell);
    const statusClass = status === 'GOOD' ? 'status-good' : status === 'WARNING' ? 'status-warning' : 'status-bad';
    const erlangWarn = cell.volteErlang > SLA.erlangPerSector;
    
    appendCell(row, cell.klaster);
    appendCell(row, cell.stanica);
    appendCell(row, cell.celija, null, true);
    appendCell(row, `${cell.band} MHz`);
    appendCell(row, cell.volteAccessFailureRate.toFixed(2), getKpiClass(cell.volteAccessFailureRate, SLA.accessFailRate, SLA.accessFailRate * 2.5));
    appendCell(row, cell.volteDropRate.toFixed(2), getKpiClass(cell.volteDropRate, SLA.dropRate, SLA.dropRate * 2));
    appendCell(row, cell.volteCellIntegrity.toFixed(2), getKpiClass(cell.volteCellIntegrity, SLA.cellIntegrity, SLA.cellIntegrity - 2, true));
    appendCell(row, `${cell.volteErlang.toFixed(1)}${erlangWarn ? ' !' : ''}`, erlangWarn ? 'erlang-warn' : null);
    appendCell(row, cell.volteSuccCalls);
    appendCell(row, cell.volteMobilitySR.toFixed(2), getKpiClass(cell.volteMobilitySR, 97, 95, true));
    appendCell(row, cell.pdcchErrorRateVolte.toFixed(2), getKpiClass(cell.pdcchErrorRateVolte, SLA.pdcchError, SLA.pdcchError * 2));
    appendCell(row, cell.volteDropsCount);
    
    const statusCell = document.createElement('td');
    const badge = document.createElement('span');
    badge.className = `status-badge ${statusClass}`;
    badge.textContent = status;
    statusCell.appendChild(badge);
    row.appendChild(statusCell);
    
    tbody.appendChild(row);
  });
}

// ============================================================================
// GRAFIKONI (Chart.js) — 4 grafikona ispod mape
// ============================================================================

// Zajednički izgled tooltip-a za sve grafikone (tamna kartica)
const chartTooltip = {
  backgroundColor: '#2a2f3a',
  titleColor: '#ffffff',
  bodyColor: '#b0b8c4',
  borderColor: '#3a4050',
  borderWidth: 1,
  padding: 10,
  cornerRadius: 4,
};

/** Zajedničke opcije: bez legende, tamna mreža, opciono max na Y osi. */
function chartOptions({ max = null as number | null, tooltip = chartTooltip as any } = {}): ChartOptions {
  return {
    responsive: true,
    maintainAspectRatio: true,
    plugins: { 
      legend: { display: false }, 
      tooltip 
    },
    scales: {
      x: { ticks: { color: '#6b7280' }, grid: { color: '#3a4050' } },
      y: {
        beginAtZero: true,
        ...(max ? { max } : {}),
        ticks: { color: '#6b7280' },
        grid: { color: '#3a4050' }
      }
    }
  };
}

/** Opciona podešavanja Chart.js grafikona (koristi je chartOptions). */
interface ChartOptions {
  responsive?: boolean;
  maintainAspectRatio?: boolean;
  plugins?: any;
  scales?: any;
}

/** Grafikon 1: Access Fail Rate trend — linija, prva 10 ćelija, crveni poeni iznad SLA. */
function updateAccessFailChart(): void {
  const ctx = document.getElementById('accessFailChart') as HTMLCanvasElement;
  if (!ctx) return;
  
  if (charts.accessFail) charts.accessFail.destroy();
  const topCells = kpiData.slice(0, 10);
  const labels = topCells.map(c => c.celija);
  const data = topCells.map(c => c.volteAccessFailureRate);
  
  charts.accessFail = new Chart(ctx, {
    type: 'line',
    data: {
      labels,
      datasets: [{
        label: 'Access Fail Rate (%)',
        data,
        borderColor: '#0ea5e9',
        backgroundColor: data.map(v => v > SLA.accessFailRate ? 'rgba(239, 68, 68, 0.1)' : 'rgba(14, 165, 233, 0.1)'),
        borderWidth: 2,
        pointBackgroundColor: data.map(v => v > SLA.accessFailRate ? '#ef4444' : '#0ea5e9'),
        pointRadius: 3,
        tension: 0.3,
        fill: true
      }]
    },
    options: chartOptions({ max: 10 })
  });
}

/** Grafikon 2: Drop Rate po ćeliji — stubići, boja po težini (crveno>3%, žuto>SLA). */
function updateDropRateChart(): void {
  const ctx = document.getElementById('dropRateChart') as HTMLCanvasElement;
  if (!ctx) return;
  
  if (charts.dropRate) charts.dropRate.destroy();
  const topCells = kpiData.slice(0, 10);
  const labels = topCells.map(c => c.celija);
  const data = topCells.map(c => c.volteDropRate);
  
  charts.dropRate = new Chart(ctx, {
    type: 'bar',
    data: {
      labels,
      datasets: [{
        label: 'Drop Rate (%)',
        data,
        backgroundColor: data.map(v => v > 3 ? '#ef4444' : v > SLA.dropRate ? '#f59e0b' : '#10b981'),
        borderRadius: 3
      }]
    },
    options: chartOptions({ max: 10 })
  });
}

/** Grafikon 3: Integritet — kroasan (doughnut) sa raspodelom Good/Warning/Bad. */
function updateIntegrityChart(): void {
  const ctx = document.getElementById('integrityChart') as HTMLCanvasElement;
  if (!ctx) return;
  
  if (charts.integrity) charts.integrity.destroy();
  const good = kpiData.filter(c => c.volteCellIntegrity >= 97).length;
  const warning = kpiData.filter(c => c.volteCellIntegrity >= 95 && c.volteCellIntegrity < 97).length;
  const bad = kpiData.filter(c => c.volteCellIntegrity < 95).length;
  
  charts.integrity = new Chart(ctx, {
    type: 'doughnut',
    data: {
      labels: ['Good (>=97%)', 'Warning (95-97%)', 'Bad (<95%)'],
      datasets: [{
        data: [good, warning, bad],
        backgroundColor: ['#10b981', '#f59e0b', '#ef4444'],
        borderColor: '#2a2f3a',
        borderWidth: 2
      }]
    },
    options: {
      responsive: true,
      maintainAspectRatio: true,
      cutout: '60%',
      plugins: { 
        legend: { 
          labels: { 
            color: '#b0b8c4', 
            padding: 10, 
            font: { size: 11 } 
          } 
        } 
      }
    }
  });
}

/** Grafikon 4: Erlang opterećenje — stubići, žuto iznad SLA pragopterećenja. */
function updateErlangChart(): void {
  const ctx = document.getElementById('erlangChart') as HTMLCanvasElement;
  if (!ctx) return;
  
  if (charts.erlang) charts.erlang.destroy();
  const topCells = kpiData.slice(0, 10);
  const labels = topCells.map(c => c.celija);
  const data = topCells.map(c => c.volteErlang);
  
  charts.erlang = new Chart(ctx, {
    type: 'bar',
    data: {
      labels,
      datasets: [{
        label: 'Erlang',
        data,
        backgroundColor: data.map(v => v > SLA.erlangPerSector ? '#f59e0b' : '#0ea5e9'),
        borderRadius: 3
      }]
    },
    options: chartOptions({
      tooltip: {
        ...chartTooltip,
        callbacks: {
          label: (ctx: any) => `${ctx.parsed.y.toFixed(1)} Erl`
        }
      }
    })
  });
}

/** Osveži sva 4 grafikona odjednom (zove updateDashboard posle svakog snapshot-a). */
function updateCharts(): void {
  updateAccessFailChart();
  updateDropRateChart();
  updateIntegrityChart();
  updateErlangChart();
}

// ============================================================================
// PODACI — dohvat sa API-ja + mock fallback
// ============================================================================

/**
 * Generiši lažne KPI podatke kad backend ne radi (dev režim / API pao).
 * ~12% ćelija je "loše" da bi alarmi i boje imali smisla na ekranu.
 * VAŽNO: crveni LIVE badge uvek upozorava da su podaci mock.
 */
function generateMockData(hours: number = 24): KpiCell[] {
  const data: KpiCell[] = [];
  const bands = ['800', '1800', '2100'];
  const badStations = new Set(['BGD_CEN_002', 'BGD_SEV_002', 'NS_003', 'NIS_001']);
  const rows = hours <= 1 ? 12 : hours <= 24 ? 24 : 40;

  for (let i = 0; i < rows; i++) {
    const station = NETWORK_STATIONS[i % NETWORK_STATIONS.length];
    const band = pick(bands);
    const cell = `${station.id}_${band}_${Math.floor(Math.random() * 3) + 1}`;
    const isBad = badStations.has(station.id) || Math.random() < 0.12;

    data.push({
      celija: cell,
      stanica: station.id,
      klaster: station.cluster,
      band,
      volteAccessFailureRate: isBad ? Math.random() * 5 + 2 : Math.random() * 1.5,
      volteDropRate: isBad ? Math.random() * 4 + 2 : Math.random() * 1,
      volteCellIntegrity: isBad ? Math.random() * 5 + 90 : Math.random() * 3 + 96,
      volteErlang: Math.random() * 50 + 10,
      volteSuccCalls: Math.floor(Math.random() * 1000 + 200),
      volteMobilitySR: isBad ? Math.random() * 5 + 90 : Math.random() * 3 + 96,
      pdcchErrorRateVolte: isBad ? Math.random() * 6 + 3 : Math.random() * 2,
      volteDropsCount: isBad ? Math.floor(Math.random() * 50 + 20) : Math.floor(Math.random() * 10),
    });
  }

  return data;
}

/**
 * Zovi backend: GET {API}/api/kpis?hours=N
 * Prihvata i oblik { data: [...] } i gol niz [...]. Baca grešku na loš odgovor.
 */
async function fetchKpiData(): Promise<KpiCell[]> {
  const hours = getSelectedHours();
  const apiUrl = `${CONFIG.API_BASE_URL}/api/kpis?hours=${encodeURIComponent(hours.toString())}`;
  
  console.log(`Fetching KPI data from: ${apiUrl}`);
  
  try {
    const response = await fetch(apiUrl, {
      headers: { 
        Accept: 'application/json',
        'Cache-Control': 'no-cache'
      }
    });
    
    if (!response.ok) {
      console.error(`API returned ${response.status}: ${response.statusText}`);
      throw new Error(`API returned ${response.status}`);
    }
    
    const payload: ApiResponse = await response.json();
    const rows = Array.isArray(payload) ? payload : payload.data;
    
    if (!Array.isArray(rows)) {
      console.error('API response must be an array or { data: [] }');
      throw new Error('Invalid API response format');
    }
    
    console.log(`Received ${rows.length} KPI records from API`);
    return rows as KpiCell[];
    
  } catch (error) {
    console.error('Error fetching KPI data:', error);
    throw error;
  }
}

/**
 * GLAVNA FUNKCIJA ZA PODATKE — zove se pri startu, na Refresh dugme i na promenu opsega.
 * Uspeh  → kpiData = API odgovor → updateDashboard()
 * Pad    → kpiData = mock podaci → crveni LIVE badge + toast upozorenje
 * prevMetrics se pamti PRE dohvata da delte ↑↓ porede staro i novo stanje.
 */
async function loadData(): Promise<void> {
  try {
    prevMetrics = computeMetrics(kpiData.length ? kpiData : null);
    kpiData = await fetchKpiData();
    updateDashboard();
    updateLastUpdated();
    setLiveBadge('muted');
  } catch (error) {
    console.error('Error loading KPI data, using mock data:', error);
    kpiData = generateMockData(getSelectedHours());
    updateDashboard();
    setLiveBadge('bad');
    showToast('Greška pri učitavanju podataka — prikazujem mock podatke', 'error');
  }
}

/**
 * CENTRALNA FUNKCIJA RENDER-A — poziva se posle SVAKOG novog snapshot-a
 * (prvo učitavanje, Refresh dugme, SSE push). Redosled je bitan:
 * normalizuj → metriku → kartice → domeni → tabela → grafikoni → mapa → NOC.
 */
function updateDashboard(): void {
  kpiData = kpiData.map(normalizeCell); // garantuj tipove pre bilo kog korišćenja
  const curr = computeMetrics(kpiData);

  updateSummaryCards(curr);   // 1. gornjih 5 kartica + delte
  renderDomainCards();        // 2. RAN/IMS/Transport/Core kartice + sparkline
  renderKpiScorecard();       // 3. KPI scorecard (9 metrika + top 5 najgorih)
  updateTable();              // 4. tabela (poštuje domen filter)
  updateCharts();             // 5. 4 Chart.js grafikona
  networkMapModule?.updateNetworkMap?.(kpiData); // 6. boje na mapi (ako je mapa učitana)
  updateNocPanel(curr);       // 7. health ring, SLA, alarmi, incidenti
}

// ============================================================================
// NOC PANEL — health ring, SLA bar, alarmi, incidenti, uptime
// ============================================================================

/** Orkestrira sve pod-funkcije NOC panela (zove updateDashboard). */
function updateNocPanel(curr: KpiMetrics | null): void {
  if (!curr) return;
  updateHealthRing(curr);
  updateSlaBar(curr);
  updateAlarms();
  updateIncidents();
  updateUptime();
}

/**
 * Zdravstveni krug (0-100) — ponderisana ocena mreže:
 * 30% drop + 30% access fail + 40% integritet.
 * <70 = crveno, <90 = žuto, inače zeleno. Animira stroke SVG kruga.
 */
function updateHealthRing(curr: KpiMetrics): void {
  const dropScore = Math.max(0, 100 - (curr.dropRate / SLA.dropRate) * 50);
  const accessScore = Math.max(0, 100 - (curr.accessFailRate / SLA.accessFailRate) * 50);
  const integrityScore = Math.min(100, (curr.cellIntegrity / 100) * 100);
  const score = Math.round((dropScore * 0.3 + accessScore * 0.3 + integrityScore * 0.4));

  const scoreEl = document.getElementById('healthScore');
  const arcEl = document.getElementById('healthArc') as SVGCircleElement | null;
  if (scoreEl) scoreEl.textContent = String(score);

  if (arcEl) {
    const circumference = 2 * Math.PI * 42;
    const offset = circumference - (score / 100) * circumference;
    arcEl.style.strokeDashoffset = String(offset);
    arcEl.classList.remove('warning', 'bad');
    if (score < 70) arcEl.classList.add('bad');
    else if (score < 90) arcEl.classList.add('warning');
  }
}

/**
 * SLA compliance bar: % ćelija koje su u skladu sa SVIM pragovima.
 * <95% = crveno, <99.5% = žuto, inače zeleno. Cilj firme: 99.5%.
 */
function updateSlaBar(_curr: KpiMetrics): void {
  const compliant = kpiData.filter(c =>
    c.volteDropRate <= SLA.dropRate &&
    c.volteAccessFailureRate <= SLA.accessFailRate &&
    c.volteCellIntegrity >= SLA.cellIntegrity
  ).length;
  const pct = kpiData.length ? (compliant / kpiData.length) * 100 : 0;

  const valEl = document.getElementById('slaValue');
  const barEl = document.getElementById('slaBar');
  if (valEl) {
    valEl.textContent = pct.toFixed(1) + '%';
    valEl.classList.remove('warning', 'bad');
    if (pct < 95) valEl.classList.add('bad');
    else if (pct < 99.5) valEl.classList.add('warning');
  }
  if (barEl) {
    barEl.style.width = pct.toFixed(1) + '%';
    barEl.classList.remove('warning', 'bad');
    if (pct < 95) barEl.classList.add('bad');
    else if (pct < 99.5) barEl.classList.add('warning');
  }
}

/**
 * Izračunaj aktivne alarme iz kpiData:
 *   critical → drop ili access fail PREKO 2× SLA praga
 *   major    → integritet ispod 95%
 * Ako je broj alarma porastao i zvuk je uključen → pusti zvučni signal.
 * Prikazuje max 8 najnovijih u NOC panelu.
 */
function updateAlarms(): void {
  const prevAlarmCount = activeAlarms.length;
  activeAlarms = [];

  kpiData.forEach(c => {
    if (c.volteDropRate > SLA.dropRate * 2) {
      activeAlarms.push({
        id: `drop-${c.celija}`, severity: 'critical',
        text: `${c.celija} — Drop ${c.volteDropRate.toFixed(1)}%`, time: new Date()
      });
    } else if (c.volteAccessFailureRate > SLA.accessFailRate * 2) {
      activeAlarms.push({
        id: `af-${c.celija}`, severity: 'critical',
        text: `${c.celija} — AF ${c.volteAccessFailureRate.toFixed(1)}%`, time: new Date()
      });
    } else if (c.volteCellIntegrity < 95) {
      activeAlarms.push({
        id: `int-${c.celija}`, severity: 'major',
        text: `${c.celija} — Integrity ${c.volteCellIntegrity.toFixed(1)}%`, time: new Date()
      });
    }
  });

  if (soundEnabled && activeAlarms.length > prevAlarmCount) playAlarmSound();

  const listEl = document.getElementById('alarmsList');
  if (!listEl) return;
  if (activeAlarms.length === 0) {
    listEl.innerHTML = '<div class="alarm-empty">No active alarms</div>';
    return;
  }
  listEl.innerHTML = activeAlarms.slice(0, 8).map(a => `
    <div class="alarm-item ${a.severity === 'major' ? 'warning' : ''}">
      <span class="alarm-severity ${a.severity}">${a.severity}</span>
      <span class="alarm-text">${a.text}</span>
      <span class="alarm-time">${a.time.toLocaleTimeString('sr-RS', { hour: '2-digit', minute: '2-digit' })}</span>
    </div>
  `).join('');
}

/**
 * Izvedi "incidente" iz alarmâ (grupisani prikaz za timeline):
 * critical alarmi → 1 aktivan incident; major alarmi → investigating;
 * nema alarma → "All systems nominal" (rešeno).
 */
function updateIncidents(): void {
  const now = new Date();
  const criticalAlarms = activeAlarms.filter(a => a.severity === 'critical');
  recentIncidents = [];

  if (criticalAlarms.length > 0) {
    recentIncidents.push({
      id: 'inc-critical', title: `${criticalAlarms.length} critical alarm(s) active`,
      status: 'active', time: now,
      meta: `Cells: ${criticalAlarms.map(a => a.text.split(' — ')[0]).join(', ')}`
    });
  }
  const majorAlarms = activeAlarms.filter(a => a.severity === 'major');
  if (majorAlarms.length > 0) {
    recentIncidents.push({
      id: 'inc-major', title: `${majorAlarms.length} cell(s) below integrity SLA`,
      status: 'investigating', time: now, meta: 'Auto-detected by KPI monitoring'
    });
  }
  if (activeAlarms.length === 0) {
    recentIncidents.push({
      id: 'inc-ok', title: 'All systems nominal',
      status: 'resolved', time: now, meta: 'No active incidents'
    });
  }

  const countEl = document.getElementById('incidentCount');
  if (countEl) {
    countEl.textContent = String(recentIncidents.length);
    countEl.classList.toggle('has-incidents', activeAlarms.length > 0);
  }

  const timelineEl = document.getElementById('incidentsTimeline');
  if (!timelineEl) return;
  timelineEl.innerHTML = recentIncidents.map((inc, i) => `
    <div class="incident-item">
      <div class="incident-dot-col">
        <span class="incident-dot ${inc.status}"></span>
        ${i < recentIncidents.length - 1 ? '<span class="incident-line"></span>' : ''}
      </div>
      <div class="incident-info">
        <span class="incident-title">${inc.title}</span>
        <span class="incident-meta">${inc.time.toLocaleTimeString('sr-RS', { hour: '2-digit', minute: '2-digit' })} · ${inc.meta}</span>
      </div>
    </div>
  `).join('');
}

/** Brojač "Uptime: Xh Ym Zs" — koliko dugo je stranica otvorena; dot boji po alarmima. */
function updateUptime(): void {
  const elapsed = Date.now() - nocStartTime;
  const hours = Math.floor(elapsed / 3600000);
  const mins = Math.floor((elapsed % 3600000) / 60000);
  const secs = Math.floor((elapsed % 60000) / 1000);

  const textEl = document.getElementById('uptimeText');
  const dotEl = document.getElementById('uptimeDot');
  if (textEl) textEl.textContent = `Uptime: ${hours}h ${mins}m ${secs}s`;
  if (dotEl) {
    dotEl.classList.remove('warning', 'bad');
    if (activeAlarms.some(a => a.severity === 'critical')) dotEl.classList.add('bad');
    else if (activeAlarms.length > 0) dotEl.classList.add('warning');
  }
}

/** Kratak zvučni signal (880 Hz, 0.4s) kad stigne novi kritični alarm. */
function playAlarmSound(): void {
  try {
    const ctx = new AudioContext();
    const osc = ctx.createOscillator();
    const gain = ctx.createGain();
    osc.connect(gain);
    gain.connect(ctx.destination);
    osc.type = 'square';
    osc.frequency.value = 880;
    gain.gain.value = 0.15;
    osc.start();
    gain.gain.exponentialRampToValueAtTime(0.001, ctx.currentTime + 0.4);
    osc.stop(ctx.currentTime + 0.4);
  } catch { /* AudioContext not available */ }
}



// ============================================================================
// MREŽNI DOMENI — RAN / IMS / Transport / Core (4 kartice + sparkline)
// ============================================================================

/** Statistika jednog domena za karticu: dostupnost %, broj elemenata i alarma. */
interface DomainStat {
  id: NetworkDomain;
  availability: number; // % elemenata u skladu sa SLA
  elements: number;     // koliko elemenata domen ima (ćelije ili linkovi)
  alarms: number;       // koliko ih je u BAD stanju
}

/** Da li je ćelija u skladu sa SVIM SLA pragovima (za računanje dostupnosti). */
function cellCompliant(c: KpiCell): boolean {
  return c.volteDropRate <= SLA.dropRate &&
    c.volteAccessFailureRate <= SLA.accessFailRate &&
    c.volteCellIntegrity >= SLA.cellIntegrity;
}

/** Hex boja za status tekst (koristi je meter bar u drawer-u). */
function statusHex(st: string): string {
  if (st === 'GOOD') return '#10b981';
  if (st === 'WARNING') return '#f59e0b';
  if (st === 'BAD') return '#ef4444';
  return '#6b7280';
}

/**
 * Izračunaj statistiku sva 4 domena iz trenutnog kpiData:
 *  - RAN       → sve ćelije OSIM hab stanica (habovi idu u Core)
 *  - IMS       → glas: gleda samo drop rate i integritet
 *  - Transport → linkovi sa mape (statusi dolaze iz network-map modula)
 *  - Core      → samo ćelije hab stanica (BGD_CEN_001, NS_001, KG_001)
 */
function computeDomainStats(): DomainStat[] {
  const cells = kpiData.map(normalizeCell);
  const linkStatuses = networkMapModule?.getLinkStatuses?.() ?? {};
  const linkVals = Object.values(linkStatuses);
  const pct = (ok: number, total: number) => total ? (ok / total) * 100 : 100;

  const ranCells = cells.filter(c => !CORE_HUB_STATIONS.has(c.stanica));
  const coreCells = cells.filter(c => CORE_HUB_STATIONS.has(c.stanica));
  const imsOk = cells.filter(c => c.volteDropRate <= SLA.dropRate && c.volteCellIntegrity >= SLA.cellIntegrity).length;

  return [
    { id: 'ran', availability: pct(ranCells.filter(cellCompliant).length, ranCells.length), elements: ranCells.length, alarms: ranCells.filter(c => getCellStatus(c) === 'BAD').length },
    { id: 'ims', availability: pct(imsOk, cells.length), elements: cells.length, alarms: cells.filter(c => getCellStatus(c) === 'BAD').length },
    { id: 'transport', availability: pct(linkVals.filter(s => s === 'GOOD').length, linkVals.length), elements: linkVals.length || NETWORK_LINKS.length, alarms: linkVals.filter(s => s !== 'GOOD').length },
    { id: 'core', availability: pct(coreCells.filter(cellCompliant).length, coreCells.length), elements: coreCells.length, alarms: coreCells.filter(c => getCellStatus(c) === 'BAD').length },
  ];
}

/** CSS klasa boje za procenat dostupnosti: ≥95% zeleno, ≥85% žuto, ispod crveno. */
function availClass(v: number): string {
  if (!Number.isFinite(v)) return 'kpi-warning';
  if (v >= 95) return 'kpi-good';
  if (v >= 85) return 'kpi-warning';
  return 'kpi-bad';
}

/** Rolling timeline dostupnosti po domenu — hrani sparkline u karticama.
 *  Puni se pri svakom updateDashboard-u; čuva poslednjih 24 vrednosti. */
const domainHistory: Record<NetworkDomain, number[]> = { ran: [], ims: [], transport: [], core: [] };

/** Dodaj novu vrednost u historiju (max 24 — starije se odbacuju). */
function pushDomainHistory(stats: DomainStat[]): void {
  stats.forEach(s => {
    const arr = domainHistory[s.id];
    arr.push(Number(s.availability.toFixed(1)));
    if (arr.length > 24) arr.shift();
  });
}

/**
 * Nacrtaj mini SVG sparkline iz niza vrednosti (0-100%).
 * Namerno BEZ Chart.js instance — 4 karte × Chart.js bi bilo sporo.
 * Tačkica na kraju linije pulsira (SVG <animate>).
 */
function sparklineSvg(points: number[], color: string): string {
  const pts = points.length > 1 ? points : [points[0] ?? 100, points[0] ?? 100];
  const min = Math.min(...pts, 88);
  const max = Math.max(...pts, 101);
  const range = Math.max(0.001, max - min);
  const step = 100 / (pts.length - 1);
  const coords = pts.map((v, i) =>
    `${(i * step).toFixed(1)},${(25 - ((v - min) / range) * 20).toFixed(1)}`
  );
  const last = coords[coords.length - 1].split(',');
  return `<svg class="sparkline" viewBox="0 0 100 28" preserveAspectRatio="none" aria-hidden="true">
    <polyline fill="none" stroke="${color}" stroke-width="1.6" stroke-linejoin="round" stroke-linecap="round" points="${coords.join(' ')}"/>
    <circle cx="${last[0]}" cy="${last[1]}" r="2" fill="${color}">
      <animate attributeName="opacity" values="1;.3;1" dur="1.6s" repeatCount="indefinite"/>
    </circle>
  </svg>`;
}

/**
 * Iscrtaj 4 domeni kartice iznova (zove updateDashboard).
 * Svaka kartica: kratko ime + dostupnost% + opis + sparkline + broj alarma.
 * Klik na karticu → toggleDomainFilter (filter tablice + drawer domena).
 * Ako domen ima alarme dobija klasu has-critical → CSS "munja" flicker.
 */
/**
 * Iscrtaj 4 domeni kartice iznova (zove updateDashboard).
 * Svaka kartica: kratko ime + dostupnost% + opis + sparkline + broj alarma.
 * Klik na karticu → toggleDomainFilter (filter tablice + drawer domena).
 * Ako domen ima alarme dobija klasu has-critical → CSS "munja" flicker.
 */
function renderDomainCards(): void {
  const grid = document.getElementById('domainGrid');
  if (!grid) return;
  grid.replaceChildren();

  const stats = computeDomainStats();
  pushDomainHistory(stats);

  stats.forEach(stat => {
    const meta = DOMAIN_META[stat.id];
    const card = document.createElement('article');
    card.className = 'domain-card' + (activeDomainFilter === stat.id ? ' active' : '') + (stat.alarms ? ' has-critical' : '');
    card.style.setProperty('--dc', meta.color);
    card.dataset.domain = stat.id;

    const availText = stat.elements ? `${stat.availability.toFixed(1)}%` : '—';
    card.innerHTML = `
      <div class="domain-top">
        <span class="domain-name">${meta.shortName}</span>
        <span class="domain-avail ${availClass(stat.availability)}">${availText}</span>
      </div>
      <div class="domain-mid">
        <span class="domain-desc">${meta.description}</span>
        ${sparklineSvg(domainHistory[stat.id], meta.color)}
      </div>
      <div class="domain-meta-row">
        <span>${stat.elements} elem.</span>
        <span class="${stat.alarms ? 'kpi-bad' : ''}">${stat.alarms} alarm</span>
      </div>`;

    card.addEventListener('click', () => toggleDomainFilter(stat.id));
    grid.appendChild(card);
  });
}

/** Sinhronizuj active klasu na sidebar stavkama (Dashboard ili neki domen). */
function syncDomainNav(): void {
  document.querySelectorAll<HTMLButtonElement>('.nav-item').forEach(btn => {
    const nav = btn.dataset.nav ?? '';
    const isActive = nav === 'overview'
      ? activeDomainFilter === null
      : nav === `domain-${activeDomainFilter}`;
    btn.classList.toggle('active', isActive);
  });
}

/**
 * Uključi/isključi domen filter (klik na istu karticu = isključi).
 * Menja: sidebar highlight, kartice, tabelu; otvara drawer domena.
 */
function toggleDomainFilter(d: NetworkDomain): void {
  activeDomainFilter = activeDomainFilter === d ? null : d;
  syncDomainNav();
  renderDomainCards();
  updateTable();
  if (activeDomainFilter) openDomainDrawer(activeDomainFilter);
}

// ============================================================================
// KPI SCORECARD — profesionalna tabla sa SVIM praćenim KPI-jima
//
// 9 metrika po mrežnom proseku: 6 direktnih + 2 izvedena (Call Setup SR,
// Retainability) + Erlang. Svaka kartica: vrednost, SLA cilj, delta ↑↓
// u odnosu na prethodni snapshot i sparkline timeline.
// Desna kolona: Top 5 najgorih ćelija (klik → drawer ćelije).
// ============================================================================

/** Definicija jednog KPI-ja koji scorecard prati. */
interface KpiDef {
  id: string;              // ključ za historiju/deltu
  name: string;            // ime za prikaz
  unit: string;            // jedinica (%, Erl)
  target: number;          // SLA cilj
  higherIsBetter: boolean; // da li je veća vrednost bolja
  compute: (cells: KpiCell[]) => number; // kako se računa mrežni prosek
}

/** Prosek niza (NaN ako je prazan). */
const avgOf = (xs: number[]): number =>
  xs.length ? xs.reduce((a, b) => a + b, 0) / xs.length : NaN;

/** Definicije svih 9 praćenih KPI-jeva. Izvedeni: CSSR = 100−AF, Retainability = 100−Drop. */
const KPI_DEFS: KpiDef[] = [
  { id: 'af',       name: 'Access Fail Rate', unit: '%',   target: SLA.accessFailRate,  higherIsBetter: false, compute: cs => avgOf(cs.map(c => c.volteAccessFailureRate)) },
  { id: 'drop',     name: 'Drop Rate',        unit: '%',   target: SLA.dropRate,        higherIsBetter: false, compute: cs => avgOf(cs.map(c => c.volteDropRate)) },
  { id: 'integ',    name: 'Cell Integrity',   unit: '%',   target: SLA.cellIntegrity,   higherIsBetter: true,  compute: cs => avgOf(cs.map(c => c.volteCellIntegrity)) },
  { id: 'cssr',     name: 'Call Setup SR',    unit: '%',   target: 98,                  higherIsBetter: true,  compute: cs => 100 - avgOf(cs.map(c => c.volteAccessFailureRate)) },
  { id: 'retain',   name: 'Retainability',    unit: '%',   target: 98.5,                higherIsBetter: true,  compute: cs => 100 - avgOf(cs.map(c => c.volteDropRate)) },
  { id: 'mobility', name: 'Mobility SR',      unit: '%',   target: 97,                  higherIsBetter: true,  compute: cs => avgOf(cs.map(c => c.volteMobilitySR)) },
  { id: 'pdcch',    name: 'PDCCH Error',      unit: '%',   target: SLA.pdcchError,      higherIsBetter: false, compute: cs => avgOf(cs.map(c => c.pdcchErrorRateVolte)) },
  { id: 'erlang',   name: 'Erlang / Sektor',  unit: 'Erl', target: SLA.erlangPerSector, higherIsBetter: false, compute: cs => avgOf(cs.map(c => c.volteErlang)) },
];

/** Rolling timeline po KPI-ju (max 24 vrednosti) — hrani sparkline u tile-u. */
const kpiHistory: Record<string, number[]> = {};
/** Vrednosti iz prethodnog snapshot-a — za delte ↑↓ u scorecard-u. */
const prevScorecard: Record<string, number> = {};

/**
 * Iscrtaj KPI Scorecard (zove updateDashboard posle svakog snapshot-a).
 * Levo: grid od 9 KPI tile-ova. Desno: Top 5 najgorih ćelija po drop rate-u
 * (klikabilne → openCellDrawer preko data-cell delegata).
 */
function renderKpiScorecard(): void {
  const section = document.getElementById('kpiScorecard');
  if (!section) return;
  const cells = kpiData.map(normalizeCell);

  const tiles = KPI_DEFS.map(def => {
    const value = def.compute(cells);

    // historija za sparkline (samo validne vrednosti)
    kpiHistory[def.id] = kpiHistory[def.id] ?? [];
    if (Number.isFinite(value)) {
      kpiHistory[def.id].push(Number(value.toFixed(2)));
      if (kpiHistory[def.id].length > 24) kpiHistory[def.id].shift();
    }

    // boja po SLA: dobar prag = target, loš prag = 2× target (ili target−2 kod "više je bolje")
    const cls = getKpiClass(value, def.target, def.higherIsBetter ? def.target - 2 : def.target * 2, def.higherIsBetter) ?? '';
    const hex = statusHex(cls.replace('kpi-', '').toUpperCase());

    // delta u odnosu na prethodni snapshot
    const prev = prevScorecard[def.id];
    const diff = prev === undefined || !Number.isFinite(value) ? null : value - prev;
    const deltaHtml = diff === null || Math.abs(diff) < 0.005
      ? ''
      : `<span class="score-delta ${(def.higherIsBetter ? diff > 0 : diff < 0) ? 'positive' : 'negative'}">${diff > 0 ? '+' : ''}${diff.toFixed(2)}</span>`;
    prevScorecard[def.id] = value;

    const hist = kpiHistory[def.id];
    const spark = sparklineSvg(hist.length > 1 ? hist : [Number.isFinite(value) ? value : 100, Number.isFinite(value) ? value : 100], hex);

    return `<div class="score-tile" style="--sc:${hex}">
      <div class="score-top"><span class="k-name">${def.name}</span>${deltaHtml}</div>
      <div class="score-mid">
        <span class="k-val ${cls}">${Number.isFinite(value) ? value.toFixed(2) : '—'}<span class="k-unit">${def.unit}</span></span>
        ${spark}
      </div>
      <div class="k-target">SLA: ${def.higherIsBetter ? '&ge;' : '&le;'} ${def.target}${def.unit === '%' ? '%' : ''}</div>
    </div>`;
  }).join('');

  // Top 5 najgorih ćelija po drop rate-u (klik → drawer)
  const worst = [...cells].sort((a, b) => b.volteDropRate - a.volteDropRate).slice(0, 5);
  const worstRows = worst.map(c => listRow(
    `data-cell="${esc(c.celija)}"`, '',
    esc(c.celija), esc(c.stanica),
    `${c.volteDropRate.toFixed(2)}%`,
    getCellStatus(c)
  )).join('');

  section.innerHTML = `
    <div class="scorecard-head">
      <h3>KPI Scorecard — mrežni prosek</h3>
      <span class="scorecard-sub">${cells.length} ćelija &middot; SLA pragovi iz konfiguracije</span>
    </div>
    <div class="scorecard-layout">
      <div class="scorecard-grid">${tiles}</div>
      <div class="worst-cells">
        <div class="drawer-section-title">Top 5 najgorih ćelija (drop rate)</div>
        ${worstRows || '<div class="alarm-empty">Nema podataka</div>'}
      </div>
    </div>`;
}

// ============================================================================
// DETAIL DRAWER — desni panel sa detaljima (ćelija / stanica / okrug / domen)
//
// Jedan generički drawer, 4 renderera koji pune njegov sadržaj HTML-om:
//   openCellDrawer    ← klik na red tablice ili ćeliju u nekom drawer-u
//   openStationDrawer ← klik na marker na mapi ili stanicu u drawer-u
//   openRegionDrawer  ← klik na okrug na mapi
//   openDomainDrawer  ← klik na domeni karticu ili sidebar stavku
// Zatvaranje: × dugme, ESC, klik na backdrop (sve veže setupEventListeners).
// ============================================================================

// Pristup DOM elementima drawera (funkcije da ne traže pre nego što treba)
const drawerEl = (): HTMLElement | null => document.getElementById('detailDrawer');
const drawerBodyEl = (): HTMLElement | null => document.getElementById('drawerBody');

/** Escapuje tekst pre ubacivanja u HTML (zaštita od XSS iz podataka). */
function esc(v: unknown): string {
  return String(v ?? '').replace(/[&<>"']/g, ch =>
    ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[ch] as string)
  );
}

/** Otvori drawer: naslov + podnaslov + akcentna boja; skroluje sadržaj na vrh. */
function openDrawer(title: string, subtitleHtml: string, accent?: string): void {
  const d = drawerEl();
  if (!d) return;
  d.classList.add('open');
  d.setAttribute('aria-hidden', 'false');
  document.getElementById('drawerBackdrop')?.classList.add('show');
  const t = document.getElementById('drawerTitle');
  if (t) { t.textContent = title; t.style.color = accent ?? ''; }
  const s = document.getElementById('drawerSubtitle');
  if (s) s.innerHTML = subtitleHtml;
  drawerBodyEl()?.scrollTo({ top: 0 });
}

/** Zatvori drawer i skini backdrop. */
function closeDrawer(): void {
  drawerEl()?.classList.remove('open');
  drawerEl()?.setAttribute('aria-hidden', 'true');
  document.getElementById('drawerBackdrop')?.classList.remove('show');
}

/** HTML jedne metrike (kvadratić sa labelom i vrednošću) u drawer-u. */
function metricTile(k: string, v: string, cls = ''): string {
  return `<div class="metric-tile"><span class="metric-k">${esc(k)}</span><span class="metric-v ${cls}">${v}</span></div>`;
}

/**
 * Red sa progress bar-om: vrednost vs SLA prag.
 * Širina bara = vrednost / (2× prag), boja po getKpiClass.
 */
function meterRow(label: string, value: number, slaValue: number, higherIsBetter: boolean): string {
  const cls = getKpiClass(value, slaValue, higherIsBetter ? slaValue - 2 : slaValue * 2, higherIsBetter) ?? '';
  const span = higherIsBetter ? Math.max(slaValue, 100.01) : slaValue * 2;
  const width = Math.max(2, Math.min(100, (value / span) * 100));
  return `
    <div class="meter-row">
      <div class="meter-label"><span>${esc(label)}</span><span class="${cls}">${value.toFixed(2)}%</span></div>
      <div class="meter"><i style="width:${width.toFixed(1)}%;background:${statusHex(cls.replace('kpi-', '').toUpperCase())}"></i></div>
    </div>`;
}

/**
 * Klikabilan red u drawer listi (ćelija / stanica / link).
 * dataAttr sadrži data-cell ili data-station-drawer — preko njega
 * delegirani klik zna šta da otvori dalje (drill-down lanac).
 */
function listRow(dataAttr: string, key: string, main: string, sub: string, value: string, st: string): string {
  return `
    <div class="list-row" ${dataAttr}>
      <span class="status-dot ${st.toLowerCase()}"></span>
      <span class="list-texts"><span class="list-main">${main}</span><span class="list-sub">${sub}</span></span>
      <span class="list-value ${st === 'BAD' ? 'kpi-bad' : st === 'WARNING' ? 'kpi-warning' : ''}">${value}</span>
      ${key}
    </div>`;
}

/** DRAWER 1: Detalji jedne ĆELIJE — status badge, 3 meter-a vs SLA, svih 12 KPI-ja. */
function openCellDrawer(cell: KpiCell): void {
  const body = drawerBodyEl();
  if (!body) return;
  const st = getCellStatus(cell);
  const badgeCls = st === 'GOOD' ? 'status-good' : st === 'WARNING' ? 'status-warning' : 'status-bad';

  body.innerHTML = `
    <div class="drawer-section">
      <span class="status-badge ${badgeCls}" style="font-size:.8rem;padding:4px 12px;">${st}</span>
    </div>

    <div class="drawer-section">
      <div class="drawer-section-title">Ključni KPI vs SLA</div>
      ${meterRow('Drop Rate', cell.volteDropRate, SLA.dropRate, false)}
      ${meterRow('Access Fail Rate', cell.volteAccessFailureRate, SLA.accessFailRate, false)}
      ${meterRow('Cell Integrity', cell.volteCellIntegrity, SLA.cellIntegrity, true)}
    </div>

    <div class="drawer-section">
      <div class="drawer-section-title">Svi pokazatelji</div>
      <div class="metric-grid">
        ${metricTile('Call Setup SR', `${(100 - cell.volteAccessFailureRate).toFixed(2)}%`, getKpiClass(100 - cell.volteAccessFailureRate, 98, 96, true) ?? '')}
        ${metricTile('Retainability', `${(100 - cell.volteDropRate).toFixed(2)}%`, getKpiClass(100 - cell.volteDropRate, 98.5, 96.5, true) ?? '')}
        ${metricTile('Erlang', cell.volteErlang.toFixed(1), cell.volteErlang > SLA.erlangPerSector ? 'kpi-warning' : '')}
        ${metricTile('Succ Calls', String(cell.volteSuccCalls))}
        ${metricTile('Mobility SR', `${cell.volteMobilitySR.toFixed(2)}%`, getKpiClass(cell.volteMobilitySR, 97, 95, true) ?? '')}
        ${metricTile('PDCCH Error', `${cell.pdcchErrorRateVolte.toFixed(2)}%`, getKpiClass(cell.pdcchErrorRateVolte, SLA.pdcchError, SLA.pdcchError * 2) ?? '')}
        ${metricTile('Drops Count', String(cell.volteDropsCount), cell.volteDropsCount > 20 ? 'kpi-bad' : '')}
        ${metricTile('Domen', DOMAIN_META[stationDomain(cell.stanica)].shortName)}
      </div>
    </div>

    <div class="drawer-section">
      <div class="drawer-section-title">QCI nosioci (IMS)</div>
      <div class="metric-grid">
        ${cell.volteQci1InitSuccRate != null ? metricTile('QCI-1 Init SR', `${cell.volteQci1InitSuccRate.toFixed(2)}%`, getKpiClass(cell.volteQci1InitSuccRate, 98, 95, true) ?? '') : metricTile('QCI-1 Init SR', '—')}
        ${cell.volteQci1AddSuccRate != null ? metricTile('QCI-1 Add SR', `${cell.volteQci1AddSuccRate.toFixed(2)}%`, getKpiClass(cell.volteQci1AddSuccRate, 98, 95, true) ?? '') : metricTile('QCI-1 Add SR', '—')}
        ${cell.volteQci5InitSuccRate != null ? metricTile('QCI-5 Init SR', `${cell.volteQci5InitSuccRate.toFixed(2)}%`, getKpiClass(cell.volteQci5InitSuccRate, 98, 95, true) ?? '') : metricTile('QCI-5 Init SR', '—')}
        ${cell.volteQci5AddSuccRate != null ? metricTile('QCI-5 Add SR', `${cell.volteQci5AddSuccRate.toFixed(2)}%`, getKpiClass(cell.volteQci5AddSuccRate, 98, 95, true) ?? '') : metricTile('QCI-5 Add SR', '—')}
      </div>
    </div>

    <div class="drawer-section">
      <div class="drawer-section-title">Lokacija</div>
      <div class="metric-grid">
        ${metricTile('Stanica', esc(cell.stanica))}
        ${metricTile('Klaster', esc(cell.klaster))}
      </div>
    </div>`;

  openDrawer(cell.celija, `${esc(cell.klaster)} &middot; ${esc(cell.stanica)} &middot; ${esc(cell.band)} MHz`);
}

/** Najgori status u grupi ćelija (stanice/okruga/domene) — lanac najslabije karike. */
function worstCellStatus(cells: KpiCell[]): string {
  let worst = 'UNKNOWN';
  for (const c of cells) {
    const s = getCellStatus(c);
    if (s === 'BAD') return 'BAD';
    if (s === 'WARNING') worst = 'WARNING';
    else if (s === 'GOOD' && worst === 'UNKNOWN') worst = 'GOOD';
  }
  return worst;
}

/** DRAWER 2: Detalji STANICE — status, koordinate, prosek KPI, lista njenih ćelija (klikabilna). */
function openStationDrawer(stationId: string): void {
  const station = NETWORK_STATIONS.find(s => s.id === stationId);
  const body = drawerBodyEl();
  if (!station || !body) return;

  const cells = kpiData.map(normalizeCell).filter(c => c.stanica === stationId);
  const worst = worstCellStatus(cells);
  const avgDrop = cells.length ? cells.reduce((a, c) => a + c.volteDropRate, 0) / cells.length : 0;
  const avgIntegrity = cells.length ? cells.reduce((a, c) => a + c.volteCellIntegrity, 0) / cells.length : 0;
  const domain = DOMAIN_META[stationDomain(stationId)];

  const rows = cells.map(c => listRow(
    `data-cell="${esc(c.celija)}"`, '',
    esc(c.celija), `Band ${esc(c.band)} MHz`,
    `${c.volteDropRate.toFixed(2)}%`,
    getCellStatus(c)
  )).join('');

  body.innerHTML = `
    <div class="drawer-section">
      <span class="status-badge ${worst === 'GOOD' ? 'status-good' : worst === 'WARNING' ? 'status-warning' : worst === 'BAD' ? 'status-bad' : ''}" style="font-size:.8rem;padding:4px 12px;">${worst}</span>
    </div>
    <div class="drawer-section">
      <div class="drawer-section-title">Stanica</div>
      <div class="metric-grid">
        ${metricTile('Koordinata', `${station.lat.toFixed(3)}, ${station.lon.toFixed(3)}`)}
        ${metricTile('Klaster', esc(station.cluster))}
        ${metricTile('Ćelija', String(cells.length))}
        ${metricTile('Domen', domain.shortName)}
      </div>
    </div>
    <div class="drawer-section">
      <div class="drawer-section-title">Prosečni KPI</div>
      <div class="metric-grid">
        ${metricTile('Drop Rate', `${avgDrop.toFixed(2)}%`, getKpiClass(avgDrop, SLA.dropRate, SLA.dropRate * 2) ?? '')}
        ${metricTile('Cell Integrity', `${avgIntegrity.toFixed(2)}%`, getKpiClass(avgIntegrity, SLA.cellIntegrity, SLA.cellIntegrity - 2, true) ?? '')}
      </div>
    </div>
    <div class="drawer-section">
      <div class="drawer-section-title">Ćelije (${cells.length})</div>
      ${rows || '<div class="alarm-empty">Nema podataka za ovu stanicu</div>'}
    </div>`;

  openDrawer(station.name, `${esc(station.id)} &middot; ${esc(station.cluster)} &middot; okrug ${esc(DISTRICT_META[station.region]?.name ?? station.region)}`, domain.color);
}

/** DRAWER 3: Detalji OKRUGA — dostupnost okruga + sve stanice u njemu (klikabilne). */
function openRegionDrawer(regionId: string): void {
  const body = drawerBodyEl();
  if (!body) return;
  const meta = DISTRICT_META[regionId];
  const stations = NETWORK_STATIONS.filter(s => s.region === regionId);
  const ids = new Set(stations.map(s => s.id));
  const cells = kpiData.map(normalizeCell).filter(c => ids.has(c.stanica));
  const compliant = cells.filter(cellCompliant).length;
  const availability = cells.length ? (compliant / cells.length) * 100 : 100;

  const rows = stations.map(st => {
    const scells = kpiData.filter(c => c.stanica === st.id);
    const w = worstCellStatus(scells);
    return listRow(
      `data-station-drawer="${esc(st.id)}"`, '',
      esc(st.name), `${esc(st.cluster)} · ${scells.length} ěelija`,
      scells.length ? `${scells.filter(cellCompliant).length}/${scells.length}` : '—',
      w
    );
  }).join('');

  body.innerHTML = `
    <div class="drawer-section">
      <div class="metric-grid">
        ${metricTile('Dostupnost', cells.length ? `${availability.toFixed(1)}%` : '—', availClass(availability))}
        ${metricTile('Stanica', String(stations.length))}
        ${metricTile('Ćelija', String(cells.length))}
        ${metricTile('Alarms', String(cells.filter(c => getCellStatus(c) === 'BAD').length), cells.some(c => getCellStatus(c) === 'BAD') ? 'kpi-bad' : '')}
      </div>
    </div>
    <div class="drawer-section">
      <div class="drawer-section-title">Bazne stanice u okrugu (${stations.length})</div>
      ${rows || '<div class="alarm-empty">Nema stanica u ovom okrugu</div>'}
    </div>`;

  openDrawer(meta?.name ?? regionId, `${esc(meta?.centerCity ?? '')} &middot; ${esc(meta?.macroRegion ?? '')}`, '#38bdf8');
}

/**
 * DRAWER 4: Detalji DOMENA.
 *  - transport → spisak SVIH linkova sa statusima (iz network-map modula)
 *  - ostali    → 6 najgorih ćelija po drop rate-u (klikabilne → ćelija drawer)
 */
function openDomainDrawer(domainId: NetworkDomain): void {
  const body = drawerBodyEl();
  if (!body) return;
  const meta = DOMAIN_META[domainId];
  const stat = computeDomainStats().find(s => s.id === domainId);

  let detailSection = '';
  if (domainId === 'transport') {
    const statuses = networkMapModule?.getLinkStatuses?.() ?? {};
    const rows = NETWORK_LINKS.map(l => {
      const from = NETWORK_STATIONS.find(s => s.id === l.from);
      const to = NETWORK_STATIONS.find(s => s.id === l.to);
      const st = statuses[`${l.from}->${l.to}`] ?? 'UNKNOWN';
      return listRow('', '', `${esc(from?.name ?? l.from)} &harr; ${esc(to?.name ?? l.to)}`,
        `${esc(l.type.toUpperCase())}${l.label ? ' · ' + esc(l.label) : ''}`,
        st === 'UNKNOWN' ? '—' : st, st);
    }).join('');
    detailSection = `<div class="drawer-section"><div class="drawer-section-title">Linkovi (${NETWORK_LINKS.length})</div>${rows}</div>`;
  } else {
    const inDomain = kpiData.map(normalizeCell).filter(c =>
      domainId === 'core' ? CORE_HUB_STATIONS.has(c.stanica) : true
    );
    const worst = [...inDomain].sort((a, b) => b.volteDropRate - a.volteDropRate).slice(0, 6);
    const rows = worst.map(c => listRow(
      `data-cell="${esc(c.celija)}"`, '',
      esc(c.celija), `${esc(c.stanica)} · ${esc(c.klaster)}`,
      `${c.volteDropRate.toFixed(2)}%`,
      getCellStatus(c)
    )).join('');
    detailSection = `<div class="drawer-section"><div class="drawer-section-title">Najgoré ćelije po drop rate-u</div>${rows}</div>`;
  }

  body.innerHTML = `
    <div class="drawer-section">
      <div class="metric-grid">
        ${metricTile('Dostupnost', stat && stat.elements ? `${stat.availability.toFixed(1)}%` : '—', availClass(stat?.availability ?? NaN))}
        ${metricTile('Elementa', String(stat?.elements ?? 0))}
        ${metricTile('Alarmi', String(stat?.alarms ?? 0), stat?.alarms ? 'kpi-bad' : '')}
      </div>
    </div>
    ${detailSection}`;

  openDrawer(meta.name, esc(meta.description), meta.color);
}

/**
 * RUTER SIDEBAR NAVIGACIJE — poziva je klik na bilo koju .nav-item stavku.
 *  overview  → reset domena + scroll na vrh
 *  map       → skrol do mape
 *  alarms    → uključi "samo kritično" + skrol do NOC panela
 *  sla       → skrol do SLA sekcije
 *  domain-X  → toggle filter domena X + skrol do kartica
 * Na kraju uvek zatvori mobilni sidebar.
 */
function handleNavAction(action: string): void {
  if (action === 'overview') {
    activeDomainFilter = null;
    syncDomainNav();
    renderDomainCards();
    updateTable();
    window.scrollTo({ top: 0, behavior: 'smooth' });
  } else if (action === 'map') {
    document.getElementById('mapSection')?.scrollIntoView({ behavior: 'smooth' });
  } else if (action === 'alarms') {
    showOnlyCritical = true;
    document.getElementById('toggleBadBtn')?.classList.add('active');
    updateTable();
    document.querySelector('.noc-panel')?.scrollIntoView({ behavior: 'smooth' });
  } else if (action === 'sla') {
    document.querySelector('.noc-sla')?.scrollIntoView({ behavior: 'smooth' });
  } else if (action.startsWith('domain-')) {
    toggleDomainFilter(action.slice(7) as NetworkDomain);
    document.getElementById('domainGrid')?.scrollIntoView({ behavior: 'smooth', block: 'nearest' });
  }
  // Na mobilnom zatvori sidebar nakon izbora
  document.getElementById('appShell')?.classList.remove('sidebar-open');
}

/** Gornjih 5 KPI kartica: vrednosti + delte ↑↓ u odnosu na prethodni snapshot. */
function updateSummaryCards(curr: KpiMetrics | null): void {
  if (!curr) return;
  
  setText('totalCells', kpiData.length);
  setText('avgDropRate', formatPercent(curr.dropRate));
  setText('avgAccessFailRate', formatPercent(curr.accessFailRate));
  setText('avgCellIntegrity', formatPercent(curr.cellIntegrity));
  setText('totalErlang', curr.erlang.toFixed(1));
  
  updateDelta('deltaDropRate', curr.dropRate, prevMetrics?.dropRate, true);
  updateDelta('deltaAccessFailRate', curr.accessFailRate, prevMetrics?.accessFailRate, true);
  updateDelta('deltaCellIntegrity', curr.cellIntegrity, prevMetrics?.cellIntegrity, false);
  updateDelta('deltaErlang', curr.erlang, prevMetrics?.erlang, false);
}

/** Primeni payload sa SSE stream-a (isti oblik kao API odgovor) → updateDashboard. */
function applyKpiPayload(payload: ApiResponse): void {
  const rows = Array.isArray(payload) ? payload : payload.data;
  if (!Array.isArray(rows)) return;
  kpiData = rows as KpiCell[];
  updateDashboard();
}

/**
 * Pokreni automatsko osvežavanje: PREFERIRA SSE (live push svakih ~30s),
 * a ako SSE nije moguć → klasičan polling na AUTO_REFRESH_INTERVAL (5 min).
 */
function startAutoRefresh(): void {
  stopAutoRefresh();
  
  if (CONFIG.USE_SSE && typeof EventSource !== 'undefined') {
    connectSse();
    return;
  }
  
  autoRefreshInterval = window.setInterval(() => {
    loadData();
  }, CONFIG.AUTO_REFRESH_INTERVAL);
}

/**
 * Otvori SSE (Server-Sent Events) vezu sa backend-om — LIVE režim.
 * Backend svakih SSE_PUSH_INTERVAL sekundi gura 'kpis' event sa punim
 * snapshot-om → mi ga primenimo kroz applyKpiPayload.
 * 'error' event ne ruši ništa — browser SAM pokušava reconnect.
 */
function connectSse(): void {
  disconnectSse();
  
  const hours = getSelectedHours();
  const url = `${CONFIG.API_BASE_URL}/api/kpis/stream?hours=${encodeURIComponent(hours.toString())}&interval=${CONFIG.SSE_PUSH_INTERVAL}`;
  console.log(`Opening SSE stream: ${url}`);
  
  const source = new EventSource(url);
  sseSource = source;
  
  source.addEventListener('kpis', (event) => {
    try {
      const payload = JSON.parse((event as MessageEvent).data) as ApiResponse;
      prevMetrics = computeMetrics(kpiData.length ? kpiData : null);
      applyKpiPayload(payload);
      updateLastUpdated();
      setLiveBadge('live');
    } catch (error) {
      console.error('Error handling SSE kpis event:', error);
    }
  });
  
  source.addEventListener('open', () => {
    setLiveBadge('live');
  });
  
  source.addEventListener('error', (event) => {
    console.warn('SSE stream error, will retry automatically:', event);
    setLiveBadge('bad');
  });
}

/** Zatvori SSE vezu ako je otvorena (pre ponovnog povezivanja / gašenja). */
function disconnectSse(): void {
  if (sseSource) {
    sseSource.close();
    sseSource = null;
  }
}

/** Zaustavi SVE automatsko osvežavanje (SSE + polling timer). */
function stopAutoRefresh(): void {
  disconnectSse();
  if (autoRefreshInterval) {
    clearInterval(autoRefreshInterval);
    autoRefreshInterval = null;
  }
}

// ============================================================================
// UX POMOĆNICI — tema, toast notifikacije, LIVE badge, lenjo učitavanje mape
// ============================================================================

const THEME_KEY = 'volte-theme'; // ključ u localStorage gde se čuva izbor teme

/** Početna tema: prvo sačuvan izbor, pa env varijabla, pa podešavanje OS-a. */
function getInitialTheme(): 'dark' | 'light' {
  try {
    const saved = localStorage.getItem(THEME_KEY);
    if (saved === 'dark' || saved === 'light') return saved;
  } catch { /* localStorage unavailable */ }
  const env = (metaEnv.VITE_THEME as string) || 'system';
  if (env === 'dark' || env === 'light') return env;
  if (typeof window.matchMedia === 'function' && window.matchMedia('(prefers-color-scheme: light)').matches) {
    return 'light';
  }
  return 'dark';
}

/** Primeni temu na <html data-theme="..."> i promeni ikonicu dugmeta. */
function applyTheme(theme: 'dark' | 'light'): void {
  document.documentElement.dataset.theme = theme;
  const btn = document.getElementById('themeToggle');
  if (btn) btn.textContent = theme === 'light' ? '☀' : '☾';
}

/** Postavi temu pri startu (zove boot sekvenca u DOMContentLoaded). */
function initTheme(): void {
  applyTheme(getInitialTheme());
}

/** Prebaci tamna↔svetla tema i sačuvaj izbor u localStorage. */
function toggleTheme(): void {
  const next = document.documentElement.dataset.theme === 'light' ? 'dark' : 'light';
  try {
    localStorage.setItem(THEME_KEY, next);
  } catch { /* ignore */ }
  applyTheme(next);
}

/**
 * Kratka notifikacija u donjem desnom uglu (uspeh / greška / info).
 * Samo nestaje posle `duration` ms — ne traži klik.
 */
function showToast(message: string, type: 'info' | 'error' | 'success' = 'info', duration = 3500): void {
  const container = document.getElementById('toastContainer');
  if (!container) return;
  const el = document.createElement('div');
  el.className = `toast ${type === 'info' ? '' : type}`;
  el.textContent = message;
  container.appendChild(el);
  setTimeout(() => {
    el.classList.add('hide');
    setTimeout(() => el.remove(), 400);
  }, duration);
}

/**
 * LIVE bedž u top baru: zelen (SSE radi), crven (API pao / mock podaci),
 * siv (podaci učitani jednom, bez live veze).
 */
function setLiveBadge(state: 'muted' | 'live' | 'bad'): void {
  const badge = document.getElementById('liveBadge');
  if (!badge) return;
  badge.classList.toggle('live', state === 'live');
  badge.classList.toggle('bad', state === 'bad');
}

/**
 * Update the "last updated" indicator in the toolbar
 */
function updateLastUpdated(): void {
  setText('lastUpdated', `Ažurirano: ${new Date().toLocaleTimeString('sr-RS')}`);
}

/**
 * Lazy-load the network map module (Leaflet + GeoJSON) on first use so it
 * does not block initial paint of the dashboard.
 */
async function loadNetworkMap(): Promise<void> {
  try {
    networkMapModule = await import('./network-map');
    networkMapModule.initNetworkMap?.('networkMap');
    if (kpiData.length) networkMapModule.updateNetworkMap?.(kpiData);
  } catch (error) {
    console.error('Failed to load network map module:', error);
    showToast('Mrežna mapa se nije učitana', 'error');
  }
}

// ============================================================================
// CSV EXPORT — preuzmi sve ćelije kao Excel-kompatibilan fajl
// ============================================================================

/** Escapuj jednu vrednost za CSV (zarez, navodnik, novi red → pod navodnike). */
function escapeCsvField(value: any): string {
  const text = String(value ?? '');
  if (/[",\r\n]/.test(text)) {
    return `"${text.replace(/"/g, '""')}"`;
  }
  return text;
}

/**
 * Skini sve KPI podatke kao CSV (dugme "Export CSV" ili Ctrl+E).
 * \uFEFF na početku = BOM marker da Excel pravilno otvori UTF-8 znakove.
 */
function exportCSV(): void {
  const headers = ['Klaster', 'Stanica', 'Celija', 'Band', 'AccessFailRate', 'DropRate',
    'CellIntegrity', 'Erlang', 'SuccCalls', 'MobilitySR', 'PDCCHError', 'DropsCount', 'Status'];
  
  const rows = kpiData.map(c => [
    c.klaster,
    c.stanica,
    c.celija,
    c.band,
    c.volteAccessFailureRate.toFixed(2),
    c.volteDropRate.toFixed(2),
    c.volteCellIntegrity.toFixed(2),
    c.volteErlang.toFixed(1),
    c.volteSuccCalls,
    c.volteMobilitySR.toFixed(2),
    c.pdcchErrorRateVolte.toFixed(2),
    c.volteDropsCount,
    getCellStatus(c)
  ]);
  
  const csv = [headers, ...rows].map(row => row.map(escapeCsvField).join(',')).join('\n');
  const blob = new Blob(['\uFEFF' + csv], { type: 'text/csv;charset=utf-8;' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = `volte_kpi_${new Date().toISOString().slice(0, 10)}.csv`;
  a.click();
  URL.revokeObjectURL(url);
}

// ============================================================================
// EVENT LISTENERI — ovde se vežu SVI klikovi/tastatura (zove boot sekvenca)
// ============================================================================

/**
 * Poveži sav interfejs sa logikom. Deli se na blokove:
 *  1. Toolbar (Refresh, vremenski opseg, pretraga, filteri, tema, CSV, zvuk)
 *  2. Sidebar navigacija + mobilni hamburger
 *  3. Detail drawer (zatvaranje + delegirani klikovi za drill-down)
 *  4. Tabela (klik na red → drawer ćelije)
 *  5. Eventi sa mape (noc:station-click / noc:region-click)
 *  6. Tastatura (Ctrl+R refresh, Ctrl+E export, ESC zatvara drawer/sidebar)
 */
function setupEventListeners(): void {
  const refreshBtn = document.getElementById('refreshBtn');
  const timeRange = document.getElementById('timeRange') as HTMLSelectElement;
  const exportCsvBtn = document.getElementById('exportCsvBtn');
  const themeToggle = document.getElementById('themeToggle');
  const tableSearchInput = document.getElementById('tableSearch') as HTMLInputElement;
  const toggleBadBtn = document.getElementById('toggleBadBtn');
  
  if (refreshBtn) {
    refreshBtn.addEventListener('click', () => loadData());
  }
  
  if (timeRange) {
    timeRange.addEventListener('change', () => {
      if (sseSource) {
        connectSse();
      } else {
        loadData();
      }
    });
  }
  
  if (tableSearchInput) {
    tableSearchInput.addEventListener('input', () => {
      if (searchTimer) clearTimeout(searchTimer);
      searchTimer = window.setTimeout(() => {
        tableSearch = tableSearchInput.value;
        updateTable();
      }, 200);
    });
  }
  
  if (toggleBadBtn) {
    toggleBadBtn.addEventListener('click', () => {
      showOnlyCritical = !showOnlyCritical;
      toggleBadBtn.classList.toggle('active', showOnlyCritical);
      updateTable();
    });
  }
  
  if (themeToggle) {
    themeToggle.addEventListener('click', () => {
      toggleTheme();
      showToast(themeToggle.textContent === '☾' ? 'Tamna tema' : 'Svetla tema', 'success', 1200);
    });
  }
  
  if (exportCsvBtn) {
    exportCsvBtn.addEventListener('click', exportCSV);
  }

  // Sound toggle for alarm notifications
  const soundToggleBtn = document.getElementById('soundToggle');
  if (soundToggleBtn) {
    soundToggleBtn.addEventListener('click', () => {
      soundEnabled = !soundEnabled;
      soundToggleBtn.textContent = soundEnabled ? '🔊' : '🔇';
      soundToggleBtn.classList.toggle('active', soundEnabled);
      showToast(soundEnabled ? 'Alarm sound enabled' : 'Alarm sound muted', 'success', 1200);
    });
  }

  // ── Sidebar navigacija ──
  document.querySelectorAll<HTMLButtonElement>('.nav-item').forEach(btn => {
    btn.addEventListener('click', () => handleNavAction(btn.dataset.nav ?? ''));
  });
  document.getElementById('sidebarToggle')?.addEventListener('click', () => {
    document.getElementById('appShell')?.classList.toggle('sidebar-open');
  });

  // ── Detail drawer ──
  document.getElementById('drawerClose')?.addEventListener('click', closeDrawer);
  document.getElementById('drawerBackdrop')?.addEventListener('click', closeDrawer);
  drawerBodyEl()?.addEventListener('click', (e) => {
    const target = e.target as HTMLElement;
    const cellEl = target.closest<HTMLElement>('[data-cell]');
    if (cellEl?.dataset.cell) {
      const cell = kpiData.find(c => c.celija === cellEl.dataset.cell);
      if (cell) { openCellDrawer(normalizeCell(cell)); return; }
    }
    const stationEl = target.closest<HTMLElement>('[data-station-drawer]');
    if (stationEl?.dataset.stationDrawer) openStationDrawer(stationEl.dataset.stationDrawer);
  });

  // Klik na red tablice → drawer sa detaljima te ćelije
  document.getElementById('tableBody')?.addEventListener('click', (e) => {
    const row = (e.target as HTMLElement).closest<HTMLTableRowElement>('tr[data-celija]');
    if (!row?.dataset.celija) return;
    const cell = kpiData.find(c => c.celija === row.dataset.celija);
    if (cell) openCellDrawer(normalizeCell(cell));
  });

  // Klik na ćeliju u KPI Scorecard "Top 5 najgorih" → drawer te ćelije
  document.getElementById('kpiScorecard')?.addEventListener('click', (e) => {
    const el = (e.target as HTMLElement).closest<HTMLElement>('[data-cell]');
    if (!el?.dataset.cell) return;
    const cell = kpiData.find(c => c.celija === el.dataset.cell);
    if (cell) openCellDrawer(normalizeCell(cell));
  });

  // Eventi iz mape (network-map modul) → otvaranje drawera
  window.addEventListener('noc:station-click', (e) => {
    const detail = (e as CustomEvent<{ stationId?: string }>).detail;
    if (detail?.stationId) openStationDrawer(detail.stationId);
  });
  window.addEventListener('noc:region-click', (e) => {
    const detail = (e as CustomEvent<{ regionId?: string }>).detail;
    if (detail?.regionId) openRegionDrawer(detail.regionId);
  });
  
  // Keyboard shortcuts
  document.addEventListener('keydown', (e) => {
    if (e.key === 'r' && (e.ctrlKey || e.metaKey)) {
      e.preventDefault();
      loadData();
    }
    if (e.key === 'e' && (e.ctrlKey || e.metaKey)) {
      e.preventDefault();
      exportCSV();
    }
    if (e.key === 'Escape') {
      closeDrawer();
      document.getElementById('appShell')?.classList.remove('sidebar-open');
    }
  });
}

// ============================================================================
// INICIJALIZACIJA — BOOT SEKVENCA (ulazna tačka cele aplikacije)
// ============================================================================

/**
 * Pokreće se kad je DOM spreman. Redosled je bitan:
 *  1. setupEventListeners() — sve interakcije vezane PRE prvog rendera
 *  2. initTheme()           — tema pre iscrtavanja (bez treperenja)
 *  3. loadData()            — prvi podaci (API ili mock) → updateDashboard
 *  4. startAutoRefresh()    — SSE live stream (ili polling)
 *  5. loadNetworkMap()      — mapa lenjo, NE blokira prvi render
 *  6. uptime tajmer         — NOC brojač na svaku sekundu
 */
document.addEventListener('DOMContentLoaded', () => {
  console.log('VoLTE KPI Dashboard initialized');
  console.log(`API Base URL: ${CONFIG.API_BASE_URL}`);
  console.log(`Auto-refresh interval: ${CONFIG.AUTO_REFRESH_INTERVAL}ms`);

  setupEventListeners();
  initTheme();
  loadData();
  startAutoRefresh();
  void loadNetworkMap();

  // Update uptime counter every second
  setInterval(updateUptime, 1000);
});

/** Čišćenje pri zatvaranju stranice: prekini vezu, uništi grafikone. */
window.addEventListener('beforeunload', () => {
  stopAutoRefresh();
  Object.values(charts).forEach(chart => chart.destroy());
});

// ============================================================================
// EKSPORTI — javlja samo za testove (vitest ih importuje); app ih ne koristi
// ============================================================================

export {
  kpiData,
  charts,
  SLA,
  CONFIG,
  toNumber,
  formatPercent,
  getKpiClass,
  updateDelta,
  escapeCsvField,
  computeMetrics,
  getCellStatus,
  normalizeCell,
  generateMockData,
  fetchKpiData,
  loadData,
  updateDashboard,
  exportCSV,
  connectSse,
  disconnectSse,
  applyKpiPayload,
  initTheme,
  toggleTheme,
  getInitialTheme,
  applyTheme,
  showToast,
  setLiveBadge,
  updateLastUpdated,
  getFilteredCells,
  filterCells,
};
