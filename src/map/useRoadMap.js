import { useEffect, useRef, useState } from "react";
import { LRS_LAYER_DEFS, RWANDA_EXTENT } from "../config";
import { pointAtMeasure, sliceVertices } from "../lrs/geometry";
import { loadLayerCache } from "../lrs/lrsService";

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

export function useRoadMap({ route, cursor, project, activeEvent, hiddenLayerIds, onHoverMeasure, onLeave }) {
  const ref = useRef(null);
  const api = useRef(null);
  const hoverRef = useRef(onHoverMeasure);
  const leaveRef = useRef(onLeave);
  const [ready, setReady] = useState(false);
  hoverRef.current = onHoverMeasure;
  leaveRef.current = onLeave;

  useEffect(() => {
    let view;
    let cancelled = false;
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
      let cache = { layers: [] };
      try {
        cache = await loadLayerCache();
      } catch (error) {
        console.error(error);
      }
      if (cancelled) return;
      const lrsLayers = cache.layers.map((layer) => {
        const graphicsLayer = new GraphicsLayer({ title: layer.def.title, listMode: "hide" });
        const symbol = layer.def.kind === "point"
          ? new SimpleMarkerSymbol({ style: "circle", color: layer.def.color, size: 6, outline: { color: [15, 23, 42, 0.9], width: 0.6 } })
          : new SimpleLineSymbol({ color: layer.def.color, width: layer.def.width || 2.5, cap: "round", join: "round" });
        layer.features.forEach((feature) => {
          if (!feature.geometry) return;
          const spatialReference = Math.abs(feature.geometry.x ?? feature.geometry.paths?.[0]?.[0]?.[0] ?? 0) > 180
            ? { wkid: 102100 }
            : (feature.geometry.spatialReference || { wkid: 4326 });
          const geometry = feature.geometry.x !== undefined
            ? new Point({ x: feature.geometry.x, y: feature.geometry.y, spatialReference })
            : new Polyline(feature.geometry.curvePaths
              ? { curvePaths: feature.geometry.curvePaths, spatialReference }
              : { paths: feature.geometry.paths, spatialReference });
          if (!geometry) return;
          graphicsLayer.add(new Graphic({ attributes: feature.attributes, geometry, symbol }));
        });
        return graphicsLayer;
      });
      if (lrsLayers.length) map.addMany(lrsLayers, 0);
      const network = lrsLayers[LRS_LAYER_DEFS.findIndex((def) => def.route)];
      if (network?.graphics.length) view.goTo(network.graphics, { animate: false }).catch(() => {});
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
      const layerViews = new Map();
      const applyRouteEffect = (activeRoute) => {
        const field = activeRoute?.routeField;
        cache.layers.forEach((source, index) => {
          const graphicsLayer = lrsLayers[index];
          if (!graphicsLayer) return;
          const routeField = source.routeField || field;
          graphicsLayer.graphics.forEach((graphic) => {
            if (!activeRoute || !routeField) {
              graphic.visible = true;
              return;
            }
            graphic.visible = String(graphic.attributes?.[routeField] ?? "") === String(activeRoute.id);
          });
        });
      };
      api.current = { view, map, overlay, cursorLayer, lrsLayers, layerViews, applyRouteEffect, FeatureLayer, Graphic, Polyline, Point, geometryEngine, SimpleLineSymbol, SimpleMarkerSymbol, SimpleFillSymbol, route: null };
      setReady(true);
    });
    return () => {
      cancelled = true;
      view?.destroy();
    };
  }, []);

  useEffect(() => {
    const bag = api.current;
    if (!bag || !route) return;
    bag.route = route;
    const { view, overlay, Graphic, Polyline, geometryEngine, SimpleFillSymbol, SimpleLineSymbol } = bag;
    overlay.removeAll();
    const curved = (route.geometries || []).map((geom) => new Polyline(geom.curvePaths
      ? { curvePaths: geom.curvePaths, spatialReference: geom.spatialReference || { wkid: 4326 } }
      : { paths: geom.paths, spatialReference: geom.spatialReference || { wkid: 4326 } }));
    const line = curved[0] || new Polyline({ paths: [route.vertices], spatialReference: { wkid: 4326 } });
    curved.forEach((geometry) => overlay.add(new Graphic({
      geometry,
      symbol: new SimpleLineSymbol({ color: [56, 189, 248, 0.95], width: 5, cap: "round", join: "round" }),
    })));

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

    view.goTo({ target: line, padding: 64 }, { duration: 450, easing: "ease-in-out" }).catch(() => {});
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
        color: [255, 255, 255, 0.95],
        size: 12,
        outline: { color: [234, 88, 12], width: 3 },
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
