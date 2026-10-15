import { useEffect, useRef, useState } from "react";
import { GEOCODE_KEY, GEOCODE_URL, LRS_LAYER_DEFS } from "../config";
import { flattenPaths, haversineKm, locateOnRoute, pointAtMeasure, sliceVertices, toLonLat } from "../lrs/geometry";
import { accidentInLastMonth, accidentTime, hotspotSpans, loadLayerInExtent, loadRoadsInExtent, prepareRoads, routeKey, segmentAccidents } from "../lrs/lrsService";

const MODULES = [
  "esri/Map",
  "esri/views/MapView",
  "esri/layers/FeatureLayer",
  "esri/layers/GraphicsLayer",
  "esri/Graphic",
  "esri/geometry/Polyline",
  "esri/geometry/Point",
  "esri/geometry/geometryEngine",
  "esri/symbols/SimpleLineSymbol",
  "esri/symbols/SimpleMarkerSymbol",
  "esri/symbols/SimpleFillSymbol",
  "esri/layers/support/FeatureEffect",
  "esri/layers/support/FeatureFilter",
  "esri/widgets/Search",
  "esri/widgets/Locate",
  "esri/geometry/support/webMercatorUtils",
  "esri/config",
];

const OPEN_AT = { center: [30.0619, -1.9441], scale: 32000 };
const HERE_ZOOM = 18;

function thinPath(path, max = 70) {
  if (path.length <= max) return path;
  const step = Math.ceil(path.length / max);
  const next = [];
  for (let i = 0; i < path.length; i += step) next.push(path[i]);
  const last = path[path.length - 1];
  const end = next[next.length - 1];
  if (end[0] !== last[0] || end[1] !== last[1]) next.push(last);
  return next;
}

function loadModules(names) {
  const withRequire = () => new Promise((resolve, reject) => {
    if (!window.require) {
      reject(new Error("ArcGIS API failed to load"));
      return;
    }
    window.require(names, (...mods) => resolve(mods));
  });

  if (window.require) return withRequire();
  return new Promise((resolve, reject) => {
    window.dojoConfig = { async: true };
    const script = document.createElement("script");
    script.src = "https://js.arcgis.com/4.29/";
    script.onload = () => withRequire().then(resolve, reject);
    script.onerror = () => reject(new Error("ArcGIS API failed to load"));
    document.head.appendChild(script);
  });
}

export function useRoadMap({ mapApi, route, events, cursor, project, activeEvent, hiddenLayerIds, segment, segmentStart, segmentPicking, onSegmentClick, compareRoute, compareEvents, compareCursor, compareEvent, uiPanel, analysis, pickingOrigin, onOrigin, onHoverMeasure, onLeave, onFocusChange, onPickRoute }) {
  const pickRef = useRef(onPickRoute);
  pickRef.current = onPickRoute;
  const originRef = useRef(onOrigin);
  originRef.current = onOrigin;
  const pickingRef = useRef(pickingOrigin);
  pickingRef.current = pickingOrigin;
  const segmentPickRef = useRef(segmentPicking);
  segmentPickRef.current = segmentPicking;
  const segmentClickRef = useRef(onSegmentClick);
  segmentClickRef.current = onSegmentClick;
  const hiddenRef = useRef(hiddenLayerIds);
  hiddenRef.current = hiddenLayerIds;
  const routeRef = useRef(route);
  routeRef.current = route;
  const eventsRef = useRef(events);
  eventsRef.current = events;
  const ref = useRef(null);
  const api = useRef(null);
  const hoverRef = useRef(onHoverMeasure);
  const leaveRef = useRef(onLeave);
  const focusRef = useRef(onFocusChange);
  const [ready, setReady] = useState(false);
  hoverRef.current = onHoverMeasure;
  leaveRef.current = onLeave;
  focusRef.current = onFocusChange;

  useEffect(() => {
    let view;
    let cancelled = false;
    prepareRoads();
    let pendingFix;
    let takeFix = null;
    let fixesLeft = navigator.geolocation ? 2 : 0;
    const giveFix = (coords) => {
      if (cancelled) return;
      if (coords) {
        if (takeFix) takeFix(coords);
        else pendingFix = coords;
        return;
      }
      fixesLeft -= 1;
      if (pendingFix || fixesLeft > 0) return;
      if (takeFix) takeFix(null);
      else pendingFix = null;
    };
    if (navigator.geolocation) {
      navigator.geolocation.getCurrentPosition(
        (pos) => giveFix(pos.coords),
        () => giveFix(null),
        { enableHighAccuracy: false, maximumAge: 180000, timeout: 4000 },
      );
      navigator.geolocation.getCurrentPosition(
        (pos) => giveFix(pos.coords),
        () => giveFix(null),
        { enableHighAccuracy: true, maximumAge: 10000, timeout: 12000 },
      );
    }
    loadModules(MODULES).then(async (mods) => {
      if (cancelled || !ref.current) return;
      const [Map, MapView, FeatureLayer, GraphicsLayer, Graphic, Polyline, Point, geometryEngine, SimpleLineSymbol, SimpleMarkerSymbol, SimpleFillSymbol, FeatureEffect, FeatureFilter, Search, Locate, webMercatorUtils, esriConfig] = mods;
      esriConfig.request.interceptors.push({
        urls: /esrirw\.rw\/server\/rest\/services\/Reverse_Geocoding_Version9/i,
        before(params) {
          params.requestOptions.query = { ...params.requestOptions.query, token: GEOCODE_KEY };
        },
      });
      const overlay = new GraphicsLayer({ id: "lrs-overlay", listMode: "hide" });
      const cursorLayer = new GraphicsLayer({ id: "lrs-cursor", listMode: "hide" });
      const projectLayer = new GraphicsLayer({ id: "lrs-project", listMode: "hide" });
      const analysisLayer = new GraphicsLayer({ id: "lrs-analysis", listMode: "hide" });
      const segmentLayer = new GraphicsLayer({ id: "lrs-segment", listMode: "hide" });
      const hotspotLayer = new GraphicsLayer({ id: "lrs-hotspots", listMode: "hide" });
      const compareLayer = new GraphicsLayer({ id: "lrs-compare", listMode: "hide" });
      const compareCursorLayer = new GraphicsLayer({ id: "lrs-compare-cursor", listMode: "hide" });
      const hereLayer = new GraphicsLayer({ id: "lrs-here", listMode: "hide" });
      const accidentLayer = new GraphicsLayer({ id: "lrs-accidents", listMode: "hide" });
      const map = new Map({ basemap: "satellite", layers: [analysisLayer, compareLayer, overlay, hotspotLayer, segmentLayer, projectLayer, accidentLayer, compareCursorLayer, cursorLayer, hereLayer] });
      view = new MapView({
        container: ref.current,
        map,
        center: OPEN_AT.center,
        scale: OPEN_AT.scale,
        highlightOptions: { color: [232, 122, 46], haloOpacity: 0 },
      });
      view.ui.remove("attribution");
      const search = new Search({
        view,
        includeDefaultSources: false,
        popupEnabled: false,
        resultGraphicEnabled: false,
        locationEnabled: false,
        sources: [{
          url: GEOCODE_URL,
          apiKey: GEOCODE_KEY,
          singleLineFieldName: "SingleLine",
          name: "Rwanda places",
          placeholder: "Search a place in Rwanda",
          suggestionsEnabled: true,
          minSuggestCharacters: 2,
          maxSuggestions: 6,
          maxResults: 6,
          outFields: ["LongLabel", "ShortLabel", "Match_addr", "PlaceName", "Addr_type"],
        }],
      });
      search.on("select-result", (event) => {
        const geometry = event.result?.feature?.geometry;
        const point = geometry?.type === "point" ? geometry : geometry?.extent?.center;
        const attributes = event.result?.feature?.attributes || {};
        const name = attributes.LongLabel || attributes.ShortLabel || attributes.Match_addr || event.result?.name || "Search result";
        if (point) originRef.current?.([point.longitude, point.latitude], name);
      });
      const placeName = (longitude, latitude) => {
        const params = new URLSearchParams({
          f: "json",
          location: `${longitude},${latitude}`,
          outSR: "4326",
          token: GEOCODE_KEY,
        });
        return fetch(`${GEOCODE_URL}/reverseGeocode?${params}`)
          .then((response) => response.json())
          .then((data) => {
            const address = data.address || {};
            return address.LongLabel || address.ShortLabel || address.Match_addr || address.Address || "";
          })
          .catch(() => "");
      };
      const nameOrigin = (longitude, latitude, fallback, options) => {
        originRef.current?.([longitude, latitude], fallback, options);
        placeName(longitude, latitude).then((name) => {
          if (name) originRef.current?.([longitude, latitude], name, options);
        });
      };
      const hereMarks = [];
      const showHere = (longitude, latitude) => {
        if (hereMarks.length) view.graphics.removeMany(hereMarks);
        hereMarks.length = 0;
        const point = new Point({ longitude, latitude });
        const halo = new Graphic({
          geometry: point,
          attributes: { here: true },
          symbol: new SimpleMarkerSymbol({ style: "circle", color: [37, 99, 235, 0.3], size: 36, outline: { color: [255, 255, 255, 0.95], width: 2 } }),
        });
        const dot = new Graphic({
          geometry: point,
          attributes: { here: true },
          symbol: new SimpleMarkerSymbol({ style: "circle", color: [37, 99, 235, 1], size: 14, outline: { color: [255, 255, 255], width: 3 } }),
        });
        hereMarks.push(halo, dot);
        view.graphics.addMany(hereMarks);
        return point;
      };
      let locationPending = Boolean(navigator.geolocation);
      let drawNearbyRoads = () => {};
      const zoomToHere = (longitude, latitude) => {
        const point = showHere(longitude, latitude);
        const zoom = Math.min(view.constraints?.effectiveMaxZoom ?? HERE_ZOOM, HERE_ZOOM);
        drawNearbyRoads(longitude, latitude);
        view.goTo({ target: point, zoom }, { duration: 450 }).catch(() => {}).finally(() => {
          locationPending = false;
          if (!cancelled) refreshExtent();
        });
        nameOrigin(longitude, latitude, "My location", { wide: true });
        console.info(`[LRS] Current location ${latitude.toFixed(5)}, ${longitude.toFixed(5)}`);
      };
      const locate = new Locate({ view, popupEnabled: false, scale: 1128 });
      locate.on("locate", (event) => {
        const coords = event.position?.coords;
        if (!coords) return;
        zoomToHere(coords.longitude, coords.latitude);
      });
      locate.on("locate-error", (event) => console.warn("[LRS] Could not get current location", event.error));
      view.ui.add(search, { position: "top-right", index: 0 });
      view.ui.add(locate, { position: "top-right", index: 1 });
      if (uiPanel) {
        uiPanel.className = "analysis-host";
        view.ui.add(uiPanel, { position: "top-right", index: 2 });
        view.watch("height", (height) => { uiPanel.style.maxHeight = `${Math.max(140, height - 120)}px`; });
        uiPanel.style.maxHeight = `${Math.max(140, (view.height || 500) - 120)}px`;
      }
      const lrsLayers = LRS_LAYER_DEFS.map(() => null);
      const roadIndex = LRS_LAYER_DEFS.findIndex((def) => def.route);
      const roadDef = LRS_LAYER_DEFS[roadIndex];
      const roadLayer = new GraphicsLayer({ id: `lrs-${roadDef.id}`, title: roadDef.title, listMode: "hide" });
      lrsLayers[roadIndex] = roadLayer;
      const overlayCount = map.layers.length;
      map.add(roadLayer, 0);
      const roadCasing = new SimpleLineSymbol({ color: [120, 128, 138, 0.95], width: 4.2, cap: "round", join: "round" });
      const roadCenter = new SimpleLineSymbol({ color: [255, 255, 255, 0.98], width: 1.8, cap: "round", join: "round" });
      const roadCasingDim = new SimpleLineSymbol({ color: [148, 163, 184, 0.4], width: 4.2, cap: "round", join: "round" });
      const roadCenterDim = new SimpleLineSymbol({ color: [255, 255, 255, 0.35], width: 1.8, cap: "round", join: "round" });
      const segmentCasing = new SimpleLineSymbol({ color: [255, 255, 255, 1], width: 8, cap: "round", join: "round" });
      const drawnRoads = new globalThis.Map();
      const roadLines = [];
      const accidentsSeen = new Map();
      let accidentFeatures = [];
      const routeWhere = { value: null };
      const effectFor = () => (routeWhere.value
        ? new FeatureEffect({ filter: new FeatureFilter({ where: routeWhere.value }), excludedEffect: "opacity(16%) grayscale(60%)" })
        : null);
      const symbolFor = (def) => (def.kind === "point"
        ? (def.shape === "x"
          ? { type: "simple-marker", style: "x", color: def.color, size: 6, outline: { color: def.color, width: 1.6 } }
          : { type: "simple-marker", style: def.shape || "circle", color: def.color, size: def.shape === "triangle" ? 7 : 5.5, outline: { color: [255, 255, 255, 0.9], width: 0.6 } })
        : { type: "simple-line", color: def.color, width: def.width || 2.5, cap: "round", join: "round" });
      const pause = () => new Promise((resolve) => setTimeout(resolve, 0));
      const seen = LRS_LAYER_DEFS.map(() => new globalThis.Map());
      const covered = LRS_LAYER_DEFS.map(() => []);
      const chains = LRS_LAYER_DEFS.map(() => Promise.resolve());
      const covers = (index, box, faithful) => covered[index].some((item) => (
        item.xmin <= box.xmin && item.ymin <= box.ymin && item.xmax >= box.xmax && item.ymax >= box.ymax
        && (!faithful || item.faithful)
      ));
      const geographicExtent = () => {
        const extent = view.extent;
        if (!extent) return null;
        const geo = extent.spatialReference?.isGeographic ? extent : webMercatorUtils.webMercatorToGeographic(extent);
        if (!geo || !Number.isFinite(geo.xmin)) return null;
        return { xmin: geo.xmin, ymin: geo.ymin, xmax: geo.xmax, ymax: geo.ymax };
      };
      const roadShape = (geometry) => {
        if (geometry?.curvePaths?.length) return new Polyline({ curvePaths: geometry.curvePaths, spatialReference: { wkid: 4326 } });
        if (geometry?.paths?.length) return new Polyline({ paths: geometry.paths, spatialReference: { wkid: 4326 } });
        return null;
      };
      const roadDetail = (geometry) => (geometry?.curvePaths?.length ? 100000 : (geometry?.paths || []).reduce((sum, path) => sum + path.length, 0));
      const syncRoadLines = () => {
        roadLines.length = 0;
        drawnRoads.forEach((entry) => {
          flattenPaths(entry.geometry).forEach((vertices) => {
            if (vertices.length < 2) return;
            const measures = [0];
            for (let i = 1; i < vertices.length; i += 1) measures.push(measures[i - 1] + haversineKm(vertices[i - 1], vertices[i]));
            if (measures[measures.length - 1] < 0.05) return;
            let minX = Infinity;
            let minY = Infinity;
            let maxX = -Infinity;
            let maxY = -Infinity;
            vertices.forEach(([x, y]) => {
              if (x < minX) minX = x;
              if (y < minY) minY = y;
              if (x > maxX) maxX = x;
              if (y > maxY) maxY = y;
            });
            roadLines.push({ vertices, measures, minX, minY, maxX, maxY, route: entry.casing?.attributes?.route || "" });
          });
        });
      };
      const drawSpan = (vertices, measures, span) => {
        const slice = sliceVertices(vertices, measures, span.from, span.to);
        if (slice.length < 2) return;
        const geometry = new Polyline({ paths: [slice], spatialReference: { wkid: 4326 } });
        hotspotLayer.add(new Graphic({ geometry, symbol: segmentCasing }));
        hotspotLayer.add(new Graphic({
          geometry,
          symbol: new SimpleLineSymbol({ color: span.ink, width: 4.5, cap: "round", join: "round" }),
        }));
      };
      const paintHotspots = () => {
        hotspotLayer.removeAll();
        const box = geographicExtent();
        if (!box || Math.abs(box.xmax - box.xmin) > 0.6 || !roadLines.length) return;
        const activeKey = routeRef.current?.id ? routeKey(routeRef.current.id) : "";
        const located = roadLines.map(() => []);
        accidentFeatures.forEach((feature) => {
          if (!accidentInLastMonth(accidentTime(feature.attributes))) return;
          if (feature.geometry?.x === undefined) return;
          const at = toLonLat(feature.geometry.x, feature.geometry.y);
          if (!at) return;
          let best = null;
          roadLines.forEach((line, index) => {
            if (activeKey && line.route === activeKey) return;
            if (at[0] < line.minX - 0.002 || at[0] > line.maxX + 0.002 || at[1] < line.minY - 0.002 || at[1] > line.maxY + 0.002) return;
            const hit = locateOnRoute(line.vertices, line.measures, at, 0.12);
            if (!hit || (best && hit.distanceKm >= best.distanceKm)) return;
            best = { index, measure: hit.measure, distanceKm: hit.distanceKm };
          });
          if (best) located[best.index].push(best.measure);
        });
        located.forEach((measures, index) => {
          const line = roadLines[index];
          hotspotSpans(measures).forEach((span) => drawSpan(line.vertices, line.measures, span));
        });
        const active = routeRef.current;
        if (active?.vertices?.length) {
          const measures = (eventsRef.current || [])
            .filter((item) => item.layerId === 17 && accidentInLastMonth(item.occurred))
            .map((item) => item.measure);
          hotspotSpans(measures).forEach((span) => drawSpan(active.vertices, active.measures, span));
        }
      };
      const accidentBoxes = [];
      const boxHolds = (item, extent) => item.xmin <= extent.xmin && item.ymin <= extent.ymin && item.xmax >= extent.xmax && item.ymax >= extent.ymax;
      const rememberAccidents = (features) => {
        (features || []).forEach((feature) => {
          const oid = feature.attributes?.OBJECTID ?? feature.attributes?.objectid;
          if (oid !== undefined && oid !== null) accidentsSeen.set(oid, feature);
        });
        accidentFeatures = [...accidentsSeen.values()];
        paintHotspots();
      };
      const ensureAccidents = (extent) => {
        if (!extent) return Promise.resolve();
        if (accidentBoxes.some((item) => boxHolds(item, extent))) {
          paintHotspots();
          return Promise.resolve();
        }
        const def = LRS_LAYER_DEFS.find((item) => item.id === 17);
        if (!def) return Promise.resolve();
        accidentBoxes.push(extent);
        return loadLayerInExtent(def, extent).then((result) => {
          if (!cancelled) rememberAccidents(result.features);
        }).catch((error) => {
          const at = accidentBoxes.indexOf(extent);
          if (at >= 0) accidentBoxes.splice(at, 1);
          console.warn("[LRS] Accident segments failed", error);
        });
      };
      const paintRoads = (features, routeFieldName) => {
        const fresh = [];
        features.forEach((feature) => {
          const oid = Number(feature.attributes?.OBJECTID ?? feature.attributes?.objectid);
          const shape = feature.geometry ? roadShape(feature.geometry) : null;
          if (!oid || !shape) return;
          const detail = roadDetail(feature.geometry);
          const previous = drawnRoads.get(oid);
          if (previous && (previous.detail || 0) >= detail) return;
          if (previous) roadLayer.removeMany([previous.casing, previous.center]);
          const rid = routeFieldName ? String(feature.attributes?.[routeFieldName] ?? "").trim() : "";
          const attributes = { oid, detail, rid, route: rid ? routeKey(rid) : "" };
          const casing = new Graphic({ geometry: shape, symbol: roadCasing, attributes: { ...attributes, part: "casing" } });
          const center = new Graphic({ geometry: shape, symbol: roadCenter, attributes: { ...attributes, part: "center" } });
          drawnRoads.set(oid, { casing, center, detail, geometry: feature.geometry });
          fresh.push(casing, center);
        });
        if (fresh.length) {
          roadLayer.addMany(fresh);
          console.info(`[LRS] Roads drawn: ${fresh.length} (${drawnRoads.size} on the map)`);
        }
        syncRoadLines();
        paintHotspots();
      };
      drawNearbyRoads = (longitude, latitude) => {
        if ((hiddenRef.current || []).includes(roadDef.id)) return;
        const km = 1.2;
        const dLat = km / 111;
        const dLon = km / (111 * Math.max(0.2, Math.cos((latitude * Math.PI) / 180)));
        const box = { xmin: longitude - dLon, ymin: latitude - dLat, xmax: longitude + dLon, ymax: latitude + dLat };
        if (covers(roadIndex, box, true)) return;
        const record = { ...box, faithful: true };
        covered[roadIndex].push(record);
        const started = performance.now();
        ensureAccidents(box);
        loadRoadsInExtent(box).then((result) => {
          if (cancelled) return;
          paintRoads(result.features, result.routeField);
          console.info(`[LRS] Nearby roads in ${Math.round(performance.now() - started)} ms`);
        }).catch((error) => {
          const at = covered[roadIndex].indexOf(record);
          if (at >= 0) covered[roadIndex].splice(at, 1);
          console.warn("[LRS] Nearby roads failed", error);
        });
      };
      const ensureLayer = (def) => {
        const index = LRS_LAYER_DEFS.findIndex((item) => item.id === def.id);
        if (lrsLayers[index] && lrsLayers[index] !== "pending") return lrsLayers[index];
        const featureLayer = new FeatureLayer({
          id: `lrs-${def.id}`,
          title: def.title,
          source: [],
          objectIdField: "oid",
          fields: [{ name: "oid", type: "oid" }, { name: "route", type: "string" }, { name: "rid", type: "string" }],
          geometryType: def.kind === "point" ? "point" : "polyline",
          spatialReference: { wkid: 4326 },
          renderer: { type: "simple", symbol: symbolFor(def) },
          outFields: ["route", "rid"],
          popupEnabled: false,
          listMode: "hide",
          visible: !(hiddenRef.current || []).includes(def.id),
          featureEffect: def.showAll ? null : effectFor(),
        });
        lrsLayers[index] = featureLayer;
        const aboveRoads = Math.max(1, map.layers.length - overlayCount);
        map.add(featureLayer, def.kind === "point" || def.showAll ? aboveRoads : 0);
        return featureLayer;
      };
      const graphicsFor = (features, routeField, index, keepCurves) => {
        const add = [];
        const update = [];
        features.forEach((feature) => {
          const oid = Number(feature.attributes?.OBJECTID ?? feature.attributes?.objectid);
          if (!oid) return;
          const g = feature.geometry;
          if (!g) return;
          let geometry = null;
          let detail = 1;
          if (g.x !== undefined) {
            const at = toLonLat(g.x, g.y);
            if (at) geometry = new Point({ longitude: at[0], latitude: at[1] });
          } else {
            const paths = flattenPaths(g)
              .map((path) => (keepCurves ? path : thinPath(path)))
              .filter((path) => path.length > 1);
            if (paths.length) {
              geometry = new Polyline({ paths, spatialReference: { wkid: 4326 } });
              detail = paths.reduce((count, path) => count + path.length, 0);
            }
          }
          if (!geometry) return;
          const previous = seen[index].get(oid);
          if (previous !== undefined && previous >= detail) return;
          seen[index].set(oid, detail);
          const rid = routeField ? String(feature.attributes?.[routeField] ?? "").trim() : "";
          const graphic = new Graphic({
            geometry,
            attributes: { oid, route: rid ? routeKey(rid) : "", rid },
          });
          if (previous === undefined) add.push(graphic);
          else update.push(graphic);
        });
        return { add, update };
      };
      const addFeatures = (def, features, routeField) => {
        const index = LRS_LAYER_DEFS.findIndex((item) => item.id === def.id);
        if (index < 0 || !features?.length) return Promise.resolve();
        chains[index] = chains[index].then(async () => {
          if (cancelled) return;
          const layer = ensureLayer(def);
          if (!layer.loaded) await layer.load();
          const { add, update } = graphicsFor(features, routeField, index, Boolean(def.route));
          for (let i = 0; i < add.length; i += 40) {
            if (cancelled) return;
            await layer.applyEdits({ addFeatures: add.slice(i, i + 40) });
            await pause();
          }
          for (let i = 0; i < update.length; i += 40) {
            if (cancelled) return;
            await layer.applyEdits({ updateFeatures: update.slice(i, i + 40) });
            await pause();
          }
          if (add.length || update.length) console.info(`[LRS] ${def.title}: added ${add.length}, updated ${update.length} (${seen[index].size} total)`);
        }).catch((error) => console.warn(`[LRS] Could not draw ${def.title}`, error));
        return chains[index];
      };
      const refreshExtent = () => {
        const box = geographicExtent();
        if (!box) return Promise.resolve();
        const hidden = new Set(hiddenRef.current || []);
        const faithful = Math.abs(box.xmax - box.xmin) < 0.05;
        const jobs = [];
        LRS_LAYER_DEFS.forEach((def, index) => {
          if (def.route) {
            if (hidden.has(def.id) || covers(index, box, faithful)) return;
            const record = { ...box, faithful };
            covered[index].push(record);
            jobs.push(ensureAccidents(box));
            jobs.push(loadRoadsInExtent(box).then((result) => {
              if (!cancelled) paintRoads(result.features, result.routeField);
            }).catch((error) => {
              const at = covered[index].indexOf(record);
              if (at >= 0) covered[index].splice(at, 1);
              console.warn("[LRS] Road Network view query failed", error);
            }));
            return;
          }
          const detailed = def.kind !== "point" && faithful;
          if (hidden.has(def.id) || covers(index, box, detailed)) return;
          const record = { ...box, faithful: detailed };
          covered[index].push(record);
          const load = loadLayerInExtent(def, box);
          jobs.push(load.then((result) => {
            if (cancelled) return null;
            if (def.id === 17) rememberAccidents(result.features);
            return addFeatures(def, result.features, result.routeField);
          }).catch((error) => {
            const boxes = covered[index];
            const at = boxes.indexOf(record);
            if (at >= 0) boxes.splice(at, 1);
            console.warn(`[LRS] ${def.title} view query failed`, error);
          }));
        });
        return Promise.all(jobs);
      };
      view.watch("stationary", (isStationary) => {
        if (isStationary && !locationPending) refreshExtent();
      });
      const whenReady = (tries = 0) => {
        if (cancelled || tries > 40) return;
        if (!geographicExtent()) {
          setTimeout(() => whenReady(tries + 1), 150);
          return;
        }
        refreshExtent();
      };
      let placed = false;
      let placedAt = null;
      takeFix = (coords) => {
        if (cancelled) return;
        if (!coords) {
          if (!placed) {
            locationPending = false;
            whenReady();
          }
          return;
        }
        const shifted = placedAt && Math.hypot(coords.longitude - placedAt[0], coords.latitude - placedAt[1]) > 0.004;
        placedAt = [coords.longitude, coords.latitude];
        if (!placed || shifted) {
          placed = true;
          zoomToHere(coords.longitude, coords.latitude);
          return;
        }
        showHere(coords.longitude, coords.latitude);
        drawNearbyRoads(coords.longitude, coords.latitude);
      };
      if (!navigator.geolocation) takeFix(null);
      else if (pendingFix !== undefined) takeFix(pendingFix);
      let hoverFrame = 0;
      view.on("pointer-move", (event) => {
        if (hoverFrame) return;
        hoverFrame = requestAnimationFrame(() => {
          hoverFrame = 0;
          const current = api.current?.route;
          if (!current) return;
          const mapPoint = view.toMap(event);
          if (!mapPoint) return;
          hoverRef.current?.(mapPoint.longitude, mapPoint.latitude);
        });
      });
      view.on("pointer-leave", () => leaveRef.current?.());
      view.on("click", (event) => {
        if (segmentPickRef.current) {
          segmentClickRef.current?.(event.mapPoint.longitude, event.mapPoint.latitude);
          return;
        }
        if (pickingRef.current) {
          nameOrigin(event.mapPoint.longitude, event.mapPoint.latitude, "Picked on map");
          return;
        }
        const roadLayer = lrsLayers[roadIndex];
        if (!roadLayer || roadLayer === "pending" || !roadLayer.visible) return;
        view.hitTest(event, { include: [roadLayer] }).then((response) => {
          const hit = response.results.find((result) => result.graphic?.layer === roadLayer);
          const id = String(hit?.graphic?.attributes?.rid ?? "").trim();
          if (!id) return;
          console.info(`[LRS] Picked route ${id} from the map.`);
          pickRef.current?.(id);
        }).catch(() => {});
      });
      const layerViews = new window.Map();
      const applyRouteEffect = (activeRoute, otherRoute) => {
        const ids = [activeRoute?.id, otherRoute?.id].filter(Boolean);
        const keyed = ids.map((id) => `'${routeKey(id).replace(/'/g, "''")}'`);
        const keys = new Set(ids.map((id) => routeKey(id)));
        routeWhere.value = keyed.length ? `route IN (${keyed.join(",")})` : null;
        roadLayer.graphics.forEach((graphic) => {
          const on = !keys.size || keys.has(graphic.attributes?.route);
          const center = graphic.attributes?.part === "center";
          graphic.symbol = center ? (on ? roadCenter : roadCenterDim) : (on ? roadCasing : roadCasingDim);
        });
        lrsLayers.forEach((layer, index) => {
          if (!layer || layer === "pending" || LRS_LAYER_DEFS[index].route) return;
          if (LRS_LAYER_DEFS[index].showAll) {
            layer.featureEffect = null;
            return;
          }
          const lineEvent = LRS_LAYER_DEFS[index].kind === "line";
          layer.featureEffect = routeWhere.value
            ? new FeatureEffect({
              filter: new FeatureFilter({ where: routeWhere.value }),
              excludedEffect: lineEvent ? "opacity(0%)" : "opacity(16%) grayscale(60%)",
            })
            : null;
        });
      };
      api.current = { view, map, overlay, projectLayer, analysisLayer, segmentLayer, compareLayer, accidentLayer, compareCursorLayer, cursorLayer, hereLayer, lrsLayers, layerViews, applyRouteEffect, refreshExtent, paintHotspots, FeatureLayer, Graphic, Polyline, Point, geometryEngine, SimpleLineSymbol, SimpleMarkerSymbol, SimpleFillSymbol, route: null };
      if (mapApi) mapApi.current = api.current;
      setReady(true);
    });
    return () => {
      cancelled = true;
      if (mapApi) mapApi.current = null;
      view?.destroy();
    };
  }, []);

  useEffect(() => {
    const bag = api.current;
    if (!bag || !route) return;
    bag.route = route;
    const { view, overlay, Graphic, Polyline, geometryEngine, SimpleFillSymbol, SimpleLineSymbol } = bag;
    overlay.removeAll();
    const curved = (route.geometries || []).map((geom) => {
      const rawX = geom.curvePaths?.[0]?.[0]?.[0] ?? geom.paths?.[0]?.[0]?.[0];
      const spatialReference = Math.abs(rawX || 0) > 180 ? { wkid: 102100 } : { wkid: 4326 };
      return new Polyline(geom.curvePaths ? { curvePaths: geom.curvePaths, spatialReference } : { paths: geom.paths, spatialReference });
    });
    const line = curved[0] || new Polyline({ paths: [route.vertices], spatialReference: { wkid: 4326 } });
    const halo = new SimpleLineSymbol({ color: [0, 255, 255, 0.35], width: 14, cap: "round", join: "round" });
    const ink = new SimpleLineSymbol({ color: [0, 255, 255, 1], width: 5, cap: "round", join: "round" });
    curved.forEach((geometry) => {
      overlay.add(new Graphic({ geometry, symbol: halo }));
      overlay.add(new Graphic({ geometry, symbol: ink }));
    });
    if (route.vertices?.length > 1) {
      const ends = [
        { at: route.vertices[0], color: [22, 163, 74], label: "Start" },
        { at: route.vertices[route.vertices.length - 1], color: [220, 38, 38], label: "End" },
      ];
      ends.forEach(({ at, color, label }) => {
        overlay.add(new Graphic({
          geometry: new bag.Point({ longitude: at[0], latitude: at[1] }),
          attributes: { end: label },
          symbol: new bag.SimpleMarkerSymbol({ style: "circle", color, size: 13, outline: { color: [255, 255, 255], width: 2.5 } }),
        }));
      });
    }

    const target = curved.length ? curved : line;
    const label = `${route.id}${route.trajectory && route.trajectory !== route.id ? ` · ${route.trajectory}` : ""}`;
    const started = performance.now();
    console.info(`[LRS] Zooming to route ${label}…`);
    focusRef.current?.(`Zooming to ${label}…`);
    view.goTo({ target, padding: 48 }, { duration: 700, easing: "ease-in-out" })
      .then(() => {
        console.info(`[LRS] Route ${label} highlighted and in view (${Math.round(performance.now() - started)} ms, ${route.lengthKm.toFixed(2)} km).`);
      })
      .catch((error) => {
        if (error?.name !== "AbortError") console.warn(`[LRS] Could not zoom to route ${label}`, error);
      })
      .finally(() => focusRef.current?.(null));
  }, [route, ready]);

  useEffect(() => {
    const bag = api.current;
    if (!bag?.analysisLayer) return;
    const { view, analysisLayer, Graphic, Point, Polyline, geometryEngine, SimpleFillSymbol, SimpleLineSymbol, SimpleMarkerSymbol } = bag;
    analysisLayer.removeAll();
    if (!analysis?.origin) return;
    const origin = new Point({ longitude: analysis.origin[0], latitude: analysis.origin[1] });
    const circle = geometryEngine.geodesicBuffer(origin, analysis.radiusM, "meters");
    analysisLayer.add(new Graphic({
      geometry: circle,
      symbol: new SimpleFillSymbol({ color: [56, 189, 248, 0.12], outline: { color: [14, 165, 233, 0.95], width: 1.5, style: "dash" } }),
    }));
    (analysis.results || []).forEach((item, index) => {
      const nearest = new Point({ longitude: item.point[0], latitude: item.point[1] });
      const first = index === 0;
      analysisLayer.add(new Graphic({
        geometry: new Polyline({ paths: [[analysis.origin, item.point]], spatialReference: { wkid: 4326 } }),
        symbol: new SimpleLineSymbol({ color: first ? [250, 204, 21, 1] : [255, 255, 255, 0.8], width: first ? 2 : 1, style: "short-dash" }),
      }));
      analysisLayer.add(new Graphic({
        geometry: nearest,
        symbol: new SimpleMarkerSymbol({ style: "circle", size: first ? 8 : 6, color: first ? [250, 204, 21, 1] : [255, 255, 255, 0.95], outline: { color: [15, 23, 42], width: 1 } }),
      }));
    });
    analysisLayer.add(new Graphic({
      geometry: origin,
      symbol: new SimpleMarkerSymbol({ style: "circle", size: 10, color: [14, 165, 233, 1], outline: { color: [255, 255, 255], width: 2 } }),
    }));
    const zoomKey = `${analysis.origin[0]},${analysis.origin[1]}|${analysis.radiusM}|${analysis.wide}|${analysis.zoom}`;
    if (analysis.zoom && zoomKey !== bag.zoomKey) {
      bag.zoomKey = zoomKey;
      const target = analysis.wide
        ? { target: new Point({ longitude: analysis.origin[0], latitude: analysis.origin[1] }), zoom: HERE_ZOOM }
        : { target: circle, padding: 48 };
      view.goTo(target, { duration: 500 }).catch(() => {});
    }
  }, [analysis, ready]);

  useEffect(() => {
    const bag = api.current;
    if (!bag?.compareLayer) return;
    const { view, compareLayer, Graphic, Polyline, SimpleLineSymbol } = bag;
    compareLayer.removeAll();
    if (!compareRoute || compareRoute.id === route?.id) return;
    const toLine = (geom) => {
      const rawX = geom.curvePaths?.[0]?.[0]?.[0] ?? geom.paths?.[0]?.[0]?.[0];
      const spatialReference = Math.abs(rawX || 0) > 180 ? { wkid: 102100 } : { wkid: 4326 };
      return new Polyline(geom.curvePaths ? { curvePaths: geom.curvePaths, spatialReference } : { paths: geom.paths, spatialReference });
    };
    const lines = (compareRoute.geometries || []).map(toLine);
    if (!lines.length && compareRoute.vertices?.length) lines.push(new Polyline({ paths: [compareRoute.vertices], spatialReference: { wkid: 4326 } }));
    const halo = new SimpleLineSymbol({ color: [217, 70, 239, 0.3], width: 12, cap: "round", join: "round" });
    const ink = new SimpleLineSymbol({ color: [217, 70, 239, 1], width: 4, cap: "round", join: "round" });
    lines.forEach((geometry) => {
      compareLayer.add(new Graphic({ geometry, symbol: halo }));
      compareLayer.add(new Graphic({ geometry, symbol: ink }));
    });
    const label = (target, text, color) => {
      const at = target?.vertices?.length ? pointAtMeasure(target.vertices, target.measures, target.lengthKm / 2) : null;
      if (!at) return;
      compareLayer.add(new Graphic({
        geometry: new bag.Point({ longitude: at[0], latitude: at[1] }),
        symbol: { type: "text", text, color: [255, 255, 255], haloColor: color, haloSize: 2.5, font: { size: 11, weight: "bold", family: "sans-serif" }, yoffset: 10 },
      }));
    };
    if (route) label(route, `A · ${route.id}`, [8, 145, 178]);
    label(compareRoute, `B · ${compareRoute.id}`, [192, 38, 211]);
    const targets = [...lines, ...bag.overlay.graphics.toArray().map((graphic) => graphic.geometry)];
    if (targets.length) view.goTo({ target: targets, padding: 60 }, { duration: 600 }).catch(() => {});
  }, [compareRoute, route, ready]);

  useEffect(() => {
    const bag = api.current;
    if (!bag?.segmentLayer) return;
    const { view, segmentLayer, Graphic, Point, Polyline, SimpleLineSymbol, SimpleMarkerSymbol } = bag;
    segmentLayer.removeAll();
    if (!route || !segment) return;
    const slice = sliceVertices(route.vertices, route.measures, segment.from, segment.to);
    if (slice.length < 2) return;
    const line = new Polyline({ paths: [slice], spatialReference: { wkid: 4326 } });
    const tone = segmentAccidents(events, segment.from, segment.to);
    segmentLayer.add(new Graphic({ geometry: line, symbol: new SimpleLineSymbol({ color: [255, 255, 255, 1], width: 8, cap: "round", join: "round" }) }));
    segmentLayer.add(new Graphic({ geometry: line, symbol: new SimpleLineSymbol({ color: tone.level === "low" ? [250, 204, 21, 1] : tone.ink, width: 4.5, cap: "round", join: "round" }) }));
    [slice[0], slice[slice.length - 1]].forEach((vertex) => {
      segmentLayer.add(new Graphic({
        geometry: new Point({ longitude: vertex[0], latitude: vertex[1] }),
        symbol: new SimpleMarkerSymbol({ style: "square", size: 8, color: tone.level === "low" ? [250, 204, 21, 1] : tone.ink, outline: { color: [255, 255, 255], width: 1.5 } }),
      }));
    });
    view.goTo({ target: line, padding: 60 }, { duration: 500 }).catch(() => {});
  }, [route, segment, events, ready]);

  useEffect(() => {
    const bag = api.current;
    if (!bag?.view?.container) return;
    bag.view.container.style.cursor = pickingOrigin || segmentPicking ? "crosshair" : "";
  }, [pickingOrigin, segmentPicking, ready]);

  useEffect(() => {
    const bag = api.current;
    if (!bag?.cursorLayer || !bag.segmentLayer) return undefined;
    if (!route || segmentStart === null || segmentStart === undefined) return undefined;
    const at = pointAtMeasure(route.vertices, route.measures, segmentStart);
    if (!at) return undefined;
    const marker = new bag.Graphic({
      geometry: new bag.Point({ longitude: at[0], latitude: at[1] }),
      symbol: new bag.SimpleMarkerSymbol({ style: "square", size: 10, color: [22, 163, 74, 1], outline: { color: [255, 255, 255], width: 2 } }),
    });
    bag.segmentLayer.add(marker);
    return () => bag.segmentLayer.remove(marker);
  }, [route, segmentStart, ready]);

  useEffect(() => {
    const bag = api.current;
    if (!bag?.projectLayer) return;
    const { projectLayer, Graphic, Polyline, Point, geometryEngine, SimpleFillSymbol, SimpleLineSymbol, SimpleMarkerSymbol } = bag;
    projectLayer.removeAll();
    if (!route || !project) return;
    const slice = sliceVertices(route.vertices, route.measures, project.startKm, project.endKm);
    if (slice.length > 1) {
      const segment = new Polyline({ paths: [slice], spatialReference: { wkid: 4326 } });
      const buffer = geometryEngine.geodesicBuffer(segment, Number(project.bufferM) || 80, "meters");
      projectLayer.add(new Graphic({
        geometry: buffer,
        symbol: new SimpleFillSymbol({ color: [244, 114, 182, 0.28], outline: { color: [190, 24, 93, 0.9], width: 1.5 } }),
      }));
      projectLayer.add(new Graphic({ geometry: segment, symbol: new SimpleLineSymbol({ color: [190, 24, 93], width: 6 }) }));
    }
    (project.attached || []).forEach((item) => {
      if (!item.point) return;
      projectLayer.add(new Graphic({
        geometry: new Point({ longitude: item.point[0], latitude: item.point[1] }),
        symbol: new SimpleMarkerSymbol({ style: "circle", color: [255, 255, 255, 0], size: 11, outline: { color: [190, 24, 93], width: 2 } }),
      }));
    });
  }, [route, project, ready]);

  useEffect(() => {
    const bag = api.current;
    if (!bag?.cursorLayer) return;
    bag.cursorLayer.removeAll();
    if (!route || !cursor) return;
    const at = pointAtMeasure(route.vertices, route.measures, cursor.measure);
    if (!at) return;
    bag.cursorLayer.add(new bag.Graphic({
      geometry: new bag.Point({ longitude: at[0], latitude: at[1] }),
      symbol: new bag.SimpleMarkerSymbol({
        style: "circle",
        color: [255, 247, 237, 0.98],
        size: 11,
        outline: { color: [120, 53, 15], width: 2.5 },
      }),
    }));
    if (activeEvent && route) {
      const span = activeEvent.kind === "span" ? sliceVertices(route.vertices, route.measures, activeEvent.from, activeEvent.to) : [];
      if (span.length > 1) {
        bag.cursorLayer.add(new bag.Graphic({
          geometry: new bag.Polyline({ paths: [span], spatialReference: { wkid: 4326 } }),
          symbol: new bag.SimpleLineSymbol({ color: [250, 204, 21, 1], width: 8, cap: "round", join: "round" }),
        }));
      }
      const at = pointAtMeasure(route.vertices, route.measures, activeEvent.measure);
      if (at) {
        bag.cursorLayer.add(new bag.Graphic({
          geometry: new bag.Point({ longitude: at[0], latitude: at[1] }),
          symbol: new bag.SimpleMarkerSymbol({
            style: "circle",
            color: [250, 204, 21, 0.95],
            size: 12,
            outline: { color: [255, 255, 255], width: 2 },
          }),
        }));
      }
    }
  }, [route, cursor, activeEvent, ready]);

  useEffect(() => {
    const bag = api.current;
    if (!bag?.view || !activeEvent || !route) return;
    const span = activeEvent.kind === "span" ? sliceVertices(route.vertices, route.measures, activeEvent.from, activeEvent.to) : [];
    if (span.length > 1) {
      bag.view.goTo({ target: new bag.Polyline({ paths: [span], spatialReference: { wkid: 4326 } }), padding: 80 }, { duration: 650, easing: "ease-in-out" }).catch(() => {});
      return;
    }
    const at = pointAtMeasure(route.vertices, route.measures, activeEvent.measure);
    if (!at) return;
    bag.view.goTo({ target: new bag.Point({ longitude: at[0], latitude: at[1] }), zoom: 17 }, { duration: 650, easing: "ease-in-out" }).catch(() => {});
  }, [activeEvent, route, ready]);

  useEffect(() => {
    const bag = api.current;
    if (!bag?.lrsLayers || !ready) return;
    const other = compareRoute && compareRoute.id !== route?.id ? compareRoute : null;
    bag.route = route || null;
    bag.compareRoute = other;
    bag.applyRouteEffect?.(route, other);
    bag.paintHotspots?.();
  }, [route, compareRoute, events, ready]);

  useEffect(() => {
    const bag = api.current;
    if (!bag?.accidentLayer) return;
    const accidentId = LRS_LAYER_DEFS.find((def) => def.snap)?.id;
    bag.accidentLayer.removeAll();
    const mark = (target, item) => {
      if (!target?.vertices?.length || !item || item.layerId !== accidentId) return;
      const at = pointAtMeasure(target.vertices, target.measures, item.measure);
      if (!at) return;
      bag.accidentLayer.add(new bag.Graphic({
        geometry: new bag.Point({ longitude: at[0], latitude: at[1] }),
        attributes: { id: item.id },
        symbol: new bag.SimpleMarkerSymbol({
          style: "triangle",
          color: item.color || [220, 38, 38, 0.95],
          size: 14,
          outline: { color: [255, 255, 255, 1], width: 1.5 },
        }),
      }));
    };
    mark(route, activeEvent);
    if (compareRoute && compareRoute.id !== route?.id) mark(compareRoute, compareEvent);
  }, [route, activeEvent, compareRoute, compareEvent, ready]);

  useEffect(() => {
    const bag = api.current;
    if (!bag?.compareCursorLayer) return;
    bag.compareCursorLayer.removeAll();
    if (!compareRoute || compareRoute.id === route?.id) return;
    if (compareCursor) {
      const at = pointAtMeasure(compareRoute.vertices, compareRoute.measures, compareCursor.measure);
      if (at) {
        bag.compareCursorLayer.add(new bag.Graphic({
          geometry: new bag.Point({ longitude: at[0], latitude: at[1] }),
          symbol: new bag.SimpleMarkerSymbol({ style: "circle", color: [253, 244, 255, 0.98], size: 11, outline: { color: [134, 25, 143], width: 2.5 } }),
        }));
      }
    }
    if (compareEvent) {
      const span = compareEvent.kind === "span" ? sliceVertices(compareRoute.vertices, compareRoute.measures, compareEvent.from, compareEvent.to) : [];
      if (span.length > 1) {
        bag.compareCursorLayer.add(new bag.Graphic({
          geometry: new bag.Polyline({ paths: [span], spatialReference: { wkid: 4326 } }),
          symbol: new bag.SimpleLineSymbol({ color: [217, 70, 239, 1], width: 8, cap: "round", join: "round" }),
        }));
      }
      const at = pointAtMeasure(compareRoute.vertices, compareRoute.measures, compareEvent.measure);
      if (at) {
        bag.compareCursorLayer.add(new bag.Graphic({
          geometry: new bag.Point({ longitude: at[0], latitude: at[1] }),
          symbol: new bag.SimpleMarkerSymbol({ style: "circle", color: [217, 70, 239, 0.95], size: 12, outline: { color: [255, 255, 255], width: 2 } }),
        }));
      }
    }
  }, [route, compareRoute, compareCursor, compareEvent, ready]);

  useEffect(() => {
    const bag = api.current;
    if (!bag?.view || !compareEvent || !compareRoute || compareRoute.id === route?.id) return;
    const span = compareEvent.kind === "span" ? sliceVertices(compareRoute.vertices, compareRoute.measures, compareEvent.from, compareEvent.to) : [];
    if (span.length > 1) {
      bag.view.goTo({ target: new bag.Polyline({ paths: [span], spatialReference: { wkid: 4326 } }), padding: 80 }, { duration: 650 }).catch(() => {});
      return;
    }
    const at = pointAtMeasure(compareRoute.vertices, compareRoute.measures, compareEvent.measure);
    if (!at) return;
    bag.view.goTo({ target: new bag.Point({ longitude: at[0], latitude: at[1] }), zoom: 17 }, { duration: 650 }).catch(() => {});
  }, [compareEvent, compareRoute, route, ready]);

  useEffect(() => {
    const bag = api.current;
    if (!bag?.lrsLayers) return;
    const hidden = new Set(hiddenLayerIds || []);
    bag.lrsLayers.forEach((layer, index) => {
      if (layer && layer !== "pending") layer.visible = !hidden.has(LRS_LAYER_DEFS[index].id);
    });
    bag.refreshExtent?.();
  }, [hiddenLayerIds, ready]);

  return ref;
}
