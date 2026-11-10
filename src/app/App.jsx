import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { FiMoon, FiSun } from "react-icons/fi";
import {
  EditorPopup,
  EditorSidebar,
} from "../features/editing/components/Editor";
import Planner from "../features/analysis/components/Planner";
import SegmentAnalysis from "../features/analysis/components/SegmentAnalysis";
import RoutePicker from "../features/analysis/components/RoutePicker";
import RouteCompare from "../features/analysis/components/RouteCompare";
import StripChart, {
  ChartSymbol,
} from "../features/analysis/components/StripChart";
import {
  BUILDING_RATE_RWF,
  COMPENSATION_PERCENT,
  GROUPS,
  groupLabel,
  LRS_LAYER_DEFS,
  PARCEL_RATE_RWF,
  REQUESTED_ITEM,
  WINDOW_KM,
} from "../config";
import {
  exportComparison,
  exportRouteAssets,
  exportSegmentAssets,
} from "../utils/excel";
import {
  failedLayerTitles,
  featuresAtMeasure,
  featuresForRoute,
  loadEvents,
  loadRoute,
  loadRouteCatalog,
  nearestRoads,
  routeKey,
} from "../features/mapping/services/lrsService";
import {
  locateOnRoute,
  pointAtMeasure,
  sliceVertices,
} from "../features/analysis/utils/geometry";
import {
  chartSnapshots,
  printMapReport,
  printRouteReport,
} from "../features/analysis/services/printReport";
import { useRoadMap } from "../features/mapping/hooks/useRoadMap";
import Sidebar from "../components/layout/Sidebar";
import ProfileMenu from "../components/layout/ProfileMenu";
import LoginGate from "../components/layout/LoginGate";
import CostPlan from "../features/road-reserve/components/CostPlan";
import PavementPanel from "../features/pavement/components/PavementPanel";
import Overview from "../features/overview/components/Overview";
import { appendVertex, applyRates } from "../features/cost/utils/corridor";
import { assetIcons } from "../assets";

const STORE = "rwanda-lrs-projects";
const CHART_STORE = "rwanda-lrs-chart-height";
const THEME_STORE = "rwanda-lrs-theme";
const CHART_DEFAULT = 340;
const CHART_MIN = 40;
const MAP_MIN = 120;
const NO_PROJECTS = [];
const noop = () => {};
const EVENT_END_SNAP_KM = 0.05;

/** If the click is near an existing line event end, use that measure so the new line can start where the other stops. */
function snapMeasureToEventEnds(
  events,
  layerId,
  measure,
  toleranceKm = EVENT_END_SNAP_KM,
) {
  let best = measure;
  let bestDist = toleranceKm;
  let snapped = false;
  (events || []).forEach((item) => {
    if (item.layerId !== layerId) return;
    [item.from, item.to].forEach((end) => {
      if (!Number.isFinite(end)) return;
      const dist = Math.abs(end - measure);
      if (dist <= bestDist) {
        bestDist = dist;
        best = end;
        snapped = true;
      }
    });
  });
  return { measure: best, snapped };
}

function readProjects() {
  try {
    return JSON.parse(localStorage.getItem(STORE) || "[]");
  } catch {
    return [];
  }
}

function ExpandIcon() {
  return (
    <svg width="16" height="16" viewBox="0 0 16 16" aria-hidden="true">
      <path
        fill="none"
        stroke="currentColor"
        strokeWidth="1.6"
        strokeLinecap="round"
        d="M3 6.2V3h3.2M13 6.2V3h-3.2M3 9.8V13h3.2M13 9.8V13h-3.2"
      />
    </svg>
  );
}

function CollapseIcon() {
  return (
    <svg width="16" height="16" viewBox="0 0 16 16" aria-hidden="true">
      <path
        fill="none"
        stroke="currentColor"
        strokeWidth="1.6"
        strokeLinecap="round"
        d="M6.2 3v3.2H3M9.8 3v3.2H13M6.2 13V9.8H3M9.8 13V9.8H13"
      />
    </svg>
  );
}

function PaneControls({ enlarged, onToggle }) {
  const label = enlarged ? "Minimize" : "Expand";
  return (
    <button
      type="button"
      className="pane-size"
      aria-pressed={enlarged}
      aria-label={label}
      onClick={onToggle}
    >
      {enlarged ? <CollapseIcon /> : <ExpandIcon />}
      <span className="pane-tip">{label}</span>
    </button>
  );
}

export default function App() {
  const [catalog, setCatalog] = useState([]);
  const [routeId, setRouteId] = useState("");
  const [routeTicket, setRouteTicket] = useState(0);
  const [routeLoading, setRouteLoading] = useState(false);
  const routeLoadingRef = useRef(false);
  const [route, setRoute] = useState(null);
  const [events, setEvents] = useState([]);
  const [status, setStatus] = useState("");
  const [windowKm, setWindowKm] = useState([0, WINDOW_KM]);
  const [windowDraft, setWindowDraft] = useState(["0.00", String(WINDOW_KM)]);
  const windowFocus = useRef(null);
  const windowKmRef = useRef(windowKm);
  windowKmRef.current = windowKm;
  const [cursor, setCursor] = useState(null);
  const [follow, setFollow] = useState(true);
  const [projects, setProjects] = useState(readProjects);
  const [activeId, setActiveId] = useState(null);
  const [activeEvent, setActiveEvent] = useState(null);
  const [mapLayers, setMapLayers] = useState([]);
  const [origin, setOrigin] = useState(null);
  const [radiusM, setRadiusM] = useState(500);
  const [pickingOrigin, setPickingOrigin] = useState(false);
  const [nearest, setNearest] = useState({
    loading: false,
    results: [],
    error: "",
  });
  const pendingPoint = useRef(null);
  const [panelHost] = useState(() => document.createElement("div"));
  const [panelTab, setPanelTab] = useState("nearest");
  const [toolsOpen, setToolsOpen] = useState(false);
  const [viewMode, setViewMode] = useState("analyse");
  const [overviewQuery, setOverviewQuery] = useState("");
  const [theme, setTheme] = useState(() =>
    document.documentElement.dataset.theme === "light" ? "light" : "dark",
  );
  const [placingId, setPlacingId] = useState(null);
  const [lineAnchor, setLineAnchor] = useState(null);
  const [placeMarks, setPlaceMarks] = useState(null);
  const [editSelection, setEditSelection] = useState(null);
  const [editNotice, setEditNotice] = useState("");
  const chartPage = viewMode === "analyse";
  const editingPage = viewMode === "edit";
  const costPage = viewMode === "cost";
  const pavementPage = viewMode === "pavement";
  const overviewPage = viewMode === "overview";
  const [legendOpen, setLegendOpen] = useState(true);
  const mainRef = useRef(null);
  const [chartH, setChartH] = useState(
    () => Number(localStorage.getItem(CHART_STORE)) || CHART_DEFAULT,
  );
  const [focusPane, setFocusPane] = useState("split");
  useEffect(() => {
    localStorage.setItem(CHART_STORE, String(Math.round(chartH)));
  }, [chartH]);
  const clampChart = useCallback((height) => {
    const total = mainRef.current?.clientHeight || window.innerHeight;
    return Math.round(Math.max(CHART_MIN, Math.min(total - MAP_MIN, height)));
  }, []);
  const rowsFor = (height) => {
    if (focusPane === "map") return "1fr 8px 0px";
    if (focusPane === "chart") return "0px 8px 1fr";
    return `minmax(${MAP_MIN}px, 1fr) 10px ${height}px`;
  };
  const startResize = (event) => {
    if (focusPane !== "split") return;
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
        if (mainRef.current)
          mainRef.current.style.gridTemplateRows = rowsFor(next);
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
  const fitChart = useCallback(
    (maxShare = 1) => {
      const pane = paneRef.current;
      const total = mainRef.current?.clientHeight || window.innerHeight;
      if (!pane) return;
      const needed = pane.scrollHeight + 2;
      setChartH((height) =>
        clampChart(
          Math.max(
            maxShare < 1 ? height : 0,
            Math.min(needed, total * maxShare),
          ),
        ),
      );
    },
    [clampChart],
  );
  const nudgeChart = (direction) => {
    const total = mainRef.current?.clientHeight || window.innerHeight;
    setChartH((height) => clampChart(height + direction * total * 0.2));
  };
  useEffect(() => {
    setChartH((height) => clampChart(height));
    const onResize = () => setChartH((height) => clampChart(height));
    window.addEventListener("resize", onResize);
    return () => window.removeEventListener("resize", onResize);
  }, [clampChart]);
  const [compare, setCompare] = useState(null);
  const [compareWindow, setCompareWindow] = useState([0, WINDOW_KM]);
  const [compareCursor, setCompareCursor] = useState(null);
  const [compareEvent, setCompareEvent] = useState(null);
  const compareShown = compare && compare.route.id !== routeId ? compare : null;
  const [linkCompare, setLinkCompare] = useState(true);
  const [segment, setSegment] = useState(null);
  const [selectingSegment, setSelectingSegment] = useState(false);
  const [segmentStart, setSegmentStart] = useState(null);
  const [printing, setPrinting] = useState(false);
  const segmentStartRef = useRef(null);
  segmentStartRef.current = segmentStart;
  const [parcelsOn, setParcelsOn] = useState(true);
  const [planDraw, setPlanDraw] = useState(false);
  const [planEdit, setPlanEdit] = useState(false);
  const [planVertices, setPlanVertices] = useState([]);
  const [planWidth, setPlanWidth] = useState(20);
  const [landRate, setLandRate] = useState(PARCEL_RATE_RWF);
  const [buildingRate, setBuildingRate] = useState(BUILDING_RATE_RWF);
  const [compensationPct, setCompensationPct] = useState(COMPENSATION_PERCENT);
  const [planBusy, setPlanBusy] = useState(false);
  const [planReport, setPlanReport] = useState(null);
  const [planOpen, setPlanOpen] = useState(false);
  const [planOptions, setPlanOptions] = useState([]);
  const [planActive, setPlanActive] = useState(null);
  const planVerticesRef = useRef([]);
  const planWidthRef = useRef(20);
  const planRatesRef = useRef({
    land: PARCEL_RATE_RWF,
    building: BUILDING_RATE_RWF,
    compensation: COMPENSATION_PERCENT,
  });
  planVerticesRef.current = planVertices;
  planWidthRef.current = planWidth;
  planRatesRef.current = {
    land: landRate,
    building: buildingRate,
    compensation: compensationPct,
  };
  const [hiddenLayerIds, setHiddenLayerIds] = useState(() =>
    LRS_LAYER_DEFS.filter((layer) => !layer.route && !layer.visible).map(
      (layer) => layer.id,
    ),
  );

  useEffect(() => {
    loadRouteCatalog()
      .then((rows) => {
        setCatalog(rows);
        setStatus(
          rows.length
            ? `${rows.length} route ids. Nearby roads load first; zoom out for more.`
            : "No route ids were returned.",
        );
      })
      .catch((error) => setStatus(error.message));
  }, []);

  useEffect(() => {
    if (!routeId) {
      routeLoadingRef.current = false;
      setRouteLoading(false);
      setRoute(null);
      setEvents([]);
      setCursor(null);
      setActiveEvent(null);
      return undefined;
    }
    let cancel = false;
    routeLoadingRef.current = true;
    setRouteLoading(true);
    setStatus(`Loading route ${routeId} …`);
    setRoute(null);
    setEvents([]);
    setMapLayers([]);
    setSegment(null);
    setSelectingSegment(false);
    setSegmentStart(null);
    setCursor(null);
    setActiveEvent(null);
    loadRoute(routeId)
      .then(async (next) => {
        if (cancel) return;
        setRoute(next);
        const span = Math.min(WINDOW_KM, next.lengthKm || WINDOW_KM);
        const hit =
          pendingPoint.current &&
          locateOnRoute(next.vertices, next.measures, pendingPoint.current, 2);
        pendingPoint.current = null;
        if (hit) {
          const start = Math.max(
            0,
            Math.min(next.lengthKm - span, hit.measure - span / 2),
          );
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
        setStatus(
          failed.length
            ? `Could not load: ${failed.join(", ")}. Reload the page to try again.`
            : "",
        );
      })
      .catch((error) => {
        if (!cancel) setStatus(error.message);
      })
      .finally(() => {
        if (cancel) return;
        routeLoadingRef.current = false;
        setRouteLoading(false);
      });
    return () => {
      cancel = true;
    };
  }, [routeId, routeTicket]);

  useEffect(() => {
    localStorage.setItem(STORE, JSON.stringify(projects));
  }, [projects]);

  const routeProjects = projects.filter(
    (project) => project.routeId === routeId,
  );
  const activeProject =
    routeProjects.find((project) => project.id === activeId) || null;

  const routeIndex = Math.max(
    0,
    catalog.findIndex((item) => item.id === routeId),
  );
  const stepRoute = (delta) => {
    if (!catalog.length) return;
    const next =
      catalog[(routeIndex + delta + catalog.length) % catalog.length];
    setRouteId(next.id);
    setActiveId(null);
    setActiveEvent(null);
    setFollow(true);
  };

  const focusEvent = (item) => {
    setActiveEvent(item);
    setFollow(false);
    setCursor({ measure: item.measure, source: "chart" });
    if (item.kind === "span" && route && item.to > item.from) {
      const pad = Math.max(0.15, (item.to - item.from) * 0.2);
      setWindowKm([
        Math.max(0, item.from - pad),
        Math.min(route.lengthKm, item.to + pad),
      ]);
      return;
    }
    const span = windowKm[1] - windowKm[0];
    const start = Math.max(0, item.measure - span / 2);
    setWindowKm([start, start + span]);
  };

  const onHoverLonLat = useCallback(
    (longitude, latitude) => {
      if (!route) return;
      const hit = locateOnRoute(
        route.vertices,
        route.measures,
        [longitude, latitude],
        0.25,
      );
      const other =
        compareShown &&
        locateOnRoute(
          compareShown.route.vertices,
          compareShown.route.measures,
          [longitude, latitude],
          0.25,
        );
      if (other && (!hit || other.distanceKm < hit.distanceKm)) {
        setCompareCursor((current) =>
          current && Math.abs(current.measure - other.measure) < 0.01
            ? current
            : { measure: other.measure, source: "map" },
        );
        setCompareWindow((prev) => {
          const span = prev[1] - prev[0];
          if (
            other.measure >= prev[0] + span * 0.2 &&
            other.measure <= prev[1] - span * 0.2
          )
            return prev;
          const start = Math.max(
            0,
            Math.min(
              compareShown.route.lengthKm - span,
              other.measure - span / 2,
            ),
          );
          return [start, start + span];
        });
        return;
      }
      if (!hit) return;
      setCursor((current) => {
        if (current && Math.abs(current.measure - hit.measure) < 0.01)
          return current;
        return { measure: hit.measure, source: "map" };
      });
      if (follow) {
        setWindowKm((prev) => {
          const span = prev[1] - prev[0];
          if (
            hit.measure >= prev[0] + span * 0.2 &&
            hit.measure <= prev[1] - span * 0.2
          )
            return prev;
          const start = Math.max(
            0,
            Math.min(route.lengthKm - span, hit.measure - span / 2),
          );
          return [start, start + span];
        });
      }
    },
    [route, follow, compareShown],
  );

  useEffect(() => {
    if (!origin) {
      setNearest({ loading: false, results: [], error: "" });
      return undefined;
    }
    let cancel = false;
    setNearest((prev) => ({ ...prev, loading: true, error: "" }));
    const timer = setTimeout(() => {
      nearestRoads(origin.point, radiusM / 1000)
        .then((results) => {
          if (!cancel) setNearest({ loading: false, results, error: "" });
        })
        .catch((error) => {
          if (!cancel)
            setNearest({ loading: false, results: [], error: error.message });
        });
    }, 200);
    return () => {
      cancel = true;
      clearTimeout(timer);
    };
  }, [origin, radiusM]);

  const onOrigin = useCallback((point, label, options) => {
    setOrigin({ point, label, wide: Boolean(options?.wide) });
    setPickingOrigin(false);
  }, []);

  const openNearest = (item) => {
    if (item.id === routeId && route) {
      const hit = locateOnRoute(route.vertices, route.measures, item.point, 2);
      if (hit) {
        const span = windowKm[1] - windowKm[0];
        const start = Math.max(
          0,
          Math.min(route.lengthKm - span, hit.measure - span / 2),
        );
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

  const analysis = useMemo(
    () =>
      origin
        ? {
            origin: origin.point,
            radiusM,
            results: nearest.results,
            zoom: !route,
            wide: Boolean(origin.wide),
          }
        : null,
    [origin, radiusM, nearest.results, route],
  );

  const focusCompareEvent = useCallback(
    (item) => {
      if (!compareShown) return;
      setCompareEvent(item);
      setCompareCursor({ measure: item.measure, source: "chart" });
      setCompareWindow((prev) => {
        const span = prev[1] - prev[0];
        const start = Math.max(
          0,
          Math.min(compareShown.route.lengthKm - span, item.measure - span / 2),
        );
        return [start, start + span];
      });
    },
    [compareShown],
  );
  const onCompareWindow = useCallback(
    (start, end) => {
      if (!compareShown) return;
      const span = end - start;
      if (linkCompare && route) {
        const from = Math.max(
          0,
          Math.min(
            Math.max(route.lengthKm, compareShown.route.lengthKm) - span,
            start,
          ),
        );
        setWindowKm([from, from + span]);
        return;
      }
      const from = Math.max(
        0,
        Math.min((compareShown.route.lengthKm || span) - span, start),
      );
      setCompareWindow([from, from + span]);
    },
    [compareShown, linkCompare, route],
  );
  const onCompareHover = useCallback(
    (measure) => {
      if (!compareShown) return;
      const clamped = Math.max(
        0,
        Math.min(compareShown.route.lengthKm, measure),
      );
      if (linkCompare && route && clamped <= route.lengthKm) {
        setCursor({ measure: clamped, source: "chart" });
        return;
      }
      setCompareCursor({ measure: clamped, source: "chart" });
    },
    [compareShown, linkCompare, route],
  );
  useEffect(() => {
    if (!linkCompare || !compareShown) return;
    setCompareWindow((prev) =>
      prev[0] === windowKm[0] && prev[1] === windowKm[1]
        ? prev
        : [windowKm[0], windowKm[1]],
    );
  }, [windowKm, linkCompare, compareShown]);
  useEffect(() => {
    if (!linkCompare || !compareShown || !cursor) return;
    setCompareCursor(
      cursor.measure <= compareShown.route.lengthKm
        ? { measure: cursor.measure, source: "link" }
        : null,
    );
  }, [cursor, linkCompare, compareShown]);

  useEffect(() => {
    if (!route || !events.length) return undefined;
    const frame = requestAnimationFrame(() => fitChart(0.62));
    return () => cancelAnimationFrame(frame);
  }, [route, events.length, fitChart]);

  const commitSegment = useCallback(
    (a, b) => {
      if (!route) return;
      const next = {
        from: Math.max(0, Math.min(a, b)),
        to: Math.min(route.lengthKm, Math.max(a, b)),
      };
      if (next.to - next.from < 0.005) return;
      setSegment(next);
      setSegmentStart(null);
      setSelectingSegment(false);
      setPanelTab("segment");
    },
    [route],
  );
  const onSegmentPoint = useCallback(
    (measure) => {
      if (!route) return;
      const at = Math.max(0, Math.min(route.lengthKm, measure));
      if (segmentStartRef.current === null) setSegmentStart(at);
      else commitSegment(segmentStartRef.current, at);
    },
    [route, commitSegment],
  );
  const onSegmentClick = useCallback(
    (longitude, latitude) => {
      if (!route) return;
      const hit = locateOnRoute(
        route.vertices,
        route.measures,
        [longitude, latitude],
        0.3,
      );
      if (hit) onSegmentPoint(hit.measure);
    },
    [route, onSegmentPoint],
  );
  useEffect(() => {
    if (panelTab !== "segment") setSegmentStart(null);
  }, [panelTab]);
  useEffect(() => {
    if (!editingPage) {
      setPlacingId(null);
      setLineAnchor(null);
      setPlaceMarks(null);
      setEditSelection(null);
    }
    const frame = requestAnimationFrame(() => mapApi.current?.view?.resize?.());
    return () => cancelAnimationFrame(frame);
  }, [editingPage]);
  const routeNameOf = (target) => {
    if (target?.trajectory && target.trajectory !== "Road Network")
      return target.trajectory;
    const item = catalog.find((entry) => entry.id === target?.id);
    if (item?.code && item.code !== item.id && item.code !== "Road Network")
      return item.code;
    const attributes =
      target?.features?.find((feature) => feature.attributes)?.attributes || {};
    const key = Object.keys(attributes).find((name) =>
      /route_?name$/i.test(name),
    );
    const value = key ? String(attributes[key] ?? "").trim() : "";
    return value && value !== "Road Network" ? value : "";
  };
  const onEditHit = useCallback(
    (layerId, oid) => {
      if (LRS_LAYER_DEFS.find((item) => item.id === layerId)?.readOnly) return;
      const adding = placingId != null;
      setPlacingId(null);
      setLineAnchor(null);
      setPlaceMarks(null);
      setEditSelection({ layerId, oid });
      setEditNotice(
        adding
          ? "That line is already on this road, so it is open to edit. Add again on a clear part of the road."
          : "",
      );
    },
    [placingId],
  );
  const onEditPlace = useCallback(
    (longitude, latitude) => {
      const layerId = placingId;
      const layer = LRS_LAYER_DEFS.find((item) => item.id === layerId);
      if (!layer) return;
      if (!route?.vertices?.length) {
        setStatus(
          routeId
            ? `Reading ${routeId}…`
            : "Select the road first. Click it on the map.",
        );
        return;
      }
      const hit = locateOnRoute(
        route.vertices,
        route.measures,
        [longitude, latitude],
        0.4,
      );
      if (!hit) {
        setStatus(`Click on the active road ${route.id}.`);
        return;
      }
      const snapped =
        layer.kind === "line"
          ? snapMeasureToEventEnds(events, layerId, hit.measure)
          : { measure: hit.measure, snapped: false };
      const measure = snapped.measure;
      const onLine =
        pointAtMeasure(route.vertices, route.measures, measure) || hit.point;
      const target = route;
      const named = routeNameOf(target);
      const shiftAside = (point, measure, meters) => {
        const ahead =
          pointAtMeasure(
            target.vertices,
            target.measures,
            Math.min(target.lengthKm, measure + 0.05),
          ) || point;
        const behind =
          pointAtMeasure(
            target.vertices,
            target.measures,
            Math.max(0, measure - 0.05),
          ) || point;
        const dx = ahead[0] - behind[0];
        const dy = ahead[1] - behind[1];
        const len = Math.hypot(dx, dy) || 1;
        const side = meters < 0 ? -1 : 1;
        const dist = Math.abs(meters);
        const lat = dist / 111320;
        const lon =
          dist / (111320 * Math.max(0.2, Math.cos((point[1] * Math.PI) / 180)));
        return [
          point[0] + (-dy / len) * lon * side,
          point[1] + (dx / len) * lat * side,
        ];
      };
      if (layer.kind === "point") {
        const crowded = events.filter(
          (item) =>
            item.layerId === layer.id &&
            Math.abs(item.measure - hit.measure) < 0.04,
        );
        const meters = crowded.length
          ? 12 * crowded.length * (crowded.length % 2 ? 1 : -1)
          : 0;
        const point = meters ? shiftAside(onLine, hit.measure, meters) : onLine;
        const notice = meters
          ? `${layer.title} already sits here.\nShifted ${Math.abs(meters)} m aside\nso they do not overlap.`
          : "";
        setEditNotice(notice);
        setEditSelection({
          layerId,
          routeId: target.id,
          routeName: named,
          measure,
          notice,
          geometry: {
            x: point[0],
            y: point[1],
            spatialReference: { wkid: 4326 },
          },
        });
        setPlaceMarks({ start: point, end: null, notice });
        setPlacingId(null);
        setLineAnchor(null);
        return;
      }
      if (!lineAnchor || lineAnchor.routeId !== target.id) {
        setEditNotice("");
        setLineAnchor({
          routeId: target.id,
          routeName: named,
          measure,
          point: onLine,
          vertices: target.vertices,
          measures: target.measures,
        });
        setPlaceMarks({ start: onLine, end: null, line: true });
        setStatus(
          snapped.snapped
            ? `Start at ${measure.toFixed(3)} km, where the other ${layer.title} ends. Click the end of your new line.`
            : `Start at ${measure.toFixed(3)} km on ${target.id}. Click the end where you want it.`,
        );
        return;
      }
      const from = Math.min(lineAnchor.measure, measure);
      const to = Math.max(lineAnchor.measure, measure);
      const slice = sliceVertices(
        lineAnchor.vertices,
        lineAnchor.measures,
        from,
        to,
      );
      if (to - from < 0.001 || slice.length < 2) {
        const message = "Click a different point for the end of the line.";
        setEditNotice(message);
        setStatus(message);
        return;
      }
      setEditNotice("");
      setEditSelection({
        layerId,
        routeId: lineAnchor.routeId,
        routeName: lineAnchor.routeName,
        from,
        to,
        geometry: { paths: [slice], spatialReference: { wkid: 4326 } },
      });
      setPlaceMarks({
        start:
          pointAtMeasure(lineAnchor.vertices, lineAnchor.measures, from) ||
          lineAnchor.point,
        end:
          pointAtMeasure(lineAnchor.vertices, lineAnchor.measures, to) ||
          onLine,
        path: slice,
      });
      setLineAnchor(null);
      setPlacingId(null);
      setEditNotice("");
      setStatus(
        `Line from ${from.toFixed(3)} to ${to.toFixed(3)} km on ${lineAnchor.routeId}.`,
      );
    },
    [placingId, route, routeId, lineAnchor, catalog, events],
  );

  const onLeave = useCallback(() => {}, []);
  const selectRoute = useCallback(
    (id) => {
      if (!id || routeLoadingRef.current || placingId != null) return;
      const loaded = Boolean(
        route?.vertices?.length && routeKey(route.id) === routeKey(id),
      );
      if (!loaded) {
        routeLoadingRef.current = true;
        setRouteLoading(true);
        if (String(routeId) === String(id))
          setRouteTicket((ticket) => ticket + 1);
      }
      setRouteId(id);
      setActiveId(null);
      setActiveEvent(null);
      setFollow(true);
      setLineAnchor(null);
      setPlaceMarks(null);
      setEditNotice("");
      if (placingId != null) {
        const layer = LRS_LAYER_DEFS.find((item) => item.id === placingId);
        setStatus(
          layer?.kind === "point"
            ? `${id} is active. Click that road to place the point.`
            : `${id} is active. Click the start yourself, then click the end.`,
        );
      }
    },
    [placingId, route, routeId],
  );
  const [focusing, setFocusing] = useState(null);
  const mapApi = useRef(null);
  useEffect(() => {
    if (viewMode === "overview") return;
    const frame = requestAnimationFrame(() => mapApi.current?.view?.resize?.());
    return () => cancelAnimationFrame(frame);
  }, [viewMode, focusPane, chartH]);
  useEffect(() => {
    const rates = {
      land: landRate,
      building: buildingRate,
      compensation: compensationPct,
    };
    setPlanReport((current) => applyRates(current, rates));
    setPlanOptions((current) => {
      let changed = false;
      const next = current.map((option) => {
        const report = applyRates(option.report, rates);
        if (report === option.report) return option;
        changed = true;
        return { ...option, report };
      });
      return changed ? next : current;
    });
  }, [landRate, buildingRate, compensationPct]);
  useEffect(() => {
    if (costPage) return;
    setPlanDraw(false);
    setPlanEdit(false);
    planVerticesRef.current = [];
    setPlanVertices([]);
    setPlanReport(null);
    setPlanOpen(false);
    mapApi.current?.clearPlan?.();
  }, [costPage]);
  const measurePlan = (vertices, width) => {
    setPlanReport(null);
    setPlanOpen(true);
    setPlanBusy(true);
    const rates = planRatesRef.current;
    mapApi.current
      .estimatePlan(vertices, width)
      .then((report) => setPlanReport(applyRates(report, rates)))
      .catch((error) =>
        setPlanReport({
          error: error.message || "Could not measure this reserve.",
          parcels: [],
          buildings: [],
          assets: [],
        }),
      )
      .finally(() => setPlanBusy(false));
  };
  const mapRef = useRoadMap({
    mapApi,
    onFocusChange: setFocusing,
    onPickRoute: (id) => selectRoute(id),
    routeLoadingRef,
    route,
    events,
    cursor,
    project: activeProject,
    activeEvent,
    hiddenLayerIds,
    segment,
    segmentStart,
    segmentPicking:
      Boolean(route) && (selectingSegment || panelTab === "segment"),
    onSegmentClick,
    compareRoute: compareShown?.route || null,
    compareEvents: compareShown?.events || null,
    compareCursor,
    compareEvent,
    uiPanel: panelHost,
    analysis,
    pickingOrigin,
    onOrigin,
    onHoverMeasure: onHoverLonLat,
    onLeave,
    editing: editingPage,
    pavement: pavementPage,
    planning: costPage && parcelsOn,
    planDraw,
    planEdit,
    planVertices,
    planWidth,
    onPlanClick: (longitude, latitude) => {
      const next = appendVertex(planVerticesRef.current, [longitude, latitude]);
      planVerticesRef.current = next;
      setPlanVertices(next);
    },
    onPlanFinish: (longitude, latitude) => {
      const next = appendVertex(planVerticesRef.current, [longitude, latitude]);
      if (next.length < 2) return;
      planVerticesRef.current = next;
      setPlanVertices(next);
      setPlanDraw(false);
      setPlanEdit(false);
      setPlanActive(null);
      measurePlan(next, planWidthRef.current);
    },
    onPlanCommit: (vertices) => {
      planVerticesRef.current = vertices;
      setPlanVertices(vertices);
      setPlanDraw(false);
      setPlanEdit(true);
      setPlanActive(null);
      measurePlan(vertices, planWidthRef.current);
    },
    placing: placingId != null,
    onEditHit,
    onEditPlace,
    placeMarks,
    placeAnchor: lineAnchor,
  });

  const shownEvents = useMemo(() => {
    const hidden = new Set(hiddenLayerIds);
    return events.filter((item) => !hidden.has(item.layerId));
  }, [events, hiddenLayerIds]);

  const nearby = useMemo(() => {
    if (!cursor) return [];
    return featuresAtMeasure(shownEvents, cursor.measure, 0.4);
  }, [cursor, shownEvents]);

  const routeLayerSummary = useMemo(() => {
    const layers = new Map();
    shownEvents.forEach((item) => {
      const entry = layers.get(item.layerId) || {
        id: item.layerId,
        title: item.title,
        group: item.group,
        kind: item.kind,
        shape: item.shape,
        color: item.color,
        count: 0,
        km: 0,
      };
      entry.count += 1;
      if (item.kind === "span") entry.km += Math.max(0, item.to - item.from);
      layers.set(item.layerId, entry);
    });
    const bags = new Map();
    [...layers.values()]
      .sort((a, b) => b.count - a.count)
      .forEach((entry) => {
        const list = bags.get(entry.group) || [];
        list.push(entry);
        bags.set(entry.group, list);
      });
    return [...bags.entries()];
  }, [shownEvents]);

  const routeAssets = useMemo(() => {
    const layers = new Map();
    events.forEach((item) => {
      const entry = layers.get(item.layerId) || {
        id: item.layerId,
        title: item.title,
        kind: item.kind,
        count: 0,
        km: 0,
        types: new Map(),
      };
      entry.count += 1;
      if (item.kind === "span") {
        const length = Math.max(0, item.to - item.from);
        entry.km += length;
        const type = entry.types.get(item.name) || {
          name: item.name,
          color: item.color,
          km: 0,
          count: 0,
          segments: [],
        };
        type.km += length;
        type.count += 1;
        type.color = item.color || type.color;
        type.segments.push(item);
        entry.types.set(item.name, type);
      }
      layers.set(item.layerId, entry);
    });
    return LRS_LAYER_DEFS.map((def) => {
      const entry = layers.get(def.id);
      if (!entry) return null;
      const types = [...entry.types.values()]
        .map((type) => ({
          ...type,
          segments: [...type.segments].sort((a, b) => a.from - b.from),
        }))
        .sort((a, b) => b.km - a.km);
      return { ...entry, types };
    }).filter(Boolean);
  }, [events]);
  const [openAssetId, setOpenAssetId] = useState(null);
  const [openTypeKey, setOpenTypeKey] = useState("");

  const grouped = useMemo(() => {
    const bags = new Map();
    nearby.forEach((item) => {
      const list = bags.get(item.group) || [];
      list.push(item);
      bags.set(item.group, list);
    });
    return [...bags.entries()];
  }, [nearby]);

  useEffect(() => {
    setWindowDraft((draft) => [
      windowFocus.current === 0 ? draft[0] : windowKm[0].toFixed(2),
      windowFocus.current === 1 ? draft[1] : windowKm[1].toFixed(2),
    ]);
  }, [windowKm]);

  const onWindowDraft = (index, raw) => {
    setWindowDraft((draft) => {
      const next = [...draft];
      next[index] = raw;
      return next;
    });
    if (!/^\d+(\.\d+)?$/.test(raw.trim())) return;
    const value = Number(raw);
    setFollow(false);
    setWindowKm((prev) => {
      const next = [prev[0], prev[1]];
      next[index] = value;
      return next;
    });
  };

  const onWindowBlur = (index, raw) => {
    windowFocus.current = null;
    const max = route?.lengthKm;
    const value = Number(raw);
    if (!Number.isFinite(value)) {
      const current = windowKmRef.current[index].toFixed(2);
      setWindowDraft((draft) => {
        const next = [...draft];
        next[index] = current;
        return next;
      });
      return;
    }
    setFollow(false);
    setWindowKm((prev) => {
      const limit = Number.isFinite(max) ? max : value;
      const next = [prev[0], prev[1]];
      next[index] = Math.max(0, Math.min(limit, value));
      if (next[1] < next[0]) {
        if (index === 0) next[1] = Math.min(limit, next[0]);
        else next[0] = next[1];
      }
      return next;
    });
  };

  const routeSummary = useMemo(() => {
    const read = (pattern) => {
      for (const feature of route?.features || []) {
        const attrs = feature.attributes || {};
        const key = Object.keys(attrs).find(
          (name) =>
            pattern.test(name) &&
            attrs[name] != null &&
            String(attrs[name]).trim(),
        );
        if (key) return String(attrs[key]).trim();
      }
      return "";
    };
    const counts = new Map();
    events
      .filter((item) => item.layerId === 10 && item.name)
      .forEach((item) => {
        counts.set(item.name, (counts.get(item.name) || 0) + 1);
      });
    const surface =
      [...counts.entries()].sort((a, b) => b[1] - a[1])[0]?.[0] ||
      read(/surface|pavement/i);
    return {
      id: route?.id || "",
      name:
        read(/routename|roadname|linkname/i) ||
        (route?.trajectory && route.trajectory !== route.id
          ? route.trajectory
          : ""),
      classification:
        read(/class|category|functional/i) || route?.roadClass || "",
      length: route?.lengthKm,
      surface,
    };
  }, [route, events]);

  const clearRoute = () => {
    if (placingId != null) return;
    setRouteId("");
    setActiveId(null);
    setActiveEvent(null);
    setSegment(null);
    setSegmentStart(null);
    setSelectingSegment(false);
    setCompare(null);
    setFollow(false);
    setStatus(
      "Route cleared. Click a road on the map or search for another route.",
    );
  };

  const shiftWindow = (delta) => {
    if (!route) return;
    setWindowKm(([from, to]) => {
      const span = to - from;
      const start = Math.max(0, Math.min(route.lengthKm - span, from + delta));
      return [start, start + span];
    });
  };

  return (
    <div className="app-container">
      <LoginGate />
      <Sidebar viewMode={viewMode} onChange={setViewMode} />
      <div
        className={`app${editingPage ? " page-edit" : ""}${overviewPage ? " page-overview" : ""}`}
      >
        <header className="topbar">
          <div>
            {/* <p className="eyebrow">Rwanda Space Agency · Linear referencing</p> */}
            <h3>Road Location Reference Application</h3>
          </div>
          <div className="top-search">
            {overviewPage ? (
              <input
                className="overview-search"
                value={overviewQuery}
                placeholder="Filter overview (bridges, paved, divided…)"
                onChange={(event) => setOverviewQuery(event.target.value)}
              />
            ) : (
              <RoutePicker
                catalog={catalog}
                value={routeId}
                placeholder="Search road (e.g. RN1)"
                onChange={selectRoute}
              />
            )}
          </div>
          <div className="top-actions">
            <button
              type="button"
              className="theme-toggle"
              aria-pressed={theme === "dark"}
              title={
                theme === "dark"
                  ? "Switch to light mode"
                  : "Switch to dark mode"
              }
              onClick={() => {
                const next = theme === "dark" ? "light" : "dark";
                document.documentElement.dataset.theme = next;
                try {
                  localStorage.setItem(THEME_STORE, next);
                } catch {
                  /* the theme still changes for this visit */
                }
                setTheme(next);
              }}
            >
              {theme === "dark" ? <FiSun /> : <FiMoon />}
              <span>{theme === "dark" ? "Light" : "Dark"}</span>
            </button>
            <button
              type="button"
              className="export-excel"
              disabled={!route || events.length === 0}
              title={
                route
                  ? `Download assets for ${route.id}`
                  : "Choose a road first"
              }
              onClick={() => {
                if (compareShown)
                  exportComparison({ route, events }, compareShown);
                else if (segment) exportSegmentAssets(route, events, segment);
                else exportRouteAssets(route, events);
              }}
            >
              <assetIcons.ExcelLogo className="file-logo" aria-hidden="true" />
              <span>
                {compareShown
                  ? "Export comparison"
                  : segment
                    ? "Export segment"
                    : "Excel"}
              </span>
            </button>
            <button
              type="button"
              className="print-pdf"
              disabled={!route || events.length === 0 || printing}
              title={route ? `Print ${route.id}` : "Choose a road first"}
              onClick={() => {
                setPrinting(true);
                const job = compareShown
                  ? printMapReport({
                      bag: mapApi.current,
                      a: { route, events },
                      b: compareShown,
                      charts: chartSnapshots(),
                      segment: segment
                        ? {
                            routeId: route.id,
                            from: segment.from,
                            to: segment.to,
                            events,
                          }
                        : null,
                    })
                  : printRouteReport({
                      bag: mapApi.current,
                      route,
                      events,
                      segment: segment || null,
                      charts: chartSnapshots(),
                    });
                job
                  .catch((error) => setStatus(error.message || "Print failed."))
                  .finally(() => setPrinting(false));
              }}
            >
              <assetIcons.PdfLogo className="file-logo" aria-hidden="true" />
              <span>{printing ? "Printing…" : "PDF"}</span>
            </button>
            <ProfileMenu />
          </div>
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
          {costPage && (
            <CostPlan
              drawing={planDraw}
              editing={planEdit}
              vertices={planVertices}
              width={planWidth}
              landRate={landRate}
              buildingRate={buildingRate}
              compensationPct={compensationPct}
              busy={planBusy}
              report={planReport}
              open={planOpen}
              options={planOptions}
              activeId={planActive}
              onWidth={(value) => {
                const next = Number(value);
                if (Number.isFinite(next))
                  setPlanWidth(Math.max(1, Math.min(2000, next)));
              }}
              onLand={(value) => {
                const next = Number(value);
                if (Number.isFinite(next)) setLandRate(Math.max(0, next));
              }}
              onBuilding={(value) => {
                const next = Number(value);
                if (Number.isFinite(next)) setBuildingRate(Math.max(0, next));
              }}
              onCompensation={(value) => {
                const next = Number(value);
                if (Number.isFinite(next))
                  setCompensationPct(Math.max(0, Math.min(100, next)));
              }}
              onDraw={() => {
                setPlanDraw(true);
                setPlanEdit(false);
                setPlanActive(null);
                planVerticesRef.current = [];
                setPlanVertices([]);
                setPlanReport(null);
                setPlanOpen(false);
                mapApi.current?.clearPlan?.();
              }}
              onFinish={() => {
                if (planVerticesRef.current.length < 2) return;
                setPlanDraw(false);
                setPlanEdit(false);
                setPlanActive(null);
                measurePlan(planVerticesRef.current, planWidthRef.current);
              }}
              onReshape={() => {
                if (planVerticesRef.current.length < 2) return;
                setPlanDraw(false);
                setPlanEdit(true);
                mapApi.current?.drawReserve?.(
                  planVerticesRef.current,
                  planWidthRef.current,
                );
              }}
              onApply={() => {
                if (planVerticesRef.current.length < 2) return;
                setPlanActive(null);
                measurePlan(planVerticesRef.current, planWidthRef.current);
              }}
              onKeep={() => {
                if (!planReport || planReport.error) return;
                const id = `opt-${Date.now()}`;
                setPlanOptions((current) => [
                  ...current,
                  {
                    id,
                    label: `Option ${current.length + 1}`,
                    vertices: planVertices.map((point) => [...point]),
                    width: planWidth,
                    report: planReport,
                  },
                ]);
                setPlanActive(id);
              }}
              onShowOption={(id) => {
                const option = planOptions.find((item) => item.id === id);
                if (!option) return;
                planVerticesRef.current = option.vertices;
                setPlanVertices(option.vertices);
                setPlanWidth(option.width);
                setPlanReport(applyRates(option.report, planRatesRef.current));
                setPlanDraw(false);
                setPlanEdit(false);
                setPlanActive(id);
                setPlanOpen(true);
                mapApi.current?.drawReserve?.(option.vertices, option.width);
              }}
              onRemoveOption={(id) => {
                setPlanOptions((current) =>
                  current.filter((item) => item.id !== id),
                );
                setPlanActive((current) => (current === id ? null : current));
              }}
              onOpen={() => setPlanOpen(true)}
              onClear={() => {
                setPlanDraw(false);
                setPlanEdit(false);
                setPlanActive(null);
                planVerticesRef.current = [];
                setPlanVertices([]);
                setPlanReport(null);
                setPlanOpen(false);
                mapApi.current?.clearPlan?.();
              }}
              onClose={() => setPlanOpen(false)}
              onExportFail={(message) =>
                setStatus(message || "Could not export the budget.")
              }
            />
          )}
          {pavementPage && <PavementPanel mapApi={mapApi} />}
          {overviewPage && (
            <Overview query={overviewQuery} onQuery={setOverviewQuery} />
          )}
          {editingPage && (
            <EditorSidebar
              hiddenLayerIds={hiddenLayerIds}
              onToggle={(id) =>
                setHiddenLayerIds((current) =>
                  current.includes(id)
                    ? current.filter((item) => item !== id)
                    : [...current, id],
                )
              }
              placingId={placingId}
              lineAnchor={lineAnchor}
              catalog={catalog}
              activeRouteId={route?.id || routeId}
              activeRouteName={route ? routeNameOf(route) : ""}
              roadReady={Boolean(route?.vertices?.length)}
              onSelectRoute={selectRoute}
              notice={editNotice}
              onBeginAdd={(layer) => {
                if (layer.readOnly) return;
                setHiddenLayerIds((current) =>
                  current.filter((id) => id !== layer.id),
                );
                setEditSelection(null);
                setLineAnchor(null);
                setPlaceMarks(null);
                setEditNotice("");
                setPlacingId(layer.id);
                setStatus(
                  route
                    ? layer.kind === "point"
                      ? `${route.id} is active. Click it to place the point.`
                      : `${route.id} is active. Click the start yourself, then click the end.`
                    : "Select the road on the map first.",
                );
              }}
              onCancelAdd={() => {
                setPlacingId(null);
                setLineAnchor(null);
                setPlaceMarks(null);
                setEditNotice("");
                setStatus("");
              }}
            />
          )}
          <main
            ref={mainRef}
            className={`${overviewPage ? "is-hidden" : ""}${focusPane === "map" ? " focus-map" : ""}${focusPane === "chart" ? " focus-chart" : ""}`}
            style={{ gridTemplateRows: chartPage ? rowsFor(chartH) : "1fr" }}
          >
            <section className={`map-pane${legendOpen ? " legend-open" : ""}`}>
              <div ref={mapRef} className="map" />
              {chartPage && (
                <PaneControls
                  enlarged={focusPane === "map"}
                  onToggle={() =>
                    setFocusPane(focusPane === "map" ? "split" : "map")
                  }
                />
              )}
              {(routeLoading || focusing) && (
                <div className="map-loader" role="status" aria-live="polite">
                  <div className="map-loader-card">
                    <span className="spinner" />
                    {routeLoading ? `Loading route ${routeId}…` : focusing}
                  </div>
                </div>
              )}
              {editingPage && (
                <EditorPopup
                  route={route}
                  events={events}
                  selection={editSelection}
                  onClear={(note) => {
                    setEditSelection(null);
                    setPlaceMarks(null);
                    if (note?.sidebar) setEditNotice(note.sidebar);
                  }}
                  onSaved={async (layerId) => {
                    if (!route) return;
                    const located = await loadEvents(route);
                    setEvents(located.events);
                    setMapLayers(located.mapLayers);
                    const def = LRS_LAYER_DEFS.find(
                      (item) => item.id === layerId,
                    );
                    if (!def) return;
                    const layer = await featuresForRoute(def, route);
                    await mapApi.current?.showRouteLayer?.(
                      def,
                      layer.features || [],
                    );
                    const view = mapApi.current?.view;
                    const geometry = editSelection?.geometry;
                    if (!view || !geometry) return;
                    const target =
                      geometry.x != null
                        ? new mapApi.current.Point({
                            longitude: geometry.x,
                            latitude: geometry.y,
                          })
                        : new mapApi.current.Polyline({
                            paths: geometry.paths,
                            spatialReference: { wkid: 4326 },
                          });
                    view
                      .goTo(
                        geometry.x != null
                          ? { target, zoom: 17 }
                          : { target, padding: 72 },
                        { duration: 650 },
                      )
                      .catch(() => {});
                  }}
                />
              )}
              {/* {(chartPage || costPage) && <div className="legend-box">
              <button
                type="button"
                className="legend-toggle"
                aria-expanded={legendOpen}
                onClick={() => setLegendOpen((value) => !value)}
              >
                Layers{" "}
                <span>
                  {LRS_LAYER_DEFS.length - hiddenLayerIds.length}/
                  {LRS_LAYER_DEFS.length}
                </span>{" "}
                {legendOpen ? "▾" : "▸"}
              </button>
              {legendOpen && (
                <ul className="legend">
                  {LRS_LAYER_DEFS.map((layer) => {
                    const hidden = hiddenLayerIds.includes(layer.id);
                    return (
                      <li key={layer.id}>
                        <button
                          type="button"
                          className={hidden ? "off" : ""}
                          aria-pressed={!hidden}
                          onClick={() =>
                            setHiddenLayerIds((current) =>
                              current.includes(layer.id)
                                ? current.filter((id) => id !== layer.id)
                                : [...current, layer.id],
                            )
                          }
                        >
                          <input type="checkbox" readOnly checked={!hidden} />
                          <svg
                            className="legend-symbol"
                            width="14"
                            height="14"
                            viewBox="0 0 14 14"
                          >
                            <ChartSymbol
                              shape={
                                layer.kind === "point" ? layer.shape : "bar"
                              }
                              color={layer.swatch}
                              x={7}
                              y={7}
                              size={0.7}
                            />
                          </svg>
                          {layer.title}
                        </button>
                      </li>
                    );
                    })}
                  {costPage && (
                    <li className="legend-parcels">
                      <button
                        type="button"
                        className={parcelsOn ? "" : "off"}
                        aria-pressed={parcelsOn}
                        onClick={() => setParcelsOn((value) => !value)}
                      >
                        <input type="checkbox" readOnly checked={parcelsOn} />
                        <svg className="legend-symbol" width="14" height="14" viewBox="0 0 14 14">
                          <rect x="2" y="3" width="10" height="8" fill="none" stroke="#facc15" strokeWidth="1.4" />
                        </svg>
                        Parcels
                        <em>zoom in</em>
                      </button>
                    </li>
                  )}
                </ul>
              )}
            </div>} */}
              {chartPage &&
                createPortal(
                  toolsOpen ? (
                    <div className="analysis-panel">
                      <div className="analysis-tools">
                        <div className="analysis-tabs" role="tablist">
                          <button
                            type="button"
                            role="tab"
                            aria-selected={panelTab === "nearest"}
                            className={panelTab === "nearest" ? "on" : ""}
                            onClick={() => setPanelTab("nearest")}
                          >
                            Nearest
                          </button>
                          <button
                            type="button"
                            role="tab"
                            aria-selected={panelTab === "segment"}
                            className={panelTab === "segment" ? "on" : ""}
                            onClick={() => setPanelTab("segment")}
                          >
                            Segment
                          </button>
                          <button
                            type="button"
                            role="tab"
                            aria-selected={panelTab === "compare"}
                            className={panelTab === "compare" ? "on" : ""}
                            onClick={() => setPanelTab("compare")}
                          >
                            Compare
                          </button>
                        </div>
                        <button
                          type="button"
                          className="analysis-hide"
                          onClick={() => setToolsOpen(false)}
                          title="Hide nearest, segment, and compare"
                        >
                          Hide
                        </button>
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
                            setCompareWindow([
                              0,
                              Math.min(
                                WINDOW_KM,
                                next.route.lengthKm || WINDOW_KM,
                              ),
                            ]);
                            const withAssets = new Set(
                              [...events, ...next.events]
                                .filter((item) => item.kind !== "span")
                                .map((item) => item.layerId),
                            );
                            setHiddenLayerIds((current) =>
                              current.filter((id) => !withAssets.has(id)),
                            );
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
                          onPrint={({ a, b, speedA, speedB }) => {
                            const charts = [
                              ...document.querySelectorAll(".chart-col"),
                            ]
                              .map((col) => ({
                                title:
                                  col
                                    .querySelector(".compare-chart-head b")
                                    ?.textContent?.trim() || "",
                                svg:
                                  col.querySelector("svg.chart")?.outerHTML ||
                                  "",
                              }))
                              .filter((chart) => chart.svg);
                            return printMapReport({
                              bag: mapApi.current,
                              a,
                              b,
                              speedA,
                              speedB,
                              charts,
                              segment:
                                segment && route
                                  ? {
                                      routeId: route.id,
                                      from: segment.from,
                                      to: segment.to,
                                      events,
                                    }
                                  : null,
                            });
                          }}
                        />
                      ) : panelTab === "segment" ? (
                        <SegmentAnalysis
                          route={route}
                          events={events}
                          segment={segment}
                          segmentStart={segmentStart}
                          selecting={selectingSegment}
                          windowKm={windowKm}
                          onSegment={(next) => {
                            setSegment(next);
                            setSegmentStart(null);
                            setSelectingSegment(false);
                            if (next) {
                              const pad = Math.max(
                                0.05,
                                (next.to - next.from) * 0.15,
                              );
                              setFollow(false);
                              setWindowKm([
                                Math.max(0, next.from - pad),
                                Math.min(route.lengthKm, next.to + pad),
                              ]);
                            }
                          }}
                          onSelecting={(value) => {
                            setSelectingSegment(value);
                            if (!value) setSegmentStart(null);
                          }}
                          onSelectEvent={focusEvent}
                          onPrint={() =>
                            printRouteReport({
                              bag: mapApi.current,
                              route,
                              events,
                              segment,
                              charts: chartSnapshots(),
                            }).catch((error) =>
                              setStatus(error.message || "Print failed."),
                            )
                          }
                        />
                      ) : (
                        <>
                          <div className="analysis-head">
                            <b>Nearest road analysis</b>
                            {origin && (
                              <button
                                type="button"
                                className="link"
                                onClick={() => setOrigin(null)}
                              >
                                Clear
                              </button>
                            )}
                          </div>
                          <p className="analysis-origin">
                            {origin ? (
                              <>
                                {origin.label}{" "}
                                <span>
                                  {origin.point[1].toFixed(5)},{" "}
                                  {origin.point[0].toFixed(5)}
                                </span>
                              </>
                            ) : (
                              "Search a place, use the location button, or pick a point on the map."
                            )}
                          </p>
                          <button
                            type="button"
                            className={`analysis-pick${pickingOrigin ? " on" : ""}`}
                            onClick={() => setPickingOrigin((value) => !value)}
                          >
                            {pickingOrigin
                              ? "Click the map… (cancel)"
                              : "Pick point on map"}
                          </button>
                          <label className="analysis-radius">
                            <span>Distance</span>
                            <input
                              type="range"
                              min="50"
                              max="10000"
                              step="50"
                              value={radiusM}
                              onChange={(event) => {
                                setRadiusM(Number(event.target.value));
                                setOrigin((current) =>
                                  current?.wide
                                    ? { ...current, wide: false }
                                    : current,
                                );
                              }}
                            />
                            <input
                              type="number"
                              min="10"
                              max="50000"
                              step="10"
                              value={radiusM}
                              onChange={(event) => {
                                setRadiusM(
                                  Math.max(
                                    10,
                                    Number(event.target.value) || 10,
                                  ),
                                );
                                setOrigin((current) =>
                                  current?.wide
                                    ? { ...current, wide: false }
                                    : current,
                                );
                              }}
                            />
                            <em>m</em>
                          </label>
                          {origin && (
                            <div className="analysis-results">
                              {nearest.loading && (
                                <em>Analysing roads within {radiusM} m…</em>
                              )}
                              {nearest.error && (
                                <em className="error">{nearest.error}</em>
                              )}
                              {!nearest.loading &&
                                !nearest.error &&
                                nearest.results.length === 0 && (
                                  <em>
                                    No road within {radiusM} m. Increase the
                                    distance.
                                  </em>
                                )}
                              {!nearest.loading &&
                                nearest.results.length > 0 && (
                                  <ol>
                                    {nearest.results.map((item, index) => (
                                      <li key={item.id}>
                                        <button
                                          type="button"
                                          className={
                                            item.id === routeId ? "active" : ""
                                          }
                                          onClick={() => openNearest(item)}
                                          title="Open this route in the chart"
                                        >
                                          <span
                                            className={
                                              index === 0
                                                ? "rank first"
                                                : "rank"
                                            }
                                          >
                                            {index + 1}
                                          </span>
                                          <span className="road">
                                            {item.id}
                                            {item.code ? ` · ${item.code}` : ""}
                                          </span>
                                          <span className="dist">
                                            {item.distanceKm < 1
                                              ? `${Math.round(item.distanceKm * 1000)} m`
                                              : `${item.distanceKm.toFixed(2)} km`}
                                          </span>
                                        </button>
                                      </li>
                                    ))}
                                  </ol>
                                )}
                            </div>
                          )}
                        </>
                      )}
                    </div>
                  ) : (
                    <button
                      type="button"
                      className="analysis-show"
                      onClick={() => setToolsOpen(true)}
                      title="Show nearest, segment, and compare"
                    >
                      Show tools
                    </button>
                  ),
                  panelHost,
                )}
              {chartPage && (
                <div className="cursor-card">
                  <strong>
                    {cursor
                      ? `${cursor.measure.toFixed(2)} km`
                      : "Hover the selected route"}
                  </strong>
                  {route && (
                    <span>
                      {route.id} · {route.trajectory}
                    </span>
                  )}
                  {grouped.length === 0 && (!route || cursor) && (
                    <em>
                      {route
                        ? "No turned-on layers at this point."
                        : "Features under the cursor appear here, grouped the same way as the chart."}
                    </em>
                  )}
                  {route &&
                    !cursor &&
                    (routeLayerSummary.length ? (
                      <>
                        <em>
                          Turned-on layers on this route. Hover for details.
                        </em>
                        {routeLayerSummary.map(([group, layers]) => (
                          <div key={group}>
                            <b>{groupLabel(group)}</b>
                            <ul>
                              {layers.map((layer) => (
                                <li
                                  key={layer.id}
                                  className="hover-item hover-summary"
                                >
                                  <div className="hover-title">
                                    <svg
                                      width="12"
                                      height="12"
                                      viewBox="0 0 12 12"
                                    >
                                      <ChartSymbol
                                        shape={
                                          layer.kind === "span"
                                            ? "bar"
                                            : layer.shape
                                        }
                                        color={layer.color}
                                        x={6}
                                        y={6}
                                        size={0.65}
                                      />
                                    </svg>
                                    <span>{layer.title}</span>
                                  </div>
                                  <div className="hover-km">
                                    {layer.kind === "span"
                                      ? `${layer.count} · ${layer.km.toFixed(2)} km`
                                      : layer.count}
                                  </div>
                                </li>
                              ))}
                            </ul>
                          </div>
                        ))}
                      </>
                    ) : (
                      <em>
                        {routeLoading
                          ? "Loading route layers…"
                          : "No turned-on layers have data on this route."}
                      </em>
                    ))}
                  {grouped.map(([group, items]) => (
                    <div key={group}>
                      <b>{groupLabel(group)}</b>
                      <ul>
                        {items.map((item) => (
                          <li key={item.id} className="hover-item">
                            <div className="hover-title">
                              <svg width="12" height="12" viewBox="0 0 12 12">
                                <ChartSymbol
                                  shape={
                                    item.kind === "span" ? "bar" : item.shape
                                  }
                                  color={item.color}
                                  x={6}
                                  y={6}
                                  size={0.65}
                                />
                              </svg>
                              <span>
                                {item.title}: <strong>{item.name}</strong>
                              </span>
                            </div>
                            <div className="hover-km">
                              {item.kind === "span"
                                ? `${item.from.toFixed(2)} – ${item.to.toFixed(2)} km`
                                : `${item.measure.toFixed(3)} km`}
                            </div>
                            {item.kind !== "span" &&
                              item.details?.length > 0 && (
                                <dl className="hover-details">
                                  {item.details
                                    .filter(
                                      ([label]) => !/^measure$/i.test(label),
                                    )
                                    .slice(0, 5)
                                    .map(([label, value]) => (
                                      <div key={label}>
                                        <dt>{label}</dt>
                                        <dd>{value}</dd>
                                      </div>
                                    ))}
                                </dl>
                              )}
                          </li>
                        ))}
                      </ul>
                    </div>
                  ))}
                </div>
              )}
            </section>
            {chartPage && (
              <>
                <div
                  className="chart-splitter"
                  role="separator"
                  aria-orientation="horizontal"
                  aria-label="Resize chart"
                  tabIndex={0}
                  onPointerDown={startResize}
                  onDoubleClick={() => setChartH(clampChart(CHART_DEFAULT))}
                  onKeyDown={(event) => {
                    if (event.key === "ArrowUp") {
                      event.preventDefault();
                      setChartH((height) => clampChart(height + 24));
                    }
                    if (event.key === "ArrowDown") {
                      event.preventDefault();
                      setChartH((height) => clampChart(height - 24));
                    }
                  }}
                  title="Drag to resize the chart · double-click to reset"
                >
                  <span className="grip" />
                  <div
                    className="splitter-buttons"
                    onPointerDown={(event) => event.stopPropagation()}
                  >
                    <button
                      type="button"
                      onClick={() => nudgeChart(1)}
                      aria-label="Move chart up"
                      title="Move chart up (taller)"
                    >
                      ▲
                    </button>
                    <button
                      type="button"
                      onClick={() => nudgeChart(-1)}
                      aria-label="Move chart down"
                      title="Move chart down (shorter)"
                    >
                      ▼
                    </button>
                    <button
                      type="button"
                      onClick={() => fitChart(1)}
                      aria-label="Fit chart to its rows"
                      title="Fit chart to show every row"
                    >
                      ⤢
                    </button>
                  </div>
                </div>
                <section className="chart-pane" ref={paneRef}>
                  <PaneControls
                    enlarged={focusPane === "chart"}
                    onToggle={() =>
                      setFocusPane(focusPane === "chart" ? "split" : "chart")
                    }
                  />
                  <div className="station-bar">
                    <button
                      type="button"
                      onClick={() => stepRoute(-1)}
                      aria-label="Previous route"
                    >
                      Prev route
                    </button>
                    {/* <label>
                Route */}
                    <RoutePicker
                      catalog={catalog}
                      value={routeId}
                      emptyLabel="All routes"
                      placeholder="Search route id…"
                      onChange={(id) => {
                        setRouteId(id);
                        setActiveId(null);
                        setActiveEvent(null);
                        setFollow(true);
                      }}
                    />
                    {/* </label> */}
                    <button
                      type="button"
                      onClick={() => stepRoute(1)}
                      aria-label="Next route"
                    >
                      Next route
                    </button>
                    {routeId && (
                      <button
                        type="button"
                        className="route-cancel"
                        onClick={clearRoute}
                        title="Clear this route and pick another"
                      >
                        Cancel
                      </button>
                    )}
                    <button
                      type="button"
                      onClick={() => shiftWindow(-1)}
                      aria-label="Pan station window back"
                    >
                      ‹
                    </button>
                    {/* <label>
                From measure */}
                    <input
                      type="number"
                      inputMode="decimal"
                      value={windowDraft[0]}
                      onFocus={() => {
                        windowFocus.current = 0;
                      }}
                      onChange={(event) => onWindowDraft(0, event.target.value)}
                      onBlur={(event) => onWindowBlur(0, event.target.value)}
                    />
                    {/* </label> */}
                    <span>
                      <assetIcons.BsDash />
                    </span>
                    {/* <label>
                To measure */}
                    <input
                      type="number"
                      inputMode="decimal"
                      value={windowDraft[1]}
                      onFocus={() => {
                        windowFocus.current = 1;
                      }}
                      onChange={(event) => onWindowDraft(1, event.target.value)}
                      onBlur={(event) => onWindowBlur(1, event.target.value)}
                    />
                    {/* </label> */}
                    <button
                      type="button"
                      onClick={() => shiftWindow(1)}
                      aria-label="Pan station window forward"
                    >
                      ›
                    </button>
                    <button
                      type="button"
                      disabled={!route}
                      onClick={() => {
                        setFollow(false);
                        commitSegment(windowKm[0], windowKm[1]);
                      }}
                      className="analysis-button"
                    >
                      Analyse segment
                    </button>
                    {/* <span className="status">
                {status ||
                  (route
                    ? `${route.lengthKm.toFixed(1)} km · ${events.length} located features`
                    : "")}
              </span> */}
                  </div>
                  <span className="chart-display-title">Layers</span>
                  <div className="chart-display">
                    {/* {GROUPS.filter((group) => group.id === "POI" || group.id === "ATT").map((group) => {
                const ids = LRS_LAYER_DEFS.filter((layer) => layer.group === group.id && layer.chart !== false).map((layer) => layer.id);
                const shown = ids.some((id) => !hiddenLayerIds.includes(id));
                return (
                  <label key={group.id}>
                    <input
                      type="checkbox"
                      checked={shown}
                      onChange={() => setHiddenLayerIds((current) => (
                        shown ? [...new Set([...current, ...ids])] : current.filter((id) => !ids.includes(id))
                      ))}
                    />
                    {group.label}
                  </label>
                );
              })} */}
                    {LRS_LAYER_DEFS.filter(
                      (layer) => layer.chart !== false,
                    ).map((layer) => (
                      <label key={layer.id}>
                        <input
                          type="checkbox"
                          checked={!hiddenLayerIds.includes(layer.id)}
                          onChange={() =>
                            setHiddenLayerIds((current) =>
                              current.includes(layer.id)
                                ? current.filter((id) => id !== layer.id)
                                : [...current, layer.id],
                            )
                          }
                        />
                        <i style={{ background: layer.swatch }} />
                        {layer.title}
                      </label>
                    ))}
                  </div>

                  {route && (
                    <div
                      className={
                        compareShown ? "charts-parallel" : "charts-single"
                      }
                    >
                      <div className="chart-col">
                        {compareShown && (
                          <div className="compare-chart-head a">
                            <i className="swatch a" />
                            <b>Route A · {route.id}</b>
                            <span>
                              {route.lengthKm.toFixed(1)} km · {events.length}{" "}
                              features
                            </span>
                            <label
                              className="check link-toggle"
                              title="Keep both charts on the same km window and cursor"
                            >
                              <input
                                type="checkbox"
                                checked={linkCompare}
                                onChange={(event) =>
                                  setLinkCompare(event.target.checked)
                                }
                              />
                              Link km
                            </label>
                          </div>
                        )}
                        <StripChart
                          fill
                          hiddenLayerIds={hiddenLayerIds}
                          events={events}
                          projects={routeProjects}
                          route={route}
                          windowKm={windowKm}
                          cursor={cursor}
                          segment={segment}
                          segmentStart={segmentStart}
                          selectingSegment={selectingSegment}
                          onSegment={commitSegment}
                          onSegmentPoint={onSegmentPoint}
                          onWindow={(start, end) => {
                            const span = end - start;
                            const from = Math.max(
                              0,
                              Math.min((route.lengthKm || span) - span, start),
                            );
                            setWindowKm([from, from + span]);
                          }}
                          onHoverMeasure={(measure) => {
                            const clamped = Math.max(
                              0,
                              Math.min(route.lengthKm, measure),
                            );
                            setCursor({ measure: clamped, source: "chart" });
                          }}
                          activeEventId={activeEvent?.id}
                          attachedIds={(activeProject?.attached || []).map(
                            (item) => item.id,
                          )}
                          onSelectEvent={focusEvent}
                          onPickProject={(project) => setActiveId(project.id)}
                        />
                      </div>
                      {compareShown && (
                        <div className="chart-col compare-chart">
                          <div className="compare-chart-head">
                            <i className="swatch b" />
                            <b>Route B · {compareShown.route.id}</b>
                            <span>
                              {compareShown.route.lengthKm.toFixed(1)} km ·{" "}
                              {compareShown.events.length} features
                            </span>
                            <button
                              type="button"
                              className="link"
                              onClick={() => {
                                setCompare(null);
                                setCompareCursor(null);
                                setCompareEvent(null);
                              }}
                            >
                              Close
                            </button>
                          </div>
                          <StripChart
                            fill
                            hiddenLayerIds={hiddenLayerIds}
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
                    </div>
                  )}
                </section>
              </>
            )}
          </main>
          {chartPage && (
            <aside className="summary-rail">
              <article className="summary-card">
                <header>
                  <span>Route information</span>
                  {routeId && (
                    <button
                      type="button"
                      className="route-cancel"
                      onClick={clearRoute}
                    >
                      Cancel
                    </button>
                  )}
                </header>
                <dl>
                  <div>
                    <dt>Route ID</dt>
                    <dd>{routeSummary.id || "—"}</dd>
                  </div>
                  <div>
                    <dt>Road name</dt>
                    <dd>{routeSummary.name || "—"}</dd>
                  </div>
                  <div>
                    <dt>Classification</dt>
                    <dd>{routeSummary.classification || "—"}</dd>
                  </div>
                  <div>
                    <dt>Length</dt>
                    <dd>
                      {Number.isFinite(routeSummary.length)
                        ? `${routeSummary.length.toFixed(2)} km`
                        : "—"}
                    </dd>
                  </div>
                  <div>
                    <dt>Surface</dt>
                    <dd>{routeSummary.surface || "—"}</dd>
                  </div>
                </dl>
                <div className="route-assets">
                  <b>Assets on route</b>
                  {!route && <p>Select a route to see its assets.</p>}
                  {route && routeAssets.length === 0 && (
                    <p>No assets on this route.</p>
                  )}
                  {routeAssets.length > 0 && (
                    <ul>
                      {routeAssets.map((item) => {
                        const open = openAssetId === item.id;
                        const summary =
                          item.kind === "span"
                            ? `${item.count} · ${item.km.toFixed(2)} km`
                            : item.count;
                        return (
                          <li key={item.id}>
                            {item.kind === "span" ? (
                              <button
                                type="button"
                                className="asset-line"
                                aria-expanded={open}
                                onClick={() => {
                                  setOpenAssetId(open ? null : item.id);
                                  setOpenTypeKey("");
                                }}
                              >
                                <span>
                                  <i className="caret">{open ? "▾" : "▸"}</i>
                                  {item.title}
                                </span>
                                <em>{summary}</em>
                              </button>
                            ) : (
                              <div className="asset-line">
                                <span>{item.title}</span>
                                <em>{summary}</em>
                              </div>
                            )}
                            {open && (
                              <ul className="asset-types">
                                {item.types.map((type) => {
                                  const key = `${item.id}:${type.name}`;
                                  const typeOpen = openTypeKey === key;
                                  return (
                                    <li key={key}>
                                      <button
                                        type="button"
                                        className="type-line"
                                        aria-expanded={typeOpen}
                                        onClick={() =>
                                          setOpenTypeKey(typeOpen ? "" : key)
                                        }
                                      >
                                        <i
                                          className="swatch"
                                          style={{ background: type.color }}
                                        />
                                        <span>{type.name}</span>
                                        <em>
                                          {type.count} · {type.km.toFixed(2)} km
                                        </em>
                                      </button>
                                      {typeOpen && (
                                        <ul className="asset-segments">
                                          {type.segments.map((segment) => (
                                            <li key={segment.id}>
                                              <button
                                                type="button"
                                                className={`segment-line${activeEvent?.id === segment.id ? " on" : ""}`}
                                                onClick={() =>
                                                  focusEvent(segment)
                                                }
                                              >
                                                <span>
                                                  {segment.from.toFixed(2)} –{" "}
                                                  {segment.to.toFixed(2)} km
                                                </span>
                                                <em>
                                                  {Math.max(
                                                    0,
                                                    segment.to - segment.from,
                                                  ).toFixed(2)}{" "}
                                                  km
                                                </em>
                                              </button>
                                            </li>
                                          ))}
                                        </ul>
                                      )}
                                    </li>
                                  );
                                })}
                              </ul>
                            )}
                          </li>
                        );
                      })}
                    </ul>
                  )}
                </div>
              </article>
              <article className="summary-card">
                <header>
                  <span>Selected event</span>
                  {activeEvent && (
                    <svg
                      width="16"
                      height="16"
                      viewBox="0 0 16 16"
                      aria-hidden="true"
                    >
                      <ChartSymbol
                        shape={
                          activeEvent.kind === "span"
                            ? "bar"
                            : activeEvent.shape
                        }
                        color={activeEvent.color}
                        x={8}
                        y={8}
                        size={0.8}
                      />
                    </svg>
                  )}
                </header>
                {activeEvent ? (
                  <>
                    <strong>{activeEvent.title}</strong>
                    <em>{activeEvent.name}</em>
                    <dl>
                      <div>
                        <dt>Measure</dt>
                        <dd>
                          {activeEvent.kind === "span"
                            ? `${activeEvent.from.toFixed(2)} – ${activeEvent.to.toFixed(2)} km`
                            : `${activeEvent.measure.toFixed(3)} km`}
                        </dd>
                      </div>
                      {(activeEvent.details || [])
                        .slice(0, 10)
                        .map(([label, value]) => (
                          <div key={label}>
                            <dt>{label}</dt>
                            <dd>{value}</dd>
                          </div>
                        ))}
                    </dl>
                    <div className="summary-actions">
                      <button
                        type="button"
                        onClick={() => focusEvent(activeEvent)}
                      >
                        Open in map
                      </button>
                      {/* {!LRS_LAYER_DEFS.find((layer) => layer.id === activeEvent.layerId)?.readOnly && (
                      <button type="button" onClick={() => setViewMode("edit")}>Edit</button>
                    )} */}
                    </div>
                  </>
                ) : (
                  <p>Click a symbol on the chart or the map to see it here.</p>
                )}
              </article>
              <article className="summary-card">
                <header>
                  <span>Legend</span>
                </header>
                <ul className="summary-legend">
                  {LRS_LAYER_DEFS.filter((layer) => layer.chart !== false).map(
                    (layer) => (
                      <li key={layer.id}>
                        <svg
                          width="16"
                          height="16"
                          viewBox="0 0 16 16"
                          aria-hidden="true"
                        >
                          <ChartSymbol
                            shape={layer.kind === "point" ? layer.shape : "bar"}
                            color={layer.swatch}
                            x={8}
                            y={8}
                            size={0.75}
                          />
                        </svg>
                        {layer.title}
                      </li>
                    ),
                  )}
                </ul>
              </article>
            </aside>
          )}
        </div>
      </div>
    </div>
  );
}
