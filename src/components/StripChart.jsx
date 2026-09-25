import { GROUPS } from "../config";

const ROW_H = 22;
const GROUP_H = 18;
const AXIS_H = 28;

function rowsFor(events) {
  const rows = [];
  GROUPS.forEach((group) => {
    const titles = [...new Set(events.filter((event) => event.group === group.id).map((event) => event.title))];
    if (!titles.length && group.id !== "PLN") return;
    rows.push({ type: "group", ...group });
    titles.forEach((title) => rows.push({ type: "layer", group: group.id, title, color: group.color }));
    if (group.id === "PLN") rows.push({ type: "layer", group: "PLN", title: "Projects", color: group.color });
  });
  return rows;
}

function symbol(event, x, y) {
  const c = event.color;
  if (event.shape === "triangle") return <polygon points={`${x},${y - 6} ${x - 5},${y + 4} ${x + 5},${y + 4}`} fill={c} />;
  if (event.shape === "diamond") return <polygon points={`${x},${y - 6} ${x + 5},${y} ${x},${y + 6} ${x - 5},${y}`} fill={c} />;
  if (event.shape === "square") return <rect x={x - 4} y={y - 4} width="8" height="8" fill={c} />;
  if (event.shape === "circle") return <circle cx={x} cy={y} r="3.5" fill={c} />;
  if (event.shape === "plus") {
    return <path d={`M ${x - 4} ${y} H ${x + 4} M ${x} ${y - 4} V ${y + 4}`} stroke={c} strokeWidth="1.6" />;
  }
  if (event.shape === "tick") return <path d={`M ${x} ${y - 6} V ${y + 5}`} stroke={c} strokeWidth="2" />;
  return (
    <g stroke={c} strokeWidth="1.6">
      <path d={`M ${x - 4} ${y - 4} L ${x + 4} ${y + 4}`} />
      <path d={`M ${x + 4} ${y - 4} L ${x - 4} ${y + 4}`} />
    </g>
  );
}

export default function StripChart({ events, projects, route, windowKm, cursor, activeEventId, onWindow, onHoverMeasure, onPickProject, onSelectEvent }) {
  const rows = rowsFor(events);
  const labelW = 148;
  const width = 1100;
  const plotW = width - labelW - 12;
  const height = AXIS_H + rows.length * ROW_H + 8;
  const [from, to] = windowKm;
  const span = Math.max(0.2, to - from);
  const xOf = (measure) => labelW + ((measure - from) / span) * plotW;
  const measureOf = (clientX, svg) => {
    const rect = svg.getBoundingClientRect();
    const local = ((clientX - rect.left) / rect.width) * width;
    return from + ((local - labelW) / plotW) * span;
  };

  const ticks = [];
  const step = span > 40 ? 5 : span > 16 ? 2 : 1;
  for (let m = Math.ceil(from); m <= to; m += step) ticks.push(m);

  return (
    <div className="chart-wrap">
      <svg
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
        onWheel={(event) => {
          event.preventDefault();
          const delta = event.deltaY > 0 ? span * 0.08 : -span * 0.08;
          const mid = (from + to) / 2;
          const next = Math.max(2, span + delta);
          onWindow(mid - next / 2, mid + next / 2);
        }}
      >
        <rect x="0" y="0" width={width} height={height} fill="#f8fafc" />
        {rows.map((row, index) => {
          const y = AXIS_H + index * ROW_H;
          if (row.type === "group") {
            return (
              <g key={`${row.id}-g`}>
                <rect x="0" y={y} width={labelW - 8} height={ROW_H - 2} rx="3" fill={row.color} />
                <text x="8" y={y + 14} fill="#fff" fontSize="11" fontWeight="700">{row.label}</text>
                <text x={labelW + 6} y={y + 14} fill="#64748b" fontSize="10">{row.hint}</text>
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
              shape: "bar",
              name: project.name,
              title: "Projects",
              group: "PLN",
            }))
            : events.filter((item) => item.group === row.group && item.title === row.title);
          return (
            <g key={`${row.group}-${row.title}`}>
              <text x="14" y={y + 15} fill="#334155" fontSize="11">{row.title}</text>
              <line x1={labelW} x2={width - 8} y1={yMid} y2={yMid} stroke="#e2e8f0" />
              {rowEvents.map((item) => {
                if (item.to < from || item.from > to) return null;
                if (item.kind === "span") {
                  const x1 = Math.max(labelW, xOf(item.from));
                  const x2 = Math.min(width - 8, xOf(item.to));
                  return (
                    <g key={item.id} style={{ cursor: "pointer" }} onClick={(event) => { event.stopPropagation(); if (item.group === "PLN") onPickProject(item); else onSelectEvent?.(item); }}>
                      <rect x={x1} y={yMid - 5} width={Math.max(3, x2 - x1)} height="10" rx="2" fill={item.color} opacity="0.9" />
                      {x2 - x1 > 46 && <text x={x1 + 4} y={yMid + 3} fontSize="9" fill="#1e293b">{item.name}</text>}
                    </g>
                  );
                }
                const active = item.id === activeEventId;
                return (
                  <g key={item.id} style={{ cursor: "pointer" }} onClick={(event) => { event.stopPropagation(); onSelectEvent?.(item); }}>
                    {active && <circle cx={xOf(item.measure)} cy={yMid} r="8" fill="none" stroke="#facc15" strokeWidth="2" />}
                    {symbol(item, xOf(item.measure), yMid)}
                  </g>
                );
              })}
            </g>
          );
        })}
        {ticks.map((tick) => (
          <g key={tick}>
            <line x1={xOf(tick)} x2={xOf(tick)} y1={AXIS_H - 4} y2={height - 4} stroke="#e2e8f0" />
            <text x={xOf(tick)} y="16" textAnchor="middle" fontSize="10" fill="#475569">{tick.toFixed(0)}</text>
          </g>
        ))}
        {cursor && cursor.measure >= from && cursor.measure <= to && (
          <line x1={xOf(cursor.measure)} x2={xOf(cursor.measure)} y1="18" y2={height - 2} stroke="#ea580c" strokeWidth="2" />
        )}
      </svg>
      <div className="chart-help">Scroll to zoom the station window. Drag is on the station controls. Measures are kilometres from the route origin.</div>
    </div>
  );
}

export { rowsFor };
