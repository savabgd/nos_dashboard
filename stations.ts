/**
 * ============================================================
 * stations.ts — STATIČNI PODACI MREŽE (topologija + metapodaci)
 * ============================================================
 *
 * Ovaj fajl sadrži SVE što se ne menja tokom rada programa:
 *  - tipove koji opisuju podatke (StationStatus, MapStation, MapLink...)
 *  - spisak svih baznih stanica sa koordinatama
 *  - spisak svih linkova između stanica (fiber / mikrovalna / backhaul)
 *  - metapodatke o 30 okruga Srbije (imena, centri, boje)
 *  - definicije mrežnih domena (RAN / IMS / Transport / Core)
 *
 * NAMERNO NE sadrži Leaflet niti bilo koju biblioteku — čist TypeScript,
 * da ga app.ts može učitati bez povlačenja cele mape (brži prvi render).
 *
 * Geometija okruga (pravi oblici na mapi) se NE čuva ovde — učitava se
 * u runtime-u iz /serbia-districts.geojson (vidi network-map.ts).
 */

/**
 * Mogući statusi jednog elementa mreže.
 * - GOOD     → sve u granicama SLA (zeleno)
 * - WARNING  → blago odbačanje od praga (žuto)
 * - BAD      → kritično, SLA prekoračen (crveno)
 * - UNKNOWN  → nema podataka za element (sivo)
 */
export type StationStatus = 'GOOD' | 'WARNING' | 'BAD' | 'UNKNOWN';

/** Jedna bazna stanica (eNodeB) — pozicija na mapi + pripadnost okrugu. */
export interface MapStation {
  id: string;      // jedinstveni ID, npr. "BGD_CEN_001"
  name: string;    // ime za prikaz, npr. "Beograd Centar"
  cluster: string; // klaster (grupa stanica, npr. "CENTAR_BGD")
  region: string;  // ID okruga — ključ u DISTRICT_META mapi ispod
  lat: number;     // geografska širina (za Leaflet marker)
  lon: number;     // geografska dužina
}

/** Link između dve stanice (transportna mreža). */
export interface MapLink {
  from: string;  // ID stanice-pošiljaoca
  to: string;    // ID stanice-primaoca
  type: 'fiber' | 'mw' | 'backhaul'; // vrsta veze: optika / mikrovalna / glavni backbone
  label?: string; // kapacitet za prikaz, npr. "10G", "100G"
}

/** Minimalni oblik KPI reda koji mapa treba (ne mora cela ćelija iz API-ja). */
export interface KpiCellLike {
  stanica: string;                 // ID stanice kojoj ćelija pripada
  klaster: string;                 // klaster ćelije
  volteDropRate: number;           // stopa otpuštenih VoLTE poziva (%)
  volteAccessFailureRate: number;  // stopa neuspešnih uspostavljanja (%)
  volteCellIntegrity: number;      // integritet ćelije (%)
}

/** Metapodaci jednog okruga — ime, region, administrativni centar, boja ispune. */
export interface DistrictMeta {
  name: string;        // puno ime, npr. "Južnobački okrug"
  macroRegion: string; // makroregion ("Vojvodina", "Beograd"...)
  centerCity: string;  // administrativni centar
  fill: string;        // boja ispune na mapi (hex)
}

/**
 * Metadata for the official districts (okruzi) of the Republic of Serbia.
 * Real boundary geometry is loaded at runtime from /serbia-districts.geojson
 * (sourced from geoBoundaries, gbOpen ADM1) — keyed by these region ids.
 */
export const DISTRICT_META: Record<string, DistrictMeta> = {
  severnobacki: { name: 'Severnobački okrug', macroRegion: 'Vojvodina', centerCity: 'Subotica', fill: '#38bdf8' },
  zapadnobacki: { name: 'Zapadnobački okrug', macroRegion: 'Vojvodina', centerCity: 'Sombor', fill: '#0284c7' },
  juznobacki: { name: 'Južnobački okrug', macroRegion: 'Vojvodina', centerCity: 'Novi Sad', fill: '#0ea5e9' },
  severnobanatski: { name: 'Severnobanatski okrug', macroRegion: 'Vojvodina', centerCity: 'Kikinda', fill: '#0369a1' },
  srednjobanatski: { name: 'Srednjobanatski okrug', macroRegion: 'Vojvodina', centerCity: 'Zrenjanin', fill: '#0284c7' },
  juznobanatski: { name: 'Južnobanatski okrug', macroRegion: 'Vojvodina', centerCity: 'Pančevo', fill: '#075985' },
  sremski: { name: 'Sremski okrug', macroRegion: 'Vojvodina', centerCity: 'Sremska Mitrovica', fill: '#0ea5e9' },
  beograd: { name: 'Grad Beograd', macroRegion: 'Beograd', centerCity: 'Beograd', fill: '#6366f1' },
  macvanski: { name: 'Mačvanski okrug', macroRegion: 'Šumadija i zapadna Srbija', centerCity: 'Šabac', fill: '#10b981' },
  kolubarski: { name: 'Kolubarski okrug', macroRegion: 'Šumadija i zapadna Srbija', centerCity: 'Valjevo', fill: '#059669' },
  podunavski: { name: 'Podunavski okrug', macroRegion: 'Šumadija i zapadna Srbija', centerCity: 'Smederevo', fill: '#047857' },
  branicevski: { name: 'Braničevski okrug', macroRegion: 'Šumadija i zapadna Srbija', centerCity: 'Požarevac', fill: '#10b981' },
  sumadijski: { name: 'Šumadijski okrug', macroRegion: 'Šumadija i zapadna Srbija', centerCity: 'Kragujevac', fill: '#34d399' },
  pomoravski: { name: 'Pomoravski okrug', macroRegion: 'Šumadija i zapadna Srbija', centerCity: 'Jagodina', fill: '#059669' },
  zlatiborski: { name: 'Zlatiborski okrug', macroRegion: 'Šumadija i zapadna Srbija', centerCity: 'Užice', fill: '#065f46' },
  moravicki: { name: 'Moravički okrug', macroRegion: 'Šumadija i zapadna Srbija', centerCity: 'Čačak', fill: '#047857' },
  raski: { name: 'Raški okrug', macroRegion: 'Šumadija i zapadna Srbija', centerCity: 'Kraljevo', fill: '#064e3b' },
  rasinski: { name: 'Rasinski okrug', macroRegion: 'Šumadija i zapadna Srbija', centerCity: 'Kruševac', fill: '#10b981' },
  borski: { name: 'Borski okrug', macroRegion: 'Južna i istočna Srbija', centerCity: 'Bor', fill: '#f59e0b' },
  zajecarski: { name: 'Zaječarski okrug', macroRegion: 'Južna i istočna Srbija', centerCity: 'Zaječar', fill: '#d97706' },
  toplicki: { name: 'Toplički okrug', macroRegion: 'Južna i istočna Srbija', centerCity: 'Prokuplje', fill: '#b45309' },
  nisavski: { name: 'Nišavski okrug', macroRegion: 'Južna i istočna Srbija', centerCity: 'Niš', fill: '#fbbf24' },
  pirotski: { name: 'Pirotski okrug', macroRegion: 'Južna i istočna Srbija', centerCity: 'Pirot', fill: '#f59e0b' },
  jablanicki: { name: 'Jablanički okrug', macroRegion: 'Južna i istočna Srbija', centerCity: 'Leskovac', fill: '#d97706' },
  pcinjski: { name: 'Pčinjski okrug', macroRegion: 'Južna i istočna Srbija', centerCity: 'Vranje', fill: '#92400e' },
  kosovskomitrovacki: { name: 'Kosovskomitrovački okrug', macroRegion: 'Kosovo i Metohija', centerCity: 'Kosovska Mitrovica', fill: '#a855f7' },
  kosovski: { name: 'Kosovski okrug', macroRegion: 'Kosovo i Metohija', centerCity: 'Priština', fill: '#9333ea' },
  pecki: { name: 'Pećki okrug', macroRegion: 'Kosovo i Metohija', centerCity: 'Peć', fill: '#7e22ce' },
  prizrenski: { name: 'Prizrenski okrug', macroRegion: 'Kosovo i Metohija', centerCity: 'Prizren', fill: '#6b21a8' },
  kosovskopomoravski: { name: 'Kosovskopomoravski okrug', macroRegion: 'Kosovo i Metohija', centerCity: 'Gnjilane', fill: '#8b5cf6' },
};

/**
 * Sve 32 bazne stanice u mreži, grupisane po regionima (komentari između
 * redova su samo vizuelne grupe). Koordinate su realne (gradski centri).
 * region = ključ u DISTRICT_META — veza stanica ↔ okrug na mapi.
 */
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

// ── Mrežni domeni (kao kod velikih operatera) ────────────────────────
// Domen = logički sloj mreže. Dashboard ih prikazuje kao 4 kartice:
// svaka ima svoju dostupnost, broj elemenata i alarme.

/**
 * ID-jevi četiri domena:
 * - ran       → radio pristup (bazne stanice i ćelije)
 * - ims       → VoLTE glas (QCI-1 nosioci)
 * - transport → backhaul linkovi (fiber/mikrovalna)
 * - core      → EPC jezgro (hab čvorišta)
 */
export type NetworkDomain = 'ran' | 'ims' | 'transport' | 'core';

/** Izgled jedne domeni kartice na dashboardu (ime, boja, opis). */
export interface DomainMeta {
  id: NetworkDomain;   // jedinstveni ID domena
  name: string;        // puno ime za drawer naslov
  shortName: string;   // kratko ime za karticu (RAN, IMS, TRAN, CORE)
  color: string;       // akcentna boja kartice i sparkline-a
  description: string; // kratak opis šta domen obuhvata
}

/** Definicije sva 4 domena — boje se koriste i u CSS-u (inline --dc var). */
export const DOMAIN_META: Record<NetworkDomain, DomainMeta> = {
  ran:       { id: 'ran',       name: 'RAN · Radio pristupna mreža', shortName: 'RAN',  color: '#0ea5e9', description: 'Bazne stanice, ćelije i pokrivenost' },
  ims:       { id: 'ims',       name: 'IMS · VoLTE glas',            shortName: 'IMS',  color: '#10b981', description: 'QCI-1 nosioci glasa i integritet veze' },
  transport: { id: 'transport', name: 'Transport · Backhaul',        shortName: 'TRAN', color: '#f59e0b', description: 'Fiber, mikrovalni i backbone linkovi' },
  core:      { id: 'core',      name: 'Core · EPC jezgro',           shortName: 'CORE', color: '#a855f7', description: 'MME/SGW čvorišta i regionalni habovi' },
};

/** Stanice koje funkcionišu kao core / regionalni hab čvorišta. */
export const CORE_HUB_STATIONS: ReadonlySet<string> = new Set(['BGD_CEN_001', 'NS_001', 'KG_001']);

/** Primarni domen stanice — habovi idu u Core, sve ostalo je RAN. */
export function stationDomain(stationId: string): NetworkDomain {
  return CORE_HUB_STATIONS.has(stationId) ? 'core' : 'ran';
}

/**
 * Svi transportni linkovi mreže, grupisani po prstenovima.
 * from/to moraju biti postojeći ID-jevi iz NETWORK_STATIONS.
 * Koriste ih: mapa (polylines), Transport domen kartica i drawer.
 */
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