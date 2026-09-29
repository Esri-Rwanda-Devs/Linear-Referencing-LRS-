import { useEffect, useState } from "react";
import { LRS_LAYER_DEFS } from "../config";
import { loadEvents, loadRoute, summariseSegment } from "../lrs/lrsService";
import { ChartSymbol } from "./StripChart";

const loaded = new Map();

async function routeWithEvents(id, current, currentEvents) {
  if (current?.id === id && currentEvents.length) return { route: current, events: currentEvents };
  if (!loaded.has(id)) {
    loaded.set(id, (async () => {
      const route = await loadRoute(id);
      const { events } = await loadEvents(route);
      return { route, events };
    })().catch((error) => {
      loaded.delete(id);
      throw error;
    }));
  }
  return loaded.get(id);
}

const perKm = (count, lengthKm) => (lengthKm > 0 ? count / lengthKm : 0);

function Cell({ value, other, children }) {
  return <td className={value > other ? "more" : ""}>{children}</td>;
}

export default function RouteCompare({ catalog, route, events, onCompareRoute, onOpenRoute, onSelectA, onSelectB }) {
  const [aId, setAId] = useState(route?.id || "");
  const [openLayer, setOpenLayer] = useState(null);
  const [bId, setBId] = useState("");
  const [state, setState] = useState({ loading: false, error: "", a: null, b: null });

  useEffect(() => {
    if (route?.id && !aId) setAId(route.id);
  }, [route, aId]);

  const compare = async () => {
    if (!aId || !bId || aId === bId) {
      setState((prev) => ({ ...prev, error: "Choose two different routes." }));
      return;
    }
    setState({ loading: true, error: "", a: null, b: null });
    try {
      const [a, b] = await Promise.all([routeWithEvents(aId, route, events), routeWithEvents(bId, route, events)]);
      const pack = (item) => ({ ...item, summary: summariseSegment(item.events, 0, item.route.lengthKm) });
      const next = { loading: false, error: "", a: pack(a), b: pack(b) };
      setState(next);
      if (next.a.route.id !== route?.id) onOpenRoute(next.a.route.id);
      onCompareRoute?.({ route: next.b.route, events: next.b.events });
    } catch (error) {
      setState({ loading: false, error: error.message, a: null, b: null });
    }
  };

  const clear = () => {
    setState({ loading: false, error: "", a: null, b: null });
    onCompareRoute?.(null);
  };

  const options = catalog.map((item) => (
    <option key={item.id} value={item.id}>{item.code && item.code !== item.id ? `${item.id} · ${item.code}` : item.id}</option>
  ));

  const { a, b } = state;
  const layerIds = a && b
    ? LRS_LAYER_DEFS.map((def) => def.id).filter((id) => [a, b].some((side) => side.summary.points.some((layer) => layer.layerId === id) || side.summary.spans.some((layer) => layer.layerId === id)))
    : [];

  return (
    <div className="compare">
      <div className="compare-pick">
        <label><i className="swatch a" />Route A<select value={aId} onChange={(event) => setAId(event.target.value)}><option value="">Choose…</option>{options}</select></label>
        <label><i className="swatch b" />Route B<select value={bId} onChange={(event) => setBId(event.target.value)}><option value="">Choose…</option>{options}</select></label>
      </div>
      <div className="segment-actions">
        <button type="button" className="primary" onClick={compare} disabled={state.loading}>{state.loading ? "Loading routes…" : "Compare"}</button>
        {a && b && <button type="button" className="link" onClick={clear}>Clear</button>}
      </div>
      {state.error && <em className="error">{state.error}</em>}

      {a && b && (
        <div className="analysis-results">
          <div className="compare-cards">
            {[["a", a], ["b", b]].map(([side, item]) => {
              const dominant = (layerId) => {
                const span = item.summary.spans.find((layer) => layer.layerId === layerId);
                return span?.values[0] ? `${span.values[0].name} (${Math.round(span.values[0].share * 100)}%)` : "—";
              };
              const count = (layerId) => item.summary.points.find((layer) => layer.layerId === layerId)?.items.length || 0;
              return (
                <div key={side} className={`compare-card ${side}`}>
                  <h5><i className={`swatch ${side}`} />Route {side.toUpperCase()} · {item.route.id}</h5>
                  <dl>
                    <dt>Length</dt><dd>{item.route.lengthKm.toFixed(2)} km</dd>
                    <dt>Assets</dt><dd>{item.summary.pointCount} ({perKm(item.summary.pointCount, item.route.lengthKm).toFixed(1)}/km)</dd>
                    <dt>Pavement</dt><dd title={dominant(8)}>{dominant(8)}</dd>
                    <dt>Drain</dt><dd title={dominant(7)}>{dominant(7)}</dd>
                    <dt>Speed</dt><dd title={dominant(5)}>{dominant(5)}</dd>
                    <dt>Culverts</dt><dd>{count(10)}</dd>
                    <dt>Bridges</dt><dd>{count(13)}</dd>
                  </dl>
                </div>
              );
            })}
          </div>
          <table className="compare-table">
            <thead>
              <tr>
                <th />
                <th><button type="button" onClick={() => onOpenRoute(a.route.id)} title="Open in chart">{a.route.id}</button></th>
                <th><button type="button" onClick={() => onOpenRoute(b.route.id)} title="Open in chart">{b.route.id}</button></th>
              </tr>
            </thead>
            <tbody>
              <tr className="total">
                <th>Length</th>
                <Cell value={a.route.lengthKm} other={b.route.lengthKm}>{a.route.lengthKm.toFixed(2)} km</Cell>
                <Cell value={b.route.lengthKm} other={a.route.lengthKm}>{b.route.lengthKm.toFixed(2)} km</Cell>
              </tr>
              <tr className="total">
                <th>Point assets</th>
                <Cell value={a.summary.pointCount} other={b.summary.pointCount}>{a.summary.pointCount}<small>{perKm(a.summary.pointCount, a.route.lengthKm).toFixed(1)}/km</small></Cell>
                <Cell value={b.summary.pointCount} other={a.summary.pointCount}>{b.summary.pointCount}<small>{perKm(b.summary.pointCount, b.route.lengthKm).toFixed(1)}/km</small></Cell>
              </tr>
              {layerIds.map((id) => {
                const def = LRS_LAYER_DEFS.find((item) => item.id === id);
                if (def.kind === "point") {
                  const countA = a.summary.points.find((layer) => layer.layerId === id)?.items.length || 0;
                  const countB = b.summary.points.find((layer) => layer.layerId === id)?.items.length || 0;
                  const isOpen = openLayer === id;
                  const itemsA = a.summary.points.find((layer) => layer.layerId === id)?.items || [];
                  const itemsB = b.summary.points.find((layer) => layer.layerId === id)?.items || [];
                  const list = (items, onSelect) => (
                    <ul className="compare-assets">
                      {items.slice(0, 60).map((item) => (
                        <li key={item.id}><button type="button" onClick={() => onSelect?.(item)} title={`${item.name} · ${item.measure.toFixed(3)} km`}>
                          <span>{item.name}</span><em>{item.measure.toFixed(2)}</em>
                        </button></li>
                      ))}
                      {items.length > 60 && <li className="more-note">+{items.length - 60} more</li>}
                      {items.length === 0 && <li className="more-note">none</li>}
                    </ul>
                  );
                  return [
                    <tr key={id} className="asset-row" onClick={() => setOpenLayer(isOpen ? null : id)} title="Show the assets on each route">
                      <th><span className="caret">{isOpen ? "▾" : "▸"}</span><svg width="11" height="11" viewBox="0 0 12 12"><ChartSymbol shape={def.shape} color={def.swatch || def.color} x={6} y={6} size={0.6} /></svg>{def.title}</th>
                      <Cell value={countA} other={countB}>{countA}<small>{perKm(countA, a.route.lengthKm).toFixed(1)}/km</small></Cell>
                      <Cell value={countB} other={countA}>{countB}<small>{perKm(countB, b.route.lengthKm).toFixed(1)}/km</small></Cell>
                    </tr>,
                    isOpen && (
                      <tr key={`${id}-list`} className="asset-list">
                        <th />
                        <td>{list(itemsA, onSelectA)}</td>
                        <td>{list(itemsB, onSelectB)}</td>
                      </tr>
                    ),
                  ];
                }
                const spanA = a.summary.spans.find((layer) => layer.layerId === id);
                const spanB = b.summary.spans.find((layer) => layer.layerId === id);
                const top = (span) => (span?.values[0] ? `${span.values[0].name}` : "—");
                const share = (span) => (span?.values[0] ? `${Math.round(span.values[0].share * 100)}% · ${span.values.length} types` : "no data");
                return (
                  <tr key={id} className="attr">
                    <th><svg width="11" height="11" viewBox="0 0 12 12"><ChartSymbol shape="bar" color={def.swatch || def.color} x={6} y={6} size={0.6} /></svg>{def.title}</th>
                    <td title={spanA?.values.map((value) => `${value.name}: ${value.km.toFixed(2)} km`).join("\n")}>{top(spanA)}<small>{share(spanA)}</small></td>
                    <td title={spanB?.values.map((value) => `${value.name}: ${value.km.toFixed(2)} km`).join("\n")}>{top(spanB)}<small>{share(spanB)}</small></td>
                  </tr>
                );
              })}
            </tbody>
          </table>
          <p className="compare-note">Bold marks the higher value. Click an asset row to list and locate its assets on each route. Route B is charted below the main chart.</p>
        </div>
      )}
    </div>
  );
}
