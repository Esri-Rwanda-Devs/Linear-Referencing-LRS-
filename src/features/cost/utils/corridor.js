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

/** Where the straight line through origin and end meets a road segment. */
function lineMeetsSegment(origin, end, start, stop) {
  const rx = end[0] - origin[0];
  const ry = end[1] - origin[1];
  const sx = stop[0] - start[0];
  const sy = stop[1] - start[1];
  const denom = rx * sy - ry * sx;
  if (Math.abs(denom) < 1e-14) return null;
  const qx = start[0] - origin[0];
  const qy = start[1] - origin[1];
  const along = (qx * sy - qy * sx) / denom;
  const across = (qx * ry - qy * rx) / denom;
  if (across < -1e-6 || across > 1 + 1e-6) return null;
  return [origin[0] + along * rx, origin[1] + along * ry];
}

/** Move only the end of the reserve onto the road, along the direction it was drawn. */
export function attachEndOnRoad(vertices, roadVertices) {
  if (!vertices || vertices.length < 2 || !roadVertices || roadVertices.length < 2) return vertices || [];
  const origin = vertices[vertices.length - 2];
  const end = vertices[vertices.length - 1];
  if (lineLengthM(origin, end) < 0.5) return vertices;
  let best = null;
  for (let index = 0; index < roadVertices.length - 1; index += 1) {
    const point = lineMeetsSegment(origin, end, roadVertices[index], roadVertices[index + 1]);
    if (!point) continue;
    const distance = lineLengthM(end, point);
    if (!best || distance < best.distance) best = { distance, point };
  }
  if (!best) return vertices;
  const next = vertices.map((point) => [point[0], point[1]]);
  next[next.length - 1] = best.point;
  return next;
}

/** The part of the road between the new reserve's start and end, so the reserve lies on the road. */
export function alignOverRoad(vertices, roadVertices) {
  if (!vertices || vertices.length < 2 || !roadVertices || roadVertices.length < 2) return null;
  const from = locateOnPath(roadVertices, vertices[0]);
  const to = locateOnPath(roadVertices, vertices[vertices.length - 1]);
  if (!from || !to || Math.abs(from.along - to.along) < 1) return null;
  const forward = from.along <= to.along;
  const start = forward ? from : to;
  const end = forward ? to : from;
  const path = [[start.point[0], start.point[1]]];
  for (let index = start.index + 1; index <= end.index; index += 1) path.push([roadVertices[index][0], roadVertices[index][1]]);
  if (lineLengthM(path[path.length - 1], end.point) > 0.5) path.push([end.point[0], end.point[1]]);
  const cleaned = path.filter((point, index) => index === 0 || lineLengthM(path[index - 1], point) >= 0.5);
  if (cleaned.length < 2) return null;
  return forward ? cleaned : cleaned.reverse();
}

function locateOnPath(vertices, point) {
  if (!vertices || vertices.length < 2 || !point) return null;
  let best = null;
  let travelled = 0;
  for (let index = 0; index < vertices.length - 1; index += 1) {
    const start = vertices[index];
    const end = vertices[index + 1];
    const dx = end[0] - start[0];
    const dy = end[1] - start[1];
    const length2 = dx * dx + dy * dy || 1e-12;
    const t = Math.max(0, Math.min(1, ((point[0] - start[0]) * dx + (point[1] - start[1]) * dy) / length2));
    const projected = [start[0] + dx * t, start[1] + dy * t];
    const distance = lineLengthM(projected, point);
    const along = travelled + lineLengthM(start, projected);
    if (!best || distance < best.distance) best = { distance, point: projected, index, along };
    travelled += lineLengthM(start, end);
  }
  return best;
}

/** Pull a point onto the road. Ends are always attached; other points attach only when they are already near the road. */
export function snappedRoadPoint(roadVertices, point, { force = false, snapM = 80 } = {}) {
  const near = closestOnPath(roadVertices, point);
  if (!near) return point;
  if (force || near.distance <= snapM) return near.point;
  return point;
}

/** The new road starts and ends on the selected road. A middle point within snapM is placed on the road too. */
export function attachAlignment(vertices, roadVertices, snapM = 80) {
  if (!vertices?.length || !roadVertices || roadVertices.length < 2) return vertices || [];
  return vertices.map((point, index) => snappedRoadPoint(roadVertices, point, {
    force: index === 0 || index === vertices.length - 1,
    snapM,
  }));
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

export function simplifyRing(ring, max = 64) {
  if (!ring?.length) return [];
  const closed = ring.length > 1 && ring[0][0] === ring[ring.length - 1][0] && ring[0][1] === ring[ring.length - 1][1];
  const open = (closed ? ring.slice(0, -1) : ring).map((point) => [point[0], point[1]]);
  if (open.length <= max) return open;
  const step = Math.ceil(open.length / max);
  return open.filter((_, index) => index % step === 0);
}

export function pointInRing(point, ring) {
  if (!point || !ring || ring.length < 3) return false;
  let inside = false;
  for (let index = 0, previous = ring.length - 1; index < ring.length; previous = index, index += 1) {
    const start = ring[index];
    const end = ring[previous];
    const crosses = (start[1] > point[1]) !== (end[1] > point[1])
      && point[0] < ((end[0] - start[0]) * (point[1] - start[1])) / ((end[1] - start[1]) || 1e-12) + start[0];
    if (crosses) inside = !inside;
  }
  return inside;
}

function segmentsCross(a, b, c, d) {
  const side = (start, end, point) => (end[0] - start[0]) * (point[1] - start[1]) - (end[1] - start[1]) * (point[0] - start[0]);
  const ab = side(a, b, c);
  const cd = side(a, b, d);
  const ac = side(c, d, a);
  const bd = side(c, d, b);
  return ((ab > 0 && cd < 0) || (ab < 0 && cd > 0)) && ((ac > 0 && bd < 0) || (ac < 0 && bd > 0));
}

/** Metres from the drawn road to a point or a ring. Zero means the road crosses it. */
export function distanceToPathM(path, target) {
  if (!path || path.length < 2 || !target) return null;
  if (typeof target[0] === "number") return closestOnPath(path, target)?.distance ?? null;
  const ring = target;
  if (ring.length < 3) return null;
  if (path.some((point) => pointInRing(point, ring))) return 0;
  for (let index = 1; index < path.length; index += 1) {
    for (let edge = 1; edge < ring.length; edge += 1) {
      if (segmentsCross(path[index - 1], path[index], ring[edge - 1], ring[edge])) return 0;
    }
    if (segmentsCross(path[index - 1], path[index], ring[ring.length - 1], ring[0])) return 0;
  }
  let best = null;
  ring.forEach((point) => {
    const near = closestOnPath(path, point);
    if (near && (best == null || near.distance < best)) best = near.distance;
  });
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

/** Continuous reserve band along a polyline (full width in metres). */
export function corridorRing(path, widthM) {
  const points = (path || []).filter((point) => point?.length >= 2);
  if (points.length < 2) return [];
  if (points.length === 2) return rectangleRing(points[0], points[1], widthM);
  const half = Math.max(Number(widthM) || 0, 0.1) / 2;
  const left = [];
  const right = [];
  for (let index = 0; index < points.length; index += 1) {
    const prev = points[Math.max(0, index - 1)];
    const next = points[Math.min(points.length - 1, index + 1)];
    const heading = bearing(
      index === 0 ? points[0] : prev,
      index === points.length - 1 ? points[points.length - 1] : next,
    );
    const at = points[index];
    left.push(destination(at[0], at[1], heading - 90, half));
    right.push(destination(at[0], at[1], heading + 90, half));
  }
  return [...left, ...right.reverse(), left[0]];
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
