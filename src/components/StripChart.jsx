import { memo, useEffect, useId, useMemo, useRef, useState } from "react";
import { GROUPS, LRS_LAYER_DEFS } from "../config";

const ROW_H = 20;
const AXIS_H = 24;
const CHAR_W = 4.4;

const ROWS = [];
function rowsFor() {
  if (ROWS.length) return ROWS;
  const rows = [];
  GROUPS.forEach((group) => {
    const layers = LRS_LAYER_DEFS.filter((layer) => layer.group === group.id && layer.chart !== false);
    if (!layers.length && group.id !== "PLN") return;
    rows.push({ type: "group", ...group });
    layers.forEach((layer) => rows.push({ type: "layer", group: group.id, title: layer.title, color: layer.swatch, shape: layer.kind === "point" ? layer.shape : "bar", layerId: layer.id }));
    if (group.id === "PLN") rows.push({ type: "layer", group: "PLN", title: "Projects", color: group.color, shape: "bar" });
  });
  ROWS.push(...rows);
  return ROWS;
}

export function ChartSymbol({ shape, color, x, y, size = 1 }) {
  const s = size;
  if (shape === "triangle") return <polygon points={`${x},${y - 6 * s} ${x - 5 * s},${y + 4 * s} ${x + 5 * s},${y + 4 * s}`} fill={color} />;
  if (shape === "diamond") return <polygon points={`${x},${y - 5.5 * s} ${x + 4.5 * s},${y} ${x},${y + 5.5 * s} ${x - 4.5 * s},${y}`} fill={color} />;
  if (shape === "square") return <rect x={x - 4 * s} y={y - 4 * s} width={8 * s} height={8 * s} fill={color} />;
  if (shape === "circle") return <circle cx={x} cy={y} r={4 * s} fill={color} />;
  if (shape === "bar") return <rect x={x - 6 * s} y={y - 3 * s} width={12 * s} height={6 * s} rx="1.5" fill={color} />;
  if (shape === "plus") return <path d={`M ${x - 4 * s} ${y} H ${x + 4 * s} M ${x} ${y - 4 * s} V ${y + 4 * s}`} stroke={color} strokeWidth="1.8" />;
  return (
    <g stroke={color} strokeWidth="1.8">
      <path d={`M ${x - 4 * s} ${y - 4 * s} L ${x + 4 * s} ${y + 4 * s}`} />
      <path d={`M ${x + 4 * s} ${y - 4 * s} L ${x - 4 * s} ${y + 4 * s}`} />
    </g>
  );
}

const MIN_CHARS = 6;

/** True for colours dark enough to need white label text. */
function isDark(color) {
  const hex = typeof color === "string" && /^#([0-9a-f]{6})$/i.exec(color);
  if (!hex) return false;
  const n = parseInt(hex[1], 16);
  const luminance = (0.299 * ((n >> 16) & 255) + 0.587 * ((n >> 8) & 255) + 0.114 * (n & 255)) / 255;
  return luminance < 0.5;
}

/** Returns the label that fits in maxPx, or "" when it would be squeezed below a readable length. */
function fitText(text, maxPx) {
  const max = Math.floor(maxPx / CHAR_W);
  if (text.length <= max) return text;
  if (max < MIN_CHARS) return "";
  return `${text.slice(0, max - 1)}…`;
}

/** Joins touching spans that carry the same label so one name is drawn per run. */
function mergeRuns(items) {
  const sorted = [...items].sort((a, b) => a.from - b.from);
  const runs = [];
  sorted.forEach((item) => {
    const last = runs[runs.length - 1];
    if (last && last.name === item.name && last.color === item.color && item.from <= last.to + 0.01) {
      last.to = Math.max(last.to, item.to);
      last.items.push(item);
    } else {
      runs.push({ name: item.name, from: item.from, to: item.to, color: item.color, items: [item] });
    }
  });
  return runs;
}

/** Whole-road overview: the thumb is the station window, the orange tick is the cursor. Drag or click to move along the road. */
function RoadSlider({ lengthKm, from, to, cursor, events, onWindow }) {
  const trackRef = useRef(null);
  const dragRef = useRef(null);
  const span = to - from;
  const pct = (measure) => `${Math.max(0, Math.min(100, (measure / lengthKm) * 100))}%`;
  const measureAt = (clientX) => {
    const rect = trackRef.current.getBoundingClientRect();
    return ((clientX - rect.left) / rect.width) * lengthKm;
  };
  const centreOn = (measure) => onWindow(measure - span / 2, measure + span / 2);

  const onPointerDown = (event) => {
    event.preventDefault();
    const measure = measureAt(event.clientX);
    const onThumb = measure >= from && measure <= to;
    dragRef.current = { offset: onThumb ? measure - from : span / 2 };
    if (!onThumb) centreOn(measure);
    event.currentTarget.setPointerCapture(event.pointerId);
  };
  const onPointerMove = (event) => {
    if (!dragRef.current) return;
    const start = measureAt(event.clientX) - dragRef.current.offset;
    onWindow(start, start + span);
  };
  const onPointerUp = () => { dragRef.current = null; };

  const poiTicks = useMemo(() => {
    const BINS = 320;
    const bins = new Array(BINS);
    events.forEach((item) => {
      if (item.kind === "span") return;
      const index = Math.max(0, Math.min(BINS - 1, Math.floor((item.measure / lengthKm) * BINS)));
      const bin = bins[index] || (bins[index] = { count: 0, color: item.color });
      bin.count += 1;
    });
    return bins.map((bin, index) => (bin
      ? <i key={index} className="road-slider-poi" style={{ left: `${((index + 0.5) / BINS) * 100}%`, background: bin.color, opacity: Math.min(0.9, 0.35 + bin.count * 0.08) }} />
      : null));
  }, [events, lengthKm]);
  return (
    <div className="road-slider">
      <span className="road-slider-end">0</span>
      <div
        ref={trackRef}
        className="road-slider-track"
        onPointerDown={onPointerDown}
        onPointerMove={onPointerMove}
        onPointerUp={onPointerUp}
        onPointerCancel={onPointerUp}
      >
        {poiTicks}
        <div className="road-slider-thumb" style={{ left: pct(from), width: `${Math.max(0.6, (span / lengthKm) * 100)}%` }} />
        {cursor && <div className="road-slider-cursor" style={{ left: pct(cursor.measure) }} />}
      </div>
      <span className="road-slider-end">{lengthKm.toFixed(1)} km</span>
    </div>
  );
}

function StripChart({ events, projects, route, windowKm, cursor, segment, selectingSegment, activeEventId, attachedIds, onWindow, onHoverMeasure, onSegment, onPickProject, onSelectEvent }) {
  const [drag, setDrag] = useState(null);
  const clipId = `plot-clip-${useId().replace(/:/g, "")}`;
  const rows = rowsFor();
  const labelW = 150;
  const width = 1100;
  const right = width - 8;
  const plotW = right - labelW - 4;
  const height = AXIS_H + rows.length * ROW_H + 8;
  const [from, to] = windowKm;
  const span = Math.max(0.2, to - from);
  const xOf = (measure) => labelW + ((measure - from) / span) * plotW;
  const clampX = (x) => Math.max(labelW, Math.min(right, x));
  const measureOf = (clientX, svg) => {
    const rect = svg.getBoundingClientRect();
    const local = ((clientX - rect.left) / rect.width) * width;
    return from + ((local - labelW) / plotW) * span;
  };

  const ticks = [];
  const step = span > 40 ? 5 : span > 16 ? 2 : span > 4 ? 1 : 0.5;
  for (let m = Math.ceil(from / step) * step; m <= to; m += step) ticks.push(Number(m.toFixed(2)));

  const svgRef = useRef(null);
  useEffect(() => {
    const node = svgRef.current;
    if (!node) return undefined;
    const onWheel = (event) => {
      event.preventDefault();
      const delta = event.deltaY > 0 ? span * 0.08 : -span * 0.08;
      const mid = (from + to) / 2;
      const next = Math.max(0.5, span + delta);
      onWindow(mid - next / 2, mid + next / 2);
    };
    node.addEventListener("wheel", onWheel, { passive: false });
    return () => node.removeEventListener("wheel", onWheel);
  }, [from, to, span, onWindow]);

  const selectRef = useRef(onSelectEvent);
  selectRef.current = onSelectEvent;
  const projectRef = useRef(onPickProject);
  projectRef.current = onPickProject;
  const hoverRef = useRef(onHoverMeasure);
  hoverRef.current = onHoverMeasure;
  const hoverFrame = useRef(0);
  const hoverAt = (measure) => {
    if (hoverFrame.current) cancelAnimationFrame(hoverFrame.current);
    hoverFrame.current = requestAnimationFrame(() => {
      hoverFrame.current = 0;
      hoverRef.current(measure);
    });
  };

  const byLayer = useMemo(() => {
    const index = new Map();
    events.forEach((item) => {
      const bucket = index.get(item.layerId) || { spans: [], points: [] };
      (item.kind === "span" ? bucket.spans : bucket.points).push(item);
      index.set(item.layerId, bucket);
    });
    index.forEach((bucket) => {
      bucket.spans.sort((a, b) => a.from - b.from);
      bucket.points.sort((a, b) => a.measure - b.measure);
    });
    return index;
  }, [events]);

  const attachedKey = (attachedIds || []).join("|");
  const rowsSvg = useMemo(() => {
    const attached = new Set(attachedKey ? attachedKey.split("|") : []);
    const pick = (item) => (event) => {
      event.stopPropagation();
      if (item.group === "PLN") projectRef.current?.(item);
      else selectRef.current?.(item);
    };
    const firstAtOrAfter = (list, measure) => {
      let lo = 0;
      let hi = list.length;
      while (lo < hi) {
        const mid = (lo + hi) >> 1;
        if (list[mid].measure < measure) lo = mid + 1;
        else hi = mid;
      }
      return lo;
    };
    const tooltip = (item, range) => [`${item.title ? `${item.title}: ` : ""}${item.name}`, range, ...(item.details || []).map(([label, value]) => `${label}: ${value}`)].join("\n");

    return rows.map((row, index) => {
      const y = AXIS_H + index * ROW_H;
      if (row.type === "group") {
        return (
          <g key={`${row.id}-g`}>
            <rect x="0" y={y + 2} width={labelW - 8} height={ROW_H - 4} rx="3" fill={row.color} />
            <text x="8" y={y + 13.5} fill="#fff" fontSize="9.5" fontWeight="700">{row.label}</text>
            <text x={labelW + 6} y={y + 13.5} fill="#94a3b8" fontSize="8.5">{row.hint}</text>
          </g>
        );
      }
      const yMid = y + ROW_H / 2;
      let spans;
      let points;
      if (row.group === "PLN") {
        spans = projects.map((project) => ({
          ...project,
          kind: "span",
          from: project.startKm,
          to: project.endKm,
          color: project.priority === "High" ? "#be123c" : "#fb7185",
          name: project.name,
          group: "PLN",
        })).filter((item) => item.to >= from && item.from <= to);
        points = [];
      } else {
        const bucket = byLayer.get(row.layerId) || { spans: [], points: [] };
        spans = bucket.spans.filter((item) => item.to >= from && item.from <= to);
        const startAt = firstAtOrAfter(bucket.points, from);
        const endAt = firstAtOrAfter(bucket.points, to + 1e-9);
        points = bucket.points.slice(startAt, endAt);
      }
      const runs = mergeRuns(spans);

      const drawn = [];
      let lastX = -Infinity;
      points.forEach((item) => {
        const x = xOf(item.measure);
        const special = item.id === activeEventId || attached.has(item.id);
        if (!special && x - lastX < 3 && drawn.length) {
          drawn[drawn.length - 1].hidden += 1;
          return;
        }
        drawn.push({ item, x, hidden: 0 });
        lastX = x;
      });

      let labelEnd = -Infinity;
      return (
        <g key={`${row.group}-${row.title}`}>
          <ChartSymbol shape={row.shape} color={row.color} x={14} y={yMid} size={0.75} />
          <text x="24" y={yMid + 3.5} fill="#334155" fontSize="9.5">{row.title}</text>
          <line x1={labelW} x2={right} y1={yMid} y2={yMid} stroke="#e2e8f0" />
          <g clipPath={`url(#${clipId})`}>
            {runs.map((run, runIndex) => {
              const x1 = clampX(xOf(run.from));
              const x2 = clampX(xOf(run.to));
              const first = run.items[0];
              return (
                <rect key={`r-${runIndex}`} x={x1} y={yMid - 4} width={Math.max(1.5, x2 - x1)} height="8" rx="2" fill={run.color} opacity="0.85"
                  stroke="#fff" strokeWidth="0.6" style={{ cursor: "pointer" }} onClick={pick(first)}>
                  <title>{tooltip({ ...first, title: "" }, `${run.from.toFixed(3)} – ${run.to.toFixed(3)} km${run.items.length > 1 ? ` · ${run.items.length} records` : ""}`)}</title>
                </rect>
              );
            })}
            {runs.map((run, runIndex) => {
              const x1 = clampX(xOf(run.from));
              const x2 = clampX(xOf(run.to));
              const start = Math.max(x1 + 4, labelEnd + 6);
              const text = fitText(run.name, x2 - start - 4);
              if (!text) return null;
              labelEnd = start + text.length * CHAR_W;
              const dark = isDark(run.color);
              return (
                <text key={`t-${runIndex}`} x={start} y={yMid + 2.5} fontSize="7.5" fontWeight="600" fill={dark ? "#ffffff" : "#0f172a"} pointerEvents="none"
                  stroke={dark ? "rgba(15,23,42,0.6)" : "rgba(255,255,255,0.85)"} strokeWidth="2" paintOrder="stroke">{text}</text>
              );
            })}
            {drawn.map(({ item, x, hidden }, drawIndex) => {
              const active = item.id === activeEventId;
              const isAttached = attached.has(item.id);
              const next = drawn[drawIndex + 1];
              const room = Math.min(90, (next ? next.x : right) - x - 12);
              let label = null;
              if (!hidden && x > labelEnd + 10 && room > 0) {
                const text = fitText(item.name, room);
                if (text) {
                  label = <text x={x + 6} y={yMid + 2.5} fontSize="7.5" fill="#334155" pointerEvents="none"
                    stroke="rgba(248,250,252,0.9)" strokeWidth="2" paintOrder="stroke">{text}</text>;
                  labelEnd = x + 6 + text.length * CHAR_W;
                }
              }
              return (
                <g key={item.id} style={{ cursor: "pointer" }} onClick={pick(item)}>
                  <title>{tooltip(item, `${item.measure.toFixed(3)} km${hidden ? ` · +${hidden} more here, zoom in to separate` : ""}`)}</title>
                  {isAttached && <circle cx={x} cy={yMid} r="6" fill="none" stroke="#be185d" strokeWidth="1.5" />}
                  {active && <circle cx={x} cy={yMid} r="6" fill="none" stroke="#facc15" strokeWidth="2" />}
                  <ChartSymbol shape={item.shape} color={item.color} x={x} y={yMid} size={hidden ? 0.72 : 0.6} />
                  {label}
                </g>
              );
            })}
          </g>
        </g>
      );
    });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [byLayer, projects, from, to, activeEventId, attachedKey, clipId]);

  return (
    <div className="chart-wrap">
      <svg
        ref={svgRef}
        viewBox={`0 0 ${width} ${height}`}
        className={`chart${selectingSegment ? " selecting" : ""}`}
        onMouseDown={(event) => {
          if (!selectingSegment) return;
          const measure = Math.max(from, Math.min(to, measureOf(event.clientX, event.currentTarget)));
          event.preventDefault();
          setDrag({ start: measure, end: measure });
        }}
        onMouseMove={(event) => {
          const measure = measureOf(event.clientX, event.currentTarget);
          if (drag) setDrag({ ...drag, end: Math.max(from, Math.min(to, measure)) });
          if (measure >= from && measure <= to) hoverAt(measure);
        }}
        onMouseUp={() => {
          if (!drag) return;
          if (Math.abs(drag.end - drag.start) > span * 0.005) onSegment?.(drag.start, drag.end);
          setDrag(null);
        }}
        onMouseLeave={() => setDrag(null)}
        onClick={(event) => {
          if (selectingSegment) return;
          const measure = measureOf(event.clientX, event.currentTarget);
          if (measure >= from && measure <= to) onHoverMeasure(measure);
        }}
      >
        <defs>
          <clipPath id={clipId}>
            <rect x={labelW} y="0" width={right - labelW} height={height} />
          </clipPath>
        </defs>
        <rect x="0" y="0" width={width} height={height} fill="#f8fafc" />
        {ticks.map((tick) => (
          <g key={tick}>
            <line x1={xOf(tick)} x2={xOf(tick)} y1={AXIS_H - 4} y2={height - 4} stroke="#e2e8f0" />
            <text x={xOf(tick)} y="16" textAnchor="middle" fontSize="9" fill="#64748b">{step < 1 ? tick.toFixed(1) : tick.toFixed(0)}</text>
          </g>
        ))}
        {rowsSvg}
        {(() => {
          const band = drag ? { from: Math.min(drag.start, drag.end), to: Math.max(drag.start, drag.end) } : segment;
          if (!band || band.to < from || band.from > to) return null;
          const x1 = clampX(xOf(band.from));
          const x2 = clampX(xOf(band.to));
          return (
            <g pointerEvents="none">
              <rect x={x1} y={AXIS_H - 4} width={Math.max(1, x2 - x1)} height={height - AXIS_H} fill="#facc15" opacity="0.14" />
              <line x1={x1} x2={x1} y1={AXIS_H - 4} y2={height - 4} stroke="#ca8a04" strokeWidth="1.2" strokeDasharray="3 2" />
              <line x1={x2} x2={x2} y1={AXIS_H - 4} y2={height - 4} stroke="#ca8a04" strokeWidth="1.2" strokeDasharray="3 2" />
              <text x={(x1 + x2) / 2} y={AXIS_H + 2} textAnchor="middle" fontSize="8" fontWeight="700" fill="#854d0e"
                stroke="rgba(255,255,255,0.9)" strokeWidth="2" paintOrder="stroke">
                {`${band.from.toFixed(2)} – ${band.to.toFixed(2)} km (${(band.to - band.from).toFixed(2)} km)`}
              </text>
            </g>
          );
        })()}
        {cursor && cursor.measure >= from && cursor.measure <= to && (
          <g pointerEvents="none">
            <line x1={xOf(cursor.measure)} x2={xOf(cursor.measure)} y1="20" y2={height - 2} stroke="#ea580c" strokeWidth="2" />
            <rect x={xOf(cursor.measure) - 24} y="2" width="48" height="16" rx="3" fill="#ea580c" />
            <text x={xOf(cursor.measure)} y="14" textAnchor="middle" fontSize="10" fontWeight="700" fill="#fff">{cursor.measure.toFixed(2)}</text>
          </g>
        )}
      </svg>
      {route?.lengthKm > 0 && (
        <RoadSlider lengthKm={route.lengthKm} from={from} to={to} cursor={cursor} events={events} onWindow={onWindow} />
      )}
      <div className="chart-help">Scroll to zoom the station window. Click a symbol to show it on the map. Measures are kilometres from the route origin.</div>
    </div>
  );
}

export default memo(StripChart);
export { rowsFor };
