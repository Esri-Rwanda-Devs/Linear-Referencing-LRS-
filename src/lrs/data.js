import { ADMIN, EVENT_LAYERS, ROAD, SNAP_METERS, WATER } from "../config";
import { buildRoute, flattenPaths, lineMeasureSpan, locateOnRoute, polygonCrossings } from "./geometry";

const SERVICE = { road: ROAD, water: WATER };

function labelFrom(attributes, fields) {
  for (const field of fields) {
    const value = attributes?.[field];
    if (value !== null && value !== undefined && String(value).trim()) return String(value);
  }
  return "Unnamed";
}

async function queryLayer(url, params) {
  const body = new URLSearchParams({ f: "json", ...params });
  const response = await fetch(`${url}/query`, { method: "POST", body });
  if (!response.ok) throw new Error(`Query failed ${response.status}`);
  const data = await response.json();
  if (data.error) throw new Error(data.error.message || "Query error");
  return data;
}

export async function loadRouteCatalog() {
  const data = await queryLayer(`${ROAD}/9`, {
    where: "1=1",
    outFields: "new_id,trajectory,class,status,length",
    returnGeometry: "false",
    orderByFields: "new_id",
  });
  const byId = new Map();
  data.features.forEach((feature) => {
    const id = feature.attributes.new_id;
    if (!id) return;
    const row = byId.get(id) || {
      id,
      trajectory: feature.attributes.trajectory || id,
      roadClass: feature.attributes.class || "National Road",
      lengthKm: 0,
    };
    row.lengthKm += Number(feature.attributes.length) || 0;
    if (feature.attributes.trajectory) row.trajectory = feature.attributes.trajectory;
    byId.set(id, row);
  });
  return [...byId.values()].sort((a, b) => a.id.localeCompare(b.id, undefined, { numeric: true }));
}

export async function loadRoute(routeId) {
  const safe = routeId.replace(/'/g, "''");
  const data = await queryLayer(`${ROAD}/9`, {
    where: `new_id='${safe}'`,
    outFields: "new_id,trajectory,class,status,length",
    returnGeometry: "true",
    outSR: "4326",
  });
  const route = buildRoute(data.features);
  const first = data.features[0]?.attributes || {};
  return {
    ...route,
    id: routeId,
    trajectory: first.trajectory || routeId,
    roadClass: first.class || "National Road",
    features: data.features,
  };
}

async function queryAll(url, params) {
  const features = [];
  let offset = 0;
  for (let page = 0; page < 6; page += 1) {
    const data = await queryLayer(url, {
      ...params,
      resultOffset: String(offset),
      resultRecordCount: "2000",
    });
    features.push(...(data.features || []));
    if (!data.exceededTransferLimit) break;
    offset += data.features.length;
  }
  return features;
}

function extentOf(vertices, pad = 0.02) {
  let xmin = Infinity;
  let ymin = Infinity;
  let xmax = -Infinity;
  let ymax = -Infinity;
  vertices.forEach(([x, y]) => {
    xmin = Math.min(xmin, x);
    ymin = Math.min(ymin, y);
    xmax = Math.max(xmax, x);
    ymax = Math.max(ymax, y);
  });
  return { xmin: xmin - pad, ymin: ymin - pad, xmax: xmax + pad, ymax: ymax + pad };
}

export async function loadEvents(route) {
  const extent = extentOf(route.vertices, 0.03);
  const envelope = {
    xmin: extent.xmin,
    ymin: extent.ymin,
    xmax: extent.xmax,
    ymax: extent.ymax,
    spatialReference: { wkid: 4326 },
  };
  const stride = Math.max(1, Math.floor(route.vertices.length / 400));
  const slim = route.vertices.filter((_, index) => index % stride === 0);
  const last = route.vertices[route.vertices.length - 1];
  if (slim[slim.length - 1] !== last) slim.push(last);
  const routeLine = { paths: [slim], spatialReference: { wkid: 4326 } };
  const maxKm = SNAP_METERS / 1000;
  const tasks = EVENT_LAYERS.map(async (layer) => {
    const features = await queryAll(`${SERVICE[layer.service]}/${layer.layerId}`, {
      where: "1=1",
      outFields: "*",
      returnGeometry: "true",
      geometry: JSON.stringify(routeLine),
      geometryType: "esriGeometryPolyline",
      inSR: "4326",
      spatialRel: "esriSpatialRelIntersects",
      distance: String(SNAP_METERS),
      units: "esriSRUnit_Meter",
      outSR: "4326",
    });
    const events = [];
    features.forEach((feature) => {
      const title = labelFrom(feature.attributes, layer.labelFields);
      if (layer.kind === "point") {
        const point = feature.geometry?.x !== undefined ? [feature.geometry.x, feature.geometry.y] : null;
        if (!point) return;
        const hit = locateOnRoute(route.vertices, route.measures, point, maxKm);
        if (!hit) return;
        events.push({
          id: `${layer.id}-${feature.attributes.objectid || feature.attributes.objectid_1 || events.length}`,
          layerId: layer.id,
          group: layer.group,
          title: layer.title,
          name: title,
          shape: layer.shape,
          color: layer.color,
          kind: "point",
          measure: hit.measure,
          from: hit.measure,
          to: hit.measure,
          point: hit.point,
          distanceM: Math.round(hit.distanceKm * 1000),
        });
        return;
      }
      const span = lineMeasureSpan(route.vertices, route.measures, flattenPaths(feature.geometry), maxKm);
      if (!span) return;
      events.push({
        id: `${layer.id}-${feature.attributes.objectid || events.length}`,
        layerId: layer.id,
        group: layer.group,
        title: layer.title,
        name: title,
        shape: "bar",
        color: layer.color,
        kind: "span",
        from: span.from,
        to: span.to,
        measure: (span.from + span.to) / 2,
        distanceM: 0,
      });
    });
    return events;
  });

  const [eventGroups, districts, provinces] = await Promise.all([
    Promise.all(tasks),
    queryAll(`${ADMIN}/1`, {
      where: "1=1",
      outFields: "district,province,province_en",
      returnGeometry: "true",
      geometry: JSON.stringify(envelope),
      geometryType: "esriGeometryEnvelope",
      inSR: "4326",
      spatialRel: "esriSpatialRelIntersects",
      outSR: "4326",
    }),
    queryAll(`${ADMIN}/2`, {
      where: "1=1",
      outFields: "province,province_en",
      returnGeometry: "true",
      geometry: JSON.stringify(envelope),
      geometryType: "esriGeometryEnvelope",
      inSR: "4326",
      spatialRel: "esriSpatialRelIntersects",
      outSR: "4326",
    }),
  ]);

  const geo = [];
  const pushGeo = (features, field, title, color) => {
    features.forEach((feature) => {
      const spans = polygonCrossings(route, feature.geometry?.rings || []);
      if (!spans) return;
      spans.forEach((span, index) => {
        geo.push({
          id: `${title}-${feature.attributes.objectid}-${index}`,
          layerId: title,
          group: "GEO",
          title,
          name: feature.attributes[field] || feature.attributes.province_en || "Unknown",
          shape: "bar",
          color,
          kind: "span",
          from: span.from,
          to: Math.max(span.to, span.from + 0.05),
          measure: (span.from + span.to) / 2,
        });
      });
    });
  };
  pushGeo(provinces, "province", "Province", "#86efac");
  pushGeo(districts, "district", "District", "#fde68a");

  const attributes = route.segments.map((segment, index) => ({
    id: `status-${index}`,
    layerId: "status",
    group: "ATT",
    title: "Surface",
    name: segment.status,
    shape: "bar",
    color: /unpaved/i.test(segment.status) ? "#d6d3d1" : "#fbbf24",
    kind: "span",
    from: segment.from,
    to: segment.to,
    measure: (segment.from + segment.to) / 2,
  }));
  attributes.push({
    id: "class-band",
    layerId: "class",
    group: "ATT",
    title: "Class",
    name: route.roadClass,
    shape: "bar",
    color: "#c4b5fd",
    kind: "span",
    from: 0,
    to: route.lengthKm,
    measure: route.lengthKm / 2,
  });

  return [...eventGroups.flat(), ...geo, ...attributes];
}

export function featuresAtMeasure(events, measure, toleranceKm = 0.35) {
  return events.filter((event) => {
    if (event.kind === "span") return measure >= event.from && measure <= event.to;
    return Math.abs(event.measure - measure) <= toleranceKm;
  });
}
