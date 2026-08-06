import { describe, it, expect, beforeEach } from 'vitest';
import {
  toNumber,
  formatPercent,
  normalizeCell,
  computeMetrics,
  getCellStatus,
  getKpiClass,
  updateDelta,
  escapeCsvField,
  SLA,
  filterCells,
  applyTheme,
  getInitialTheme,
  toggleTheme,
  showToast,
} from './app';

// Mock DOM for updateDelta tests
const createMockElement = (id: string) => {
  const el = document.createElement('span');
  el.id = id;
  document.body.appendChild(el);
  return el;
};

describe('Utility Functions', () => {
  describe('toNumber', () => {
    it('converts valid numbers', () => {
      expect(toNumber(5)).toBe(5);
      expect(toNumber('3.14')).toBe(3.14);
      expect(toNumber(0)).toBe(0);
    });

    it('returns 0 for invalid values', () => {
      expect(toNumber(null)).toBe(0);
      expect(toNumber(undefined)).toBe(0);
      expect(toNumber('abc')).toBe(0);
      expect(toNumber(NaN)).toBe(0);
      expect(toNumber(Infinity)).toBe(0);
    });
  });

  describe('formatPercent', () => {
    it('formats percentages correctly', () => {
      expect(formatPercent(1.5)).toBe('1.50%');
      expect(formatPercent(0)).toBe('0.00%');
      expect(formatPercent(100)).toBe('100.00%');
    });

    it('returns N/A for null/undefined', () => {
      expect(formatPercent(null)).toBe('N/A');
      expect(formatPercent(undefined)).toBe('N/A');
    });
  });

  describe('normalizeCell', () => {
    it('normalizes cell data with all fields', () => {
      const input = {
        celija: 'CELL_001',
        stanica: 'STATION_001',
        klaster: 'CLUSTER_001',
        band: '800',
        volteAccessFailureRate: '2.5',
        volteDropRate: '1.2',
        volteCellIntegrity: '98.5',
        volteErlang: '25.3',
        volteSuccCalls: '1500',
        volteMobilitySR: '99.1',
        pdcchErrorRateVolte: '1.8',
        volteDropsCount: '5',
        status: 'GOOD',
        datetime: '2024-01-01T00:00:00Z',
      };

      const result = normalizeCell(input);

      expect(result.celija).toBe('CELL_001');
      expect(result.stanica).toBe('STATION_001');
      expect(result.klaster).toBe('CLUSTER_001');
      expect(result.band).toBe('800');
      expect(result.volteAccessFailureRate).toBe(2.5);
      expect(result.volteDropRate).toBe(1.2);
      expect(result.volteCellIntegrity).toBe(98.5);
      expect(result.volteErlang).toBe(25.3);
      expect(result.volteSuccCalls).toBe(1500);
      expect(result.volteMobilitySR).toBe(99.1);
      expect(result.pdcchErrorRateVolte).toBe(1.8);
      expect(result.volteDropsCount).toBe(5);
      expect(result.status).toBe('GOOD');
      expect(result.datetime).toBe('2024-01-01T00:00:00Z');
    });

    it('handles missing fields with defaults', () => {
      const result = normalizeCell({});
      expect(result.celija).toBe('');
      expect(result.volteAccessFailureRate).toBe(0);
      expect(result.volteDropRate).toBe(0);
      expect(result.volteCellIntegrity).toBe(0);
    });

    it('converts string numbers to numbers', () => {
      const result = normalizeCell({
        volteAccessFailureRate: '3.14',
        volteDropRate: '2',
        volteErlang: '10.5',
      });
      expect(result.volteAccessFailureRate).toBe(3.14);
      expect(result.volteDropRate).toBe(2);
      expect(result.volteErlang).toBe(10.5);
    });
  });

  describe('computeMetrics', () => {
    it('computes average metrics correctly', () => {
      const data = [
        { volteDropRate: 1.0, volteAccessFailureRate: 2.0, volteCellIntegrity: 98.0, volteErlang: 20 },
        { volteDropRate: 2.0, volteAccessFailureRate: 3.0, volteCellIntegrity: 97.0, volteErlang: 30 },
        { volteDropRate: 3.0, volteAccessFailureRate: 4.0, volteCellIntegrity: 96.0, volteErlang: 40 },
      ];

      const result = computeMetrics(data as any);

      expect(result).not.toBeNull();
      expect(result!.dropRate).toBeCloseTo(2.0);
      expect(result!.accessFailRate).toBeCloseTo(3.0);
      expect(result!.cellIntegrity).toBeCloseTo(97.0);
      expect(result!.erlang).toBe(90);
    });

    it('returns null for empty array', () => {
      expect(computeMetrics([])).toBeNull();
      expect(computeMetrics(null as any)).toBeNull();
    });

    it('handles NaN values in data', () => {
      const data = [
        { volteDropRate: 1.0, volteAccessFailureRate: 2.0, volteCellIntegrity: 98.0, volteErlang: 20 },
        { volteDropRate: NaN, volteAccessFailureRate: 3.0, volteCellIntegrity: 97.0, volteErlang: 30 },
      ];

      const result = computeMetrics(data as any);
      expect(result).not.toBeNull();
      expect(result!.dropRate).toBeCloseTo(0.5); // NaN becomes 0 via toNumber
    });
  });

  describe('getCellStatus', () => {
    it('returns BAD for critical values', () => {
      expect(getCellStatus({
        volteDropRate: 4,
        volteAccessFailureRate: 1,
        volteCellIntegrity: 98,
      } as any)).toBe('BAD');

      expect(getCellStatus({
        volteDropRate: 1,
        volteAccessFailureRate: 6,
        volteCellIntegrity: 98,
      } as any)).toBe('BAD');

      expect(getCellStatus({
        volteDropRate: 1,
        volteAccessFailureRate: 1,
        volteCellIntegrity: 94,
      } as any)).toBe('BAD');
    });

    it('returns WARNING for threshold violations', () => {
      expect(getCellStatus({
        volteDropRate: 1.6, // > 1.5
        volteAccessFailureRate: 1,
        volteCellIntegrity: 98,
      } as any)).toBe('WARNING');

      expect(getCellStatus({
        volteDropRate: 1,
        volteAccessFailureRate: 2.1, // > 2.0
        volteCellIntegrity: 98,
      } as any)).toBe('WARNING');

      expect(getCellStatus({
        volteDropRate: 1,
        volteAccessFailureRate: 1,
        volteCellIntegrity: 96.5, // < 97
      } as any)).toBe('WARNING');
    });

    it('returns GOOD for healthy values', () => {
      expect(getCellStatus({
        volteDropRate: 1.0,
        volteAccessFailureRate: 1.5,
        volteCellIntegrity: 98.0,
      } as any)).toBe('GOOD');
    });
  });

  describe('getKpiClass', () => {
    it('returns correct class for lower-is-better metrics', () => {
      expect(getKpiClass(1.0, 2.0, 4.0)).toBe('kpi-good'); // <= good threshold
      expect(getKpiClass(3.0, 2.0, 4.0)).toBe('kpi-warning'); // between
      expect(getKpiClass(5.0, 2.0, 4.0)).toBe('kpi-bad'); // >= bad threshold
    });

    it('returns correct class for higher-is-better metrics', () => {
      expect(getKpiClass(98, 97, 95, true)).toBe('kpi-good'); // >= good threshold
      expect(getKpiClass(96, 97, 95, true)).toBe('kpi-warning'); // between
      expect(getKpiClass(94, 97, 95, true)).toBe('kpi-bad'); // <= bad threshold
    });
  });

  describe('updateDelta', () => {
    beforeEach(() => {
      document.body.innerHTML = '';
    });

    it('shows positive delta for improvement (lower is better)', () => {
      createMockElement('testDelta');
      updateDelta('testDelta', 1.5, 2.0, true);
      const el = document.getElementById('testDelta');
      expect(el?.classList.contains('positive')).toBe(true);
      expect(el?.textContent).toContain('↓');
      expect(el?.textContent).toContain('-0.50%');
    });

    it('shows negative delta for degradation (lower is better)', () => {
      createMockElement('testDelta');
      updateDelta('testDelta', 2.5, 2.0, true);
      const el = document.getElementById('testDelta');
      expect(el?.classList.contains('negative')).toBe(true);
      expect(el?.textContent).toContain('↑');
      expect(el?.textContent).toContain('+0.50%');
    });

    it('shows neutral for no change', () => {
      createMockElement('testDelta');
      updateDelta('testDelta', 2.0, 2.0, true);
      const el = document.getElementById('testDelta');
      expect(el?.classList.contains('neutral')).toBe(true);
      expect(el?.textContent).toBe('-> 0');
    });

    it('handles missing previous value', () => {
      createMockElement('testDelta');
      updateDelta('testDelta', 2.0, null, true);
      const el = document.getElementById('testDelta');
      expect(el?.textContent).toBe('');
    });

    it('works for higher-is-better metrics', () => {
      createMockElement('testDelta');
      updateDelta('testDelta', 98, 96, false); // higher is better
      const el = document.getElementById('testDelta');
      expect(el?.classList.contains('positive')).toBe(true);
    });
  });

  describe('escapeCsvField', () => {
    it('escapes quotes', () => {
      expect(escapeCsvField('hello "world"')).toBe('"hello ""world"""');
    });

    it('wraps fields with commas', () => {
      expect(escapeCsvField('hello, world')).toBe('"hello, world"');
    });

    it('wraps fields with newlines', () => {
      expect(escapeCsvField('hello\nworld')).toBe('"hello\nworld"');
    });

    it('returns simple values unchanged', () => {
      expect(escapeCsvField('hello')).toBe('hello');
      expect(escapeCsvField(123)).toBe('123');
      expect(escapeCsvField(null)).toBe('');
    });
  });

  describe('SLA Constants', () => {
    it('has correct default thresholds', () => {
      expect(SLA.accessFailRate).toBe(2.0);
      expect(SLA.dropRate).toBe(1.5);
      expect(SLA.cellIntegrity).toBe(97);
      expect(SLA.pdcchError).toBe(3.0);
      expect(SLA.erlangPerSector).toBe(40);
    });
  });

  describe('filterCells', () => {
    const cells: any[] = [
      { celija: 'BGD_001_1800_1', stanica: 'BGD_CEN_001', klaster: 'CENTAR_BGD', volteDropRate: 1.0, volteAccessFailureRate: 1.0, volteCellIntegrity: 98 },
      { celija: 'NS_002_2100_2', stanica: 'NS_002', klaster: 'NOVI_SAD', volteDropRate: 5.0, volteAccessFailureRate: 2.0, volteCellIntegrity: 92 },
    ];

    it('returns all cells matching the query', () => {
      const result = filterCells(cells as any, 'ns_002', false);
      expect(result).toHaveLength(1);
      expect(result[0].celija).toBe('NS_002_2100_2');
    });

    it('matches across cluster and station fields', () => {
      expect(filterCells(cells as any, 'centar', false)).toHaveLength(1);
      expect(filterCells(cells as any, 'novi', false)).toHaveLength(1);
    });

    it('filters to BAD status only when requested', () => {
      const result = filterCells(cells as any, '', true);
      expect(result).toHaveLength(1);
      expect(result[0].celija).toBe('NS_002_2100_2');
    });

    it('returns all cells when query is empty', () => {
      expect(filterCells(cells as any, '', false)).toHaveLength(2);
    });
  });

  describe('Theme helpers', () => {
    it('applies a theme to the document', () => {
      applyTheme('light');
      expect(document.documentElement.dataset.theme).toBe('light');
      applyTheme('dark');
      expect(document.documentElement.dataset.theme).toBe('dark');
    });

    it('resolves saved preference from localStorage', () => {
      localStorage.setItem('volte-theme', 'light');
      expect(getInitialTheme()).toBe('light');
      localStorage.setItem('volte-theme', 'dark');
      expect(getInitialTheme()).toBe('dark');
    });

    it('toggles theme and persists it', () => {
      applyTheme('dark');
      toggleTheme();
      expect(document.documentElement.dataset.theme).toBe('light');
      expect(localStorage.getItem('volte-theme')).toBe('light');
    });
  });

  describe('showToast', () => {
    it('appends and removes a toast element', () => {
      const container = document.createElement('div');
      container.id = 'toastContainer';
      document.body.appendChild(container);
      showToast('test message', 'error');
      expect(container.querySelector('.toast')).not.toBeNull();
      expect(container.querySelector('.toast')!.textContent).toBe('test message');
    });
  });
});