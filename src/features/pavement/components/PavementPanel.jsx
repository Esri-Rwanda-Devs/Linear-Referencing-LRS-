import { useEffect, useMemo, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { loadPavementInExtent, loadPavementRoad } from "../../mapping/services/lrsService";
import {
  CLASS_LABEL,
  INDICATORS,
  TREATMENT,
  conditionClass,
  conditionSummary,
  hasPotholes,
  priorityIds,
  rankSegments,
  roadKeyOf,
  surveyRecord,
  toSegment,
  worstSegments,
} from "../pms";
import "./PavementPanel.css";

const numberText = (value, digits = 1) => (Number.isFinite(value) ? value.toFixed(digits) : "—");
const kmText = (value) => (Number.isFinite(value) ? `${value.toFixed(2)} km` : "—");
const measureText = (segment) => (
  Number.isFinite(segment.from) && Number.isFinite(segment.to)
    ? `${segment.from.toFixed(2)} – ${segment.to.toFixed(2)} km`
    : kmText(segment.lengthKm)
);

function Toggle({ indicator, onChange }) {
  return (
    <div className="pms-toggle" role="group" aria-label="Condition indicator">
      {INDICATORS.map((item) => (
        <button
          key={item.id}
          type="button"
          className={indicator === item.id ? "on" : ""}
          aria-pressed={indicator === item.id}
          onClick={() => onChange(item.id)}
        >
          {item.label}
        </button>
      ))}
    </div>
  );
}

function Fact({ label, value }) {
  if (!value) return null;
  return (
    <div>
      <dt>{label}</dt>
      <dd>{value}</dd>
    </div>
  );
}

export default function PavementPanel({ mapApi }) {
  const [indicator, setIndicator] = useState("pci");
  const [viewSegments, setViewSegments] = useState([]);
  const [roadSegments, setRoadSegments] = useState([]);
  const [pickedId, setPickedId] = useState(null);
  const [activeKey, setActiveKey] = useState("");
  const [loading, setLoading] = useState(false);
  const [truncated, setTruncated] = useState(false);
  const [loadError, setLoadError] = useState("");
  const [pane, setPane] = useState(null);
  const extentKey = useRef("");
  const requestId = useRef(0);
  const pickRef = useRef(null);
  pickRef.current = (id) => setPickedId(id);

  useEffect(() => {
    setPane(document.querySelector(".map-pane"));
    let dead = false;
    let timer = 0;
    let handle = null;
    const boot = () => {
      const bag = mapApi.current;
      if (!bag?.setPavementMode || !bag.view) {
        timer = requestAnimationFrame(boot);
        return;
      }
      bag.setPavementMode(true, (id) => pickRef.current?.(id));
      const load = () => {
        if (dead || !bag.view.stationary) return;
        const extent = bag.mapExtent?.();
        if (!extent) return;
        const key = [extent.xmin, extent.ymin, extent.xmax, extent.ymax].map((value) => value.toFixed(3)).join(",");
        if (key === extentKey.current) return;
        extentKey.current = key;
        const token = requestId.current + 1;
        requestId.current = token;
        setLoading(true);
        loadPavementInExtent(extent).then((result) => {
          if (dead || token !== requestId.current) return;
          setViewSegments((result.features || []).map(toSegment).filter(Boolean));
          setTruncated(Boolean(result.truncated));
          setLoadError("");
        }).catch((error) => {
          if (dead || token !== requestId.current) return;
          setLoadError(error.message || "Could not load pavement.");
        }).finally(() => {
          if (!dead && token === requestId.current) setLoading(false);
        });
      };
      load();
      handle = bag.view.watch("stationary", (still) => {
        if (still) load();
      });
    };
    boot();
    return () => {
      dead = true;
      cancelAnimationFrame(timer);
      handle?.remove();
      mapApi.current?.setPavementMode?.(false);
    };
  }, [mapApi]);

  useEffect(() => {
    if (pickedId == null) return undefined;
    const hit = viewSegments.find((segment) => segment.id === pickedId)
      || roadSegments.find((segment) => segment.id === pickedId);
    if (!hit) return undefined;
    const key = roadKeyOf(hit);
    if (key) setActiveKey((current) => (current === key ? current : key));
    return undefined;
  }, [pickedId, viewSegments, roadSegments]);

  useEffect(() => {
    if (!activeKey) {
      setRoadSegments([]);
      return undefined;
    }
    let dead = false;
    loadPavementRoad(activeKey).then((features) => {
      if (!dead) setRoadSegments((features || []).map(toSegment).filter(Boolean));
    }).catch(() => {
      if (!dead) setRoadSegments([]);
    });
    return () => {
      dead = true;
    };
  }, [activeKey]);

  const road = useMemo(() => {
    if (roadSegments.length) return roadSegments;
    return viewSegments.filter((segment) => roadKeyOf(segment) === activeKey);
  }, [roadSegments, viewSegments, activeKey]);

  const summary = useMemo(() => conditionSummary(road, indicator), [road, indicator]);
  const ranked = useMemo(() => rankSegments(road, indicator), [road, indicator]);
  const worst = useMemo(() => worstSegments(road), [road]);
  const highlighted = useMemo(() => priorityIds(road, indicator), [road, indicator]);
  const potholes = useMemo(() => road.filter((segment) => hasPotholes(segment.potholes)), [road]);
  const surveys = useMemo(() => surveyRecord(road), [road]);
  const selected = road.find((segment) => segment.id === pickedId)
    || viewSegments.find((segment) => segment.id === pickedId)
    || null;
  const indicatorMeta = INDICATORS.find((item) => item.id === indicator) || INDICATORS[0];

  const drawn = useMemo(() => {
    const byId = new Map();
    viewSegments.forEach((segment) => byId.set(segment.id, segment));
    road.forEach((segment) => byId.set(segment.id, segment));
    return [...byId.values()];
  }, [viewSegments, road]);

  useEffect(() => {
    const bag = mapApi.current;
    if (!bag?.showPavement) return;
    bag.showPavement(drawn.map((segment) => ({
      id: segment.id,
      paths: segment.paths,
      className: conditionClass(segment, indicator),
      selected: segment.id === pickedId,
      priority: highlighted.has(segment.id),
    })));
  }, [drawn, indicator, pickedId, highlighted, mapApi]);

  const openSegment = (segment) => {
    setPickedId(segment.id);
    const key = roadKeyOf(segment);
    if (key) setActiveKey(key);
    mapApi.current?.focusPavement?.(segment.paths);
  };

  const legend = (
    <div className="pms-legend">
      <div className="pms-legend-head">
        <span>Condition</span>
        <strong>{indicatorMeta.label}</strong>
      </div>
      <Toggle indicator={indicator} onChange={setIndicator} />
      <ul className="pms-legend-list">
        {["good", "fair", "poor"].map((id) => (
          <li key={id}>
            <span className={`pms-swatch ${id}`} />
            <span>{CLASS_LABEL[id]}</span>
          </li>
        ))}
      </ul>
    </div>
  );

  return (
    <>
      {pane ? createPortal(legend, pane) : null}
      <aside className="pms-side">
        <h2>Pavement</h2>
        <p className="pms-note">
          Colour the network by {indicatorMeta.title}. Good is green, Fair is yellow, and Poor is red. Click a segment for its record.
        </p>
        <Toggle indicator={indicator} onChange={setIndicator} />
        <p className={`pms-status${loadError ? " error" : ""}`}>
          {loadError || (loading ? "Loading pavement in this view…" : `${viewSegments.length} segments in view${truncated ? ". Zoom in to load the rest." : "."}`)}
        </p>
        {!selected && <p className="pms-note">Click a coloured segment to open the road.</p>}
        {selected && (
          <>
            <div className="pms-road">
              <strong>{selected.routeName || selected.roadCode || selected.routeId || "Selected road"}</strong>
              <span>{[selected.roadCode, selected.linkName, selected.roadCategory].filter(Boolean).join(" · ")}</span>
              <span className={`pms-badge ${summary.overall}`}>{CLASS_LABEL[summary.overall]} overall</span>
            </div>
            <div className="pms-stats">
              <div>
                <span>Average PCI</span>
                <b>{numberText(summary.averagePci, 0)}</b>
              </div>
              <div>
                <span>Average IRI</span>
                <b>{numberText(summary.averageIri, 1)}</b>
              </div>
            </div>
            <h3>Condition summary · {indicatorMeta.title}</h3>
            <div className="pms-bar" aria-hidden="true">
              {summary.parts.map((part) => <i key={part.id} className={part.id} style={{ width: `${part.percent}%` }} />)}
            </div>
            <ul className="pms-split">
              {summary.parts.map((part) => (
                <li key={part.id}>
                  <span>{part.label}</span>
                  <span>{kmText(part.lengthKm)} · {part.percent.toFixed(0)}%</span>
                </li>
              ))}
            </ul>
            <h3>Selected segment</h3>
            <dl className="pms-facts">
              <Fact label="Measure" value={measureText(selected)} />
              <Fact label="PCI" value={[numberText(selected.pci, 0), selected.pciRange].filter((item) => item && item !== "—").join(" · ")} />
              <Fact label="IRI" value={[numberText(selected.iri, 1), selected.iriRange].filter((item) => item && item !== "—").join(" · ")} />
              <Fact label="Cracking" value={selected.cracking} />
              <Fact label="Potholes" value={selected.potholes || "None recorded"} />
              <Fact label="Pavement" value={[selected.pavementCategory, selected.pavementType, selected.surfaceType].filter(Boolean).join(" · ")} />
              <Fact label="Survey" value={selected.surveyYear} />
              {selected.defects.map(([label, value]) => <Fact key={label} label={label} value={value} />)}
            </dl>
            <p className="pms-treatment">
              {CLASS_LABEL[conditionClass(selected, indicator)]} · {TREATMENT[conditionClass(selected, indicator)]}
            </p>
            <h3>Potholes</h3>
            {potholes.length === 0 && <p className="pms-note">No potholes recorded on this road.</p>}
            {potholes.length > 0 && (
              <ul className="pms-list">
                {potholes.slice(0, 8).map((segment) => (
                  <li key={segment.id}>
                    <button type="button" className={segment.id === pickedId ? "on" : ""} onClick={() => openSegment(segment)}>
                      <span>{measureText(segment)}</span>
                      <em>{segment.potholes}</em>
                    </button>
                  </li>
                ))}
              </ul>
            )}
            <h3>Survey record</h3>
            <ul className="pms-split">
              {surveys.map((entry) => (
                <li key={entry.year}>
                  <span>{entry.year}</span>
                  <span>{entry.count} segments{entry.pciCount ? ` · PCI ${Math.round(entry.pci / entry.pciCount)}` : ""}</span>
                </li>
              ))}
            </ul>
            <h3>Worst segments</h3>
            <ul className="pms-list">
              {worst.map((segment) => (
                <li key={segment.id}>
                  <button type="button" className={segment.id === pickedId ? "on" : ""} onClick={() => openSegment(segment)}>
                    <span>{measureText(segment)}</span>
                    <em>PCI {numberText(segment.pci, 0)}</em>
                  </button>
                </li>
              ))}
            </ul>
            <h3>Maintenance priority</h3>
            <ul className="pms-list">
              {ranked.slice(0, 12).map((segment, index) => {
                const tone = conditionClass(segment, indicator);
                return (
                  <li key={segment.id}>
                    <button type="button" className={segment.id === pickedId ? "on" : ""} onClick={() => openSegment(segment)}>
                      <span>{index + 1}. {measureText(segment)} · {CLASS_LABEL[tone]}</span>
                      <em>{TREATMENT[tone]}</em>
                    </button>
                  </li>
                );
              })}
            </ul>
          </>
        )}
      </aside>
    </>
  );
}
