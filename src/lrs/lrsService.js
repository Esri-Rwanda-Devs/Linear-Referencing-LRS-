import { LRS, LRS_LAYER_DEFS, PORTAL, SNAP_METERS } from "../config";
import { buildRoute, flattenPaths, haversineKm, lineMeasureSpan, locateOnRoute, projectSegment, toLonLat } from "./geometry";

const ROUTE_FIELDS = ["routeid", "route_id", "routename", "route_name", "roadid", "road_id"];
const FROM_FIELDS = ["frommeasure", "from_measure", "beginmeasure", "fromm", "fromkm", "startmeasure", "measure"];
const TO_FIELDS = ["tomeasure", "to_measure", "endmeasure", "tom", "tokm", "endmeasure"];
const CODE_FIELDS = ["routecode", "route_code", "roadcode", "road_code", "routename", "route_name"];
const LABEL_FIELDS = ["name", "assetname", "asset_name", "eventname", "bridgename", "bridge_name", "culvertname", "stonename", "kmstone", "km_stone", "pointname", "pavementtype", "pavement_type", "draintype", "drain_type", "carriagewaytype", "carriageway_type", "speedlimit", "speed_limit", "speed", "type", "assettype", "asset_type", "description", "remarks", "routename", "route_name"];
const SKIP_LABEL = /globalid|objectid|guid|date|created|edited|user|shape|routeid|route_id|measure|^fid$/i;
const GUID = /^\{?[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}\}?$/i;

let session = null;

function loadModules(names) {
  return new Promise((resolve, reject) => {
    const run = () => window.require(names, (...mods) => resolve(mods), reject);
    if (window.require) run();
    else {
      const script = document.createElement("script");
      script.src = "https://js.arcgis.com/4.29/";
      script.onload = run;
      script.onerror = () => reject(new Error("ArcGIS API failed to load"));
      document.head.appendChild(script);
    }
  });
}

export function signInToLrs() {
  if (!session) {
    session = (async () => {
      const [Portal, IdentityManager] = await loadModules(["esri/portal/Portal", "esri/identity/IdentityManager"]);
      const portal = new Portal({ url: PORTAL });
      portal.authMode = "immediate";
      await portal.load();
      const credential = await IdentityManager.getCredential(`${LRS}`);
      return { token: credential.token, user: portal.user?.username || "" };
    })().catch((error) => {
      session = null;
      throw error;
    });
  }
  return session;
}

async function getJson(url) {
  const { token } = await signInToLrs();
  const join = url.includes("?") ? "&" : "?";
  const response = await fetch(`${url}${join}f=json&token=${encodeURIComponent(token)}`);
  const data = await response.json();
  if (data.error) throw new Error(data.error.message || "The LRS service refused the request");
  return data;
}

function pickField(fields, candidates, fallback = null) {
  const usable = fields.filter((field) => !/globalid|objectid/i.test(field.name));
  const names = usable.map((field) => field.name);
  const lower = names.map((name) => name.toLowerCase());
  for (const candidate of candidates) {
    const index = lower.indexOf(candidate);
    if (index >= 0) return names[index];
  }
  return fallback ? names.find((name) => fallback.test(name)) || null : null;
}

function usableLabel(value) {
  if (value === null || value === undefined) return "";
  const text = String(value).trim();
  return text && !GUID.test(text) ? text : "";
}

function titleOf(attributes, routeField, fallbackTitle = "Event") {
  const keys = Object.keys(attributes);
  for (const field of LABEL_FIELDS) {
    const key = keys.find((name) => name.toLowerCase() === field);
    const text = key ? usableLabel(attributes[key]) : "";
    if (text) return text;
  }
  const fallback = keys.find((name) => name !== routeField && !SKIP_LABEL.test(name) && typeof attributes[name] === "string" && usableLabel(attributes[name]));
  return fallback ? usableLabel(attributes[fallback]) : fallbackTitle;
}

function fieldsOf(features) {
  const sample = features[0]?.attributes || {};
  return Object.keys(sample).map((name) => ({
    name,
    type: typeof sample[name] === "number" ? "esriFieldTypeDouble" : "esriFieldTypeString",
  }));
}

const PAGE_SIZE = 2000;
const ROAD_ID = LRS_LAYER_DEFS.find((def) => def.route)?.id;
const MAX_PARALLEL = 6;
const CACHE_TTL_MS = 6 * 60 * 60 * 1000;
const CACHE_DB = "rwanda-lrs-cache";
const CACHE_STORE = "layers";

let active = 0;
const waiting = [];
async function limited(task, priority = 0) {
  if (active >= MAX_PARALLEL) {
    await new Promise((resolve) => {
      const at = waiting.findIndex((item) => item.priority < priority);
      waiting.splice(at < 0 ? waiting.length : at, 0, { resolve, priority });
    });
  }
  active += 1;
  try {
    return await task();
  } finally {
    active -= 1;
    waiting.shift()?.resolve();
  }
}

function openCache() {
  return new Promise((resolve, reject) => {
    if (!window.indexedDB) {
      reject(new Error("IndexedDB unavailable"));
      return;
    }
    const request = indexedDB.open(CACHE_DB, 1);
    request.onupgradeneeded = () => request.result.createObjectStore(CACHE_STORE);
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error);
  });
}

async function cacheGet(key) {
  try {
    const db = await openCache();
    return await new Promise((resolve) => {
      const request = db.transaction(CACHE_STORE).objectStore(CACHE_STORE).get(key);
      request.onsuccess = () => resolve(request.result || null);
      request.onerror = () => resolve(null);
    });
  } catch {
    return null;
  }
}

async function cachePut(key, value) {
  try {
    const db = await openCache();
    db.transaction(CACHE_STORE, "readwrite").objectStore(CACHE_STORE).put(value, key);
  } catch {
    /* caching is best effort */
  }
}

/** Drops the local layer cache so the next load reads everything from the server. */
export async function clearLayerCache() {
  try {
    const db = await openCache();
    db.transaction(CACHE_STORE, "readwrite").objectStore(CACHE_STORE).clear();
  } catch {
    /* nothing cached */
  }
}

async function countFeatures(layerId) {
  const { token } = await signInToLrs();
  const query = new URLSearchParams({ f: "json", token, where: "1=1", returnCountOnly: "true" });
  const response = await limited(() => fetch(`${LRS}/${layerId}/query?${query}`), layerId === ROAD_ID ? 1 : 0);
  const data = await response.json();
  return Number(data.count) || 0;
}

async function downloadFeatures(def) {
  const params = {
    where: "1=1",
    outFields: "*",
    returnGeometry: "true",
    outSR: "4326",
    geometryPrecision: "6",
    resultRecordCount: String(PAGE_SIZE),
    ...(def.kind === "point" ? {} : { returnTrueCurves: "true" }),
  };
  const first = await queryFeatures(def.id, { ...params, resultOffset: "0" });
  if (!first.exceeded || !first.features.length) return first.features;
  const pageSize = first.features.length;
  const total = await countFeatures(def.id).catch(() => 0);
  if (!total) {
    const features = [...first.features];
    let offset = pageSize;
    for (let page = 0; page < 100; page += 1) {
      const batch = await queryFeatures(def.id, { ...params, resultOffset: String(offset) });
      features.push(...batch.features);
      if (!batch.exceeded || !batch.features.length) break;
      offset += batch.features.length;
    }
    return features;
  }
  const offsets = [];
  for (let offset = pageSize; offset < total; offset += pageSize) offsets.push(offset);
  const pages = await Promise.all(offsets.map((offset) => queryFeatures(def.id, { ...params, resultOffset: String(offset), resultRecordCount: String(pageSize) })));
  return first.features.concat(...pages.map((page) => page.features));
}

async function fetchLayerOnce(def) {
  const started = performance.now();
  const { user } = await signInToLrs();
  const key = `${LRS}/${def.id}|${user}`;
  const cached = await cacheGet(key);
  let features;
  let source = "server";
  if (cached && Date.now() - cached.savedAt < CACHE_TTL_MS && Array.isArray(cached.features)) {
    features = cached.features;
    source = "local cache";
  } else {
    features = await downloadFeatures(def);
    cachePut(key, { savedAt: Date.now(), features });
  }
  console.info(`[LRS] ${def.title}: ${features.length} features from ${source} in ${Math.round(performance.now() - started)} ms`);
  const fields = fieldsOf(features);
  const oidField = Object.keys(features[0]?.attributes || {}).find((name) => /objectid/i.test(name)) || "OBJECTID";
  return {
    id: def.id,
    name: def.title,
    features,
    fields,
    oidField,
    geometryType: def.kind === "point" ? "point" : "polyline",
    routeField: pickField(fields, ROUTE_FIELDS, /routeid/i),
    fromField: pickField(fields, FROM_FIELDS),
    toField: pickField(fields, TO_FIELDS),
    def,
  };
}

const loadedLayers = [];
const layerListeners = new Set();

export function subscribeLayers(listener) {
  loadedLayers.forEach(listener);
  layerListeners.add(listener);
  return () => layerListeners.delete(listener);
}

function publishLayer(layer) {
  loadedLayers.push(layer);
  layerListeners.forEach((listener) => listener(layer));
}

const layerPromises = new Map();
function layerOf(def) {
  if (!layerPromises.has(def.id)) {
    layerPromises.set(def.id, fetchLayerOnce(def)
      .catch((error) => {
        console.error(def.title, error);
        return { id: def.id, name: def.title, features: [], fields: [], oidField: "OBJECTID", geometryType: def.kind === "point" ? "point" : "polyline", routeField: null, fromField: null, toField: null, def };
      })
      .then((layer) => {
        publishLayer(layer);
        return layer;
      }));
  }
  return layerPromises.get(def.id);
}

const ROAD_DEF = LRS_LAYER_DEFS.find((def) => def.route);

/** Road Network alone: enough for the route list, route geometry and nearest-road analysis. */
async function roadNetwork() {
  const centerline = await layerOf(ROAD_DEF);
  if (!centerline.features.length) throw new Error("Road Network was not loaded");
  return centerline;
}

let described = null;
function service() {
  if (!described) {
    const ordered = [ROAD_DEF, ...LRS_LAYER_DEFS.filter((def) => !def.route && def.kind === "point"), ...LRS_LAYER_DEFS.filter((def) => !def.route && def.kind !== "point")];
    described = Promise.all(ordered.map(layerOf)).then(async (layers) => ({ layers, centerline: await roadNetwork() }));
  }
  return described;
}

async function queryFeatures(layerId, params) {
  const { token } = await signInToLrs();
  const query = new URLSearchParams({ f: "json", token, ...params });
  let lastError;
  for (let attempt = 0; attempt < 3; attempt += 1) {
    try {
      const data = await limited(async () => {
        const response = await fetch(`${LRS}/${layerId}/query?${query}`);
        if (!response.ok) throw new Error(`Query failed ${response.status}`);
        return response.json();
      }, layerId === ROAD_ID ? 1 : 0);
      if (data.error) throw new Error(data.error.message || "Query failed");
      return { features: data.features || [], exceeded: Boolean(data.exceededTransferLimit) };
    } catch (error) {
      lastError = error;
      await new Promise((resolve) => setTimeout(resolve, 400 * (attempt + 1)));
    }
  }
  throw lastError;
}

export async function loadLayerCache() {
  return service();
}

function routeFieldOf(centerline) {
  return centerline.routeField || centerline.fields.find((item) => item.type === "esriFieldTypeString" && !/globalid|objectid/i.test(item.name))?.name || null;
}

export async function loadRouteCatalog() {
  service();
  const centerline = await roadNetwork();
  const field = routeFieldOf(centerline);
  if (!field) throw new Error("Road Network has no route id field");
  const codeField = pickField(centerline.fields, CODE_FIELDS);
  const features = centerline.features;
  const byId = new Map();
  features.forEach((feature) => {
    const id = String(feature.attributes[field] ?? "").trim();
    if (!id || /[{}]/.test(id)) return;
    const code = codeField ? String(feature.attributes[codeField] ?? "").trim() : "";
    if (!byId.has(id)) byId.set(id, { id, code, trajectory: code || "Road Network", roadClass: "Road Network", routeField: field });
  });
  return [...byId.values()].sort((a, b) => a.id.localeCompare(b.id, undefined, { numeric: true }));
}

export async function loadRoute(routeId) {
  const centerline = await roadNetwork();
  const field = routeFieldOf(centerline);
  const wanted = String(routeId).trim();
  const features = centerline.features.filter((feature) => String(feature.attributes[field] ?? "").trim() === wanted);
  if (!features.length) throw new Error(`No Road Network geometry found for route ${wanted}`);
  const route = buildRoute(features);
  const codeField = pickField(centerline.fields, CODE_FIELDS);
  const code = codeField ? features.map((feature) => feature.attributes[codeField]).find(Boolean) : "";
  return {
    ...route,
    id: routeId,
    trajectory: code ? String(code) : "Road Network",
    roadClass: "Road Network",
    features,
    geometries: features.map((feature) => feature.geometry).filter(Boolean),
    routeField: field,
    layerId: 3,
  };
}

function matchesRoute(layer, feature, route) {
  if (!layer.routeField) return true;
  return String(feature.attributes[layer.routeField] ?? "").trim() === String(route.id).trim();
}

function routeBox(route, padDeg) {
  let minX = Infinity;
  let minY = Infinity;
  let maxX = -Infinity;
  let maxY = -Infinity;
  route.vertices.forEach(([x, y]) => {
    if (x < minX) minX = x;
    if (y < minY) minY = y;
    if (x > maxX) maxX = x;
    if (y > maxY) maxY = y;
  });
  return { minX: minX - padDeg, minY: minY - padDeg, maxX: maxX + padDeg, maxY: maxY + padDeg };
}

function nearBox(feature, box) {
  const g = feature.geometry;
  if (!g) return false;
  const first = g.x !== undefined ? [g.x, g.y] : (g.paths?.[0]?.[0] || g.curvePaths?.[0]?.[0]);
  const at = first ? toLonLat(first[0], first[1]) : null;
  return Boolean(at) && at[0] >= box.minX && at[0] <= box.maxX && at[1] >= box.minY && at[1] <= box.maxY;
}

export async function loadEvents(route) {
  const { layers } = await service();
  const maxKm = SNAP_METERS / 1000;
  const events = [];
  const mapLayers = [];

  for (const layer of layers) {
    if (layer.def.route) continue;
    let features = layer.features.filter((feature) => matchesRoute(layer, feature, route));
    if (!features.length && route.vertices?.length) {
      const box = routeBox(route, 0.01);
      features = layer.features.filter((feature) => nearBox(feature, box));
    }
    mapLayers.push({ id: layer.id, title: layer.name });
    features.forEach((feature, index) => {
      const name = titleOf(feature.attributes, layer.routeField, layer.def.title);
      const fromValue = layer.fromField ? Number(feature.attributes[layer.fromField]) : NaN;
      const toRaw = layer.toField ? Number(feature.attributes[layer.toField]) : NaN;
      const toValue = Number.isFinite(toRaw) ? toRaw : fromValue;
      const hasMeasure = Number.isFinite(fromValue);
      if (hasMeasure) {
        const from = Math.min(fromValue, toValue);
        const to = Math.max(fromValue, Number.isFinite(toValue) ? toValue : fromValue);
        events.push(eventRecord(layer, feature, index, name, from, to, featurePoint(feature)));
        return;
      }
      if (feature.geometry?.x !== undefined) {
        const locatedPoint = toLonLat(feature.geometry.x, feature.geometry.y);
        if (!locatedPoint) return;
        const hit = locateOnRoute(route.vertices, route.measures, locatedPoint, maxKm * 8);
        if (!hit) return;
        events.push(eventRecord(layer, feature, index, name, hit.measure, hit.measure, locatedPoint, hit.distanceKm * 1000));
        return;
      }
      const span = lineMeasureSpan(route.vertices, route.measures, flattenPaths(feature.geometry), maxKm * 4);
      if (!span) return;
      events.push(eventRecord(layer, feature, index, name, span.from, span.to, null));
    });
  }
  return { events, mapLayers };
}

function featurePoint(feature) {
  if (feature.geometry?.x !== undefined) return toLonLat(feature.geometry.x, feature.geometry.y);
  const path = flattenPaths(feature.geometry)[0];
  if (path?.length) return path[Math.floor(path.length / 2)];
  return null;
}

const DETAIL_SKIP = /globalid|objectid|^fid$|shape|guid|eventid|routeid|route_id|routename|route_name|fromdate|todate|locerror|created|edited|^gdb_|^st_/i;

function prettyField(name) {
  return name.replace(/_/g, " ").replace(/([a-z])([A-Z])/g, "$1 $2").replace(/\s+/g, " ").trim().replace(/^./, (char) => char.toUpperCase());
}

function prettyValue(name, value) {
  if (typeof value === "number") {
    if (/date/i.test(name) && value > 1e11) return new Date(value).toLocaleDateString();
    if (/measure/i.test(name)) return `${value.toFixed(3)} km`;
    return Number.isInteger(value) ? String(value) : String(Number(value.toFixed(3)));
  }
  return String(value).trim();
}

/** Readable attribute pairs for tooltips and the hover card; ids and system fields are left out. */
function detailsOf(attributes, name) {
  return Object.entries(attributes)
    .filter(([field, value]) => !DETAIL_SKIP.test(field) && value !== null && value !== undefined && String(value).trim() !== "" && String(value).trim() !== name && !GUID.test(String(value).trim()))
    .map(([field, value]) => [prettyField(field), prettyValue(field, value)])
    .slice(0, 8);
}

function eventRecord(layer, feature, index, name, from, to, point, distanceM = 0) {
  return {
    id: `${layer.id}-${feature.attributes.OBJECTID || feature.attributes.objectid || index}`,
    layerId: layer.id,
    group: layer.def.group,
    title: layer.def.title,
    name,
    shape: layer.def.shape,
    color: layer.def.swatch,
    kind: layer.def.kind === "point" || to - from <= 0.02 ? "point" : "span",
    from,
    to,
    measure: (from + to) / 2,
    point,
    distanceM,
    details: detailsOf(feature.attributes || {}, name),
  };
}

export function featuresAtMeasure(events, measure, toleranceKm = 0.35) {
  return events.filter((event) => {
    if (event.kind === "span") return measure >= event.from && measure <= event.to;
    return Math.abs(event.measure - measure) <= toleranceKm;
  });
}

/** Point assets and per-value attribute lengths for the stretch from–to of the loaded route. */
export function summariseSegment(events, from, to) {
  const order = (layerId) => LRS_LAYER_DEFS.findIndex((def) => def.id === layerId);
  const points = new Map();
  const spans = new Map();
  events.forEach((event) => {
    if (event.kind !== "span") {
      if (event.measure < from || event.measure > to) return;
      const layer = points.get(event.layerId) || { layerId: event.layerId, title: event.title, shape: event.shape, color: event.color, items: [] };
      layer.items.push(event);
      points.set(event.layerId, layer);
      return;
    }
    const overlap = Math.min(to, event.to) - Math.max(from, event.from);
    if (overlap <= 0) return;
    const layer = spans.get(event.layerId) || { layerId: event.layerId, title: event.title, color: event.color, byName: new Map() };
    layer.byName.set(event.name, (layer.byName.get(event.name) || 0) + overlap);
    spans.set(event.layerId, layer);
  });
  const pointLayers = [...points.values()]
    .map((layer) => ({ ...layer, items: layer.items.sort((a, b) => a.measure - b.measure) }))
    .sort((a, b) => order(a.layerId) - order(b.layerId));
  const spanLayers = [...spans.values()].map((layer) => {
    const coveredKm = [...layer.byName.values()].reduce((sum, value) => sum + value, 0);
    const values = [...layer.byName.entries()]
      .map(([name, value]) => ({ name, km: value, share: coveredKm ? value / coveredKm : 0 }))
      .sort((a, b) => b.km - a.km);
    return { layerId: layer.layerId, title: layer.title, color: layer.color, coveredKm, values };
  }).sort((a, b) => order(a.layerId) - order(b.layerId));
  return {
    lengthKm: to - from,
    pointCount: pointLayers.reduce((sum, layer) => sum + layer.items.length, 0),
    points: pointLayers,
    spans: spanLayers,
  };
}

const roadPaths = new WeakMap();

/** Road Network routes within maxKm of [lon, lat], nearest first, one entry per route id. */
export async function nearestRoads(point, maxKm, limit = 12) {
  const centerline = await roadNetwork();
  const field = routeFieldOf(centerline);
  const codeField = pickField(centerline.fields, CODE_FIELDS);
  const padLat = maxKm / 111;
  const padLon = maxKm / (111 * Math.cos((point[1] * Math.PI) / 180));
  const byRoute = new Map();
  centerline.features.forEach((feature) => {
    const id = field ? String(feature.attributes?.[field] ?? "").trim() : "";
    if (!id || !feature.geometry) return;
    let paths = roadPaths.get(feature);
    if (!paths) {
      paths = flattenPaths(feature.geometry);
      roadPaths.set(feature, paths);
    }
    paths.forEach((path) => {
      for (let i = 0; i < path.length - 1; i += 1) {
        const a = path[i];
        const b = path[i + 1];
        if (Math.min(a[0], b[0]) - padLon > point[0] || Math.max(a[0], b[0]) + padLon < point[0]) continue;
        if (Math.min(a[1], b[1]) - padLat > point[1] || Math.max(a[1], b[1]) + padLat < point[1]) continue;
        const proj = projectSegment(a, b, point);
        const distanceKm = haversineKm(point, proj.point);
        if (distanceKm > maxKm) continue;
        const best = byRoute.get(id);
        if (!best || distanceKm < best.distanceKm) {
          const code = codeField ? String(feature.attributes[codeField] ?? "").trim() : "";
          byRoute.set(id, { id, code: code && code !== id ? code : "", distanceKm, point: proj.point });
        }
      }
    });
  });
  return [...byRoute.values()].sort((a, b) => a.distanceKm - b.distanceKm).slice(0, limit);
}
