/**
 * ============================================================
 * network-map.ts — INTERAKTIVNA MAPA SRBIJE (Leaflet.js)
 * ============================================================
 *
 * Odgovara za sve što se vidi u sekciji "Mrežna mapa":
 *  - Leaflet mapu sa OpenStreetMap tile-ovima
 *  - 30 poligona okruga (geometija se fetchuje iz /serbia-districts.geojson)
 *  - markere baznih stanica (boja = najgori status ćelija te stanice)
 *  - linije linkova između stanica (boja = status, stil = tip veze)
 *  - selekciju okruga (klik → zoom + highlight; klik van okruga → reset)
 *
 * KOMUNIKACIJA SA app.ts (nema direktnog importovanja — događaji):
 *  - šalje  'noc:station-click' { stationId }  → app.ts otvara drawer stanice
 *  - šalje  'noc:region-click' { regionId }    → app.ts otvara drawer okruga
 *  - prima  updateNetworkMap(kpiData)          → osvežava boje po novim KPI-jima
 *
 * Modul je singleton: postoji JEDNA mapa u aplikaciji (varijable ispod).
 */

import L from 'leaflet';
import {
  NETWORK_STATIONS,
  NETWORK_LINKS,
  DISTRICT_META,
} from './stations';
import type {
  StationStatus,
  MapStation,
  MapLink,
  KpiCellLike,
  DistrictMeta,
} from './stations';

export type { StationStatus, MapStation, MapLink, KpiCellLike, DistrictMeta };
export { NETWORK_STATIONS, NETWORK_LINKS, DISTRICT_META };

// ── Modulsko stanje (jedna mapa u celoj aplikaciji) ──
let map: L.Map | null = null;                                    // Leaflet instanca
let districtLayer: L.GeoJSON | null = null;                      // sloj sa 30 poligona okruga
let stationMarkers: Record<string, L.CircleMarker> = {};         // markeri stanica (ključ = stationId)
let linkPolylines: L.Polyline[] = [];                            // nacrtane linije linkova
let selectedRegionId: string | null = null;                      // trenutno selektovan okrug (null = nema selekcije)
let lastStatuses: Record<string, StationStatus> = {};            // status svake stanice iz poslednjeg KPI snapshot-a
const linkStatusIndex: Record<string, StationStatus> = {};       // status po linku (ključ "from->to")

const GEOJSON_URL = '/serbia-districts.geojson'; // geometija okruga (iz public/)

/** Svojstva jednog okruga unutar GeoJSON fajla (format koji sami definišemo). */
interface DistrictFeatureProps {
  regionId: string;    // ID okruga (ključ DISTRICT_META u stations.ts)
  regionName: string;  // ime za prikaz
  centerCity: string;  // administrativni centar
  macroRegion: string; // makroregion
  fill: string;        // boja ispune
}

// ── Čiste pomoćne funkcije (koriste ih i testovi) ──

/** Boja za dati status — ista paleta koju koristi ceo dashboard. */
export function statusColor(status: StationStatus): string {
  switch (status) {
    case 'GOOD': return '#10b981';
    case 'WARNING': return '#f59e0b';
    case 'BAD': return '#ef4444';
    default: return '#6b7280';
  }
}

/** Vraća "gori" od dva statusa (BAD > WARNING > GOOD > UNKNOWN). */
export function worstStatus(a: StationStatus, b: StationStatus): StationStatus {
  const rank: Record<StationStatus, number> = { BAD: 3, WARNING: 2, GOOD: 1, UNKNOWN: 0 };
  return rank[a] >= rank[b] ? a : b;
}

/**
 * Izvodí status jedne stanice iz KPI-jeva SVIH njenih ćelija.
 * Pragovi: BAD ako drop>3% ILI accessFail>5% ILI integritet<95%;
 *          WARNING ako drop>1.5% ILI accessFail>2% ILI integritet<97%.
 * Status stanice = najgori status njene ćelije (lanac je jak kao najslabija karika).
 */
export function deriveStationStatus(stationId: string, kpiData: KpiCellLike[]): StationStatus {
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

/** Status linka = gori status od dve stanice koje povezuje. */
export function linkStatus(from: StationStatus, to: StationStatus): StationStatus {
  return worstStatus(from, to);
}

/** Boja linije linka: prvo gleda status, pa tek onda tip veze. */
export function linkStroke(link: MapLink, status: StationStatus): string {
  if (status === 'BAD') return '#ef4444';
  if (status === 'WARNING') return '#f59e0b';
  if (link.type === 'backhaul') return '#0ea5e9';
  if (link.type === 'fiber') return '#38bdf8';
  return '#64748b';
}

/** Nađe stanicu po ID-ju (linearna pretraga — 32 stanice, pa je brzina nebitna). */
export function stationById(id: string): MapStation | undefined {
  return NETWORK_STATIONS.find(s => s.id === id);
}

/** Status po linku — ključ "from->to". Koristi ga Transport domen na dashboardu. */
export function getLinkStatuses(): Record<string, StationStatus> {
  return { ...linkStatusIndex };
}

/**
 * KREIRANJE MAPE — zove ga app.ts jednom pri startu (lenjo, posle prvog rendera).
 * 1. poništi staru mapu ako postoji (re-init slučaj)
 * 2. napravi Leaflet mapu centriranu na Srbiju
 * 3. dodaj OSM tile sloj
 * 4. veži klik na prazan prostor = izlaz iz selekcije okruga
 * 5. asinhrono povuci okruge + odmah nacrtaj linkove i stanice (prazni statusi)
 */
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
    attributionControl: true,
    boxZoom: false
  });

  // NEXUS dark tiles — deep navy with subtle roads, perfect for glowing overlays
  L.tileLayer('https://{s}.basemaps.cartocdn.com/dark_all/{z}/{x}/{y}{r}.png', {
    attribution: '&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a> &copy; <a href="https://carto.com/">CARTO</a>',
    subdomains: 'abcd',
    maxZoom: 19,
    errorTileUrl: 'data:image/gif;base64,R0lGODlhAQABAAD/ACwAAAAAAQABAAACADs='
  }).addTo(map);

  // Klik na prazan prostor mape (van svih okruga) resetuje selekciju
  // i vraća prikaz cele Srbije.
  map.on('click', () => {
    if (selectedRegionId) clearRegionSelection();
  });

  // Render real district (okrug) boundaries from GeoJSON, then overlay links & stations.
  void loadDistrictBoundaries();
  renderLinks({});
  renderStations({});
}

/**
 * Učitava geometiju 30 okruga i pravi GeoJSON sloj.
 * Svaki poligon dobija: tooltip na hover, highlight na mouseover,
 * i klik-handler (selekcija / reset + CustomEvent za app.ts drawer).
 * Na kraju zoomuje da cela Srbija stane u vidno polje.
 */
async function loadDistrictBoundaries(): Promise<void> {
  if (!map) return;

  try {
    const res = await fetch(GEOJSON_URL);
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    const geojson = await res.json();

    if (districtLayer) {
      map.removeLayer(districtLayer);
      districtLayer = null;
    }

    // Podrazumevani izgled poligona: plava ivica + blaga ispuna bojom okruga
    const baseStyle = (props: DistrictFeatureProps): L.PathOptions => ({
      color: '#38bdf8',
      weight: 1.5,
      opacity: 0.9,
      fillColor: props.fill,
      fillOpacity: 0.18,
      className: 'district-boundary'
    });

    districtLayer = L.geoJSON(geojson, {
      style: (feature) => baseStyle(feature!.properties as DistrictFeatureProps),
      onEachFeature: (feature, layer) => {
        const props = feature.properties as DistrictFeatureProps;

        // Tooltip that shows on hover — district name + center city
        bindDistrictTooltip(layer, props);

        layer.on('mouseover', () => {
          if (selectedRegionId === props.regionId) return;
          (layer as L.Path).setStyle({
            fillOpacity: 0.45,
            weight: 3.5,
            color: '#f59e0b',
            opacity: 1
          });
          (layer as L.Path).bringToFront?.();
        });
        layer.on('mouseout', () => {
          applyDistrictStyles();
        });

        layer.on('click', (e) => {
          // Spreči da klik na region "prođe" do mape (map click = izlaz iz selekcije)
          L.DomEvent.stopPropagation(e);
          if (selectedRegionId === props.regionId) {
            clearRegionSelection();
          } else {
            selectRegion(props.regionId, true);
            window.dispatchEvent(new CustomEvent('noc:region-click', { detail: { regionId: props.regionId } }));
          }
        });
      }
    }).addTo(map);

    // Fit the view snugly to the real national boundary.
    map.fitBounds(districtLayer.getBounds(), { padding: [12, 12] });

    // Keep stations & links visually above the filled polygons.
    linkPolylines.forEach(l => l.bringToFront());
    Object.values(stationMarkers).forEach(m => m.bringToFront());
  } catch (err) {
    console.log('[v0] Failed to load district boundaries:', err);
  }
}

/**
 * Veže hover tooltip (ime okruga + centar) na poligon.
 * Izdvojeno u funkciju jer se tooltip tokom selekcije SKIDA,
 * a pri resetu selekcije vraća — pa je treba zvati iz dva mesta.
 */
function bindDistrictTooltip(layer: L.Layer, props: DistrictFeatureProps): void {
  layer.bindTooltip(
    `<strong>${props.regionName}</strong><br><span style="opacity:0.7">${props.centerCity} · ${props.macroRegion}</span>`,
    {
      sticky: true,
      direction: 'top',
      offset: [0, -8],
      className: 'district-tooltip'
    }
  );
}

/** Nađe Leaflet sloj trenutno selektovanog okruga (za fitBounds zoom). */
function selectedRegionLayer(): L.Layer | undefined {
  let found: L.Layer | undefined;
  districtLayer?.eachLayer(layer => {
    const props = (layer as L.Path & { feature?: { properties: DistrictFeatureProps } }).feature?.properties;
    if (props && selectedRegionId && props.regionId === selectedRegionId) found = layer;
  });
  return found;
}

/** Tip koji olakšava pristup .feature.properties sa Leaflet Path sloja. */
type DistrictPathLayer = L.Path & { feature?: { properties: DistrictFeatureProps } };

/**
 * Primeni stilove na SVE okruge prema trenutnoj selekciji:
 *  - selektovan  → crvena ivica + zelena ispuna (highlight)
 *  - ostali      → jedva vidljivi (da se zna da postoje, ali ne smetaju)
 *  - bez selekcije → podrazumevana plava
 * Zove se posle svakog mouseout-a i svake promene selekcije.
 */
function applyDistrictStyles(): void {
  districtLayer?.eachLayer(layer => {
    const path = layer as DistrictPathLayer;
    const props = path.feature?.properties;
    if (!props) return;

    const isSelected = selectedRegionId !== null && props.regionId === selectedRegionId;
    const isDimmed = selectedRegionId !== null && !isSelected;

    if (isSelected) {
      path.setStyle({
        color: '#ef4444',
        weight: 4,
        opacity: 1,
        fillColor: '#10b981',
        fillOpacity: 0.45
      });
        } else if (isDimmed) {
          path.setStyle({
            color: '#38bdf8',
            weight: 1,
            opacity: 0.25,
            fillColor: props.fill,
            fillOpacity: 0.06
          });
    } else {
      path.setStyle({
        color: '#38bdf8',
        weight: 1.5,
        opacity: 0.9,
        fillColor: props.fill,
        fillOpacity: 0.18
      });
    }

    // Leaflet čita CSS klasu SAMO pri kreiranju puta (setStyle je ne menja),
    // pa klasu menjamo direktno na DOM elementu da bi CSS pravila radila.
    const el = path.getElement() as HTMLElement | undefined;
    if (el) {
      if (isSelected) L.DomUtil.addClass(el, 'district-selected');
      else L.DomUtil.removeClass(el, 'district-selected');
      L.DomUtil.removeClass(el, 'district-dimmed');
    }
  });
}

/**
 * Selektuje okrug: highlight stil + skida njegov tooltip
 * + opciono zoomuje na njega + precrta linkove/stanice (samo te regije).
 */
function selectRegion(regionId: string, fit: boolean): void {
  selectedRegionId = regionId;
  // Only the district polygon itself is styled (green fill + red border via applyDistrictStyles);
  // no rectangular bounding box / frame rectangle is drawn around the area.
  applyDistrictStyles();

  // Remove the hover tooltip from the selected district — Leaflet's sticky
  // tooltip would otherwise stay pinned to the cursor as a floating box,
  // and the district info panel takes over showing details anyway.
  districtLayer?.eachLayer(layer => {
    const path = layer as DistrictPathLayer;
    const props = path.feature?.properties;
    if (props && props.regionId === regionId && path.getTooltip()) {
      path.closeTooltip();
      path.unbindTooltip();
    }
  });

  if (fit) {
    const layer = selectedRegionLayer();
    // Fit view to polygon bounds without drawing any bounding-box rectangle overlay
    if (layer) map?.fitBounds((layer as L.Polygon).getBounds(), { padding: [40, 40] });
  }
  renderLinks(lastStatuses);
  renderStations(lastStatuses);
}

/** Reset selekcije: svi okruzi nazad na podrazumevano, zoom na celu Srbiju. */
function clearRegionSelection(): void {
  selectedRegionId = null;
  applyDistrictStyles();

  // Restore hover tooltips removed during selection.
  districtLayer?.eachLayer(layer => {
    const path = layer as DistrictPathLayer;
    const props = path.feature?.properties;
    if (props && !path.getTooltip()) {
      bindDistrictTooltip(layer, props);
    }
  });

  if (districtLayer) map?.fitBounds(districtLayer.getBounds(), { padding: [12, 12] });
  renderLinks(lastStatuses);
  renderStations(lastStatuses);
}

/**
 * Precra SVIH linkova između stanica.
 * - briše stare linije i index statusa
 * - ako je okrug selektovan, crta samo linkove unutar njega
 * - boja linije = gori status dve stanice; isprekidano = mikrovalna
 * - upisuje status svakog linka u linkStatusIndex (čita Transport domen)
 */
function renderLinks(stationStatuses: Record<string, StationStatus>): void {
  if (!map) return;

  // Clear existing polylines
  linkPolylines.forEach(l => map?.removeLayer(l));
  linkPolylines = [];
  for (const k of Object.keys(linkStatusIndex)) delete linkStatusIndex[k];

  const inRegion = (station: MapStation): boolean =>
    !selectedRegionId || station.region === selectedRegionId;

  NETWORK_LINKS.forEach(link => {
    const from = stationById(link.from);
    const to = stationById(link.to);
    if (!from || !to) return;
    if (!inRegion(from) || !inRegion(to)) return;

    const status = linkStatus(
      stationStatuses[from.id] ?? 'UNKNOWN',
      stationStatuses[to.id] ?? 'UNKNOWN'
    );

    const color = linkStroke(link, status);
    linkStatusIndex[`${link.from}->${link.to}`] = status;
    const polyline = L.polyline([[from.lat, from.lon], [to.lat, to.lon]], {
      color,
      weight: link.type === 'backhaul' ? 3 : 2,
      opacity: 0.85,
      dashArray: link.type === 'mw' ? '6, 6' : undefined
    }).addTo(map!);

    linkPolylines.push(polyline);
  });
}

/**
 * Precra markere SVIH stanica (krugovi obojeni po statusu).
 * - ako je okrug selektovan, prikazuje samo njegove stanice
 * - klik na marker: CustomEvent za drawer + selekcija okruga
 *   + skrol na red te stanice u tabeli (plavi highlight 2s)
 */
function renderStations(stationStatuses: Record<string, StationStatus>): void {
  if (!map) return;

  // Clear existing markers
  Object.values(stationMarkers).forEach(m => map?.removeLayer(m));
  stationMarkers = {};

  NETWORK_STATIONS.forEach(station => {
    if (selectedRegionId && station.region !== selectedRegionId) return;
    const status = stationStatuses[station.id] ?? 'UNKNOWN';
    const color = statusColor(status);

    const marker = L.circleMarker([station.lat, station.lon], {
      radius: 7,
      fillColor: color,
      color: '#0f172a',
      weight: 2,
      opacity: 1,
      fillOpacity: 0.95
    }).addTo(map!);

    marker.on('click', (e) => {
      L.DomEvent.stopPropagation(e);
      window.dispatchEvent(new CustomEvent('noc:station-click', { detail: { stationId: station.id } }));
      if (selectedRegionId !== station.region) {
        selectRegion(station.region, true);
      }
      const row = document.querySelector(`tr[data-station="${station.id}"]`);
      row?.scrollIntoView({ behavior: 'smooth', block: 'center' });
      row?.classList.add('row-highlight');
      setTimeout(() => row?.classList.remove('row-highlight'), 2000);
    });

    stationMarkers[station.id] = marker;
  });
}

/**
 * JAVNI ULAZ za osvežavanje mape — zove ga app.ts posle svakog novog
 * KPI snapshot-a (prvo učitavanje + svaki SSE push na ~30s).
 * 1. izračuna status svake stanice iz KPI-ja (deriveStationStatus)
 * 2. precrta linkove i markere novim bojama
 * 3. ažurira statističke bedževe iznad mape (OK / Upozorenje / Kritično)
 */
export function updateNetworkMap(kpiData: KpiCellLike[]): void {
  if (!map) return;

  const statuses: Record<string, StationStatus> = {};
  NETWORK_STATIONS.forEach(s => {
    statuses[s.id] = deriveStationStatus(s.id, kpiData);
  });
  lastStatuses = statuses;

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
