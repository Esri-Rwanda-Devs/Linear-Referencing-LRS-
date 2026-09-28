import { useCallback, useEffect, useMemo, useState } from "react";
import Planner from "./components/Planner";
import StripChart, { ChartSymbol } from "./components/StripChart";
import { LRS_LAYER_DEFS, REQUESTED_ITEM, WINDOW_KM } from "./config";
import { featuresAtMeasure, loadEvents, loadRoute, loadRouteCatalog } from "./lrs/lrsService";
import { locateOnRoute } from "./lrs/geometry";
import { useRoadMap } from "./map/useRoadMap";

const STORE = "rwanda-lrs-projects";

function readProjects() {
  try {
    return JSON.parse(localStorage.getItem(STORE) || "[]");
  } catch {
    return [];
  }
}

export default function App() {
  const [catalog, setCatalog] = useState([]);
  const [routeId, setRouteId] = useState("");
  const [route, setRoute] = useState(null);
  const [events, setEvents] = useState([]);
  const [routeQuery, setRouteQuery] = useState("");
  const [status, setStatus] = useState("Sign in to Road_Asset_LRS_Map. All layers draw first.");
  const [windowKm, setWindowKm] = useState([0, WINDOW_KM]);
  const [cursor, setCursor] = useState(null);
  const [follow, setFollow] = useState(true);
  const [projects, setProjects] = useState(readProjects);
  const [activeId, setActiveId] = useState(null);
  const [activeEvent, setActiveEvent] = useState(null);
  const [mapLayers, setMapLayers] = useState([]);
  const [hiddenLayerIds, setHiddenLayerIds] = useState(() => LRS_LAYER_DEFS.filter((layer) => !layer.route).map((layer) => layer.id));

  useEffect(() => {
    loadRouteCatalog()
      .then((rows) => {
        setCatalog(rows);
        setStatus(rows.length ? `${rows.length} route ids. The map shows every layer. Pick a route id to drive along it.` : "No route ids were returned.");
      })
      .catch((error) => setStatus(error.message));
  }, []);

  useEffect(() => {
    if (!routeId) {
      setRoute(null);
      setEvents([]);
      setCursor(null);
      setActiveEvent(null);
      return undefined;
    }
    let cancel = false;
    setStatus(`Signing in and loading ${routeId} from Road_Asset_LRS_Map…`);
    setRoute(null);
    setEvents([]);
    setMapLayers([]);
    setCursor(null);
    setActiveEvent(null);
    loadRoute(routeId)
      .then(async (next) => {
        if (cancel) return;
        setRoute(next);
        setWindowKm([0, Math.min(WINDOW_KM, next.lengthKm || WINDOW_KM)]);
        setStatus("Reading bridge, culvert, pavement, and network events…");
        const located = await loadEvents(next);
        if (cancel) return;
        setEvents(located.events);
        setMapLayers(located.mapLayers);
        setStatus("");
      })
      .catch((error) => {
        if (!cancel) setStatus(error.message);
      });
    return () => {
      cancel = true;
    };
  }, [routeId]);

  useEffect(() => {
    localStorage.setItem(STORE, JSON.stringify(projects));
  }, [projects]);

  const routeProjects = projects.filter((project) => project.routeId === routeId);
  const activeProject = routeProjects.find((project) => project.id === activeId) || null;

  const routeIndex = Math.max(0, catalog.findIndex((item) => item.id === routeId));
  const stepRoute = (delta) => {
    if (!catalog.length) return;
    const next = catalog[(routeIndex + delta + catalog.length) % catalog.length];
    setRouteId(next.id);
    setActiveId(null);
    setActiveEvent(null);
    setFollow(true);
  };

  const focusEvent = (item) => {
    setActiveEvent(item);
    setCursor({ measure: item.measure, source: "chart" });
    const span = windowKm[1] - windowKm[0];
    const start = Math.max(0, item.measure - span / 2);
    setWindowKm([start, start + span]);
  };

  const onHoverLonLat = useCallback((longitude, latitude) => {
    if (!route) return;
    const hit = locateOnRoute(route.vertices, route.measures, [longitude, latitude], 0.25);
    if (!hit) return;
    setCursor((current) => {
      if (current && Math.abs(current.measure - hit.measure) < 0.01) return current;
      return { measure: hit.measure, source: "map" };
    });
    if (follow) {
      setWindowKm((prev) => {
        const span = prev[1] - prev[0];
        if (hit.measure >= prev[0] + span * 0.2 && hit.measure <= prev[1] - span * 0.2) return prev;
        const start = Math.max(0, Math.min(route.lengthKm - span, hit.measure - span / 2));
        return [start, start + span];
      });
    }
  }, [route, follow]);

  const onLeave = useCallback(() => {}, []);
  const [focusing, setFocusing] = useState(null);
  const mapRef = useRoadMap({
    onFocusChange: setFocusing,
    onPickRoute: (id) => {
      setRouteId(id);
      setActiveId(null);
      setActiveEvent(null);
      setFollow(true);
    },
    route,
    cursor,
    project: activeProject,
    activeEvent,
    hiddenLayerIds,
    onHoverMeasure: onHoverLonLat,
    onLeave,
  });

  const nearby = useMemo(() => {
    if (!cursor) return [];
    return featuresAtMeasure(events, cursor.measure, 0.4);
  }, [cursor, events]);

  const grouped = useMemo(() => {
    const bags = new Map();
    nearby.forEach((item) => {
      const list = bags.get(item.group) || [];
      list.push(item);
      bags.set(item.group, list);
    });
    return [...bags.entries()];
  }, [nearby]);

  const shiftWindow = (delta) => {
    if (!route) return;
    setWindowKm(([from, to]) => {
      const span = to - from;
      const start = Math.max(0, Math.min(route.lengthKm - span, from + delta));
      return [start, start + span];
    });
  };

  return (
    <div className="app">
      <header className="topbar">
        <div>
          <p className="eyebrow">Rwanda Space Agency · Linear referencing</p>
          <h1>Inline asset chart</h1>
        </div>
        <p className="source">
          Signin to Road_Asset_LRS_Map to view the map.
        </p>
      </header>
      <div className="workspace">
        <Planner
          route={route}
          windowKm={windowKm}
          projects={routeProjects}
          events={events}
          activeId={activeId}
          onSelect={(project) => {
            setActiveId(project.id);
            const pad = Math.max(0.2, (project.endKm - project.startKm) * 0.1);
            setWindowKm([Math.max(0, project.startKm - pad), project.endKm + pad]);
            setFollow(false);
          }}
          onUpdate={(next) => setProjects((prev) => prev.map((project) => (project.id === next.id ? next : project)))}
          onDelete={(target) => {
            setProjects((prev) => prev.filter((project) => project.id !== target.id));
            setActiveId(null);
          }}
          onCreate={(draft) => {
            const project = { ...draft, id: `p-${Date.now()}` };
            setProjects((prev) => [project, ...prev]);
            setActiveId(project.id);
          }}
        />
        <main>
          <section className="map-pane">
            <div ref={mapRef} className="map" />
            {(focusing || (routeId && !route && status.startsWith("Signing in"))) && (
              <div className="map-loader" role="status">
                <span className="spinner" />
                {focusing || `Loading route ${routeId}…`}
              </div>
            )}
            <ul className="legend">
              {LRS_LAYER_DEFS.map((layer) => {
                const hidden = hiddenLayerIds.includes(layer.id);
                return (
                  <li key={layer.id}>
                    <button
                      type="button"
                      className={hidden ? "off" : ""}
                      aria-pressed={!hidden}
                      onClick={() => setHiddenLayerIds((current) => (
                        current.includes(layer.id) ? current.filter((id) => id !== layer.id) : [...current, layer.id]
                      ))}
                    >
                      <input type="checkbox" readOnly checked={!hidden} />
                      <svg className="legend-symbol" width="14" height="14" viewBox="0 0 14 14">
                        <ChartSymbol shape={layer.kind === "point" ? layer.shape : "bar"} color={layer.swatch} x={7} y={7} size={0.7} />
                      </svg>
                      {layer.title}
                    </button>
                  </li>
                );
              })}
            </ul>
            <div className="cursor-card">
              <strong>{cursor ? `${cursor.measure.toFixed(2)} km` : "Hover the amber route"}</strong>
              {route && <span>{route.id} · {route.trajectory}</span>}
              {grouped.length === 0 && <em>Features under the cursor appear here, grouped the same way as the chart.</em>}
              {grouped.map(([group, items]) => (
                <div key={group}>
                  <b>{group}</b>
                  <ul>
                    {items.slice(0, group === "POI" ? 4 : 6).map((item) => (
                      <li key={item.id} className="hover-item">
                        <div className="hover-title">
                          <svg width="12" height="12" viewBox="0 0 12 12">
                            <ChartSymbol shape={item.kind === "span" ? "bar" : item.shape} color={item.color} x={6} y={6} size={0.65} />
                          </svg>
                          <span>{item.title}: <strong>{item.name}</strong></span>
                        </div>
                        <div className="hover-km">
                          {item.kind === "span" ? `${item.from.toFixed(2)} – ${item.to.toFixed(2)} km` : `${item.measure.toFixed(3)} km`}
                        </div>
                        {item.kind !== "span" && item.details?.length > 0 && (
                          <dl className="hover-details">
                            {item.details.filter(([label]) => !/^measure$/i.test(label)).slice(0, 5).map(([label, value]) => (
                              <div key={label}><dt>{label}</dt><dd>{value}</dd></div>
                            ))}
                          </dl>
                        )}
                      </li>
                    ))}
                    {items.length > (group === "POI" ? 4 : 6) && <li className="hover-more">+{items.length - (group === "POI" ? 4 : 6)} more in the chart</li>}
                  </ul>
                </div>
              ))}
            </div>
          </section>
          <section className="chart-pane">
            <div className="station-bar">
              <button type="button" onClick={() => stepRoute(-1)} aria-label="Previous route">Prev route</button>
              <label>Find route id
                <input value={routeQuery} onChange={(event) => setRouteQuery(event.target.value)} placeholder="Type a route id" />
              </label>
              <label>Route
                <select value={routeId} onChange={(event) => { setRouteId(event.target.value); setActiveId(null); setActiveEvent(null); setFollow(true); }}>
                  <option value="">All routes</option>
                  {catalog.filter((item) => item.id.toLowerCase().includes(routeQuery.trim().toLowerCase())).map((item) => (
                    <option key={item.id} value={item.id}>{item.code && item.code !== item.id ? `${item.id} · ${item.code}` : item.id}</option>
                  ))}
                </select>
              </label>
              <button type="button" onClick={() => stepRoute(1)} aria-label="Next route">Next route</button>
              <button type="button" onClick={() => shiftWindow(-1)} aria-label="Pan station window back">‹</button>
              <label>Start
                <input
                  type="number"
                  step="0.1"
                  value={windowKm[0].toFixed(2)}
                  onChange={(event) => setWindowKm([Number(event.target.value), windowKm[1]])}
                />
              </label>
              <label>End
                <input
                  type="number"
                  step="0.1"
                  value={windowKm[1].toFixed(2)}
                  onChange={(event) => setWindowKm([windowKm[0], Number(event.target.value)])}
                />
              </label>
              <button type="button" onClick={() => shiftWindow(1)} aria-label="Pan station window forward">›</button>
              <label className="check">
                <input type="checkbox" checked={follow} onChange={(event) => setFollow(event.target.checked)} />
                Follow cursor
              </label>
              <span className="status">{status || (route ? `${route.lengthKm.toFixed(1)} km · ${events.length} located features` : "")}</span>
            </div>
            {route && (
              <StripChart
                events={events}
                projects={routeProjects}
                route={route}
                windowKm={windowKm}
                cursor={cursor}
                onWindow={(start, end) => {
                  const span = end - start;
                  const from = Math.max(0, Math.min((route.lengthKm || span) - span, start));
                  setWindowKm([from, from + span]);
                }}
                onHoverMeasure={(measure) => {
                  const clamped = Math.max(0, Math.min(route.lengthKm, measure));
                  setCursor({ measure: clamped, source: "chart" });
                }}
                activeEventId={activeEvent?.id}
                attachedIds={(activeProject?.attached || []).map((item) => item.id)}
                onSelectEvent={focusEvent}
                onPickProject={(project) => setActiveId(project.id)}
              />
            )}
          </section>
        </main>
      </div>
    </div>
  );
}
