import { useMemo, useState } from "react";
import RoutePicker from "../../analysis/components/RoutePicker";
import { exportBudgetReport } from "../../../utils/excel";
import { formatSqm } from "../../cost/utils/corridor";
import "./RoadReserve.css";

const SECTIONS = [
  ["budget", "Map and budget"],
  ["register", "Parcel register"],
  ["proclamation", "Proclamation tracking"],
  ["monitoring", "Monitoring and reports"],
  ["compare", "Compare alignments"],
  ["rates", "Rates and rules"],
];
const WIDTHS = [20, 30, 40, 60];
const PIPELINE = ["Identified", "Valued", "Owner notified", "Paid, not moved", "Moved out", "Demolished"];
const FILTERS = ["All", "Not paid", "Paid, not moved", "Moved, standing", "Demolished"];

const millions = (value) => ((Number(value) || 0) / 1e6).toLocaleString("en-RW", { minimumFractionDigits: 1, maximumFractionDigits: 1 });
const rwfM = (value) => `RWF ${millions(value)} M`;
const parcelCode = (parcel) => parcel.upi || parcel.parcelNumber || parcel.key || "Parcel";
function matchesFilter(status, filter) {
  const current = status || "Identified";
  if (filter === "All") return true;
  if (filter === "Not paid") return current === "Identified" || current === "Valued" || current === "Owner notified" || current === "Not started";
  if (filter === "Moved, standing") return current === "Moved out";
  return current === filter;
}
const overlapOf = (parcel) => {
  const recorded = Number(String(parcel.recordedSize ?? "").replace(/,/g, ""));
  if (!(recorded > 1)) return "—";
  return `${Math.min(999, Math.round((parcel.sqm / recorded) * 100))}%`;
};
const letterOf = (index) => String.fromCharCode(65 + (index % 26));
const hasBuilding = (parcel, buildings) => Boolean(parcel.upi) && (buildings || []).some((building) => building.upi && building.upi === parcel.upi);

function metric(option, key) {
  const report = option.report || {};
  if (key === "length") return (Number(report.lengthM) || 0) / 1000;
  if (key === "area") return (Number(report.corridorSqm) || 0) / 10000;
  if (key === "parcels") return report.parcels?.length || 0;
  if (key === "buildings") return report.buildings?.length || 0;
  if (key === "rivers") return null;
  if (key === "land") return Number(report.landCost) || 0;
  if (key === "buildingCost") return Number(report.buildingCost) || 0;
  return Number(report.totalCost) || 0;
}

const COMPARE_ROWS = [
  ["length", "Alignment length (km)", 2],
  ["area", "Reserve area (ha)", 1],
  ["parcels", "Parcels affected", 0],
  ["buildings", "Buildings affected", 0],
  ["rivers", "River crossings (bridges)", 0],
  ["land", "Land cost (RWF M)", 1],
  ["buildingCost", "Building cost (RWF M)", 1],
  ["total", "Total estimate (RWF M)", 1],
];

function metricText(value, key, digits) {
  if (value == null) return "—";
  if (key === "land" || key === "buildingCost" || key === "total") return millions(value);
  return value.toLocaleString(undefined, { minimumFractionDigits: digits, maximumFractionDigits: digits });
}

function Switch({ on, disabled, label, onClick }) {
  return (
    <button type="button" className={`rr-switch${on ? " on" : ""}`} aria-pressed={on} aria-label={label} disabled={disabled} onClick={onClick}>
      <i />
    </button>
  );
}

function Sketch({ vertices }) {
  const path = vertices || [];
  if (path.length < 2) return <svg className="rr-sketch" viewBox="0 0 220 92" />;
  const xs = path.map((point) => point[0]);
  const ys = path.map((point) => point[1]);
  const minX = Math.min(...xs);
  const maxX = Math.max(...xs);
  const minY = Math.min(...ys);
  const maxY = Math.max(...ys);
  const sx = (value) => 14 + ((value - minX) / ((maxX - minX) || 1)) * 192;
  const sy = (value) => 78 - ((value - minY) / ((maxY - minY) || 1)) * 64;
  const d = path.map((point, index) => `${index ? "L" : "M"}${sx(point[0]).toFixed(1)},${sy(point[1]).toFixed(1)}`).join(" ");
  return (
    <svg className="rr-sketch" viewBox="0 0 220 92" aria-hidden="true">
      <rect width="220" height="92" fill="#e7efe4" />
      <path d={d} fill="none" stroke="#94a3b8" strokeWidth="6" />
      <path d={d} fill="none" stroke="#9f1239" strokeWidth="2" strokeDasharray="5 3" />
    </svg>
  );
}

function statusClass(status) {
  if (status === "Demolished") return "rose";
  if (status === "Paid, not moved" || status === "Moved out") return "amber";
  if (status === "Proclaimed" || status === "Valued") return "teal";
  return "";
}

function printComparison(options, note) {
  const head = options.map((option, index) => `<th>${letterOf(index)} · ${option.label}</th>`).join("");
  const body = COMPARE_ROWS.map(([key, label, digits]) => {
    const values = options.map((option) => metric(option, key));
    const numeric = values.filter((value) => value != null);
    const best = numeric.length ? Math.min(...numeric) : null;
    const cells = values.map((value) => `<td>${metricText(value, key, digits)}${value != null && value === best ? " · lowest" : ""}</td>`).join("");
    return `<tr><th>${label}</th>${cells}</tr>`;
  }).join("");
  const frame = document.createElement("iframe");
  frame.style.cssText = "position:fixed;width:0;height:0;border:0";
  document.body.appendChild(frame);
  const page = frame.contentWindow;
  page.document.open();
  page.document.write(`<!DOCTYPE html><html><head><title>Alignment comparison</title>
    <style>body{font-family:Segoe UI,sans-serif;margin:24px}table{border-collapse:collapse;width:100%}th,td{border:1px solid #d6dde6;padding:6px 8px;text-align:left}th{background:#f8fafc}</style>
    </head><body><h1>Compare alignments</h1><p>Lowest value in each row is marked.</p>
    <table><thead><tr><th>Measure</th>${head}</tr></thead><tbody>${body}</tbody></table>
    ${note ? `<h2>Decision notes</h2><p>${String(note).replace(/</g, "&lt;")}</p>` : ""}
    </body></html>`);
  page.document.close();
  page.focus();
  page.print();
  window.setTimeout(() => frame.remove(), 60000);
}

export default function CostPlan({
  section, onSection, catalog, routeId, routeReady, onSelectRoute,
  drawing, editing, snapping, vertices, width, landRate, buildingRate, disturbancePct, contingencyPct,
  busy, report, options, activeId, note, parcelsOn, aerialOn, parcelStatus, onParcelStatus,
  onWidth, onLand, onBuilding, onDisturbance, onContingency,
  onDraw, onFinish, onReshape, onClear, onSnap, onKeep, onSelect, onShowOption, onRename, onPrefer, onLegal,
  onNote, onParcels, onAerial, onExportFail,
}) {
  const ready = Boolean(report && !report.error);
  const parcels = report?.parcels || [];
  const buildings = report?.buildings || [];
  const points = vertices?.length || 0;
  const [filter, setFilter] = useState("All");
  const [selectedKey, setSelectedKey] = useState("");
  const [zoneRates, setZoneRates] = useState({ urban: "", peri: "", rural: String(landRate), agri: "" });
  const source = options.find((option) => option.id === activeId)?.report || report;
  const sourceParcels = source?.parcels || parcels;
  const selected = sourceParcels.find((parcel) => parcel.key === selectedKey) || sourceParcels[0];
  const counts = useMemo(() => {
    const tally = Object.fromEntries(PIPELINE.map((status) => [status, 0]));
    sourceParcels.forEach((parcel) => {
      const status = parcelStatus[parcel.key] || "Identified";
      if (tally[status] != null) tally[status] += 1;
    });
    return tally;
  }, [sourceParcels, parcelStatus]);
  const maxPart = Math.max(report?.landCost || 0, report?.buildingCost || 0, report?.disturbance || 0, report?.contingency || 0, 1);
  const bar = (value, color) => (
    <i><b style={{ width: `${Math.max(0, (value / maxPart) * 100)}%`, background: color }} /></i>
  );
  const saveCurrent = () => onKeep(`Option ${options.length + 1}`);
  const exportCurrent = () => {
    const item = ready ? report : options[0]?.report;
    if (!item) return;
    try { exportBudgetReport(item, options); }
    catch (error) { onExportFail?.(error.message || "Could not export Excel."); }
  };

  return (
    <>
      <header className="rr-nav">
        <div className="rr-brand"><i>A</i> RAMS · Road Reserve</div>
        <nav className="rr-tabs" aria-label="Road reserve">
          {SECTIONS.map(([id, label]) => (
            <button key={id} type="button" className={section === id ? "on" : ""} aria-current={section === id ? "page" : undefined} onClick={() => onSection(id)}>{label}</button>
          ))}
        </nav>
        <div className="rr-user">Planner</div>
      </header>

      {section === "budget" && (
        <>
          <div className="rr-title">
            <div>
              <p>Road Reserve / Budgeting tool</p>
              <h2>Proposal {routeId || "new alignment"} · {ready ? "draft" : "draw an alignment"}</h2>
            </div>
            <div className="rr-actions">
              <button type="button" disabled={!ready} onClick={saveCurrent}>Save scenario</button>
              <button type="button" disabled={!ready && options.length === 0} onClick={exportCurrent}>Export Excel</button>
              <button type="button" className="solid" disabled={!ready && options.length === 0} onClick={() => printComparison(options.length ? options : [{ label: "Current line", report }], note)}>Export PDF summary</button>
            </div>
          </div>
          <aside className="rr-left">
            <section className="rr-card">
              <p className="rr-step">1. Base road</p>
              <h3>Connect alignment to</h3>
              <RoutePicker catalog={catalog || []} value={routeId || ""} placeholder="Select a route" onChange={onSelectRoute} />
              <p className="rr-hint">{routeReady ? `${routeId} is the base road. The line can leave it.` : "Optional. Select a road to snap to, or draw anywhere on the map."}</p>
            </section>
            <section className="rr-card">
              <p className="rr-step">2. Draw alignment</p>
              <div className="rr-draw">
                <button type="button" className={drawing ? "on" : ""} onClick={onDraw}>{drawing ? "Drawing" : "Draw line"}</button>
                <button type="button" className={editing ? "on" : ""} onClick={onReshape}>Edit vertices</button>
                <button type="button" className={snapping ? "on" : ""} onClick={onSnap} title="When on, a click near the selected road is placed on it. Clicks farther away stay where you put them.">Snap to road</button>
                <button type="button" onClick={onClear}>Clear</button>
              </div>
              {drawing && points >= 2 && <button type="button" className="rr-btn solid" onClick={onFinish}>Finish line</button>}
              {busy && <p className="rr-hint">Measuring parcels and buildings…</p>}
            </section>
            <section className="rr-card">
              <p className="rr-step">3. Reserve width</p>
              <div className="rr-widths">
                {WIDTHS.map((item) => (
                  <button key={item} type="button" className={Number(width) === item ? "on" : ""} onClick={() => onWidth(item)}>{item} m</button>
                ))}
              </div>
              <label className="stack">Custom width: {width} m 
                <input type="range" min="10" max="80" step="1" value={Math.min(80, Math.max(10, Number(width) || 10))} onChange={(event) => onWidth(Number(event.target.value))} />
              </label>
              <div className="rr-range"><span>10 m</span><span>80 m</span></div>
            </section>
            <section className="rr-card">
              <p className="rr-step">4. Layers</p>
              <ul className="rr-key rr-legend-side">
                <li><i style={{ background: "transparent", borderBottom: "2px dashed currentColor" }} />Alignment</li>
                <li><i style={{ background: "#f9a8d4" }} />Reserve</li>
                <li><i style={{ background: "#fb923c" }} />Parcel taken</li>
                <li><i style={{ background: "#991b1b" }} />Building</li>
              </ul>
              <ul className="rr-layers">
                <li>Parcels (cadastre) <Switch on={parcelsOn} label="Parcels" onClick={onParcels} /></li>
                <li>Buildings <Switch on label="Buildings" disabled /></li>
                <li>Existing roads <Switch on label="Existing roads" disabled /></li>
                <li>Rivers and wetlands <Switch on={false} label="Rivers" disabled /></li>
                <li>Aerial photo <Switch on={aerialOn} label="Aerial photo" onClick={onAerial} /></li>
                <li>Proclaimed reserves <Switch on={false} label="Proclaimed reserves" disabled /></li>
              </ul>
            </section>
            <section className="rr-card">
              <p className="rr-step">5. Rate profile</p>
              <label className="stack">Unit rates used for the estimate
                <select value="sample" onChange={() => onSection("rates")}>
                  <option value="sample">Sample rates</option>
                </select>
              </label>
              <button type="button" className="rr-link" onClick={() => onSection("rates")}>Edit rates and rules</button>
            </section>
          </aside>
          <aside className="rr-right">
            <section className="rr-card">
              <h3>Reserve summary</h3>
              <div className="rr-stats">
                <div><span>Parcels affected</span><b>{ready ? parcels.length : "—"}</b></div>
                <div><span>Buildings affected</span><b>{ready ? buildings.length : "—"}</b></div>
                <div><span>Reserve area</span><b>{ready ? `${((report.corridorSqm || 0) / 10000).toFixed(1)} ha` : "—"}</b></div>
                <div><span>Alignment length</span><b>{ready ? `${((report.lengthM || 0) / 1000).toFixed(2)} km` : "—"}</b></div>
              </div>
            </section>
            <section className="rr-card">
              <h3>Cost estimate</h3>
              <p className="rr-hint">Based on the buffer area. Millions of RWF.</p>
              {ready ? (
                <>
                  <div className="rr-cost">
                    <div><span>Land ({formatSqm(report.parcelSqm)})</span>{bar(report.landCost, "#2563eb")}<b>{millions(report.landCost)}</b></div>
                    <div><span>Buildings ({buildings.length})</span>{bar(report.buildingCost, "#ea580c")}<b>{millions(report.buildingCost)}</b></div>
                    <div><span>Disturbance allowance ({disturbancePct}%)</span>{bar(report.disturbance || 0, "#94a3b8")}<b>{millions(report.disturbance)}</b></div>
                    
                  </div>
                  <p className="rr-total"><span>Total estimate</span><b>{rwfM(report.totalCost)}</b></p>
                </>
              ) : <p className="rr-hint">{report?.error || "Finish a line to calculate the reserve."}</p>}
            </section>
            <section className="rr-card">
              <h3>Next steps</h3>
              <div className="rr-next">
                <button type="button" className="rr-btn" disabled={!ready} onClick={() => onSection("register")}>Create acquisition list from affected parcels</button>
                <button type="button" className="rr-btn" onClick={() => onSection("compare")}>Compare with other alignments</button>
              </div>
            </section>
          </aside>
          <section className="rr-card rr-parcels" id="affected-parcels">
            <header>
              <h3>Affected parcels ({ready ? parcels.length : 0})</h3>
              <button type="button" className="rr-btn" disabled={!ready} onClick={exportCurrent}>Export list</button>
            </header>
            <p className="rr-hint">Overlap is approximate until the parcel boundary is cut by the buffer.</p>
            <table className="rr-table">
              <thead>
                <tr><th>Parcel ID</th><th>Parcel area (m²)</th><th>Overlap with reserve</th><th>Building</th><th>Acquisition status</th><th></th></tr>
              </thead>
              <tbody>
                {!ready && <tr><td colSpan={6}>{busy ? "Measuring…" : "Draw and finish an alignment to list parcels."}</td></tr>}
                {parcels.map((parcel) => (
                  <tr key={parcel.key}>
                    <td>{parcelCode(parcel)}</td>
                    <td>{parcel.recordedSize || Math.round(parcel.sqm).toLocaleString()}</td>
                    <td>{overlapOf(parcel)}</td>
                    <td>{hasBuilding(parcel, buildings) ? "Yes" : "No"}</td>
                    <td>{parcelStatus[parcel.key] || "Not started"}</td>
                    <td><button type="button" className="link" onClick={() => { setSelectedKey(parcel.key); onSection("register"); }}>Open</button></td>
                  </tr>
                ))}
              </tbody>
            </table>
          </section>
        </>
      )}

      {section === "register" && (
        <>
          <div className="rr-title">
            <div>
              <p>Road Reserve / Parcel register</p>
              <h2>Parcels in reserve · Proposal {routeId || "new alignment"}</h2>
            </div>
            <div className="rr-actions">
              <button type="button" disabled={!sourceParcels.length} onClick={exportCurrent}>Export Excel</button>
            </div>
          </div>
          <section className="rr-page">
            <div className="rr-kpis">
              <article><span>Parcels</span><b>{sourceParcels.length}</b></article>
              <article><span>Paid</span><b>{counts["Moved out"] + counts.Demolished}</b><em>of {sourceParcels.length}</em></article>
              <article><span>Moved out</span><b>{counts["Moved out"]}</b><em>of {counts["Paid, not moved"] + counts["Moved out"] + counts.Demolished} standing or moved</em></article>
              <article><span>Demolished</span><b>{counts.Demolished}</b></article>
              <article><span>Paid, not moved</span><b>{counts["Paid, not moved"]}</b></article>
            </div>
            <div className="rr-split">
              <div className="rr-card">
                <div className="rr-chips">
                  {FILTERS.map((item) => <button key={item} type="button" className={`rr-chip${filter === item ? " on" : ""}`} onClick={() => setFilter(item)}>{item}</button>)}
                </div>
                <table className="rr-table">
                  <thead><tr><th>Parcel ID</th><th>Area (m²)</th><th>Building</th><th>Property cost (RWF M)</th><th>Status</th></tr></thead>
                  <tbody>
                    {sourceParcels.filter((parcel) => matchesFilter(parcelStatus[parcel.key], filter)).map((parcel) => (
                      <tr key={parcel.key} className={selected?.key === parcel.key ? "on" : ""}>
                        <td><button type="button" className="link" onClick={() => setSelectedKey(parcel.key)}>{parcelCode(parcel)}</button></td>
                        <td>{Math.round(parcel.sqm).toLocaleString()}</td>
                        <td>{hasBuilding(parcel, source?.buildings) ? "Yes" : "No"}</td>
                        <td>{millions(parcel.cost)}</td>
                        <td><span className={`rr-badge ${statusClass(parcelStatus[parcel.key])}`}>{parcelStatus[parcel.key] || "Identified"}</span></td>
                      </tr>
                    ))}
                    {sourceParcels.length === 0 && <tr><td colSpan={5}>Draw an alignment on Map and budget. Its parcels appear here.</td></tr>}
                  </tbody>
                </table>
              </div>
              <aside className="rr-card rr-detail">
                {selected ? (
                  <>
                    <header className="rr-page-head"><b>{parcelCode(selected)}</b><span className={`rr-badge ${statusClass(parcelStatus[selected.key])}`}>{parcelStatus[selected.key] || "Identified"}</span></header>
                    <h4>PROPERTY COST</h4>
                    <p><span>Land taken</span><b>{millions(selected.cost)} M</b></p>
                    <p><span>Area inside reserve</span><b>{formatSqm(selected.sqm)}</b></p>
                    <p><span>Location</span><b>{[selected.district, selected.sector, selected.cell].filter(Boolean).join(", ") || "—"}</b></p>
                    <h4>STATUS</h4>
                    <label className="stack">Acquisition status
                      <select value={parcelStatus[selected.key] || "Identified"} onChange={(event) => onParcelStatus(selected.key, event.target.value)}>
                        {["Identified", ...PIPELINE.slice(1), "Not started"].map((status) => <option key={status}>{status}</option>)}
                      </select>
                    </label>
                    <div className="rr-actions">
                      <button type="button" className="solid" onClick={() => onParcelStatus(selected.key, "Moved out")}>Record move-out</button>
                      <button type="button" onClick={() => onParcelStatus(selected.key, "Demolished")}>Mark demolished</button>
                    </div>
                  </>
                ) : <p className="rr-hint">Select a parcel.</p>}
              </aside>
            </div>
          </section>
        </>
      )}

      {section === "proclamation" && (
        <>
          <div className="rr-title">
            <div>
              <p>Road Reserve / Proclamation and acquisition tracking</p>
              <h2>Reserve status by road</h2>
            </div>
            <div className="rr-actions">
              <button type="button" onClick={() => onSection("budget")}>Show on map</button>
            </div>
          </div>
          <section className="rr-page">
            <div className="rr-split">
              <div className="rr-card">
                <h3>Roads and legal status</h3>
                <table className="rr-table">
                  <thead><tr><th>Road ID</th><th>Reserve width</th><th>Legal status</th><th>Parcels</th></tr></thead>
                  <tbody>
                    {options.map((option) => (
                      <tr key={option.id} className={option.id === activeId ? "on" : ""}>
                        <td><button type="button" className="link" onClick={() => onSelect(option.id)}>{option.label}</button></td>
                        <td>{option.width} m</td>
                        <td><span className={`rr-badge ${statusClass(option.legal || "Proposed")}`}>{option.legal || "Proposed"}</span></td>
                        <td>{option.report?.parcels?.length || 0}</td>
                      </tr>
                    ))}
                    {options.length === 0 && <tr><td colSpan={4}>Save a scenario from Map and budget to track it here.</td></tr>}
                  </tbody>
                </table>
              </div>
              <aside className="rr-card rr-detail">
                <h3>{options.find((option) => option.id === activeId)?.label || "No scenario selected"} <span className="rr-badge">{options.find((option) => option.id === activeId)?.legal || "Proposed"}</span></h3>
                <p><span>Reserve width</span><b>{options.find((option) => option.id === activeId)?.width || width} m</b></p>
                <p><span>Length</span><b>{source ? `${((source.lengthM || 0) / 1000).toFixed(2)} km` : "—"}</b></p>
                <h4>LEGAL ACTIONS</h4>
                <div className="rr-actions">
                  <button type="button" className="solid" disabled={!activeId} onClick={() => onLegal(activeId, "Proclaimed")}>Proclaim</button>
                  <button type="button" disabled={!activeId} onClick={() => onLegal(activeId, "Re-proclaimed")}>Re-proclaim</button>
                  <button type="button" disabled={!activeId} onClick={() => onLegal(activeId, "De-proclaimed")}>De-proclaim section</button>
                </div>
              </aside>
            </div>
            <div className="rr-card">
              <h3>Acquisition pipeline: {sourceParcels.length} parcels</h3>
              <div className="rr-board">
                {PIPELINE.map((status) => (
                  <div key={status} className="rr-col">
                    <header><span>{status}</span><b>{counts[status] || 0}</b></header>
                    {sourceParcels.filter((parcel) => (parcelStatus[parcel.key] || "Identified") === status).slice(0, 3).map((parcel) => (
                      <article key={parcel.key}><b>{parcelCode(parcel)}</b><div>{[parcel.district, parcel.sector].filter(Boolean).join(" · ") || "Parcel"}</div></article>
                    ))}
                  </div>
                ))}
              </div>
            </div>
            <div className="rr-card">
              <h3>Status along the road</h3>
              <p className="rr-hint">Each block is one affected parcel. Chainage is the alignment length, split evenly because the cadastre extract has no measure.</p>
              <div className="rr-status">
                {sourceParcels.map((parcel) => {
                  const status = parcelStatus[parcel.key] || "Identified";
                  const color = status === "Demolished" ? "#1e3a8a" : status === "Moved out" ? "#0f766e" : status === "Paid, not moved" ? "#d97706" : "#94a3b8";
                  return <span key={parcel.key} style={{ flex: 1, background: color }} title={parcelCode(parcel)} />;
                })}
              </div>
              <p className="rr-hint">0+000 <span style={{ float: "right" }}>{source ? `${((source.lengthM || 0) / 1000).toFixed(2)} km` : ""}</span></p>
            </div>
          </section>
        </>
      )}

      {section === "monitoring" && (
        <>
          <div className="rr-title">
            <div>
              <p>Road Reserve / Monitoring and reports</p>
              <h2>Reserve monitoring · Proposal {routeId || "new alignment"}</h2>
            </div>
            <div className="rr-actions">
              <button type="button" disabled={!options.length && !ready} onClick={() => printComparison(options.length ? options : [{ label: "Current", report }], note)}>Export PDF</button>
              <button type="button" className="solid" disabled={!ready && !options.length} onClick={exportCurrent}>Export Excel</button>
            </div>
          </div>
          <section className="rr-page">
            <div className="rr-kpis">
              <article><span>Parcels recorded</span><b>{sourceParcels.length ? `${Math.round(((counts["Moved out"] + counts.Demolished) / sourceParcels.length) * 100)}%` : "—"}</b><em>{counts["Moved out"] + counts.Demolished} of {sourceParcels.length} moved or cleared</em></article>
              <article><span>Paid owners who moved</span><b>{counts["Paid, not moved"] + counts["Moved out"] + counts.Demolished ? `${Math.round((counts["Moved out"] / Math.max(1, counts["Paid, not moved"] + counts["Moved out"] + counts.Demolished)) * 100)}%` : "—"}</b></article>
              <article><span>Paid, not moved</span><b>{counts["Paid, not moved"]}</b></article>
              <article><span>Buildings in reserve</span><b>{source?.buildings?.length || 0}</b></article>
              <article><span>Outstanding estimate</span><b>{source ? rwfM(source.totalCost) : "—"}</b></article>
            </div>
            <div className="rr-card">
              <h3>Report A: owners paid but not moved</h3>
              <table className="rr-table">
                <thead><tr><th>Parcel</th><th>Location</th><th>Building</th><th>Status</th></tr></thead>
                <tbody>
                  {sourceParcels.filter((parcel) => parcelStatus[parcel.key] === "Paid, not moved").map((parcel) => (
                    <tr key={parcel.key}><td>{parcelCode(parcel)}</td><td>{parcel.district || "—"}</td><td>{hasBuilding(parcel, source?.buildings) ? "Yes" : "No"}</td><td><span className="rr-badge amber">Paid, not moved</span></td></tr>
                  ))}
                  {sourceParcels.every((parcel) => parcelStatus[parcel.key] !== "Paid, not moved") && <tr><td colSpan={4}>No parcel is marked paid but not moved. Set that status in the parcel register.</td></tr>}
                </tbody>
              </table>
            </div>
            <div className="rr-card">
              <h3>Report B: structures inside the reserve</h3>
              <table className="rr-table">
                <thead><tr><th>Structure</th><th>Use</th><th>Footprint (m²)</th><th>Source</th></tr></thead>
                <tbody>
                  {(source?.buildings || []).map((building) => (
                    <tr key={building.key}><td>{building.name || building.upi || "Building"}</td><td>{building.use || "—"}</td><td>{Math.round(building.sqm || 0).toLocaleString()}</td><td>Building layer</td></tr>
                  ))}
                  {(source?.buildings || []).length === 0 && <tr><td colSpan={4}>No buildings were found inside the current reserve.</td></tr>}
                </tbody>
              </table>
            </div>
            <div className="rr-card">
              <h3>Report library</h3>
              <div className="rr-cards">
                <article><b>Reserve budget</b><p className="rr-hint">Parcels, buildings, and the cost estimate.</p><button type="button" className="rr-link" onClick={exportCurrent}>Excel</button></article>
                <article><b>Alignment comparison</b><p className="rr-hint">Saved scenarios side by side.</p><button type="button" className="rr-link" onClick={() => printComparison(options, note)}>PDF</button></article>
              </div>
            </div>
          </section>
        </>
      )}

      {section === "compare" && (
        <>
          <div className="rr-title">
            <div>
              <p>Road Reserve / Compare alignments</p>
              <h2>{options.length ? `${options.length} alignment${options.length === 1 ? "" : "s"} for the same corridor` : "Compare alignments"}</h2>
            </div>
            <div className="rr-actions">
              <button type="button" onClick={() => onSection("budget")}>Add saved scenario</button>
              <button type="button" disabled={!options.length} onClick={exportCurrent}>Export Excel</button>
              <button type="button" className="solid" disabled={options.length < 1} onClick={() => printComparison(options, note)}>Export PDF comparison</button>
            </div>
          </div>
          <section className="rr-page">
            {options.length === 0 && <p className="rr-card rr-hint">Draw a line on Map and budget, then choose Save scenario. Draw a second line and save it to compare them here.</p>}
            <div className="rr-cards">
              {options.map((option, index) => (
                <article key={option.id} className={`rr-card${option.id === activeId ? " on" : ""}`} onClick={() => onSelect(option.id)}>
                  <header>
                    <input aria-label={`Name for alignment ${letterOf(index)}`} value={option.label} onChange={(event) => onRename(option.id, event.target.value)} onClick={(event) => event.stopPropagation()} />
                    {index === 0 && <span className="rr-badge teal">Baseline</span>}
                    {option.preferred && <span className="rr-badge teal">Preferred</span>}
                  </header>
                  <Sketch vertices={option.vertices} />
                  <footer><span>Total estimate</span><b>{rwfM(option.report?.totalCost)}</b></footer>
                </article>
              ))}
            </div>
            {options.length > 0 && (
              <div className="rr-card">
                <h3>Side-by-side comparison</h3>
                <p className="rr-hint">Lowest value in each row is marked. River crossings are not in the current layers, so that row stays blank.</p>
                <table className="rr-table">
                  <thead>
                    <tr>
                      <th>Measure</th>
                      {options.map((option, index) => <th key={option.id}>{letterOf(index)} · {option.label}</th>)}
                    </tr>
                  </thead>
                  <tbody>
                    {COMPARE_ROWS.map(([key, label, digits]) => {
                      const values = options.map((option) => metric(option, key));
                      const numeric = values.filter((value) => value != null);
                      const best = numeric.length ? Math.min(...numeric) : null;
                      return (
                        <tr key={key}>
                          <th>{label}</th>
                          {values.map((value, index) => (
                            <td key={options[index].id} className={value != null && value === best ? "rr-best" : ""}>
                              {metricText(value, key, digits)}{value != null && value === best ? " ▼ lowest" : ""}
                            </td>
                          ))}
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              </div>
            )}
            {options.length > 0 && (
              <div className="rr-compare-bottom">
                <section className="rr-card">
                  <h3>Cost breakdown</h3>
                  <p className="rr-hint">Millions of RWF. Bars share one scale.</p>
                  <ul className="rr-bars">
                    {options.map((option, index) => {
                      const reportItem = option.report || {};
                      const maxTotal = Math.max(1, ...options.map((item) => item.report?.totalCost || 0));
                      const widthOf = (value) => `${Math.max(0, ((Number(value) || 0) / maxTotal) * 100)}%`;
                      return (
                        <li key={option.id}>
                          <span>{letterOf(index)} · {option.label}</span>
                          <div>
                            <i style={{ width: widthOf(reportItem.landCost), background: "#2563eb" }} />
                            <i style={{ width: widthOf(reportItem.buildingCost), background: "#ea580c" }} />
                            <i style={{ width: widthOf((reportItem.disturbance || 0) + (reportItem.contingency || 0)), background: "#94a3b8" }} />
                          </div>
                          <b>{millions(reportItem.totalCost)}</b>
                        </li>
                      );
                    })}
                  </ul>
                  <p className="rr-key"><i style={{ background: "#2563eb" }} />Land <i style={{ background: "#ea580c" }} />Buildings <i style={{ background: "#94a3b8" }} />Allowances and contingency</p>
                </section>
                <section className="rr-card rr-notes">
                  <h3>Decision notes</h3>
                  <textarea rows={4} value={note || ""} placeholder="Reason for choosing an alignment" onChange={(event) => onNote(event.target.value)} />
                  <div className="rr-actions">
                    <button type="button" className="solid" disabled={!activeId} onClick={() => onPrefer(activeId)}>Select as preferred</button>
                    <button type="button" disabled={!activeId} onClick={() => { onShowOption(activeId); onSection("budget"); }}>Open in map</button>
                  </div>
                </section>
              </div>
            )}
          </section>
        </>
      )}

      {section === "rates" && (
        <>
          <div className="rr-title">
            <div>
              <p>Road Reserve / Rates and rules</p>
              <h2>Rates, widths and workflow rules</h2>
            </div>
            <div className="rr-actions">
              <button type="button" className="solid" onClick={() => onLand(Number(zoneRates.rural) || landRate)}>Save changes</button>
            </div>
          </div>
          <section className="rr-page">
            <p className="rr-hint">The estimate uses one land rate per m², one building rate per m², a disturbance percent, and a contingency percent. Zone rows other than the rate used for this estimate are stored on this screen only.</p>
            <div className="rr-rates">
              <section className="rr-card">
                <h3>Land rates by zone</h3>
                <table className="rr-table rr-mini">
                  <tbody>
                    {[["urban", "Urban"], ["peri", "Peri-urban"], ["rural", "Rural residential"], ["agri", "Agricultural"]].map(([key, label]) => (
                      <tr key={key}>
                        <td>{label}{key === "rural" ? " · used" : ""}</td>
                        <td><input value={zoneRates[key]} onChange={(event) => {
                          const next = { ...zoneRates, [key]: event.target.value };
                          setZoneRates(next);
                          if (key === "rural") onLand(Number(event.target.value) || 0);
                        }} /></td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </section>
              <section className="rr-card">
                <h3>Building rate</h3>
                <label className="stack">Permanent structures, RWF per m²
                  <input type="number" min="0" value={buildingRate} onChange={(event) => onBuilding(Number(event.target.value) || 0)} />
                </label>
              </section>
              <section className="rr-card">
                <h3>Other cost items</h3>
                <label className="stack">Disturbance allowance (%)
                  <input type="number" min="0" max="100" step="0.5" value={disturbancePct} onChange={(event) => onDisturbance(Number(event.target.value) || 0)} />
                </label>
                <label className="stack">Contingency (%)
                  <input type="number" min="0" max="100" step="0.5" value={contingencyPct} onChange={(event) => onContingency(Number(event.target.value) || 0)} />
                </label>
              </section>
              <section className="rr-card">
                <h3>Default reserve width</h3>
                <p className="rr-hint">The planner can still change it on Map and budget.</p>
                <label className="stack">New road, total width (m)
                  <input type="number" min="1" max="2000" value={width} onChange={(event) => onWidth(Number(event.target.value) || 1)} />
                </label>
              </section>
              <section className="rr-card wide">
                <h3>Data sources</h3>
                <table className="rr-table">
                  <tbody>
                    <tr><td>Road network and measures</td><td>Road Location Reference system</td></tr>
                    <tr><td>Parcels (cadastre)</td><td>Land administration services</td></tr>
                    <tr><td>Buildings</td><td>Building footprint layers</td></tr>
                    <tr><td>Aerial photos</td><td>Satellite basemap</td></tr>
                  </tbody>
                </table>
              </section>
            </div>
          </section>
        </>
      )}
    </>
  );
}
