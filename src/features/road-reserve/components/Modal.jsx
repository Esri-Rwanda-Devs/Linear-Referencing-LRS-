import { useEffect, useState } from "react";

function Modal({ open, name, onName, onCreate, onClose }) {
  const [present, setPresent] = useState(open);
  const [visible, setVisible] = useState(false);
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
        <p>A project holds up to 3 scenarios. Comparison uses only the scenarios in the project you select.</p>
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
        <div className="rr-actions">
          <button type="button" onClick={onClose}>Cancel</button>
          <button type="button" className="solid" disabled={!name.trim()} onClick={onCreate}>Create</button>
        </div>
      </div>
    </div>
  );
}

export default Modal;
