import { useEffect, useRef, useState } from "react";
import {
  ADMIN,
  DRAINAGE_FIELDS,
  LRS,
  LRS_LAYER_DEFS,
  OVERVIEW_DEFAULT_POINTS,
  PAVEMENT_CATEGORY,
  PAVEMENT_FIELDS,
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
  loadFeature,
  loadPavementRoad,
  overviewWhere,
  signInToLrs,
} from "../../mapping/services/lrsService";

const RWANDA = { center: [29.87, -1.94], scale: 3700000 };
const FIT_PADDING = { top: 40, right: 40, bottom: 40, left: 40 };

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

function cssToRgb(value, alpha = 0.95) {
  if (Array.isArray(value)) return value;
  const hex = String(value || "")
    .trim()
    .replace(/^#/, "");
  if (/^[0-9a-fA-F]{6}$/.test(hex)) {
    return [
      parseInt(hex.slice(0, 2), 16),
      parseInt(hex.slice(2, 4), 16),
      parseInt(hex.slice(4, 6), 16),
      alpha,
    ];
  }
  return value;
}

/** Pure black/near-black vanishes on satellite — lift it so paved segments stay visible. */
function mapLineColor(value, alpha = 0.98) {
  const rgb = cssToRgb(value, alpha);
  if (
    Array.isArray(rgb) &&
    rgb.length >= 3 &&
    rgb[0] < 45 &&
    rgb[1] < 45 &&
    rgb[2] < 45
  ) {
    return [248, 250, 252, alpha];
  }
  return rgb;
}

function lineWidthFor(def, key, baseWidth, widths = null) {
  const name = String(key || "")
    .toLowerCase()
    .replace(/[_-]+/g, " ")
    .replace(/\s+/g, " ")
    .trim();
  if (widths?.[name] != null) return Number(widths[name]);
  // Carriageway sketch: 4 lanes thick, 2 lanes medium, intermediate thin.
  if (def?.id === 3) {
    if (/four/.test(name)) return 10;
    if (/two/.test(name)) return 5.5;
    if (/intermediate/.test(name)) return 2.4;
  }
  return baseWidth;
}

function lineRenderer(def, valueField, colorMap = null) {
  // Thin enough that satellite / streets basemap stays visible under events.
  const width = def.route
    ? 1.8
    : Math.min(Math.max(Number(def.width) || 2, 1.6), 3);
  const fallback = {
    type: "simple-line",
    color: cssToRgb("#64748b", 0.55),
    width,
    cap: "round",
    join: "round",
  };
  const rule = VALUE_COLORS[def.id];
  const colors = colorMap || rule?.colors;
  const widths = rule?.widths || null;
  if (!colors || !valueField?.name || def.kind !== "line" || def.route) {
    return {
      type: "simple",
      symbol: {
        type: "simple-line",
        color: cssToRgb(def.color),
        width,
        cap: "round",
        join: "round",
      },
    };
  }
  const safe = String(valueField.name).replace(/"/g, "");
  // Normalize like the chart: lower, trim, strip PCI "(25-50)", collapse spaces.
  const needsStatus =
    /pci|condition/i.test(valueField.name) ||
    Object.keys(colors).some((key) =>
      /poor|fair|good|excellent/i.test(key),
    );
  const needsCarriage = def.id === 3;
  const valueExpression = needsCarriage
    ? `var raw = $feature["${safe}"];
       if (IsEmpty(raw)) return "no data";
       var t = Lower(Trim(Text(raw)));
       if (t == "" || t == "null" || t == "nan") return "no data";
       t = Replace(Replace(Replace(t, "_", " "), "-", " "), "  ", " ");
       if (Find("four", t) >= 0 || Find("4 lane", t) >= 0) return "four lane divided";
       if (Find("intermediate", t) >= 0) return "intermediate lane";
       if (Find("two", t) >= 0 || Find("2 lane", t) >= 0) return "two lane";
       return Trim(t);`
    : needsStatus
      ? `var raw = $feature["${safe}"];
       if (IsEmpty(raw)) return "no data";
       var t = Lower(Trim(Text(raw)));
       if (t == "" || t == "null" || t == "nan") return "no data";
       t = Replace(Replace(Replace(t, "_", " "), "-", " "), "  ", " ");
       var p = Find("(", t);
       return p > 0 ? Trim(Left(t, p - 1)) : Trim(t);`
      : `var raw = $feature["${safe}"];
       if (IsEmpty(raw)) return "no data";
       var t = Lower(Trim(Text(raw)));
       if (t == "" || t == "null" || t == "nan") return "no data";
       return Trim(Replace(Replace(Replace(t, "_", " "), "-", " "), "  ", " "));`;
  const infos = Object.entries(colors).map(([value, color]) => {
    const key = String(value)
      .toLowerCase()
      .replace(/[_-]+/g, " ")
      .replace(/\s+/g, " ")
      .trim();
    // Keep fully paved / paved as true black when that is the configured colour.
    const keepBlack = key === "fully paved" || key === "paved";
    const lineWidth = lineWidthFor(
      def,
      key,
      Math.max(width, needsStatus ? 3.6 : 3.2),
      widths,
    );
    return {
      value: key,
      symbol: {
        type: "simple-line",
        color: keepBlack ? cssToRgb(color, 0.98) : mapLineColor(color),
        width: lineWidth,
        cap: "round",
        join: "round",
      },
    };
  });
  return {
    type: "unique-value",
    valueExpression,
    defaultSymbol: fallback,
    uniqueValueInfos: infos,
  };
}

function pointRenderer(def) {
  const icon = markerSymbol(def, 12);
  if (icon) return { type: "simple", symbol: icon };
  return {
    type: "simple",
    symbol: {
      type: "simple-marker",
      style: "circle",
      color: def.color,
      size: 6,
      outline: { color: [255, 255, 255, 0.95], width: 0.8 },
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
  pavementField = "paved_band",
) {
  const typeOn = Boolean(String(typeValue || "").trim());
  const roadOn = Boolean(String(roadKey || "").trim());
  const typeRoadsOn =
    !roadOn && Array.isArray(typeRoadKeys) && typeRoadKeys.length > 0;
  const isLineish = def.kind === "line";
  const isRoute = Boolean(def.route);
  // Road-level Fully/Partially bands — filter by road list, not attribute value.
  const bandAnalysis =
    (pavementField === "paved_band" && def.id === PAVEMENT_LAYER_ID) ||
    def.id === 3 ||
    def.id === 14 ||
    def.id === 6;
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

  // Keep all line events visible; only hide the road network unless scoped.
  if (analysisActive && isRoute && !roadOn && !typeRoadsOn) {
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
  // Picked road + pavement focus: show pavement segment colours (distribution),
  // not a solid network line covering them — network stays off unless user checks it.
  const forceOn =
    (roadPoint && !muted.includes(def.id)) ||
    (focusOn && isFocusLayer) ||
    (isRoute && typeRoadsOn && !roadOn) ||
    (isRoute && roadOn && !focusOn) ||
    (roadOn && !focusOn && !typeOn && isLineish);
  if (muted.includes(def.id) && !forceOn)
    return { on: false, where: null, reason: "Turned off", locked: false };

  // Fully/Partially bands are derived road attributes — filter by road list.
  // Surface / Type / PCI: filter pavement segments by the field value so
  // non-matching conditions are hidden; road list only for network (+ bands).
  const applyType = typeOn && isFocusLayer && !isRoute && !bandAnalysis;
  const applyRoad =
    roadOn &&
    (isFocusLayer ||
      isRoute ||
      (!focusOn && !typeOn && isLineish) ||
      (roadPoint && fieldsReady && roadColumns));
  const applyRoadList =
    typeRoadsOn && (isRoute || (bandAnalysis && isFocusLayer));
  const extras = {
    typeValue: applyType ? typeValue : "",
    layerId: applyType ? def.id : null,
    roadKey: applyRoad ? roadKey : "",
    roadKeys: applyRoadList ? typeRoadKeys : [],
    roadIds: applyRoad ? roadIds : [],
  };
  const baseSpec = fieldsReady
    ? spec
    : {
        boundary: {},
        value: spec?.value || null,
        roadFields: spec?.roadFields || [],
        route: Boolean(def.route),
      };
  // Match the active pavement dimension (type / surface / PCI), not only category.
  const pavementSpec =
    applyType &&
    def.id === PAVEMENT_LAYER_ID &&
    pavementField &&
    pavementField !== "paved_band" &&
    PAVEMENT_FIELDS[pavementField]?.field
      ? {
          ...baseSpec,
          value: {
            name: PAVEMENT_FIELDS[pavementField].field,
            type: baseSpec?.value?.type || "esriFieldTypeString",
          },
        }
      : baseSpec;
  const filter = overviewWhere(
    pavementSpec,
    boundary,
    needle && !titleHit ? needle : "",
    extras,
  );
  // Points follow Layers/muted; line events stay on unless muted.
  const on = forceOn || !muted.includes(def.id);
  return {
    on,
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
  segmentFocus = null,
  typeRoadKeys = [],
  roadIds = [],
  pavementField = "paved_band",
  drainageMode = "type",
  analysisLabel = "",
  pavedPct = null,
  headline = "",
  chartColors = null,
  onToggle,
}) {
  const host = useRef(null);
  const viewRef = useRef(null);
  const layersRef = useRef(new Map());
  const districtLayerRef = useRef(null);
  const highlightRef = useRef(null);
  const routeLabelsRef = useRef(null);
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
              visible:
                def.kind !== "point" ||
                OVERVIEW_DEFAULT_POINTS.includes(def.id),
              renderer:
                def.kind === "point"
                  ? pointRenderer(def)
                  : lineRenderer(def, spec?.value),
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
          labelsVisible: false,
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
        const routeLabels = new GraphicsLayer({
          id: "overview-route-labels",
          listMode: "hide",
        });
        routeLabelsRef.current = routeLabels;
        const map = new Map({
          basemap: "satellite",
          layers: [districtLayer, ...assetLayers, highlight, routeLabels],
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
      routeLabelsRef.current = null;
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
        pavementField,
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

  // Zoom to a clicked line-event segment along the selected road.
  useEffect(() => {
    const objectId = Number(segmentFocus?.objectId);
    const layerId = Number(segmentFocus?.layerId);
    if (!ready || !Number.isFinite(objectId) || !Number.isFinite(layerId))
      return undefined;
    const def = LRS_LAYER_DEFS.find((item) => item.id === layerId);
    const view = viewRef.current;
    const Graphic = GraphicRef.current;
    const highlight = highlightRef.current;
    if (!def || !view || !Graphic) return undefined;
    let dead = false;
    const label = segmentFocus?.label || def.title;
    setNote(`Zooming to ${label}…`);
    loadFeature(def, objectId)
      .then(async (feature) => {
        if (dead || !viewRef.current || !feature?.geometry) {
          if (!dead) setNote(`Could not load that ${def.title} segment.`);
          return;
        }
        const raw = feature.geometry;
        const geometry =
          raw.paths && PolylineRef.current
            ? new PolylineRef.current({
                paths: raw.paths,
                spatialReference: raw.spatialReference || { wkid: 4326 },
              })
            : raw;
        highlight?.removeAll();
        highlight?.add(
          new Graphic({
            geometry,
            symbol: {
              type: "simple-line",
              color: [56, 189, 248, 1],
              width: 6,
              cap: "round",
              join: "round",
            },
          }),
        );
        await viewRef.current
          .goTo({ target: geometry, padding: FIT_PADDING }, { duration: 550 })
          .catch(() => {});
        if (!dead) setNote(`${label} on the map`);
      })
      .catch(() => {
        if (!dead) setNote(`Could not zoom to that segment.`);
      });
    return () => {
      dead = true;
    };
  }, [
    ready,
    segmentFocus?.nonce,
    segmentFocus?.objectId,
    segmentFocus?.layerId,
    segmentFocus?.label,
  ]);

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

  // One route-code label per filtered road (not one label per segment).
  const typeRoadsKey = Array.isArray(typeRoadKeys)
    ? typeRoadKeys.join("|")
    : "";
  useEffect(() => {
    if (!ready) return undefined;
    const labels = routeLabelsRef.current;
    const Graphic = GraphicRef.current;
    const networkDef = LRS_LAYER_DEFS.find((item) => item.route);
    const network = networkDef
      ? layersRef.current.get(networkDef.id)
      : null;
    if (!labels) return undefined;
    labels.removeAll();
    if (network) {
      network.labelsVisible = false;
      network.labelingInfo = null;
    }
    const show = Boolean(typeRoadsKey) && !roadKey && network && Graphic;
    if (!show) return undefined;
    const codeField =
      (fieldsRef.current[networkDef.id]?.roadFields || []).find((name) =>
        /road_code/i.test(name),
      ) || "road_code";
    const safe = String(codeField).replace(/[^A-Za-z0-9_]/g, "") || "road_code";
    const keys = [
      ...new Set(
        typeRoadKeys.map((item) => String(item || "").trim()).filter(Boolean),
      ),
    ].slice(0, 80);
    if (!keys.length) return undefined;
    let dead = false;
    const where =
      network.definitionExpression ||
      `${safe} IN (${keys.map((key) => `'${key.replace(/'/g, "''")}'`).join(",")})`;
    network
      .queryFeatures({
        where,
        outFields: [safe],
        returnGeometry: true,
        maxRecordCount: 2000,
      })
      .then((result) => {
        if (dead || !result?.features?.length) return;
        const seen = new Set();
        const graphics = [];
        for (const feature of result.features) {
          const code = String(
            feature.attributes?.[safe] ??
              feature.attributes?.[safe.toLowerCase()] ??
              "",
          ).trim();
          if (!code || seen.has(code.toLowerCase())) continue;
          const paths = feature.geometry?.paths || [];
          const midPath = paths[Math.floor(paths.length / 2)] || paths[0];
          if (!midPath?.length) continue;
          const mid = midPath[Math.floor(midPath.length / 2)];
          if (!mid || mid.length < 2) continue;
          seen.add(code.toLowerCase());
          graphics.push(
            new Graphic({
              geometry: {
                type: "point",
                x: mid[0],
                y: mid[1],
                spatialReference: feature.geometry.spatialReference,
              },
              symbol: {
                type: "text",
                text: code,
                color: [255, 255, 255, 0.98],
                haloColor: [15, 23, 42, 0.92],
                haloSize: 1.5,
                font: { size: 10, weight: "bold", family: "Arial" },
              },
            }),
          );
        }
        labels.addMany(graphics);
      })
      .catch(() => {});
    return () => {
      dead = true;
      labels.removeAll();
    };
  }, [ready, typeRoadsKey, roadKey, typeRoadKeys]);

  // Fit the map to roads matching the selected pavement bar.
  useEffect(() => {
    if (!ready || !typeRoadsKey || roadKey) return undefined;
    const networkDef = LRS_LAYER_DEFS.find((item) => item.route);
    const network = networkDef
      ? layersRef.current.get(networkDef.id)
      : null;
    const view = viewRef.current;
    if (!network || !view) return undefined;
    let dead = false;
    network
      .queryExtent({ where: network.definitionExpression || "1=1" })
      .then((result) => {
        if (dead || !result?.extent || !(result.count > 0)) return;
        return view.goTo(
          { target: result.extent, padding: FIT_PADDING },
          { duration: 550 },
        );
      })
      .catch(() => {});
    return () => {
      dead = true;
    };
  }, [ready, typeRoadsKey, roadKey, filterKey]);

  // Colour pavement by the active analysis field. A selected chart condition
  // (Surface / PCI / Paved band / …) paints matching roads in that bar's colour.
  useEffect(() => {
    if (!ready) return;
    const pavement = layersRef.current.get(PAVEMENT_LAYER_ID);
    const pavementDef = LRS_LAYER_DEFS.find(
      (item) => item.id === PAVEMENT_LAYER_ID,
    );
    const networkDef = LRS_LAYER_DEFS.find((item) => item.route);
    const network = networkDef
      ? layersRef.current.get(networkDef.id)
      : null;
    const focusSpec =
      pavementField === "paved_band"
        ? PAVEMENT_FIELDS.paved_band
        : PAVEMENT_FIELDS[pavementField] || PAVEMENT_CATEGORY;
    const selectedKey = String(typeValue || "")
      .trim()
      .toLowerCase()
      .replace(/[_-]+/g, " ")
      .replace(/\s+/g, " ");
    const mergedColors = {
      ...(focusSpec?.colors || {}),
      ...(PAVEMENT_CATEGORY.colors || {}),
      ...(chartColors || {}),
    };
    const resolveColor = (key) => {
      if (!key) return null;
      if (mergedColors[key]) return mergedColors[key];
      const hit = Object.entries(mergedColors).find(([name]) => {
        const n = String(name)
          .toLowerCase()
          .replace(/[_-]+/g, " ")
          .replace(/\s+/g, " ")
          .trim();
        return n === key || n.includes(key) || key.includes(n);
      });
      return hit?.[1] || null;
    };
    const selectedColor = resolveColor(selectedKey);
    const keepBlack =
      selectedKey === "fully paved" || selectedKey === "paved";
    const solidLine = (color, width = 3.6, asBlack = false) => ({
      type: "simple",
      symbol: {
        type: "simple-line",
        color: asBlack ? cssToRgb(color, 0.98) : mapLineColor(color),
        width,
        cap: "round",
        join: "round",
      },
    });
    const focusId =
      lineFocus !== "all" && Number.isFinite(Number(lineFocus))
        ? Number(lineFocus)
        : PAVEMENT_LAYER_ID;
    const paintPavement = focusId === PAVEMENT_LAYER_ID;
    if (pavement && pavementDef && paintPavement) {
      if (selectedColor) {
        // Clicked Surface / PCI / Paved band bar → map uses that colour.
        const paint = solidLine(
          selectedColor,
          roadKey ? 4.4 : 3.8,
          keepBlack,
        );
        pavement.renderer = paint;
        if (network) {
          network.renderer = paint;
          network.opacity = 0.95;
        }
      } else {
        // No bar selected — show full segment distribution (PCI / Surface / …).
        const fieldSpec =
          pavementField === "paved_band" ? PAVEMENT_CATEGORY : focusSpec;
        if (fieldSpec?.field) {
          const distWidth =
            pavementField === "pci" || roadKey ? 4.2 : pavementDef.width;
          pavement.renderer = lineRenderer(
            { ...pavementDef, width: distWidth },
            { name: fieldSpec.field },
            mergedColors,
          );
        }
        if (network) {
          // Keep network quiet so PCI/Surface segment colours read clearly.
          network.renderer = solidLine(networkDef.color || "#38bdf8", 1.1);
          network.opacity =
            pavementField === "pci" || pavementField === "surface_type"
              ? 0.25
              : roadKey
                ? 0.35
                : 0.88;
        }
      }
      try {
        pavement.refresh?.();
        network?.refresh?.();
      } catch {
        /* ignore */
      }
    } else if (!paintPavement && focusId === 3) {
      // Carriageway: thick 4-lane, medium 2-lane, thin intermediate.
      const carriageDef = LRS_LAYER_DEFS.find((item) => item.id === 3);
      const carriage = layersRef.current.get(3);
      const carriageColors = {
        ...(VALUE_COLORS[3]?.colors || {}),
        ...(focusId === 3 ? chartColors || {} : {}),
      };
      if (carriage && carriageDef) {
        if (selectedColor) {
          const w = lineWidthFor(carriageDef, selectedKey, roadKey ? 4.4 : 3.8);
          carriage.renderer = solidLine(selectedColor, w);
        } else {
          carriage.renderer = lineRenderer(
            carriageDef,
            { name: VALUE_COLORS[3]?.field || "lane_type" },
            carriageColors,
          );
        }
        try {
          carriage.refresh?.();
        } catch {
          /* ignore */
        }
      }
      if (network && selectedColor) {
        const w = lineWidthFor(
          { id: 3 },
          selectedKey,
          roadKey ? 4.4 : 3.8,
        );
        network.renderer = solidLine(selectedColor, w);
        network.opacity = 0.95;
        try {
          network.refresh?.();
        } catch {
          /* ignore */
        }
      }
    } else if (network && selectedColor && !paintPavement) {
      // Speed / Drainage band selection → colour the network.
      network.renderer = solidLine(selectedColor, roadKey ? 4.4 : 3.8);
      network.opacity = 0.95;
      try {
        network.refresh?.();
      } catch {
        /* ignore */
      }
    }
    const drainage = layersRef.current.get(6);
    if (drainage) {
      const spec = DRAINAGE_FIELDS[drainageMode] || DRAINAGE_FIELDS.type;
      const fieldName = spec.lhs?.[0] || "drainage_type_lhs";
      drainage.renderer = lineRenderer(
        LRS_LAYER_DEFS.find((item) => item.id === 6),
        { name: fieldName },
        {
          ...(spec.colors || {}),
          ...(focusId === 6 ? chartColors || {} : {}),
        },
      );
    }
  }, [
    ready,
    pavementField,
    drainageMode,
    typeValue,
    chartColors,
    roadKey,
    lineFocus,
  ]);

  // Hide district administrative boundaries while a chart / road filter is active.
  useEffect(() => {
    if (!ready) return;
    const district = districtLayerRef.current;
    if (!district) return;
    const filtering = Boolean(
      String(typeValue || "").trim() || typeRoadsKey || roadKey,
    );
    district.visible = !filtering;
  }, [ready, typeValue, typeRoadsKey, roadKey]);

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
