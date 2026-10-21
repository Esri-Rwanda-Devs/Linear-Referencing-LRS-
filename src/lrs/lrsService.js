import { ADMIN, LRS, LRS_LAYER_DEFS, PORTAL, SNAP_METERS, VALUE_COLORS } from "../config";
import { buildRoute, flattenPaths, haversineKm, lineMeasureSpan, locateOnRoute, pointAtMeasure, projectSegment, sliceVertices, toLonLat } from "./geometry";

const ROUTE_FIELDS = ["routeid", "route_id", "routename", "route_name", "roadid", "road_id"];
const FROM_FIELDS = ["frommeasure", "from_measure", "beginmeasure", "fromm", "fromkm", "startmeasure", "measure"];
const TO_FIELDS = ["tomeasure", "to_measure", "endmeasure", "tom", "tokm", "endmeasure"];
const CODE_FIELDS = ["routecode", "route_code", "roadcode", "road_code", "routename", "route_name"];
const LABEL_FIELDS = ["accident_id", "name", "assetname", "asset_name", "eventname", "bridgename", "bridge_name", "culvertname", "stonename", "kmstone", "km_stone", "pointname", "pavementtype", "pavement_type", "draintype", "drain_type", "carriagewaytype", "carriageway_type", "speedlimit", "speed_limit", "speed", "severity", "type", "assettype", "asset_type", "description", "remarks", "routename", "route_name"];
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

const REMOTE = "https://gh.space.gov.rw";

function devUrl(url) {
  if (typeof url !== "string" || window.location.host === "gh.space.gov.rw") return url;
  let next = url.startsWith(REMOTE) ? `${window.location.origin}${url.slice(REMOTE.length)}` : url;
  const httpsLocal = `https://${window.location.host}`;
  if (window.location.protocol === "http:" && next.startsWith(httpsLocal)) {
    next = `${window.location.origin}${next.slice(httpsLocal.length)}`;
  }
  return next;
}

function installDevProxyRewrite() {
  if (window.__lrsFetchPatched || window.location.host === "gh.space.gov.rw") return;
  window.__lrsFetchPatched = true;
  const nativeFetch = window.fetch.bind(window);
  window.fetch = (input, init) => {
    if (typeof input === "string") return nativeFetch(devUrl(input), init);
    if (input instanceof Request) {
      const url = devUrl(input.url);
      if (url !== input.url) return nativeFetch(new Request(url, input), init);
    }
    return nativeFetch(input, init);
  };
  const open = XMLHttpRequest.prototype.open;
  XMLHttpRequest.prototype.open = function (method, url, ...rest) {
    return open.call(this, method, typeof url === "string" ? devUrl(url) : url, ...rest);
  };
}

installDevProxyRewrite();

export function signInToLrs() {
  if (!session) {
    session = (async () => {
      const [Portal, IdentityManager] = await loadModules(["esri/portal/Portal", "esri/identity/IdentityManager"]);
      const portal = new Portal({ url: PORTAL });
      portal.authMode = "immediate";
      await portal.load();
      const credential = await IdentityManager.getCredential(LRS);
      return { token: credential.token, user: portal.user?.username || credential.userId || "" };
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
  const response = await fetch(`${devUrl(url)}${join}f=json&token=${encodeURIComponent(token)}`);
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

function carriagewayType(attributes) {
  const keys = Object.keys(attributes || {});
  const key = ["cway_type", "cwaytype", "carriageway_type", "carriagewaytype"]
    .map((wanted) => keys.find((name) => name.toLowerCase() === wanted))
    .find(Boolean);
  const text = key ? usableLabel(attributes[key]) : "";
  if (!text) return "";
  const compact = text.toLowerCase().replace(/[^a-z]/g, "");
  if (compact.includes("undivided")) return "Undivided";
  if (compact.includes("divided") || compact === "dual") return "Divided";
  return text;
}

function maxSpeedValue(attributes) {
  const keys = Object.keys(attributes || {});
  const key = keys.find((name) => name.toLowerCase() === "maxspeed")
    || keys.find((name) => /max.?speed/i.test(name));
  if (!key || attributes[key] === null || attributes[key] === undefined || String(attributes[key]).trim() === "") return 0;
  const match = String(attributes[key]).match(/-?\d+(?:\.\d+)?/);
  const value = match ? Number(match[0]) : NaN;
  return Number.isFinite(value) ? value : 0;
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

const ROAD_ID = LRS_LAYER_DEFS.find((def) => def.route)?.id;
const MAX_PARALLEL = 3;
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

/** Drops the local layer cache so the next load reads everything from the server. */
export async function clearLayerCache() {
  try {
    const db = await openCache();
    db.transaction(CACHE_STORE, "readwrite").objectStore(CACHE_STORE).clear();
  } catch {
    /* nothing cached */
  }
}

const failedLayers = new Set();

/** Titles of layers that could not be downloaded this session. */
export function failedLayerTitles() {
  return [...failedLayers];
}
function layerOf(def) {
  if (!layerPromises.has(def.id)) {
    layerPromises.set(def.id, fetchLayerOnce(def)
      .catch((error) => {
        console.error(def.title, error);
        failedLayers.add(def.title);
        return { id: def.id, name: def.title, features: [], fields: [], oidField: "OBJECTID", geometryType: def.kind === "point" ? "point" : "polyline", routeField: null, fromField: null, toField: null, def };
      })
      .then((layer) => {
        publishLayer(layer);
        return layer;
      }));
  }
  return layerPromises.get(def.id);
}

const metaCache = new Map();

function layerMeta(layerId, service = LRS) {
  const key = `${service}/${layerId}`;
  if (!metaCache.has(key)) metaCache.set(key, getJson(`${service}/${layerId}`));
  return metaCache.get(key);
}

function namedField(fields, candidates, fallback) {
  return pickField(fields, candidates, fallback);
}

function whereEquals(field, value, type) {
  const text = String(value ?? "").trim().replace(/'/g, "''");
  if (/Integer|Double|Single|Small|OID/i.test(type || "") && /^-?\d+(\.\d+)?$/.test(text)) return `${field} = ${text}`;
  return `${field} = '${text}'`;
}

async function queryFeatures(layerId, params, attempts = 4, service = LRS) {
  const { token } = await signInToLrs();
  const query = new URLSearchParams({ f: "json", token, ...params });
  let lastError;
  for (let attempt = 0; attempt < attempts; attempt += 1) {
    try {
      const data = await limited(async () => {
        const response = await fetch(`${devUrl(service)}/${layerId}/query?${query}`);
        if (!response.ok) throw new Error(`Query failed ${response.status}`);
        return response.json();
      }, layerId === ROAD_ID ? 1 : 0);
      if (data.error) throw new Error(data.error.message || "Query failed");
      return { features: data.features || [], exceeded: Boolean(data.exceededTransferLimit) };
    } catch (error) {
      lastError = error;
      if (attempt < attempts - 1) console.warn(`[LRS] Layer ${layerId} request failed (${error.message}); retrying…`);
      await new Promise((resolve) => setTimeout(resolve, 600 * 2 ** attempt));
    }
  }
  throw lastError;
}

async function queryPages(layerId, params, pageCap = 8, service = LRS) {
  const features = [];
  const size = Number(params.resultRecordCount || 500);
  let offset = 0;
  for (let page = 0; page < pageCap; page += 1) {
    const batch = await queryFeatures(layerId, { ...params, resultOffset: String(offset), resultRecordCount: String(size) }, 4, service);
    features.push(...batch.features);
    if (!batch.exceeded || !batch.features.length) break;
    offset += batch.features.length;
  }
  return features;
}

async function roadFields() {
  const meta = await layerMeta(ROAD_ID);
  const fields = meta.fields || [];
  const routeField = namedField(fields, ROUTE_FIELDS, /routeid/i);
  const routeType = fields.find((field) => field.name === routeField)?.type || "";
  const codeField = namedField(fields, CODE_FIELDS);
  return { fields, routeField, routeType, codeField };
}

function extentParams(extent, kind) {
  const width = Math.abs(extent.xmax - extent.xmin);
  const faithful = kind !== "point" && width < 0.05;
  const params = {
    where: "1=1",
    geometry: JSON.stringify({ xmin: extent.xmin, ymin: extent.ymin, xmax: extent.xmax, ymax: extent.ymax, spatialReference: { wkid: 4326 } }),
    geometryType: "esriGeometryEnvelope",
    inSR: "4326",
    spatialRel: "esriSpatialRelIntersects",
    outFields: "*",
    returnGeometry: "true",
    outSR: "4326",
    geometryPrecision: faithful ? "6" : "5",
    resultRecordCount: kind === "point" ? "600" : "400",
  };
  if (kind === "point") return params;
  if (faithful) params.returnTrueCurves = "true";
  else params.maxAllowableOffset = String(Math.min(0.0012, Math.max(0.000025, width / 5000)));
  return params;
}

/** Warm the road-layer metadata so the first geometry query does not wait on it. */
export function prepareRoads() {
  return roadFields().then(() => {}).catch(() => {});
}

/** Roads in a longitude/latitude box. A local box returns the published curves in one request. */
export async function loadRoadsInExtent(extent) {
  const meta = await layerMeta(ROAD_ID);
  const fields = meta.fields || [];
  const routeField = namedField(fields, ROUTE_FIELDS, /routeid/i);
  const oidField = fields.find((field) => field.type === "esriFieldTypeOID")?.name || "OBJECTID";
  const width = Math.abs(extent.xmax - extent.xmin);
  const local = width < 0.12;
  const params = {
    where: "1=1",
    geometry: JSON.stringify({ xmin: extent.xmin, ymin: extent.ymin, xmax: extent.xmax, ymax: extent.ymax, spatialReference: { wkid: 4326 } }),
    geometryType: "esriGeometryEnvelope",
    inSR: "4326",
    spatialRel: "esriSpatialRelIntersects",
    outFields: routeField ? `${oidField},${routeField}` : oidField,
    returnGeometry: "true",
    returnTrueCurves: "true",
    returnZ: "false",
    returnM: "false",
    outSR: "4326",
    resultRecordCount: local ? "80" : "120",
  };
  if (!local) params.maxAllowableOffset = String(Math.min(0.0004, Math.max(0.00003, width / 8000)));
  const features = await queryPages(ROAD_ID, params, local ? 2 : 1);
  return { features, routeField };
}

const EDIT_SKIP = /^(objectid|fid|globalid|shape|shape_length|shape_area|st_area|st_length|gdb_|created_user|created_date|last_edited_user|last_edited_date)$/i;

/** Editable columns for a layer, taken from its table. */
export async function layerFields(def) {
  const meta = await layerMeta(def.id, def.service || LRS);
  const fields = (meta.fields || []).filter((field) => field.type !== "esriFieldTypeGeometry" && field.type !== "esriFieldTypeOID" && !EDIT_SKIP.test(field.name));
  const oidField = (meta.fields || []).find((field) => field.type === "esriFieldTypeOID")?.name || "OBJECTID";
  return { fields, oidField };
}

/** Province through village for a point, from the village boundary that contains it. */
export async function adminAt(longitude, latitude) {
  if (!Number.isFinite(longitude) || !Number.isFinite(latitude)) return null;
  const data = await queryFeatures(4, {
    geometry: JSON.stringify({ x: longitude, y: latitude, spatialReference: { wkid: 4326 } }),
    geometryType: "esriGeometryPoint",
    inSR: "4326",
    spatialRel: "esriSpatialRelIntersects",
    outFields: "province,district,sector,cell,village",
    returnGeometry: "false",
    resultRecordCount: "1",
  }, 2, ADMIN);
  const attributes = data.features[0]?.attributes;
  if (!attributes) return null;
  const text = (name) => String(attributes[name] ?? "").trim();
  return {
    province: text("province"),
    district: text("district"),
    sector: text("sector"),
    cell: text("cell"),
    village: text("village"),
  };
}

/** One feature, with every column, ready to edit. */
export async function loadFeature(def, oid) {
  const { oidField } = await layerFields(def);
  const service = def.service || LRS;
  const data = await queryFeatures(def.id, {
    where: `${oidField} = ${Number(oid)}`,
    outFields: "*",
    returnGeometry: "true",
    outSR: "4326",
  }, 2, service);
  return data.features[0] || null;
}

function editPayloadSummary(payload) {
  const summary = {};
  Object.entries(payload).forEach(([key, value]) => {
    try {
      const features = JSON.parse(value);
      summary[key] = (Array.isArray(features) ? features : [features]).map((feature) => ({
        attributes: feature.attributes || null,
        geometry: !feature.geometry ? null : feature.geometry.x != null
          ? { type: "point", x: feature.geometry.x, y: feature.geometry.y, wkid: feature.geometry.spatialReference?.wkid }
          : { type: "polyline", vertices: feature.geometry.paths?.[0]?.length || 0, wkid: feature.geometry.spatialReference?.wkid },
      }));
    } catch {
      summary[key] = String(value).slice(0, 500);
    }
  });
  return summary;
}

function editErrorText(data, status) {
  const lines = [];
  const top = data?.error;
  if (top?.message) lines.push(top.message);
  const details = top?.details;
  if (Array.isArray(details)) lines.push(...details.map((item) => String(item)));
  else if (details) lines.push(String(details));
  const results = [...(data?.addResults || []), ...(data?.updateResults || []), ...(data?.deleteResults || [])];
  results.forEach((result, index) => {
    if (!result || result.success !== false) return;
    const error = result.error || {};
    const description = error.description || error.message;
    if (description) lines.push(`Feature ${index + 1}: ${description}`);
    if (error.code != null) lines.push(`code ${error.code}${error.extendedCode != null ? ` (${error.extendedCode})` : ""}`);
    if (Array.isArray(error.details)) lines.push(...error.details.map((item) => String(item)));
  });
  if (!lines.length) lines.push(status ? `The edit was rejected (HTTP ${status}).` : "The edit was rejected.");
  return [...new Set(lines.filter(Boolean))].join("\n");
}

async function applyEdits(def, payload) {
  const { token } = await signInToLrs();
  const service = def.service || LRS;
  const url = `${devUrl(service)}/${def.id}/applyEdits`;
  const body = new URLSearchParams({ f: "json", token, rollbackOnFailure: "true" });
  Object.entries(payload).forEach(([key, value]) => body.set(key, value));
  const response = await fetch(url, { method: "POST", body });
  const text = await response.text();
  let data = null;
  try {
    data = text ? JSON.parse(text) : null;
  } catch {
    console.error("[LRS] applyEdits returned non-JSON", { layer: `${def.title || ""} (${def.id})`, url, status: response.status, body: text.slice(0, 2000), sent: editPayloadSummary(payload) });
    throw new Error(`The server did not return JSON (HTTP ${response.status}).`);
  }
  const failed = data?.error || [...(data?.addResults || []), ...(data?.updateResults || []), ...(data?.deleteResults || [])].some((result) => result && result.success === false);
  if (!response.ok || failed) {
    let layerInfo = null;
    try {
      const meta = await layerMeta(def.id, service);
      layerInfo = { geometryType: meta.geometryType, hasZ: meta.hasZ, hasM: meta.hasM, spatialReference: meta.spatialReference, capabilities: meta.capabilities };
    } catch (error) {
      layerInfo = { metaError: error.message };
    }
    const message = editErrorText(data, response.status);
    console.error("[LRS] applyEdits failed", { layer: `${def.title || ""} (${def.id})`, url, status: response.status, message, response: data, sent: editPayloadSummary(payload), layerInfo });
    throw new Error(message);
  }
  return data;
}

function measureSpan(attributes) {
  const read = (pattern) => {
    const entry = Object.entries(attributes || {}).find(([name]) => pattern.test(name));
    const value = entry ? Number(entry[1]) : NaN;
    return Number.isFinite(value) ? value : null;
  };
  const from = read(/^(frommeasure|from_measure|fromm|beginmeasure)$/i);
  const to = read(/^(tomeasure|to_measure|tom|endmeasure)$/i);
  const measure = read(/^measure$/i);
  if (from != null || to != null) return { from: from ?? to ?? 0, to: to ?? from ?? 0 };
  if (measure != null) return { from: measure, to: measure };
  return { from: 0, to: 0 };
}

/** Z-aware layers reject a shape that has no z. Measures are added the same way when the layer stores them. */
function enrichGeometry(geometry, meta, attributes) {
  if (!geometry) return geometry;
  const hasZ = Boolean(meta?.hasZ);
  const hasM = Boolean(meta?.hasM);
  if (!hasZ && !hasM) return geometry;
  const span = measureSpan(attributes);
  if (geometry.x != null && geometry.y != null) {
    const point = { ...geometry };
    if (hasZ) point.z = Number.isFinite(geometry.z) ? geometry.z : 0;
    if (hasM) point.m = Number.isFinite(geometry.m) ? geometry.m : span.from;
    return point;
  }
  if (!geometry.paths) return geometry;
  const line = { ...geometry };
  if (hasZ) line.hasZ = true;
  if (hasM) line.hasM = true;
  line.paths = geometry.paths.map((path) => {
    const lengths = [0];
    for (let i = 1; i < path.length; i += 1) lengths.push(lengths[i - 1] + haversineKm(path[i - 1], path[i]));
    const total = lengths[lengths.length - 1] || 1;
    return path.map((vertex, index) => {
      const along = span.from + (span.to - span.from) * (lengths[index] / total);
      const z = Number.isFinite(vertex[2]) ? vertex[2] : 0;
      if (hasZ && hasM) return [vertex[0], vertex[1], z, along];
      if (hasZ) return [vertex[0], vertex[1], z];
      return [vertex[0], vertex[1], along];
    });
  });
  return line;
}

/** Write attribute changes back to the feature table. */
export function updateFeature(def, attributes) {
  return applyEdits(def, { updates: JSON.stringify([{ attributes }]) });
}

const MERGE_GAP_KM = 0.05;

function featureOid(attributes) {
  const entry = Object.entries(attributes || {}).find(([name]) => /^objectid$|^oid$/i.test(name));
  const value = entry ? Number(entry[1]) : NaN;
  return Number.isFinite(value) ? value : null;
}

function eventTypeKey(layerId, attributes) {
  const rule = VALUE_COLORS[layerId];
  if (!rule || !attributes) return "";
  const wanted = normName(rule.field);
  const field = Object.keys(attributes).find((key) => normName(key) === wanted);
  if (!field || attributes[field] == null || String(attributes[field]).trim() === "") return "";
  return colorKey(attributes[field]);
}

function typeTokens(raw, field) {
  const tokens = new Set();
  const add = (value) => {
    const token = colorKey(value);
    if (token) tokens.add(token);
  };
  add(raw);
  const match = (field?.domain?.codedValues || []).find((item) => String(item.code) === String(raw) || colorKey(item.name) === colorKey(raw) || colorKey(item.code) === colorKey(raw));
  if (match) {
    add(match.code);
    add(match.name);
  }
  return tokens;
}

function typeLabel(raw, field) {
  const match = (field?.domain?.codedValues || []).find((item) => String(item.code) === String(raw) || colorKey(item.name) === colorKey(raw) || colorKey(item.code) === colorKey(raw));
  return match?.name ? String(match.name) : String(raw ?? "").trim();
}

/** Same-value line events that touch this new stretch, ready to become one segment. */
export function lineMergePlan(def, attributes, events, typeField, from, to) {
  const rule = VALUE_COLORS[def?.id];
  if (!rule || def.kind !== "line" || def.route) return null;
  if (!(Number(to) > Number(from))) return null;
  const raw = typeField ? attributes?.[typeField.name] : null;
  if (raw == null || String(raw).trim() === "") return null;
  const tokens = typeTokens(raw, typeField);
  if (!tokens.size) return null;
  const candidates = (events || []).filter((item) => item.layerId === def.id && item.oid != null && item.to - item.from > 0.02 && tokens.has(colorKey(item.typeKey || item.name)));
  const taken = [];
  let lo = Number(from);
  let hi = Number(to);
  let grew = true;
  while (grew) {
    grew = false;
    candidates.forEach((item) => {
      if (taken.includes(item)) return;
      if (item.to < lo - MERGE_GAP_KM || item.from > hi + MERGE_GAP_KM) return;
      taken.push(item);
      lo = Math.min(lo, item.from);
      hi = Math.max(hi, item.to);
      grew = true;
    });
  }
  if (!taken.length) return null;
  const keeper = [...taken].sort((a, b) => (b.to - b.from) - (a.to - a.from) || a.oid - b.oid)[0];
  return {
    from: lo,
    to: hi,
    keeper,
    remove: taken.filter((item) => item.oid !== keeper.oid),
    label: typeLabel(raw, typeField),
  };
}

/** Extend the existing same-value line and drop the extra pieces. */
export async function mergeMatchingLine(def, attributes, route, events, typeField) {
  const span = measureSpan(attributes);
  const plan = lineMergePlan(def, attributes, events, typeField, span.from, span.to);
  if (!plan || !route?.vertices?.length) return null;
  const slice = sliceVertices(route.vertices, route.measures, plan.from, plan.to);
  if (slice.length < 2) return null;
  const meta = await layerMeta(def.id, def.service || LRS);
  const oidField = (meta.fields || []).find((field) => field.type === "esriFieldTypeOID")?.name || "OBJECTID";
  const fromName = Object.keys(attributes).find((name) => /^(frommeasure|from_measure|fromm|beginmeasure)$/i.test(name));
  const toName = Object.keys(attributes).find((name) => /^(tomeasure|to_measure|tom|endmeasure)$/i.test(name));
  const next = { [oidField]: plan.keeper.oid };
  if (fromName) next[fromName] = Number(plan.from.toFixed(3));
  if (toName) next[toName] = Number(plan.to.toFixed(3));
  const geometry = enrichGeometry({ paths: [slice], spatialReference: { wkid: 4326 } }, meta, { ...attributes, ...next });
  const payload = { updates: JSON.stringify([{ attributes: next, geometry }]) };
  if (plan.remove.length) payload.deletes = plan.remove.map((item) => item.oid).join(",");
  await applyEdits(def, payload);
  return plan;
}

/** Insert a new row, with a point or a line along the route. */
export async function addFeature(def, attributes, geometry) {
  const meta = await layerMeta(def.id, def.service || LRS);
  return applyEdits(def, { adds: JSON.stringify([{ attributes, geometry: enrichGeometry(geometry, meta, attributes) }]) });
}

/** One visible layer inside the current view, not the whole country. */
export async function loadLayerInExtent(def, extent) {
  const service = def.service || LRS;
  const meta = await layerMeta(def.id, service);
  const routeField = namedField(meta.fields || [], ROUTE_FIELDS, /routeid/i);
  const features = await queryPages(def.id, extentParams(extent, def.kind), 1, service);
  return { id: def.id, features, routeField, def };
}

export const routeKey = (value) => String(value ?? "").trim().toUpperCase().replace(/[\s_-]+/g, "");
const hasGeometry = (feature) => flattenPaths(feature.geometry).length > 0;

export async function loadRouteCatalog() {
  const { routeField, codeField } = await roadFields();
  if (!routeField) throw new Error("Road Network has no route id field");
  const features = await queryPages(ROAD_ID, {
    where: "1=1",
    outFields: [routeField, codeField].filter(Boolean).join(","),
    returnGeometry: "false",
    resultRecordCount: "1000",
  });
  const byId = new Map();
  features.forEach((feature) => {
    const id = String(feature.attributes[routeField] ?? "").trim();
    if (!id || /[{}]/.test(id)) return;
    const key = routeKey(id);
    if (byId.has(key)) return;
    const code = codeField ? String(feature.attributes[codeField] ?? "").trim() : "";
    byId.set(key, { id, code, trajectory: code || "Road Network", roadClass: "Road Network", routeField, drawn: true });
  });
  return [...byId.values()].sort((a, b) => a.id.localeCompare(b.id, undefined, { numeric: true }));
}

export async function loadRoute(routeId) {
  const { routeField, routeType, codeField } = await roadFields();
  if (!routeField) throw new Error("Road Network has no route id field");
  const features = (await queryPages(ROAD_ID, {
    where: whereEquals(routeField, routeId, routeType),
    outFields: "*",
    returnGeometry: "true",
    returnTrueCurves: "true",
    resultRecordCount: "200",
  })).filter(hasGeometry);
  if (!features.length) throw new Error(`Route ${String(routeId).trim()} has no Road Network geometry to draw or measure.`);
  const route = buildRoute(features);
  if (!(route.lengthKm > 0)) throw new Error(`Route ${String(routeId).trim()} geometry has zero length.`);
  const code = codeField ? features.map((feature) => feature.attributes[codeField]).find(Boolean) : "";
  return {
    ...route,
    id: routeId,
    trajectory: code ? String(code) : "Road Network",
    roadClass: "Road Network",
    features,
    geometries: features.map((feature) => feature.geometry).filter(Boolean),
    routeField,
    layerId: 3,
  };
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

function routeIds(route) {
  return [...new Set([route.id, route.trajectory, route.code]
    .map((value) => String(value ?? "").trim())
    .filter((value) => value && value !== "Road Network"))];
}

function matchesRoute(feature, routeField, route) {
  if (!routeField) return false;
  const value = routeKey(feature.attributes?.[routeField]);
  if (!value) return false;
  return routeIds(route).some((id) => routeKey(id) === value);
}

function liesOnRoute(feature, route) {
  const paths = flattenPaths(feature.geometry);
  if (!paths.length || !route.vertices?.length) return false;
  return Boolean(lineMeasureSpan(route.vertices, route.measures, paths, 0.15));
}

function pointOnRoute(feature, route) {
  if (feature.geometry?.x === undefined || !route.vertices?.length) return false;
  const at = toLonLat(feature.geometry.x, feature.geometry.y);
  return Boolean(at && locateOnRoute(route.vertices, route.measures, at, 0.15));
}

export async function featuresForRoute(def, route) {
  const service = def.service || LRS;
  const meta = await layerMeta(def.id, service);
  const fields = meta.fields || [];
  const routeField = namedField(fields, ROUTE_FIELDS, /routeid/i);
  const routeType = fields.find((field) => field.name === routeField)?.type || "";
  const fromField = namedField(fields, FROM_FIELDS);
  const toField = namedField(fields, TO_FIELDS);
  const layer = { id: def.id, name: def.title, features: [], fields, routeField, fromField, toField, def };
  const geometry = {
    outFields: "*",
    returnGeometry: "true",
    outSR: "4326",
    geometryPrecision: "5",
    resultRecordCount: "500",
  };
  const lineEvent = def.kind === "line" && !def.route;
  if (routeField) {
    const where = routeIds(route).map((id) => whereEquals(routeField, id, routeType)).join(" OR ");
    if (where) {
      layer.features = (await queryPages(def.id, { ...geometry, where }, 8, service))
        .filter((feature) => matchesRoute(feature, routeField, route) || !String(feature.attributes?.[routeField] ?? "").trim());
    }
  }
  if (def.snap && route.vertices?.length) {
    const box = routeBox(route, 0.006);
    const seen = new Set(layer.features.map((feature) => feature.attributes?.OBJECTID ?? feature.attributes?.objectid));
    const extra = await queryPages(def.id, {
      ...geometry,
      where: "1=1",
      geometry: JSON.stringify({ xmin: box.minX, ymin: box.minY, xmax: box.maxX, ymax: box.maxY, spatialReference: { wkid: 4326 } }),
      geometryType: "esriGeometryEnvelope",
      inSR: "4326",
      spatialRel: "esriSpatialRelIntersects",
    }, 2, service);
    extra.forEach((feature) => {
      const oid = feature.attributes?.OBJECTID ?? feature.attributes?.objectid;
      if (seen.has(oid)) return;
      if (matchesRoute(feature, routeField, route) || pointOnRoute(feature, route)) {
        layer.features.push(feature);
        seen.add(oid);
      }
    });
  }
  if (lineEvent && !layer.features.length && route.vertices?.length) {
    const box = routeBox(route, 0.004);
    layer.features = (await queryPages(def.id, {
      ...geometry,
      where: "1=1",
      geometry: JSON.stringify({ xmin: box.minX, ymin: box.minY, xmax: box.maxX, ymax: box.maxY, spatialReference: { wkid: 4326 } }),
      geometryType: "esriGeometryEnvelope",
      inSR: "4326",
      spatialRel: "esriSpatialRelIntersects",
    }, 3, service)).filter((feature) => matchesRoute(feature, routeField, route) || liesOnRoute(feature, route));
  }
  if (!lineEvent && !def.snap && !layer.features.length && route.vertices?.length) {
    const box = routeBox(route, 0.01);
    layer.features = (await queryPages(def.id, {
      ...geometry,
      where: "1=1",
      geometry: JSON.stringify({ xmin: box.minX, ymin: box.minY, xmax: box.maxX, ymax: box.maxY, spatialReference: { wkid: 4326 } }),
      geometryType: "esriGeometryEnvelope",
      inSR: "4326",
      spatialRel: "esriSpatialRelIntersects",
    }, 2, service)).filter((feature) => nearBox(feature, box));
  }
  return layer;
}

export async function loadEvents(route) {
  const maxKm = SNAP_METERS / 1000;
  const events = [];
  const mapLayers = [];
  const defs = LRS_LAYER_DEFS.filter((def) => !def.route && def.chart !== false);
  const layers = await Promise.all(defs.map((def) => featuresForRoute(def, route).catch((error) => {
    console.error(def.title, error);
    failedLayers.add(def.title);
    return { id: def.id, name: def.title, features: [], fields: [], routeField: null, fromField: null, toField: null, def };
  })));

  for (const layer of layers) {
    const features = layer.features;
    mapLayers.push({ id: layer.id, title: layer.name });
    features.forEach((feature, index) => {
      const name = layer.id === 5
        ? String(maxSpeedValue(feature.attributes))
        : layer.id === 2
          ? (carriagewayType(feature.attributes) || "Carriageway")
          : layer.id === 18
            ? (usableLabel(feature.attributes?.road) || usableLabel(feature.attributes?.cell) || "Camera")
            : titleOf(feature.attributes, layer.routeField, layer.def.title);
      const fromValue = layer.fromField ? Number(feature.attributes[layer.fromField]) : NaN;
      const toRaw = layer.toField ? Number(feature.attributes[layer.toField]) : NaN;
      const toValue = Number.isFinite(toRaw) ? toRaw : fromValue;
      const hasMeasure = Number.isFinite(fromValue) && (!layer.def.snap || matchesRoute(feature, layer.routeField, route));
      const lineEvent = layer.def.kind === "line" && !layer.def.route;
      const onRoad = (measure) => pointAtMeasure(route.vertices, route.measures, measure);
      if (hasMeasure) {
        let from = Math.min(fromValue, toValue);
        let to = Math.max(fromValue, Number.isFinite(toValue) ? toValue : fromValue);
        if (lineEvent) {
          const length = route.lengthKm || 0;
          if (!(length > 0) || to < 0) return;
          if (from > length * 3 && from > 50) {
            const span = lineMeasureSpan(route.vertices, route.measures, flattenPaths(feature.geometry), 0.15);
            if (!span) return;
            events.push(eventRecord(layer, feature, index, name, span.from, span.to, onRoad((span.from + span.to) / 2)));
            return;
          }
          from = Math.max(0, Math.min(length, from));
          to = Math.max(from, Math.min(length, to));
        }
        const midpoint = (from + to) / 2;
        events.push(eventRecord(layer, feature, index, name, from, to, lineEvent || layer.def.snap ? onRoad(midpoint) : featurePoint(feature)));
        return;
      }
      if (lineEvent) {
        const span = lineMeasureSpan(route.vertices, route.measures, flattenPaths(feature.geometry), maxKm);
        if (!span) return;
        events.push(eventRecord(layer, feature, index, name, span.from, span.to, onRoad((span.from + span.to) / 2)));
        return;
      }
      if (feature.geometry?.x !== undefined) {
        const locatedPoint = toLonLat(feature.geometry.x, feature.geometry.y);
        if (!locatedPoint) return;
        const hit = locateOnRoute(route.vertices, route.measures, locatedPoint, maxKm * 8);
        if (!hit) return;
        events.push(eventRecord(layer, feature, index, name, hit.measure, hit.measure, layer.def.snap ? hit.point : locatedPoint, hit.distanceKm * 1000));
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
const DETAIL_FIRST = ["severity", "probable_cause", "vehicle_type", "priority", "resolved", "road", "district", "sector", "cell", "village", "impacted_category", "action_taken", "details", "accident_id"];

function prettyField(name) {
  return name.replace(/_/g, " ").replace(/([a-z])([A-Z])/g, "$1 $2").replace(/\s+/g, " ").trim().replace(/^./, (char) => char.toUpperCase());
}

function prettyValue(name, value) {
  if (typeof value === "number") {
    if (/date|time/i.test(name) && !/measure/i.test(name) && value > 1e11) return new Date(value).toLocaleString();
    if (/measure/i.test(name)) return `${value.toFixed(3)} km`;
    return Number.isInteger(value) ? String(value) : String(Number(value.toFixed(3)));
  }
  return String(value).trim();
}

/** Readable attribute pairs for tooltips and the hover card; ids and system fields are left out. */
function detailsOf(attributes, name) {
  return Object.entries(attributes)
    .filter(([field, value]) => !DETAIL_SKIP.test(field) && value !== null && value !== undefined && String(value).trim() !== "" && String(value).trim() !== name && !GUID.test(String(value).trim()))
    .sort((a, b) => {
      const rank = (field) => {
        const at = DETAIL_FIRST.indexOf(field.toLowerCase());
        return at < 0 ? DETAIL_FIRST.length : at;
      };
      return rank(a[0]) - rank(b[0]);
    })
    .map(([field, value]) => [prettyField(field), prettyValue(field, value)])
    .slice(0, 8);
}

const normName = (text) => String(text).toLowerCase().replace(/[^a-z0-9]/g, "");
const VALUE_PALETTE = ["#60a5fa", "#f472b6", "#34d399", "#fbbf24", "#a78bfa", "#fb7185", "#2dd4bf", "#f97316", "#94a3b8", "#c084fc", "#4ade80", "#38bdf8"];

function colorKey(value) {
  if (value === null || value === undefined) return "";
  const text = String(value).trim();
  const speed = /^(\d+(?:\.\d+)?)\s*(?:km\/?h|kph)?$/i.exec(text);
  if (speed) return String(Number(speed[1]));
  return text.toLowerCase().replace(/[_\s-]+/g, " ");
}

/** Stable colour per value for attribute values without a configured colour. */
function paletteColor(seed) {
  let hash = 0;
  for (let i = 0; i < seed.length; i += 1) hash = (hash * 31 + seed.charCodeAt(i)) >>> 0;
  return VALUE_PALETTE[hash % VALUE_PALETTE.length];
}

/** Chart colour key for a line event, such as "40" or "paved". */
export function lineTone(layerId, attributes) {
  const rule = VALUE_COLORS[layerId];
  if (!rule || !attributes) return "";
  const keys = Object.keys(attributes);
  const wanted = normName(rule.field);
  const field = keys.find((key) => normName(key) === wanted)
    || keys.find((key) => normName(key).length > 4 && (normName(key).includes(wanted) || wanted.includes(normName(key))));
  if (field && attributes[field] != null && String(attributes[field]).trim() !== "") return colorKey(attributes[field]);
  const numeric = Object.keys(rule.colors).every((key) => /^\d/.test(key));
  const candidates = numeric ? keys.filter((key) => /speed/i.test(key)) : keys;
  for (const key of candidates) {
    const tone = colorKey(attributes[key]);
    if (rule.colors[tone]) return tone;
  }
  return "";
}

function valueColor(layerId, attributes) {
  const rule = VALUE_COLORS[layerId];
  if (!rule || !attributes) return null;
  const keys = Object.keys(attributes);
  const wanted = normName(rule.field);
  const field = keys.find((key) => normName(key) === wanted)
    || keys.find((key) => normName(key).length > 4 && (normName(key).includes(wanted) || wanted.includes(normName(key))));
  if (field) {
    const color = rule.colors[colorKey(attributes[field])];
    if (color) return color;
  }
  const numeric = Object.keys(rule.colors).every((key) => /^\d/.test(key));
  const candidates = numeric ? keys.filter((key) => /speed/i.test(key)) : keys;
  for (const key of candidates) {
    const color = rule.colors[colorKey(attributes[key])];
    if (color) return color;
  }
  return null;
}

function eventRecord(layer, feature, index, name, from, to, point, distanceM = 0) {
  return {
    id: `${layer.id}-${featureOid(feature.attributes) || index}`,
    oid: featureOid(feature.attributes),
    typeKey: eventTypeKey(layer.id, feature.attributes),
    layerId: layer.id,
    group: layer.def.group,
    title: layer.def.title,
    name,
    shape: layer.def.shape,
    color: valueColor(layer.id, feature.attributes) || VALUE_COLORS[layer.id]?.colors[colorKey(name)] || (layer.def.kind === "point" ? layer.def.swatch : paletteColor(`${layer.id}:${name}`)),
    kind: layer.def.kind === "point" || to - from <= 0.02 ? "point" : "span",
    from,
    to,
    measure: (from + to) / 2,
    point,
    distanceM,
    details: detailsOf(feature.attributes || {}, name),
    occurred: occurredAt(feature.attributes),
  };
}

const MONTH_MS = 30 * 24 * 60 * 60 * 1000;
const ACCIDENT_LAYER = 17;

function toMillis(value) {
  if (typeof value === "number" && value > 1e11) return value;
  if (typeof value === "string" && value.trim()) {
    const parsed = Date.parse(value);
    if (Number.isFinite(parsed)) return parsed;
  }
  return null;
}

/** Accident time from the feature, preferring the incident date over editor tracking. */
function occurredAt(attributes) {
  if (!attributes) return null;
  const score = (name) => {
    const key = name.toLowerCase();
    if (/measure|fromdate|todate/.test(key)) return 0;
    if (/accident|incident|occur/.test(key) && /date|time/.test(key)) return 5;
    if (/^date$|datetime|date_time|timestamp|time_stamp/.test(key)) return 4;
    if (/date|time/.test(key) && !/creat|edit/.test(key)) return 3;
    if (/created_date|creationdate|createdate|create_date/.test(key)) return 2;
    if (/editdate|edited_date|last_edited/.test(key)) return 1;
    return 0;
  };
  const ranked = Object.entries(attributes)
    .map(([name, value]) => ({ value, score: score(name) }))
    .filter((item) => item.score > 0)
    .sort((a, b) => b.score - a.score);
  for (const item of ranked) {
    const ms = toMillis(item.value);
    if (ms) return ms;
  }
  return null;
}

/** Incident time in milliseconds, when the accident feature has one. */
export function accidentTime(attributes) {
  return occurredAt(attributes);
}

export function accidentInLastMonth(ms, now = Date.now()) {
  return Number.isFinite(ms) && ms >= now - MONTH_MS && ms <= now;
}

function lastMonth(event, now = Date.now()) {
  return event.layerId === ACCIDENT_LAYER && accidentInLastMonth(event.occurred, now);
}

/** Groups measures along one road into the yellow (5–15) and red (above 15) stretches. */
export function hotspotSpans(measures) {
  const sorted = measures.filter((value) => Number.isFinite(value)).sort((a, b) => a - b);
  const spans = [];
  let group = [];
  const flush = () => {
    if (group.length >= 5) {
      const from = group[0];
      const to = group[group.length - 1];
      const pad = to - from < 0.12 ? 0.08 : 0.03;
      spans.push({ from: from - pad, to: to + pad, count: group.length, ...accidentTone(group.length) });
    }
    group = [];
  };
  sorted.forEach((measure) => {
    if (group.length && measure - group[group.length - 1] > 0.4) flush();
    group.push(measure);
  });
  flush();
  return spans;
}

/** Yellow for 5–15 last-month accidents on a stretch, red above 15. */
export function accidentTone(count) {
  if (count > 15) return { level: "high", label: "Above 15", color: "#dc2626", ink: [220, 38, 38, 1] };
  if (count >= 5) return { level: "watch", label: "5 to 15", color: "#facc15", ink: [250, 204, 21, 1] };
  return { level: "low", label: "Under 5", color: "#94a3b8", ink: [250, 204, 21, 1] };
}

/** Accidents on from–to whose date falls in the last 30 days. */
export function segmentAccidents(events, from, to, now = Date.now()) {
  const items = (events || []).filter((event) => lastMonth(event, now) && event.measure >= from && event.measure <= to);
  return { count: items.length, items, ...accidentTone(items.length) };
}

export function featuresAtMeasure(events, measure, toleranceKm = 0.35) {
  return events.filter((event) => {
    if (event.kind === "span") return measure >= event.from && measure <= event.to;
    return Math.abs(event.measure - measure) <= toleranceKm;
  });
}

/** Length-weighted average of max speed. Stretches with no max speed count as 0. */
export function averageMaxSpeed(events, lengthKm) {
  if (!(lengthKm > 0)) return 0;
  const pieces = (events || [])
    .filter((event) => event.layerId === 5)
    .map((event) => {
      const match = String(event.name ?? "").match(/-?\d+(?:\.\d+)?/);
      const speed = match ? Number(match[0]) : 0;
      return {
        from: Math.max(0, Math.min(lengthKm, Number(event.from) || 0)),
        to: Math.max(0, Math.min(lengthKm, Number(event.to) || 0)),
        speed: Number.isFinite(speed) ? speed : 0,
      };
    })
    .filter((piece) => piece.to > piece.from);
  const cuts = new Set([0, lengthKm]);
  pieces.forEach((piece) => {
    cuts.add(piece.from);
    cuts.add(piece.to);
  });
  const points = [...cuts].sort((a, b) => a - b);
  let weighted = 0;
  for (let i = 0; i < points.length - 1; i += 1) {
    const start = points[i];
    const end = points[i + 1];
    const mid = (start + end) / 2;
    let speed = 0;
    pieces.forEach((piece) => {
      if (mid >= piece.from && mid < piece.to) speed = Math.max(speed, piece.speed);
    });
    weighted += speed * (end - start);
  }
  return weighted / lengthKm;
}

/** Point assets and per-value attribute lengths for the stretch from–to of the loaded route. */
export function summariseSegment(events, from, to) {
  const order = (layerId) => LRS_LAYER_DEFS.findIndex((def) => def.id === layerId);
  const points = new Map();
  const spans = new Map();
  events.forEach((event) => {
    if (event.kind !== "span") {
      if (event.measure < from || event.measure > to) return;
      if (event.layerId === ACCIDENT_LAYER && !lastMonth(event)) return;
      const layer = points.get(event.layerId) || { layerId: event.layerId, title: event.title, shape: event.shape, color: event.color, items: [] };
      layer.items.push(event);
      points.set(event.layerId, layer);
      return;
    }
    const overlap = Math.min(to, event.to) - Math.max(from, event.from);
    if (overlap <= 0) return;
    const layer = spans.get(event.layerId) || { layerId: event.layerId, title: event.title, color: event.color, byName: new Map() };
    layer.byName.set(event.name, (layer.byName.get(event.name) || 0) + overlap);
    if (!layer.colors) layer.colors = new Map();
    layer.colors.set(event.name, event.color);
    spans.set(event.layerId, layer);
  });
  const pointLayers = [...points.values()]
    .map((layer) => ({ ...layer, items: layer.items.sort((a, b) => a.measure - b.measure) }))
    .sort((a, b) => {
      if (a.layerId === ACCIDENT_LAYER) return -1;
      if (b.layerId === ACCIDENT_LAYER) return 1;
      return order(a.layerId) - order(b.layerId);
    });
  const spanLayers = [...spans.values()].map((layer) => {
    const coveredKm = [...layer.byName.values()].reduce((sum, value) => sum + value, 0);
    const values = [...layer.byName.entries()]
      .map(([name, value]) => ({ name, km: value, share: coveredKm ? value / coveredKm : 0, color: layer.colors?.get(name) || layer.color }))
      .sort((a, b) => b.km - a.km);
    return { layerId: layer.layerId, title: layer.title, color: layer.color, coveredKm, values };
  }).sort((a, b) => order(a.layerId) - order(b.layerId));
  const accidents = segmentAccidents(events, from, to);
  return {
    lengthKm: to - from,
    pointCount: pointLayers.reduce((sum, layer) => sum + layer.items.length, 0),
    points: pointLayers,
    spans: spanLayers,
    accidents,
  };
}

const roadPaths = new WeakMap();

/** Road Network routes within maxKm of [lon, lat], nearest first, one entry per route id. */
export async function nearestRoads(point, maxKm, limit = 12) {
  const { routeField: field, codeField } = await roadFields();
  const padLat = maxKm / 111;
  const padLon = maxKm / (111 * Math.cos((point[1] * Math.PI) / 180));
  const features = await loadRoadsInExtent({
    xmin: point[0] - padLon,
    ymin: point[1] - padLat,
    xmax: point[0] + padLon,
    ymax: point[1] + padLat,
  }).then((result) => result.features);
  const byRoute = new Map();
  features.forEach((feature) => {
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
