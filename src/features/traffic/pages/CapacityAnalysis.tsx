import {
  useEffect,
  useMemo,
  useRef,
  useState,
  type KeyboardEvent,
} from "react";
import {
  BAND_COLOURS,
  BAND_LABELS,
  CAPACITY_PARAMS,
  PCU_FACTORS,
  queueRisk,
  type VcBand,
} from "../config/parameters";
import { useStations } from "../lib/useStations";
import {
  formatLength,
  formatMeasure,
  sortLinks,
  type Link,
  type SortMode,
} from "../lib/trafficData";
import { ATTRS, LinearStrip, type AttrKey } from "../components/LinearStrip";
import { TrafficPanel } from "../components/TrafficPanel";
import {
  analyseStretch,
  roadBounds,
  sectionOf,
  type MeasureRange,
  type Spread,
} from "../lib/stretch";
import { SortSwitch } from "../components/SortSwitch";
import { VehicleIcon } from "../components/VehicleIcons";
import { formatSurveyYear } from "../lib/trafficCounts";
import { assetIcons } from "../../../assets";

const fmt = (n: number | null, d = 0) =>
  n == null
    ? "—"
    : n.toLocaleString("en-US", {
        maximumFractionDigits: d,
        minimumFractionDigits: d,
      });
const km = formatMeasure; // measures are kilometres along the road, shown as stored; lengths use formatLength
const losTone = (los: string | null) =>
  los === "E" || los === "F"
    ? "danger"
    : los === "C" || los === "D"
      ? "warn"
      : "";
const riskTone = (r: string | null) =>
  r === "High" ? "danger" : r === "Medium" ? "warn" : "";

function exportCsv(links: Link[]) {
  const head = [
    "Link",
    "From (km)",
    "To (km)",
    "AADT",
    "PCU/day",
    "Capacity",
    "V/C",
    "LOS",
    "Queue risk",
  ];
  const rows = links.map((l) => [
    l.label,
    l.from,
    l.to,
    l.aadt,
    l.pcu,
    l.capacity,
    l.vc?.toFixed(2),
    l.los,
    queueRisk(l.vc),
  ]);
  const csv = [head, ...rows]
    .map((r) =>
      r.map((c) => `"${String(c ?? "").replace(/"/g, '""')}"`).join(","),
    )
    .join("\n");
  const a = document.createElement("a");
  a.href = URL.createObjectURL(new Blob([csv], { type: "text/csv" }));
  a.download = "capacity-analysis.csv";
  a.click();
  URL.revokeObjectURL(a.href);
}

const r2 = (n: number) => Math.round(n * 100) / 100;

const scaleSpread = (s: Spread, k: number): Spread => ({
  mean: s.mean == null ? null : s.mean * k,
  min: s.min == null ? null : s.min * k,
  max: s.max == null ? null : s.max * k,
  std: s.std == null ? null : s.std * k,
  n: s.n,
});

/** An indicator: the mean as the figure, and below it the lowest, highest and standard deviation across the sections. */
function SpreadStat({
  label,
  s,
  digits = 0,
  unit = "",
}: {
  label: string;
  s: Spread;
  digits?: number;
  unit?: string;
}) {
  const f = (n: number | null) =>
    n == null ? "—" : `${fmt(n, digits)}${unit}`;
  return (
    <div className="stat">
      <div className="label">
        {label} <span className="mean-tag">mean</span>
      </div>
      <div className="value">{f(s.mean)}</div>
      {s.n > 1 && (
        <div className="spread">
          <span>
            Min <b>{f(s.min)}</b>
          </span>
          <span>
            Max <b>{f(s.max)}</b>
          </span>
          {s.std != null && (
            <span>
              Std <b>{f(s.std)}</b>
            </span>
          )}
        </div>
      )}
    </div>
  );
}

/** Measure range, display options and reset, above the road diagram. The range applies when you press Apply or Enter. */
function StripToolbar({
  range,
  bounds,
  onApply,
  onReset,
  showPoints,
  onPoints,
  attributes,
  onAttributes,
}: {
  range: MeasureRange;
  bounds: MeasureRange;
  onApply: (r: MeasureRange) => void;
  onReset: () => void;
  showPoints: boolean;
  onPoints: (v: boolean) => void;
  attributes: AttrKey[];
  onAttributes: (v: AttrKey[]) => void;
}) {
  const [from, setFrom] = useState(String(r2(range.from)));
  const [to, setTo] = useState(String(r2(range.to)));
  useEffect(() => {
    setFrom(String(r2(range.from)));
    setTo(String(r2(range.to)));
  }, [range.from, range.to]);

  const parse = (t: string) => {
    const n = Number(t);
    return t.trim() !== "" && Number.isFinite(n)
      ? r2(Math.min(bounds.to, Math.max(bounds.from, n)))
      : null;
  };
  const apply = () => {
    const a = parse(from),
      b = parse(to);
    if (a == null || b == null) {
      setFrom(String(r2(range.from)));
      setTo(String(r2(range.to)));
      return;
    }
    onApply({ from: Math.min(a, b), to: Math.max(a, b) });
  };
  const key = (e: KeyboardEvent) => {
    if (e.key === "Enter") apply();
  };
  const menu = useRef<HTMLDetailsElement>(null);
  // Close the attributes list when you click elsewhere.
  useEffect(() => {
    const away = (e: MouseEvent) => {
      if (menu.current?.open && !menu.current.contains(e.target as Node))
        menu.current.open = false;
    };
    document.addEventListener("mousedown", away);
    return () => document.removeEventListener("mousedown", away);
  }, []);
  const toggle = (k: AttrKey) =>
    onAttributes(
      ATTRS.map((a) => a.key).filter((x) =>
        x === k ? !attributes.includes(x) : attributes.includes(x),
      ),
    );

  return (
    <div className="strip-toolbar">
      <div className="range-box">
        <span>Measure range (km)</span>
        <input
          className="input measure-input"
          inputMode="decimal"
          value={from}
          onChange={(e) => setFrom(e.target.value)}
          onKeyDown={key}
          aria-label={`From measure, between ${km(r2(bounds.from))} and ${km(r2(bounds.to))}`}
        />
        <span className="dash" aria-hidden>
          –
        </span>
        <input
          className="input measure-input"
          inputMode="decimal"
          value={to}
          onChange={(e) => setTo(e.target.value)}
          onKeyDown={key}
          aria-label={`To measure, between ${km(r2(bounds.from))} and ${km(r2(bounds.to))}`}
        />
        <button className="btn primary" onClick={apply}>
          Apply
        </button>
      </div>
      <span className="sep" aria-hidden />
      <div className="display">
        Display
        <label>
          <input
            type="checkbox"
            checked={showPoints}
            onChange={(e) => onPoints(e.target.checked)}
          />
          Count stations
        </label>
        <details className="attr-menu" ref={menu}>
          <summary>
            Road attributes{" "}
            <span className="count">
              {attributes.length}/{ATTRS.length}
            </span>
          </summary>
          <div
            className="attr-list"
            role="group"
            aria-label="Road attributes to show"
          >
            <div className="attr-actions">
              <button
                type="button"
                onClick={() => onAttributes(ATTRS.map((a) => a.key))}
              >
                All
              </button>
              <button type="button" onClick={() => onAttributes([])}>
                None
              </button>
            </div>
            {ATTRS.map((a) => (
              <label key={a.key}>
                <input
                  type="checkbox"
                  checked={attributes.includes(a.key)}
                  onChange={() => toggle(a.key)}
                />
                {a.label}
              </label>
            ))}
          </div>
        </details>
      </div>
      <span className="grow" />
      <button
        className="btn reset-btn"
        onClick={onReset}
        title="Back to the whole road"
      >
        <svg viewBox="0 0 24 24" width="14" height="14" aria-hidden>
          <path d="M4 12a8 8 0 1 0 2.6-5.9M4 4v4h4" />
        </svg>
        Reset
      </button>
    </div>
  );
}

export function CapacityAnalysis() {
  const { year, setYear, years, links, stations, loading, error } =
    useStations();
  const [routeId, setRouteId] = useState<string>("");
  const [range, setRange] = useState<MeasureRange | null>(null);
  const [stretchSort, setStretchSort] = useState<SortMode>("measure");
  const [showPoints, setShowPoints] = useState(true);
  const [tab, setTab] = useState<"profile" | "traffic">("profile");
  const [attributes, setAttributes] = useState<AttrKey[]>(() => {
    try {
      const saved = JSON.parse(
        localStorage.getItem("strip-attributes") ?? "null",
      ) as unknown;
      if (Array.isArray(saved))
        return ATTRS.map((a) => a.key).filter((k) => saved.includes(k));
    } catch {
      /* not remembered */
    }
    return ATTRS.map((a) => a.key);
  });
  useEffect(() => {
    try {
      localStorage.setItem("strip-attributes", JSON.stringify(attributes));
    } catch {
      /* private mode */
    }
  }, [attributes]);

  const routes = useMemo(() => {
    const m = new Map<string, { name: string; count: number }>();
    for (const l of links) {
      const r = m.get(l.routeId) ?? { name: l.routeName, count: 0 };
      r.count++;
      m.set(l.routeId, r);
    }
    return [...m.entries()].sort((a, b) =>
      a[0].localeCompare(b[0], undefined, { numeric: true }),
    );
  }, [links]);

  // Pick the most congested route first, so the screen opens on something worth looking at.
  useEffect(() => {
    if (!links.length || (routeId && routes.some(([id]) => id === routeId)))
      return;
    const worst = [...links]
      .filter((l) => l.vc != null)
      .sort((a, b) => (b.vc ?? 0) - (a.vc ?? 0))[0];
    setRouteId((worst ?? links[0]).routeId);
  }, [links, routes, routeId]);

  const sections = useMemo(
    () =>
      links
        .filter((l) => l.routeId === routeId)
        .sort((a, b) => (a.from ?? 0) - (b.from ?? 0)),
    [links, routeId],
  );
  const bounds = useMemo(() => roadBounds(sections), [sections]);

  // The stretch to analyse. It opens on the whole road and stays inside the road.
  useEffect(() => {
    if (!bounds) {
      if (range) setRange(null);
      return;
    }
    if (
      range &&
      range.from >= bounds.from - 1e-6 &&
      range.to <= bounds.to + 1e-6
    )
      return;
    setRange(bounds);
  }, [bounds, range]);
  // A different year can change the length of the road, so start again from the whole road.
  useEffect(() => setRange(null), [year]);

  const ranked = useMemo(() => sortLinks(links, "vc"), [links]);

  const routeStations = useMemo(
    () => stations.filter((s) => s.routeId === routeId),
    [stations, routeId],
  );
  const routeName = routes.find(([id]) => id === routeId)?.[1].name;
  const stretch = useMemo(
    () => (range ? analyseStretch(sections, routeStations, range) : null),
    [sections, routeStations, range],
  );
  const single = useMemo(() => sectionOf(sections, range), [sections, range]);
  const stretchRows = useMemo(() => {
    const rows = (stretch?.sections ?? []).map((x) => x.link);
    return stretchSort === "vc"
      ? [...rows].sort(
          (a, b) =>
            (b.vc ?? -1) - (a.vc ?? -1) || (a.from ?? 0) - (b.from ?? 0),
        )
      : rows;
  }, [stretch, stretchSort]);

  const risk = stretch ? queueRisk(stretch.vc) : null;
  const many = (stretch?.sections.length ?? 0) > 1;

  return (
    <main className="page">
      <div className="page-head">
        <div>
          <div className="crumbs">
            Traffic Management / Capacity and congestion analysis
          </div>
          <h1>Volume, capacity, peak hour and queuing</h1>
        </div>
      </div>

      {error && (
        <div className="error-box" role="alert">
          <strong>Could not load data.</strong> {error.message}
        </div>
      )}

      <div
        className="tabs page-tabs"
        role="tablist"
        aria-label="Capacity analysis"
      >
        <button
          role="tab"
          aria-selected={tab === "profile"}
          className={tab === "profile" ? "on" : ""}
          onClick={() => setTab("profile")}
        >
          Profile and capacity
        </button>
        <button
          role="tab"
          aria-selected={tab === "traffic"}
          className={tab === "traffic" ? "on" : ""}
          onClick={() => setTab("traffic")}
        >
          Traffic analysis
        </button>
      </div>

      {tab === "traffic" && <TrafficPanel stations={stations} />}

      {tab === "profile" && (
        <div className="cap-grid">
          <div className="actions profile-controls">
            <label
              className="inline-field"
              title="The year of the road section data (AADT, capacity, V/C)"
            >
              <span>Road data year</span>
              <select
                className="select"
                value={year ?? ""}
                onChange={(e) => setYear(e.target.value)}
              >
                {years.map((y) => (
                  <option key={y} value={y}>
                    {formatSurveyYear(y)}
                  </option>
                ))}
                {years.length === 0 && <option value="">All records</option>}
              </select>
            </label>
            <label className="inline-field">
              <span>Road</span>
              <select
                className="select"
                value={routeId}
                onChange={(e) => {
                  setRouteId(e.target.value);
                  setRange(null);
                }}
              >
                {routes.map(([id, r]) => (
                  <option key={id} value={id}>
                    {id}
                    {r.name && r.name !== id ? ` · ${r.name}` : ""} ({r.count})
                  </option>
                ))}
              </select>
            </label>
            <button
              className="btn primary"
              disabled={!ranked.length}
              onClick={() => exportCsv(ranked)}
            >
              Export CSV
            </button>
          </div>

          <section className="card strip-card">
            <div className="card-head">
              <h3 className="strip-title">
                <span className="step">1</span>Linear Traffic Profile
                {routeId && (
                  <span
                    className="road-chip"
                    title={
                      routeName && routeName !== routeId
                        ? `${routeId} · ${routeName}`
                        : routeId
                    }
                  >
                    {routeId}
                  </span>
                )}
              </h3>
            </div>
            {bounds && range && (
              <StripToolbar
                range={range}
                bounds={bounds}
                onApply={setRange}
                onReset={() => setRange(bounds)}
                showPoints={showPoints}
                onPoints={setShowPoints}
                attributes={attributes}
                onAttributes={setAttributes}
              />
            )}
            {loading ? (
              <div className="skeleton" style={{ height: 240 }} />
            ) : sections.length === 0 ? (
              <div className="placeholder">No sections for this road.</div>
            ) : (
              <>
                <LinearStrip
                  sections={sections}
                  stations={routeStations}
                  range={range}
                  onRangeChange={setRange}
                  showPoints={showPoints}
                  attributes={attributes}
                />
                <div
                  className="traffic-legend"
                  style={{ border: 0, padding: "10px 0 0"}}
                >
                  {(["free", "near", "congested", "over"] as VcBand[]).map(
                    (b) => {
                      return (
                        <div className="traffic-legend-item" key={b}>
                          {/* <i style={{ background: BAND_COLOURS[b] }} /> */}
                          <assetIcons.Layout size={14} color={BAND_COLOURS[b]} style={{ height: "14px", width: "14px" }} />
                          <p style={{ fontSize: "12px" }}>{BAND_LABELS[b]}</p>
                        </div>
                      );
                    },
                  )}
                </div>
              </>
              
            )}
            
          </section>

          <section className="card section-card">
            {stretch ? (
              <>
                <div className="card-head">
                  <h3>
                    <span className="step">2</span>
                    {single ? "Selected section" : "Selected stretch"}:{" "}
                    {routeId}, km {km(r2(stretch.from))} to {km(r2(stretch.to))}
                  </h3>
                  <div className="detail-head" style={{ margin: 0 }}>
                    {stretch.vc != null && (
                      <span className={`pill ${losTone(stretch.los)}`}>
                        V/C {stretch.vc.toFixed(2)} · LOS {stretch.los}
                      </span>
                    )}
                    {risk && (
                      <span className={`pill ${riskTone(risk)}`}>
                        {risk} queue risk
                      </span>
                    )}
                  </div>
                </div>

                <div className="stretch-layout">
                  <div className="stretch-side">
                    <div className="stats stretch-stats">
                      <SpreadStat label="AADT" s={stretch.spreads.aadt} />
                      <SpreadStat
                        label="V/C ratio"
                        s={stretch.spreads.vc}
                        digits={2}
                      />
                      <SpreadStat
                        label="Traffic (PCU/day)"
                        s={stretch.spreads.pcu}
                      />
                      <div className="stat">
                        <div className="label">Capacity (PCU/day)</div>
                        <div
                          className={`value${stretch.capacities.length > 1 ? " listed" : ""}`}
                        >
                          {stretch.capacities.length === 0
                            ? "—"
                            : stretch.capacities.map(fmt).join(" · ")}
                        </div>
                      </div>
                      <SpreadStat
                        label="Peak hour (est. PCU)"
                        s={scaleSpread(
                          stretch.spreads.pcu,
                          CAPACITY_PARAMS.peakHourSharePct / 100,
                        )}
                      />
                      <SpreadStat
                        label="Heavy vehicles"
                        s={stretch.spreads.heavyPct}
                        unit="%"
                      />
                      <div className="stat">
                        <div className="label">Stretch length</div>
                        <div className="value">
                          {formatLength(r2(stretch.to - stretch.from))}
                        </div>
                      </div>
                      <div className="stat">
                        <div className="label">Congested or over capacity</div>
                        <div className="value">
                          {stretch.to > stretch.from
                            ? `${Math.round((stretch.congestedLength / (stretch.to - stretch.from)) * 100)}%`
                            : "—"}
                          <small>
                            {" "}
                            {formatLength(r2(stretch.congestedLength))} long
                          </small>
                        </div>
                      </div>
                    </div>

                    <div className="stretch-chips">
                      <span className="chip-static">
                        {stretch.sections.length} section
                        {stretch.sections.length === 1 ? "" : "s"}
                      </span>
                      <span className="chip-static">
                        {stretch.stations.length} count station
                        {stretch.stations.length === 1 ? "" : "s"}
                      </span>
                      {many && stretch.worst && (
                        <button
                          className="chip-static link"
                          onClick={() =>
                            setRange({
                              from: stretch.worst!.from!,
                              to: stretch.worst!.to!,
                            })
                          }
                          title="Analyse just this section"
                        >
                          Worst: V/C {stretch.worst.vc!.toFixed(2)} at{" "}
                          {km(stretch.worst.from)}–{km(stretch.worst.to)}
                        </button>
                      )}
                    </div>
                  </div>

                  <div className="stretch-main">
                    <div className="card-head stretch-table-head">
                      <h4>Sections in this {single ? "section" : "stretch"}</h4>
                      {many && (
                        <SortSwitch
                          value={stretchSort}
                          onChange={setStretchSort}
                        />
                      )}
                    </div>
                    <div className="table-scroll stretch-table">
                      <table className="data compact sections-table">
                        <thead>
                          <tr>
                            <th>Section (km)</th>
                            <th className="num">Length</th>
                            <th className="num">AADT</th>
                            <th className="num">Heavy</th>
                            <th>V/C</th>
                            <th>LOS</th>
                          </tr>
                        </thead>
                        <tbody>
                          {stretchRows.map((l) => {
                            const colour = BAND_COLOURS[l.band];
                            return (
                              <tr
                                key={l.id}
                                className={`clickable${stretch.worst?.id === l.id && many ? " worst" : ""}`}
                                style={{ ["--row-colour" as string]: colour }}
                                onClick={() =>
                                  setRange({ from: l.from!, to: l.to! })
                                }
                                title="Analyse just this section"
                              >
                                <td className="section-cell">
                                  {km(l.from)} – {km(l.to)}
                                </td>
                                <td className="num">
                                  {formatLength(r2(l.to! - l.from!))}
                                </td>
                                <td className="num">{fmt(l.aadt)}</td>
                                <td className="num">
                                  {l.heavyPct == null
                                    ? "—"
                                    : `${l.heavyPct.toFixed(0)}%`}
                                </td>
                                <td>
                                  <div className="vc-cell">
                                    <div className="vc-track" aria-hidden>
                                      <div
                                        className="vc-fill"
                                        style={{
                                          width: `${Math.min(100, ((l.vc ?? 0) / 1.5) * 100)}%`,
                                          background: colour,
                                        }}
                                      />
                                      <div className="vc-tick" />
                                    </div>
                                    <strong style={{ color: colour }}>
                                      {l.vc != null ? l.vc.toFixed(2) : "—"}
                                    </strong>
                                  </div>
                                </td>
                                <td>
                                  <span className={`pill ${losTone(l.los)}`}>
                                    {l.los ?? "—"}
                                  </span>
                                </td>
                              </tr>
                            );
                          })}
                        </tbody>
                      </table>
                    </div>
                  </div>
                </div>
              </>
            ) : (
              <div className="placeholder">
                Select a stretch on the road above.
              </div>
            )}
          </section>

          <section className="card pcu-card">
            <h3>Passenger car unit factors</h3>
            <div className="pcu-chips">
              {PCU_FACTORS.map((f) => (
                <span key={f.label} className="pcu-chip">
                  <VehicleIcon type={f.icon} size={14} />
                  {f.label}
                  <strong>{f.value.toFixed(1)}</strong>
                </span>
              ))}
            </div>
          </section>
        </div>
      )}
    </main>
  );
}
