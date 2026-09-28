const R = 6371;

function toRad(d) {
  return (d * Math.PI) / 180;
}

export function haversineKm(a, b) {
  const dLat = toRad(b[1] - a[1]);
  const dLon = toRad(b[0] - a[0]);
  const lat1 = toRad(a[1]);
  const lat2 = toRad(b[1]);
  const h = Math.sin(dLat / 2) ** 2 + Math.cos(lat1) * Math.cos(lat2) * Math.sin(dLon / 2) ** 2;
  return 2 * R * Math.asin(Math.min(1, Math.sqrt(h)));
}

function sampleArc(start, mid, end, steps = 18) {
  const circle = circleFromThree(start, mid, end);
  if (!circle) return [[end[0], end[1]]];
  const a0 = Math.atan2(start[1] - circle.y, start[0] - circle.x);
  const a1 = Math.atan2(mid[1] - circle.y, mid[0] - circle.x);
  const a2 = Math.atan2(end[1] - circle.y, end[0] - circle.x);
  const sweep = sweepThrough(a0, a1, a2);
  const points = [];
  for (let i = 1; i <= steps; i += 1) {
    const angle = a0 + sweep * (i / steps);
    points.push([circle.x + circle.r * Math.cos(angle), circle.y + circle.r * Math.sin(angle)]);
  }
  return points;
}

function circleFromThree(a, b, c) {
  const d = 2 * (a[0] * (b[1] - c[1]) + b[0] * (c[1] - a[1]) + c[0] * (a[1] - b[1]));
  if (Math.abs(d) < 1e-12) return null;
  const a2 = a[0] ** 2 + a[1] ** 2;
  const b2 = b[0] ** 2 + b[1] ** 2;
  const c2 = c[0] ** 2 + c[1] ** 2;
  const x = (a2 * (b[1] - c[1]) + b2 * (c[1] - a[1]) + c2 * (a[1] - b[1])) / d;
  const y = (a2 * (c[0] - b[0]) + b2 * (a[0] - c[0]) + c2 * (b[0] - a[0])) / d;
  return { x, y, r: Math.hypot(a[0] - x, a[1] - y) };
}

function sweepThrough(a0, a1, a2) {
  const norm = (value) => {
    const turn = ((value % (Math.PI * 2)) + Math.PI * 2) % (Math.PI * 2);
    return turn > Math.PI ? turn - Math.PI * 2 : turn;
  };
  const mid = norm(a1 - a0);
  const end = norm(a2 - a0);
  if (mid === 0 || end === 0) return end;
  return Math.sign(mid) === Math.sign(end) || Math.abs(end) > Math.abs(mid) ? end : end - Math.sign(end) * Math.PI * 2;
}

function bezier(p0, p1, p2, p3, t) {
  const u = 1 - t;
  return [
    u ** 3 * p0[0] + 3 * u ** 2 * t * p1[0] + 3 * u * t ** 2 * p2[0] + t ** 3 * p3[0],
    u ** 3 * p0[1] + 3 * u ** 2 * t * p1[1] + 3 * u * t ** 2 * p2[1] + t ** 3 * p3[1],
  ];
}

export function densifyCurvePath(parts) {
  const points = [];
  let current = null;
  parts.forEach((part) => {
    if (Array.isArray(part)) {
      current = [part[0], part[1]];
      points.push(current);
      return;
    }
    if (!current) return;
    if (part.c) {
      const end = part.c[0];
      const mid = part.c[1] || end;
      points.push(...sampleArc(current, mid, end));
      current = [end[0], end[1]];
      return;
    }
    if (part.a) {
      const end = part.a[0];
      const center = part.a[1];
      const startAngle = Math.atan2(current[1] - center[1], current[0] - center[0]);
      const endAngle = Math.atan2(end[1] - center[1], end[0] - center[0]);
      const clockwise = part.a[3] === 1;
      let sweep = endAngle - startAngle;
      if (clockwise && sweep > 0) sweep -= Math.PI * 2;
      if (!clockwise && sweep < 0) sweep += Math.PI * 2;
      const radius = Math.hypot(current[0] - center[0], current[1] - center[1]);
      for (let i = 1; i <= 18; i += 1) {
        const angle = startAngle + sweep * (i / 18);
        points.push([center[0] + radius * Math.cos(angle), center[1] + radius * Math.sin(angle)]);
      }
      current = [end[0], end[1]];
      return;
    }
    if (part.b) {
      const [c1, c2, end] = part.b;
      for (let i = 1; i <= 16; i += 1) points.push(bezier(current, c1, c2, end, i / 16));
      current = [end[0], end[1]];
    }
  });
  return points;
}

export function toLonLat(x, y) {
  if (!Number.isFinite(x) || !Number.isFinite(y)) return null;
  if (Math.abs(x) <= 180 && Math.abs(y) <= 90) return [x, y];
  const origin = 20037508.342789244;
  const lon = (x / origin) * 180;
  const lat = (180 / Math.PI) * (2 * Math.atan(Math.exp((y / origin) * Math.PI)) - Math.PI / 2);
  return [lon, lat];
}

function asLonLatPath(path) {
  return path.map((point) => toLonLat(point[0], point[1])).filter(Boolean);
}

export function flattenPaths(geometry) {
  if (geometry?.curvePaths?.length) {
    return geometry.curvePaths.map((part) => asLonLatPath(densifyCurvePath(part))).filter((path) => path.length > 1);
  }
  const paths = geometry?.paths || [];
  return paths.map((path) => asLonLatPath(path)).filter((path) => path.length > 1);
}

function endpointKey(pt) {
  return `${pt[0].toFixed(5)},${pt[1].toFixed(5)}`;
}

/** Order path fragments so measures run continuously along the route. */
export function chainPaths(paths) {
  if (!paths.length) return [];
  const unused = paths.map((p) => p.slice());
  let chain = unused.shift();
  while (unused.length) {
    const head = chain[0];
    const tail = chain[chain.length - 1];
    let best = { i: -1, reverse: false, attach: "tail", dist: Infinity };
    unused.forEach((path, i) => {
      const a = path[0];
      const b = path[path.length - 1];
      const options = [
        { dist: haversineKm(tail, a), reverse: false, attach: "tail" },
        { dist: haversineKm(tail, b), reverse: true, attach: "tail" },
        { dist: haversineKm(head, b), reverse: false, attach: "head" },
        { dist: haversineKm(head, a), reverse: true, attach: "head" },
      ];
      options.forEach((opt) => {
        if (opt.dist < best.dist) best = { i, ...opt };
      });
    });
    if (best.i < 0) break;
    let next = unused.splice(best.i, 1)[0];
    if (best.reverse) next = next.slice().reverse();
    if (best.attach === "tail") chain = chain.concat(next.slice(1));
    else chain = next.concat(chain.slice(1));
  }
  return chain;
}

export function buildRoute(features) {
  const paths = [];
  features.forEach((f) => paths.push(...flattenPaths(f.geometry)));
  const vertices = chainPaths(paths);
  const measures = [0];
  for (let i = 1; i < vertices.length; i += 1) {
    measures.push(measures[i - 1] + haversineKm(vertices[i - 1], vertices[i]));
  }
  const segments = features.map((f) => {
    const pts = chainPaths(flattenPaths(f.geometry));
    if (pts.length < 2) return null;
    const located = pts.map((pt) => locateOnRoute(vertices, measures, pt, 2));
    const ms = located.filter(Boolean).map((hit) => hit.measure);
    if (!ms.length) return null;
    return {
      from: Math.min(...ms),
      to: Math.max(...ms),
      status: f.attributes.status || "Unknown",
      roadClass: f.attributes.class || "Road",
      id: f.attributes.new_id,
    };
  }).filter(Boolean);
  return {
    vertices,
    measures,
    lengthKm: measures[measures.length - 1] || 0,
    segments,
  };
}

export function projectSegment(a, b, p) {
  const ax = a[0];
  const ay = a[1];
  const bx = b[0];
  const by = b[1];
  const dx = bx - ax;
  const dy = by - ay;
  const len2 = dx * dx + dy * dy;
  let t = len2 === 0 ? 0 : ((p[0] - ax) * dx + (p[1] - ay) * dy) / len2;
  t = Math.max(0, Math.min(1, t));
  const x = ax + t * dx;
  const y = ay + t * dy;
  return { point: [x, y], t };
}

export function locateOnRoute(vertices, measures, point, maxKm = 0.12) {
  if (!vertices?.length) return null;
  let best = null;
  const step = vertices.length > 4000 ? 4 : 1;
  for (let i = 0; i < vertices.length - 1; i += step) {
    const j = Math.min(vertices.length - 1, i + step);
    const proj = projectSegment(vertices[i], vertices[j], point);
    const dist = haversineKm(point, proj.point);
    if (!best || dist < best.distanceKm) {
      const m0 = measures[i];
      const m1 = measures[j];
      best = {
        distanceKm: dist,
        measure: m0 + (m1 - m0) * proj.t,
        point: proj.point,
        index: i,
      };
    }
  }
  if (step > 1 && best) {
    const start = Math.max(0, best.index - step);
    const end = Math.min(vertices.length - 2, best.index + step);
    for (let i = start; i <= end; i += 1) {
      const proj = projectSegment(vertices[i], vertices[i + 1], point);
      const dist = haversineKm(point, proj.point);
      if (dist < best.distanceKm) {
        best = {
          distanceKm: dist,
          measure: measures[i] + (measures[i + 1] - measures[i]) * proj.t,
          point: proj.point,
          index: i,
        };
      }
    }
  }
  if (!best || best.distanceKm > maxKm) return null;
  return best;
}

export function pointAtMeasure(vertices, measures, measure) {
  if (!vertices.length) return null;
  if (measure <= 0) return vertices[0];
  const last = measures[measures.length - 1];
  if (measure >= last) return vertices[vertices.length - 1];
  let lo = 0;
  let hi = measures.length - 1;
  while (lo < hi - 1) {
    const mid = (lo + hi) >> 1;
    if (measures[mid] < measure) lo = mid;
    else hi = mid;
  }
  const span = measures[hi] - measures[lo] || 1;
  const t = (measure - measures[lo]) / span;
  const a = vertices[lo];
  const b = vertices[hi];
  return [a[0] + (b[0] - a[0]) * t, a[1] + (b[1] - a[1]) * t];
}

export function sliceVertices(vertices, measures, from, to) {
  const start = pointAtMeasure(vertices, measures, from);
  const end = pointAtMeasure(vertices, measures, to);
  const middle = [];
  for (let i = 0; i < measures.length; i += 1) {
    if (measures[i] > from && measures[i] < to) middle.push(vertices[i]);
  }
  return [start, ...middle, end].filter(Boolean);
}

export function lineMeasureSpan(vertices, measures, paths, maxKm) {
  const hits = [];
  paths.forEach((path) => {
    const stride = Math.max(1, Math.floor(path.length / 24));
    for (let i = 0; i < path.length; i += stride) {
      const hit = locateOnRoute(vertices, measures, path[i], maxKm);
      if (hit) hits.push(hit.measure);
    }
    const hit = locateOnRoute(vertices, measures, path[path.length - 1], maxKm);
    if (hit) hits.push(hit.measure);
  });
  if (hits.length < 2) return null;
  const from = Math.min(...hits);
  const to = Math.max(...hits);
  if (to - from < 0.02) return null;
  return { from, to };
}

export function polygonCrossings(route, rings) {
  const hits = [];
  route.vertices.forEach((pt, i) => {
    if (pointInRings(pt, rings)) hits.push(route.measures[i]);
  });
  if (!hits.length) return null;
  hits.sort((a, b) => a - b);
  const spans = [];
  let from = hits[0];
  let prev = hits[0];
  hits.forEach((m) => {
    if (m - prev > 1.5) {
      spans.push({ from, to: prev });
      from = m;
    }
    prev = m;
  });
  spans.push({ from, to: prev });
  return spans.filter((s) => s.to - s.from > 0.05);
}

function pointInRings(point, rings) {
  return rings.some((ring) => pointInRing(point, ring));
}

function pointInRing(point, ring) {
  let inside = false;
  for (let i = 0, j = ring.length - 1; i < ring.length; j = i, i += 1) {
    const xi = ring[i][0];
    const yi = ring[i][1];
    const xj = ring[j][0];
    const yj = ring[j][1];
    const intersect = yi > point[1] !== yj > point[1] && point[0] < ((xj - xi) * (point[1] - yi)) / (yj - yi + 0.0) + xi;
    if (intersect) inside = !inside;
  }
  return inside;
}

export { endpointKey };
