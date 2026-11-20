import { useEffect, useRef, useState } from "react";
import {
  ADMIN,
  LRS,
  LRS_LAYER_DEFS,
  PAVEMENT_LAYER_ID,
  SNAP_METERS,
  VALUE_COLORS,
} from "../../../config";
import { markerSymbol } from "../../mapping/icons";
import {
  loadBoundaryExtent,
  loadBoundaryGeometry,
  loadModules,
  loadOverviewFields,
  loadPavementRoad,
  overviewWhere,
  signInToLrs,
} from "../../mapping/services/lrsService";

const RWANDA = { center: [29.87, -1.94], scale: 3700000 };
const FIT_PADDING = { top: 40, right: 40, bottom: 40, left: 40 };

function pointCluster(def) {
  const color = def.color || def.swatch || "#38bdf8";
  return {
    type: "cluster",
    // Wider radius = fewer overlapping bubbles when zoomed out.
    clusterRadius: "72px",
    clusterMinSize: "22px",
    clusterMaxSize: "44px",
    // Past this scale (zoomed in), draw real assets instead of clusters.
    clusterMaxScale: 18000,
    symbol: {
      type: "simple-marker",
      style: "circle",
      color,
      outline: { color: [255, 255, 255, 0.92], width: 1.25 },
    },
    labelingInfo: [
      {
        deconflictionStrategy: "static",
        labelExpressionInfo: {
          expression: "Text($feature.cluster_count, '#,###')",
        },
        symbol: {
          type: "text",
          color: "#ffffff",
          haloColor: [15, 23, 42, 0.85],
          haloSize: 1,
          font: { size: 10, weight: "bold", family: "sans-serif" },
        },
        labelPlacement: "center-center",
      },
    ],
  };
}

function escapeHtml(value) {
  return String(value).replace(
    /[&<>"]/g,
    (ch) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" })[ch],
  );
}

function popupFor(def) {
  return {
    title: def.title,
    content: (feature) => {
      const attributes =
        feature.graphic?.attributes || feature.attributes || {};
      const rows = Object.entries(attributes)
        .filter(
          ([key, value]) =>
            value != null &&
            String(value).trim() !== "" &&
            !/objectid|globalid|^shape|shape_|st_area|st_length/i.test(key),
        )
        .slice(0, 10);
      if (!rows.length) return escapeHtml(def.title);
      return `<table class="ov-popup">${rows.map(([key, value]) => `<tr><th>${escapeHtml(key)}</th><td>${escapeHtml(value)}</td></tr>`).join("")}</table>`;
    },
  };
}

function lineRenderer(def, valueField) {
  // Thin enough that satellite / streets basemap stays visible under events.
  const width = def.route
    ? 1.8
    : Math.min(Math.max(Number(def.width) || 2, 1.6), 3);
  const simple = {
    type: "simple-line",
    color: def.color,
    width,
    cap: "round",
    join: "round",
  };
  const rule = VALUE_COLORS[def.id];
  if (!rule || !valueField?.name || def.kind !== "line" || def.route)
    return { type: "simple", symbol: simple };
  const safe = String(valueField.name).replace(/"/g, "");
  return {
    type: "unique-value",
    valueExpression: `Lower(Text($feature["${safe}"]))`,
    defaultSymbol: simple,
    uniqueValueInfos: Object.entries(rule.colors).map(([value, color]) => ({
      value: String(value).toLowerCase(),
      symbol: {
        type: "simple-line",
        color,
        width: Math.max(width, 2.4),
        cap: "round",
        join: "round",
      },
    })),
  };
}

function pointRenderer(def) {
  // Slightly smaller markers so unclustered points stay readable without stacking.
  const icon = markerSymbol(def, 14);
  if (icon) return { type: "simple", symbol: icon };
  return {
    type: "simple",
    symbol: {
      type: "simple-marker",
      style: "circle",
      color: def.color,
      size: 7,
      outline: { color: [255, 255, 255, 0.9], width: 0.7 },
    },
  };
}

function layerChoice(
  def,
  row,
  scope,
  query,
  muted,
  spec,
  boundary,
  fieldsReady,
  lineFocus = "all",
  typeValue = "",
  roadKey = "",
  typeRoadKeys = [],
  roadIds = [],
) {
  const typeOn = Boolean(String(typeValue || "").trim());
  const roadOn = Boolean(String(roadKey || "").trim());
  const typeRoadsOn =
    !roadOn && Array.isArray(typeRoadKeys) && typeRoadKeys.length > 0;
  const isLineish = def.kind === "line";
  const isRoute = Boolean(def.route);
  // When Line event is "all" but a type is set, treat Pavement as the focus layer
  // (paved/unpaved) or keep the explicit focus id.
  const focusId = (() => {
    if (lineFocus !== "all" && Number.isFinite(Number(lineFocus))) {
      return Number(lineFocus);
    }
    if (typeOn && (typeValue === "paved" || typeValue === "unpaved")) {
      return PAVEMENT_LAYER_ID;
    }
    return null;
  })();
  const focusOn = focusId != null;
  const isFocusLayer = focusOn && def.id === focusId;
  const analysisActive = focusOn || roadOn || typeOn || typeRoadsOn;

  const scopeOff =
    (scope === "point" && def.kind !== "point") ||
    (scope === "line" && def.kind === "point");
  if (scopeOff)
    return {
      on: false,
      where: null,
      reason: "Hidden by the asset filter",
      locked: true,
    };

  // Analysis mode: show the focused line event; road-only keeps all line events for that route.
  if (
    analysisActive &&
    isLineish &&
    !isFocusLayer &&
    !isRoute &&
    !(roadOn && !focusOn && !typeOn)
  ) {
    return {
      on: false,
      where: null,
      reason: "Hidden by the line-event filter",
      locked: true,
    };
  }
  if (analysisActive && isRoute && !roadOn && !typeRoadsOn) {
    // Hide full network unless a road / type-road filter scopes it.
    return {
      on: false,
      where: null,
      reason: "Road network follows road or type filter",
      locked: true,
    };
  }

  const needle = query.trim().toLowerCase();
  const titleHit = !needle || def.title.toLowerCase().includes(needle);
  const typeHit =
    Boolean(needle) &&
    (row?.groups || []).some((group) =>
      String(group.name).toLowerCase().includes(needle),
    );
  const analysisHit =
    (focusOn && (isFocusLayer || isRoute)) || roadOn || typeRoadsOn;
  const searchHit = !needle || titleHit || typeHit || analysisHit;
  if (!searchHit || (needle && !titleHit && !spec?.value && !analysisHit)) {
    return {
      on: false,
      where: null,
      reason: "Hidden by the current search",
      locked: true,
    };
  }

  const isPoint = def.kind === "point";
  const roadColumns = (spec?.roadFields || []).length > 0;
  // A picked road keeps point assets on: by road column, else near the road line.
  const roadPoint = roadOn && isPoint;
  const forceOn =
    (roadPoint && !muted.includes(def.id)) ||
    (focusOn && isFocusLayer) ||
    (isRoute && (roadOn || typeRoadsOn)) ||
    (roadOn && !focusOn && !typeOn && isLineish);
  if (muted.includes(def.id) && !forceOn)
    return { on: false, where: null, reason: "Turned off", locked: false };

  const applyType = typeOn && isFocusLayer && !isRoute;
  const applyRoad =
    roadOn &&
    (isFocusLayer ||
      isRoute ||
      (!focusOn && !typeOn && isLineish) ||
      (roadPoint && fieldsReady && roadColumns));
  // Type-filtered route codes apply on the road network (and keep event layer on type only).
  const applyRoadList = typeRoadsOn && isRoute;
  const extras = {
    typeValue: applyType ? typeValue : "",
    layerId: applyType ? def.id : null,
    roadKey: applyRoad ? roadKey : "",
    roadKeys: applyRoadList ? typeRoadKeys : [],
    roadIds: applyRoad ? roadIds : [],
  };
  const filter = overviewWhere(
    fieldsReady
      ? spec
      : {
          boundary: {},
          value: spec?.value || null,
          roadFields: spec?.roadFields || [],
          route: Boolean(def.route),
        },
    boundary,
    needle && !titleHit ? needle : "",
    extras,
  );
  return {
    on: forceOn || (!analysisActive && !muted.includes(def.id)),
    where: filter.where,
    reason: "",
    locked: forceOn,
    near: roadPoint && fieldsReady && !roadColumns,
  };
}

async function clearAssetFilters(view, layers) {
  await Promise.all(
    [...layers.values()].map(async (layer) => {
      try {
        const layerView = await view.whenLayerView(layer);
        layerView.filter = null;
      } catch {
        /* layer may still be loading */
      }
    }),
  );
}

export default function OverviewMap({
  scope,
  query,
  rows,
  boundary,
  muted,
  lineFocus = "all",
  typeValue = "",
  roadKey = "",
  roadZoomNonce = 0,
  typeRoadKeys = [],
  roadIds = [],
  analysisLabel = "",
  pavedPct = null,
  headline = "",
  onToggle,
}) {
  const host = useRef(null);
  const viewRef = useRef(null);
  const layersRef = useRef(new Map());
  const districtLayerRef = useRef(null);
  const highlightRef = useRef(null);
  const fieldsRef = useRef({});
  const focusRef = useRef(() => {});
  const homeTargetRef = useRef(RWANDA);
  const locatingRef = useRef(
    Boolean(typeof navigator !== "undefined" && navigator.geolocation),
  );
  const choicesRef = useRef([]);
  const FeatureFilterRef = useRef(null);
  const boundaryPolyRef = useRef(null);
  const [roadLine, setRoadLine] = useState(null);
  const PolygonRef = useRef(null);
  const PolylineRef = useRef(null);
  const GraphicRef = useRef(null);
  const [ready, setReady] = useState(false);
  const [fieldsReady, setFieldsReady] = useState(false);
  const [note, setNote] = useState("Loading the asset map…");

  useEffect(() => {
    const node = host.current;
    if (!node) return undefined;
    let dead = false;
    let view = null;
    (async () => {
      try {
        const [
          { token },
          fields,
          [
            Map,
            MapView,
            FeatureLayer,
            GraphicsLayer,
            Graphic,
            Polygon,
            Polyline,
            FeatureFilter,
            BasemapToggle,
          ],
        ] = await Promise.all([
          signInToLrs(),
          loadOverviewFields(),
          loadModules([
            "esri/Map",
            "esri/views/MapView",
            "esri/layers/FeatureLayer",
            "esri/layers/GraphicsLayer",
            "esri/Graphic",
            "esri/geometry/Polygon",
            "esri/geometry/Polyline",
            "esri/layers/support/FeatureFilter",
            "esri/widgets/BasemapToggle",
          ]),
        ]);
        if (dead || !host.current) return;
        fieldsRef.current = fields || {};
        FeatureFilterRef.current = FeatureFilter;
        PolygonRef.current = Polygon;
        PolylineRef.current = Polyline;
        GraphicRef.current = Graphic;
        setFieldsReady(true);
        const rank = (def) => (def.route ? 0 : def.kind === "line" ? 1 : 2);
        const assetLayers = [...LRS_LAYER_DEFS]
          .sort((a, b) => rank(a) - rank(b))
          .map((def) => {
            const spec = fields?.[def.id];
            const layer = new FeatureLayer({
              url: `${def.service || LRS}/${def.id}`,
              id: `overview-${def.id}`,
              title: def.title,
              customParameters: token ? { token } : undefined,
              opacity: def.kind === "line" ? 0.88 : 0.95,
              renderer:
                def.kind === "point"
                  ? pointRenderer(def)
                  : lineRenderer(def, spec?.value),
              featureReduction:
                def.kind === "point" ? pointCluster(def) : undefined,
              popupTemplate: popupFor(def),
              outFields: ["*"],
              listMode: "hide",
            });
            layersRef.current.set(def.id, layer);
            return layer;
          });
        const districtLayer = new FeatureLayer({
          url: `${ADMIN}/1`,
          id: "overview-districts",
          title: "District boundaries",
          customParameters: token ? { token } : undefined,
          opacity: 0.55,
          outFields: ["district", "province"],
          labelingInfo: [
            {
              labelExpressionInfo: { expression: "$feature.district" },
              symbol: {
                type: "text",
                color: [255, 255, 255, 0.95],
                haloColor: [15, 23, 42, 0.85],
                haloSize: 1.2,
                font: { size: 9, weight: "bold" },
              },
              minScale: 2500000,
            },
          ],
          renderer: {
            type: "simple",
            symbol: {
              type: "simple-fill",
              color: [250, 204, 21, 0.02],
              outline: { color: [250, 204, 21, 0.75], width: 1 },
            },
          },
          listMode: "hide",
        });
        districtLayerRef.current = districtLayer;
        const highlight = new GraphicsLayer({
          id: "overview-boundary-highlight",
          listMode: "hide",
        });
        highlightRef.current = highlight;
        const map = new Map({
          basemap: "satellite",
          layers: [districtLayer, ...assetLayers, highlight],
        });
        view = new MapView({
          container: host.current,
          map,
          center: RWANDA.center,
          scale: RWANDA.scale,
          highlightOptions: { color: [232, 122, 46], haloOpacity: 0 },
        });
        viewRef.current = view;
        const home = document.createElement("button");
        home.type = "button";
        home.className = "map-home esri-widget esri-widget--button";
        home.title = "Fit the current filter";
        home.setAttribute("aria-label", "Fit the current filter");
        home.innerHTML = `<svg width="16" height="16" viewBox="0 0 16 16" aria-hidden="true"><path fill="currentColor" d="M8 1.4 1.2 7.2h1.6V14h3.6V9.2h3.2V14h3.6V7.2h1.6L8 1.4Z"/></svg>`;
        home.addEventListener("click", () => focusRef.current());
        view.ui.add(home, "top-right");
        const basemapToggle = new BasemapToggle({
          view,
          nextBasemap: "gray-vector",
        });
        view.ui.add(basemapToggle, "bottom-left");
        await view.when();
        if (dead) {
          view.destroy();
          return;
        }
        if (typeof view.resize === "function") view.resize();
        const zoomToHere = (longitude, latitude) => {
          if (dead || !viewRef.current) return;
          const target = {
            center: [longitude, latitude],
            scale: 48000,
          };
          homeTargetRef.current = target;
          locatingRef.current = false;
          focusRef.current = () =>
            viewRef.current
              ?.goTo(homeTargetRef.current, { duration: 500 })
              .catch(() => {});
          viewRef.current.goTo(target, { duration: 700 }).catch(() => {});
          setNote("Zoomed to your current location");
        };
        if (navigator.geolocation) {
          setNote("Finding your location…");
          navigator.geolocation.getCurrentPosition(
            (position) => {
              zoomToHere(position.coords.longitude, position.coords.latitude);
            },
            () => {
              locatingRef.current = false;
              if (!dead) setNote("");
            },
            { enableHighAccuracy: true, timeout: 8000, maximumAge: 60000 },
          );
        } else {
          locatingRef.current = false;
          setNote("");
        }
        setReady(true);
      } catch (error) {
        if (!dead)
          setNote(error?.message || "The asset map could not be loaded.");
      }
    })();
    return () => {
      dead = true;
      viewRef.current = null;
      layersRef.current = new Map();
      districtLayerRef.current = null;
      highlightRef.current = null;
      view?.destroy();
    };
  }, []);

  const boundaryId = boundary?.id || "";
  const boundaryName = boundary?.name || "";

  useEffect(() => {
    const view = viewRef.current;
    const highlight = highlightRef.current;
    const districtLayer = districtLayerRef.current;
    if (!view || !ready) return undefined;
    let dead = false;
    const fitHome = () =>
      view.goTo(homeTargetRef.current, { duration: 650 }).catch(() => {});
    const clearSelection = async () => {
      highlight?.removeAll();
      if (districtLayer) districtLayer.definitionExpression = null;
      boundaryPolyRef.current = null;
      await clearAssetFilters(view, layersRef.current);
      focusRef.current = fitHome;
      // Don't yank away while the first geolocation fix is still pending.
      if (!locatingRef.current) fitHome();
      setNote("");
    };
    if (!boundaryId || !boundaryName || !boundary) {
      clearSelection();
      return undefined;
    }
    if (districtLayer) {
      if (boundaryId === "province") {
        districtLayer.definitionExpression = `province = '${String(boundaryName).replace(/'/g, "''")}'`;
      } else if (boundaryId === "district") {
        districtLayer.definitionExpression = `district = '${String(boundaryName).replace(/'/g, "''")}'`;
      } else {
        districtLayer.definitionExpression = null;
      }
    }
    setNote(`Zooming to ${boundary.label || boundaryId}: ${boundaryName}…`);
    Promise.all([
      loadBoundaryGeometry(boundary, boundaryName),
      loadBoundaryExtent(boundary, boundaryName),
    ])
      .then(async ([geometry, extent]) => {
        if (dead || !viewRef.current) return;
        highlight?.removeAll();
        const Polygon = PolygonRef.current;
        const Graphic = GraphicRef.current;
        const FeatureFilter = FeatureFilterRef.current;
        let polygon = null;
        if (geometry?.rings?.length && Polygon) {
          polygon = new Polygon({
            rings: geometry.rings,
            spatialReference: geometry.spatialReference || { wkid: 4326 },
          });
          highlight?.add(
            new Graphic({
              geometry: polygon,
              symbol: {
                type: "simple-fill",
                color: [56, 189, 248, 0.12],
                outline: { color: [14, 165, 233, 1], width: 2.4 },
              },
            }),
          );
        }
        const areaTarget =
          polygon ||
          (extent
            ? {
                ...extent,
                spatialReference: extent.spatialReference || { wkid: 4326 },
              }
            : null);
        const zoomTo = (target) => {
          if (!target || !viewRef.current) return Promise.resolve();
          return viewRef.current
            .goTo({ target, padding: FIT_PADDING }, { duration: 380 })
            .catch(() => {});
        };
        // Zoom to the admin area first so the place appears immediately.
        if (areaTarget) {
          focusRef.current = () => zoomTo(areaTarget);
          await zoomTo(areaTarget);
        }
        boundaryPolyRef.current = polygon;
        if (FeatureFilter) {
          await Promise.all(
            [...layersRef.current.values()].map(async (layer) => {
              try {
                const layerView = await view.whenLayerView(layer);
                layerView.filter = polygon
                  ? new FeatureFilter({
                      geometry: polygon,
                      spatialRelationship: "intersects",
                    })
                  : null;
              } catch {
                /* ignore */
              }
            }),
          );
        }
        // Then tighten on features that are actually inside the filter.
        const visibleLayers = [...layersRef.current.entries()]
          .filter(([id]) =>
            (choicesRef.current || []).some(
              (choice) => choice.def.id === id && choice.on,
            ),
          )
          .map(([, layer]) => layer)
          .slice(0, 8);
        const extents = (
          await Promise.all(
            visibleLayers.map(async (layer) => {
              try {
                const result = await layer.queryExtent({
                  where: layer.definitionExpression || "1=1",
                  geometry: polygon || undefined,
                  spatialRelationship: polygon ? "intersects" : undefined,
                });
                return result?.count > 0 ? result.extent : null;
              } catch {
                return null;
              }
            }),
          )
        ).filter(Boolean);
        if (!dead && extents.length) {
          const fitAssets = () => zoomTo(extents);
          focusRef.current = fitAssets;
          await fitAssets();
        } else if (areaTarget) {
          focusRef.current = () => zoomTo(areaTarget);
        }
        if (!dead) {
          setNote(
            `Assets inside ${boundary.label || boundaryId}: ${boundaryName}`,
          );
        }
      })
      .catch(() => {
        if (!dead) setNote("Could not load that boundary on the map.");
      });
    return () => {
      dead = true;
    };
  }, [boundary, boundaryId, boundaryName, ready]);

  const choices = LRS_LAYER_DEFS.map((def) => {
    const row = rows.find((item) => item.id === def.id);
    const spec = fieldsRef.current[def.id] || {
      boundary: {},
      value: null,
      route: Boolean(def.route),
    };
    return {
      def,
      ...layerChoice(
        def,
        row,
        scope,
        query,
        muted,
        spec,
        boundary,
        fieldsReady,
        lineFocus,
        typeValue,
        roadKey,
        typeRoadKeys,
        roadIds,
      ),
    };
  });

  useEffect(() => {
    if (!roadKey) setRoadLine(null);
    if (!ready || !roadKey || !PolylineRef.current) return undefined;
    let dead = false;
    setNote(`Zooming to road ${roadKey}…`);
    loadPavementRoad(roadKey)
      .then(async (features) => {
        if (dead || !viewRef.current) return;
        const paths = (features || [])
          .flatMap((feature) => feature.geometry?.paths || [])
          .filter((path) => path?.length > 1);
        if (!paths.length) {
          setNote(`No pavement geometry for ${roadKey}.`);
          return;
        }
        const line = new PolylineRef.current({
          paths,
          spatialReference: { wkid: 4326 },
        });
        setRoadLine(line);
        await viewRef.current
          .goTo({ target: line, padding: FIT_PADDING }, { duration: 550 })
          .catch(() => {});
        if (!dead) setNote(`Road ${roadKey} on the map`);
      })
      .catch(() => {
        if (!dead) setNote(`Could not load road ${roadKey}.`);
      });
    return () => {
      dead = true;
    };
  }, [ready, roadKey, roadZoomNonce]);

  const filterKey = choices
    .map((item) => `${item.def.id}:${item.on ? 1 : 0}:${item.where || ""}`)
    .join("|");
  choicesRef.current = choices;
  useEffect(() => {
    if (!ready) return;
    choicesRef.current.forEach(({ def, on, where }) => {
      const layer = layersRef.current.get(def.id);
      if (!layer) return;
      layer.visible = on;
      const next = where || null;
      if ((layer.definitionExpression || null) !== next)
        layer.definitionExpression = next;
    });
  }, [ready, filterKey]);

  // Point layers without a road column: show only those within snapping distance of the road.
  const nearKey = choices
    .filter((item) => item.near && item.on)
    .map((item) => item.def.id)
    .join(",");
  useEffect(() => {
    const view = viewRef.current;
    const FeatureFilter = FeatureFilterRef.current;
    if (!ready || !view || !FeatureFilter) return;
    const near = new Set(nearKey ? nearKey.split(",").map(Number) : []);
    LRS_LAYER_DEFS.filter((def) => def.kind === "point").forEach(
      async (def) => {
        const layer = layersRef.current.get(def.id);
        if (!layer) return;
        try {
          const layerView = await view.whenLayerView(layer);
          const polygon = boundaryPolyRef.current;
          if (near.has(def.id) && roadLine) {
            layerView.filter = new FeatureFilter({
              geometry: roadLine,
              spatialRelationship: "intersects",
              distance: SNAP_METERS,
              units: "meters",
            });
          } else {
            layerView.filter = polygon
              ? new FeatureFilter({
                  geometry: polygon,
                  spatialRelationship: "intersects",
                })
              : null;
          }
        } catch {
          /* layer may still be loading */
        }
      },
    );
  }, [ready, nearKey, roadLine]);

  const visibleCount = choices.filter((item) => item.on).length;
  const [layersOpen, setLayersOpen] = useState(true);

  useEffect(() => {
    if (!ready) return undefined;
    const view = viewRef.current;
    if (!view || typeof view.resize !== "function") return undefined;
    const frame = requestAnimationFrame(() => {
      try {
        view.resize();
      } catch {
        /* ignore layout races */
      }
    });
    return () => cancelAnimationFrame(frame);
  }, [ready, layersOpen]);

  return (
    <article
      className={`ov-asset ov-map-card${layersOpen ? " layers-open" : ""}`}
    >
      <div ref={host} className="ov-map" />

      <button
        type="button"
        className={`ov-layers-toggle${layersOpen ? " on" : ""}`}
        aria-expanded={layersOpen}
        aria-controls="ov-map-layers"
        onClick={() => setLayersOpen((value) => !value)}
      >
        Layers
      </button>
      {layersOpen && (
        <div
          id="ov-map-layers"
          className="ov-map-layers"
          role="group"
          aria-label="Asset layers"
        >
          <header>
            <strong>Layers</strong>
            <button type="button" onClick={() => setLayersOpen(false)}>
              Close
            </button>
          </header>
          <div className="ov-map-legend">
            {choices.map(({ def, on, reason, locked }) => (
              <label
                key={def.id}
                className={`ov-layer-row${on ? " on" : ""}${locked ? " locked" : ""}`}
                title={on ? `Hide ${def.title}` : reason || `Show ${def.title}`}
              >
                <input
                  type="checkbox"
                  checked={on}
                  disabled={locked}
                  onChange={() => onToggle(def.id)}
                />
                <i style={{ background: def.swatch }} />
                <span>{def.title}</span>
              </label>
            ))}
          </div>
        </div>
      )}
    </article>
  );
}
