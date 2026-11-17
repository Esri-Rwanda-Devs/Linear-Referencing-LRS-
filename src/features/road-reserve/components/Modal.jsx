import { useEffect, useState } from "react";

function Modal({ open, name, onName, onCreate, onClose, note = "" }) {
  const [present, setPresent] = useState(open);
  const [visible, setVisible] = useState(false);
  const [zone, setZone] = useState("urban");

  useEffect(() => {
    if (open) {
      setPresent(true);
      const frame = requestAnimationFrame(() => setVisible(true));
      return () => cancelAnimationFrame(frame);
    }
    setVisible(false);
    const timer = window.setTimeout(() => setPresent(false), 220);
    return () => window.clearTimeout(timer);
  }, [open]);
  if (!present) return null;
  const onZone = (value) => setZone(value);
  return (
    <div className={`rr-modal-backdrop${visible ? " in" : ""}`} onMouseDown={onClose}>
      <div
        className="rr-modal"
        role="dialog"
        aria-modal="true"
        aria-labelledby="rr-project-title"
        onMouseDown={(event) => event.stopPropagation()}
      >
        <h2 id="rr-project-title">Create a project</h2>
        <p>Create a new project to store your scenarios.</p>
        {note ? <p>{note}</p> : null}
        <label>
          Project name
          <input
            type="text"
            placeholder="Project name"
            value={name}
            autoFocus
            onChange={(event) => onName(event.target.value)}
            onKeyDown={(event) => {
              if (event.key === "Enter" && name.trim()) onCreate();
              if (event.key === "Escape") onClose();
            }}
          />
        </label>
        <label className="rr-label">
          Project Zone
          <select
            value={zone}
            onChange={(event) => onZone(event.target.value)}
          >
            <option value="urban">Urban</option>
            <option value="rural">Rural</option>
          </select>
        </label>
        <div className="rr-actions">
          <button type="button" onClick={onClose}>Cancel</button>
          <button type="button" className="solid" disabled={!name.trim()} onClick={onCreate}>Create</button>
        </div>
      </div>
    </div>
  );
}

export default Modal;
