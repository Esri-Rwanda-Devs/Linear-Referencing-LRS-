import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { createPortal } from "react-dom";
import Planner from "./components/Planner";
import SegmentAnalysis from "./components/SegmentAnalysis";
import RouteCompare from "./components/RouteCompare";
import StripChart, { ChartSymbol } from "./components/StripChart";
import { LRS_LAYER_DEFS, REQUESTED_ITEM, WINDOW_KM } from "./config";
import { failedLayerTitles, featuresAtMeasure, loadEvents, loadRoute, loadRouteCatalog, nearestRoads } from "./lrs/lrsService";
import { locateOnRoute } from "./lrs/geometry";
import { useRoadMap } from "./map/useRoadMap";

const STORE = "rwanda-lrs-projects";
const CHART_STORE = "rwanda-lrs-chart-height";
const CHART_DEFAULT = 340;
const CHART_MIN = 40;
const MAP_MIN = 120;
const NO_PROJECTS = [];
const noop = () => {};

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
  const [status, setStatus] = useState("");
  const [windowKm, setWindowKm] = useState([0, WINDOW_KM]);
  const [cursor, setCursor] = useState(null);
  const [follow, setFollow] = useState(true);
  const [projects, setProjects] = useState(readProjects);
  const [activeId, setActiveId] = useState(null);
  const [activeEvent, setActiveEvent] = useState(null);
  const [mapLayers, setMapLayers] = useState([]);
  const [origin, setOrigin] = useState(null);
  const [radiusM, setRadiusM] = useState(500);
  const [pickingOrigin, setPickingOrigin] = useState(false);
  const [nearest, setNearest] = useState({ loading: false, results: [], error: "" });
  const pendingPoint = useRef(null);
  const [panelHost] = useState(() => document.createElement("div"));
  const [panelTab, setPanelTab] = useState("nearest");
  const [legendOpen, setLegendOpen] = useState(true);
  const mainRef = useRef(null);
  const [chartH, setChartH] = useState(() => Number(localStorage.getItem(CHART_STORE)) || CHART_DEFAULT);
  useEffect(() => {
    localStorage.setItem(CHART_STORE, String(Math.round(chartH)));
  }, [chartH]);
  const clampChart = useCallback((height) => {
    const total = mainRef.current?.clientHeight || window.innerHeight;
    return Math.round(Math.max(CHART_MIN, Math.min(total - MAP_MIN, height)));
  }, []);
  const rowsFor = (height) => `minmax(${MAP_MIN}px, 1fr) 10px ${height}px`;
  const startResize = (event) => {
    event.preventDefault();
    const startY = event.clientY;
    const startH = chartH;
    let next = startH;
    let frame = 0;
    const move = (moveEvent) => {
      next = clampChart(startH + (startY - moveEvent.clientY));
      if (frame) return;
      frame = requestAnimationFrame(() => {
        frame = 0;
        if (mainRef.current) mainRef.current.style.gridTemplateRows = rowsFor(next);
      });
    };
    const up = () => {
      window.removeEventListener("pointermove", move);
      window.removeEventListener("pointerup", up);
      document.body.classList.remove("resizing-chart");
      if (frame) cancelAnimationFrame(frame);
      setChartH(next);
    };
    window.addEventListener("pointermove", move);
    window.addEventListener("pointerup", up);
    document.body.classList.add("resizing-chart");
  };
  const paneRef = useRef(null);
  const fitChart = useCallback((maxShare = 1) => {
    const pane = paneRef.current;
    const total = mainRef.current?.clientHeight || window.innerHeight;
    if (!pane) return;
    const needed = pane.scrollHeight + 2;
    setChartH((height) => clampChart(Math.max(maxShare < 1 ? height : 0, Math.min(needed, total * maxShare))));
  }, [clampChart]);
  const nudgeChart = (direction) => {
    const total = mainRef.current?.clientHeight || window.innerHeight;
    setChartH((height) => clampChart(height + direction * total * 0.2));
  };
  useEffect(() => {
    const onResize = () => setChartH((height) => clampChart(height));
    window.addEventListener("resize", onResize);
    return () => window.removeEventListener("resize", onResize);
  }, [clampChart]);
  const [compare, setCompare] = useState(null);
  const [compareWindow, setCompareWindow] = useState([0, WINDOW_KM]);
  const [compareCursor, setCompareCursor] = useState(null);
  const [compareEvent, setCompareEvent] = useState(null);
  const compareShown = compare && compare.route.id !== routeId ? compare : null;
  const [segment, setSegment] = useState(null);
  const [selectingSegment, setSelectingSegment] = useState(false);
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
    setStatus(`Loading route ${routeId} …`);
    setRoute(null);
    setEvents([]);
    setMapLayers([]);
    setSegment(null);
    setSelectingSegment(false);
    setCursor(null);
    setActiveEvent(null);
    loadRoute(routeId)
      .then(async (next) => {
        if (cancel) return;
        setRoute(next);
        const span = Math.min(WINDOW_KM, next.lengthKm || WINDOW_KM);
        const hit = pendingPoint.current && locateOnRoute(next.vertices, next.measures, pendingPoint.current, 2);
        pendingPoint.current = null;
        if (hit) {
          const start = Math.max(0, Math.min(next.lengthKm - span, hit.measure - span / 2));
          setWindowKm([start, start + span]);
          setCursor({ measure: hit.measure, source: "analysis" });
        } else {
          setWindowKm([0, span]);
        }
        setStatus("Reading bridge, culvert, pavement, and network events…");
        const located = await loadEvents(next);
        if (cancel) return;
        setEvents(located.events);
        setMapLayers(located.mapLayers);
        const failed = failedLayerTitles();
        setStatus(failed.length ? `Could not load: ${failed.join(", ")}. Reload the page to try again.` : "");
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
    const other = compareShown && locateOnRoute(compareShown.route.vertices, compareShown.route.measures, [longitude, latitude], 0.25);
    if (other && (!hit || other.distanceKm < hit.distanceKm)) {
      setCompareCursor((current) => (current && Math.abs(current.measure - other.measure) < 0.01 ? current : { measure: other.measure, source: "map" }));
      setCompareWindow((prev) => {
        const span = prev[1] - prev[0];
        if (other.measure >= prev[0] + span * 0.2 && other.measure <= prev[1] - span * 0.2) return prev;
        const start = Math.max(0, Math.min(compareShown.route.lengthKm - span, other.measure - span / 2));
        return [start, start + span];
      });
      return;
    }
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
  }, [route, follow, compareShown]);

  useEffect(() => {
    if (!origin) {
      setNearest({ loading: false, results: [], error: "" });
      return undefined;
    }
    let cancel = false;
    setNearest((prev) => ({ ...prev, loading: true, error: "" }));
    const timer = setTimeout(() => {
      nearestRoads(origin.point, radiusM / 1000)
        .then((results) => { if (!cancel) setNearest({ loading: false, results, error: "" }); })
        .catch((error) => { if (!cancel) setNearest({ loading: false, results: [], error: error.message }); });
    }, 200);
    return () => {
      cancel = true;
      clearTimeout(timer);
    };
  }, [origin, radiusM]);

  const onOrigin = useCallback((point, label) => {
    setOrigin({ point, label });
    setPickingOrigin(false);
  }, []);

  const openNearest = (item) => {
    if (item.id === routeId && route) {
      const hit = locateOnRoute(route.vertices, route.measures, item.point, 2);
      if (hit) {
        const span = windowKm[1] - windowKm[0];
        const start = Math.max(0, Math.min(route.lengthKm - span, hit.measure - span / 2));
        setWindowKm([start, start + span]);
        setCursor({ measure: hit.measure, source: "analysis" });
      }
      return;
    }
    pendingPoint.current = item.point;
    setRouteId(item.id);
    setActiveId(null);
    setActiveEvent(null);
    setFollow(true);
  };

  const analysis = useMemo(() => (origin ? { origin: origin.point, radiusM, results: nearest.results, zoom: !route } : null), [origin, radiusM, nearest.results, route]);

  const focusCompareEvent = useCallback((item) => {
    if (!compareShown) return;
    setCompareEvent(item);
    setCompareCursor({ measure: item.measure, source: "chart" });
    setCompareWindow((prev) => {
      const span = prev[1] - prev[0];
      const start = Math.max(0, Math.min(compareShown.route.lengthKm - span, item.measure - span / 2));
      return [start, start + span];
    });
  }, [compareShown]);
  const onCompareWindow = useCallback((start, end) => {
    if (!compareShown) return;
    const span = end - start;
    const from = Math.max(0, Math.min((compareShown.route.lengthKm || span) - span, start));
    setCompareWindow([from, from + span]);
  }, [compareShown]);
  const onCompareHover = useCallback((measure) => {
    if (!compareShown) return;
    setCompareCursor({ measure: Math.max(0, Math.min(compareShown.route.lengthKm, measure)), source: "chart" });
  }, [compareShown]);

  useEffect(() => {
    if (!route || !events.length) return undefined;
    const frame = requestAnimationFrame(() => fitChart(0.62));
    return () => cancelAnimationFrame(frame);
  }, [route, events.length, fitChart]);

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
    segment,
    compareRoute: compareShown?.route || null,
    compareCursor,
    compareEvent,
    uiPanel: panelHost,
    analysis,
    pickingOrigin,
    onOrigin,
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
          {/* <p className="eyebrow">Rwanda Space Agency · Linear referencing</p> */}
          <h1>Roads Asset Mapping Application</h1>
        </div>
        {/* <p className="source">
          Signin to Road_Asset_LRS_Map to view the map.
        </p> */}
      </header>
      <div className="workspace">
        {/* <Planner
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
        /> */}
        <main ref={mainRef} style={{ gridTemplateRows: rowsFor(chartH) }}>
          <section className={`map-pane${legendOpen ? " legend-open" : ""}`}>
            <div ref={mapRef} className="map" />
            {(focusing || (routeId && !route && status.startsWith("Signing in"))) && (
              <div className="map-loader" role="status">
                <span className="spinner" />
                {focusing || `Loading route ${routeId}…`}
              </div>
            )}
            <div className="legend-box">
            <button type="button" className="legend-toggle" aria-expanded={legendOpen} onClick={() => setLegendOpen((value) => !value)}>
              Layers <span>{LRS_LAYER_DEFS.length - hiddenLayerIds.length}/{LRS_LAYER_DEFS.length}</span> {legendOpen ? "▾" : "▸"}
            </button>
            {legendOpen && <ul className="legend">
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
            </ul>}
            </div>
            {createPortal(<div className="analysis-panel">
              <div className="analysis-tabs" role="tablist">
                <button type="button" role="tab" aria-selected={panelTab === "nearest"} className={panelTab === "nearest" ? "on" : ""} onClick={() => setPanelTab("nearest")}>Nearest</button>
                <button type="button" role="tab" aria-selected={panelTab === "segment"} className={panelTab === "segment" ? "on" : ""} onClick={() => setPanelTab("segment")}>Segment</button>
                <button type="button" role="tab" aria-selected={panelTab === "compare"} className={panelTab === "compare" ? "on" : ""} onClick={() => setPanelTab("compare")}>Compare</button>
              </div>
              {panelTab === "compare" ? (
                <RouteCompare
                  catalog={catalog}
                  route={route}
                  events={events}
                  onCompareRoute={(next) => {
                    setCompare(next);
                    setCompareCursor(null);
                    setCompareEvent(null);
                    if (!next) return;
                    setCompareWindow([0, Math.min(WINDOW_KM, next.route.lengthKm || WINDOW_KM)]);
                    const withAssets = new Set([...events, ...next.events].filter((item) => item.kind !== "span").map((item) => item.layerId));
                    setHiddenLayerIds((current) => current.filter((id) => !withAssets.has(id)));
                  }}
                  onSelectA={focusEvent}
                  onSelectB={focusCompareEvent}
                  onOpenRoute={(id) => {
                    if (id === routeId) return;
                    setRouteId(id);
                    setActiveId(null);
                    setActiveEvent(null);
                    setFollow(true);
                  }}
                />
              ) : panelTab === "segment" ? (
                <SegmentAnalysis
                  route={route}
                  events={events}
                  segment={segment}
                  selecting={selectingSegment}
                  windowKm={windowKm}
                  onSegment={(next) => {
                    setSegment(next);
                    setSelectingSegment(false);
                    if (next) {
                      const pad = Math.max(0.05, (next.to - next.from) * 0.15);
                      setFollow(false);
                      setWindowKm([Math.max(0, next.from - pad), Math.min(route.lengthKm, next.to + pad)]);
                    }
                  }}
                  onSelecting={setSelectingSegment}
                  onSelectEvent={focusEvent}
                />
              ) : (<>
              <div className="analysis-head">
                <b>Nearest road analysis</b>
                {origin && <button type="button" className="link" onClick={() => setOrigin(null)}>Clear</button>}
              </div>
              <p className="analysis-origin">
                {origin
                  ? <>{origin.label} <span>{origin.point[1].toFixed(5)}, {origin.point[0].toFixed(5)}</span></>
                  : "Search a place, use the location button, or pick a point on the map."}
              </p>
              <button type="button" className={`analysis-pick${pickingOrigin ? " on" : ""}`} onClick={() => setPickingOrigin((value) => !value)}>
                {pickingOrigin ? "Click the map… (cancel)" : "Pick point on map"}
              </button>
              <label className="analysis-radius">
                <span>Distance</span>
                <input type="range" min="50" max="10000" step="50" value={radiusM} onChange={(event) => setRadiusM(Number(event.target.value))} />
                <input type="number" min="10" max="50000" step="10" value={radiusM} onChange={(event) => setRadiusM(Math.max(10, Number(event.target.value) || 10))} />
                <em>m</em>
              </label>
              {origin && (
                <div className="analysis-results">
                  {nearest.loading && <em>Analysing roads within {radiusM} m…</em>}
                  {nearest.error && <em className="error">{nearest.error}</em>}
                  {!nearest.loading && !nearest.error && nearest.results.length === 0 && <em>No road within {radiusM} m. Increase the distance.</em>}
                  {!nearest.loading && nearest.results.length > 0 && (
                    <ol>
                      {nearest.results.map((item, index) => (
                        <li key={item.id}>
                          <button type="button" className={item.id === routeId ? "active" : ""} onClick={() => openNearest(item)} title="Open this route in the chart">
                            <span className={index === 0 ? "rank first" : "rank"}>{index + 1}</span>
                            <span className="road">{item.id}{item.code ? ` · ${item.code}` : ""}</span>
                            <span className="dist">{item.distanceKm < 1 ? `${Math.round(item.distanceKm * 1000)} m` : `${item.distanceKm.toFixed(2)} km`}</span>
                          </button>
                        </li>
                      ))}
                    </ol>
                  )}
                </div>
              )}
              </>)}
            </div>, panelHost)}
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
          <div
            className="chart-splitter"
            role="separator"
            aria-orientation="horizontal"
            aria-label="Resize chart"
            tabIndex={0}
            onPointerDown={startResize}
            onDoubleClick={() => setChartH(clampChart(CHART_DEFAULT))}
            onKeyDown={(event) => {
              if (event.key === "ArrowUp") { event.preventDefault(); setChartH((height) => clampChart(height + 24)); }
              if (event.key === "ArrowDown") { event.preventDefault(); setChartH((height) => clampChart(height - 24)); }
            }}
            title="Drag to resize the chart · double-click to reset"
          >
            <span className="grip" />
            <div className="splitter-buttons" onPointerDown={(event) => event.stopPropagation()}>
              <button type="button" onClick={() => nudgeChart(1)} aria-label="Move chart up" title="Move chart up (taller)">▲</button>
              <button type="button" onClick={() => nudgeChart(-1)} aria-label="Move chart down" title="Move chart down (shorter)">▼</button>
              <button type="button" onClick={() => fitChart(1)} aria-label="Fit chart to its rows" title="Fit chart to show every row">⤢</button>
              <button type="button" onClick={() => setChartH(clampChart(Infinity))} aria-label="Maximise chart" title="Chart to full height">⤒</button>
              <button type="button" onClick={() => setChartH(CHART_MIN)} aria-label="Minimise chart" title="Collapse chart">⤓</button>
            </div>
          </div>
          <section className="chart-pane" ref={paneRef}>
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
                fill={!compareShown}
                events={events}
                projects={routeProjects}
                route={route}
                windowKm={windowKm}
                cursor={cursor}
                segment={segment}
                selectingSegment={selectingSegment}
                onSegment={(from, to) => {
                  setSegment({ from: Math.max(0, Math.min(from, to)), to: Math.min(route.lengthKm, Math.max(from, to)) });
                  setSelectingSegment(false);
                  setPanelTab("segment");
                }}
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
            {route && compareShown && (
              <div className="compare-chart">
                <div className="compare-chart-head">
                  <i className="swatch b" />
                  <b>Route B · {compareShown.route.id}</b>
                  <span>{compareShown.route.lengthKm.toFixed(1)} km · {compareShown.events.length} features</span>
                  <button type="button" className="link" onClick={() => { setCompare(null); setCompareCursor(null); setCompareEvent(null); }}>Close</button>
                </div>
                <StripChart
                  events={compareShown.events}
                  projects={NO_PROJECTS}
                  route={compareShown.route}
                  windowKm={compareWindow}
                  cursor={compareCursor}
                  activeEventId={compareEvent?.id}
                  attachedIds={NO_PROJECTS}
                  onWindow={onCompareWindow}
                  onHoverMeasure={onCompareHover}
                  onSelectEvent={focusCompareEvent}
                  onPickProject={noop}
                />
              </div>
            )}
          </section>
        </main>
      </div>
    </div>
  );
}
