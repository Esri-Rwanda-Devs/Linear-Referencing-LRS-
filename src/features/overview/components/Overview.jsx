import { useEffect, useMemo, useRef, useState } from "react";
import { assetIcons } from "../../../assets";
import {
  LRS_LAYER_DEFS,
  PAVEMENT_LAYER_ID,
  SNAP_METERS,
  VALUE_COLORS,
} from "../../../config";
import { iconUrl } from "../../mapping/icons";
import {
  countOverviewArea,
  groupOverviewTypes,
  loadBoundaryChoices,
  loadBoundaryLevels,
  loadLineEventRoadStats,
  loadOverview,
  loadPavementIndex,
  loadRoadProfile,
} from "../../mapping/services/lrsService";
import OverviewMap from "./OverviewMap";
import "./Overview.css";

function attributeOf(attributes, name) {
  if (!attributes) return "";
  if (name in attributes) return attributes[name];
  const key = Object.keys(attributes).find(
    (item) => item.toLowerCase() === name.toLowerCase(),
  );
  return key ? attributes[key] : "";
}

function pavementRoadOptions(features) {
  const seen = new Set();
  const options = [];
  (features || []).forEach((feature) => {
    const attrs = feature.attributes || feature;
    const code = String(attributeOf(attrs, "road_code") || "").trim();
    const routeId = String(attributeOf(attrs, "routeid") || "").trim();
    const name = String(
      attributeOf(attrs, "routename") || attributeOf(attrs, "link_name") || "",
    ).trim();
    const key = code || routeId || name;
    if (!key || seen.has(key.toLowerCase())) return;
    seen.add(key.toLowerCase());
    options.push({
      key,
      code: code || key,
      label: code || name || routeId || key,
    });
  });
  return options.sort((a, b) => a.label.localeCompare(b.label));
}

function isPavedName(name) {
  return /^paved$/i.test(String(name || "").trim());
}

/**
 * Pavement has extra classes (Impassable, Overlap, …). For analysis we treat
 * everything that is not exactly "paved" as Unpaved so Paved + Unpaved = 100%.
 */
function collapsePavementTypes(types) {
  let pavedKm = 0;
  let pavedCount = 0;
  let otherKm = 0;
  let otherCount = 0;
  (types || []).forEach((item) => {
    const km = Number(item.km) || 0;
    const count = Number(item.count) || 0;
    if (isPavedName(item.name)) {
      pavedKm += km;
      pavedCount += count;
    } else {
      otherKm += km;
      otherCount += count;
    }
  });
  return [
    { name: "Paved", km: pavedKm, count: pavedCount },
    { name: "Unpaved", km: otherKm, count: otherCount },
  ].filter((item) => item.km > 0 || item.count > 0);
}

function analysisTypeShares(types, totalKm, layerId) {
  const source =
    Number(layerId) === PAVEMENT_LAYER_ID
      ? collapsePavementTypes(types)
      : types;
  const total =
    Number.isFinite(totalKm) && totalKm > 0
      ? totalKm
      : (source || []).reduce((sum, item) => sum + (Number(item.km) || 0), 0);
  return complementTypeShares(source, total);
}

function pavedShare(groups) {
  const shares = analysisTypeShares(groups, null, PAVEMENT_LAYER_ID);
  const paved = shares.find((item) => isPavedName(item.name));
  return paved && Number.isFinite(paved.pct) ? paved.pct : null;
}

const LINE_EVENT_DEFS = LRS_LAYER_DEFS.filter((def) => def.kind === "line");
/** Line events that carry categories (pavement, drain, speed, carriageway). */
const ANALYSIS_DEFS = LINE_EVENT_DEFS.filter((def) => !def.route);

/** Short tab label: "Pavement Type" → "Pavement". */
function shortTitle(def) {
  return String(def?.title || "").replace(/\s+(type|limit)$/i, "");
}

/** Display name for a category, e.g. speed "60" → "60 km/h". */
function typeLabel(layerId, name) {
  const text = String(name ?? "").trim();
  if (Number(layerId) === 14 && /^\d+(\.\d+)?$/.test(text))
    return `${text} km/h`;
  return text.replace(/\b[a-z]/g, (ch) => ch.toUpperCase());
}

/** Sum each category's km and segments across roads. */
function aggregateTypes(roads) {
  const byType = {};
  let totalKm = 0;
  (roads || []).forEach((road) => {
    totalKm += Number(road.totalKm) || 0;
    Object.values(road.byType || {}).forEach((item) => {
      const name = String(item.name || "No data").trim() || "No data";
      const entry = byType[name] || { name, km: 0, count: 0 };
      entry.km += Number(item.km) || 0;
      entry.count += Number(item.count) || 0;
      byType[name] = entry;
    });
  });
  return { types: Object.values(byType), totalKm };
}

const sameName = (a, b) =>
  String(a || "")
    .trim()
    .toLowerCase() ===
  String(b || "")
    .trim()
    .toLowerCase();

function typeChoicesFor(layerId, groups) {
  const colors = VALUE_COLORS[layerId]?.colors;
  if (colors && Object.keys(colors).length) {
    return Object.keys(colors).map((name) => ({
      value: name,
      label: name.replace(/\b\w/g, (ch) => ch.toUpperCase()),
    }));
  }
  return (groups || [])
    .map((group) => String(group.name || "").trim())
    .filter(Boolean)
    .map((name) => ({
      value: name.toLowerCase(),
      label: name,
    }));
}

function sharePct(part, total) {
  if (!(total > 0) || !Number.isFinite(part)) return null;
  return Math.round((part / total) * 100);
}

/** Round type shares so they always add to 100% (largest-remainder). */
function complementTypeShares(types, totalKm) {
  const list = (types || []).filter(
    (item) => Number(item.km) > 0 || Number(item.count) > 0,
  );
  const total =
    Number.isFinite(totalKm) && totalKm > 0
      ? totalKm
      : list.reduce((sum, item) => sum + (Number(item.km) || 0), 0);
  if (!list.length || !(total > 0)) return [];
  // Binary case: force exact complements (e.g. paved 64% → unpaved 36%).
  if (list.length === 2) {
    const sorted = [...list].sort(
      (a, b) => (Number(b.km) || 0) - (Number(a.km) || 0),
    );
    const firstPct = Math.round(((Number(sorted[0].km) || 0) / total) * 100);
    return [
      { ...sorted[0], km: Number(sorted[0].km) || 0, pct: firstPct },
      {
        ...sorted[1],
        km: Number(sorted[1].km) || 0,
        pct: 100 - firstPct,
      },
    ];
  }
  const rows = list.map((item) => {
    const km = Number(item.km) || 0;
    const raw = (km / total) * 100;
    return {
      ...item,
      km,
      raw,
      pct: Math.floor(raw),
    };
  });
  let left = 100 - rows.reduce((sum, item) => sum + item.pct, 0);
  [...rows]
    .sort((a, b) => b.raw - Math.floor(b.raw) - (a.raw - Math.floor(a.raw)))
    .forEach((item) => {
      if (left <= 0) return;
      item.pct += 1;
      left -= 1;
    });
  return rows.sort((a, b) => b.km - a.km);
}

const EMPTY_IDS = [];

const numberText = (value) =>
  Number.isFinite(value) ? value.toLocaleString() : "—";

const PLACEHOLDER_ROWS = LRS_LAYER_DEFS.filter(
  (def) => def.kind === "point" || def.kind === "line",
).map((def) => ({
  id: def.id,
  title: def.title,
  kind: def.kind,
  group: def.group,
  swatch: def.swatch,
  shape: def.shape,
  route: Boolean(def.route),
  count: null,
  groups: [],
  error: "",
}));

const POINT_RANK = [
  "Bridges",
  "Culverts",
  "Cameras",
  "Traffic",
  "Accidents",
  "Transformers",
  "LV Supports",
  "MV Supports",
  "Point Assets",
  "KM Stones",
];

function rankOf(title) {
  const at = POINT_RANK.findIndex(
    (name) => name.toLowerCase() === String(title).toLowerCase(),
  );
  return at < 0 ? POINT_RANK.length : at;
}

function plural(label) {
  const text = String(label || "").toLowerCase();
  return text.endsWith("s") ? text : `${text}s`;
}

function typeColor(layerId, name, fallback) {
  const colors = VALUE_COLORS[layerId]?.colors || {};
  const key = String(name)
    .toLowerCase()
    .replace(/[_-]+/g, " ")
    .replace(/\s+/g, " ")
    .trim();
  return colors[key] || fallback || "#94a3b8";
}

function Bars({ items }) {
  const max = Math.max(1, ...items.map((item) => item.count));
  if (!items.length) return null;
  return (
    <ul className="ov-bars">
      {items.map((item) => (
        <li key={item.name}>
          <span title={item.name}>{item.name}</span>
          <i
            style={{
              width: `${Math.max(6, (item.count / max) * 100)}%`,
              background: item.color,
            }}
          />
          <b>{numberText(item.count)}</b>
        </li>
      ))}
    </ul>
  );
}

const kmText = (value) => {
  if (!Number.isFinite(value)) return "—";
  const digits = value > 0 && value < 10 ? 2 : 1;
  return value.toLocaleString(undefined, { maximumFractionDigits: digits });
};

function niceStep(max) {
  const raw = max / 4;
  const power = 10 ** Math.floor(Math.log10(raw || 1));
  const scaled = raw / power;
  return (scaled <= 1 ? 1 : scaled <= 2 ? 2 : scaled <= 5 ? 5 : 10) * power;
}

function LengthChart({ title, items, loading, mark }) {
  const chartItems =
    Number(mark?.id) === PAVEMENT_LAYER_ID
      ? collapsePavementTypes(items).map((item) => ({
          ...item,
          color: typeColor(mark.id, item.name, mark.swatch),
        }))
      : items;
  const measured = chartItems.filter((item) => Number.isFinite(item.km));
  const max = Math.max(0, ...measured.map((item) => item.km));
  const step = niceStep(max || 1);
  const top = Math.max(step, Math.ceil(max / step) * step);
  const ticks = [];
  for (let value = top; value >= 0; value -= step) ticks.push(value);
  const total = measured.reduce((sum, item) => sum + item.km, 0);
  const segments = measured.reduce(
    (sum, item) => sum + (Number.isFinite(item.count) ? item.count : 0),
    0,
  );
  const shares = analysisTypeShares(measured, total, mark?.id);
  const pctOf = (name) =>
    shares.find(
      (item) =>
        String(item.name || "")
          .trim()
          .toLowerCase() ===
        String(name || "")
          .trim()
          .toLowerCase(),
    )?.pct ?? null;
  return (
    <article className="ov-asset ov-chart">
      <header>
        <span>
          <CardMark item={mark} />
          Length per {title}
        </span>
        <b>
          {measured.length
            ? `${kmText(total)} km · ${numberText(segments)} seg`
            : ""}
        </b>
      </header>
      {loading && (
        <div className="ov-chart-loading" role="status">
          <span className="ov-spinner" aria-hidden="true" />
          <span>Loading lengths…</span>
        </div>
      )}
      {!loading && measured.length > 0 && (
        <div className="ov-chart-body">
          <div className="ov-chart-axis">
            {ticks.map((value) => (
              <span key={value}>{kmText(value)}</span>
            ))}
          </div>
          <div
            className="ov-chart-plot"
            style={{ "--ov-ticks": ticks.length - 1 }}
          >
            {measured.map((item) => {
              const pct = pctOf(item.name);
              return (
                <div
                  key={item.name}
                  className="ov-col"
                  style={{
                    "--ov-bar": `${Math.max(1, (item.km / top) * 100)}%`,
                  }}
                  title={`${item.name}: ${kmText(item.km)} km (${pct ?? "—"}%) · ${numberText(item.count)} segments`}
                >
                  <b>
                    {kmText(item.km)}
                    {pct != null ? ` · ${pct}%` : ""}
                  </b>
                  <i style={{ background: item.color }} />
                </div>
              );
            })}
          </div>
          <div />
          <div className="ov-chart-labels">
            {measured.map((item) => (
              <span key={item.name} title={item.name}>
                {item.name}
                {pctOf(item.name) != null ? ` ${pctOf(item.name)}%` : ""}
              </span>
            ))}
          </div>
        </div>
      )}
      {!loading && !measured.length && (
        <p className="ov-empty">No length data for this filter yet.</p>
      )}
    </article>
  );
}

function roadTypeShare(road, typeNeedle, layerId) {
  const totalKm = Number(road?.totalKm) || 0;
  const types = analysisTypeShares(
    Object.values(road?.byType || {}),
    totalKm,
    layerId,
  );
  if (!types.length || !(totalKm > 0)) {
    return { pct: null, label: "", matchKm: 0, matchSeg: 0 };
  }
  const needle = String(typeNeedle || "")
    .trim()
    .toLowerCase();
  let match;
  if (needle) {
    match = types.find(
      (item) =>
        String(item.name || "")
          .trim()
          .toLowerCase() === needle,
    );
  } else {
    // Default share: paved when present, otherwise the longest type.
    match =
      types.find(
        (item) =>
          String(item.name || "")
            .trim()
            .toLowerCase() === "paved",
      ) || [...types].sort((a, b) => (b.km || 0) - (a.km || 0))[0];
  }
  const matchKm = Number(match?.km) || 0;
  const matchSeg = Number(match?.count) || 0;
  return {
    pct: sharePct(matchKm, totalKm),
    label: match?.name || "",
    matchKm,
    matchSeg,
  };
}

function RoadTypeBar({ road, layerId, shareLabel }) {
  const totalKm = Number(road?.totalKm) || 0;
  const types = analysisTypeShares(
    Object.values(road?.byType || {}),
    totalKm,
    layerId,
  );
  if (!types.length || !(totalKm > 0)) return null;
  const focus = String(shareLabel || "")
    .trim()
    .toLowerCase();
  return (
    <div className="ov-road-bar">
      <div
        className="ov-road-bar-track"
        role="img"
        aria-label={`${road.code || road.label} line event distribution`}
      >
        {types.map((item) => {
          if (!(item.pct > 0)) return null;
          return (
            <i
              key={item.name}
              style={{
                width: `${Math.max(item.pct, 1)}%`,
                background: typeColor(layerId, item.name, "#94a3b8"),
              }}
              title={`${typeLabel(layerId, item.name)}: ${item.pct}% · ${kmText(item.km)} km · ${numberText(item.count)} seg`}
            />
          );
        })}
      </div>
      <ul className="ov-road-bar-legend">
        {types.map((item) => {
          const active =
            focus &&
            String(item.name || "")
              .trim()
              .toLowerCase() === focus;
          return (
            <li key={item.name} className={active ? "on" : ""}>
              <i
                style={{
                  background: typeColor(layerId, item.name, "#94a3b8"),
                }}
              />
              <span>
                {typeLabel(layerId, item.name)} {item.pct}%
              </span>
              <b>
                {kmText(item.km)} km · {numberText(item.count)} seg
              </b>
            </li>
          );
        })}
      </ul>
    </div>
  );
}

function AnalysisBox({
  roadKey,
  roadLabel,
  typeShares,
  categories,
  lineFocusLabel,
  typeValue,
  shareLabel,
  layerId,
  roads,
  loading,
  error,
  place,
  onSelectRoad,
  onLayer,
  onType,
}) {
  const needle = String(roadKey || "")
    .trim()
    .toLowerCase();
  const listed = roads || [];
  const selected =
    listed.find(
      (road) =>
        road.key.toLowerCase() === needle ||
        String(road.code || "").toLowerCase() === needle,
    ) || null;
  // When a route is selected, the focus card owns its progress bar; list peers below.
  const capped = selected
    ? listed.filter((road) => road.key !== selected.key).slice(0, 40)
    : listed.slice(0, 60);
  const focusNote = [
    lineFocusLabel || null,
    typeValue ? typeLabel(layerId, typeValue) : null,
    place || null,
  ]
    .filter(Boolean)
    .join(" · ");
  const selectedCode = selected?.code || roadLabel || roadKey || "";
  const shares = typeShares || [];
  const shareSummary = shares.length
    ? shares
        .map((item) => `${typeLabel(layerId, item.name)} ${item.pct}%`)
        .join(" · ")
    : "—";
  return (
    <aside className="ov-analysis" aria-label="Line event analysis">
      <header>
        <strong>Analysis</strong>
        <span>{focusNote || "National line events"}</span>
      </header>
      <div className="ov-analysis-tabs" role="tablist" aria-label="Line event">
        {ANALYSIS_DEFS.map((def) => (
          <button
            key={def.id}
            type="button"
            role="tab"
            aria-selected={def.id === Number(layerId)}
            className={def.id === Number(layerId) ? "on" : ""}
            onClick={() => onLayer?.(def.id)}
          >
            <i style={{ background: def.swatch }} />
            {shortTitle(def)}
          </button>
        ))}
      </div>
      {(categories || []).length > 0 ? (
        <div className="ov-analysis-chips" aria-label="Category filter">
          <button
            type="button"
            className={typeValue ? "" : "on"}
            onClick={() => onType?.("")}
          >
            All
          </button>
          {categories.map((item) => {
            const on = sameName(typeValue, item.name);
            return (
              <button
                key={item.name}
                type="button"
                className={on ? "on" : ""}
                aria-pressed={on}
                title={`${kmText(item.km)} km · ${numberText(item.count)} seg`}
                onClick={() =>
                  onType?.(on ? "" : String(item.name).trim().toLowerCase())
                }
              >
                <i
                  style={{
                    background: typeColor(layerId, item.name, "#94a3b8"),
                  }}
                />
                {typeLabel(layerId, item.name)}
                <b>{item.pct}%</b>
              </button>
            );
          })}
        </div>
      ) : null}
      <div className="ov-analysis-kpis">
        <div>
          <span>Type share</span>
          <b title={shareSummary}>{shareSummary}</b>
        </div>
        <div>
          <span>Route code</span>
          <b title={selectedCode || "All roads"}>
            {selectedCode || "All roads"}
          </b>
        </div>
        <div>
          <span>Roads</span>
          <b>{loading ? "…" : listed.length || "—"}</b>
        </div>
      </div>
      {shares.length > 0 ? (
        <div className="ov-analysis-sharebar" aria-hidden="true">
          {shares.map((item) => (
            <i
              key={item.name}
              style={{
                width: `${Math.max(item.pct, 0)}%`,
                background: typeColor(layerId, item.name, "#94a3b8"),
              }}
              title={`${typeLabel(layerId, item.name)} ${item.pct}%`}
            />
          ))}
        </div>
      ) : null}
      {selected ? (
        <button
          type="button"
          className="ov-analysis-focus"
          onClick={() => onSelectRoad?.(selected)}
          title={`Zoom to ${selected.code || selected.label}`}
        >
          <header>
            <strong>{selected.code || selected.label}</strong>
            <span>
              {kmText(selected.totalKm)} km · {numberText(selected.segments)}{" "}
              segments
              {selected.name ? ` · ${selected.name}` : ""}
            </span>
          </header>
          <RoadTypeBar
            road={selected}
            layerId={layerId}
            shareLabel={typeValue || shareLabel}
          />
        </button>
      ) : null}
      <ul className="ov-analysis-list">
        {loading && <li className="ov-analysis-empty">Loading road shares…</li>}
        {!loading &&
          capped.map((road) => {
            const parts = analysisTypeShares(
              Object.values(road.byType || {}),
              road.totalKm,
              layerId,
            );
            const focusName = String(typeValue || shareLabel || "")
              .trim()
              .toLowerCase();
            const focusPart =
              parts.find(
                (item) =>
                  String(item.name || "")
                    .trim()
                    .toLowerCase() === focusName,
              ) || parts[0];
            const code = road.code || road.label;
            const pairText = parts
              .map((item) => `${typeLabel(layerId, item.name)} ${item.pct}%`)
              .join(" · ");
            return (
              <li key={road.key}>
                <button
                  type="button"
                  className={`ov-analysis-road${
                    selected && road.key === selected.key ? " on" : ""
                  }`}
                  onClick={() => onSelectRoad?.(road)}
                >
                  <div className="ov-analysis-road-head">
                    <strong>{code}</strong>
                    <b>
                      {focusPart
                        ? `${typeLabel(layerId, focusPart.name)} ${focusPart.pct}%`
                        : "—"}
                    </b>
                  </div>
                  <RoadTypeBar
                    road={road}
                    layerId={layerId}
                    shareLabel={typeValue || shareLabel}
                  />
                  <span>
                    {pairText}
                    {` · ${kmText(road.totalKm)} km · ${numberText(road.segments)} seg`}
                  </span>
                </button>
              </li>
            );
          })}
        {!loading && !selected && listed.length > capped.length ? (
          <li className="ov-analysis-empty">
            Showing top {capped.length} of {listed.length} roads — pick a route
            code (e.g. NR1) to focus one.
          </li>
        ) : null}
        {!loading && !listed.length && (
          <li className="ov-analysis-empty">
            {error || "No roads match this line-event filter."}
          </li>
        )}
      </ul>
    </aside>
  );
}

const kmAt = (value) => (Number.isFinite(value) ? value.toFixed(2) : "—");

/** One line event along the picked road: segments placed by from/to measure, coloured by category. */
function SegmentStrip({ def, layer, typeValue }) {
  const segments = layer?.segments || [];
  const groups = analysisTypeShares(
    layer?.groups || [],
    (layer?.groups || []).reduce((sum, item) => sum + (Number(item.km) || 0), 0),
    def.id,
  );
  const routes = new Map();
  segments.forEach((segment) => {
    const list = routes.get(segment.route) || [];
    list.push(segment);
    routes.set(segment.route, list);
  });
  const rows = [...routes.entries()].map(([route, list]) => {
    const placed = list.every(
      (item) => Number.isFinite(item.from) && Number.isFinite(item.to),
    );
    let cursor = 0;
    // Without measures, lay segments end to end in their stored order.
    const items = list
      .map((item) => {
        if (placed) return item;
        const from = cursor;
        cursor += item.km;
        return { ...item, from, to: cursor };
      })
      .sort((a, b) => a.from - b.from);
    const start = Math.min(...items.map((item) => item.from));
    const end = Math.max(...items.map((item) => item.to));
    return { route, items, start, end, span: end - start || 1 };
  });
  const focus = String(typeValue || "").trim().toLowerCase();
  const collapse = Number(def.id) === PAVEMENT_LAYER_ID;
  const colorOf = (type) =>
    typeColor(def.id, collapse && !isPavedName(type) ? "unpaved" : type, def.swatch);
  const matches = (type) =>
    !focus ||
    sameName(type, focus) ||
    (collapse && focus === "unpaved" && !isPavedName(type));
  return (
    <article className="ov-strip">
      <header>
        <span>
          <i style={{ background: def.swatch }} />
          {def.title}
        </span>
        <b>
          {layer == null
            ? "…"
            : layer.error
              ? "Unavailable"
              : `${numberText(segments.length)} seg`}
        </b>
      </header>
      {layer?.error ? <p className="ov-strip-note">{layer.error}</p> : null}
      {layer && !layer.error && !segments.length ? (
        <p className="ov-strip-note">No {def.title.toLowerCase()} segments on this road.</p>
      ) : null}
      {rows.map((row) => (
        <div className="ov-strip-row" key={row.route || "road"}>
          {rows.length > 1 ? <em>{row.route || "—"}</em> : null}
          <div className="ov-strip-track">
            {row.items.map((item, index) => (
              <i
                key={`${item.from}-${index}`}
                className={matches(item.type) ? "" : "dim"}
                style={{
                  left: `${((item.from - row.start) / row.span) * 100}%`,
                  width: `${Math.max(((item.to - item.from) / row.span) * 100, 0.4)}%`,
                  background: colorOf(item.type),
                }}
                title={`${typeLabel(def.id, item.type)} · km ${kmAt(item.from)}–${kmAt(item.to)} · ${kmText(item.km)} km`}
              />
            ))}
          </div>
          <div className="ov-strip-axis">
            <span>km {kmAt(row.start)}</span>
            <span>km {kmAt(row.end)}</span>
          </div>
        </div>
      ))}
      {groups.length > 0 ? (
        <ul className="ov-road-bar-legend">
          {groups.map((item) => (
            <li key={item.name} className={matches(item.name) && focus ? "on" : ""}>
              <i style={{ background: typeColor(def.id, item.name, def.swatch) }} />
              <span>
                {typeLabel(def.id, item.name)} {item.pct}%
              </span>
              <b>
                {kmText(item.km)} km · {numberText(item.count)} seg
              </b>
            </li>
          ))}
        </ul>
      ) : null}
      {segments.length > 0 ? (
        <details className="ov-strip-list">
          <summary>Segments ({segments.length})</summary>
          <table>
            <thead>
              <tr>
                {rows.length > 1 ? <th>Route</th> : null}
                <th>From km</th>
                <th>To km</th>
                <th>Length</th>
                <th>Category</th>
              </tr>
            </thead>
            <tbody>
              {rows.flatMap((row) =>
                row.items
                  .filter((item) => matches(item.type))
                  .map((item, index) => (
                    <tr key={`${row.route}-${item.from}-${index}`}>
                      {rows.length > 1 ? <td>{row.route}</td> : null}
                      <td>{kmAt(item.from)}</td>
                      <td>{kmAt(item.to)}</td>
                      <td>{kmText(item.km)} km</td>
                      <td>
                        <i style={{ background: colorOf(item.type) }} />
                        {typeLabel(def.id, item.type)}
                      </td>
                    </tr>
                  )),
              )}
            </tbody>
          </table>
        </details>
      ) : null}
    </article>
  );
}

/** Searchable road dropdown: type to filter, arrows + Enter to pick, list scrolls. */
function RoadPicker({ options, query, selectedKey, onQuery, onPick, onClear }) {
  const [open, setOpen] = useState(false);
  const [active, setActive] = useState(0);
  const boxRef = useRef(null);
  const listRef = useRef(null);
  const inputRef = useRef(null);
  const [place, setPlace] = useState(null);
  const selected = options.find((item) => item.key === selectedKey);
  // Show the full list when the box holds the picked road; filter while typing.
  const needle =
    selected && query === selected.label ? "" : query.trim().toLowerCase();
  const matches = useMemo(
    () =>
      needle
        ? options.filter(
            (item) =>
              item.label.toLowerCase().includes(needle) ||
              item.key.toLowerCase().includes(needle),
          )
        : options,
    [options, needle],
  );
  useEffect(() => {
    if (!open) return undefined;
    const close = (event) => {
      if (!boxRef.current?.contains(event.target)) setOpen(false);
    };
    document.addEventListener("mousedown", close);
    return () => document.removeEventListener("mousedown", close);
  }, [open]);
  // The toolbar scrolls sideways and would clip the list, so pin it to the viewport.
  useEffect(() => {
    if (!open) return undefined;
    const measure = () => {
      const rect = inputRef.current?.getBoundingClientRect();
      if (rect) setPlace({ top: rect.bottom + 4, left: rect.left, width: rect.width });
    };
    measure();
    window.addEventListener("resize", measure);
    window.addEventListener("scroll", measure, true);
    return () => {
      window.removeEventListener("resize", measure);
      window.removeEventListener("scroll", measure, true);
    };
  }, [open]);
  useEffect(() => {
    listRef.current
      ?.querySelector(`[data-index="${active}"]`)
      ?.scrollIntoView({ block: "nearest" });
  }, [active, open]);
  const pick = (item) => {
    if (!item) return;
    onPick(item);
    setOpen(false);
  };
  const onKeyDown = (event) => {
    if (event.key === "ArrowDown" || event.key === "ArrowUp") {
      event.preventDefault();
      if (!open) {
        setOpen(true);
        return;
      }
      const step = event.key === "ArrowDown" ? 1 : -1;
      setActive((value) =>
        Math.min(Math.max(value + step, 0), Math.max(matches.length - 1, 0)),
      );
    } else if (event.key === "Enter") {
      if (open) {
        event.preventDefault();
        pick(matches[active]);
      }
    } else if (event.key === "Escape") {
      setOpen(false);
    }
  };
  return (
    <div className="ov-filter ov-road" ref={boxRef}>
      <span>Road</span>
      <div className={`ov-combo${open ? " is-open" : ""}`}>
        <input
          ref={inputRef}
          value={query}
          placeholder="Search or select a road…"
          role="combobox"
          aria-expanded={open}
          aria-controls="ov-road-list"
          aria-label="Search road by name or code"
          onFocus={(event) => {
            setOpen(true);
            event.target.select();
          }}
          onChange={(event) => {
            onQuery(event.target.value);
            setActive(0);
            setOpen(true);
          }}
          onKeyDown={onKeyDown}
        />
        {selectedKey || query ? (
          <button
            type="button"
            className="ov-combo-clear"
            aria-label="Clear road"
            onClick={() => {
              onClear();
              setActive(0);
            }}
          >
            ×
          </button>
        ) : null}
        <button
          type="button"
          className="ov-combo-caret"
          aria-label={open ? "Close road list" : "Open road list"}
          tabIndex={-1}
          onClick={() => setOpen((value) => !value)}
        >
          ▾
        </button>
        {open ? (
          <ul
            className="ov-combo-list"
            id="ov-road-list"
            role="listbox"
            ref={listRef}
            style={place ? { top: place.top, left: place.left, width: place.width } : undefined}
          >
            {matches.length ? (
              matches.map((item, index) => (
                <li
                  key={item.key}
                  data-index={index}
                  role="option"
                  aria-selected={item.key === selectedKey}
                  className={`${index === active ? "is-active" : ""}${
                    item.key === selectedKey ? " is-picked" : ""
                  }`}
                  onMouseEnter={() => setActive(index)}
                  onMouseDown={(event) => {
                    event.preventDefault();
                    pick(item);
                  }}
                >
                  {item.label}
                </li>
              ))
            ) : (
              <li className="ov-combo-empty">No road matches “{query}”.</li>
            )}
          </ul>
        ) : null}
      </div>
    </div>
  );
}

function CardMark({ item }) {
  const href = iconUrl(item?.shape, item?.swatch);
  if (href) return <img className="ov-icon" src={href} alt="" />;
  if (item?.route) {
    const RouteIcon = assetIcons.GiRoad;
    return <RouteIcon className="ov-icon" style={{ color: item.swatch }} />;
  }
  return <i style={{ background: item?.swatch }} />;
}

function CountCard({ item, count, loading, note = "" }) {
  return (
    <article className="ov-asset ov-compact" title={note || undefined}>
      <header>
        <CardMark item={item} />
        <span>{item.title}</span>
      </header>
      <strong>{loading ? "…" : numberText(count)}</strong>
    </article>
  );
}

export default function Overview({ query = "", onQuery }) {
  const [rows, setRows] = useState(PLACEHOLDER_ROWS);
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(true);
  const [scope, setScope] = useState("all");
  const [levels, setLevels] = useState([]);
  const [choices, setChoices] = useState({});
  const [selected, setSelected] = useState({});
  const [boundaryNote, setBoundaryNote] = useState("");
  const [loadingKey, setLoadingKey] = useState("");
  const [areaCounts, setAreaCounts] = useState(null);
  const [areaLoading, setAreaLoading] = useState(false);
  const [typeGroups, setTypeGroups] = useState(null);
  const [muted, setMuted] = useState([]);
  const [lineFocus, setLineFocus] = useState("all");
  const [typeValue, setTypeValue] = useState("");
  const [roadKey, setRoadKey] = useState("");
  const [roadZoomNonce, setRoadZoomNonce] = useState(0);
  const [roadOptions, setRoadOptions] = useState([]);
  const [roadQuery, setRoadQuery] = useState("");
  const [roadStats, setRoadStats] = useState([]);
  const [roadStatsLoading, setRoadStatsLoading] = useState(false);
  const [roadStatsError, setRoadStatsError] = useState("");
  const [roadProfile, setRoadProfile] = useState(null);
  const [roadProfileLoading, setRoadProfileLoading] = useState(false);

  useEffect(() => {
    let dead = false;
    loadOverview()
      .then((result) => {
        if (dead) return;
        const byId = new Map((result || []).map((item) => [item.id, item]));
        // Keep every layer card visible from the start; fill in live counts.
        setRows(
          PLACEHOLDER_ROWS.map((placeholder) => {
            const live = byId.get(placeholder.id);
            return live ? { ...placeholder, ...live } : placeholder;
          }),
        );
      })
      .catch((reason) => {
        if (!dead) {
          setError(reason.message || "Could not load the overview.");
          setRows(PLACEHOLDER_ROWS);
        }
      })
      .finally(() => {
        if (!dead) setLoading(false);
      });
    loadBoundaryLevels()
      .then(async (found) => {
        if (dead) return;
        setLevels(found);
        if (!found.length) {
          setBoundaryNote("The boundary layer has no province field.");
          return;
        }
        setLoadingKey(found[0].id);
        const names = await loadBoundaryChoices(found[0], []);
        if (dead) return;
        setChoices({ [found[0].id]: names });
      })
      .catch((reason) => {
        if (!dead)
          setBoundaryNote(
            reason.message || "Could not load administrative boundaries.",
          );
      })
      .finally(() => {
        if (!dead) setLoadingKey("");
      });
    loadPavementIndex()
      .then((features) => {
        if (!dead) setRoadOptions(pavementRoadOptions(features));
      })
      .catch(() => {
        if (!dead) setRoadOptions([]);
      });
    return () => {
      dead = true;
    };
  }, []);

  const active = [...levels].reverse().find((level) => selected[level.id]);

  useEffect(() => {
    if (!active) {
      setAreaCounts(null);
      setAreaLoading(false);
      return undefined;
    }
    let dead = false;
    setAreaLoading(true);
    countOverviewArea(active.id, selected[active.id])
      .then((result) => {
        if (dead) return;
        const next = {};
        result.forEach((item) => {
          next[item.id] = item.count;
        });
        setAreaCounts(next);
      })
      .catch(() => {
        if (!dead) setAreaCounts({});
      })
      .finally(() => {
        if (!dead) setAreaLoading(false);
      });
    return () => {
      dead = true;
    };
  }, [active, selected]);

  useEffect(() => {
    if (!active) {
      setTypeGroups(null);
      return undefined;
    }
    let dead = false;
    setTypeGroups(null);
    groupOverviewTypes(active.id, selected[active.id])
      .then((result) => {
        if (dead) return;
        const next = {};
        result.forEach((item) => {
          next[item.id] = item.groups;
        });
        setTypeGroups(next);
      })
      .catch(() => {
        if (!dead) setTypeGroups({});
      });
    return () => {
      dead = true;
    };
  }, [active, selected]);

  const choose = (index, value) => {
    const nextSelected = {};
    levels.slice(0, index).forEach((level) => {
      nextSelected[level.id] = selected[level.id];
    });
    if (value) nextSelected[levels[index].id] = value;
    setSelected(nextSelected);
    const nextChoices = {};
    levels.slice(0, index + 1).forEach((level) => {
      nextChoices[level.id] = choices[level.id] || [];
    });
    setChoices(nextChoices);
    const child = levels[index + 1];
    if (!value || !child) return;
    setLoadingKey(child.id);
    const parents = levels.slice(0, index + 1).map((level) => ({
      field: level.field,
      type: level.type,
      value: nextSelected[level.id],
    }));
    loadBoundaryChoices(child, parents)
      .then((names) =>
        setChoices((current) => ({ ...current, [child.id]: names })),
      )
      .catch((reason) =>
        setBoundaryNote(reason.message || "Could not load the next boundary."),
      )
      .finally(() => setLoadingKey(""));
  };

  const roads = rows.find((item) => item.route);
  const points = useMemo(
    () =>
      rows
        .filter((item) => item.kind === "point")
        .sort(
          (a, b) =>
            rankOf(a.title) - rankOf(b.title) || a.title.localeCompare(b.title),
        ),
    [rows],
  );
  const lines = useMemo(
    () => rows.filter((item) => item.kind === "line" && !item.route),
    [rows],
  );
  const needle = query.trim().toLowerCase();
  const matches = (item) =>
    !needle ||
    item.title.toLowerCase().includes(needle) ||
    (item.groups || []).some((group) =>
      group.name.toLowerCase().includes(needle),
    );
  const shownRoads = scope !== "line" && roads && matches(roads);
  const shownPoints = scope === "line" ? [] : points.filter(matches);
  const shownLines = scope === "point" ? [] : lines.filter(matches);
  const place = active ? selected[active.id] : "";
  const boundary = active
    ? {
        id: active.id,
        name: selected[active.id],
        field: active.field,
        type: active.type,
        label: active.label,
      }
    : null;

  const pavementGroups = useMemo(() => {
    const scoped =
      typeGroups &&
      Object.prototype.hasOwnProperty.call(typeGroups, PAVEMENT_LAYER_ID)
        ? typeGroups[PAVEMENT_LAYER_ID]
        : null;
    if (scoped) return scoped;
    const row = rows.find((item) => item.id === PAVEMENT_LAYER_ID);
    return row?.groups || [];
  }, [typeGroups, rows]);
  const focusDef = useMemo(
    () =>
      lineFocus === "all"
        ? null
        : LINE_EVENT_DEFS.find((def) => String(def.id) === String(lineFocus)) ||
          null,
    [lineFocus],
  );
  const statsLayerId = useMemo(() => {
    if (focusDef && !focusDef.route) return focusDef.id;
    if (focusDef?.route) return focusDef.id;
    // Default analysis is pavement paved share per road.
    return PAVEMENT_LAYER_ID;
  }, [focusDef]);
  useEffect(() => {
    let dead = false;
    setRoadStatsLoading(true);
    setRoadStatsError("");
    loadLineEventRoadStats(statsLayerId, active?.id || "", place || "")
      .then((result) => {
        if (!dead) setRoadStats(result || []);
      })
      .catch((reason) => {
        if (!dead) {
          setRoadStats([]);
          setRoadStatsError(reason?.message || "Could not load road shares.");
        }
      })
      .finally(() => {
        if (!dead) setRoadStatsLoading(false);
      });
    return () => {
      dead = true;
    };
  }, [statsLayerId, active?.id, place]);
  // Everything on the picked road: point counts and each line event's segments.
  useEffect(() => {
    if (!roadKey) {
      setRoadProfile(null);
      setRoadProfileLoading(false);
      return undefined;
    }
    let dead = false;
    setRoadProfile(null);
    setRoadProfileLoading(true);
    loadRoadProfile(roadKey, active?.id || "", place || "")
      .then((result) => {
        if (!dead) setRoadProfile(result);
      })
      .catch(() => {
        if (!dead) setRoadProfile({ layers: {} });
      })
      .finally(() => {
        if (!dead) setRoadProfileLoading(false);
      });
    return () => {
      dead = true;
    };
  }, [roadKey, active?.id, place]);
  const shareLabel = useMemo(() => {
    if (typeValue) return String(typeValue);
    // Pavement headlines the paved share; other events show each road's dominant category.
    return statsLayerId === PAVEMENT_LAYER_ID ? "paved" : "";
  }, [typeValue, statsLayerId]);
  const categories = useMemo(() => {
    const { types, totalKm } = aggregateTypes(roadStats);
    return analysisTypeShares(types, totalKm, statsLayerId);
  }, [roadStats, statsLayerId]);
  const typeFilteredRoads = useMemo(() => {
    const typeNeedle = String(typeValue || "")
      .trim()
      .toLowerCase();
    if (!typeNeedle) return roadStats;
    // Keep only roads that carry the selected line-event type (e.g. paved).
    return roadStats.filter((road) => {
      const share = roadTypeShare(road, typeNeedle, statsLayerId);
      return share.matchSeg > 0 || share.matchKm > 0;
    });
  }, [roadStats, typeValue, statsLayerId]);
  const filteredRoadStats = useMemo(() => {
    const needle = String(roadKey || "")
      .trim()
      .toLowerCase();
    if (!needle) return typeFilteredRoads;
    return typeFilteredRoads.filter(
      (road) =>
        road.key.toLowerCase() === needle ||
        String(road.code || "").toLowerCase() === needle ||
        road.label.toLowerCase().includes(needle),
    );
  }, [typeFilteredRoads, roadKey]);
  const typeShares = useMemo(() => {
    // Aggregate type mix across filtered roads; pavement collapses to Paved/Unpaved.
    if (typeFilteredRoads.length) {
      const { types, totalKm } = aggregateTypes(typeFilteredRoads);
      const shares = analysisTypeShares(types, totalKm, statsLayerId);
      if (shares.length) return shares;
    }
    if (statsLayerId !== PAVEMENT_LAYER_ID) return [];
    const groups = pavementGroups || [];
    const total = groups.reduce(
      (sum, item) => sum + (Number.isFinite(item.km) ? item.km : 0),
      0,
    );
    return analysisTypeShares(groups, total, PAVEMENT_LAYER_ID);
  }, [typeFilteredRoads, pavementGroups, statsLayerId]);
  // Map badge: share of the chosen category (or paved / dominant) across all analysed roads.
  const headline = useMemo(() => {
    const focus =
      typeValue || (statsLayerId === PAVEMENT_LAYER_ID ? "paved" : "");
    const hit = focus
      ? categories.find((item) => sameName(item.name, focus))
      : categories[0];
    if (hit && Number.isFinite(hit.pct)) {
      return `${typeLabel(statsLayerId, hit.name)} ${hit.pct}%`;
    }
    if (statsLayerId === PAVEMENT_LAYER_ID && !typeValue) {
      const pct = pavedShare(pavementGroups);
      if (Number.isFinite(pct)) return `Paved ${pct}%`;
    }
    return "";
  }, [categories, typeValue, statsLayerId, pavementGroups]);
  const typeOptions = useMemo(() => {
    // Offer the categories the analysed roads actually carry.
    if (categories.length && (!focusDef || !focusDef.route)) {
      return categories.map((item) => ({
        value: String(item.name).trim().toLowerCase(),
        label: typeLabel(statsLayerId, item.name),
      }));
    }
    if (!focusDef) {
      return [
        { value: "paved", label: "Paved" },
        { value: "unpaved", label: "Unpaved" },
      ];
    }
    const scoped =
      typeGroups &&
      Object.prototype.hasOwnProperty.call(typeGroups, focusDef.id)
        ? typeGroups[focusDef.id]
        : null;
    const row = rows.find((item) => item.id === focusDef.id);
    return typeChoicesFor(focusDef.id, scoped || row?.groups || []);
  }, [focusDef, typeGroups, rows, categories, statsLayerId]);
  const roadLabel = useMemo(() => {
    if (!roadKey) return "";
    const hit =
      roadOptions.find((item) => item.key === roadKey) ||
      roadStats.find(
        (item) =>
          item.key === roadKey ||
          String(item.code || "").toLowerCase() ===
            String(roadKey).toLowerCase(),
      );
    return hit?.code || hit?.label || roadKey;
  }, [roadKey, roadOptions, roadStats]);
  const analysisLabel = useMemo(() => {
    const parts = [];
    if (focusDef) parts.push(focusDef.title);
    if (typeValue) parts.push(String(typeValue));
    return parts.join(" · ");
  }, [focusDef, typeValue]);

  const figure = (item) => {
    if (roadKey) {
      if (item.route) return 1;
      return roadProfile?.layers?.[item.id]?.count ?? null;
    }
    if (!active) return item.count;
    if (
      !areaCounts ||
      !Object.prototype.hasOwnProperty.call(areaCounts, item.id)
    )
      return null;
    return areaCounts[item.id];
  };

  const typesPending = Boolean(active) && typeGroups == null;
  const focusId = focusDef?.id ?? null;
  const chartLines =
    scope === "point"
      ? []
      : focusId != null
        ? rows.filter((item) => item.id === focusId && matches(item))
        : shownLines;
  const roadRow = rows.find((item) => item.route);
  const lineCards = chartLines.map((item) => {
    const count = figure(item);
    const missing = Boolean(active) && areaCounts && count == null;
    const roadGroups = roadKey ? roadProfile?.layers?.[item.id]?.groups : null;
    const scoped =
      typeGroups &&
      Object.prototype.hasOwnProperty.call(typeGroups, item.id) &&
      typeGroups[item.id] != null;
    // A picked road charts only that road's segments.
    const source = roadKey
      ? roadGroups || []
      : scoped
        ? typeGroups[item.id]
        : item.groups || [];
    const titleHit = !needle || item.title.toLowerCase().includes(needle);
    const typeNeedle = String(typeValue || "")
      .trim()
      .toLowerCase();
    const groups = source
      .filter((group) => {
        const name = String(group.name || "")
          .trim()
          .toLowerCase();
        if (typeNeedle && name !== typeNeedle) return false;
        return titleHit || name.includes(needle);
      })
      .map((group) => ({
        ...group,
        color: typeColor(item.id, group.name, item.swatch),
      }));
    return {
      item,
      count,
      missing,
      groups,
      national: Boolean(active) && !scoped,
    };
  });
  const analysisCards =
    focusId != null
      ? lineCards
      : [
          ...(roadRow && scope !== "point" && matches(roadRow)
            ? [
                {
                  item: roadRow,
                  groups: (
                    (typeGroups &&
                      Object.prototype.hasOwnProperty.call(
                        typeGroups,
                        roadRow.id,
                      ) &&
                      typeGroups[roadRow.id]) ||
                    roadRow.groups ||
                    []
                  ).map((group) => ({
                    ...group,
                    color: typeColor(roadRow.id, group.name, roadRow.swatch),
                  })),
                },
              ]
            : []),
          ...lineCards,
        ];

  return (
    <section className="overview">
      <header className="ov-head"></header>
      <div className="ov-toolbar">
        <label className="ov-filter ov-scope">
          <span>Show</span>
          <select
            value={scope}
            aria-label="Show assets"
            onChange={(event) => setScope(event.target.value)}
          >
            <option value="all">All</option>
            <option value="point">Point assets</option>
            <option value="line">Line events</option>
          </select>
        </label>
        <label className="ov-filter ov-line">
          <span>Line event</span>
          <select
            value={lineFocus}
            aria-label="Line event filter"
            onChange={(event) => {
              const next = event.target.value;
              setLineFocus(next);
              setTypeValue("");
              if (next !== "all") setScope("line");
            }}
          >
            <option value="all">All line events</option>
            {LINE_EVENT_DEFS.map((def) => (
              <option key={def.id} value={String(def.id)}>
                {def.route ? "" : def.title}
              </option>
            ))}
          </select>
        </label>
        <label className="ov-filter ov-scope">
          <span>Type</span>
          <select
            value={typeValue}
            aria-label="Line event type filter"
            onChange={(event) => setTypeValue(event.target.value)}
          >
            <option value="">All types</option>
            {typeOptions.map((option) => (
              <option key={option.value} value={option.value}>
                {option.label}
              </option>
            ))}
          </select>
        </label>
        <label className="ov-filter ov-search">
          <span>Search</span>
          <input
            value={query}
            placeholder="Search assets…"
            onChange={(event) => onQuery?.(event.target.value)}
          />
        </label>
        <RoadPicker
          options={roadOptions}
          query={roadQuery}
          selectedKey={roadKey}
          onQuery={(value) => {
            setRoadQuery(value);
            if (!value.trim()) setRoadKey("");
          }}
          onPick={(item) => {
            setRoadKey(item.key);
            setRoadQuery(item.label);
            setRoadZoomNonce((value) => value + 1);
          }}
          onClear={() => {
            setRoadKey("");
            setRoadQuery("");
          }}
        />
        {levels.map((level, index) => {
          const previous = levels[index - 1];
          const enabled =
            index === 0 || Boolean(previous && selected[previous.id]);
          return (
            <label
              key={level.id}
              className={`ov-filter ov-bound${enabled ? "" : " is-off"}`}
            >
              <span>{level.label}</span>
              <select
                value={selected[level.id] || ""}
                disabled={!enabled}
                onChange={(event) => choose(index, event.target.value)}
              >
                <option value="">
                  {loadingKey === level.id
                    ? "Loading…"
                    : `All ${plural(level.label)}`}
                </option>
                {(choices[level.id] || []).map((name) => (
                  <option key={name} value={name}>
                    {name}
                  </option>
                ))}
              </select>
            </label>
          );
        })}
      </div>
      <div className="ov-board">
        {(shownRoads || shownPoints.length > 0) && (
          <section className="ov-points">
            <h3>
              Point assets{place ? ` · ${place}` : ""}
              {roadKey ? ` · ${roadLabel || roadKey}` : ""}
            </h3>
            <div className="ov-small">
              {shownRoads && (
                <CountCard
                  item={{ ...roads, title: "Roads", swatch: roads.swatch }}
                  count={
                    figure(roads) == null && active && !roadKey
                      ? roads.count
                      : figure(roads)
                  }
                  loading={
                    loading || (!roadKey && areaLoading && Boolean(active))
                  }
                />
              )}
              {shownPoints.map((item) => {
                const count = figure(item);
                const missing =
                  !roadKey && Boolean(active) && areaCounts && count == null;
                const onRoad = roadKey ? roadProfile?.layers?.[item.id] : null;
                return (
                  <CountCard
                    key={item.id}
                    item={item}
                    count={missing ? item.count : count}
                    loading={
                      loading ||
                      (roadKey
                        ? roadProfileLoading
                        : areaLoading && Boolean(active))
                    }
                    note={
                      onRoad?.by === "near"
                        ? `Within ${SNAP_METERS} m of ${roadLabel || roadKey} (layer has no road column)`
                        : onRoad && onRoad.count == null
                          ? "This layer cannot be matched to a road"
                          : ""
                    }
                  />
                );
              })}
            </div>
          </section>
        )}
        <div className="ov-main">
          <section className="ov-map-section">
            <h3>Asset map{place ? ` · ${place}` : ""}</h3>
            <OverviewMap
              scope={scope}
              query={query}
              rows={rows}
              boundary={boundary}
              muted={muted}
              lineFocus={lineFocus}
              typeValue={typeValue}
              roadKey={roadKey}
              roadZoomNonce={roadZoomNonce}
              roadIds={roadProfile?.ids || EMPTY_IDS}
              typeRoadKeys={
                typeValue
                  ? typeFilteredRoads.map((road) => road.code || road.key)
                  : []
              }
              analysisLabel={analysisLabel}
              headline={headline}
              onToggle={(id) =>
                setMuted((current) =>
                  current.includes(id)
                    ? current.filter((item) => item !== id)
                    : [...current, id],
                )
              }
            />
          </section>
          <section className="ov-lines">
            <h3>
              Length by type (km)
              {place ? ` · ${place}` : ""}
              {roadKey ? ` · ${roadLabel || roadKey}` : ""}
            </h3>
            <AnalysisBox
              roadKey={roadKey}
              roadLabel={roadLabel}
              typeShares={typeShares}
              categories={categories}
              lineFocusLabel={
                focusDef?.route
                  ? "Roads (network)"
                  : LINE_EVENT_DEFS.find((def) => def.id === statsLayerId)
                      ?.title || ""
              }
              onLayer={(id) => {
                setLineFocus(String(id));
                setTypeValue("");
              }}
              onType={setTypeValue}
              typeValue={typeValue}
              shareLabel={shareLabel}
              layerId={statsLayerId}
              roads={typeFilteredRoads}
              loading={roadStatsLoading}
              error={roadStatsError}
              place={place}
              onSelectRoad={(road) => {
                const key = road.code || road.key;
                setRoadKey(key);
                setRoadQuery(road.code || road.label || key);
                setRoadZoomNonce((value) => value + 1);
              }}
            />
            {roadKey ? (
              <section className="ov-strips" aria-label="Line events along the road">
                <h4>
                  Segments along {roadLabel || roadKey}
                  {roadProfileLoading ? " · loading…" : ""}
                </h4>
                {(focusDef && !focusDef.route
                  ? ANALYSIS_DEFS.filter((def) => def.id === focusDef.id)
                  : ANALYSIS_DEFS
                ).map((def) => (
                  <SegmentStrip
                    key={def.id}
                    def={def}
                    layer={roadProfile ? roadProfile.layers?.[def.id] || { segments: [] } : null}
                    typeValue={def.id === statsLayerId ? typeValue : ""}
                  />
                ))}
              </section>
            ) : null}
            <div className="ov-charts">
              {(analysisCards.length
                ? analysisCards
                : PLACEHOLDER_ROWS.filter(
                    (item) => item.kind === "line" && !item.route,
                  ).map((item) => ({
                    item,
                    groups: [],
                    national: false,
                  }))
              ).map(({ item, groups }) => (
                <LengthChart
                  key={item.id}
                  title={item.route ? "Roads" : item.title}
                  mark={item}
                  items={groups}
                  loading={loading || typesPending}
                />
              ))}
            </div>
          </section>
        </div>
        {!loading &&
          !shownRoads &&
          shownPoints.length === 0 &&
          shownLines.length === 0 && (
            <p className="ov-empty">Nothing matches that filter.</p>
          )}
      </div>
      {/* {(loading || areaLoading) && (
        <div className="ov-loader" role="status" aria-live="polite">
          <div className="ov-loader-card">
            <span className="ov-spinner" aria-hidden="true" />
            <p>{areaLoading ? `Loading ${place || "area"}…` : "Loading overview data…"}</p>
            <span>
              {error
                ? "Some layers are still catching up."
                : "Cards, map, and graphs stay visible while counts load."}
            </span>
          </div>
        </div>
      )} */}
    </section>
  );
}
