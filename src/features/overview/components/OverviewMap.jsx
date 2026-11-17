import { useEffect, useRef, useState } from "react";
import { LRS, LRS_LAYER_DEFS, VALUE_COLORS } from "../../../config";
import { markerSymbol } from "../../mapping/icons";
import { loadBoundaryExtent, loadModules, loadOverviewFields, overviewWhere, signInToLrs } from "../../mapping/services/lrsService";

const RWANDA = { center: [29.87, -1.94], scale: 3700000 };
const POINT_MIN_SCALE = 900000;

function escapeHtml(value) {
  return String(value).replace(/[&<>"]/g, (ch) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" }[ch]));
}

function popupFor(def) {
  return {
    title: def.title,
    content: (feature) => {
      const attributes = feature.graphic?.attributes || feature.attributes || {};
      const rows = Object.entries(attributes)
        .filter(([key, value]) => value != null && String(value).trim() !== "" && !/objectid|globalid|^shape|shape_|st_area|st_length/i.test(key))
        .slice(0, 10);
      if (!rows.length) return escapeHtml(def.title);
      return `<table class="ov-popup">${rows.map(([key, value]) => `<tr><th>${escapeHtml(key)}</th><td>${escapeHtml(value)}</td></tr>`).join("")}</table>`;
    },
  };
}

function lineRenderer(def, valueField) {
  const width = def.route ? 2.4 : Math.max(def.width || 3, 3);
  const simple = { type: "simple-line", color: def.color, width, cap: "round", join: "round" };
  const rule = VALUE_COLORS[def.id];
  if (!rule || !valueField?.name || def.kind !== "line" || def.route) return { type: "simple", symbol: simple };
  const safe = String(valueField.name).replace(/"/g, "");
  return {
    type: "unique-value",
    valueExpression: `Lower(Text($feature["${safe}"]))`,
    defaultSymbol: simple,
    uniqueValueInfos: Object.entries(rule.colors).map(([value, color]) => ({
      value: String(value).toLowerCase(),
      symbol: { type: "simple-line", color, width: Math.max(width, 3.5), cap: "round", join: "round" },
    })),
  };
}

function pointRenderer(def) {
  const icon = markerSymbol(def, 20);
  if (icon) return { type: "simple", symbol: icon };
  return {
    type: "simple",
    symbol: { type: "simple-marker", style: "circle", color: def.color, size: 8, outline: { color: [255, 255, 255, 0.95], width: 0.8 } },
  };
}

function layerChoice(def, row, scope, query, muted, spec, boundary, fieldsReady) {
  const scopeOff = (scope === "point" && def.kind !== "point") || (scope === "line" && def.kind === "point");
  if (scopeOff) return { on: false, where: null, reason: "Hidden by the asset filter", locked: true };
  const needle = query.trim().toLowerCase();
  const titleHit = !needle || def.title.toLowerCase().includes(needle);
  const typeHit = Boolean(needle) && (row?.groups || []).some((group) => String(group.name).toLowerCase().includes(needle));
  const searchHit = !needle || titleHit || typeHit;
  if (!searchHit || (needle && !titleHit && !spec?.value)) {
    return { on: false, where: null, reason: "Hidden by the current search", locked: true };
  }
  if (muted.includes(def.id)) return { on: false, where: null, reason: "Turned off", locked: false };
  const filter = overviewWhere(fieldsReady ? spec : { boundary: {}, value: spec?.value || null, route: Boolean(def.route) }, boundary, needle && !titleHit ? needle : "");
  if (filter.hide) return { on: false, where: null, reason: "This layer has no field for the selected boundary", locked: true };
  return { on: true, where: filter.where, reason: "", locked: false };
}

export default function OverviewMap({ scope, query, rows, boundary, muted, onToggle }) {
  const host = useRef(null);
  const viewRef = useRef(null);
  const layersRef = useRef(new Map());
  const fieldsRef = useRef({});
  const focusRef = useRef(() => {});
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
        const [{ token }, fields, [Map, MapView, FeatureLayer]] = await Promise.all([
          signInToLrs(),
          loadOverviewFields(),
          loadModules(["esri/Map", "esri/views/MapView", "esri/layers/FeatureLayer"]),
        ]);
        if (dead || !host.current) return;
        fieldsRef.current = fields || {};
        setFieldsReady(true);
        const rank = (def) => (def.route ? 0 : def.kind === "line" ? 1 : 2);
        const layers = [...LRS_LAYER_DEFS].sort((a, b) => rank(a) - rank(b)).map((def) => {
          const spec = fields?.[def.id];
          const layer = new FeatureLayer({
            url: `${def.service || LRS}/${def.id}`,
            id: `overview-${def.id}`,
            title: def.title,
            customParameters: token ? { token } : undefined,
            renderer: def.kind === "point" ? pointRenderer(def) : lineRenderer(def, spec?.value),
            popupTemplate: popupFor(def),
            outFields: ["*"],
            minScale: def.kind === "point" ? POINT_MIN_SCALE : 0,
            listMode: "hide",
          });
          layersRef.current.set(def.id, layer);
          return layer;
        });
        const map = new Map({ basemap: "satellite", layers });
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
        await view.when();
        if (dead) {
          view.destroy();
          return;
        }
        view.resize();
        setReady(true);
        setNote("");
      } catch (error) {
        if (!dead) setNote(error?.message || "The asset map could not be loaded.");
      }
    })();
    return () => {
      dead = true;
      viewRef.current = null;
      layersRef.current = new Map();
      view?.destroy();
    };
  }, []);

  const boundaryId = boundary?.id || "";
  const boundaryName = boundary?.name || "";

  useEffect(() => {
    const view = viewRef.current;
    if (!view || !ready) return undefined;
    let dead = false;
    const fitRwanda = () => view.goTo(RWANDA, { duration: 650 }).catch(() => {});
    if (!boundaryId || !boundaryName || !boundary) {
      focusRef.current = fitRwanda;
      fitRwanda();
      return undefined;
    }
    focusRef.current = fitRwanda;
    loadBoundaryExtent(boundary, boundaryName)
      .then((extent) => {
        if (dead || !extent || !viewRef.current) return;
        const target = { ...extent, spatialReference: extent.spatialReference || { wkid: 4326 } };
        const fit = () => viewRef.current?.goTo(target, { duration: 700 }).catch(() => {});
        focusRef.current = fit;
        fit();
      })
      .catch(() => {});
    return () => {
      dead = true;
    };
  }, [boundary, boundaryId, boundaryName, ready]);

  const choices = LRS_LAYER_DEFS.map((def) => {
    const row = rows.find((item) => item.id === def.id);
    const spec = fieldsRef.current[def.id] || { boundary: {}, value: null, route: Boolean(def.route) };
    return { def, ...layerChoice(def, row, scope, query, muted, spec, boundary, fieldsReady) };
  });

  const filterKey = choices.map((item) => `${item.def.id}:${item.on ? 1 : 0}:${item.where || ""}`).join("|");
  const choicesRef = useRef(choices);
  choicesRef.current = choices;
  useEffect(() => {
    if (!ready) return;
    choicesRef.current.forEach(({ def, on, where }) => {
      const layer = layersRef.current.get(def.id);
      if (!layer) return;
      layer.visible = on;
      const next = where || null;
      if ((layer.definitionExpression || null) !== next) layer.definitionExpression = next;
    });
  }, [ready, filterKey]);

  const visibleCount = choices.filter((item) => item.on).length;

  return (
    <article className="ov-asset ov-map-card">
      <div ref={host} className="ov-map" />
      <div className="ov-map-hud">
        <strong>Assets on the map</strong>
        <span>{note || `${visibleCount} layer${visibleCount === 1 ? "" : "s"} · point assets appear as you zoom in`}</span>
      </div>
      <div className="ov-map-legend" role="group" aria-label="Asset layers">
        {choices.map(({ def, on, reason, locked }) => (
          <button
            key={def.id}
            type="button"
            className={on ? "on" : ""}
            disabled={locked}
            title={on ? `Hide ${def.title}` : (reason || `Show ${def.title}`)}
            onClick={() => onToggle(def.id)}
          >
            <i style={{ background: def.swatch }} />
            {def.title}
          </button>
        ))}
      </div>
    </article>
  );
}
