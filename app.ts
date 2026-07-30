/**
 * VoLTE KPI Dashboard - Main Application
 * TypeScript implementation with improved type safety and configuration
 * 
 * @author CETIN
 * @version 1.0.0
 */

import Chart from 'chart.js/auto';
import { initNetworkMap, updateNetworkMap, NETWORK_STATIONS } from './network-map';

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
  API_BASE_URL: metaEnv.VITE_API_BASE_URL || 'http://localhost:8080',
  AUTO_REFRESH_INTERVAL: parseInt(metaEnv.VITE_AUTO_REFRESH_INTERVAL || '300000'),
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
let charts: Record<string, Chart> = {};
let autoRefreshInterval: number | null = null;
let prevMetrics: KpiMetrics | null = null;

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
function normalizeCell(cell: Partial<KpiCell>): KpiCell {
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
    status: cell.status,
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
 * Update the KPI data table
 */
function updateTable(): void {
  const tbody = document.getElementById('tableBody');
  if (!tbody) return;
  
  tbody.replaceChildren();
  
  kpiData.forEach(cell => {
    const row = document.createElement('tr');
    row.dataset.station = cell.stanica;
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
  } catch (error) {
    console.error('Error loading KPI data, using mock data:', error);
    kpiData = generateMockData(getSelectedHours());
    updateDashboard();
  }
}

/**
 * Update the entire dashboard
 */
function updateDashboard(): void {
  kpiData = kpiData.map(normalizeCell);
  const curr = computeMetrics(kpiData);
  
  updateSummaryCards(curr);
  updateTable();
  updateCharts();
  updateNetworkMap(kpiData);
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
 * Start auto-refresh
 */
function startAutoRefresh(): void {
  if (autoRefreshInterval) {
    clearInterval(autoRefreshInterval);
  }
  
  autoRefreshInterval = window.setInterval(() => {
    loadData();
  }, CONFIG.AUTO_REFRESH_INTERVAL);
}

/**
 * Stop auto-refresh
 */
function stopAutoRefresh(): void {
  if (autoRefreshInterval) {
    clearInterval(autoRefreshInterval);
    autoRefreshInterval = null;
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
  
  if (refreshBtn) {
    refreshBtn.addEventListener('click', () => loadData());
  }
  
  if (timeRange) {
    timeRange.addEventListener('change', () => loadData());
  }
  
  if (exportCsvBtn) {
    exportCsvBtn.addEventListener('click', exportCSV);
  }
  
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
  initNetworkMap('networkMap');
  loadData();
  startAutoRefresh();
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
  computeMetrics,
  getCellStatus,
  normalizeCell,
  generateMockData,
  fetchKpiData,
  loadData,
  updateDashboard,
  exportCSV,
};
