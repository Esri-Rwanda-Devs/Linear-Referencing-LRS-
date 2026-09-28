import { useEffect, useRef, useState } from "react";
import { LRS_LAYER_DEFS, RWANDA_EXTENT } from "../config";
import { pointAtMeasure, sliceVertices } from "../lrs/geometry";
import { loadLayerCache, subscribeLayers } from "../lrs/lrsService";

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
];

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

export function useRoadMap({ route, cursor, project, activeEvent, hiddenLayerIds, uiPanel, analysis, pickingOrigin, onOrigin, onHoverMeasure, onLeave, onFocusChange, onPickRoute }) {
  const pickRef = useRef(onPickRoute);
  pickRef.current = onPickRoute;
  const originRef = useRef(onOrigin);
  originRef.current = onOrigin;
  const pickingRef = useRef(pickingOrigin);
  pickingRef.current = pickingOrigin;
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
    let unsubscribe = () => {};
    loadModules(MODULES).then(async (mods) => {
      if (cancelled || !ref.current) return;
      const [Map, MapView, FeatureLayer, GraphicsLayer, Graphic, Polyline, Point, geometryEngine, SimpleLineSymbol, SimpleMarkerSymbol, SimpleFillSymbol, FeatureEffect, FeatureFilter, Search, Locate] = mods;
      const overlay = new GraphicsLayer({ id: "lrs-overlay", listMode: "hide" });
      const cursorLayer = new GraphicsLayer({ id: "lrs-cursor", listMode: "hide" });
      const projectLayer = new GraphicsLayer({ id: "lrs-project", listMode: "hide" });
      const analysisLayer = new GraphicsLayer({ id: "lrs-analysis", listMode: "hide" });
      const map = new Map({ basemap: "satellite", layers: [analysisLayer, overlay, projectLayer, cursorLayer] });
      view = new MapView({
        container: ref.current,
        map,
        extent: RWANDA_EXTENT,
        highlightOptions: { color: [232, 122, 46], haloOpacity: 0 },
      });
      view.ui.remove("attribution");
      const search = new Search({ view, popupEnabled: false, resultGraphicEnabled: false, locationEnabled: false, placeholder: "Search a place in Rwanda" });
      search.when(() => {
        search.defaultSources?.forEach((source) => { source.countryCode = "RWA"; });
      }).catch(() => {});
      search.on("select-result", (event) => {
        const geometry = event.result?.feature?.geometry;
        const point = geometry?.type === "point" ? geometry : geometry?.extent?.center;
        if (point) originRef.current?.([point.longitude, point.latitude], event.result.name || "Search result");
      });
      const locate = new Locate({ view, popupEnabled: false, scale: 12000 });
      locate.on("locate", (event) => {
        const coords = event.position?.coords;
        if (coords) originRef.current?.([coords.longitude, coords.latitude], "My location");
      });
      locate.on("locate-error", (event) => console.warn("[LRS] Could not get current location", event.error));
      view.ui.add(search, { position: "top-right", index: 0 });
      view.ui.add(locate, { position: "top-right", index: 1 });
      if (uiPanel) view.ui.add(uiPanel, { position: "top-right", index: 2 });
      const lrsLayers = LRS_LAYER_DEFS.map((def) => new GraphicsLayer({ id: `lrs-${def.id}`, title: def.title, listMode: "hide" }));
      map.addMany(lrsLayers, 0);
      const drawn = new Set();
      const sources = [];
      const baseSymbols = new WeakMap();
      const fadedSymbols = new window.Map();
      let framed = false;
      let styleLayer = () => {};
      const paint = (symbol, alpha, scale) => {
        const next = symbol.clone();
        const color = next.color;
        if (color) next.color = [color.r, color.g, color.b, alpha];
        if (next.outline?.color) {
          const outline = next.outline.clone();
          const ink = outline.color;
          outline.color = [ink.r, ink.g, ink.b, Math.min(1, alpha + 0.2)];
          next.outline = outline;
        }
        if (next.width) next.width = Math.max(1, next.width * scale);
        return next;
      };
      let applyRouteEffect = () => {};
      const drawLayer = (layer) => {
        if (cancelled || drawn.has(layer.id)) return;
        drawn.add(layer.id);
        sources.push(layer);
        const index = LRS_LAYER_DEFS.findIndex((def) => def.id === layer.id);
        const graphicsLayer = lrsLayers[index];
        if (!graphicsLayer) return;
        const symbol = layer.def.kind === "point"
          ? new SimpleMarkerSymbol(layer.def.shape === "x"
            ? { style: "x", color: layer.def.color, size: 6, outline: { color: layer.def.color, width: 1.6 } }
            : { style: layer.def.shape || "circle", color: layer.def.color, size: layer.def.shape === "triangle" ? 7 : 5.5, outline: { color: [255, 255, 255, 0.9], width: 0.6 } })
          : new SimpleLineSymbol({ color: layer.def.color, width: layer.def.width || 2.5, cap: "round", join: "round" });
        const graphics = [];
        layer.features.forEach((feature) => {
          if (!feature.geometry) return;
          const rawX = feature.geometry.x ?? feature.geometry.paths?.[0]?.[0]?.[0] ?? feature.geometry.curvePaths?.[0]?.[0]?.[0];
          const spatialReference = Math.abs(rawX || 0) > 180 ? { wkid: 102100 } : { wkid: 4326 };
          const geometry = feature.geometry.x !== undefined
            ? new Point({ x: feature.geometry.x, y: feature.geometry.y, spatialReference })
            : new Polyline(feature.geometry.curvePaths
              ? { curvePaths: feature.geometry.curvePaths, spatialReference }
              : { paths: feature.geometry.paths, spatialReference });
          if (!geometry) return;
          const graphic = new Graphic({ attributes: feature.attributes, geometry, symbol: symbol.clone() });
          baseSymbols.set(graphic, graphic.symbol.clone());
          graphics.push(graphic);
        });
        if (graphics.length) graphicsLayer.addMany(graphics);
        styleLayer(layer, graphicsLayer, api.current?.route);
        if (!framed && graphicsLayer.visible && !api.current?.route && graphics.length) {
          framed = true;
          view.goTo(graphicsLayer.graphics).catch(() => {});
        }
      };
      unsubscribe = subscribeLayers(drawLayer);
      loadLayerCache().catch((error) => console.error(error));
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
      const roadIndex = LRS_LAYER_DEFS.findIndex((def) => def.route);
      const roadLayer = lrsLayers[roadIndex];
      view.on("click", (event) => {
        if (pickingRef.current) {
          originRef.current?.([event.mapPoint.longitude, event.mapPoint.latitude], "Picked on map");
          return;
        }
        if (!roadLayer?.visible) return;
        view.hitTest(event, { include: [roadLayer] }).then((response) => {
          const hit = response.results.find((result) => result.graphic?.layer === roadLayer);
          if (!hit) return;
          const source = sources.find((item) => item.id === LRS_LAYER_DEFS[roadIndex].id);
          const attributes = hit.graphic.attributes || {};
          const field = source?.routeField || Object.keys(attributes).find((name) => /^route_?id$/i.test(name));
          const id = field ? String(attributes[field] ?? "").trim() : "";
          if (!id) return;
          console.info(`[LRS] Picked route ${id} from the map.`);
          pickRef.current?.(id);
        }).catch(() => {});
      });
      const layerViews = new window.Map();
      const fadedSymbol = (source) => {
        const cached = fadedSymbols.get(source.id);
        if (cached) return cached;
        const sample = lrsLayers[LRS_LAYER_DEFS.findIndex((def) => def.id === source.id)]?.graphics.getItemAt(0);
        const base = sample ? baseSymbols.get(sample) : null;
        const faded = base ? paint(base, 0.14, 0.6) : null;
        if (faded) fadedSymbols.set(source.id, faded);
        return faded;
      };
      styleLayer = (source, graphicsLayer, activeRoute) => {
        if (!source || !graphicsLayer) return;
        const field = activeRoute?.routeField;
        const routeField = source.routeField || field;
        const faded = fadedSymbol(source);
        graphicsLayer.graphics.forEach((graphic) => {
          const onRoute = !activeRoute || !routeField || String(graphic.attributes?.[routeField] ?? "").trim() === String(activeRoute.id).trim();
          graphic.visible = true;
          const base = baseSymbols.get(graphic);
          if (!base) return;
          const next = onRoute ? base : faded;
          if (next && graphic.symbol !== next) graphic.symbol = next;
        });
      };
      applyRouteEffect = (activeRoute) => {
        sources.forEach((source) => {
          const index = LRS_LAYER_DEFS.findIndex((def) => def.id === source.id);
          styleLayer(source, lrsLayers[index], activeRoute);
        });
      };
      api.current = { view, map, overlay, projectLayer, analysisLayer, cursorLayer, lrsLayers, layerViews, applyRouteEffect, FeatureLayer, Graphic, Polyline, Point, geometryEngine, SimpleLineSymbol, SimpleMarkerSymbol, SimpleFillSymbol, route: null };
      setReady(true);
    });
    return () => {
      cancelled = true;
      unsubscribe?.();
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
    if (analysis.zoom) view.goTo({ target: circle, padding: 40 }, { duration: 500 }).catch(() => {});
  }, [analysis, ready]);

  useEffect(() => {
    const bag = api.current;
    if (!bag?.view?.container) return;
    bag.view.container.style.cursor = pickingOrigin ? "crosshair" : "";
  }, [pickingOrigin, ready]);

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
    if (activeEvent?.point) {
      bag.cursorLayer.add(new bag.Graphic({
        geometry: new bag.Point({ longitude: activeEvent.point[0], latitude: activeEvent.point[1] }),
        symbol: new bag.SimpleMarkerSymbol({
          style: "circle",
          color: [250, 204, 21, 0.95],
          size: 12,
          outline: { color: [255, 255, 255], width: 2 },
        }),
      }));
    }
  }, [route, cursor, activeEvent, ready]);

  useEffect(() => {
    const bag = api.current;
    if (!bag?.view || !activeEvent?.point) return;
    const point = new bag.Point({ longitude: activeEvent.point[0], latitude: activeEvent.point[1] });
    bag.view.goTo({ target: point, zoom: 17 }, { duration: 650, easing: "ease-in-out" }).catch(() => {});
  }, [activeEvent, ready]);

  useEffect(() => {
    const bag = api.current;
    if (!bag?.lrsLayers || !ready) return;
    bag.applyRouteEffect?.(route);
    if (!route) bag.view.goTo(RWANDA_EXTENT, { duration: 450 }).catch(() => {});
  }, [route, ready]);

  useEffect(() => {
    const bag = api.current;
    if (!bag?.lrsLayers) return;
    bag.lrsLayers.forEach((layer) => {
      layer.visible = !(hiddenLayerIds || []).includes(LRS_LAYER_DEFS[bag.lrsLayers.indexOf(layer)].id);
    });
  }, [hiddenLayerIds, ready]);

  return ref;
}
