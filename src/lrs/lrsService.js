import { LRS, LRS_LAYER_DEFS, PORTAL, SNAP_METERS } from "../config";
import { buildRoute, flattenPaths, lineMeasureSpan, locateOnRoute } from "./geometry";

const ROUTE_FIELDS = ["routeid", "route_id", "routename", "route_name", "roadid", "road_id"];
const FROM_FIELDS = ["frommeasure", "from_measure", "beginmeasure", "fromm", "fromkm", "startmeasure", "measure"];
const TO_FIELDS = ["tomeasure", "to_measure", "endmeasure", "tom", "tokm", "endmeasure"];
const CODE_FIELDS = ["routecode", "route_code", "roadcode", "road_code", "routename", "route_name"];
const LABEL_FIELDS = ["routecode", "route_code", "routename", "name", "assetname", "eventname", "type", "pavementtype", "draintype", "speed", "speedlimit", "description", "remarks"];

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

export async function signInToLrs() {
  if (session) return session;
  const [Portal, IdentityManager] = await loadModules(["esri/portal/Portal", "esri/identity/IdentityManager"]);
  const portal = new Portal({ url: PORTAL });
  portal.authMode = "immediate";
  await portal.load();
  const credential = await IdentityManager.getCredential(`${LRS}`);
  session = { token: credential.token, user: portal.user?.username || "" };
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

function pickField(fields, candidates) {
  const usable = fields.filter((field) => !/globalid|objectid/i.test(field.name));
  const names = usable.map((field) => field.name);
  const lower = names.map((name) => name.toLowerCase());
  for (const candidate of candidates) {
    const index = lower.indexOf(candidate);
    if (index >= 0) return names[index];
  }
  return names.find((name) => /routeid/i.test(name)) || null;
}

function titleOf(attributes, routeField) {
  for (const field of LABEL_FIELDS) {
    const key = Object.keys(attributes).find((name) => name.toLowerCase() === field);
    if (key && attributes[key]) return String(attributes[key]);
  }
  const fallback = Object.entries(attributes).find(([name, value]) => {
    return name !== routeField && typeof value === "string" && value.trim();
  });
  return fallback ? fallback[1] : "Event";
}

function fieldsOf(features) {
  const sample = features[0]?.attributes || {};
  return Object.keys(sample).map((name) => ({
    name,
    type: typeof sample[name] === "number" ? "esriFieldTypeDouble" : "esriFieldTypeString",
  }));
}

async function fetchLayerOnce(def) {
  const features = [];
  let offset = 0;
  for (let page = 0; page < 20; page += 1) {
    const batch = await queryFeatures(def.id, {
      where: "1=1",
      outFields: "*",
      returnGeometry: "true",
      returnTrueCurves: "true",
      outSR: "4326",
      resultOffset: String(offset),
      resultRecordCount: "500",
    });
    features.push(...batch.features);
    if (!batch.exceeded || batch.features.length === 0) break;
    offset += batch.features.length;
  }
  const fields = fieldsOf(features);
  const oidField = Object.keys(features[0]?.attributes || {}).find((name) => /objectid/i.test(name)) || "OBJECTID";
  return {
    id: def.id,
    name: def.title,
    features,
    fields,
    oidField,
    geometryType: def.kind === "point" ? "point" : "polyline",
    routeField: pickField(fields, ROUTE_FIELDS),
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

async function describeService() {
  const layers = [];
  const pointFirst = [...LRS_LAYER_DEFS].sort((a, b) => Number(b.kind === "point") - Number(a.kind === "point"));
  for (const def of pointFirst) {
    let layer;
    try {
      layer = await fetchLayerOnce(def);
    } catch (error) {
      console.error(def.title, error);
      layer = { id: def.id, name: def.title, features: [], fields: [], oidField: "OBJECTID", geometryType: def.kind === "point" ? "point" : "polyline", routeField: null, fromField: null, toField: null, def };
    }
    layers.push(layer);
    publishLayer(layer);
  }
  const centerline = layers.find((layer) => layer.def.route);
  if (!centerline) throw new Error("Road Network was not loaded");
  return { layers, centerline };
}

let described = null;
function service() {
  if (!described) described = describeService();
  return described;
}

async function queryFeatures(layerId, params) {
  const { token } = await signInToLrs();
  const query = new URLSearchParams({ f: "json", token, ...params });
  let lastError;
  for (let attempt = 0; attempt < 3; attempt += 1) {
    try {
      const response = await fetch(`${LRS}/${layerId}/query?${query}`);
      if (!response.ok) throw new Error(`Query failed ${response.status}`);
      const data = await response.json();
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

export async function loadRouteCatalog() {
  const { centerline } = await service();
  const field = centerline.routeField || centerline.fields.find((item) => item.type === "esriFieldTypeString" && !/globalid|objectid/i.test(item.name))?.name;
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
  const { centerline } = await service();
  const field = centerline.routeField;
  const features = centerline.features.filter((feature) => String(feature.attributes[field] ?? "") === routeId);
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
  return String(feature.attributes[layer.routeField] ?? "") === String(route.id);
}

export async function loadEvents(route) {
  const { layers } = await service();
  const maxKm = SNAP_METERS / 1000;
  const events = [];
  const mapLayers = [];

  for (const layer of layers) {
    if (layer.def.route) continue;
    const features = layer.features.filter((feature) => matchesRoute(layer, feature, route));
    mapLayers.push({ id: layer.id, title: layer.name });
    features.forEach((feature, index) => {
      const name = titleOf(feature.attributes, layer.routeField);
      const fromValue = layer.fromField ? Number(feature.attributes[layer.fromField]) : NaN;
      const toValue = layer.toField ? Number(feature.attributes[layer.toField]) : fromValue;
      const hasMeasure = Number.isFinite(fromValue);
      if (hasMeasure) {
        const from = Math.min(fromValue, toValue);
        const to = Math.max(fromValue, Number.isFinite(toValue) ? toValue : fromValue);
        events.push(eventRecord(layer, feature, index, name, from, to, featurePoint(feature)));
        return;
      }
      if (feature.geometry?.x !== undefined) {
        const hit = locateOnRoute(route.vertices, route.measures, [feature.geometry.x, feature.geometry.y], maxKm * 4);
        if (!hit) return;
        events.push(eventRecord(layer, feature, index, name, hit.measure, hit.measure, hit.point));
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
  if (feature.geometry?.x !== undefined) return [feature.geometry.x, feature.geometry.y];
  const path = feature.geometry?.paths?.[0];
  if (path?.length) return path[Math.floor(path.length / 2)];
  return null;
}

function eventRecord(layer, feature, index, name, from, to, point) {
  return {
    id: `${layer.id}-${feature.attributes.OBJECTID || feature.attributes.objectid || index}`,
    layerId: layer.id,
    group: layer.def.group,
    title: layer.def.title,
    name,
    shape: layer.def.shape,
    color: layer.def.swatch,
    kind: to - from > 0.02 ? "span" : "point",
    from,
    to,
    measure: (from + to) / 2,
    point,
    distanceM: 0,
  };
}

export function featuresAtMeasure(events, measure, toleranceKm = 0.35) {
  return events.filter((event) => {
    if (event.kind === "span") return measure >= event.from && measure <= event.to;
    return Math.abs(event.measure - measure) <= toleranceKm;
  });
}
