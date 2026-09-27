import { useEffect, useRef } from "react";
import { GROUPS, LRS_LAYER_DEFS } from "../config";

const ROW_H = 24;
const AXIS_H = 28;
const CHAR_W = 5.4;

function rowsFor() {
  const rows = [];
  GROUPS.forEach((group) => {
    const layers = LRS_LAYER_DEFS.filter((layer) => layer.group === group.id);
    if (!layers.length && group.id !== "PLN") return;
    rows.push({ type: "group", ...group });
    layers.forEach((layer) => rows.push({ type: "layer", group: group.id, title: layer.title, color: layer.swatch, shape: layer.kind === "point" ? layer.shape : "bar", layerId: layer.id }));
    if (group.id === "PLN") rows.push({ type: "layer", group: "PLN", title: "Projects", color: group.color, shape: "bar" });
  });
  return rows;
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

function fitText(text, maxPx) {
  const max = Math.floor(maxPx / CHAR_W);
  if (max < 3) return "";
  return text.length <= max ? text : `${text.slice(0, max - 1)}…`;
}

/** Joins touching spans that carry the same label so one name is drawn per run. */
function mergeRuns(items) {
  const sorted = [...items].sort((a, b) => a.from - b.from);
  const runs = [];
  sorted.forEach((item) => {
    const last = runs[runs.length - 1];
    if (last && last.name === item.name && item.from <= last.to + 0.01) {
      last.to = Math.max(last.to, item.to);
      last.items.push(item);
    } else {
      runs.push({ name: item.name, from: item.from, to: item.to, color: item.color, items: [item] });
    }
  });
  return runs;
}

export default function StripChart({ events, projects, windowKm, cursor, activeEventId, attachedIds, onWindow, onHoverMeasure, onPickProject, onSelectEvent }) {
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
  const attached = new Set(attachedIds || []);
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

  const pick = (item) => (event) => {
    event.stopPropagation();
    if (item.group === "PLN") onPickProject(item);
    else onSelectEvent?.(item);
  };

  return (
    <div className="chart-wrap">
      <svg
        ref={svgRef}
        viewBox={`0 0 ${width} ${height}`}
        className="chart"
        onMouseMove={(event) => {
          const measure = measureOf(event.clientX, event.currentTarget);
          if (measure >= from && measure <= to) onHoverMeasure(measure);
        }}
        onClick={(event) => {
          const measure = measureOf(event.clientX, event.currentTarget);
          if (measure >= from && measure <= to) onHoverMeasure(measure);
        }}
      >
        <defs>
          <clipPath id="plot-clip">
            <rect x={labelW} y="0" width={right - labelW} height={height} />
          </clipPath>
        </defs>
        <rect x="0" y="0" width={width} height={height} fill="#f8fafc" />
        {ticks.map((tick) => (
          <g key={tick}>
            <line x1={xOf(tick)} x2={xOf(tick)} y1={AXIS_H - 4} y2={height - 4} stroke="#e2e8f0" />
            <text x={xOf(tick)} y="16" textAnchor="middle" fontSize="10" fill="#475569">{step < 1 ? tick.toFixed(1) : tick.toFixed(0)}</text>
          </g>
        ))}
        {rows.map((row, index) => {
          const y = AXIS_H + index * ROW_H;
          if (row.type === "group") {
            return (
              <g key={`${row.id}-g`}>
                <rect x="0" y={y + 2} width={labelW - 8} height={ROW_H - 4} rx="3" fill={row.color} />
                <text x="8" y={y + 16} fill="#fff" fontSize="11" fontWeight="700">{row.label}</text>
                <text x={labelW + 6} y={y + 16} fill="#64748b" fontSize="10">{row.hint}</text>
              </g>
            );
          }
          const yMid = y + ROW_H / 2;
          const rowEvents = row.group === "PLN"
            ? projects.map((project) => ({
              ...project,
              kind: "span",
              from: project.startKm,
              to: project.endKm,
              color: project.priority === "High" ? "#be123c" : "#fb7185",
              name: project.name,
              group: "PLN",
            }))
            : events.filter((item) => item.layerId === row.layerId && item.to >= from && item.from <= to);
          const spans = rowEvents.filter((item) => item.kind === "span");
          const points = rowEvents.filter((item) => item.kind !== "span").sort((a, b) => a.measure - b.measure);
          const runs = mergeRuns(spans);
          let labelEnd = -Infinity;
          return (
            <g key={`${row.group}-${row.title}`}>
              <ChartSymbol shape={row.shape} color={row.color} x={14} y={yMid} />
              <text x="26" y={yMid + 4} fill="#334155" fontSize="11">{row.title}</text>
              <line x1={labelW} x2={right} y1={yMid} y2={yMid} stroke="#e2e8f0" />
              <g clipPath="url(#plot-clip)">
                {spans.map((item) => {
                  const x1 = clampX(xOf(item.from));
                  const x2 = clampX(xOf(item.to));
                  return (
                    <rect key={item.id} x={x1} y={yMid - 5} width={Math.max(3, x2 - x1)} height="10" rx="2" fill={item.color} opacity="0.85"
                      stroke="#fff" strokeWidth="0.6" style={{ cursor: "pointer" }} onClick={pick(item)}>
                      <title>{`${item.name} · ${item.from.toFixed(2)}–${item.to.toFixed(2)} km`}</title>
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
                  return (
                    <text key={`run-${runIndex}`} x={start} y={yMid + 3} fontSize="9" fontWeight="600" fill="#0f172a" pointerEvents="none"
                      stroke="rgba(255,255,255,0.85)" strokeWidth="2.5" paintOrder="stroke">{text}</text>
                  );
                })}
                {points.map((item) => {
                  const x = xOf(item.measure);
                  const active = item.id === activeEventId;
                  const isAttached = attached.has(item.id);
                  let label = null;
                  if (x > labelEnd + 4) {
                    const text = fitText(item.name, 110);
                    if (text) {
                      label = <text x={x + 8} y={yMid + 3} fontSize="9" fill="#1e293b" pointerEvents="none"
                        stroke="rgba(248,250,252,0.9)" strokeWidth="2.5" paintOrder="stroke">{text}</text>;
                      labelEnd = x + 8 + text.length * CHAR_W;
                    }
                  }
                  return (
                    <g key={item.id} style={{ cursor: "pointer" }} onClick={pick(item)}>
                      <title>{`${item.title}: ${item.name} · ${item.measure.toFixed(2)} km`}</title>
                      {isAttached && <circle cx={x} cy={yMid} r="9" fill="none" stroke="#be185d" strokeWidth="2" />}
                      {active && <circle cx={x} cy={yMid} r="8" fill="none" stroke="#facc15" strokeWidth="2.5" />}
                      <ChartSymbol shape={item.shape} color={item.color} x={x} y={yMid} />
                      {label}
                    </g>
                  );
                })}
              </g>
            </g>
          );
        })}
        {cursor && cursor.measure >= from && cursor.measure <= to && (
          <g pointerEvents="none">
            <line x1={xOf(cursor.measure)} x2={xOf(cursor.measure)} y1="20" y2={height - 2} stroke="#ea580c" strokeWidth="2" />
            <rect x={xOf(cursor.measure) - 24} y="2" width="48" height="16" rx="3" fill="#ea580c" />
            <text x={xOf(cursor.measure)} y="14" textAnchor="middle" fontSize="10" fontWeight="700" fill="#fff">{cursor.measure.toFixed(2)}</text>
          </g>
        )}
      </svg>
      <div className="chart-help">Scroll to zoom the station window. Click a symbol to show it on the map. Measures are kilometres from the route origin.</div>
    </div>
  );
}

export { rowsFor };
