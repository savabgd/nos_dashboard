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
      weight: 1.2,
      opacity: 0.85,
      fillColor: props.fill,
      fillOpacity: 0.18
    });

    districtLayer = L.geoJSON(geojson, {
      style: (feature) => baseStyle(feature!.properties as DistrictFeatureProps),
      onEachFeature: (feature, layer) => {
        const props = feature.properties as DistrictFeatureProps;
        const stationsInDistrict = NETWORK_STATIONS.filter(s => s.region === props.regionId).length;

        layer.bindTooltip(`
          <div style="font-family:'Inter',sans-serif;">
            <strong style="color:#f8fafc;font-size:0.88rem;">${props.regionName}</strong><br/>
            <span style="color:#94a3b8;font-size:0.78rem;">Upravni centar: ${props.centerCity}</span><br/>
            <span style="color:#94a3b8;font-size:0.78rem;">Regija: ${props.macroRegion}</span><br/>
            <span style="color:#38bdf8;font-size:0.78rem;font-weight:600;">Stanica: ${stationsInDistrict}</span>
          </div>
        `, { sticky: true, opacity: 0.95 });

        layer.on('mouseover', () => {
          (layer as L.Path).setStyle({ fillOpacity: 0.4, weight: 2.5, color: '#f59e0b' });
        });
        layer.on('mouseout', () => {
          (layer as L.Path).setStyle(baseStyle(props));
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
    const district = DISTRICT_META[station.region];

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
