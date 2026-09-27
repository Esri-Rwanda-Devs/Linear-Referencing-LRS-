import { useMemo, useState } from "react";
import { TEMPLATES } from "../config";
import { ChartSymbol } from "./StripChart";

const EMPTY = {
  template: TEMPLATES[0],
  requestor: "",
  description: "",
  priority: "Medium",
  bufferM: 80,
};

function attachable(item) {
  return { id: item.id, layerId: item.layerId, title: item.title, name: item.name, measure: item.measure, point: item.point, shape: item.shape, color: item.color };
}

function ProjectEditor({ project, events, onUpdate, onDelete }) {
  const bufferM = Number(project.bufferM) || 80;
  const attachedIds = new Set((project.attached || []).map((item) => item.id));
  const inBuffer = useMemo(() => events
    .filter((item) => item.kind === "point" && item.measure >= project.startKm && item.measure <= project.endKm && (item.distanceM || 0) <= bufferM)
    .sort((a, b) => a.measure - b.measure), [events, project.startKm, project.endKm, bufferM]);

  const update = (patch) => onUpdate({ ...project, ...patch });
  const toggle = (item) => {
    const list = project.attached || [];
    update({ attached: attachedIds.has(item.id) ? list.filter((entry) => entry.id !== item.id) : [...list, attachable(item)] });
  };

  return (
    <div className="project-editor">
      <label>Buffer distance · <b>{bufferM} m</b>
        <input type="range" min="10" max="1000" step="10" value={bufferM} onChange={(event) => update({ bufferM: Number(event.target.value) })} />
      </label>
      <div className="row-2">
        <label>Start km
          <input type="number" step="0.1" value={project.startKm.toFixed(2)} onChange={(event) => update({ startKm: Math.min(Number(event.target.value) || 0, project.endKm) })} />
        </label>
        <label>End km
          <input type="number" step="0.1" value={project.endKm.toFixed(2)} onChange={(event) => update({ endKm: Math.max(Number(event.target.value) || 0, project.startKm) })} />
        </label>
      </div>
      <div className="attach-head">
        <strong>Assets in buffer ({inBuffer.length})</strong>
        <button type="button" disabled={!inBuffer.length} onClick={() => update({ attached: inBuffer.map(attachable) })}>Attach all</button>
        <button type="button" disabled={!attachedIds.size} onClick={() => update({ attached: [] })}>Clear</button>
      </div>
      <ul className="attach-list">
        {inBuffer.length === 0 && <li className="empty">No points inside this buffer. Widen it or tick the point layers.</li>}
        {inBuffer.map((item) => (
          <li key={item.id}>
            <label className="attach-item">
              <input type="checkbox" checked={attachedIds.has(item.id)} onChange={() => toggle(item)} />
              <svg width="14" height="14" viewBox="0 0 14 14"><ChartSymbol shape={item.shape} color={item.color} x={7} y={7} size={0.9} /></svg>
              <span>{item.name}</span>
              <em>{item.measure.toFixed(2)} km</em>
            </label>
          </li>
        ))}
      </ul>
      <p className="attach-count">{attachedIds.size} attached to this project.</p>
      <button type="button" className="danger" onClick={() => onDelete(project)}>Delete project</button>
    </div>
  );
}

export default function Planner({ route, windowKm, projects, events, onCreate, onSelect, onUpdate, onDelete, activeId }) {
  const [form, setForm] = useState(EMPTY);
  const set = (key) => (event) => setForm((prev) => ({ ...prev, [key]: event.target.value }));

  return (
    <aside className="planner">
      <h2>Plan a works package</h2>
      <p className="lede">Station the job on the route, then the map draws the work buffer.</p>
      <label>Template
        <select value={form.template} onChange={set("template")}>
          {TEMPLATES.map((item) => <option key={item}>{item}</option>)}
        </select>
      </label>
      <label>Requestor
        <input value={form.requestor} onChange={set("requestor")} placeholder="Name or unit" />
      </label>
      <label>Description
        <textarea value={form.description} onChange={set("description")} rows={3} placeholder="What needs attention on this station range" />
      </label>
      <label>Priority
        <select value={form.priority} onChange={set("priority")}>
          <option>Low</option>
          <option>Medium</option>
          <option>High</option>
        </select>
      </label>
      <label>Buffer distance · <b>{form.bufferM} m</b>
        <input type="range" min="10" max="1000" step="10" value={form.bufferM} onChange={set("bufferM")} />
      </label>
      <button
        type="button"
        className="primary"
        disabled={!route}
        onClick={() => {
          const [startKm, endKm] = windowKm;
          onCreate({
            ...form,
            bufferM: Number(form.bufferM) || 80,
            startKm: Math.min(startKm, endKm),
            endKm: Math.max(startKm, endKm),
            routeId: route.id,
            name: form.template,
            attached: [],
          });
          setForm(EMPTY);
        }}
      >
        Create project on this window
      </button>
      <h3>Saved on this route</h3>
      <ul className="projects">
        {projects.length === 0 && <li className="empty">No plans yet.</li>}
        {projects.map((project) => (
          <li key={project.id}>
            <button type="button" className={project.id === activeId ? "active" : ""} onClick={() => onSelect(project)}>
              <strong>{project.template}</strong>
              <span>{project.startKm.toFixed(2)} – {project.endKm.toFixed(2)} km · {project.priority} · {Number(project.bufferM) || 80} m · {(project.attached || []).length} assets</span>
            </button>
            {project.id === activeId && <ProjectEditor project={project} events={events} onUpdate={onUpdate} onDelete={onDelete} />}
          </li>
        ))}
      </ul>
    </aside>
  );
}
