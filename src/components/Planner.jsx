import { useState } from "react";
import { TEMPLATES } from "../config";

const EMPTY = {
  template: TEMPLATES[0],
  requestor: "",
  description: "",
  priority: "Medium",
  bufferM: 80,
};

export default function Planner({ route, windowKm, projects, onCreate, onSelect, activeId }) {
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
      <label>Buffer distance (m)
        <input type="number" min="10" max="500" value={form.bufferM} onChange={set("bufferM")} />
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
              <span>{project.startKm.toFixed(2)} – {project.endKm.toFixed(2)} km · {project.priority}</span>
            </button>
          </li>
        ))}
      </ul>
    </aside>
  );
}
