import { useEffect, useMemo, useState } from "react";
import { summariseSegment } from "../lrs/lrsService";
import { ChartSymbol } from "./StripChart";

const km = (value) => `${value.toFixed(value < 10 ? 3 : 2)} km`;

export default function SegmentAnalysis({ route, events, segment, selecting, windowKm, onSegment, onSelecting, onSelectEvent }) {
  const [draft, setDraft] = useState({ from: "", to: "" });
  const [open, setOpen] = useState(null);

  useEffect(() => {
    setDraft(segment ? { from: segment.from.toFixed(3), to: segment.to.toFixed(3) } : { from: "", to: "" });
  }, [segment]);

  const summary = useMemo(() => (segment ? summariseSegment(events, segment.from, segment.to) : null), [events, segment]);

  if (!route) return <p className="analysis-origin">Pick a route first, then choose a stretch of it to analyse.</p>;

  const apply = (from, to) => {
    const a = Math.max(0, Math.min(route.lengthKm, Number(from)));
    const b = Math.max(0, Math.min(route.lengthKm, Number(to)));
    if (!Number.isFinite(a) || !Number.isFinite(b) || Math.abs(b - a) < 0.005) return;
    onSegment({ from: Math.min(a, b), to: Math.max(a, b) });
  };

  return (
    <div className="segment">
      <p className="analysis-origin">
        {route.id} · 0 – {route.lengthKm.toFixed(2)} km
        <span>Type a start and end, use the chart window, or drag across the chart.</span>
      </p>
      <form className="segment-range" onSubmit={(event) => { event.preventDefault(); apply(draft.from, draft.to); }}>
        <label>From<input type="number" step="0.01" min="0" max={route.lengthKm} value={draft.from} onChange={(event) => setDraft({ ...draft, from: event.target.value })} /></label>
        <label>To<input type="number" step="0.01" min="0" max={route.lengthKm} value={draft.to} onChange={(event) => setDraft({ ...draft, to: event.target.value })} /></label>
        <button type="submit">Analyse</button>
      </form>
      <div className="segment-actions">
        <button type="button" onClick={() => apply(windowKm[0], windowKm[1])}>Use chart window</button>
        <button type="button" className={selecting ? "on" : ""} onClick={() => onSelecting(!selecting)}>
          {selecting ? "Drag on chart… (cancel)" : "Drag on chart"}
        </button>
        {segment && <button type="button" className="link" onClick={() => onSegment(null)}>Clear</button>}
      </div>

      {summary && (
        <div className="analysis-results segment-summary">
          <div className="segment-length">
            <b>{km(summary.lengthKm)}</b>
            <span>{summary.pointCount} point assets · {summary.spans.length} attribute layers</span>
          </div>

          {summary.points.length > 0 && <h4>Point assets</h4>}
          {summary.points.map((layer) => (
            <div key={layer.layerId} className="segment-layer">
              <button type="button" className="segment-row" onClick={() => setOpen(open === layer.layerId ? null : layer.layerId)}>
                <svg width="12" height="12" viewBox="0 0 12 12"><ChartSymbol shape={layer.shape} color={layer.color} x={6} y={6} size={0.65} /></svg>
                <span>{layer.title}</span>
                <strong>{layer.items.length}</strong>
              </button>
              {open === layer.layerId && (
                <ul className="segment-items">
                  {layer.items.map((item) => (
                    <li key={item.id}>
                      <button type="button" onClick={() => onSelectEvent(item)}>
                        <span>{item.name}</span><em>{item.measure.toFixed(3)}</em>
                      </button>
                    </li>
                  ))}
                </ul>
              )}
            </div>
          ))}

          {summary.spans.length > 0 && <h4>Road attributes</h4>}
          {summary.spans.map((layer) => (
            <div key={layer.layerId} className="segment-layer">
              <div className="segment-row static">
                <svg width="12" height="12" viewBox="0 0 12 12"><ChartSymbol shape="bar" color={layer.color} x={6} y={6} size={0.65} /></svg>
                <span>{layer.title}</span>
                <strong>{km(layer.coveredKm)}</strong>
              </div>
              <div className="segment-bar">
                {layer.values.map((value, index) => (
                  <i key={value.name} style={{ width: `${value.share * 100}%`, background: value.color, opacity: value.color === layer.color ? 1 - Math.min(0.7, index * 0.18) : 1 }} title={`${value.name}: ${km(value.km)}`} />
                ))}
              </div>
              <ul className="segment-values">
                {layer.values.map((value) => (
                  <li key={value.name}>
                    <span><i className="value-dot" style={{ background: value.color }} />{value.name}</span>
                    <em>{km(value.km)} · {Math.round(value.share * 100)}%</em>
                  </li>
                ))}
              </ul>
            </div>
          ))}
          {summary.pointCount === 0 && summary.spans.length === 0 && <em>No assets recorded on this stretch.</em>}
        </div>
      )}
    </div>
  );
}
