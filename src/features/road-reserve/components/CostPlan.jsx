import { useEffect, useMemo, useRef, useState } from "react";
import RoutePicker from "../../analysis/components/RoutePicker";
import { URBAN_PARCEL_RATE_RWF } from "../../../config";
import { exportBudgetReport } from "../../../utils/excel";
import { closestOnPath, formatMetre, formatRwf, formatSqm, pointInRing } from "../../cost/utils/corridor";
import Modal from "./Modal";
import "./RoadReserve.css";
import { assetIcons } from "../../../assets";
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
const projectLabel = (project) => (project?.id ? `${project.name} (${project.scenarios?.length || 0}/3)` : "Select a project");

function ProjectSearch({ projects, projectId, onSelect }) {
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState("");
  const [active, setActive] = useState(0);
  const boxRef = useRef(null);
  const listRef = useRef(null);
  const selected = (projects || []).find((project) => project.id === projectId);
  const matches = useMemo(() => {
    const wanted = query.trim().toLowerCase();
    const all = projects || [];
    return wanted ? all.filter((project) => project.name.toLowerCase().includes(wanted)) : all;
  }, [projects, query]);
  const choices = query.trim() ? matches : [{ id: "", name: "Select a project", scenarios: [] }, ...matches];

  useEffect(() => {
    if (!open) return undefined;
    const close = (event) => {
      if (!boxRef.current?.contains(event.target)) setOpen(false);
    };
    document.addEventListener("pointerdown", close);
    return () => document.removeEventListener("pointerdown", close);
  }, [open]);
  useEffect(() => { setActive(0); }, [query, open]);
  useEffect(() => {
    if (!open) return;
    listRef.current?.querySelector(`[data-index="${active}"]`)?.scrollIntoView({ block: "nearest" });
  }, [active, open]);

  const choose = (id) => {
    onSelect(id);
    setOpen(false);
    setQuery("");
  };
  const onKeyDown = (event) => {
    if (event.key === "ArrowDown") {
      event.preventDefault();
      setOpen(true);
      setActive((index) => Math.min(Math.max(choices.length - 1, 0), index + 1));
    } else if (event.key === "ArrowUp") {
      event.preventDefault();
      setActive((index) => Math.max(0, index - 1));
    } else if (event.key === "Enter" && open && choices[active]) {
      event.preventDefault();
      choose(choices[active].id);
    } else if (event.key === "Escape") {
      setOpen(false);
      setQuery("");
    }
  };

  return (
    <div className={`rr-project-search${open ? " open" : ""}`} ref={boxRef}>
      <input
        value={open ? query : (selected ? projectLabel(selected) : "")}
        placeholder={selected ? projectLabel(selected) : "Search projects"}
        aria-label="Project"
        role="combobox"
        aria-expanded={open}
        aria-autocomplete="list"
        onFocus={() => { setOpen(true); setQuery(""); }}
        onChange={(event) => { setQuery(event.target.value); setOpen(true); }}
        onKeyDown={onKeyDown}
      />
      <i className="caret" aria-hidden="true">▾</i>
      {open && (
        <ul ref={listRef} role="listbox">
          {choices.map((project, index) => (
            <li
              key={project.id || "none"}
              data-index={index}
              role="option"
              aria-selected={project.id === projectId}
              className={`${index === active ? "active" : ""} ${project.id && project.id === projectId ? "selected" : ""}`}
              onPointerDown={(event) => { event.preventDefault(); choose(project.id); }}
              onPointerEnter={() => setActive(index)}
            >
              {projectLabel(project)}
            </li>
          ))}
          {!matches.length && <li className="none">No project matches “{query}”</li>}
        </ul>
      )}
    </div>
  );
}
const hasBuilding = (parcel, buildings) => Boolean(parcel.upi) && (buildings || []).some((building) => building.upi && building.upi === parcel.upi);

function metric(option, key) {
  const report = option.report || {};
  if (key === "length") return Number(report.lengthM) || 0;
  if (key === "area") return Number(report.corridorSqm) || 0;
  if (key === "parcels") return report.parcels?.length || 0;
  if (key === "buildings") return report.buildings?.length || 0;
  if (key === "rivers") return null;
  if (key === "land") return Number(report.landCost) || 0;
  if (key === "buildingCost") return Number(report.buildingCost) || 0;
  return Number(report.totalCost) || 0;
}

const COMPARE_ROWS = [
  ["length", "Alignment length (m)", 1],
  ["area", "Reserve area (m²)", 0],
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

function buildingOnParcel(parcel, building) {
  if (!parcel || !building) return false;
  if (parcel.upi && building.upi && parcel.upi === building.upi) return true;
  return Boolean(building.center && pointInRing(building.center, parcel.ring));
}

function ParcelScene({ parcel, alignment, buildings }) {
  const ring = parcel?.ring || [];
  if (ring.length < 3) return <p className="rr-hint">Finish the line again to see this parcel, the road, and its buildings.</p>;
  const mine = (buildings || []).filter((building) => buildingOnParcel(parcel, building));
  const points = ring.slice();
  mine.forEach((building) => {
    (building.ring || []).forEach((point) => points.push(point));
    if (building.center) points.push(building.center);
  });
  const mid = [ring.reduce((sum, point) => sum + point[0], 0) / ring.length, ring.reduce((sum, point) => sum + point[1], 0) / ring.length];
  const focus = (alignment || []).length > 1 ? closestOnPath(alignment, mid) : null;
  if (focus?.point) points.push(focus.point);
  const xs = points.map((point) => point[0]);
  const ys = points.map((point) => point[1]);
  const minX = Math.min(...xs);
  const maxX = Math.max(...xs);
  const minY = Math.min(...ys);
  const maxY = Math.max(...ys);
  const padX = ((maxX - minX) || 0.0002) * 0.12;
  const padY = ((maxY - minY) || 0.0002) * 0.12;
  const sx = (value) => 10 + ((value - (minX - padX)) / ((maxX - minX + padX * 2) || 1)) * 260;
  const sy = (value) => 170 - ((value - (minY - padY)) / ((maxY - minY + padY * 2) || 1)) * 158;
  const chain = (path) => path.map((point) => `${sx(point[0]).toFixed(1)},${sy(point[1]).toFixed(1)}`).join(" ");
  const close = (path) => `${chain(path)} ${sx(path[0][0]).toFixed(1)},${sy(path[0][1]).toFixed(1)}`;
  const crossed = parcel.distanceM != null && parcel.distanceM < 0.5;
  const beside = parcel.distanceM != null && parcel.distanceM >= 0.5;
  return (
    <figure className="rr-pass">
      <svg className="rr-scene" viewBox="0 0 280 180" role="img" aria-label="Parcel, new road, and buildings">
        <polygon points={close(ring)} />
        {mine.map((building) => (
          building.ring?.length > 2
            ? <polygon key={building.key} className="building" points={close(building.ring)} />
            : building.center && <circle key={building.key} className="building" cx={sx(building.center[0])} cy={sy(building.center[1])} r="4" />
        ))}
        {(alignment || []).length > 1 && <polyline points={chain(alignment)} />}
      </svg>
      <figcaption>{crossed ? "The new road crosses this parcel." : beside ? "The new road passes beside this parcel." : "The dashed line is the new road."}</figcaption>
    </figure>
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
  drawing, measuring, editing, snapping, vertices, width, landRate, buildingRate, disturbancePct, contingencyPct,
  busy, report, options, activeId, note, parcelsOn, aerialOn, parcelStatus, onParcelStatus,
  onWidth, onLand, onBuilding, onDisturbance, onContingency,
  onDraw, onFinish, onReshape, onClear, onSnap, onMeasure, onKeep, onSelect, onShowOption, onRename, onPrefer, onLegal,
  onNote, onParcels, onAerial, onExportFail, projects, projectId, onCreateProject, onSelectProject, savePrompt,
}) {
  const ready = Boolean(report && !report.error);
  const parcels = report?.parcels || [];
  const buildings = report?.buildings || [];
  const points = vertices?.length || 0;
  const [filter, setFilter] = useState("All");
  const [selectedKey, setSelectedKey] = useState("");
  const [areaKind, setAreaKind] = useState("rural");
  const [zoneRates, setZoneRates] = useState({ urban: String(URBAN_PARCEL_RATE_RWF), peri: "", rural: String(landRate), agri: "" });
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
  const [scenarioName, setScenarioName] = useState("");
  const [saveOpen, setSaveOpen] = useState(false);
  const [projectDraft, setProjectDraft] = useState("");
  const [projectOpen, setProjectOpen] = useState(false);
  const seenSavePrompt = useRef(0);
  useEffect(() => {
    if (!savePrompt || savePrompt === seenSavePrompt.current || busy) return;
    seenSavePrompt.current = savePrompt;
    if (!ready) return;
    setScenarioName(`Scenario ${letterOf((options || []).length)}`);
    setSaveOpen(true);
  }, [savePrompt, busy, ready]);
  const full = options.length >= 3;
  const closeProject = () => {
    setProjectOpen(false);
    setProjectDraft("");
  };
  const createProject = () => {
    const name = projectDraft.trim();
    if (!name) return;
    onCreateProject(name);
    closeProject();
  };
  const askToSave = () => {
    setScenarioName((current) => current.trim() || `Scenario ${letterOf(options.length)}`);
    setSaveOpen(true);
  };
  const finishLine = () => onFinish();
  const confirmSave = () => {
    if (!projectId || full || busy || !ready || report?.error) return;
    onKeep(scenarioName.trim() || `Scenario ${letterOf(options.length)}`);
    setScenarioName("");
    setSaveOpen(false);
  };
  const exportCurrent = () => {
    const item = ready ? report : options[0]?.report;
    if (!item) return;
    try { exportBudgetReport(item, options); }
    catch (error) { onExportFail?.(error.message || "Could not export Excel."); }
  };
  const alignment = options.find((option) => option.id === activeId)?.vertices || vertices || [];
  const areaRate = Number(areaKind === "urban" ? zoneRates.urban : zoneRates.rural);
  const chooseArea = (kind) => {
    setAreaKind(kind);
    const rate = Number(kind === "urban" ? zoneRates.urban : zoneRates.rural);
    if (Number.isFinite(rate)) onLand(Math.max(0, rate));
  };
  const parcelBuildings = selected ? (source?.buildings || buildings).filter((building) => buildingOnParcel(selected, building)) : [];

  return (
    <>
      <header className="rr-nav">
        <div className="rr-brand">Road Reserve Management System</div>
        <nav className="rr-tabs" aria-label="Road reserve">
          {SECTIONS.map(([id, label]) => (
            <button key={id} type="button" className={section === id ? "on" : ""} aria-current={section === id ? "page" : undefined} onClick={() => onSection(id)}>{label}</button>
          ))}
        </nav>
        
      </header>
    

      {section === "budget" && (
        <>
          <div className="rr-title">
            <div>
              <h2>Road Reserve / Budgeting tool</h2>
            
            </div>
            <div className="rr-actions">
            <ProjectSearch projects={projects} projectId={projectId} onSelect={onSelectProject} />
            <button type="button" className="rr-btn solid" onClick={() => setProjectOpen(true)}><assetIcons.Plus size={16} />New project</button>
              {/* <button type="button" disabled={!ready || !projectId || full} onClick={saveCurrent}>{full ? "3 scenarios saved" : "Save scenario"}</button> */}
              <button type="button" className="export-excel" disabled={!ready && options.length === 0} onClick={exportCurrent}><assetIcons.ExcelLogo className="file-logo" aria-hidden="true" /><span>Excel</span></button>
              <button type="button" className="print-pdf" disabled={!ready && options.length === 0} onClick={() => printComparison(options.length ? options : [{ label: "Current line", report }], note)}><assetIcons.PdfLogo className="file-logo" aria-hidden="true" /><span>PDF</span></button>
            </div>
          </div>
          <aside className="rr-left">
            <section className="rr-card">
              <p className="rr-step">1. Base road</p>
              <h3>Connect alignment to</h3>
              <RoutePicker catalog={catalog || []} value={routeId || ""} placeholder="Select a route" onChange={onSelectRoute} />
            </section>
            <section className="rr-card">
              <p className="rr-step">2. Draw alignment</p>
              <div className="rr-draw">
                <button type="button" className={drawing ? "on" : ""} onClick={onDraw}><assetIcons.Draw size={15} />{drawing ? "Drawing" : "Draw"}</button>
                <button type="button" className={editing ? "on" : ""} onClick={onReshape}><assetIcons.MdOutlineEditRoad size={15} />Vertices</button>
                <button type="button" className={snapping ? "on" : ""} onClick={onSnap} title="Attaches the start and end of the new road to the selected road. A point within 80 m of that road is placed on it."><assetIcons.Join size={15} />Snap</button>
                <button type="button" className={measuring ? "on" : ""} onClick={onMeasure} title="Click two points on the map. The distance is shown on the map in kilometres."><assetIcons.Ruler size={15} />Measure</button>
                <button type="button" onClick={onClear}><assetIcons.Delete size={15} />Clear</button>
              </div>
              {measuring && <p className="rr-hint">Click the first point, then the second. The distance appears on the map in km. Click again to start over.</p>}
              {snapping && <p className="rr-hint">{routeReady ? `The new road starts and ends on ${routeId}. Points within 80 m stay on the road.` : "Select a base road first. Snap attaches the new road to it."}</p>}
              {drawing && points >= 2 && <button type="button" className="rr-btn solid" onClick={finishLine}>Finish line</button>}
              {!drawing && ready && !activeId && !saveOpen && <button type="button" className="rr-btn solid" onClick={askToSave}>Save scenario</button>}
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
              <p className="rr-step">Saved scenarios</p>
              <h3>Show on the map</h3>
              {!projectId && <p className="rr-hint">Create a project, then save a finished line. Each project holds 3 scenarios.</p>}
              {projectId && options.length === 0 && <p className="rr-hint">Finish a line to save it here. Choose one to draw it on the map.</p>}
              <div className="rr-scenarios">
                {options.map((option, index) => (
                  <button key={option.id} type="button" className={option.id === activeId ? "on" : ""} onClick={() => onShowOption(option.id)}>
                    <b>{letterOf(index)} · {option.label}</b>
                    <span>{formatMetre(option.report?.lengthM)}</span>
                  </button>
                ))}
              </div>
            </section>
          </aside>
          <aside className="rr-right">
            <section className="rr-card">
              <h3>Reserve summary</h3>
              <div className="rr-stats">
                <div><span>Parcels affected</span><b>{ready ? parcels.length : "—"}</b></div>
                <div><span>Buildings affected</span><b>{ready ? buildings.length : "—"}</b></div>
                <div><span>Reserve area</span><b>{ready ? formatSqm(report.corridorSqm) : "—"}</b></div>
                <div><span>Alignment length</span><b>{ready ? formatMetre(report.lengthM) : "—"}</b></div>
              </div>
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
            <header className="rr-buildings">
              <h3>Affected buildings ({ready ? buildings.length : 0})</h3>
            </header>
            <p className="rr-hint">Footprints come from the building layers. A building within 2 m of the reserve is included. Price is the affected area × {formatRwf(buildingRate)} per m².</p>
            <table className="rr-table">
              <thead>
                <tr><th>Building</th><th>Use</th><th>Footprint (m²)</th><th>Affected (m²)</th><th>Price</th></tr>
              </thead>
              <tbody>
                {!ready && <tr><td colSpan={5}>{busy ? "Measuring…" : "Draw and finish an alignment to price building footprints."}</td></tr>}
                {buildings.map((building) => (
                  <tr key={building.key}>
                    <td>{building.name || building.upi || "Building"}{building.near ? " · within 2 m" : ""}</td>
                    <td>{building.use || "—"}</td>
                    <td>{Math.round(building.footprint || building.sqm).toLocaleString()}</td>
                    <td>{Math.round(building.sqm).toLocaleString()}</td>
                    <td>{formatRwf(building.cost)}</td>
                  </tr>
                ))}
                {ready && buildings.length === 0 && <tr><td colSpan={5}>No building footprint within 2 m of this reserve.</td></tr>}
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
                    <ParcelScene parcel={selected} alignment={alignment} buildings={source?.buildings || buildings} />
                    <h4>BUILDINGS ON THIS PARCEL</h4>
                    {parcelBuildings.length === 0 && <p className="rr-hint">No building footprint was found on this parcel.</p>}
                    {parcelBuildings.map((building) => (
                      <p key={building.key}><span>{building.name || building.use || "Building"}</span><b>{formatSqm(building.footprint || building.sqm)}</b></p>
                    ))}
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
                <p><span>Length</span><b>{source ? formatMetre(source.lengthM) : "—"}</b></p>
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
              <p className="rr-hint">0+000 <span style={{ float: "right" }}>{source ? formatMetre(source.lengthM) : ""}</span></p>
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
                <thead><tr><th>Structure</th><th>Use</th><th>Footprint (m²)</th><th>Affected (m²)</th><th>Price</th></tr></thead>
                <tbody>
                  {(source?.buildings || []).map((building) => (
                    <tr key={building.key}><td>{building.name || building.upi || "Building"}</td><td>{building.use || "—"}</td><td>{Math.round(building.footprint || building.sqm || 0).toLocaleString()}</td><td>{Math.round(building.sqm || 0).toLocaleString()}</td><td>{formatRwf(building.cost)}</td></tr>
                  ))}
                  {(source?.buildings || []).length === 0 && <tr><td colSpan={5}>No buildings were found inside the current reserve.</td></tr>}
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
              <h2>{projectId ? `${(projects || []).find((project) => project.id === projectId)?.name || "Project"} · ${options.length} of 3 scenarios` : "Compare alignments"}</h2>
            </div>
            <div className="rr-actions">
              <button type="button" onClick={() => onSection("budget")}>Add saved scenario</button>
              <button type="button" disabled={!options.length} onClick={exportCurrent}>Export Excel</button>
              <button type="button" className="solid" disabled={options.length < 1} onClick={() => printComparison(options, note)}>Export PDF comparison</button>
            </div>
          </div>
          <section className="rr-page">
            {!projectId && <p className="rr-card rr-hint">Create a project first. Each project keeps up to 3 scenarios, and the comparison uses only those.</p>}
            {projectId && options.length === 0 && <p className="rr-card rr-hint">Draw a line on Map and budget, then choose Save scenario. This project can hold 3 scenarios.</p>}
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
              <button type="button" className="solid" onClick={() => onLand(Number(areaKind === "urban" ? zoneRates.urban : zoneRates.rural) || landRate)}>Save changes</button>
            </div>
          </div>
          <section className="rr-page">
            <p className="rr-hint">Choose Urban or Rural on Map and budget. That choice sets the land rate per m². Peri-urban and agricultural rates stay on this screen until you use them.</p>
            <div className="rr-rates">
              <section className="rr-card">
                <h3>Land rates by area</h3>
                <table className="rr-table rr-mini">
                  <tbody>
                    {[["urban", "Urban"], ["rural", "Rural"], ["peri", "Peri-urban"], ["agri", "Agricultural"]].map(([key, label]) => (
                      <tr key={key}>
                        <td>{label}{key === areaKind ? " · used" : ""}</td>
                        <td><input value={zoneRates[key]} onChange={(event) => {
                          const next = { ...zoneRates, [key]: event.target.value };
                          setZoneRates(next);
                          if (key === areaKind) onLand(Number(event.target.value) || 0);
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
      {saveOpen && (
        <div className="rr-modal-backdrop in" onMouseDown={() => setSaveOpen(false)}>
          <div className="rr-modal" role="dialog" aria-modal="true" aria-labelledby="rr-scenario-title" onMouseDown={(event) => event.stopPropagation()}>
            <h2 id="rr-scenario-title">Save this scenario</h2>
            {!projectId && <p>Create a project first. This line stays on the map, and you can save it once the project exists.</p>}
            {projectId && full && <p>This project already has 3 scenarios. Choose one on the map, or create another project.</p>}
            {projectId && !full && <p>Name this alignment to keep it. You can save 3 scenarios in this project, then choose any one to show it on the map.</p>}
            {report?.error && <p>{report.error}</p>}
            {projectId && !full && (
              <label>
                Scenario name
                <input
                  value={scenarioName}
                  autoFocus
                  placeholder="Scenario name"
                  onChange={(event) => setScenarioName(event.target.value)}
                  onKeyDown={(event) => {
                    if (event.key === "Enter") confirmSave();
                    if (event.key === "Escape") setSaveOpen(false);
                  }}
                />
              </label>
            )}
            <div className="rr-actions">
              <button type="button" onClick={() => setSaveOpen(false)}>Not now</button>
              {!projectId && <button type="button" className="solid" onClick={() => setProjectOpen(true)}>Create project</button>}
              {projectId && <button type="button" className="solid" disabled={full || busy || !ready || Boolean(report?.error)} onClick={confirmSave}>Save scenario</button>}
            </div>
          </div>
        </div>
      )}
      <Modal open={projectOpen} name={projectDraft} onName={setProjectDraft} onCreate={createProject} onClose={closeProject} />
    </>
  );
}
