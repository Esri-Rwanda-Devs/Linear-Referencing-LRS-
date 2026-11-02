import { createPortal } from "react-dom";
import { exportBudgetReport } from "../lrs/excel";
import { formatMetre, formatRwf, formatSqm } from "../cost/corridor";

function money(value) {
  return formatRwf(value);
}

function ReportBody({ report }) {
  const buildings = report.buildings || [];
  return (
    <>
      <table className="cost-summary">
        <tbody>
          <tr><th>Line length</th><td>{formatMetre(report.lengthM)}</td></tr>
          <tr><th>Reserve width</th><td>{formatMetre(report.widthM)}</td></tr>
          <tr><th>Reserve area</th><td>{formatSqm(report.corridorSqm)}</td></tr>
          <tr><th>Parcels affected</th><td>{report.parcels.length}</td></tr>
          <tr><th>Parcel area taken</th><td>{formatSqm(report.parcelSqm)}</td></tr>
          <tr><th>Buildings affected</th><td>{buildings.length}</td></tr>
          <tr><th>Building area</th><td>{formatSqm(report.buildingSqm)}</td></tr>
          <tr><th>Land cost</th><td>{money(report.landCost)} · {money(report.landRate)} / m²</td></tr>
          <tr><th>Building cost</th><td>{money(report.buildingCost)} · {money(report.buildingRate)} / m²</td></tr>
          <tr><th>Compensation</th><td>{money(report.compensation)} · {report.compensationPct || 0}%</td></tr>
          <tr><th>Estimated total</th><td>{money(report.totalCost)}</td></tr>
          <tr><th>Mapped assets</th><td>{report.assets.length}</td></tr>
        </tbody>
      </table>
      <h3>Summary</h3>
      <table className="cost-table">
        <thead><tr><th>Layer</th><th>Count</th><th>Area</th></tr></thead>
        <tbody>
          <tr><td>Reserve</td><td>1</td><td>{formatSqm(report.corridorSqm)}</td></tr>
          <tr><td>Parcels</td><td>{report.parcels.length}</td><td>{formatSqm(report.parcelSqm)}</td></tr>
          <tr><td>Buildings</td><td>{buildings.length}</td><td>{formatSqm(report.buildingSqm)}</td></tr>
          <tr><td>Mapped assets</td><td>{report.assets.length}</td><td>—</td></tr>
        </tbody>
      </table>
      <h3>Affected parcels</h3>
      <table className="cost-table">
        <thead>
          <tr>
            <th>UPI</th><th>Parcel</th><th>Province</th><th>District</th><th>Sector</th><th>Cell</th><th>Village</th><th>Recorded size</th><th>Area taken</th><th>Cost</th>
          </tr>
        </thead>
        <tbody>
          {report.parcels.length === 0 && <tr><td colSpan={10}>No parcels intersect this reserve.</td></tr>}
          {report.parcels.map((parcel) => (
            <tr key={parcel.key}>
              <td>{parcel.upi || "—"}</td>
              <td>{parcel.parcelNumber || "—"}</td>
              <td>{parcel.province || "—"}</td>
              <td>{parcel.district || "—"}</td>
              <td>{parcel.sector || "—"}</td>
              <td>{parcel.cell || "—"}</td>
              <td>{parcel.village || "—"}</td>
              <td>{parcel.recordedSize || "—"}</td>
              <td>{formatSqm(parcel.sqm)}</td>
              <td>{money(parcel.cost)}</td>
            </tr>
          ))}
        </tbody>
      </table>
      <h3>Affected buildings</h3>
      <table className="cost-table">
        <thead>
          <tr><th>UPI</th><th>Name</th><th>Use</th><th>District</th><th>Kind</th><th>Area</th><th>Cost</th></tr>
        </thead>
        <tbody>
          {buildings.length === 0 && <tr><td colSpan={7}>No buildings intersect this reserve.</td></tr>}
          {buildings.map((building) => (
            <tr key={building.key}>
              <td>{building.upi || "—"}</td>
              <td>{building.name || "—"}</td>
              <td>{building.use || "—"}</td>
              <td>{building.district || "—"}</td>
              <td>{building.kind === "point" ? "Point" : "Footprint"}</td>
              <td>{formatSqm(building.sqm)}</td>
              <td>{money(building.cost)}</td>
            </tr>
          ))}
        </tbody>
      </table>
      <h3>Mapped assets</h3>
      <table className="cost-table">
        <thead>
          <tr><th>Layer</th><th>Name</th><th>Route</th><th>Value</th><th>Measure</th><th>Details</th></tr>
        </thead>
        <tbody>
          {report.assets.length === 0 && <tr><td colSpan={6}>No mapped assets intersect this reserve.</td></tr>}
          {report.assets.map((asset) => (
            <tr key={asset.key}>
              <td>{asset.layer}</td>
              <td>{asset.name || "—"}</td>
              <td>{asset.route || "—"}</td>
              <td>{asset.value || "—"}</td>
              <td>{asset.measure == null ? "—" : `${Number(asset.measure).toFixed(2)} km`}</td>
              <td>{asset.details || "—"}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </>
  );
}

const esc = (value) => String(value ?? "—")
  .replace(/&/g, "&amp;")
  .replace(/</g, "&lt;")
  .replace(/>/g, "&gt;");

function printReport(report) {
  const buildings = report.buildings || [];
  const row = (cells) => `<tr>${cells.map((cell) => `<td>${esc(cell)}</td>`).join("")}</tr>`;
  const parcelRows = report.parcels.length
    ? report.parcels.map((parcel) => row([
      parcel.upi, parcel.parcelNumber, parcel.province, parcel.district, parcel.sector, parcel.cell, parcel.village,
      parcel.recordedSize, formatSqm(parcel.sqm), money(parcel.cost),
    ])).join("")
    : `<tr><td colspan="10">No parcels intersect this reserve.</td></tr>`;
  const buildingRows = buildings.length
    ? buildings.map((building) => row([
      building.upi, building.name, building.use, building.district, building.kind, formatSqm(building.sqm), money(building.cost),
    ])).join("")
    : `<tr><td colspan="7">No buildings intersect this reserve.</td></tr>`;
  const assetRows = report.assets.length
    ? report.assets.map((asset) => row([
      asset.layer, asset.name, asset.route, asset.value,
      asset.measure == null ? "—" : `${Number(asset.measure).toFixed(2)} km`,
      asset.details,
    ])).join("")
    : `<tr><td colspan="6">No mapped assets intersect this reserve.</td></tr>`;
  const frame = document.createElement("iframe");
  frame.title = "Road reserve budget";
  frame.style.cssText = "position:fixed;width:0;height:0;border:0";
  document.body.appendChild(frame);
  const page = frame.contentWindow;
  page.document.open();
  page.document.write(`<!DOCTYPE html><html><head><title>Road reserve budget</title>
    <style>
      body { font-family: "Segoe UI", sans-serif; color: #1c1917; margin: 24px; }
      h1 { font-size: 22px; margin: 0 0 4px; }
      h2 { font-size: 15px; margin: 18px 0 8px; }
      p { color: #44403c; font-size: 13px; }
      table { border-collapse: collapse; width: 100%; margin-bottom: 8px; font-size: 12px; }
      th, td { border: 1px solid #d6d3d1; padding: 6px 8px; text-align: left; vertical-align: top; }
      th { background: #f5f5f4; }
      .cost-summary th { width: 220px; }
    </style></head><body>
    <h1>Road reserve budget</h1>
    <p>${esc(new Date().toLocaleString())} · Land ${esc(money(report.landRate))} / m² · Buildings ${esc(money(report.buildingRate))} / m² · Compensation ${esc(report.compensationPct || 0)}%.</p>
    <table class="cost-summary">
      <tr><th>Line length</th><td>${esc(formatMetre(report.lengthM))}</td></tr>
      <tr><th>Reserve width</th><td>${esc(formatMetre(report.widthM))}</td></tr>
      <tr><th>Reserve area</th><td>${esc(formatSqm(report.corridorSqm))}</td></tr>
      <tr><th>Parcels affected</th><td>${report.parcels.length}</td></tr>
      <tr><th>Parcel area taken</th><td>${esc(formatSqm(report.parcelSqm))}</td></tr>
      <tr><th>Buildings affected</th><td>${buildings.length}</td></tr>
      <tr><th>Building area</th><td>${esc(formatSqm(report.buildingSqm))}</td></tr>
      <tr><th>Land cost</th><td>${esc(money(report.landCost))}</td></tr>
      <tr><th>Building cost</th><td>${esc(money(report.buildingCost))}</td></tr>
      <tr><th>Compensation</th><td>${esc(money(report.compensation))}</td></tr>
      <tr><th>Estimated total</th><td>${esc(money(report.totalCost))}</td></tr>
      <tr><th>Mapped assets</th><td>${report.assets.length}</td></tr>
    </table>
    <h2>Summary</h2>
    <table><thead><tr><th>Layer</th><th>Count</th><th>Area</th></tr></thead><tbody>
      <tr><td>Reserve</td><td>1</td><td>${esc(formatSqm(report.corridorSqm))}</td></tr>
      <tr><td>Parcels</td><td>${report.parcels.length}</td><td>${esc(formatSqm(report.parcelSqm))}</td></tr>
      <tr><td>Buildings</td><td>${buildings.length}</td><td>${esc(formatSqm(report.buildingSqm))}</td></tr>
    </tbody></table>
    <h2>Affected parcels</h2>
    <table><thead><tr><th>UPI</th><th>Parcel</th><th>Province</th><th>District</th><th>Sector</th><th>Cell</th><th>Village</th><th>Recorded size</th><th>Area taken</th><th>Cost</th></tr></thead><tbody>${parcelRows}</tbody></table>
    <h2>Affected buildings</h2>
    <table><thead><tr><th>UPI</th><th>Name</th><th>Use</th><th>District</th><th>Kind</th><th>Area</th><th>Cost</th></tr></thead><tbody>${buildingRows}</tbody></table>
    <h2>Mapped assets</h2>
    <table><thead><tr><th>Layer</th><th>Name</th><th>Route</th><th>Value</th><th>Measure</th><th>Details</th></tr></thead><tbody>${assetRows}</tbody></table>
    </body></html>`);
  page.document.close();
  page.focus();
  page.print();
  page.onafterprint = () => frame.remove();
  window.setTimeout(() => frame.remove(), 60000);
  return true;
}

function rateInput(label, value, onChange, step) {
  return (
    <label>
      {label}
      <input type="number" min="0" step={step} value={value} onChange={(event) => onChange(event.target.value)} />
    </label>
  );
}

export default function CostPlan({
  drawing, editing, vertices, width, landRate, buildingRate, compensationPct,
  busy, report, open, options, activeId,
  onWidth, onLand, onBuilding, onCompensation,
  onDraw, onFinish, onReshape, onApply, onKeep, onShowOption, onRemoveOption,
  onOpen, onClear, onClose, onExportFail,
}) {
  const ready = Boolean(report && !report.error);
  const points = vertices?.length || 0;
  return (
    <>
      <aside className="cost-side">
        <h2>Budget the reserve</h2>
        <p>Draw the proposed road, set the reserve width, then finish. Parcels and buildings inside the reserve are costed from the rates below.</p>
        {rateInput("Reserve width (m)", width, onWidth, "1")}
        {rateInput("Land (RWF / m²)", landRate, onLand, "1")}
        {rateInput("Buildings (RWF / m²)", buildingRate, onBuilding, "100")}
        {rateInput("Compensation (%)", compensationPct, onCompensation, "0.5")}
        <div className="cost-actions">
          <button type="button" className="primary" onClick={onDraw}>{drawing ? (points ? "Adding points" : "Click the start") : "Draw line"}</button>
          <button type="button" onClick={onFinish} disabled={!drawing || points < 2}>Finish</button>
          <button type="button" onClick={onClear}>Clear</button>
        </div>
        {drawing && <p>{points < 2 ? "Click each bend, then double-click or Finish." : `${points} points. Double-click or Finish to measure.`}</p>}
        {ready && <button type="button" className="cost-apply" onClick={onApply}>Update reserve</button>}
        {ready && <button type="button" className={`cost-apply${editing ? " on" : ""}`} onClick={onReshape}>{editing ? "Drag a point to reshape" : "Reshape line"}</button>}
        {editing && <p>Drag a vertex, or click the line to add a bend.</p>}
        {busy && <p>Measuring parcels and buildings…</p>}
        {ready && (
          <button type="button" className="cost-open" onClick={onOpen}>
            View budget · {report.parcels.length} parcels · {report.buildings?.length || 0} buildings · {formatRwf(report.totalCost)}
          </button>
        )}
        {ready && <button type="button" className="cost-apply" onClick={onKeep}>Save for comparison</button>}
        {options.length > 0 && (
          <>
            <h3>Options</h3>
            <table className="cost-table">
              <thead><tr><th>Option</th><th>Width</th><th>Total</th><th></th></tr></thead>
              <tbody>
                {options.map((option) => (
                  <tr key={option.id} className={option.id === activeId ? "on" : ""}>
                    <td><button type="button" className="cost-option" onClick={() => onShowOption(option.id)}>{option.label}</button></td>
                    <td>{formatMetre(option.width)}</td>
                    <td>{money(option.report?.totalCost)}</td>
                    <td><button type="button" onClick={() => onRemoveOption(option.id)} aria-label={`Remove ${option.label}`}>×</button></td>
                  </tr>
                ))}
              </tbody>
            </table>
          </>
        )}
      </aside>
      {open && (report || busy) && createPortal(
        <div className="cost-modal" role="dialog" aria-modal="true" aria-labelledby="cost-report-title">
          <div className="cost-modal-card">
            <header>
              <div>
                <h2 id="cost-report-title">Road reserve budget</h2>
                <p>Land, buildings, and compensation inside the reserve.</p>
              </div>
              <div className="cost-actions">
                <button type="button" className="print-pdf" disabled={!ready || busy} onClick={() => { if (!printReport(report)) onExportFail?.(); }}>PDF</button>
                <button
                  type="button"
                  disabled={!ready || busy}
                  onClick={() => {
                    try { exportBudgetReport(report, options); }
                    catch (error) { onExportFail?.(error.message || "Could not export Excel."); }
                  }}
                >Excel</button>
                <button type="button" onClick={onClose}>Close</button>
              </div>
            </header>
            {!report ? <p>Measuring parcels and buildings…</p> : report.error ? <p>{report.error}</p> : <ReportBody report={report} />}
          </div>
        </div>,
        document.body
      )}
    </>
  );
}
