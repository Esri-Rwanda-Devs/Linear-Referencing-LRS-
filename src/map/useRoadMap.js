import { useEffect, useRef, useState } from "react";
import { LRS_LAYER_DEFS, RWANDA_EXTENT } from "../config";
import { flattenPaths, pointAtMeasure, sliceVertices, toLonLat } from "../lrs/geometry";
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

export function useRoadMap({ route, cursor, project, activeEvent, hiddenLayerIds, segment, compareRoute, compareCursor, compareEvent, uiPanel, analysis, pickingOrigin, onOrigin, onHoverMeasure, onLeave, onFocusChange, onPickRoute }) {
  const pickRef = useRef(onPickRoute);
  pickRef.current = onPickRoute;
  const originRef = useRef(onOrigin);
  originRef.current = onOrigin;
  const pickingRef = useRef(pickingOrigin);
  pickingRef.current = pickingOrigin;
  const hiddenRef = useRef(hiddenLayerIds);
  hiddenRef.current = hiddenLayerIds;
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
      const segmentLayer = new GraphicsLayer({ id: "lrs-segment", listMode: "hide" });
      const compareLayer = new GraphicsLayer({ id: "lrs-compare", listMode: "hide" });
      const compareCursorLayer = new GraphicsLayer({ id: "lrs-compare-cursor", listMode: "hide" });
      const map = new Map({ basemap: "satellite", layers: [analysisLayer, compareLayer, overlay, segmentLayer, projectLayer, compareCursorLayer, cursorLayer] });
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
      if (uiPanel) {
        uiPanel.className = "analysis-host";
        view.ui.add(uiPanel, { position: "top-right", index: 2 });
        view.watch("height", (height) => { uiPanel.style.maxHeight = `${Math.max(140, height - 120)}px`; });
        uiPanel.style.maxHeight = `${Math.max(140, (view.height || 500) - 120)}px`;
      }
      const lrsLayers = LRS_LAYER_DEFS.map(() => null);
      const sources = [];
      const OVERLAY_COUNT = map.layers.length;
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

      const drawLayer = async (layer) => {
        const index = LRS_LAYER_DEFS.findIndex((def) => def.id === layer.id);
        if (cancelled || index < 0 || lrsLayers[index]) return;
        lrsLayers[index] = "pending";
        sources.push(layer);
        const started = performance.now();
        const routeField = layer.routeField;
        const graphics = [];
        const CHUNK = 1500;
        for (let i = 0; i < layer.features.length; i += 1) {
          const feature = layer.features[i];
          const g = feature.geometry;
          if (g) {
            let geometry = null;
            if (g.x !== undefined) {
              const at = toLonLat(g.x, g.y);
              if (at) geometry = new Point({ longitude: at[0], latitude: at[1] });
            } else {
              const paths = flattenPaths(g);
              if (paths.length) geometry = new Polyline({ paths, spatialReference: { wkid: 4326 } });
            }
            if (geometry) {
              graphics.push(new Graphic({
                geometry,
                attributes: { oid: i + 1, route: routeField ? String(feature.attributes?.[routeField] ?? "").trim() : "" },
              }));
            }
          }
          if (i % CHUNK === CHUNK - 1) {
            await pause();
            if (cancelled) return;
          }
        }
        const featureLayer = new FeatureLayer({
          id: `lrs-${layer.id}`,
          title: layer.def.title,
          source: graphics,
          objectIdField: "oid",
          fields: [{ name: "oid", type: "oid" }, { name: "route", type: "string" }],
          geometryType: layer.def.kind === "point" ? "point" : "polyline",
          spatialReference: { wkid: 4326 },
          renderer: { type: "simple", symbol: symbolFor(layer.def) },
          outFields: ["route"],
          popupEnabled: false,
          listMode: "hide",
          visible: !(hiddenRef.current || []).includes(layer.id),
          featureEffect: effectFor(),
        });
        lrsLayers[index] = featureLayer;
        map.add(featureLayer, layer.def.kind === "point" ? Math.max(0, map.layers.length - OVERLAY_COUNT) : 0);
        console.info(`[LRS] Map layer ${layer.def.title}: ${graphics.length} features ready in ${Math.round(performance.now() - started)} ms`);
      };
      unsubscribe = subscribeLayers((layer) => { drawLayer(layer); });
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
      view.on("click", (event) => {
        if (pickingRef.current) {
          originRef.current?.([event.mapPoint.longitude, event.mapPoint.latitude], "Picked on map");
          return;
        }
        const roadLayer = lrsLayers[roadIndex];
        if (!roadLayer || roadLayer === "pending" || !roadLayer.visible) return;
        view.hitTest(event, { include: [roadLayer] }).then((response) => {
          const hit = response.results.find((result) => result.graphic?.layer === roadLayer);
          const id = String(hit?.graphic?.attributes?.route ?? "").trim();
          if (!id) return;
          console.info(`[LRS] Picked route ${id} from the map.`);
          pickRef.current?.(id);
        }).catch(() => {});
      });
      const layerViews = new window.Map();
      const applyRouteEffect = (activeRoute, otherRoute) => {
        const ids = [activeRoute?.id, otherRoute?.id].filter(Boolean).map((id) => `'${String(id).trim().replace(/'/g, "''")}'`);
        routeWhere.value = ids.length ? `route IN (${ids.join(",")})` : null;
        lrsLayers.forEach((layer) => {
          if (layer && layer !== "pending") layer.featureEffect = effectFor();
        });
      };
      api.current = { view, map, overlay, projectLayer, analysisLayer, segmentLayer, compareLayer, compareCursorLayer, cursorLayer, lrsLayers, layerViews, applyRouteEffect, FeatureLayer, Graphic, Polyline, Point, geometryEngine, SimpleLineSymbol, SimpleMarkerSymbol, SimpleFillSymbol, route: null };
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
    segmentLayer.add(new Graphic({ geometry: line, symbol: new SimpleLineSymbol({ color: [15, 23, 42, 0.85], width: 9, cap: "round", join: "round" }) }));
    segmentLayer.add(new Graphic({ geometry: line, symbol: new SimpleLineSymbol({ color: [250, 204, 21, 1], width: 5, cap: "round", join: "round" }) }));
    [slice[0], slice[slice.length - 1]].forEach((vertex) => {
      segmentLayer.add(new Graphic({
        geometry: new Point({ longitude: vertex[0], latitude: vertex[1] }),
        symbol: new SimpleMarkerSymbol({ style: "square", size: 8, color: [250, 204, 21, 1], outline: { color: [15, 23, 42], width: 1.5 } }),
      }));
    });
    view.goTo({ target: line, padding: 60 }, { duration: 500 }).catch(() => {});
  }, [route, segment, ready]);

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
    if (!route) bag.view.goTo(RWANDA_EXTENT, { duration: 450 }).catch(() => {});
  }, [route, ready]);

  useEffect(() => {
    const bag = api.current;
    if (!bag?.lrsLayers || !ready) return;
    const other = compareRoute && compareRoute.id !== route?.id ? compareRoute : null;
    bag.route = route || null;
    bag.compareRoute = other;
    bag.applyRouteEffect?.(route, other);
  }, [route, compareRoute, ready]);

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
    if (compareEvent?.point) {
      bag.compareCursorLayer.add(new bag.Graphic({
        geometry: new bag.Point({ longitude: compareEvent.point[0], latitude: compareEvent.point[1] }),
        symbol: new bag.SimpleMarkerSymbol({ style: "circle", color: [217, 70, 239, 0.95], size: 12, outline: { color: [255, 255, 255], width: 2 } }),
      }));
    }
  }, [route, compareRoute, compareCursor, compareEvent, ready]);

  useEffect(() => {
    const bag = api.current;
    if (!bag?.view || !compareEvent?.point) return;
    bag.view.goTo({ target: new bag.Point({ longitude: compareEvent.point[0], latitude: compareEvent.point[1] }), zoom: 17 }, { duration: 650 }).catch(() => {});
  }, [compareEvent, ready]);

  useEffect(() => {
    const bag = api.current;
    if (!bag?.lrsLayers) return;
    bag.lrsLayers.forEach((layer, index) => {
      if (layer && layer !== "pending") layer.visible = !(hiddenLayerIds || []).includes(LRS_LAYER_DEFS[index].id);
    });
  }, [hiddenLayerIds, ready]);

  return ref;
}
