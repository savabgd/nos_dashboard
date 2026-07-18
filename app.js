let kpiData = [];
let charts = {};
let autoRefreshInterval = null;
let prevMetrics = null;

const API_BASE_URL = 'http://localhost:8080/api';

const SLA = {
    accessFailRate: 2.0,
    dropRate: 1.5,
    cellIntegrity: 97,
    pdcchError: 3.0,
    erlangPerSector: 40
};

document.addEventListener('DOMContentLoaded', () => {
    setupEventListeners();
    loadData();
    startAutoRefresh();
});

function setupEventListeners() {
    document.getElementById('refreshBtn').addEventListener('click', loadData);
    document.getElementById('timeRange').addEventListener('change', loadData);
    document.getElementById('exportCsvBtn').addEventListener('click', exportCSV);
}

async function loadData() {
    try {
        prevMetrics = computeMetrics(kpiData.length ? kpiData : null);
        kpiData = await fetchKpiData();
        updateDashboard();
    } catch (error) {
        console.error('Error loading KPI data:', error);
        kpiData = generateMockData(getSelectedHours());
        updateDashboard();
    }
}

async function fetchKpiData() {
    const hours = getSelectedHours();
    const response = await fetch(`${API_BASE_URL}/kpis?hours=${encodeURIComponent(hours)}`, {
        headers: { Accept: 'application/json' }
    });

    if (!response.ok) {
        throw new Error(`API returned ${response.status}`);
    }

    const payload = await response.json();
    const rows = Array.isArray(payload) ? payload : payload.data;
    if (!Array.isArray(rows)) {
        throw new Error('API response must be an array or { data: [] }');
    }
    return rows;
}

function getSelectedHours() {
    return Number(document.getElementById('timeRange').value || 24);
}

function generateMockData(hours = 24) {
    const data = [];
    const clusters = ['CENTAR_BGD', 'SEVER_BGD', 'NOVI_SAD', 'ZEMUN'];
    const stations = ['BGD_CEN_001', 'BGD_CEN_002', 'BGD_SEV_001', 'NS_001', 'ZEM_001'];
    const bands = ['800', '1800', '2100'];
    const rows = hours <= 1 ? 10 : hours <= 24 ? 20 : 35;

    for (let i = 0; i < rows; i++) {
        const cluster = pick(clusters);
        const station = pick(stations);
        const band = pick(bands);
        const cell = `${station}_${band}_${Math.floor(Math.random() * 3) + 1}`;
        const isBad = Math.random() < 0.2;

        data.push({
            celija: cell,
            stanica: station,
            klaster: cluster,
            band,
            volteAccessFailureRate: isBad ? Math.random() * 5 + 2 : Math.random() * 1.5,
            volteDropRate: isBad ? Math.random() * 4 + 2 : Math.random() * 1,
            volteCellIntegrity: isBad ? Math.random() * 5 + 90 : Math.random() * 3 + 96,
            volteErlang: Math.random() * 50 + 10,
            volteSuccCalls: Math.floor(Math.random() * 1000 + 200),
            volteMobilitySR: isBad ? Math.random() * 5 + 90 : Math.random() * 3 + 96,
            pdcchErrorRateVolte: isBad ? Math.random() * 6 + 3 : Math.random() * 2,
            volteDropsCount: isBad ? Math.floor(Math.random() * 50 + 20) : Math.floor(Math.random() * 10)
        });
    }

    return data;
}

function pick(items) {
    return items[Math.floor(Math.random() * items.length)];
}

function computeMetrics(data) {
    if (!data || !data.length) return null;
    const valid = data.map(normalizeCell);
    const n = valid.length;

    return {
        dropRate: valid.reduce((sum, cell) => sum + cell.volteDropRate, 0) / n,
        accessFailRate: valid.reduce((sum, cell) => sum + cell.volteAccessFailureRate, 0) / n,
        cellIntegrity: valid.reduce((sum, cell) => sum + cell.volteCellIntegrity, 0) / n,
        erlang: valid.reduce((sum, cell) => sum + cell.volteErlang, 0)
    };
}

function updateDashboard() {
    kpiData = kpiData.map(normalizeCell);
    const curr = computeMetrics(kpiData);
    updateSummaryCards(curr);
    updateTable();
    updateCharts();
}

function updateSummaryCards(curr) {
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

function updateDelta(elementId, current, previous, lowerIsBetter = true) {
    const element = document.getElementById(elementId);
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
    element.textContent = `${isImproving ? 'v' : '^'} ${diff > 0 ? '+' : ''}${diff.toFixed(2)}%`;
}

function updateTable() {
    const tbody = document.getElementById('tableBody');
    tbody.replaceChildren();

    kpiData.forEach(cell => {
        const row = document.createElement('tr');
        const status = getCellStatus(cell);
        const statusClass = status === 'GOOD' ? 'status-good' : status === 'WARNING' ? 'status-warning' : 'status-bad';
        const erlangWarn = cell.volteErlang > SLA.erlangPerSector;

        appendCell(row, cell.klaster);
        appendCell(row, cell.stanica);
        appendCell(row, cell.celija, null, true);
        appendCell(row, `${cell.band} MHz`);
        appendCell(row, cell.volteAccessFailureRate.toFixed(2), getKpiClass(cell.volteAccessFailureRate, 2, 5));
        appendCell(row, cell.volteDropRate.toFixed(2), getKpiClass(cell.volteDropRate, 1.5, 3));
        appendCell(row, cell.volteCellIntegrity.toFixed(2), getKpiClass(cell.volteCellIntegrity, 97, 95, true));
        appendCell(row, `${cell.volteErlang.toFixed(1)}${erlangWarn ? ' !' : ''}`, erlangWarn ? 'erlang-warn' : null);
        appendCell(row, cell.volteSuccCalls);
        appendCell(row, cell.volteMobilitySR.toFixed(2), getKpiClass(cell.volteMobilitySR, 97, 95, true));
        appendCell(row, cell.pdcchErrorRateVolte.toFixed(2), getKpiClass(cell.pdcchErrorRateVolte, 3, 6));
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

function appendCell(row, value, className = null, strong = false) {
    const td = document.createElement('td');
    if (className) td.className = className;

    if (strong) {
        const bold = document.createElement('strong');
        bold.textContent = value;
        td.appendChild(bold);
    } else {
        td.textContent = value;
    }

    row.appendChild(td);
}

function getCellStatus(c) {
    if (c.volteDropRate > 3 || c.volteAccessFailureRate > 5 || c.volteCellIntegrity < 95) return 'BAD';
    if (c.volteDropRate > 1.5 || c.volteAccessFailureRate > 2 || c.volteCellIntegrity < 97) return 'WARNING';
    return 'GOOD';
}

function getKpiClass(value, good, bad, higher = false) {
    if (higher) {
        if (value >= good) return 'kpi-good';
        if (value <= bad) return 'kpi-bad';
        return 'kpi-warning';
    }
    if (value <= good) return 'kpi-good';
    if (value >= bad) return 'kpi-bad';
    return 'kpi-warning';
}

function updateCharts() {
    updateAccessFailChart();
    updateDropRateChart();
    updateIntegrityChart();
    updateErlangChart();
}

const chartTooltip = {
    backgroundColor: '#2a2f3a',
    titleColor: '#ffffff',
    bodyColor: '#b0b8c4',
    borderColor: '#3a4050',
    borderWidth: 1,
    padding: 10,
    cornerRadius: 4
};

function updateAccessFailChart() {
    const ctx = document.getElementById('accessFailChart').getContext('2d');
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

function updateDropRateChart() {
    const ctx = document.getElementById('dropRateChart').getContext('2d');
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
                backgroundColor: data.map(v => v > 3 ? '#ef4444' : v > 1.5 ? '#f59e0b' : '#10b981'),
                borderRadius: 3
            }]
        },
        options: chartOptions({ max: 10 })
    });
}

function updateIntegrityChart() {
    const ctx = document.getElementById('integrityChart').getContext('2d');
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
            plugins: { legend: { labels: { color: '#b0b8c4', padding: 10, font: { size: 11 } } } }
        }
    });
}

function updateErlangChart() {
    const ctx = document.getElementById('erlangChart').getContext('2d');
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
            tooltip: { ...chartTooltip, callbacks: { label: ctx => `${ctx.parsed.y.toFixed(1)} Erl` } }
        })
    });
}

function chartOptions({ max = null, tooltip = chartTooltip } = {}) {
    return {
        responsive: true,
        maintainAspectRatio: true,
        plugins: { legend: { display: false }, tooltip },
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

function exportCSV() {
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

function escapeCsvField(value) {
    const text = String(value ?? '');
    if (/[",\r\n]/.test(text)) {
        return `"${text.replace(/"/g, '""')}"`;
    }
    return text;
}

function normalizeCell(cell) {
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
        volteDropsCount: Math.trunc(toNumber(cell.volteDropsCount))
    };
}

function toNumber(value) {
    const number = Number(value);
    return Number.isFinite(number) ? number : 0;
}

function formatPercent(value) {
    return `${value.toFixed(2)}%`;
}

function setText(elementId, value) {
    document.getElementById(elementId).textContent = value;
}

function startAutoRefresh() {
    autoRefreshInterval = setInterval(loadData, 300000);
}

window.addEventListener('beforeunload', () => {
    if (autoRefreshInterval) clearInterval(autoRefreshInterval);
    Object.values(charts).forEach(chart => chart.destroy());
});
