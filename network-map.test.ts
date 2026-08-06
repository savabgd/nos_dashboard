import { describe, it, expect } from 'vitest';
import {
  statusColor,
  worstStatus,
  deriveStationStatus,
  linkStatus,
  linkStroke,
  stationById,
  NETWORK_STATIONS,
  NETWORK_LINKS,
  DISTRICT_META,
} from './network-map';

describe('Network Map Functions', () => {
  describe('statusColor', () => {
    it('returns correct colors for each status', () => {
      expect(statusColor('GOOD')).toBe('#10b981');
      expect(statusColor('WARNING')).toBe('#f59e0b');
      expect(statusColor('BAD')).toBe('#ef4444');
      expect(statusColor('UNKNOWN')).toBe('#6b7280');
    });
  });

  describe('worstStatus', () => {
    it('returns the worst status', () => {
      expect(worstStatus('GOOD', 'WARNING')).toBe('WARNING');
      expect(worstStatus('WARNING', 'BAD')).toBe('BAD');
      expect(worstStatus('GOOD', 'BAD')).toBe('BAD');
      expect(worstStatus('UNKNOWN', 'GOOD')).toBe('GOOD');
      expect(worstStatus('BAD', 'BAD')).toBe('BAD');
    });
  });

  describe('deriveStationStatus', () => {
    const mockKpiData = [
      { stanica: 'STATION_001', volteDropRate: 1.0, volteAccessFailureRate: 1.0, volteCellIntegrity: 98.0 },
      { stanica: 'STATION_001', volteDropRate: 1.0, volteAccessFailureRate: 2.0, volteCellIntegrity: 97.0 },
      { stanica: 'STATION_002', volteDropRate: 4.0, volteAccessFailureRate: 1.0, volteCellIntegrity: 98.0 },
      { stanica: 'STATION_002', volteDropRate: 5.0, volteAccessFailureRate: 6.0, volteCellIntegrity: 94.0 },
    ];

    it('returns GOOD for healthy stations', () => {
      const status = deriveStationStatus('STATION_001', mockKpiData as any);
      expect(status).toBe('GOOD');
    });

    it('returns BAD for stations with critical cells', () => {
      const status = deriveStationStatus('STATION_002', mockKpiData as any);
      expect(status).toBe('BAD');
    });

    it('returns UNKNOWN for stations with no data', () => {
      const status = deriveStationStatus('NONEXISTENT', mockKpiData as any);
      expect(status).toBe('UNKNOWN');
    });

    it('returns UNKNOWN for empty KPI data', () => {
      const status = deriveStationStatus('STATION_001', []);
      expect(status).toBe('UNKNOWN');
    });
  });

  describe('linkStatus', () => {
    it('returns worst of two station statuses', () => {
      expect(linkStatus('GOOD', 'WARNING')).toBe('WARNING');
      expect(linkStatus('BAD', 'GOOD')).toBe('BAD');
      expect(linkStatus('WARNING', 'WARNING')).toBe('WARNING');
    });
  });

  describe('linkStroke', () => {
    it('returns red for BAD links', () => {
      expect(linkStroke({ type: 'fiber' } as any, 'BAD')).toBe('#ef4444');
      expect(linkStroke({ type: 'mw' } as any, 'BAD')).toBe('#ef4444');
      expect(linkStroke({ type: 'backhaul' } as any, 'BAD')).toBe('#ef4444');
    });

    it('returns amber for WARNING links', () => {
      expect(linkStroke({ type: 'fiber' } as any, 'WARNING')).toBe('#f59e0b');
    });

    it('returns type-specific colors for GOOD links', () => {
      expect(linkStroke({ type: 'backhaul' } as any, 'GOOD')).toBe('#0ea5e9');
      expect(linkStroke({ type: 'fiber' } as any, 'GOOD')).toBe('#38bdf8');
      expect(linkStroke({ type: 'mw' } as any, 'GOOD')).toBe('#64748b');
    });

    it('returns type-specific colors for UNKNOWN links', () => {
      expect(linkStroke({ type: 'backhaul' } as any, 'UNKNOWN')).toBe('#0ea5e9');
      expect(linkStroke({ type: 'fiber' } as any, 'UNKNOWN')).toBe('#38bdf8');
      expect(linkStroke({ type: 'mw' } as any, 'UNKNOWN')).toBe('#64748b');
    });
  });

  describe('stationById', () => {
    it('returns station for valid ID', () => {
      const station = stationById('BGD_CEN_001');
      expect(station).toBeDefined();
      expect(station?.name).toBe('Beograd Centar');
      expect(station?.cluster).toBe('CENTAR_BGD');
    });

    it('returns undefined for invalid ID', () => {
      expect(stationById('INVALID')).toBeUndefined();
    });
  });

  describe('Data Constants', () => {
    it('has stations defined', () => {
      expect(NETWORK_STATIONS.length).toBeGreaterThan(0);
      expect(NETWORK_STATIONS[0]).toHaveProperty('id');
      expect(NETWORK_STATIONS[0]).toHaveProperty('name');
      expect(NETWORK_STATIONS[0]).toHaveProperty('cluster');
      expect(NETWORK_STATIONS[0]).toHaveProperty('region');
      expect(NETWORK_STATIONS[0]).toHaveProperty('lat');
      expect(NETWORK_STATIONS[0]).toHaveProperty('lon');
    });

    it('has links defined', () => {
      expect(NETWORK_LINKS.length).toBeGreaterThan(0);
      expect(NETWORK_LINKS[0]).toHaveProperty('from');
      expect(NETWORK_LINKS[0]).toHaveProperty('to');
      expect(NETWORK_LINKS[0]).toHaveProperty('type');
    });

    it('has district metadata for all 30 districts', () => {
      expect(Object.keys(DISTRICT_META).length).toBe(30);
      Object.values(DISTRICT_META).forEach(district => {
        expect(district).toHaveProperty('name');
        expect(district).toHaveProperty('macroRegion');
        expect(district).toHaveProperty('centerCity');
        expect(district).toHaveProperty('fill');
      });
    });

    it('station regions match district metadata keys', () => {
      const stationRegions = new Set(NETWORK_STATIONS.map(s => s.region));
      const districtKeys = new Set(Object.keys(DISTRICT_META));
      
      stationRegions.forEach(region => {
        expect(districtKeys.has(region)).toBe(true);
      });
    });
  });
});