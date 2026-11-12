import { PARCEL_RATE_RWF } from "../../../config";
import { haversineKm } from "../../analysis/utils/geometry";

const EARTH_M = 6378137;

export function lineLengthM(start, end) {
  return haversineKm(start, end) * 1000;
}

export function pathLengthM(vertices) {
  if (!vertices || vertices.length < 2) return 0;
  let length = 0;
  for (let index = 1; index < vertices.length; index += 1) length += lineLengthM(vertices[index - 1], vertices[index]);
  return length;
}

export function appendVertex(vertices, point) {
  if (!point) return vertices || [];
  const current = vertices || [];
  const last = current[current.length - 1];
  if (last && lineLengthM(last, point) < 1) return current;
  return [...current, point];
}

/** Insert a bend when the click is close to the line and clear of an existing vertex. */
export function insertOnPath(vertices, point, maxM = 18) {
  if (!vertices || vertices.length < 2 || !point) return null;
  if (vertices.some((vertex) => lineLengthM(vertex, point) < 8)) return null;
  let best = null;
  for (let index = 0; index < vertices.length - 1; index += 1) {
    const start = vertices[index];
    const end = vertices[index + 1];
    for (let step = 1; step < 12; step += 1) {
      const t = step / 12;
      const sample = [start[0] + (end[0] - start[0]) * t, start[1] + (end[1] - start[1]) * t];
      const distance = lineLengthM(sample, point);
      if (!best || distance < best.distance) best = { distance, index: index + 1 };
    }
  }
  if (!best || best.distance > maxM) return null;
  const next = vertices.slice();
  next.splice(best.index, 0, point);
  return next;
}

export function closestOnPath(vertices, point) {
  if (!vertices || vertices.length < 2 || !point) return null;
  let best = null;
  for (let index = 0; index < vertices.length - 1; index += 1) {
    const start = vertices[index];
    const end = vertices[index + 1];
    const dx = end[0] - start[0];
    const dy = end[1] - start[1];
    const length2 = dx * dx + dy * dy || 1e-12;
    const t = Math.max(0, Math.min(1, ((point[0] - start[0]) * dx + (point[1] - start[1]) * dy) / length2));
    const projected = [start[0] + dx * t, start[1] + dy * t];
    const distance = lineLengthM(projected, point);
    if (!best || distance < best.distance) best = { distance: distance, point: projected };
  }
  return best;
}

export function applyRates(report, rates) {
  if (!report || report.error) return report;
  const landRate = Number(rates?.land) || 0;
  const buildingRate = Number(rates?.building) || 0;
  const compensationPct = Number(rates?.compensation) || 0;
  const contingencyPct = Number(rates?.contingency) || 0;
  if (
    report.landRate === landRate
    && report.buildingRate === buildingRate
    && report.compensationPct === compensationPct
    && report.contingencyPct === contingencyPct
    && report.totalCost != null
  ) return report;
  const parcels = (report.parcels || []).map((parcel) => ({ ...parcel, cost: parcel.sqm * landRate }));
  const buildings = (report.buildings || []).map((building) => ({ ...building, cost: (building.sqm || 0) * buildingRate }));
  const landCost = parcels.reduce((sum, parcel) => sum + parcel.cost, 0);
  const buildingCost = buildings.reduce((sum, building) => sum + building.cost, 0);
  const disturbance = (landCost + buildingCost) * compensationPct / 100;
  const contingency = (landCost + buildingCost + disturbance) * contingencyPct / 100;
  const compensation = disturbance + contingency;
  const parcelSqm = parcels.reduce((sum, parcel) => sum + parcel.sqm, 0);
  const buildingSqm = buildings.reduce((sum, building) => sum + (building.sqm || 0), 0);
  return {
    ...report,
    parcels,
    buildings,
    landRate,
    buildingRate,
    compensationPct,
    contingencyPct,
    disturbance,
    contingency,
    landCost,
    buildingCost,
    compensation,
    totalCost: landCost + buildingCost + compensation,
    parcelCost: landCost,
    parcelSqm,
    buildingSqm,
  };
}

function destination(lon, lat, bearingDeg, distanceM) {
  const distance = distanceM / EARTH_M;
  const bearing = (bearingDeg * Math.PI) / 180;
  const lat1 = (lat * Math.PI) / 180;
  const lon1 = (lon * Math.PI) / 180;
  const lat2 = Math.asin(Math.sin(lat1) * Math.cos(distance) + Math.cos(lat1) * Math.sin(distance) * Math.cos(bearing));
  const lon2 = lon1 + Math.atan2(
    Math.sin(bearing) * Math.sin(distance) * Math.cos(lat1),
    Math.cos(distance) - Math.sin(lat1) * Math.sin(lat2),
  );
  return [(lon2 * 180) / Math.PI, (lat2 * 180) / Math.PI];
}

function bearing(start, end) {
  const lat1 = (start[1] * Math.PI) / 180;
  const lat2 = (end[1] * Math.PI) / 180;
  const dLon = ((end[0] - start[0]) * Math.PI) / 180;
  const y = Math.sin(dLon) * Math.cos(lat2);
  const x = Math.cos(lat1) * Math.sin(lat2) - Math.sin(lat1) * Math.cos(lat2) * Math.cos(dLon);
  return ((Math.atan2(y, x) * 180) / Math.PI + 360) % 360;
}

/** Rectangle centred on the line. Width is the full width in metres. */
export function rectangleRing(start, end, widthM) {
  const heading = bearing(start, end);
  const half = Math.max(Number(widthM) || 0, 0.1) / 2;
  const left = destination(start[0], start[1], heading - 90, half);
  const rightStart = destination(start[0], start[1], heading + 90, half);
  const leftEnd = destination(end[0], end[1], heading - 90, half);
  const rightEnd = destination(end[0], end[1], heading + 90, half);
  return [left, leftEnd, rightEnd, rightStart, left];
}

export function formatSqm(value) {
  return `${new Intl.NumberFormat("en-RW", { maximumFractionDigits: 1 }).format(value || 0)} m²`;
}

export function formatMetre(value) {
  return `${new Intl.NumberFormat("en-RW", { maximumFractionDigits: 1 }).format(value || 0)} m`;
}

export function formatRwf(value) {
  return `${new Intl.NumberFormat("en-RW", { maximumFractionDigits: 0 }).format(Math.round(value || 0))} RWF`;
}

export function rateLabel() {
  return `${new Intl.NumberFormat("en-RW").format(PARCEL_RATE_RWF)} RWF / m²`;
}
