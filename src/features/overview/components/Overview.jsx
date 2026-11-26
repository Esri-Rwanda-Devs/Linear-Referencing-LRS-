import { useEffect, useMemo, useRef, useState } from "react";
import { assetIcons } from "../../../assets";
import {
  DRAINAGE_FIELDS,
  LRS_LAYER_DEFS,
  OVERVIEW_DEFAULT_POINTS,
  PAVEMENT_FIELDS,
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

const EMPTY_SEGMENT = { layerId: null, objectId: null, nonce: 0 };
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

function analysisTypeShares(types, totalKm, layerId, opts = {}) {
  const collapse =
    opts.collapsePavement !== false &&
    Number(layerId) === PAVEMENT_LAYER_ID &&
    (!opts.pavementField || opts.pavementField === "category");
  const source = collapse ? collapsePavementTypes(types) : types;
  const typeSum = (source || []).reduce(
    (sum, item) => sum + (Number(item.km) || 0),
    0,
  );
  // Drainage LHS+RHS doubles km; use type sum so shares stay at 100%.
  const total =
    Number(layerId) === 6 && typeSum > 0
      ? typeSum
      : Number.isFinite(totalKm) && totalKm > 0
        ? totalKm
        : typeSum;
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
  "KM Stones",
  "Bridges",
  "Culverts",
  "Cameras",
  "Accidents",
  "Point Assets",
  "Traffic Station",
  "LV Supports",
  "MV Supports",
  "Transformers",
];

/** Point layers that stay off unless the user turns them on. */
const DEFAULT_POINT_MUTED = LRS_LAYER_DEFS.filter(
  (def) => def.kind === "point" && !OVERVIEW_DEFAULT_POINTS.includes(def.id),
).map((def) => def.id);

/** Mute every layer except the active analysis line event (pavement-first). */
function mutedExcept(focusId) {
  if (
    focusId == null ||
    focusId === "all" ||
    !Number.isFinite(Number(focusId))
  ) {
    return DEFAULT_POINT_MUTED;
  }
  const keep = Number(focusId);
  return LRS_LAYER_DEFS.filter((def) => def.id !== keep).map((def) => def.id);
}

const DEFAULT_MUTED = mutedExcept(PAVEMENT_LAYER_ID);

const LINE_ORDER = [10, 3, 14, 6]; // Pavement, Carriageway, Speed, Drainage
const ANALYSIS_ORDERED = [...ANALYSIS_DEFS].sort(
  (a, b) => LINE_ORDER.indexOf(a.id) + 99 - (LINE_ORDER.indexOf(b.id) + 99),
);

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

function typeColor(layerId, name, fallback, dim = "") {
  const side = String(name || "").match(/^(lhs|rhs)\s*[·:.-]\s*(.+)$/i);
  const label = side ? side[2] : name;
  const key = String(label || "")
    .toLowerCase()
    .replace(/[_-]+/g, " ")
    .replace(/\s+/g, " ")
    .trim();
  let colors = VALUE_COLORS[layerId]?.colors || {};
  if (Number(layerId) === PAVEMENT_LAYER_ID && dim && PAVEMENT_FIELDS[dim]) {
    colors = PAVEMENT_FIELDS[dim].colors || colors;
  }
  if (Number(layerId) === 6 && dim && DRAINAGE_FIELDS[dim]) {
    colors = DRAINAGE_FIELDS[dim].colors || colors;
  }
  if (colors[key]) return colors[key];
  if (Number(layerId) === 3) {
    if (/four/.test(key)) return colors["four lane divided"] || fallback;
    if (/two/.test(key)) return colors["two lane"] || fallback;
    if (/intermediate/.test(key))
      return colors["intermediate lane"] || fallback;
  }
  if (
    Number(layerId) === PAVEMENT_LAYER_ID &&
    /pci|poor|fair|good|excellent/i.test(key)
  ) {
    const pci = PAVEMENT_FIELDS.pci.colors;
    if (/very\s*poor/.test(key)) return pci["very poor"];
    if (/\bpoor\b/.test(key)) return pci.poor;
    if (/\bfair\b/.test(key)) return pci.fair;
    if (/\bgood\b/.test(key)) return pci.good;
    if (/\bexcellent\b/.test(key)) return pci.excellent;
  }
  return fallback || "#94a3b8";
}

function pavedBandOf(pct) {
  if (!(Number.isFinite(pct) && pct > 0)) return "Unpaved";
  if (pct > 90) return "Fully paved";
  return "Partially paved";
}

function roadsToPavedBands(roads) {
  return (roads || []).map((road) => {
    const share = roadTypeShare(road, "paved", PAVEMENT_LAYER_ID, {
      collapsePavement: true,
      pavementField: "category",
    });
    const pct = Number.isFinite(share.pct) ? share.pct : 0;
    return {
      ...road,
      // Keep paved/unpaved byType for bars; band is only for filter/group.
      pavedPct: pct,
      unpavedPct: Math.max(0, 100 - pct),
      pavedBand: pavedBandOf(pct),
    };
  });
}

/** Share of roads (by km) in each paved band. */
function bandTypeShares(roads) {
  const buckets = {
    Unpaved: { name: "Unpaved", km: 0, count: 0 },
    "Partially paved": { name: "Partially paved", km: 0, count: 0 },
    "Fully paved": { name: "Fully paved", km: 0, count: 0 },
  };
  (roads || []).forEach((road) => {
    const band = road.pavedBand || pavedBandOf(road.pavedPct);
    const entry = buckets[band] || buckets.Unpaved;
    entry.km += Number(road.totalKm) || 0;
    entry.count += 1;
  });
  const list = Object.values(buckets).filter(
    (item) => item.km > 0 || item.count > 0,
  );
  const total = list.reduce((sum, item) => sum + item.km, 0);
  return complementTypeShares(list, total).map((item) => ({
    ...item,
    roads: Number(item.count) || 0,
  }));
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

/** Clickable vertical bar chart: filter roads by category and show them on the map. */
function CountFilterBars({
  items,
  layerId,
  dim = "",
  selected = "",
  onSelect,
  metric = "count",
}) {
  const rows = (items || []).filter(
    (item) =>
      Number(item.count) > 0 || Number(item.roads) > 0 || Number(item.km) > 0,
  );
  if (!rows.length) return null;
  const valueOf = (item) =>
    metric === "roads"
      ? Number(item.roads) || 0
      : Number(item.count) || Number(item.roads) || 0;
  const max = Math.max(1, ...rows.map(valueOf));
  const step = niceStep(max);
  const top = Math.max(step, Math.ceil(max / step) * step);
  const ticks = [];
  for (let value = top; value >= 0; value -= step) ticks.push(value);
  const unit = metric === "roads" ? "roads" : "seg";
  return (
    <div className="ov-count-bars" role="group" aria-label="Filter by value">
      <div className="ov-count-bars-head">
        {selected ? (
          <button
            type="button"
            className="ov-count-clear"
            onClick={() => onSelect?.("")}
          >
            Clear
          </button>
        ) : null}
      </div>
      <div
        className="ov-count-chart"
        style={{ "--ov-ticks": Math.max(1, ticks.length - 1) }}
      >
        <div className="ov-count-axis" aria-hidden="true">
          {ticks.map((value) => (
            <span key={value}>{numberText(value)}</span>
          ))}
        </div>
        <div className="ov-count-plot">
          {rows.map((item) => {
            const on = sameName(selected, item.name);
            const value = valueOf(item);
            const roads = Number(item.roads);
            const color = typeColor(layerId, item.name, "#94a3b8", dim);
            const label = typeLabel(layerId, item.name);
            return (
              <button
                key={item.name}
                type="button"
                className={`ov-count-col${on ? " on" : ""}`}
                style={{
                  "--ov-bar": `${Math.max(6, (value / top) * 100)}%`,
                  "--ov-bar-color": color,
                }}
                aria-pressed={on}
                title={`${label} · ${numberText(value)} ${unit}${
                  Number.isFinite(item.km) ? ` · ${kmText(item.km)} km` : ""
                }${
                  Number.isFinite(roads) && metric !== "roads"
                    ? ` · ${numberText(roads)} roads`
                    : ""
                }${Number.isFinite(item.pct) ? ` · ${item.pct}%` : ""}`}
                onClick={() =>
                  onSelect?.(on ? "" : String(item.name).trim().toLowerCase())
                }
              >
                <b>{numberText(value)}</b>
                <i aria-hidden="true" />
                <span>{label}</span>
              </button>
            );
          })}
        </div>
      </div>
    </div>
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

function roadHasType(road, typeNeedle) {
  const needle = String(typeNeedle || "")
    .trim()
    .toLowerCase();
  if (!needle) return false;
  return Object.values(road?.byType || {}).some((item) => {
    const name = String(item.name || "")
      .trim()
      .toLowerCase();
    if (name !== needle) return false;
    return Number(item.count) > 0 || Number(item.km) > 0;
  });
}

function roadTypeShare(road, typeNeedle, layerId, opts = {}) {
  const totalKm = Number(road?.totalKm) || 0;
  const rawTypes = Object.values(road?.byType || {});
  const types = analysisTypeShares(rawTypes, totalKm, layerId, opts);
  const needle = String(typeNeedle || "")
    .trim()
    .toLowerCase();
  // Prefer share rows; fall back to raw byType so speed/etc. still count roads
  // even when totalKm is missing.
  let match = null;
  if (needle) {
    match =
      types.find(
        (item) =>
          String(item.name || "")
            .trim()
            .toLowerCase() === needle,
      ) ||
      rawTypes.find(
        (item) =>
          String(item.name || "")
            .trim()
            .toLowerCase() === needle,
      );
  } else if (types.length || rawTypes.length) {
    const pool = types.length ? types : rawTypes;
    match =
      pool.find(
        (item) =>
          String(item.name || "")
            .trim()
            .toLowerCase() === "paved",
      ) || [...pool].sort((a, b) => (b.km || 0) - (a.km || 0))[0];
  }
  if (!match) {
    return { pct: null, label: "", matchKm: 0, matchSeg: 0 };
  }
  const matchKm = Number(match?.km) || 0;
  const matchSeg = Number(match?.count) || 0;
  return {
    pct: totalKm > 0 ? sharePct(matchKm, totalKm) : null,
    label: match?.name || "",
    matchKm,
    matchSeg,
  };
}

function RoadTypeBar({ road, layerId, shareLabel, dim = "" }) {
  const totalKm = Number(road?.totalKm) || 0;
  const types = analysisTypeShares(
    Object.values(road?.byType || {}),
    totalKm,
    layerId,
    { pavementField: dim, collapsePavement: dim === "category" || !dim },
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
                background: typeColor(layerId, item.name, "#94a3b8", dim),
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
                  background: typeColor(layerId, item.name, "#94a3b8", dim),
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
  pavementField = "category",
  drainageMode = "type",
  roads,
  loading,
  error,
  place,
  onSelectRoad,
  onLayer,
  onType,
  onPavementField,
  onDrainageMode,
}) {
  const dim =
    Number(layerId) === PAVEMENT_LAYER_ID
      ? pavementField
      : Number(layerId) === 6
        ? drainageMode
        : "";
  const bandMode = dim === "paved_band";
  // Paved-band rows still chart paved/unpaved km; chips filter by band.
  const shareOpts = {
    pavementField: bandMode ? "category" : dim,
    collapsePavement: bandMode || dim === "category" || !dim,
  };
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
        <span>{focusNote || "National"}</span>
      </header>
      <div className="ov-analysis-tabs" role="tablist" aria-label="Line event">
        {ANALYSIS_ORDERED.map((def) => (
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
      {Number(layerId) === PAVEMENT_LAYER_ID ? (
        <div className="ov-analysis-chips" aria-label="Pavement field">
          {Object.entries(PAVEMENT_FIELDS).map(([key, spec]) => (
            <button
              key={key}
              type="button"
              className={pavementField === key ? "on" : ""}
              onClick={() => onPavementField?.(key)}
            >
              {spec.label}
            </button>
          ))}
        </div>
      ) : null}
      {Number(layerId) === 6 ? (
        <div className="ov-analysis-chips" aria-label="Drainage field">
          {Object.entries(DRAINAGE_FIELDS).map(([key, spec]) => (
            <button
              key={key}
              type="button"
              className={drainageMode === key ? "on" : ""}
              onClick={() => onDrainageMode?.(key)}
            >
              {spec.label}
            </button>
          ))}
          <span className="ov-analysis-note">LHS + RHS</span>
        </div>
      ) : null}
      {(categories || []).length > 0 ? (
        <CountFilterBars
          items={categories}
          layerId={layerId}
          dim={dim}
          selected={typeValue}
          onSelect={onType}
          metric="roads"
        />
      ) : null}
      <div className="ov-analysis-kpis">
        <div>
          <span>Share</span>
          <b title={shareSummary}>{shareSummary}</b>
        </div>
        <div>
          <span>Route</span>
          <b title={selectedCode || "All"}>{selectedCode || "All"}</b>
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
                background: typeColor(layerId, item.name, "#94a3b8", dim),
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
              {bandMode && Number.isFinite(selected.pavedPct)
                ? `${selected.pavedBand || ""} · Paved ${selected.pavedPct}% · Unpaved ${selected.unpavedPct ?? 100 - selected.pavedPct}% · `
                : ""}
              {kmText(selected.totalKm)} km · {numberText(selected.segments)}{" "}
              seg
              {Number(layerId) === 14 && selected.avgSpeed != null
                ? ` · avg ${selected.avgSpeed} km/h`
                : ""}
              {selected.name ? ` · ${selected.name}` : ""}
            </span>
          </header>
          <RoadTypeBar
            road={selected}
            layerId={layerId}
            shareLabel={bandMode ? "paved" : typeValue || shareLabel}
            dim={bandMode ? "category" : dim}
          />
        </button>
      ) : null}
      <ul className="ov-analysis-list">
        {loading && <li className="ov-analysis-empty">Loading…</li>}
        {!loading &&
          capped.map((road) => {
            const parts = analysisTypeShares(
              Object.values(road.byType || {}),
              road.totalKm,
              layerId,
              shareOpts,
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
            const pavedPct = Number.isFinite(road.pavedPct)
              ? road.pavedPct
              : null;
            const unpavedPct = Number.isFinite(road.unpavedPct)
              ? road.unpavedPct
              : pavedPct != null
                ? Math.max(0, 100 - pavedPct)
                : null;
            const pairText = bandMode
              ? [
                  road.pavedBand || null,
                  pavedPct != null ? `Paved ${pavedPct}%` : null,
                  unpavedPct != null ? `Unpaved ${unpavedPct}%` : null,
                ]
                  .filter(Boolean)
                  .join(" · ")
              : parts
                  .map(
                    (item) => `${typeLabel(layerId, item.name)} ${item.pct}%`,
                  )
                  .join(" · ");
            const speedNote =
              Number(layerId) === 14 && road.avgSpeed != null
                ? ` · avg ${road.avgSpeed} km/h`
                : "";
            const headLabel = bandMode
              ? pavedPct != null
                ? `Paved ${pavedPct}%`
                : road.pavedBand || "—"
              : Number(layerId) === 14 && road.avgSpeed != null
                ? `Avg ${road.avgSpeed} km/h`
                : focusPart
                  ? `${typeLabel(layerId, focusPart.name)} ${focusPart.pct}%`
                  : "—";
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
                    <b>{headLabel}</b>
                  </div>
                  <RoadTypeBar
                    road={road}
                    layerId={layerId}
                    shareLabel={bandMode ? "paved" : typeValue || shareLabel}
                    dim={bandMode ? "category" : dim}
                  />
                  <span>
                    {pairText}
                    {` · ${kmText(road.totalKm)} km · ${numberText(road.segments)} seg`}
                    {speedNote}
                  </span>
                </button>
              </li>
            );
          })}
        {!loading && !selected && listed.length > capped.length ? (
          <li className="ov-analysis-empty">
            Top {capped.length} of {listed.length} — pick a route code.
          </li>
        ) : null}
        {!loading && !listed.length && (
          <li className="ov-analysis-empty">{error || "No roads match."}</li>
        )}
      </ul>
    </aside>
  );
}

const kmAt = (value) => (Number.isFinite(value) ? value.toFixed(2) : "—");

/** One line event along the picked road: segments placed by from/to measure, coloured by category. */
function SegmentStrip({
  def,
  layer,
  typeValue,
  pavementField = "category",
  drainageMode = "type",
  onZoomSegment,
  activeSegment,
}) {
  const segments = layer?.segments || [];
  const focus = String(typeValue || "")
    .trim()
    .toLowerCase();
  const isPavement = Number(def.id) === PAVEMENT_LAYER_ID;
  const dim = isPavement
    ? pavementField === "paved_band"
      ? "category"
      : pavementField
    : Number(def.id) === 6
      ? drainageMode
      : "";
  // Only collapse to paved/unpaved for Category (and paved-band display).
  const collapse =
    isPavement && (pavementField === "category" || pavementField === "paved_band");
  const colorOf = (type) =>
    typeColor(
      def.id,
      collapse && !isPavedName(type) ? "unpaved" : type,
      def.swatch,
      dim,
    );
  const matches = (type) => {
    if (!focus) return true;
    if (sameName(type, focus)) return true;
    if (collapse && focus === "paved") return isPavedName(type);
    if (collapse && focus === "unpaved") return !isPavedName(type);
    // PCI status may be stored as "Fair(25-50)" while the chart uses "Fair".
    const raw = String(type || "")
      .trim()
      .toLowerCase();
    const status = raw.includes("(") ? raw.slice(0, raw.indexOf("(")).trim() : raw;
    return status === focus || raw.startsWith(`${focus}(`) || raw.startsWith(`${focus} `);
  };
  const visible = focus
    ? segments.filter((item) => matches(item.type))
    : segments;
  const groupSource = focus
    ? Object.values(
        visible.reduce((map, segment) => {
          const name = segment.type || "No data";
          const entry = map[name] || { name, count: 0, km: 0 };
          entry.count += 1;
          entry.km += Number(segment.km) || 0;
          map[name] = entry;
          return map;
        }, {}),
      )
    : layer?.groups || [];
  const groups = analysisTypeShares(
    groupSource,
    groupSource.reduce((sum, item) => sum + (Number(item.km) || 0), 0),
    def.id,
    {
      pavementField: isPavement ? dim : "",
      collapsePavement: collapse,
    },
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
  return (
    <article className="ov-strip">
      <header>
        <span>
          <i style={{ background: def.swatch }} />
          {def.title}
          {focus ? ` · ${typeLabel(def.id, typeValue)}` : ""}
        </span>
        <b>
          {layer == null
            ? "…"
            : layer.error
              ? "Unavailable"
              : focus
                ? `${numberText(visible.length)} / ${numberText(segments.length)} seg`
                : `${numberText(segments.length)} seg`}
        </b>
      </header>
      {layer?.error ? <p className="ov-strip-note">{layer.error}</p> : null}
      {layer && !layer.error && !segments.length ? (
        <p className="ov-strip-note">
          No {def.title.toLowerCase()} segments on this road.
        </p>
      ) : null}
      {rows.map((row) => (
        <div className="ov-strip-row" key={row.route || "road"}>
          {rows.length > 1 ? <em>{row.route || "—"}</em> : null}
          <div className="ov-strip-track">
            {row.items.map((item, index) => {
              const active =
                activeSegment?.layerId === def.id &&
                activeSegment?.objectId != null &&
                Number(activeSegment.objectId) === Number(item.objectId);
              return (
                <button
                  key={`${item.from}-${index}`}
                  type="button"
                  className={`ov-strip-seg${matches(item.type) ? "" : " dim"}${active ? " on" : ""}`}
                  style={{
                    left: `${((item.from - row.start) / row.span) * 100}%`,
                    width: `${Math.max(((item.to - item.from) / row.span) * 100, 0.4)}%`,
                    background: colorOf(item.type),
                  }}
                  title={`${typeLabel(def.id, item.type)} · km ${kmAt(item.from)}–${kmAt(item.to)} · ${kmText(item.km)} km — click to zoom`}
                  disabled={!item.objectId}
                  onClick={() =>
                    item.objectId &&
                    onZoomSegment?.({
                      layerId: def.id,
                      objectId: item.objectId,
                      label: typeLabel(def.id, item.type),
                    })
                  }
                />
              );
            })}
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
            <li
              key={item.name}
              className={matches(item.name) && focus ? "on" : ""}
            >
              <i
                style={{
                  background: typeColor(def.id, item.name, def.swatch, dim),
                }}
              />
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
        <details className="ov-strip-list" open={Boolean(focus)}>
          <summary>
            Segments ({focus ? visible.length : segments.length}
            {focus ? ` matching` : ""})
          </summary>
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
                  .map((item, index) => {
                    const active =
                      activeSegment?.layerId === def.id &&
                      activeSegment?.objectId != null &&
                      Number(activeSegment.objectId) === Number(item.objectId);
                    return (
                      <tr
                        key={`${row.route}-${item.from}-${index}`}
                        className={`ov-strip-row-click${active ? " on" : ""}${item.objectId ? "" : " off"}`}
                        title={
                          item.objectId
                            ? "Click to zoom to this segment on the map"
                            : "Segment geometry unavailable"
                        }
                        onClick={() =>
                          item.objectId &&
                          onZoomSegment?.({
                            layerId: def.id,
                            objectId: item.objectId,
                            label: typeLabel(def.id, item.type),
                          })
                        }
                      >
                        {rows.length > 1 ? <td>{row.route}</td> : null}
                        <td>{kmAt(item.from)}</td>
                        <td>{kmAt(item.to)}</td>
                        <td>{kmText(item.km)} km</td>
                        <td>
                          <i style={{ background: colorOf(item.type) }} />
                          {typeLabel(def.id, item.type)}
                        </td>
                      </tr>
                    );
                  }),
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
      if (rect)
        setPlace({ top: rect.bottom + 4, left: rect.left, width: rect.width });
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
            style={
              place
                ? { top: place.top, left: place.left, width: place.width }
                : undefined
            }
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
  const [muted, setMuted] = useState(DEFAULT_MUTED);
  const [lineFocus, setLineFocus] = useState(String(PAVEMENT_LAYER_ID));
  const [typeValue, setTypeValue] = useState("");
  const [pavementField, setPavementField] = useState("category");
  const [drainageMode, setDrainageMode] = useState("type");
  const [roadKey, setRoadKey] = useState("");
  const [roadZoomNonce, setRoadZoomNonce] = useState(0);
  const [roadFromAnalysis, setRoadFromAnalysis] = useState(false);
  const [segmentFocus, setSegmentFocus] = useState(EMPTY_SEGMENT);
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
    () =>
      rows
        .filter((item) => item.kind === "line" && !item.route)
        .sort(
          (a, b) =>
            LINE_ORDER.indexOf(a.id) + 99 - (LINE_ORDER.indexOf(b.id) + 99),
        ),
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
    const valueField =
      statsLayerId === PAVEMENT_LAYER_ID && pavementField !== "paved_band"
        ? PAVEMENT_FIELDS[pavementField]?.field || "pavement_category"
        : statsLayerId === PAVEMENT_LAYER_ID
          ? "pavement_category"
          : "";
    const options = {};
    if (valueField) options.valueField = valueField;
    if (statsLayerId === 6) options.drainageMode = drainageMode;
    loadLineEventRoadStats(statsLayerId, active?.id || "", place || "", options)
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
  }, [statsLayerId, active?.id, place, pavementField, drainageMode]);
  // Everything on the picked road: point counts and each line event's segments.
  useEffect(() => {
    setSegmentFocus(EMPTY_SEGMENT);
    if (!roadKey) {
      setRoadProfile(null);
      setRoadProfileLoading(false);
      return undefined;
    }
    let dead = false;
    setRoadProfile(null);
    setRoadProfileLoading(true);
    loadRoadProfile(roadKey, active?.id || "", place || "", {
      pavementField,
      drainageMode,
    })
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
  }, [roadKey, active?.id, place, pavementField, drainageMode]);
  const analysisDim =
    statsLayerId === PAVEMENT_LAYER_ID
      ? pavementField
      : statsLayerId === 6
        ? drainageMode
        : "";
  const shareOpts = useMemo(
    () => ({
      pavementField: analysisDim,
      collapsePavement:
        analysisDim === "category" ||
        (statsLayerId === PAVEMENT_LAYER_ID && !analysisDim),
    }),
    [analysisDim, statsLayerId],
  );
  const analysisRoads = useMemo(() => {
    if (statsLayerId === PAVEMENT_LAYER_ID && pavementField === "paved_band") {
      return roadsToPavedBands(roadStats);
    }
    return roadStats;
  }, [roadStats, statsLayerId, pavementField]);
  const shareLabel = useMemo(() => {
    if (typeValue) return String(typeValue);
    if (statsLayerId === PAVEMENT_LAYER_ID && pavementField === "category")
      return "paved";
    if (statsLayerId === PAVEMENT_LAYER_ID && pavementField === "paved_band")
      return "";
    return "";
  }, [typeValue, statsLayerId, pavementField]);
  const categories = useMemo(() => {
    if (statsLayerId === PAVEMENT_LAYER_ID && pavementField === "paved_band") {
      return bandTypeShares(analysisRoads);
    }
    const { types, totalKm } = aggregateTypes(analysisRoads);
    const shares = analysisTypeShares(types, totalKm, statsLayerId, shareOpts);
    // How many roads carry each category (for the count bars / map filter).
    return shares.map((item) => {
      const needle = String(item.name || "")
        .trim()
        .toLowerCase();
      const roads = analysisRoads.filter((road) => {
        if (
          statsLayerId === PAVEMENT_LAYER_ID &&
          pavementField === "paved_band"
        ) {
          return (
            String(road.pavedBand || "")
              .trim()
              .toLowerCase() === needle
          );
        }
        if (roadHasType(road, needle)) return true;
        const share = roadTypeShare(road, needle, statsLayerId, shareOpts);
        return share.matchSeg > 0 || share.matchKm > 0;
      }).length;
      return { ...item, roads };
    });
  }, [analysisRoads, statsLayerId, shareOpts, pavementField]);
  const typeFilteredRoads = useMemo(() => {
    const typeNeedle = String(typeValue || "")
      .trim()
      .toLowerCase();
    if (!typeNeedle) return analysisRoads;
    if (statsLayerId === PAVEMENT_LAYER_ID && pavementField === "paved_band") {
      return analysisRoads.filter(
        (road) =>
          String(road.pavedBand || "")
            .trim()
            .toLowerCase() === typeNeedle,
      );
    }
    return analysisRoads.filter((road) => {
      if (roadHasType(road, typeNeedle)) return true;
      const share = roadTypeShare(road, typeNeedle, statsLayerId, shareOpts);
      return share.matchSeg > 0 || share.matchKm > 0;
    });
  }, [analysisRoads, typeValue, statsLayerId, shareOpts, pavementField]);
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
    // When a road is picked, share/KPI follow that road's distribution.
    const sourceRoads = roadKey ? filteredRoadStats : typeFilteredRoads;
    if (statsLayerId === PAVEMENT_LAYER_ID && pavementField === "paved_band") {
      return bandTypeShares(sourceRoads);
    }
    if (sourceRoads.length) {
      const { types, totalKm } = aggregateTypes(sourceRoads);
      const shares = analysisTypeShares(
        types,
        totalKm,
        statsLayerId,
        shareOpts,
      );
      if (shares.length) return shares;
    }
    if (statsLayerId !== PAVEMENT_LAYER_ID || pavementField !== "category")
      return [];
    const groups = pavementGroups || [];
    const total = groups.reduce(
      (sum, item) => sum + (Number.isFinite(item.km) ? item.km : 0),
      0,
    );
    return analysisTypeShares(groups, total, PAVEMENT_LAYER_ID, {
      collapsePavement: true,
      pavementField: "category",
    });
  }, [
    typeFilteredRoads,
    filteredRoadStats,
    roadKey,
    pavementGroups,
    statsLayerId,
    pavementField,
    shareOpts,
  ]);
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
  // Same colours as the analysis chart → unique-value renderer on the map.
  const chartColors = useMemo(
    () =>
      Object.fromEntries(
        (categories || []).map((item) => [
          String(item.name || "")
            .trim()
            .toLowerCase()
            .replace(/[_-]+/g, " ")
            .replace(/\s+/g, " "),
          typeColor(statsLayerId, item.name, "#94a3b8", analysisDim),
        ]),
      ),
    [categories, statsLayerId, analysisDim],
  );
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
              setMuted(mutedExcept(next));
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
        <RoadPicker
          options={roadOptions}
          query={roadQuery}
          selectedKey={roadKey}
          onQuery={(value) => {
            setRoadQuery(value);
            if (!value.trim()) {
              setRoadKey("");
              setRoadFromAnalysis(false);
            }
          }}
          onPick={(item) => {
            setRoadKey(item.key);
            setRoadQuery(item.label);
            setRoadFromAnalysis(false);
            setRoadZoomNonce((value) => value + 1);
            const networkId = LRS_LAYER_DEFS.find((def) => def.route)?.id;
            if (networkId != null) {
              setMuted((current) =>
                current.includes(networkId) ? current : [...current, networkId],
              );
            }
          }}
          onClear={() => {
            setRoadKey("");
            setRoadQuery("");
            setRoadFromAnalysis(false);
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
              segmentFocus={segmentFocus}
              roadIds={roadProfile?.ids || EMPTY_IDS}
              typeRoadKeys={
                typeValue
                  ? [
                      ...new Set(
                        typeFilteredRoads
                          .flatMap((road) => [road.code, road.key, road.label])
                          .map((item) => String(item || "").trim())
                          .filter(Boolean),
                      ),
                    ]
                  : []
              }
              chartColors={chartColors}
              analysisLabel={analysisLabel}
              headline={headline}
              pavementField={pavementField}
              drainageMode={drainageMode}
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
                  ? "Roads"
                  : LINE_EVENT_DEFS.find((def) => def.id === statsLayerId)
                      ?.title || ""
              }
              onLayer={(id) => {
                setLineFocus(String(id));
                setTypeValue("");
                setMuted(mutedExcept(id));
              }}
              onType={(value) => {
                setTypeValue(value);
                // Show network so Surface / PCI / Paved band selection paints in chart colour.
                if (value) {
                  const networkId = LRS_LAYER_DEFS.find((def) => def.route)?.id;
                  if (networkId != null) {
                    setMuted((current) =>
                      current.filter((id) => id !== networkId),
                    );
                  }
                }
              }}
              onPavementField={(key) => {
                setPavementField(key);
                setTypeValue("");
                // PCI / Surface: start with segment colour distribution (hide solid network).
                if (key === "pci" || key === "surface_type") {
                  const networkId = LRS_LAYER_DEFS.find((def) => def.route)?.id;
                  if (networkId != null) {
                    setMuted((current) =>
                      current.includes(networkId)
                        ? current
                        : [...current, networkId],
                    );
                  }
                }
              }}
              onDrainageMode={(key) => {
                setDrainageMode(key);
                setTypeValue("");
              }}
              typeValue={typeValue}
              shareLabel={shareLabel}
              layerId={statsLayerId}
              pavementField={pavementField}
              drainageMode={drainageMode}
              roads={typeFilteredRoads}
              loading={roadStatsLoading}
              error={roadStatsError}
              place={place}
              onSelectRoad={(road) => {
                const key = road.code || road.key;
                setRoadKey(key);
                setRoadQuery(road.code || road.label || key);
                setRoadFromAnalysis(true);
                setRoadZoomNonce((value) => value + 1);
                // Hide solid network so pavement condition colours show along the road.
                const networkId = LRS_LAYER_DEFS.find((def) => def.route)?.id;
                if (networkId != null) {
                  setMuted((current) =>
                    current.includes(networkId)
                      ? current
                      : [...current, networkId],
                  );
                }
              }}
            />
            {roadKey && roadFromAnalysis ? (
              <section
                className="ov-strips"
                aria-label="Line events along the road"
              >
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
                    layer={
                      roadProfile
                        ? roadProfile.layers?.[def.id] || { segments: [] }
                        : null
                    }
                    typeValue={def.id === statsLayerId ? typeValue : ""}
                    pavementField={pavementField}
                    drainageMode={drainageMode}
                    activeSegment={segmentFocus}
                    onZoomSegment={({ layerId, objectId, label }) => {
                      setSegmentFocus((current) => ({
                        layerId,
                        objectId,
                        label: label || "",
                        nonce: (current.nonce || 0) + 1,
                      }));
                      // Make sure the layer is visible for the zoomed segment.
                      setMuted((current) =>
                        current.filter((id) => id !== layerId),
                      );
                      setLineFocus(String(layerId));
                    }}
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
