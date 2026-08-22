/**
 * VoLTE KPI Dashboard - Main Application
 * TypeScript implementation with improved type safety and configuration
 * 
 * @author CETIN
 * @version 1.0.0
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
// Types and Interfaces
// ============================================================================

interface KpiCell {
  celija: string;
  stanica: string;
  klaster: string;
  band: string;
  volteAccessFailureRate: number;
  volteDropRate: number;
  volteCellIntegrity: number;
  volteErlang: number;
  volteSuccCalls: number;
  volteMobilitySR: number;
  pdcchErrorRateVolte: number;
  volteDropsCount: number;
  volteQci1AddSuccRate?: number;
  volteQci1InitSuccRate?: number;
  volteQci5AddSuccRate?: number;
  volteQci5InitSuccRate?: number;
  status?: 'GOOD' | 'WARNING' | 'BAD';
  datetime?: string;
}

interface KpiMetrics {
  dropRate: number;
  accessFailRate: number;
  cellIntegrity: number;
  erlang: number;
}

interface SlaThresholds {
  accessFailRate: number;
  dropRate: number;
  cellIntegrity: number;
  pdcchError: number;
  erlangPerSector: number;
}

interface ApiResponse {
  success: boolean;
  data: KpiCell[];
  metrics?: KpiMetrics;
  count: number;
  timestamp: string;
}

export interface ApiError {
  success: boolean;
  error: string;
  code: number;
  details?: any;
  timestamp: string;
}

// ============================================================================
// Configuration
// ============================================================================

// Load configuration from environment variables
const metaEnv = (import.meta as any).env || {};
const CONFIG = {
  API_BASE_URL: metaEnv.VITE_API_BASE_URL ?? 'http://localhost:8080',
  AUTO_REFRESH_INTERVAL: parseInt(metaEnv.VITE_AUTO_REFRESH_INTERVAL || '300000'),
  USE_SSE: (metaEnv.VITE_SSE_ENABLED ?? 'true') === 'true',
  SSE_PUSH_INTERVAL: parseInt(metaEnv.VITE_SSE_INTERVAL || '30'),
};

// SLA Thresholds - configurable via environment or hardcoded defaults
const SLA: SlaThresholds = {
  accessFailRate: 2.0,
  dropRate: 1.5,
  cellIntegrity: 97,
  pdcchError: 3.0,
  erlangPerSector: 40,
};

// ============================================================================
// Global State
// ============================================================================

let kpiData: KpiCell[] = [];
const charts: Record<string, Chart> = {};
let autoRefreshInterval: number | null = null;
let prevMetrics: KpiMetrics | null = null;
let sseSource: EventSource | null = null;
let networkMapModule: typeof import('./network-map') | null = null;
let activeDomainFilter: NetworkDomain | null = null;

// ── NOC Monitoring State ──
let soundEnabled = false;
const nocStartTime = Date.now();
interface Alarm { id: string; severity: 'critical' | 'major'; text: string; time: Date; }
interface Incident { id: string; title: string; status: 'active' | 'investigating' | 'resolved'; time: Date; meta: string; }
let activeAlarms: Alarm[] = [];
let recentIncidents: Incident[] = [];

// ============================================================================
// Utility Functions
// ============================================================================

/**
 * Safe number conversion with fallback to 0
 */
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

/**
 * Pick a random item from an array
 */
function pick<T>(items: T[]): T {
  return items[Math.floor(Math.random() * items.length)];
}

/**
 * Get selected hours from time range select
 */
function getSelectedHours(): number {
  const select = document.getElementById('timeRange') as HTMLSelectElement;
  return Number(select?.value || 24);
}

/**
 * Normalize cell data - ensure all required fields are present
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
 * Compute aggregated metrics from KPI data
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
// Cell Status Functions
// ============================================================================

/**
 * Determine cell status based on KPI values
 */
function getCellStatus(c: KpiCell): 'GOOD' | 'WARNING' | 'BAD' {
  if (c.volteDropRate > 3 || c.volteAccessFailureRate > 5 || c.volteCellIntegrity < 95) return 'BAD';
  if (c.volteDropRate > SLA.dropRate || c.volteAccessFailureRate > SLA.accessFailRate || c.volteCellIntegrity < SLA.cellIntegrity) return 'WARNING';
  return 'GOOD';
}

/**
 * Get CSS class for KPI value based on thresholds
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
// Delta Update Functions
// ============================================================================

/**
 * Update delta display for KPI changes
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
// Table Functions
// ============================================================================

/**
 * Append a cell to a table row
 */
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
const MAX_TABLE_ROWS = 500;
let tableSearch = '';
let showOnlyCritical = false;
let searchTimer: number | null = null;

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

function getFilteredCells(): KpiCell[] {
  return filterCells(kpiData, tableSearch, showOnlyCritical);
}

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
// Chart Functions
// ============================================================================

const chartTooltip = {
  backgroundColor: '#2a2f3a',
  titleColor: '#ffffff',
  bodyColor: '#b0b8c4',
  borderColor: '#3a4050',
  borderWidth: 1,
  padding: 10,
  cornerRadius: 4,
};

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

interface ChartOptions {
  responsive?: boolean;
  maintainAspectRatio?: boolean;
  plugins?: any;
  scales?: any;
}

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

function updateCharts(): void {
  updateAccessFailChart();
  updateDropRateChart();
  updateIntegrityChart();
  updateErlangChart();
}

// ============================================================================
// Data Loading Functions
// ============================================================================

/**
 * Generate mock data for testing (fallback when API is not available)
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
 * Fetch KPI data from API
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
 * Load KPI data (with fallback to mock data)
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
 * Update the entire dashboard
 */
function updateDashboard(): void {
  kpiData = kpiData.map(normalizeCell);
  const curr = computeMetrics(kpiData);
  
  updateSummaryCards(curr);
  renderDomainCards();
  updateTable();
  updateCharts();
  networkMapModule?.updateNetworkMap?.(kpiData);
  updateNocPanel(curr);
}

// ============================================================================
// NOC Monitoring Panel
// ============================================================================

function updateNocPanel(curr: KpiMetrics | null): void {
  if (!curr) return;
  updateHealthRing(curr);
  updateSlaBar(curr);
  updateAlarms();
  updateIncidents();
  updateUptime();
}

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
// Mrežni domeni — RAN / IMS / Transport / Core
// ============================================================================

interface DomainStat {
  id: NetworkDomain;
  availability: number;
  elements: number;
  alarms: number;
}

function cellCompliant(c: KpiCell): boolean {
  return c.volteDropRate <= SLA.dropRate &&
    c.volteAccessFailureRate <= SLA.accessFailRate &&
    c.volteCellIntegrity >= SLA.cellIntegrity;
}

function statusHex(st: string): string {
  if (st === 'GOOD') return '#10b981';
  if (st === 'WARNING') return '#f59e0b';
  if (st === 'BAD') return '#ef4444';
  return '#6b7280';
}

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

function availClass(v: number): string {
  if (!Number.isFinite(v)) return 'kpi-warning';
  if (v >= 95) return 'kpi-good';
  if (v >= 85) return 'kpi-warning';
  return 'kpi-bad';
}

function renderDomainCards(): void {
  const grid = document.getElementById('domainGrid');
  if (!grid) return;
  grid.replaceChildren();

  computeDomainStats().forEach(stat => {
    const meta = DOMAIN_META[stat.id];
    const card = document.createElement('article');
    card.className = 'domain-card' + (activeDomainFilter === stat.id ? ' active' : '');
    card.style.setProperty('--dc', meta.color);
    card.dataset.domain = stat.id;

    const availText = stat.elements ? `${stat.availability.toFixed(1)}%` : '—';
    card.innerHTML = `
      <div class="domain-head">
        <span class="domain-name">${meta.shortName}</span>
        <span class="domain-avail ${availClass(stat.availability)}">${availText}</span>
      </div>
      <div class="domain-desc">${meta.description}</div>
      <div class="domain-meta-row">
        <span>${stat.elements} elem.</span>
        <span class="${stat.alarms ? 'kpi-bad' : ''}">${stat.alarms} alarma</span>
      </div>`;

    card.addEventListener('click', () => toggleDomainFilter(stat.id));
    grid.appendChild(card);
  });
}

function syncDomainNav(): void {
  document.querySelectorAll<HTMLButtonElement>('.nav-item').forEach(btn => {
    const nav = btn.dataset.nav ?? '';
    const isActive = nav === 'overview'
      ? activeDomainFilter === null
      : nav === `domain-${activeDomainFilter}`;
    btn.classList.toggle('active', isActive);
  });
}

function toggleDomainFilter(d: NetworkDomain): void {
  activeDomainFilter = activeDomainFilter === d ? null : d;
  syncDomainNav();
  renderDomainCards();
  updateTable();
  if (activeDomainFilter) openDomainDrawer(activeDomainFilter);
}

// ============================================================================
// DETAIL DRAWER — desni panel sa detaljima (ćelija / stanica / region / domen)
// ============================================================================

const drawerEl = (): HTMLElement | null => document.getElementById('detailDrawer');
const drawerBodyEl = (): HTMLElement | null => document.getElementById('drawerBody');

/** Escapuje tekst pre ubacivanja u HTML (zaštita od XSS iz podataka). */
function esc(v: unknown): string {
  return String(v ?? '').replace(/[&<>"']/g, ch =>
    ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[ch] as string)
  );
}

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

function closeDrawer(): void {
  drawerEl()?.classList.remove('open');
  drawerEl()?.setAttribute('aria-hidden', 'true');
  document.getElementById('drawerBackdrop')?.classList.remove('show');
}

function metricTile(k: string, v: string, cls = ''): string {
  return `<div class="metric-tile"><span class="metric-k">${esc(k)}</span><span class="metric-v ${cls}">${v}</span></div>`;
}

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

function listRow(dataAttr: string, key: string, main: string, sub: string, value: string, st: string): string {
  return `
    <div class="list-row" ${dataAttr}>
      <span class="status-dot ${st.toLowerCase()}"></span>
      <span class="list-texts"><span class="list-main">${main}</span><span class="list-sub">${sub}</span></span>
      <span class="list-value ${st === 'BAD' ? 'kpi-bad' : st === 'WARNING' ? 'kpi-warning' : ''}">${value}</span>
      ${key}
    </div>`;
}

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
        ${metricTile('Erlang', cell.volteErlang.toFixed(1), cell.volteErlang > SLA.erlangPerSector ? 'kpi-warning' : '')}
        ${metricTile('Succ Calls', String(cell.volteSuccCalls))}
        ${metricTile('Mobility SR', `${cell.volteMobilitySR.toFixed(2)}%`, getKpiClass(cell.volteMobilitySR, 97, 95, true) ?? '')}
        ${metricTile('PDCCH Error', `${cell.pdcchErrorRateVolte.toFixed(2)}%`, getKpiClass(cell.pdcchErrorRateVolte, SLA.pdcchError, SLA.pdcchError * 2) ?? '')}
        ${metricTile('Drops Count', String(cell.volteDropsCount), cell.volteDropsCount > 20 ? 'kpi-bad' : '')}
        ${metricTile('Domen', DOMAIN_META[stationDomain(cell.stanica)].shortName)}
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

/**
 * Update summary cards with current metrics
 */
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

/**
 * Apply a full KPI response payload to the dashboard
 */
function applyKpiPayload(payload: ApiResponse): void {
  const rows = Array.isArray(payload) ? payload : payload.data;
  if (!Array.isArray(rows)) return;
  kpiData = rows as KpiCell[];
  updateDashboard();
}

/**
 * Start auto-refresh. Prefers SSE push; falls back to polling
 * when SSE is disabled or unsupported by the browser.
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
 * Connect (or reconnect) the SSE stream for the currently selected time range
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

/**
 * Close the SSE stream if open
 */
function disconnectSse(): void {
  if (sseSource) {
    sseSource.close();
    sseSource = null;
  }
}

/**
 * Stop auto-refresh
 */
function stopAutoRefresh(): void {
  disconnectSse();
  if (autoRefreshInterval) {
    clearInterval(autoRefreshInterval);
    autoRefreshInterval = null;
  }
}

// ============================================================================
// UX Helpers (theme, toast, live badge, lazy map loading)
// ============================================================================

const THEME_KEY = 'volte-theme';

/**
 * Resolve the initial theme: saved preference, then env, then OS setting
 */
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

/**
 * Apply a theme to the document
 */
function applyTheme(theme: 'dark' | 'light'): void {
  document.documentElement.dataset.theme = theme;
  const btn = document.getElementById('themeToggle');
  if (btn) btn.textContent = theme === 'light' ? '☀' : '☾';
}

/**
 * Initialize the theme on startup
 */
function initTheme(): void {
  applyTheme(getInitialTheme());
}

/**
 * Toggle between light and dark theme (persisted)
 */
function toggleTheme(): void {
  const next = document.documentElement.dataset.theme === 'light' ? 'dark' : 'light';
  try {
    localStorage.setItem(THEME_KEY, next);
  } catch { /* ignore */ }
  applyTheme(next);
}

/**
 * Show a transient toast notification
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
 * Update the LIVE badge state
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
// CSV Export Function
// ============================================================================

/**
 * Escape CSV field value
 */
function escapeCsvField(value: any): string {
  const text = String(value ?? '');
  if (/[",\r\n]/.test(text)) {
    return `"${text.replace(/"/g, '""')}"`;
  }
  return text;
}

/**
 * Export data to CSV
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
// Event Listeners Setup
// ============================================================================

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
// Initialization
// ============================================================================

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

// Cleanup on page unload
window.addEventListener('beforeunload', () => {
  stopAutoRefresh();
  Object.values(charts).forEach(chart => chart.destroy());
});

// ============================================================================
// Exports (for testing)
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
