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

export function useRoadMap({ route, cursor, project, activeEvent, hiddenLayerIds, onHoverMeasure, onLeave, onFocusChange, onPickRoute }) {
  const pickRef = useRef(onPickRoute);
  pickRef.current = onPickRoute;
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
      const [Map, MapView, FeatureLayer, GraphicsLayer, Graphic, Polyline, Point, geometryEngine, SimpleLineSymbol, SimpleMarkerSymbol, SimpleFillSymbol, FeatureEffect, FeatureFilter] = mods;
      const overlay = new GraphicsLayer({ id: "lrs-overlay", listMode: "hide" });
      const cursorLayer = new GraphicsLayer({ id: "lrs-cursor", listMode: "hide" });
      const map = new Map({ basemap: "satellite", layers: [overlay, cursorLayer] });
      view = new MapView({
        container: ref.current,
        map,
        extent: RWANDA_EXTENT,
        highlightOptions: { color: [232, 122, 46], haloOpacity: 0 },
      });
      view.ui.remove("attribution");
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
          ? new SimpleMarkerSymbol({ style: "circle", color: layer.def.color, size: 8, outline: { color: [255, 255, 255, 0.95], width: 1 } })
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
      api.current = { view, map, overlay, cursorLayer, lrsLayers, layerViews, applyRouteEffect, FeatureLayer, Graphic, Polyline, Point, geometryEngine, SimpleLineSymbol, SimpleMarkerSymbol, SimpleFillSymbol, route: null };
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

    if (project) {
      const slice = sliceVertices(route.vertices, route.measures, project.startKm, project.endKm);
      if (slice.length > 1) {
        const segment = new Polyline({ paths: [slice], spatialReference: { wkid: 4326 } });
        const buffer = geometryEngine.geodesicBuffer(segment, project.bufferM || 80, "meters");
        overlay.add(new Graphic({
          geometry: buffer,
          symbol: new SimpleFillSymbol({
            color: [244, 114, 182, 0.28],
            outline: { color: [190, 24, 93, 0.9], width: 1.5 },
          }),
        }));
        overlay.add(new Graphic({
          geometry: segment,
          symbol: new SimpleLineSymbol({ color: [190, 24, 93], width: 6 }),
        }));
      }
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
        size: 16,
        outline: { color: [120, 53, 15], width: 4 },
      }),
    }));
    if (activeEvent?.point) {
      bag.cursorLayer.add(new bag.Graphic({
        geometry: new bag.Point({ longitude: activeEvent.point[0], latitude: activeEvent.point[1] }),
        symbol: new bag.SimpleMarkerSymbol({
          style: "circle",
          color: [250, 204, 21, 0.95],
          size: 18,
          outline: { color: [255, 255, 255], width: 3 },
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
