/**
 * Network map of Serbia — Powered by Leaflet.js with OpenStreetMap (OSM) tile layer,
 * high-definition district boundaries for all 30 official okruga, real-time base station status, and network links.
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

let map: L.Map | null = null;
let districtLayer: L.GeoJSON | null = null;
let stationMarkers: Record<string, L.CircleMarker> = {};
let linkPolylines: L.Polyline[] = [];
let selectedRegionId: string | null = null;
let lastStatuses: Record<string, StationStatus> = {};
const linkStatusIndex: Record<string, StationStatus> = {};

const GEOJSON_URL = '/serbia-districts.geojson';

interface DistrictFeatureProps {
  regionId: string;
  regionName: string;
  centerCity: string;
  macroRegion: string;
  fill: string;
}

export function statusColor(status: StationStatus): string {
  switch (status) {
    case 'GOOD': return '#10b981';
    case 'WARNING': return '#f59e0b';
    case 'BAD': return '#ef4444';
    default: return '#6b7280';
  }
}

export function worstStatus(a: StationStatus, b: StationStatus): StationStatus {
  const rank: Record<StationStatus, number> = { BAD: 3, WARNING: 2, GOOD: 1, UNKNOWN: 0 };
  return rank[a] >= rank[b] ? a : b;
}

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

export function linkStatus(from: StationStatus, to: StationStatus): StationStatus {
  return worstStatus(from, to);
}

export function linkStroke(link: MapLink, status: StationStatus): string {
  if (status === 'BAD') return '#ef4444';
  if (status === 'WARNING') return '#f59e0b';
  if (link.type === 'backhaul') return '#0ea5e9';
  if (link.type === 'fiber') return '#38bdf8';
  return '#64748b';
}

export function stationById(id: string): MapStation | undefined {
  return NETWORK_STATIONS.find(s => s.id === id);
}

/** Status po linku — ključ "from->to". Koristi ga Transport domen na dashboardu. */
export function getLinkStatuses(): Record<string, StationStatus> {
  return { ...linkStatusIndex };
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
    attributionControl: true,
    boxZoom: false
  });

  // Standard OpenStreetMap tiles, with a graceful placeholder for any tile that fails
  L.tileLayer('https://tile.openstreetmap.org/{z}/{x}/{y}.png', {
    attribution: '&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a> contributors',
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
 * Loads accurate district boundary polygons from the bundled GeoJSON
 * (real geometry sourced from geoBoundaries) and renders them with Leaflet.
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
 * Binds the hover tooltip (district name + center city) to a district layer.
 * Extracted so it can be re-bound after a layer's tooltip is removed on selection.
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

function selectedRegionLayer(): L.Layer | undefined {
  let found: L.Layer | undefined;
  districtLayer?.eachLayer(layer => {
    const props = (layer as L.Path & { feature?: { properties: DistrictFeatureProps } }).feature?.properties;
    if (props && selectedRegionId && props.regionId === selectedRegionId) found = layer;
  });
  return found;
}

type DistrictPathLayer = L.Path & { feature?: { properties: DistrictFeatureProps } };

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

    // Leaflet's SVG renderer only reads `className` when a path is created
    // (setStyle never updates it), so state classes are managed on the DOM
    // element directly to make the CSS filters actually apply.
    const el = path.getElement() as HTMLElement | undefined;
    if (el) {
      if (isSelected) L.DomUtil.addClass(el, 'district-selected');
      else L.DomUtil.removeClass(el, 'district-selected');
      L.DomUtil.removeClass(el, 'district-dimmed');
    }
  });
}

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
