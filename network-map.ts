/**
 * Network map of Serbia — Powered by Leaflet.js with OpenStreetMap (OSM) tile layer,
 * high-definition district boundaries for all 30 official okruga, real-time base station status, and network links.
 */

import L from 'leaflet';

export type StationStatus = 'GOOD' | 'WARNING' | 'BAD' | 'UNKNOWN';

export interface MapStation {
  id: string;
  name: string;
  cluster: string;
  region: string;
  lat: number;
  lon: number;
}

export interface MapLink {
  from: string;
  to: string;
  type: 'fiber' | 'mw' | 'backhaul';
  label?: string;
}

export interface KpiCellLike {
  stanica: string;
  klaster: string;
  volteDropRate: number;
  volteAccessFailureRate: number;
  volteCellIntegrity: number;
}

export interface District {
  id: string;
  name: string;
  macroRegion: string;
  centerCity: string;
  centerLat: number;
  centerLon: number;
  fill: string;
  polygon: [number, number][];
}

/**
 * Official 30 districts (Okruzi) of Republic of Serbia with multi-vertex organic boundaries
 */
export const DISTRICTS: District[] = [
  // --- VOJVODINA ---
  {
    id: 'severnobacki',
    name: 'Severnobački okrug',
    macroRegion: 'Vojvodina',
    centerCity: 'Subotica',
    centerLat: 46.05,
    centerLon: 19.65,
    fill: '#38bdf8',
    polygon: [
      [46.18, 19.35], [46.18, 19.65], [46.18, 19.92], [46.05, 19.92],
      [45.85, 19.85], [45.75, 19.65], [45.75, 19.55], [45.82, 19.35], [46.00, 19.35]
    ]
  },
  {
    id: 'zapadnobacki',
    name: 'Zapadnobački okrug',
    macroRegion: 'Vojvodina',
    centerCity: 'Sombor',
    centerLat: 45.77,
    centerLon: 19.12,
    fill: '#0284c7',
    polygon: [
      [46.00, 18.82], [46.18, 19.12], [46.18, 19.35], [45.82, 19.35],
      [45.65, 19.45], [45.45, 19.45], [45.45, 19.15], [45.62, 18.95], [45.85, 18.85]
    ]
  },
  {
    id: 'juznobacki',
    name: 'Južnobački okrug',
    macroRegion: 'Vojvodina',
    centerCity: 'Novi Sad',
    centerLat: 45.30,
    centerLon: 19.80,
    fill: '#0ea5e9',
    polygon: [
      [45.82, 19.35], [45.85, 19.85], [45.68, 20.15], [45.45, 20.25],
      [45.22, 20.25], [45.15, 19.80], [45.15, 19.35], [45.45, 19.45], [45.65, 19.45]
    ]
  },
  {
    id: 'severnobanatski',
    name: 'Severnobanatski okrug',
    macroRegion: 'Vojvodina',
    centerCity: 'Kikinda',
    centerLat: 45.92,
    centerLon: 20.25,
    fill: '#0369a1',
    polygon: [
      [46.18, 19.92], [46.18, 20.25], [46.15, 20.35], [46.02, 20.55],
      [45.75, 20.65], [45.68, 20.35], [45.68, 20.15], [45.85, 19.85]
    ]
  },
  {
    id: 'srednjobanatski',
    name: 'Srednjobanatski okrug',
    macroRegion: 'Vojvodina',
    centerCity: 'Zrenjanin',
    centerLat: 45.42,
    centerLon: 20.50,
    fill: '#0284c7',
    polygon: [
      [45.68, 20.15], [45.75, 20.65], [45.62, 20.80], [45.42, 20.85],
      [45.22, 20.82], [45.15, 20.75], [45.22, 20.25], [45.45, 20.25]
    ]
  },
  {
    id: 'juznobanatski',
    name: 'Južnobanatski okrug',
    macroRegion: 'Vojvodina',
    centerCity: 'Pančevo',
    centerLat: 45.05,
    centerLon: 21.05,
    fill: '#075985',
    polygon: [
      [45.15, 20.75], [45.22, 20.82], [45.42, 20.85], [45.32, 21.32],
      [45.18, 21.48], [44.85, 21.55], [44.75, 21.50], [44.78, 20.95], [44.78, 20.65]
    ]
  },
  {
    id: 'sremski',
    name: 'Sremski okrug',
    macroRegion: 'Vojvodina',
    centerCity: 'Sremska Mitrovica',
    centerLat: 44.98,
    centerLon: 19.70,
    fill: '#0ea5e9',
    polygon: [
      [45.15, 19.05], [45.15, 19.35], [45.15, 19.80], [45.22, 20.25],
      [44.95, 20.25], [44.82, 20.25], [44.82, 19.65], [44.82, 19.05], [44.98, 19.05]
    ]
  },

  // --- GRAD BEOGRAD ---
  {
    id: 'beograd',
    name: 'Grad Beograd',
    macroRegion: 'Beograd',
    centerCity: 'Beograd',
    centerLat: 44.78,
    centerLon: 20.46,
    fill: '#6366f1',
    polygon: [
      [44.95, 20.18], [44.92, 20.45], [44.92, 20.72], [44.75, 20.75],
      [44.42, 20.75], [44.38, 20.45], [44.38, 20.28], [44.62, 20.18], [44.82, 20.18]
    ]
  },

  // --- ŠUMADIJA I ZAPADNA SRBIJA ---
  {
    id: 'macvanski',
    name: 'Mačvanski okrug',
    macroRegion: 'Šumadija i zapadna Srbija',
    centerCity: 'Šabac',
    centerLat: 44.55,
    centerLon: 19.55,
    fill: '#10b981',
    polygon: [
      [44.82, 19.05], [44.82, 19.65], [44.82, 20.08], [44.62, 19.98],
      [44.42, 19.92], [44.25, 19.55], [44.15, 19.25], [44.28, 19.12], [44.38, 19.05], [44.62, 19.05]
    ]
  },
  {
    id: 'kolubarski',
    name: 'Kolubarski okrug',
    macroRegion: 'Šumadija i zapadna Srbija',
    centerCity: 'Valjevo',
    centerLat: 44.27,
    centerLon: 20.00,
    fill: '#059669',
    polygon: [
      [44.42, 19.92], [44.62, 19.98], [44.42, 20.28], [44.25, 20.32],
      [44.05, 20.35], [44.05, 20.00], [44.05, 19.72], [44.25, 19.55]
    ]
  },
  {
    id: 'podunavski',
    name: 'Podunavski okrug',
    macroRegion: 'Šumadija i zapadna Srbija',
    centerCity: 'Smederevo',
    centerLat: 44.52,
    centerLon: 20.95,
    fill: '#047857',
    polygon: [
      [44.65, 20.75], [44.72, 20.95], [44.72, 21.15], [44.52, 21.18],
      [44.32, 21.18], [44.32, 20.95], [44.32, 20.75], [44.42, 20.75]
    ]
  },
  {
    id: 'branicevski',
    name: 'Braničevski okrug',
    macroRegion: 'Šumadija i zapadna Srbija',
    centerCity: 'Požarevac',
    centerLat: 44.50,
    centerLon: 21.55,
    fill: '#10b981',
    polygon: [
      [44.75, 21.15], [44.75, 21.55], [44.75, 21.95], [44.50, 21.95],
      [44.25, 21.95], [44.22, 21.55], [44.22, 21.18], [44.52, 21.18]
    ]
  },
  {
    id: 'sumadijski',
    name: 'Šumadijski okrug',
    macroRegion: 'Šumadija i zapadna Srbija',
    centerCity: 'Kragujevac',
    centerLat: 44.15,
    centerLon: 20.75,
    fill: '#34d399',
    polygon: [
      [44.38, 20.28], [44.42, 20.75], [44.32, 20.75], [44.15, 21.05],
      [43.92, 21.05], [43.92, 20.75], [43.92, 20.45], [44.05, 20.35], [44.25, 20.32]
    ]
  },
  {
    id: 'pomoravski',
    name: 'Pomoravski okrug',
    macroRegion: 'Šumadija i zapadna Srbija',
    centerCity: 'Jagodina',
    centerLat: 44.00,
    centerLon: 21.35,
    fill: '#059669',
    polygon: [
      [44.32, 21.18], [44.22, 21.55], [44.22, 21.65], [43.95, 21.60],
      [43.72, 21.55], [43.72, 21.25], [43.72, 21.05], [43.92, 21.05], [44.15, 21.05]
    ]
  },
  {
    id: 'zlatiborski',
    name: 'Zlatiborski okrug',
    macroRegion: 'Šumadija i zapadna Srbija',
    centerCity: 'Užice',
    centerLat: 43.65,
    centerLon: 19.65,
    fill: '#065f46',
    polygon: [
      [44.15, 19.25], [44.25, 19.55], [44.05, 19.72], [43.92, 20.15],
      [43.65, 20.15], [43.38, 20.15], [43.22, 20.15], [43.22, 19.65], [43.25, 19.18], [43.65, 19.15], [43.92, 19.15]
    ]
  },
  {
    id: 'moravicki',
    name: 'Moravički okrug',
    macroRegion: 'Šumadija i zapadna Srbija',
    centerCity: 'Čačak',
    centerLat: 43.75,
    centerLon: 20.25,
    fill: '#047857',
    polygon: [
      [44.05, 19.72], [44.05, 20.00], [44.05, 20.35], [43.92, 20.45],
      [43.75, 20.45], [43.45, 20.45], [43.45, 20.08], [43.65, 20.15], [43.92, 20.15]
    ]
  },
  {
    id: 'raski',
    name: 'Raški okrug',
    macroRegion: 'Šumadija i zapadna Srbija',
    centerCity: 'Kraljevo',
    centerLat: 43.40,
    centerLon: 20.55,
    fill: '#064e3b',
    polygon: [
      [43.92, 20.45], [43.92, 20.75], [43.92, 21.05], [43.72, 21.05],
      [43.55, 21.05], [43.25, 20.85], [42.92, 20.75], [42.92, 20.45], [42.92, 20.08], [43.22, 20.15], [43.38, 20.15], [43.45, 20.45]
    ]
  },
  {
    id: 'rasinski',
    name: 'Rasinski okrug',
    macroRegion: 'Šumadija i zapadna Srbija',
    centerCity: 'Kruševac',
    centerLat: 43.50,
    centerLon: 21.20,
    fill: '#10b981',
    polygon: [
      [43.72, 21.05], [43.72, 21.25], [43.72, 21.55], [43.50, 21.55],
      [43.28, 21.55], [43.25, 21.20], [43.25, 20.85], [43.55, 21.05]
    ]
  },

  // --- JUŽNA I ISTOČNA SRBIJA ---
  {
    id: 'borski',
    name: 'Borski okrug',
    macroRegion: 'Južna i istočna Srbija',
    centerCity: 'Bor',
    centerLat: 44.40,
    centerLon: 22.30,
    fill: '#f59e0b',
    polygon: [
      [44.75, 21.95], [44.80, 22.30], [44.80, 22.65], [44.40, 22.65],
      [44.05, 22.65], [44.05, 22.30], [44.05, 21.95], [44.25, 21.95], [44.50, 21.95]
    ]
  },
  {
    id: 'zajecarski',
    name: 'Zaječarski okrug',
    macroRegion: 'Južna i istočna Srbija',
    centerCity: 'Zaječar',
    centerLat: 43.75,
    centerLon: 22.20,
    fill: '#d97706',
    polygon: [
      [44.05, 21.95], [44.05, 22.30], [44.05, 22.65], [43.75, 22.65],
      [43.45, 22.52], [43.45, 22.20], [43.45, 21.75], [43.72, 21.55], [43.95, 21.60], [44.22, 21.65]
    ]
  },
  {
    id: 'toplicki',
    name: 'Toplički okrug',
    macroRegion: 'Južna i istočna Srbija',
    centerCity: 'Prokuplje',
    centerLat: 43.20,
    centerLon: 21.25,
    fill: '#b45309',
    polygon: [
      [43.35, 20.95], [43.35, 21.25], [43.35, 21.55], [43.20, 21.55],
      [43.02, 21.55], [43.02, 21.25], [43.02, 20.95], [43.25, 20.85]
    ]
  },
  {
    id: 'nisavski',
    name: 'Nišavski okrug',
    macroRegion: 'Južna i istočna Srbija',
    centerCity: 'Niš',
    centerLat: 43.40,
    centerLon: 21.90,
    fill: '#fbbf24',
    polygon: [
      [43.72, 21.55], [43.45, 21.75], [43.45, 22.20], [43.45, 22.25],
      [43.20, 22.15], [43.08, 22.15], [43.08, 21.55], [43.20, 21.55], [43.35, 21.55], [43.50, 21.55]
    ]
  },
  {
    id: 'pirotski',
    name: 'Pirotski okrug',
    macroRegion: 'Južna i istočna Srbija',
    centerCity: 'Pirot',
    centerLat: 43.20,
    centerLon: 22.60,
    fill: '#f59e0b',
    polygon: [
      [43.45, 22.25], [43.45, 22.65], [43.45, 23.00], [43.20, 23.00],
      [42.95, 22.85], [42.95, 22.50], [42.95, 22.25], [43.08, 22.15], [43.20, 22.15]
    ]
  },
  {
    id: 'jablanicki',
    name: 'Jablanički okrug',
    macroRegion: 'Južna i istočna Srbija',
    centerCity: 'Leskovac',
    centerLat: 42.90,
    centerLon: 21.95,
    fill: '#d97706',
    polygon: [
      [43.08, 21.55], [43.08, 22.15], [43.08, 22.45], [42.90, 22.45],
      [42.75, 22.45], [42.75, 21.95], [42.75, 21.45], [43.02, 21.25], [43.02, 21.55]
    ]
  },
  {
    id: 'pcinjski',
    name: 'Pčinjski okrug',
    macroRegion: 'Južna i istočna Srbija',
    centerCity: 'Vranje',
    centerLat: 42.50,
    centerLon: 22.10,
    fill: '#92400e',
    polygon: [
      [42.75, 21.45], [42.75, 21.95], [42.75, 22.45], [42.75, 22.60],
      [42.50, 22.60], [42.25, 22.60], [42.25, 22.10], [42.25, 21.55], [42.50, 21.45]
    ]
  },

  // --- KOSOVO I METOHIJA ---
  {
    id: 'kosovskomitrovacki',
    name: 'Kosovskomitrovački okrug',
    macroRegion: 'Kosovo i Metohija',
    centerCity: 'Kosovska Mitrovica',
    centerLat: 42.95,
    centerLon: 20.75,
    fill: '#a855f7',
    polygon: [
      [43.18, 20.55], [43.18, 20.85], [43.18, 21.05], [42.95, 21.05],
      [42.75, 21.05], [42.75, 20.75], [42.75, 20.45], [42.92, 20.45], [42.92, 20.75]
    ]
  },
  {
    id: 'kosovski',
    name: 'Kosovski okrug',
    macroRegion: 'Kosovo i Metohija',
    centerCity: 'Priština',
    centerLat: 42.60,
    centerLon: 21.20,
    fill: '#9333ea',
    polygon: [
      [42.92, 20.95], [42.92, 21.20], [42.92, 21.45], [42.60, 21.45],
      [42.28, 21.45], [42.28, 21.20], [42.28, 20.95], [42.60, 20.95]
    ]
  },
  {
    id: 'pecki',
    name: 'Pećki okrug',
    macroRegion: 'Kosovo i Metohija',
    centerCity: 'Peć',
    centerLat: 42.55,
    centerLon: 20.35,
    fill: '#7e22ce',
    polygon: [
      [42.85, 20.02], [42.85, 20.35], [42.85, 20.65], [42.55, 20.65],
      [42.28, 20.65], [42.28, 20.35], [42.28, 20.02], [42.55, 20.02]
    ]
  },
  {
    id: 'prizrenski',
    name: 'Prizrenski okrug',
    macroRegion: 'Kosovo i Metohija',
    centerCity: 'Prizren',
    centerLat: 42.10,
    centerLon: 20.75,
    fill: '#6b21a8',
    polygon: [
      [42.35, 20.52], [42.35, 20.75], [42.35, 21.05], [42.10, 21.05],
      [41.85, 21.05], [41.85, 20.75], [41.85, 20.45], [42.10, 20.45]
    ]
  },
  {
    id: 'kosovskopomoravski',
    name: 'Kosovskopomoravski okrug',
    macroRegion: 'Kosovo i Metohija',
    centerCity: 'Gnjilane',
    centerLat: 42.45,
    centerLon: 21.60,
    fill: '#8b5cf6',
    polygon: [
      [42.65, 21.35], [42.65, 21.60], [42.65, 21.85], [42.45, 21.85],
      [42.25, 21.85], [42.25, 21.60], [42.25, 21.35], [42.45, 21.35]
    ]
  }
];

export const NETWORK_STATIONS: MapStation[] = [
  // Beograd
  { id: 'BGD_CEN_001', name: 'Beograd Centar', cluster: 'CENTAR_BGD', region: 'beograd', lat: 44.8176, lon: 20.4633 },
  { id: 'BGD_CEN_002', name: 'Slavija', cluster: 'CENTAR_BGD', region: 'beograd', lat: 44.8020, lon: 20.4650 },
  { id: 'BGD_SEV_001', name: 'Novi Beograd', cluster: 'SEVER_BGD', region: 'beograd', lat: 44.8150, lon: 20.4200 },
  { id: 'ZEM_001', name: 'Zemun', cluster: 'ZEMUN', region: 'beograd', lat: 44.8450, lon: 20.3650 },

  // Vojvodina
  { id: 'SUB_001', name: 'Subotica', cluster: 'VOJVODINA', region: 'severnobacki', lat: 46.1010, lon: 19.6660 },
  { id: 'SOM_001', name: 'Sombor', cluster: 'VOJVODINA', region: 'zapadnobacki', lat: 45.7740, lon: 19.1120 },
  { id: 'NS_001', name: 'Novi Sad', cluster: 'NOVI_SAD', region: 'juznobacki', lat: 45.2670, lon: 19.8330 },
  { id: 'NS_002', name: 'Petrovaradin', cluster: 'NOVI_SAD', region: 'juznobacki', lat: 45.2520, lon: 19.8800 },
  { id: 'ZR_001', name: 'Zrenjanin', cluster: 'VOJVODINA', region: 'srednjobanatski', lat: 45.3810, lon: 20.3900 },
  { id: 'KIK_001', name: 'Kikinda', cluster: 'VOJVODINA', region: 'severnobanatski', lat: 45.8290, lon: 20.4650 },
  { id: 'PA_001', name: 'Pančevo', cluster: 'VOJVODINA', region: 'juznobanatski', lat: 44.8700, lon: 20.6400 },
  { id: 'SM_001', name: 'Sremska Mitrovica', cluster: 'VOJVODINA', region: 'sremski', lat: 44.9760, lon: 19.6120 },

  // Šumadija i Zapadna Srbija
  { id: 'SAB_001', name: 'Šabac', cluster: 'ZAPAD', region: 'macvanski', lat: 44.7550, lon: 19.6920 },
  { id: 'VAL_001', name: 'Valjevo', cluster: 'ZAPAD', region: 'kolubarski', lat: 44.2710, lon: 19.8980 },
  { id: 'SMD_001', name: 'Smederevo', cluster: 'SUMADIJA', region: 'podunavski', lat: 44.6630, lon: 20.9270 },
  { id: 'POZ_001', name: 'Požarevac', cluster: 'ISTOK', region: 'branicevski', lat: 44.6210, lon: 21.1870 },
  { id: 'KG_001', name: 'Kragujevac', cluster: 'SUMADIJA', region: 'sumadijski', lat: 44.0130, lon: 20.9110 },
  { id: 'JAG_001', name: 'Jagodina', cluster: 'SUMADIJA', region: 'pomoravski', lat: 43.9770, lon: 21.2610 },
  { id: 'UZ_001', name: 'Užice', cluster: 'ZAPAD', region: 'zlatiborski', lat: 43.8580, lon: 19.8430 },
  { id: 'CAC_001', name: 'Čačak', cluster: 'ZAPAD', region: 'moravicki', lat: 43.8910, lon: 20.3500 },
  { id: 'KRL_001', name: 'Kraljevo', cluster: 'ZAPAD', region: 'raski', lat: 43.7250, lon: 20.6890 },
  { id: 'NP_001', name: 'Novi Pazar', cluster: 'ZAPAD', region: 'raski', lat: 43.1400, lon: 20.5180 },
  { id: 'KSU_001', name: 'Kruševac', cluster: 'JUG', region: 'rasinski', lat: 43.5830, lon: 21.3260 },

  // Južna i Istočna Srbija
  { id: 'BOR_001', name: 'Bor', cluster: 'ISTOK', region: 'borski', lat: 44.0790, lon: 22.0980 },
  { id: 'ZC_001', name: 'Zaječar', cluster: 'ISTOK', region: 'zajecarski', lat: 43.9060, lon: 22.2740 },
  { id: 'PRO_001', name: 'Prokuplje', cluster: 'JUG', region: 'toplicki', lat: 43.2340, lon: 21.5880 },
  { id: 'NIS_001', name: 'Niš', cluster: 'JUG', region: 'nisavski', lat: 43.3210, lon: 21.8960 },
  { id: 'PIR_001', name: 'Pirot', cluster: 'JUG', region: 'pirotski', lat: 43.1530, lon: 22.5860 },
  { id: 'LES_001', name: 'Leskovac', cluster: 'JUG', region: 'jablanicki', lat: 42.9980, lon: 21.9460 },
  { id: 'VR_001', name: 'Vranje', cluster: 'JUG', region: 'pcinjski', lat: 42.5540, lon: 21.8970 },

  // Kosovo i Metohija
  { id: 'KM_001', name: 'Kosovska Mitrovica', cluster: 'JUG', region: 'kosovskomitrovacki', lat: 42.8910, lon: 20.8660 },
  { id: 'PR_001', name: 'Priština', cluster: 'JUG', region: 'kosovski', lat: 42.6670, lon: 21.1660 },
  { id: 'PEC_001', name: 'Peć', cluster: 'JUG', region: 'pecki', lat: 42.6590, lon: 20.2880 },
  { id: 'PZ_001', name: 'Prizren', cluster: 'JUG', region: 'prizrenski', lat: 42.2140, lon: 20.7410 }
];

export const NETWORK_LINKS: MapLink[] = [
  // Core Beograd backbone
  { from: 'BGD_CEN_001', to: 'BGD_CEN_002', type: 'fiber', label: '10G' },
  { from: 'BGD_CEN_001', to: 'BGD_SEV_001', type: 'fiber', label: '10G' },
  { from: 'BGD_SEV_001', to: 'ZEM_001', type: 'fiber', label: '10G' },

  // Severni prsten (Vojvodina)
  { from: 'BGD_CEN_001', to: 'NS_001', type: 'backhaul', label: '100G' },
  { from: 'NS_001', to: 'NS_002', type: 'fiber', label: '10G' },
  { from: 'NS_001', to: 'SUB_001', type: 'backhaul', label: '40G' },
  { from: 'NS_001', to: 'SOM_001', type: 'mw', label: '10G' },
  { from: 'NS_001', to: 'ZR_001', type: 'fiber', label: '10G' },
  { from: 'SUB_001', to: 'KIK_001', type: 'mw', label: '1G' },
  { from: 'BGD_SEV_001', to: 'PA_001', type: 'fiber', label: '10G' },
  { from: 'NS_001', to: 'SM_001', type: 'mw', label: '1G' },

  // Zapadni prsten
  { from: 'BGD_CEN_001', to: 'SAB_001', type: 'mw', label: '10G' },
  { from: 'SAB_001', to: 'VAL_001', type: 'fiber', label: '10G' },
  { from: 'BGD_CEN_001', to: 'KG_001', type: 'backhaul', label: '100G' },
  { from: 'KG_001', to: 'CAC_001', type: 'fiber', label: '10G' },
  { from: 'CAC_001', to: 'UZ_001', type: 'mw', label: '1G' },
  { from: 'CAC_001', to: 'KRL_001', type: 'fiber', label: '10G' },
  { from: 'KRL_001', to: 'NP_001', type: 'mw', label: '1G' },

  // Centralni & Istočni prsten
  { from: 'BGD_CEN_001', to: 'SMD_001', type: 'fiber', label: '10G' },
  { from: 'SMD_001', to: 'POZ_001', type: 'mw', label: '1G' },
  { from: 'POZ_001', to: 'BOR_001', type: 'fiber', label: '10G' },
  { from: 'BOR_001', to: 'ZC_001', type: 'fiber', label: '10G' },
  { from: 'KG_001', to: 'JAG_001', type: 'fiber', label: '10G' },
  { from: 'JAG_001', to: 'KSU_001', type: 'fiber', label: '10G' },

  // Južni prsten
  { from: 'KG_001', to: 'NIS_001', type: 'backhaul', label: '40G' },
  { from: 'NIS_001', to: 'PRO_001', type: 'mw', label: '1G' },
  { from: 'NIS_001', to: 'PIR_001', type: 'fiber', label: '10G' },
  { from: 'NIS_001', to: 'LES_001', type: 'fiber', label: '10G' },
  { from: 'LES_001', to: 'VR_001', type: 'backhaul', label: '40G' },

  // Kosovo & Metohija linkovi
  { from: 'VR_001', to: 'PR_001', type: 'backhaul', label: '40G' },
  { from: 'PR_001', to: 'KM_001', type: 'fiber', label: '10G' },
  { from: 'PR_001', to: 'PZ_001', type: 'mw', label: '10G' },
  { from: 'PR_001', to: 'PEC_001', type: 'mw', label: '1G' }
];

let map: L.Map | null = null;
let districtLayers: Record<string, L.Polygon> = {};
let stationMarkers: Record<string, L.CircleMarker> = {};
let linkPolylines: L.Polyline[] = [];

function statusColor(status: StationStatus): string {
  switch (status) {
    case 'GOOD': return '#10b981';
    case 'WARNING': return '#f59e0b';
    case 'BAD': return '#ef4444';
    default: return '#6b7280';
  }
}

function worstStatus(a: StationStatus, b: StationStatus): StationStatus {
  const rank: Record<StationStatus, number> = { BAD: 3, WARNING: 2, GOOD: 1, UNKNOWN: 0 };
  return rank[a] >= rank[b] ? a : b;
}

function deriveStationStatus(stationId: string, kpiData: KpiCellLike[]): StationStatus {
  const cells = kpiData.filter(c => c.stanica === stationId);
  if (!cells.length) return 'UNKNOWN';

  let worst: StationStatus = 'GOOD';
  for (const cell of cells) {
    let s: StationStatus = 'GOOD';
    if (cell.volteDropRate > 3 || cell.volteAccessFailureRate > 5 || cell.volteCellIntegrity < 95) {
      s = 'BAD';
    } else if (cell.volteDropRate > 1.5 || cell.volteAccessFailureRate > 2 || cell.volteCellIntegrity < 97) {
      s = 'WARNING';
    }
    worst = worstStatus(worst, s);
  }
  return worst;
}

function linkStatus(from: StationStatus, to: StationStatus): StationStatus {
  return worstStatus(from, to);
}

function linkStroke(link: MapLink, status: StationStatus): string {
  if (status === 'BAD') return '#ef4444';
  if (status === 'WARNING') return '#f59e0b';
  if (link.type === 'backhaul') return '#0ea5e9';
  if (link.type === 'fiber') return '#38bdf8';
  return '#64748b';
}

function stationById(id: string): MapStation | undefined {
  return NETWORK_STATIONS.find(s => s.id === id);
}

export function initNetworkMap(containerId: string): void {
  const container = document.getElementById(containerId);
  if (!container) return;

  // Clean container if re-initializing
  if (map) {
    map.remove();
    map = null;
  }
  container.innerHTML = '';

  // Initialize Leaflet Map centered on Serbia
  map = L.map(containerId, {
    center: [44.20, 20.80],
    zoom: 7,
    minZoom: 6,
    maxZoom: 15,
    zoomControl: true,
    attributionControl: true
  });

  // High-definition OpenStreetMap Dark Matter tiles for NOC aesthetic
  L.tileLayer('https://{s}.basemaps.cartocdn.com/dark_all/{z}/{x}/{y}{r}.png', {
    attribution: '&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a> contributors &copy; <a href="https://carto.com/attributions">CARTO</a>',
    subdomains: 'abcd',
    maxZoom: 19
  }).addTo(map);

  // Render District Polygons (30 Okruzi) over OSM tiles with subtle translucent fill and crisp cyan outlines
  DISTRICTS.forEach(district => {
    const latLons: L.LatLngExpression[] = district.polygon.map(p => [p[0], p[1]]);
    const polygon = L.polygon(latLons, {
      color: '#38bdf8',
      weight: 1.5,
      opacity: 0.8,
      dashArray: '3, 4',
      fillColor: district.fill,
      fillOpacity: 0.15
    }).addTo(map!);

    const stationsInDistrict = NETWORK_STATIONS.filter(s => s.region === district.id).length;
    polygon.bindTooltip(`
      <div style="font-family:'Inter',sans-serif;">
        <strong style="color:#f8fafc;font-size:0.88rem;">${district.name}</strong><br/>
        <span style="color:#94a3b8;font-size:0.78rem;">Upravni centar: ${district.centerCity}</span><br/>
        <span style="color:#94a3b8;font-size:0.78rem;">Regija: ${district.macroRegion}</span><br/>
        <span style="color:#38bdf8;font-size:0.78rem;font-weight:600;">Stanica: ${stationsInDistrict}</span>
      </div>
    `, { sticky: true, opacity: 0.95 });

    polygon.on('mouseover', () => {
      polygon.setStyle({ fillOpacity: 0.35, weight: 2.5, color: '#f59e0b' });
    });
    polygon.on('mouseout', () => {
      polygon.setStyle({ fillOpacity: 0.15, weight: 1.5, color: '#38bdf8' });
    });

    districtLayers[district.id] = polygon;
  });

  renderLinks({});
  renderStations({});
}

function renderLinks(stationStatuses: Record<string, StationStatus>): void {
  if (!map) return;

  // Clear existing polylines
  linkPolylines.forEach(l => map?.removeLayer(l));
  linkPolylines = [];

  NETWORK_LINKS.forEach(link => {
    const from = stationById(link.from);
    const to = stationById(link.to);
    if (!from || !to) return;

    const status = linkStatus(
      stationStatuses[from.id] ?? 'UNKNOWN',
      stationStatuses[to.id] ?? 'UNKNOWN'
    );

    const color = linkStroke(link, status);
    const polyline = L.polyline([[from.lat, from.lon], [to.lat, to.lon]], {
      color,
      weight: link.type === 'backhaul' ? 3 : 2,
      opacity: 0.85,
      dashArray: link.type === 'mw' ? '6, 6' : undefined
    }).addTo(map!);

    polyline.bindTooltip(`
      <strong>${from.name} ↔ ${to.name}</strong><br/>
      <span>Tip: ${link.type.toUpperCase()} ${link.label ? '(' + link.label + ')' : ''}</span>
    `);

    linkPolylines.push(polyline);
  });
}

function renderStations(stationStatuses: Record<string, StationStatus>): void {
  if (!map) return;

  // Clear existing markers
  Object.values(stationMarkers).forEach(m => map?.removeLayer(m));
  stationMarkers = {};

  NETWORK_STATIONS.forEach(station => {
    const status = stationStatuses[station.id] ?? 'UNKNOWN';
    const color = statusColor(status);
    const district = DISTRICTS.find(d => d.id === station.region);

    const marker = L.circleMarker([station.lat, station.lon], {
      radius: 7,
      fillColor: color,
      color: '#0f172a',
      weight: 2,
      opacity: 1,
      fillOpacity: 0.95
    }).addTo(map!);

    marker.bindPopup(`
      <div style="font-family:'Inter',sans-serif;">
        <strong style="color:#f8fafc;font-size:0.92rem;">${station.name}</strong>
        <div style="color:#94a3b8;font-size:0.78rem;margin-top:4px;">
          <div><strong>ID:</strong> ${station.id}</div>
          <div><strong>Klaster:</strong> ${station.cluster}</div>
          <div><strong>Okrug:</strong> ${district?.name || station.region}</div>
          <div style="margin-top:6px;">
            <strong>Status:</strong> 
            <span style="color:${color};font-weight:700;padding:2px 6px;background:rgba(255,255,255,0.1);border-radius:4px;">
              ${status}
            </span>
          </div>
        </div>
      </div>
    `);

    marker.on('click', () => {
      const row = document.querySelector(`tr[data-station="${station.id}"]`);
      row?.scrollIntoView({ behavior: 'smooth', block: 'center' });
      row?.classList.add('row-highlight');
      setTimeout(() => row?.classList.remove('row-highlight'), 2000);
    });

    stationMarkers[station.id] = marker;
  });
}

export function updateNetworkMap(kpiData: KpiCellLike[]): void {
  if (!map) return;

  const statuses: Record<string, StationStatus> = {};
  NETWORK_STATIONS.forEach(s => {
    statuses[s.id] = deriveStationStatus(s.id, kpiData);
  });

  renderLinks(statuses);
  renderStations(statuses);

  const stats = document.getElementById('mapStats');
  if (stats) {
    const counts = { GOOD: 0, WARNING: 0, BAD: 0, UNKNOWN: 0 };
    Object.values(statuses).forEach(s => counts[s]++);
    stats.innerHTML = `
      <span class="map-stat good">${counts.GOOD} OK</span>
      <span class="map-stat warning">${counts.WARNING} Upozorenje</span>
      <span class="map-stat bad">${counts.BAD} Kritično</span>
      <span class="map-stat muted">${NETWORK_LINKS.length} linkova | 30 okruga</span>
    `;
  }
}
