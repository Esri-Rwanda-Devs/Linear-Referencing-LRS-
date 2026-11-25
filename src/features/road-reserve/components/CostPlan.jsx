import { useEffect, useMemo, useRef, useState } from "react";
import RoutePicker from "../../analysis/components/RoutePicker";
import { exportBudgetReport } from "../../../utils/excel";
import {
  corridorRing,
  formatMetre,
  formatNumber,
  formatRwf,
  formatSqm,
  lineLengthM,
  pointInRing,
} from "../../cost/utils/corridor";
import Modal from "./Modal";
import "./RoadReserve.css";
import { assetIcons } from "../../../assets";
const SECTIONS = [
  ["budget", "Project planning"],
  ["register", "Property register"],
  // ["proclamation", "Proclamation tracking"],
  ["monitoring", "Monitoring and reports"],
  ["compare", "Compare alignments"],
  ["rates", "Rates and rules"],
];
const WIDTHS = [20, 30, 40, 60];
const PAGE_SIZE = 7;
const PIPELINE = [
  "Identified",
  "Valued",
  "Owner notified",
  "Paid, not moved",
  "Moved out",
  "Demolished",
];
const FILTERS = [
  "All",
  "Not paid",
  "Paid, not moved",
  "Moved, standing",
  "Demolished",
];
const PROOF_STATUSES = new Set([
  "Valued",
  "Owner notified",
  "Paid, not moved",
  "Moved out",
  "Demolished",
]);
const PROOF_MAX_BYTES = 1.5 * 1024 * 1024;
const PROOF_TYPES = [
  "application/pdf",
  "image/jpeg",
  "image/png",
  "image/webp",
  "image/gif",
];

const millions = (value) =>
  ((Number(value) || 0) / 1e6).toLocaleString("en-RW", {
    minimumFractionDigits: 1,
    maximumFractionDigits: 1,
  });
const rwfM = (value) => `RWF ${millions(value)} M`;
const parcelCode = (parcel) =>
  parcel.upi || parcel.parcelNumber || parcel.key || "Parcel";
const sameLabel = (left, right) =>
  String(left || "")
    .trim()
    .toLowerCase() ===
  String(right || "")
    .trim()
    .toLowerCase();
const readProofFile = (file) =>
  new Promise((resolve, reject) => {
    if (!file) {
      reject(new Error("No file selected."));
      return;
    }
    if (file.size > PROOF_MAX_BYTES) {
      reject(new Error("Each proof file must be 1.5 MB or smaller."));
      return;
    }
    if (PROOF_TYPES.length && file.type && !PROOF_TYPES.includes(file.type)) {
      reject(new Error("Use a PDF or image file (JPG, PNG, WebP, GIF)."));
      return;
    }
    const reader = new FileReader();
    reader.onload = () =>
      resolve({
        id: `proof-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
        name: file.name,
        mime: file.type || "application/octet-stream",
        size: file.size,
        dataUrl: String(reader.result || ""),
        at: new Date().toISOString(),
      });
    reader.onerror = () => reject(new Error("Could not read that file."));
    reader.readAsDataURL(file);
  });
function StatusProofModal({
  open,
  parcelLabel,
  status,
  files,
  error,
  onFiles,
  onConfirm,
  onClose,
}) {
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
  const needsProof = PROOF_STATUSES.has(status);
  return (
    <div
      className={`rr-modal-backdrop${visible ? " in" : ""}`}
      onMouseDown={onClose}
    >
      <div
        className="rr-modal"
        role="dialog"
        aria-modal="true"
        aria-labelledby="rr-status-proof-title"
        onMouseDown={(event) => event.stopPropagation()}
      >
        <h2 id="rr-status-proof-title">Attach proof of documents</h2>
        <p>
          Change <b>{parcelLabel}</b> to <b>{status}</b>
          {needsProof
            ? ". Attach at least one proof document."
            : ". Proof is optional."}
        </p>
        <label>
          Proof documents
          <input
            type="file"
            accept=".pdf,image/*,.jpg,.jpeg,.png,.webp,.gif"
            multiple
            onChange={(event) => onFiles(event.target.files)}
          />
        </label>
        {files.length > 0 && (
          <ul className="rr-proof-list">
            {files.map((file) => (
              <li key={file.id}>
                <span>{file.name}</span>
                <em>{Math.max(1, Math.round(file.size / 1024))} KB</em>
              </li>
            ))}
          </ul>
        )}
        {error ? <p className="rr-proof-error">{error}</p> : null}
        <div className="rr-actions">
          <button type="button" onClick={onClose}>
            Cancel
          </button>
          <button
            type="button"
            className="solid"
            disabled={needsProof && files.length === 0}
            onClick={onConfirm}
          >
            Save status
          </button>
        </div>
      </div>
    </div>
  );
}
function matchesFilter(status, filter) {
  const current = status || "Identified";
  if (filter === "All") return true;
  if (filter === "Not paid")
    return (
      current === "Identified" ||
      current === "Valued" ||
      current === "Owner notified" ||
      current === "Not started"
    );
  if (filter === "Moved, standing") return current === "Moved out";
  return current === filter;
}
const overlapOf = (parcel) => {
  const recorded = Number(String(parcel.recordedSize ?? "").replace(/,/g, ""));
  if (!(recorded > 1)) return "—";
  return `${Math.min(999, Math.round((parcel.sqm / recorded) * 100))}%`;
};
/** Higher overlap first, then larger affected area — most affected parcels at the top. */
const affectRank = (parcel) => {
  const taken = Number(parcel?.sqm) || 0;
  const recorded = Number(String(parcel?.recordedSize ?? "").replace(/,/g, ""));
  const overlap = recorded > 1 ? taken / recorded : 0;
  return { overlap, taken };
};
const byMostAffected = (left, right) => {
  const a = affectRank(left);
  const b = affectRank(right);
  return b.overlap - a.overlap || b.taken - a.taken;
};
/** Affected % = affected m² / SHAPE__Area (full building). */
const buildingAffectedPct = (building) => {
  const stored = Number(building?.affectedPct);
  if (Number.isFinite(stored) && stored >= 0) {
    const rounded =
      stored < 10 ? Math.round(stored * 10) / 10 : Math.round(stored);
    return `${rounded}%`;
  }
  const footprint = Number(
    building?.shapeArea || building?.footprint || 0,
  );
  const affected = Number(building?.sqm);
  if (!(footprint > 0) || !Number.isFinite(affected) || affected < 0)
    return "—";
  const pct = Math.min(100, (affected / footprint) * 100);
  const rounded = pct < 10 ? Math.round(pct * 10) / 10 : Math.round(pct);
  return `${rounded}%`;
};
const letterOf = (index) => String.fromCharCode(65 + (index % 26));
const projectLabel = (project) =>
  project?.id
    ? `${project.name} (${project.scenarios?.length || 0}/3)`
    : "Select a project";

function ProjectSearch({ projects, projectId, onSelect }) {
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState("");
  const [active, setActive] = useState(0);
  const boxRef = useRef(null);
  const listRef = useRef(null);
  const selected = (projects || []).find((project) => project.id === projectId);
  const matches = useMemo(() => {
    const wanted = query.trim().toLowerCase();
    const all = projects || [];
    return wanted
      ? all.filter((project) => project.name.toLowerCase().includes(wanted))
      : all;
  }, [projects, query]);
  const choices = query.trim()
    ? matches
    : [{ id: "", name: "Select a project", scenarios: [] }, ...matches];

  useEffect(() => {
    if (!open) return undefined;
    const close = (event) => {
      if (!boxRef.current?.contains(event.target)) setOpen(false);
    };
    document.addEventListener("pointerdown", close);
    return () => document.removeEventListener("pointerdown", close);
  }, [open]);
  useEffect(() => {
    setActive(0);
  }, [query, open]);
  useEffect(() => {
    if (!open) return;
    listRef.current
      ?.querySelector(`[data-index="${active}"]`)
      ?.scrollIntoView({ block: "nearest" });
  }, [active, open]);

  const choose = (id) => {
    onSelect(id);
    setOpen(false);
    setQuery("");
  };
  const onKeyDown = (event) => {
    if (event.key === "ArrowDown") {
      event.preventDefault();
      setOpen(true);
      setActive((index) =>
        Math.min(Math.max(choices.length - 1, 0), index + 1),
      );
    } else if (event.key === "ArrowUp") {
      event.preventDefault();
      setActive((index) => Math.max(0, index - 1));
    } else if (event.key === "Enter" && open && choices[active]) {
      event.preventDefault();
      choose(choices[active].id);
    } else if (event.key === "Escape") {
      setOpen(false);
      setQuery("");
    }
  };

  return (
    <div className={`rr-project-search${open ? " open" : ""}`} ref={boxRef}>
      <input
        value={open ? query : selected ? projectLabel(selected) : ""}
        placeholder={selected ? projectLabel(selected) : "Search projects"}
        aria-label="Project"
        role="combobox"
        aria-expanded={open}
        aria-autocomplete="list"
        onFocus={() => {
          setOpen(true);
          setQuery("");
        }}
        onChange={(event) => {
          setQuery(event.target.value);
          setOpen(true);
        }}
        onKeyDown={onKeyDown}
      />
      <i className="caret" aria-hidden="true">
        ▾
      </i>
      {open && (
        <ul ref={listRef} role="listbox">
          {choices.map((project, index) => (
            <li
              key={project.id || "none"}
              data-index={index}
              role="option"
              aria-selected={project.id === projectId}
              className={`${index === active ? "active" : ""} ${project.id && project.id === projectId ? "selected" : ""}`}
              onPointerDown={(event) => {
                event.preventDefault();
                choose(project.id);
              }}
              onPointerEnter={() => setActive(index)}
            >
              {projectLabel(project)}
            </li>
          ))}
          {!matches.length && (
            <li className="none">No project matches “{query}”</li>
          )}
        </ul>
      )}
    </div>
  );
}
const hasBuilding = (parcel, buildings) =>
  (buildings || []).some((building) => buildingOnParcel(parcel, building));
const buildingGap = (item) => {
  if (item?.footprintCount === null)
    return "Building footprints could not be loaded, so buildings were not analysed.";
  if (item?.footprintCount === 0)
    return "No footprints in this area, so buildings were not analysed.";
  return "No building footprint intersects this reserve.";
};

function metric(option, key) {
  const report = option.report || {};
  if (key === "length") return Number(report.lengthM) || 0;
  if (key === "area") return Number(report.corridorSqm) || 0;
  if (key === "parcels") return report.parcels?.length || 0;
  if (key === "buildings") return report.buildings?.length || 0;
  if (key === "rivers") return report.rivers ? report.rivers.length : null;
  if (key === "land") return Number(report.landCost) || 0;
  if (key === "buildingCost") return Number(report.buildingCost) || 0;
  return Number(report.totalCost) || 0;
}

const COMPARE_ROWS = [
  ["length", "Alignment length (m)", 1],
  ["area", "Reserve area (m²)", 0],
  ["parcels", "Parcels affected", 0],
  ["buildings", "Buildings affected", 0],
  ["rivers", "River crossings (bridges)", 0],
  ["land", "Land cost (RWF M)", 1],
  ["buildingCost", "Building cost (RWF M)", 1],
  ["total", "Total estimate (RWF M)", 1],
];

function metricText(value, key, digits) {
  if (value == null) return "—";
  if (key === "land" || key === "buildingCost" || key === "total")
    return millions(value);
  return value.toLocaleString(undefined, {
    minimumFractionDigits: digits,
    maximumFractionDigits: digits,
  });
}

function ScenarioMenu({
  projectId,
  options,
  activeId,
  onShow,
  onShowAll,
  onRemove,
}) {
  const [open, setOpen] = useState(false);
  const [all, setAll] = useState(false);
  const boxRef = useRef(null);
  const enabled = Boolean(projectId);
  const current = (options || []).find((option) => option.id === activeId);
  const currentIndex = (options || []).findIndex(
    (option) => option.id === activeId,
  );
  useEffect(() => {
    setAll(false);
    setOpen(false);
  }, [projectId]);
  useEffect(() => {
    if (!open) return undefined;
    const close = (event) => {
      if (!boxRef.current?.contains(event.target)) setOpen(false);
    };
    document.addEventListener("pointerdown", close);
    return () => document.removeEventListener("pointerdown", close);
  }, [open]);
  const label = !enabled
    ? "Scenarios"
    : all
      ? "All on map"
      : current
        ? `${letterOf(currentIndex)} · ${current.label}`
        : "View scenarios";
  const chooseOne = (id) => {
    setAll(false);
    setOpen(false);
    onShow(id);
  };
  const chooseAll = () => {
    setAll(true);
    setOpen(false);
    onShowAll();
  };
  return (
    <div className={`rr-scenario-menu${open ? " open" : ""}`} ref={boxRef}>
      <button
        type="button"
        className="face"
        disabled={!enabled}
        aria-expanded={open}
        aria-label="Scenarios"
        onClick={() => enabled && setOpen((value) => !value)}
      >
        {label}
      </button>
      <i className="caret" aria-hidden="true">
        ▾
      </i>
      {open && enabled && (
        <ul role="listbox">
          <li
            role="option"
            className={all ? "selected" : ""}
            onPointerDown={(event) => {
              event.preventDefault();
              chooseAll();
            }}
          >
            All on map
          </li>
          {(options || []).map((option, index) => (
            <li
              key={option.id}
              role="option"
              className={!all && option.id === activeId ? "selected" : ""}
              onPointerDown={(event) => {
                event.preventDefault();
                chooseOne(option.id);
              }}
            >
              <span>
                {letterOf(index)} · {option.label} (
                {formatMetre(option.report?.lengthM)})
              </span>
              <button
                type="button"
                className="drop"
                aria-label={`Delete ${option.label}`}
                onPointerDown={(event) => {
                  event.preventDefault();
                  event.stopPropagation();
                  onRemove?.(option.id);
                }}
              >
                Delete
              </button>
            </li>
          ))}
          {!options?.length && <li className="none">No scenarios saved yet</li>}
        </ul>
      )}
    </div>
  );
}

function Pager({ page, pages, total, onPage }) {
  if (total <= PAGE_SIZE) return null;
  return (
    <div className="rr-pager">
      <button
        type="button"
        disabled={page <= 0}
        onClick={() => onPage(page - 1)}
      >
        Previous
      </button>
      <span>
        {page + 1} of {pages}
      </span>
      <button
        type="button"
        disabled={page >= pages - 1}
        onClick={() => onPage(page + 1)}
      >
        Next
      </button>
    </div>
  );
}

function Switch({ on, disabled, label, onClick }) {
  return (
    <button
      type="button"
      className={`rr-switch${on ? " on" : ""}`}
      aria-pressed={on}
      aria-label={label}
      disabled={disabled}
      onClick={onClick}
    >
      <i />
    </button>
  );
}

function buildingOnParcel(parcel, building) {
  if (!parcel || !building) return false;
  if (parcel.upi && building.upi && parcel.upi === building.upi) return true;
  if (building.parcelKey && parcel.key === building.parcelKey) return true;
  return Boolean(building.center && pointInRing(building.center, parcel.ring));
}

function parcelForBuilding(building, parcels) {
  if (!building || !parcels?.length) return null;
  if (building.parcelKey) {
    const byKey = parcels.find((parcel) => parcel.key === building.parcelKey);
    if (byKey) return byKey;
  }
  if (building.upi) {
    const byUpi = parcels.find((parcel) => parcel.upi === building.upi);
    if (byUpi) return byUpi;
  }
  return parcels.find((parcel) => buildingOnParcel(parcel, building)) || null;
}

function pointToSegmentM(point, start, end) {
  const dx = end[0] - start[0];
  const dy = end[1] - start[1];
  const length2 = dx * dx + dy * dy || 1e-12;
  const t = Math.max(
    0,
    Math.min(
      1,
      ((point[0] - start[0]) * dx + (point[1] - start[1]) * dy) / length2,
    ),
  );
  return lineLengthM(point, [start[0] + dx * t, start[1] + dy * t]);
}

function limitPoints(path, max = 48) {
  if (!path || path.length <= max) return path || [];
  const step = (path.length - 1) / (max - 1);
  const out = [];
  for (let index = 0; index < max; index += 1) {
    out.push(path[Math.round(index * step)]);
  }
  return out;
}

/** Light densify, then evenly thinned to `max` so the whole path is kept (never cut short). */
function densifyPath(path, stepM = 14, max = 56) {
  if (!path || path.length < 2) return [];
  const out = [[path[0][0], path[0][1]]];
  for (let index = 1; index < path.length; index += 1) {
    const start = path[index - 1];
    const end = path[index];
    const length = lineLengthM(start, end);
    const steps = Math.max(1, Math.min(8, Math.ceil(length / stepM)));
    for (let step = 1; step <= steps; step += 1) {
      const t = step / steps;
      out.push([
        start[0] + (end[0] - start[0]) * t,
        start[1] + (end[1] - start[1]) * t,
      ]);
    }
  }
  return limitPoints(out, max);
}

function chaikinSmooth(path, iterations = 2) {
  let points = path;
  for (let pass = 0; pass < iterations; pass += 1) {
    if (points.length < 3) break;
    const next = [points[0]];
    for (let index = 0; index < points.length - 1; index += 1) {
      const a = points[index];
      const b = points[index + 1];
      next.push([a[0] * 0.75 + b[0] * 0.25, a[1] * 0.75 + b[1] * 0.25]);
      next.push([a[0] * 0.25 + b[0] * 0.75, a[1] * 0.25 + b[1] * 0.75]);
    }
    next.push(points[points.length - 1]);
    points = next;
  }
  return points;
}

/**
 * Contiguous stretch of the alignment near the parcel (same order as the map).
 * Keeps point count low; SVG Beziers handle visual smoothness.
 */
function extractCorridorNear(path, center, reachM) {
  if (!path || path.length < 2 || !center) return [];
  let best = 0;
  let bestD = Infinity;
  path.forEach((point, index) => {
    const distance = lineLengthM(point, center);
    if (distance < bestD) {
      bestD = distance;
      best = index;
    }
  });
  const reach = Math.max(reachM, 40);
  let lo = best;
  let hi = best;
  while (lo > 0 && lineLengthM(path[lo - 1], center) <= reach) lo -= 1;
  while (hi < path.length - 1 && lineLengthM(path[hi + 1], center) <= reach)
    hi += 1;
  lo = Math.max(0, lo - 2);
  hi = Math.min(path.length - 1, hi + 2);
  const slice = path.slice(lo, hi + 1);
  if (slice.length < 2) return densifyPath(path.slice(0, Math.min(path.length, 24)), 18, 32);
  return limitPoints(chaikinSmooth(densifyPath(slice, 16, 60), 2), 60);
}

function nearestGuideM(point, guides) {
  let best = Infinity;
  for (let index = 0; index < guides.length; index += 1) {
    const distance = lineLengthM(point, guides[index]);
    if (distance < best) best = distance;
  }
  return best;
}

/** Contiguous river stretch near the parcel / local road. */
function riverThrough(path, guides, reach) {
  if (!path || path.length < 2 || !guides?.length) return [];
  const source = limitPoints(path, 80);
  let best = 0;
  let bestD = Infinity;
  source.forEach((point, index) => {
    const distance = nearestGuideM(point, guides);
    if (distance < bestD) {
      bestD = distance;
      best = index;
    }
  });
  if (bestD > reach * 1.8) return [];
  let lo = best;
  let hi = best;
  while (lo > 0 && nearestGuideM(source[lo - 1], guides) <= reach) lo -= 1;
  while (hi < source.length - 1 && nearestGuideM(source[hi + 1], guides) <= reach)
    hi += 1;
  lo = Math.max(0, lo - 1);
  hi = Math.min(source.length - 1, hi + 1);
  return limitPoints(chaikinSmooth(source.slice(lo, hi + 1), 2), 36);
}

/** Catmull-Rom → cubic Bezier for a smooth SVG stroke. */
function smoothPathD(screenPts) {
  if (!screenPts || screenPts.length < 2) return "";
  const fmt = (value) => value.toFixed(1);
  if (screenPts.length === 2) {
    return `M ${fmt(screenPts[0][0])} ${fmt(screenPts[0][1])} L ${fmt(screenPts[1][0])} ${fmt(screenPts[1][1])}`;
  }
  let d = `M ${fmt(screenPts[0][0])} ${fmt(screenPts[0][1])}`;
  for (let index = 0; index < screenPts.length - 1; index += 1) {
    const p0 = screenPts[Math.max(0, index - 1)];
    const p1 = screenPts[index];
    const p2 = screenPts[index + 1];
    const p3 = screenPts[Math.min(screenPts.length - 1, index + 2)];
    const c1x = p1[0] + (p2[0] - p0[0]) / 6;
    const c1y = p1[1] + (p2[1] - p0[1]) / 6;
    const c2x = p2[0] - (p3[0] - p1[0]) / 6;
    const c2y = p2[1] - (p3[1] - p1[1]) / 6;
    d += ` C ${fmt(c1x)} ${fmt(c1y)}, ${fmt(c2x)} ${fmt(c2y)}, ${fmt(p2[0])} ${fmt(p2[1])}`;
  }
  return d;
}

function ParcelScene({ parcel, alignment, buildings, rivers, width }) {
  const ring = parcel?.ring || [];
  if (ring.length < 3)
    return (
      <p className="rr-hint">
        Finish the line again to see this parcel, the road, and its buildings.
      </p>
    );
  const mine = (buildings || []).filter((building) =>
    buildingOnParcel(parcel, building),
  );
  const mid = [
    ring.reduce((sum, point) => sum + point[0], 0) / ring.length,
    ring.reduce((sum, point) => sum + point[1], 0) / ring.length,
  ];
  const parcelXs = ring.map((point) => point[0]);
  const parcelYs = ring.map((point) => point[1]);
  const parcelSpan = Math.max(
    lineLengthM(
      [Math.min(...parcelXs), mid[1]],
      [Math.max(...parcelXs), mid[1]],
    ),
    lineLengthM(
      [mid[0], Math.min(...parcelYs)],
      [mid[0], Math.max(...parcelYs)],
    ),
    40,
  );
  const widthM = Number(width) || 20;
  // Continuous local stretch — one band, not per-segment boxes.
  const focusReach = Math.max(parcelSpan * 1.2, 90) + widthM;
  const localRoad = extractCorridorNear(alignment, mid, focusReach);
  const fullRoad = limitPoints(
    chaikinSmooth(densifyPath(alignment || [], 16, 72), 2),
    56,
  );
  const roadForBand =
    localRoad.length >= 2
      ? localRoad
      : fullRoad.length >= 2
        ? fullRoad
        : limitPoints(alignment || [], 56);
  // Band follows the same centreline as the dashed road, at the true reserve width.
  const reservePoly = corridorRing(roadForBand, widthM);
  const guides = ring.slice();
  roadForBand.forEach((point) => guides.push(point));
  for (let index = 1; index < ring.length; index += 1) {
    const start = ring[index - 1];
    const end = ring[index];
    for (let step = 1; step < 4; step += 1) {
      const t = step / 4;
      guides.push([
        start[0] + (end[0] - start[0]) * t,
        start[1] + (end[1] - start[1]) * t,
      ]);
    }
  }
  const riverReach = Math.max(focusReach, widthM + 55, 70);
  const localRivers = (rivers || [])
    .map((river) => ({
      ...river,
      path: riverThrough(river.path, guides, riverReach),
    }))
    .filter((river) => river.path.length >= 2);
  // Zoom on the parcel/buildings (as before); reserve still draws true width.
  const minX = Math.min(...parcelXs);
  const maxX = Math.max(...parcelXs);
  const minY = Math.min(...parcelYs);
  const maxY = Math.max(...parcelYs);
  const halfDeg = widthM / 2 / 111320;
  const padX = Math.max((maxX - minX || 0.0002) * 0.1, halfDeg * 0.9, 0.00005);
  const padY = Math.max((maxY - minY || 0.0002) * 0.1, halfDeg * 0.9, 0.00005);
  const sx = (value) =>
    10 + ((value - (minX - padX)) / (maxX - minX + padX * 2 || 1)) * 260;
  const sy = (value) =>
    210 - ((value - (minY - padY)) / (maxY - minY + padY * 2 || 1)) * 198;
  const chain = (path) =>
    path
      .map((point) => `${sx(point[0]).toFixed(1)},${sy(point[1]).toFixed(1)}`)
      .join(" ");
  const close = (path) =>
    `${chain(path)} ${sx(path[0][0]).toFixed(1)},${sy(path[0][1]).toFixed(1)}`;
  const toScreen = (path) =>
    path.map((point) => [sx(point[0]), sy(point[1])]);
  const roadD =
    roadForBand.length > 1 ? smoothPathD(toScreen(roadForBand)) : "";
  const recorded = Number(String(parcel.recordedSize ?? "").replace(/,/g, ""));
  const overlap =
    recorded > 1 && Number(parcel.sqm) > 0
      ? Math.min(100, Math.round((parcel.sqm / recorded) * 100))
      : Number(parcel.sqm) > 0
        ? null
        : 0;
  const inReserve =
    parcel.distanceM != null && parcel.distanceM <= widthM / 2 + 0.5;
  const touches = inReserve || (overlap != null && overlap > 0);
  const riverName =
    (parcel.rivers && parcel.rivers[0]) || localRivers[0]?.name || "";
  const caption = [
    overlap != null && overlap > 0 ? `Reserve overlap ${overlap}%` : "",
    riverName
      ? `The reserve crosses ${riverName}`
      : touches
        ? "The road reserve overlaps this parcel"
        : "The new road passes beside this parcel",
  ]
    .filter(Boolean)
    .join(". ");
  const clipId = `rr-parcel-clip-${String(parcel.key || "p")
    .replace(/[^a-zA-Z0-9_-]/g, "")
    .slice(0, 40)}`;
  return (
    <figure className="rr-pass">
      <svg
        className="rr-scene"
        viewBox="0 0 280 220"
        role="img"
        aria-label="Parcel, reserve, river, and buildings"
      >
        <defs>
          <clipPath id={clipId}>
            <polygon points={close(ring)} />
          </clipPath>
          <pattern
            id="rr-overlap-hatch"
            width="6"
            height="6"
            patternUnits="userSpaceOnUse"
            patternTransform="rotate(35)"
          >
            <line
              x1="0"
              y1="0"
              x2="0"
              y2="6"
              stroke="#9f1239"
              strokeWidth="2"
              strokeOpacity="0.9"
            />
          </pattern>
        </defs>
        <polygon className="parcel focus" points={close(ring)} />
        {reservePoly.length >= 4 ? (
          <polygon className="reserve-fill" points={close(reservePoly)} />
        ) : null}
        {reservePoly.length >= 4 ? (
          <polygon
            className="overlap-mark"
            points={close(reservePoly)}
            clipPath={`url(#${clipId})`}
            style={{ fill: "url(#rr-overlap-hatch)" }}
          />
        ) : null}
        {mine.map((building) => {
          const footprint = building.ring?.length > 2 ? building.ring : null;
          if (footprint) {
            const bx = footprint.map((point) => sx(point[0]));
            const by = footprint.map((point) => sy(point[1]));
            const wide = Math.max(...bx) - Math.min(...bx);
            const tall = Math.max(...by) - Math.min(...by);
            if (wide >= 12 && tall >= 12) {
              return (
                <polygon
                  key={building.key}
                  className="building"
                  points={close(footprint)}
                />
              );
            }
          }
          const at = building.center || footprint?.[0];
          if (!at) return null;
          return (
            <rect
              key={building.key}
              className="building"
              x={sx(at[0]) - 8}
              y={sy(at[1]) - 7}
              width="16"
              height="14"
              rx="1.5"
            />
          );
        })}
        {roadD && <path className="center" d={roadD} />}
        {localRivers.map((river) => {
          const path = river.path;
          const riverD = smoothPathD(toScreen(path));
          const labelAt = path[Math.floor(path.length / 2)];
          return (
            <g key={river.key || river.name}>
              <path className="river-halo" d={riverD} />
              <path className="river" d={riverD} />
              {labelAt && (
                <text
                  className="river-name"
                  x={sx(labelAt[0])}
                  y={sy(labelAt[1]) - 6}
                >
                  {river.name || "River"}
                </text>
              )}
            </g>
          );
        })}
      </svg>
      <figcaption>{caption}.</figcaption>
    </figure>
  );
}

function sketchPath(vertices, width = 220, height = 92) {
  const path = (vertices || []).filter((point) => point?.length >= 2);
  if (path.length < 2) return "";
  const xs = path.map((point) => point[0]);
  const ys = path.map((point) => point[1]);
  const minX = Math.min(...xs);
  const maxX = Math.max(...xs);
  const minY = Math.min(...ys);
  const maxY = Math.max(...ys);
  const padX = 14;
  const padY = 14;
  const sx = (value) =>
    padX + ((value - minX) / (maxX - minX || 1)) * (width - padX * 2);
  const sy = (value) =>
    height - padY - ((value - minY) / (maxY - minY || 1)) * (height - padY * 2);
  return path
    .map(
      (point, index) =>
        `${index ? "L" : "M"}${sx(point[0]).toFixed(1)},${sy(point[1]).toFixed(1)}`,
    )
    .join(" ");
}

function sketchSvg(vertices, width = 220, height = 92) {
  const d = sketchPath(vertices, width, height);
  if (!d) {
    return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${width} ${height}" width="${width}" height="${height}"><rect width="${width}" height="${height}" fill="#e7efe4"/></svg>`;
  }
  return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${width} ${height}" width="${width}" height="${height}" aria-hidden="true"><rect width="${width}" height="${height}" fill="#e7efe4"/><path d="${d}" fill="none" stroke="#94a3b8" stroke-width="6" stroke-linecap="round" stroke-linejoin="round"/><path d="${d}" fill="none" stroke="#9f1239" stroke-width="2" stroke-dasharray="5 3" stroke-linecap="round" stroke-linejoin="round"/></svg>`;
}

function Sketch({ vertices }) {
  const path = vertices || [];
  if (path.length < 2)
    return <svg className="rr-sketch" viewBox="0 0 220 92" />;
  const d = sketchPath(path);
  return (
    <svg className="rr-sketch" viewBox="0 0 220 92" aria-hidden="true">
      <rect width="220" height="92" fill="#e7efe4" />
      <path d={d} fill="none" stroke="#94a3b8" strokeWidth="6" />
      <path
        d={d}
        fill="none"
        stroke="#9f1239"
        strokeWidth="2"
        strokeDasharray="5 3"
      />
    </svg>
  );
}

function statusClass(status) {
  if (status === "Demolished") return "rose";
  if (status === "Paid, not moved" || status === "Moved out") return "amber";
  if (status === "Proclaimed" || status === "Valued") return "teal";
  return "";
}

function printComparison(options, note) {
  const list = options || [];
  const head = list
    .map(
      (option, index) =>
        `<th>${letterOf(index)} · ${escHtml(option.label)}</th>`,
    )
    .join("");
  const sketchRow = list
    .map(
      (option) =>
        `<td class="sketch">${sketchSvg(option.vertices, 240, 110)}</td>`,
    )
    .join("");
  const cards = list
    .map((option, index) => {
      const total = option.report?.totalCost;
      return `<figure class="card">
        <figcaption><strong>${letterOf(index)} · ${escHtml(option.label)}</strong>${option.preferred ? " · Preferred" : ""}${index === 0 ? " · Baseline" : ""}</figcaption>
        ${sketchSvg(option.vertices, 280, 128)}
        <p>Total estimate: <strong>${rwfM(total)}</strong></p>
        <p>${formatMetre(option.report?.lengthM)} · ${formatSqm(option.report?.corridorSqm)} reserve</p>
      </figure>`;
    })
    .join("");
  const body = COMPARE_ROWS.map(([key, label, digits]) => {
    const values = list.map((option) => metric(option, key));
    const numeric = values.filter((value) => value != null);
    const best = numeric.length ? Math.min(...numeric) : null;
    const cells = values
      .map(
        (value) =>
          `<td>${metricText(value, key, digits)}${value != null && value !== 0 && value === best ? " · lowest" : ""}</td>`,
      )
      .join("");
    return `<tr><th>${label}</th>${cells}</tr>`;
  }).join("");
  const frame = document.createElement("iframe");
  frame.style.cssText = "position:fixed;width:0;height:0;border:0";
  document.body.appendChild(frame);
  const page = frame.contentWindow;
  page.document.open();
  page.document
    .write(`<!DOCTYPE html><html><head><title>Alignment comparison</title>
    <style>
      body{font-family:Segoe UI,sans-serif;margin:24px;color:#0f172a}
      h1{margin:0 0 6px;font-size:22px}
      h2{margin:22px 0 10px;font-size:16px}
      p{margin:0 0 12px;color:#475569;font-size:13px}
      .cards{display:grid;grid-template-columns:repeat(auto-fit,minmax(220px,1fr));gap:12px;margin:16px 0 22px}
      .card{margin:0;padding:10px;border:1px solid #d6dde6;border-radius:10px;background:#fff}
      .card figcaption{margin:0 0 8px;font-size:13px}
      .card svg{display:block;width:100%;height:auto;border-radius:8px}
      .card p{margin:6px 0 0}
      table{border-collapse:collapse;width:100%}
      th,td{border:1px solid #d6dde6;padding:6px 8px;text-align:left;vertical-align:top;font-size:13px}
      th{background:#f8fafc}
      td.sketch{background:#f8fafc;text-align:center}
      td.sketch svg{display:block;margin:0 auto;max-width:100%;height:auto}
      @media print{body{margin:12px}.card{break-inside:avoid}}
    </style>
    </head><body>
    <h1>Compare alignments</h1>
    <p>Alignment sketches and side-by-side measures. Lowest value in each row is marked.</p>
    <h2>Alignment images</h2>
    <div class="cards">${cards}</div>
    <h2>Side-by-side comparison</h2>
    <table>
      <thead>
        <tr><th>Measure</th>${head}</tr>
        <tr><th>Alignment image</th>${sketchRow}</tr>
      </thead>
      <tbody>${body}</tbody>
      </table>
    ${note ? `<h2>Decision notes</h2><p>${escHtml(note)}</p>` : ""}
    </body></html>`);
  page.document.close();
  page.focus();
  page.print();
  window.setTimeout(() => frame.remove(), 60000);
}

function escHtml(value) {
  return String(value ?? "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

export default function CostPlan({
  section,
  onSection,
  catalog,
  routeId,
  routeReady,
  onSelectRoute,
  drawing,
  measuring,
  editing,
  vertexMode,
  snapping,
  vertices,
  width,
  landRate,
  buildingRate,
  disturbancePct,
  contingencyPct,
  busy,
  report,
  options,
  activeId,
  showAllScenarios = false,
  note,
  parcelsOn,
  aerialOn,
  parcelStatus,
  parcelProofs,
  onParcelStatus,
  onRemoveParcelProof,
  onWidth,
  onLand,
  onBuilding,
  onDisturbance,
  onContingency,
  onDraw,
  onFinish,
  onReshape,
  onVertexMode,
  onClear,
  onSnap,
  onAlign,
  onMeasure,
  onKeep,
  onSelect,
  onShowOption,
  onRename,
  onPrefer,
  onLegal,
  onNote,
  onParcels,
  onRivers,
  onBuildings,
  onAerial,
  onExportFail,
  projects,
  projectId,
  onCreateProject,
  onSelectProject,
  onShowAll,
  onRemoveOption,
  onLayout,
  savePrompt,
  riversOn,
  buildingsOn,
  onShowParcel,
}) {
  const points = vertices?.length || 0;
  const [filter, setFilter] = useState("All");
  const [registerQuery, setRegisterQuery] = useState("");
  const [registerPage, setRegisterPage] = useState(0);
  const [selectedKey, setSelectedKey] = useState("");
  const [statusDraft, setStatusDraft] = useState(null);
  const [statusProofs, setStatusProofs] = useState([]);
  const [statusProofError, setStatusProofError] = useState("");
  const source =
    options.find((option) => option.id === activeId)?.report || report;
  const ready = Boolean(source && !source.error);
  const parcels = useMemo(
    () => [...(source?.parcels || [])].sort(byMostAffected),
    [source?.parcels],
  );
  const buildings = useMemo(
    () =>
      [...(source?.buildings || [])].sort(
        (left, right) => (Number(right.sqm) || 0) - (Number(left.sqm) || 0),
      ),
    [source?.buildings],
  );
  const sourceParcels = parcels;
  const selected =
    sourceParcels.find((parcel) => parcel.key === selectedKey) ||
    sourceParcels[0];
  const counts = useMemo(() => {
    const tally = Object.fromEntries(PIPELINE.map((status) => [status, 0]));
    sourceParcels.forEach((parcel) => {
      const status = parcelStatus[parcel.key] || "Identified";
      if (tally[status] != null) tally[status] += 1;
    });
    return tally;
  }, [sourceParcels, parcelStatus]);
  const maxPart = Math.max(
    report?.landCost || 0,
    report?.buildingCost || 0,
    report?.disturbance || 0,
    report?.contingency || 0,
    1,
  );
  const bar = (value, color) => (
    <i>
      <b
        style={{
          width: `${Math.max(0, (value / maxPart) * 100)}%`,
          background: color,
        }}
      />
    </i>
  );
  const [scenarioName, setScenarioName] = useState("");
  const [scenarioNameError, setScenarioNameError] = useState("");
  const [renameError, setRenameError] = useState("");
  const [saveOpen, setSaveOpen] = useState(false);
  const [projectDraft, setProjectDraft] = useState("");
  const [projectNameError, setProjectNameError] = useState("");
  const [projectOpen, setProjectOpen] = useState(false);
  const [parcelPage, setParcelPage] = useState(0);
  const [buildingPage, setBuildingPage] = useState(0);
  /** Parcel opened in the Map and budget affected list (empty = buildings panel waits for a click). */
  const [focusParcelKey, setFocusParcelKey] = useState("");
  const parcelsRef = useRef(null);
  const [tableH, setTableH] = useState(() => {
    const saved = Number(localStorage.getItem("rwanda-lrs-reserve-table"));
    return saved >= 140 ? saved : 0;
  });
  useEffect(() => {
    if (tableH)
      localStorage.setItem(
        "rwanda-lrs-reserve-table",
        String(Math.round(tableH)),
      );
  }, [tableH]);
  const startTableResize = (event) => {
    event.preventDefault();
    const startY = event.clientY;
    const startH = parcelsRef.current?.offsetHeight || tableH || 280;
    let next = startH;
    let frame = 0;
    const move = (moveEvent) => {
      const room = window.innerHeight - 260;
      next = Math.round(
        Math.max(140, Math.min(room, startH + (startY - moveEvent.clientY))),
      );
      if (frame) return;
      frame = requestAnimationFrame(() => {
        frame = 0;
        setTableH(next);
        onLayout?.();
      });
    };
    const up = () => {
      window.removeEventListener("pointermove", move);
      window.removeEventListener("pointerup", up);
      onLayout?.();
    };
    window.addEventListener("pointermove", move);
    window.addEventListener("pointerup", up);
  };
  const parcelStamp = parcels.map((parcel) => parcel.key).join("|");
  const buildingStamp = buildings.map((building) => building.key).join("|");
  useEffect(() => {
    setParcelPage(0);
    setFocusParcelKey("");
  }, [parcelStamp]);
  useEffect(() => {
    setBuildingPage(0);
  }, [buildingStamp, focusParcelKey]);
  const focusedParcel =
    parcels.find((parcel) => parcel.key === focusParcelKey) || null;
  const focusedBuildings = useMemo(
    () =>
      focusedParcel
        ? buildings.filter((building) => buildingOnParcel(focusedParcel, building))
        : [],
    [focusedParcel, buildings],
  );
  const parcelPages = Math.max(1, Math.ceil(parcels.length / PAGE_SIZE));
  const buildingPages = Math.max(1, Math.ceil(focusedBuildings.length / PAGE_SIZE));
  const parcelAt = Math.min(parcelPage, parcelPages - 1);
  const buildingAt = Math.min(buildingPage, buildingPages - 1);
  const parcelRows = parcels.slice(
    parcelAt * PAGE_SIZE,
    parcelAt * PAGE_SIZE + PAGE_SIZE,
  );
  const buildingRows = focusedBuildings.slice(
    buildingAt * PAGE_SIZE,
    buildingAt * PAGE_SIZE + PAGE_SIZE,
  );
  const openAffectedParcel = (parcel) => {
    setFocusParcelKey(parcel.key);
    setSelectedKey(parcel.key);
    setBuildingPage(0);
  };
  const rateOf = (parcel) => {
    const value = Number(parcel?.rate ?? parcel?.priceSqm);
    return value > 0 ? value : null;
  };
  /** Buildings panel only opens when the chosen parcel has affected buildings. */
  const showBuildingsPanel = Boolean(focusedParcel && focusedBuildings.length);
  const seenSavePrompt = useRef(0);
  useEffect(() => {
    if (!savePrompt || savePrompt === seenSavePrompt.current || busy) return;
    seenSavePrompt.current = savePrompt;
    if (!ready) return;
    setScenarioName(`Scenario ${letterOf((options || []).length)}`);
    setScenarioNameError("");
    setSaveOpen(true);
  }, [savePrompt, busy, ready]);
  const full = options.length >= 3;
  const closeProject = () => {
    setProjectOpen(false);
    setProjectDraft("");
    setProjectNameError("");
  };
  const createProject = () => {
    const name = projectDraft.trim();
    if (!name) return;
    if ((projects || []).some((project) => sameLabel(project.name, name))) {
      setProjectNameError("Two projects cannot have the same name.");
      return;
    }
    if (projectId) onSelectProject("");
    const created = onCreateProject(name);
    if (created === false) {
      setProjectNameError("Two projects cannot have the same name.");
      return;
    }
    closeProject();
  };
  const askToSave = () => {
    setScenarioName(
      (current) => current.trim() || `Scenario ${letterOf(options.length)}`,
    );
    setScenarioNameError("");
    setSaveOpen(true);
  };
  const finishLine = () => onFinish();
  const confirmSave = () => {
    if (!projectId || full || busy || !ready || report?.error) return;
    const label =
      scenarioName.trim() || `Scenario ${letterOf(options.length)}`;
    if ((options || []).some((option) => sameLabel(option.label, label))) {
      setScenarioNameError(
        "Two scenarios in this project cannot have the same name.",
      );
      return;
    }
    const kept = onKeep(label);
    if (kept === false) {
      setScenarioNameError(
        "Two scenarios in this project cannot have the same name.",
      );
      return;
    }
    setScenarioName("");
    setScenarioNameError("");
    setSaveOpen(false);
  };
  const commitScenarioRename = (id, nextLabel, input) => {
    const label = String(nextLabel || "").trim();
    const current = (options || []).find((option) => option.id === id);
    if (!current) return;
    if (!label) {
      if (input) input.value = current.label || "";
      setRenameError("Scenario name cannot be empty.");
      return;
    }
    if (
      (options || []).some(
        (option) => option.id !== id && sameLabel(option.label, label),
      )
    ) {
      if (input) input.value = current.label || "";
      setRenameError(
        "Two scenarios in this project cannot have the same name.",
      );
      return;
    }
    if (label === current.label) {
      setRenameError("");
      return;
    }
    const renamed = onRename?.(id, label);
    if (renamed === false) {
      if (input) input.value = current.label || "";
      setRenameError(
        "Two scenarios in this project cannot have the same name.",
      );
      return;
    }
    setRenameError("");
  };
  const exportCurrent = () => {
    const item = ready ? report : options[0]?.report;
    if (!item) return;
    try {
      exportBudgetReport(item, options);
    } catch (error) {
      onExportFail?.(error.message || "Could not export Excel.");
    }
  };
  const closeStatusProof = () => {
    setStatusDraft(null);
    setStatusProofs([]);
    setStatusProofError("");
  };
  const requestStatusChange = (key, status) => {
    const current = parcelStatus[key] || "Identified";
    if (!key || status === current) return;
    setStatusDraft({ key, status });
    setStatusProofs([]);
    setStatusProofError("");
  };
  const onStatusProofFiles = async (list) => {
    setStatusProofError("");
    try {
      const next = [];
      for (const file of [...(list || [])]) {
        next.push(await readProofFile(file));
      }
      setStatusProofs(next);
    } catch (error) {
      setStatusProofError(error.message || "Could not attach that file.");
      setStatusProofs([]);
    }
  };
  const confirmStatusChange = () => {
    if (!statusDraft) return;
    if (PROOF_STATUSES.has(statusDraft.status) && statusProofs.length === 0) {
      setStatusProofError(
        "Attach at least one proof document for this status.",
      );
      return;
    }
    onParcelStatus?.(statusDraft.key, statusDraft.status, statusProofs);
    closeStatusProof();
  };
  const selectedProofs = selected ? parcelProofs?.[selected.key] || [] : [];
  const alignment =
    options.find((option) => option.id === activeId)?.vertices ||
    vertices ||
    [];
  const registerRows = useMemo(() => {
    const wanted = registerQuery.trim().toLowerCase();
    return sourceParcels.filter((parcel) => {
      if (!matchesFilter(parcelStatus[parcel.key], filter)) return false;
      if (!wanted) return true;
      const hay = [
        parcelCode(parcel),
        parcel.district,
        parcel.sector,
        parcel.cell,
        parcel.village,
      ]
        .filter(Boolean)
        .join(" ")
        .toLowerCase();
      return hay.includes(wanted);
    });
  }, [sourceParcels, parcelStatus, filter, registerQuery]);
  const registerPages = Math.max(1, Math.ceil(registerRows.length / 9));
  const registerAt = Math.min(registerPage, registerPages - 1);
  const registerSlice = registerRows.slice(registerAt * 9, registerAt * 9 + 9);
  const parcelBuildings = selected
    ? (source?.buildings || buildings).filter((building) =>
        buildingOnParcel(selected, building),
      )
    : [];
  const parcelBuildingCost = parcelBuildings.reduce(
    (sum, building) => sum + (Number(building.cost) || 0),
    0,
  );
  useEffect(() => {
    setRegisterPage(0);
  }, [filter, registerQuery, sourceParcels.length]);

  return (
    <>
      <header className="rr-nav">
        <div className="rr-brand">Road Reserve Management System</div>
        <nav className="rr-tabs" aria-label="Road reserve">
          {SECTIONS.map(([id, label]) => (
            <button
              key={id}
              type="button"
              className={section === id ? "on" : ""}
              aria-current={section === id ? "page" : undefined}
              onClick={() => onSection(id)}
            >
              {label}
            </button>
          ))}
        </nav>
      </header>

      {section === "budget" && (
        <>
          <div className="rr-title">
            <div>
              <h2>Road Reserve / Budgeting tool</h2>
            </div>
            <div className="rr-actions">
              <ProjectSearch
                projects={projects}
                projectId={projectId}
                onSelect={onSelectProject}
              />
              <ScenarioMenu
                projectId={projectId}
                options={options}
                activeId={activeId}
                onShow={onShowOption}
                onShowAll={onShowAll}
                onRemove={onRemoveOption}
              />
              <button
                type="button"
                className="rr-btn solid"
                onClick={() => {
                  setProjectNameError("");
                  setProjectOpen(true);
                }}
              >
                <assetIcons.Plus size={16} />
                New project
              </button>
              {/* <button type="button" disabled={!ready || !projectId || full} onClick={saveCurrent}>{full ? "3 scenarios saved" : "Save scenario"}</button> */}
              <button
                type="button"
                className="export-excel"
                disabled={!ready && options.length === 0}
                onClick={exportCurrent}
              >
                <assetIcons.ExcelLogo
                  className="file-logo"
                  aria-hidden="true"
                />
                <span>Excel</span>
              </button>
              <button
                type="button"
                className="print-pdf"
                disabled={!ready && options.length === 0}
                onClick={() =>
                  printComparison(
                    options.length
                      ? options
                      : [{ label: "Current line", report }],
                    note,
                  )
                }
              >
                <assetIcons.PdfLogo className="file-logo" aria-hidden="true" />
                <span>PDF</span>
              </button>
            </div>
          </div>
          <aside className="rr-left">
            <section className="rr-card">
              <p className="rr-step">1. Base road</p>
              <h3>Connect alignment to</h3>
              <RoutePicker
                catalog={catalog || []}
                value={routeId || ""}
                placeholder="Select a route"
                onChange={onSelectRoute}
              />
            </section>
            <section className="rr-card">
              <p className="rr-step">2. Draw alignment</p>
              <div className="rr-draw">
                <button
                  type="button"
                  className={drawing ? "on" : ""}
                  onClick={onDraw}
                >
                  <assetIcons.Draw size={15} />
                  {drawing ? "Drawing" : "Draw"}
                </button>
                <button
                  type="button"
                  className={editing || vertexMode ? "on" : ""}
                  onClick={onReshape}
                >
                  <assetIcons.MdOutlineEditRoad size={15} />
                  Vertices
                </button>
                <button
                  type="button"
                  className={snapping ? "on" : ""}
                  onClick={onSnap}
                  title="Joins the end of the new reserve to the selected road and keeps the direction it was drawn."
                >
                  <assetIcons.Join size={15} />
                  Snap
                </button>
                <button
                  type="button"
                  onClick={onAlign}
                  title="Draws the new reserve on top of the selected road, along the stretch it covers."
                >
                  <assetIcons.GiRoad size={15} />
                  Align
                </button>
                <button
                  type="button"
                  className={measuring ? "on" : ""}
                  onClick={onMeasure}
                  title="Click two points on the map. The distance is shown on the map in kilometres."
                >
                  <assetIcons.Ruler size={15} />
                  Measure
                </button>
                <button type="button" onClick={onClear}>
                  <assetIcons.Delete size={15} />
                  Clear
                </button>
              </div>
              {vertexMode && (
                <div
                  className="rr-vertex-modes"
                  role="group"
                  aria-label="Vertex edit mode"
                >
                  <button
                    type="button"
                    className={vertexMode === "continue" ? "on" : ""}
                    onClick={() => onVertexMode?.("continue")}
                    title="Keep adding points to the same alignment"
                  >
                    Continue
                  </button>
                  <button
                    type="button"
                    className={vertexMode === "move" ? "on" : ""}
                    onClick={() => onVertexMode?.("move")}
                    title="Drag one vertex, or click the line to insert a bend"
                  >
                    Move
                  </button>
                  <button
                    type="button"
                    className={vertexMode === "shift" ? "on" : ""}
                    onClick={() => onVertexMode?.("shift")}
                    title="Drag any vertex to shift the whole alignment"
                  >
                    Shift
                  </button>
                </div>
              )}
              {/* {vertexMode === "continue" && (
                <p className="rr-hint">Click the map to add points. Finish when the line is ready.</p>
              )}
              {vertexMode === "move" && (
                <p className="rr-hint">Drag a vertex to move it. Click near the line to insert a bend.</p>
              )}
              {vertexMode === "shift" && (
                <p className="rr-hint">Drag any vertex to shift the whole alignment.</p>
              )} */}
              {(drawing || vertexMode === "continue") && points >= 2 && (
                <button
                  type="button"
                  className="rr-btn solid"
                  onClick={finishLine}
                >
                  Finish line
                </button>
              )}
              {/* {!drawing && ready && !activeId && !saveOpen && <button type="button" className="rr-btn solid" onClick={askToSave}>Save scenario</button>} */}
              {busy && (
                <p className="rr-hint">Measuring parcels and buildings…</p>
              )}
            </section>
            <section className="rr-card">
              <p className="rr-step">3. Reserve width</p>
              <div className="rr-widths">
                {WIDTHS.map((item) => (
                  <button
                    key={item}
                    type="button"
                    className={Number(width) === item ? "on" : ""}
                    onClick={() => onWidth(item)}
                  >
                    {item} m
                  </button>
                ))}
              </div>
              <label className="stack">
                Custom width: {width} m
                <input
                  type="range"
                  min="10"
                  max="80"
                  step="1"
                  value={Math.min(80, Math.max(10, Number(width) || 10))}
                  onChange={(event) => onWidth(Number(event.target.value))}
                />
              </label>
              <div className="rr-range">
                <span>10 m</span>
                <span>80 m</span>
              </div>
            </section>
            <section className="rr-card">
              <p className="rr-step">Saved scenarios</p>
              <h3>Show on the map</h3>
              {!projectId && (
                <p className="rr-hint">
                  Create a project, then save a finished line. Each project
                  holds 3 scenarios.
                </p>
              )}
              {projectId && options.length === 0 && (
                <p className="rr-hint">
                  Finish a line to save it here. Choose one to draw it on the
                  map.
                </p>
              )}
              <div className="rr-scenarios">
                {options.map((option, index) => (
                  <div key={option.id} className="rr-scenario-row">
                    <button
                      type="button"
                      className={option.id === activeId ? "on" : ""}
                      onClick={() => onShowOption(option.id)}
                    >
                      <b>
                        {letterOf(index)} · {option.label}
                      </b>
                      <span>{formatMetre(option.report?.lengthM)}</span>
                    </button>
                    <button
                      type="button"
                      className="rr-scenario-drop"
                      aria-label={`Delete ${option.label}`}
                      onClick={() => onRemoveOption(option.id)}
                    >
                      Delete
                    </button>
                  </div>
                ))}
              </div>
              {projectId && options.length > 0 && (
                <button type="button" className="rr-btn" onClick={onShowAll}>
                  All on map
                </button>
              )}
            </section>
          </aside>
          <aside className="rr-right">
            <section className="rr-card">
              <h3>Reserve summary</h3>
              {showAllScenarios && options.length > 0 ? (
                <div className="rr-summary-all">
                  {options.map((option, index) => {
                    const item = option.report;
                    const ok = Boolean(item && !item.error);
                    return (
                      <div key={option.id} className="rr-summary-block">
                        <header>
                          <b>
                            {letterOf(index)} · {option.label}
                          </b>
                        </header>
                        <div className="rr-stats">
                          <div>
                            <span>Parcels affected</span>
                            <b>{ok ? item.parcels?.length || 0 : "—"}</b>
                          </div>
                          <div>
                            <span>Buildings affected</span>
                            <b>{ok ? item.buildings?.length || 0 : "—"}</b>
                          </div>
                          <div>
                            <span>River crossings</span>
                            <b>{ok ? item.rivers?.length || 0 : "—"}</b>
                          </div>
                          <div>
                            <span>Reserve area</span>
                            <b>{ok ? formatSqm(item.corridorSqm) : "—"}</b>
                          </div>
                          <div>
                            <span>Alignment length</span>
                            <b>{ok ? formatMetre(item.lengthM) : "—"}</b>
                          </div>
                          <div>
                            <span>Cost</span>
                            <b>{ok ? rwfM(item.totalCost) : "—"}</b>
                          </div>
                        </div>
                      </div>
                    );
                  })}
                </div>
              ) : (
                <div className="rr-stats">
                  <div>
                    <span>Parcels affected</span>
                    <b>{ready ? parcels.length : "—"}</b>
                  </div>
                  <div>
                    <span>Buildings affected</span>
                    <b>{ready ? buildings.length : "—"}</b>
                  </div>
                  <div>
                    <span>River crossings</span>
                    <b>
                      {ready && source.rivers ? source.rivers.length : "—"}
                    </b>
                  </div>
                  <div>
                    <span>Reserve area</span>
                    <b>{ready ? formatSqm(source.corridorSqm) : "—"}</b>
                  </div>
                  <div>
                    <span>Alignment length</span>
                    <b>{ready ? formatMetre(source.lengthM) : "—"}</b>
                  </div>
                  <div>
                    <span>Cost</span>
                    <b>{ready ? rwfM(source.totalCost) : "—"}</b>
                  </div>
                </div>
              )}
            </section>
            <section className="rr-card">
              <p className="rr-step">4. Layers</p>
              <ul className="rr-key rr-legend-side">
                <li>
                  <i
                    style={{
                      background: "transparent",
                      borderBottom: "2px dashed currentColor",
                    }}
                  />
                  Alignment
                </li>
                <li>
                  <i style={{ background: "#f9a8d4" }} />
                  Reserve
                </li>
                <li>
                  <i style={{ background: "#fb923c" }} />
                  Parcel taken
                </li>
                <li>
                  <i style={{ background: "#991b1b" }} />
                  Building
                </li>
                <li>
                  <i style={{ background: "#2563eb" }} />
                  River
                </li>
              </ul>
              <ul className="rr-layers">
                <li>
                  Parcels (cadastre){" "}
                  <Switch on={parcelsOn} label="Parcels" onClick={onParcels} />
                </li>
                <li>
                  Building footprints{" "}
                  <Switch
                    on={buildingsOn}
                    label="Building footprints"
                    onClick={onBuildings}
                  />
                </li>
                <li>
                  Existing roads <Switch on label="Existing roads" disabled />
                </li>
                <li>
                  Rivers{" "}
                  <Switch on={riversOn} label="Rivers" onClick={onRivers} />
                </li>
                <li>
                  Aerial photo{" "}
                  <Switch
                    on={aerialOn}
                    label="Aerial photo"
                    onClick={onAerial}
                  />
                </li>
                <li>
                  Proclaimed reserves{" "}
                  <Switch on={false} label="Proclaimed reserves" disabled />
                </li>
              </ul>
            </section>
            <section className="rr-card">
              <h3>Next steps</h3>
              <div className="rr-next">
                <button
                  type="button"
                  className="rr-btn"
                  disabled={!ready}
                  onClick={() => onSection("register")}
                >
                  Create acquisition list from affected parcels
                </button>
                <button
                  type="button"
                  className="rr-btn"
                  onClick={() => onSection("compare")}
                >
                  Compare with other alignments
                </button>
              </div>
            </section>
          </aside>
          <section
            ref={parcelsRef}
            className={`rr-card rr-parcels${tableH ? " sized" : ""}`}
            id="affected-parcels"
            style={tableH ? { height: tableH } : undefined}
          >
            <div
              className="rr-split"
              role="separator"
              aria-orientation="horizontal"
              aria-label="Move the parcel list up or down"
              onPointerDown={startTableResize}
            />
            <div className="rr-parcels-body">
              <div
                className={`rr-affected${showBuildingsPanel ? "" : " single"}`}
              >
                <div>
                  <header>
                    <h3>Affected parcels ({ready ? parcels.length : 0})</h3>
                    <button
                      type="button"
                      className="rr-btn"
                      disabled={!ready}
                      onClick={exportCurrent}
                    >
                      Export list
                    </button>
                  </header>
                  <table className="rr-table">
                    <thead>
                      <tr>
                        <th>Parcel ID</th>
                        <th>Parcel area (m²)</th>
                        <th>Overlap with reserve</th>
                        <th>Affected (m²)</th>
                        <th>Max price / m²</th>
                        <th>Price of affected</th>
                        <th>Building</th>
                        <th>Acquisition status</th>
                        <th></th>
                      </tr>
                    </thead>
                    <tbody>
                      {!ready && (
                        <tr>
                          <td colSpan={9}>
                            {busy
                              ? "Measuring…"
                              : "Draw and finish an alignment to list parcels."}
                          </td>
                        </tr>
                      )}
                      {parcelRows.map((parcel) => {
                        const rate = rateOf(parcel);
                        return (
                          <tr
                            key={parcel.key}
                            className={focusParcelKey === parcel.key ? "on" : ""}
                            onClick={() => openAffectedParcel(parcel)}
                            style={{ cursor: "pointer" }}
                          >
                            <td>
                              <button
                                type="button"
                                className="link"
                                onClick={(event) => {
                                  event.stopPropagation();
                                  openAffectedParcel(parcel);
                                  onShowParcel?.(parcel);
                                }}
                              >
                                {parcelCode(parcel)}
                              </button>
                            </td>
                            <td>
                              {parcel.recordedSize || formatNumber(parcel.sqm, 4)}
                            </td>
                            <td>{overlapOf(parcel)}</td>
                            <td>
                              {Number.isFinite(parcel.sqm)
                                ? formatNumber(parcel.sqm, 4)
                                : "—"}
                            </td>
                            <td title={parcel.priceVillage || ""}>
                              {rate != null ? formatNumber(rate, 2) : "No price"}
                            </td>
                            <td>
                              {rate != null ? formatRwf(parcel.cost) : "—"}
                            </td>
                            <td>
                              {hasBuilding(parcel, buildings) ? "Yes" : "No"}
                            </td>
                            <td>{parcelStatus[parcel.key] || "Not started"}</td>
                            <td>
                              <button
                                type="button"
                                className="link"
                                onClick={(event) => {
                                  event.stopPropagation();
                                  openAffectedParcel(parcel);
                                  onSection("register");
                                }}
                              >
                                Open
                              </button>
                            </td>
                          </tr>
                        );
                      })}
                    </tbody>
                  </table>
                  <Pager
                    page={parcelAt}
                    pages={parcelPages}
                    total={parcels.length}
                    onPage={setParcelPage}
                  />
                </div>
                {showBuildingsPanel && (
                  <>
                    <i className="rr-affected-line" aria-hidden="true" />
                    <div>
                      <header>
                        <h3>
                          Affected buildings ({focusedBuildings.length}) ·{" "}
                          {parcelCode(focusedParcel)}
                        </h3>
                        <button
                          type="button"
                          className="rr-btn"
                          onClick={() => setFocusParcelKey("")}
                        >
                          Clear
                        </button>
                      </header>
                      <table className="rr-table">
                        <thead>
                          <tr>
                            <th>Parcel ID</th>
                            <th>Use</th>
                            <th>Affected %</th>
                            <th>Affected (m²)</th>
                            <th>Max price / m²</th>
                            <th>Price of affected</th>
                          </tr>
                        </thead>
                        <tbody>
                          {buildingRows.map((building) => {
                            const host = focusedParcel;
                            const rate =
                              rateOf(host) ??
                              (Number(building.landPriceSqm) > 0
                                ? Number(building.landPriceSqm)
                                : null);
                            const landCost =
                              rate != null && Number(building.sqm) > 0
                                ? rate * building.sqm
                                : null;
                            return (
                              <tr key={building.key}>
                                <td>
                                  <button
                                    type="button"
                                    className="link"
                                    onClick={() => onShowParcel?.(host)}
                                  >
                                    {parcelCode(host)}
                                  </button>
                                </td>
                                <td>
                                  {building.name || building.use || "Building"}
                                </td>
                                <td>{buildingAffectedPct(building)}</td>
                                <td>
                                  {Number.isFinite(building.sqm)
                                    ? formatNumber(building.sqm, 4)
                                    : "—"}
                                </td>
                                <td>
                                  {rate != null
                                    ? formatNumber(rate, 2)
                                    : "No price"}
                                </td>
                                <td>
                                  {landCost != null ? formatRwf(landCost) : "—"}
                                </td>
                              </tr>
                            );
                          })}
                        </tbody>
                      </table>
                      <Pager
                        page={buildingAt}
                        pages={buildingPages}
                        total={focusedBuildings.length}
                        onPage={setBuildingPage}
                      />
                    </div>
                  </>
                )}
              </div>
            </div>
          </section>
        </>
      )}

      {section === "register" && (
        <>
          <div className="rr-title">
            <div>
              <p>Road Reserve / Parcel register</p>
              <h2>
                Parcels in reserve ·{" "}
                {options.find((option) => option.id === activeId)?.label ||
                  routeId ||
                  "new alignment"}
              </h2>
            </div>
            <div className="rr-actions">
              <label className="rr-register-scenario">
                Scenario
                <select
                  aria-label="Scenario"
                  value={activeId || ""}
                  disabled={!options.length}
                  onChange={(event) =>
                    event.target.value && onSelect(event.target.value)
                  }
                >
                  {!activeId && (
                    <option value="">
                      {report && !report.error
                        ? "Current line"
                        : "Choose a scenario"}
                    </option>
                  )}
                  {options.map((option, index) => (
                    <option key={option.id} value={option.id}>
                      {letterOf(index)} · {option.label}
                    </option>
                  ))}
                </select>
              </label>
              <button
                type="button"
                className="export-excel"
                disabled={!sourceParcels.length}
                onClick={exportCurrent}
              >
                <assetIcons.ExcelLogo
                  className="file-logo"
                  aria-hidden="true"
                />
                <span>Excel</span>
              </button>
            </div>
          </div>
          <section className="rr-page">
            <div className="rr-kpis">
              <article>
                <span>Parcels</span>
                <b>{sourceParcels.length}</b>
              </article>
              <article>
                <span>Paid</span>
                <b>{counts["Moved out"] + counts.Demolished}</b>
                <em>of {sourceParcels.length}</em>
              </article>
              <article>
                <span>Moved out</span>
                <b>{counts["Moved out"]}</b>
                <em>
                  of{" "}
                  {counts["Paid, not moved"] +
                    counts["Moved out"] +
                    counts.Demolished}{" "}
                  standing or moved
                </em>
              </article>
              <article>
                <span>Demolished</span>
                <b>{counts.Demolished}</b>
              </article>
              <article>
                <span>Paid, not moved</span>
                <b>{counts["Paid, not moved"]}</b>
              </article>
            </div>
            <div className="rr-register">
              <div className="rr-card rr-register-list">
                <div className="rr-register-tools">
                  <input
                    type="search"
                    value={registerQuery}
                    placeholder="Search parcel ID or owner"
                    aria-label="Search parcel ID or owner"
                    onChange={(event) => setRegisterQuery(event.target.value)}
                  />
                  <div className="rr-chips">
                    {FILTERS.map((item) => (
                      <button
                        key={item}
                        type="button"
                        className={`rr-chip${filter === item ? " on" : ""}`}
                        onClick={() => setFilter(item)}
                      >
                        {item}
                      </button>
                    ))}
                  </div>
                </div>
                <table className="rr-table">
        <thead>
                    <tr>
                      <th>Parcel ID</th>
                      <th>Owner</th>
                      <th>Village</th>
                      <th>Area (m²)</th>
                      <th>Price / m² (RWF)</th>
                      <th>Building</th>
                      <th>Property cost (RWF M)</th>
                      {/* <th>Land taken cost (RWF)</th> */}
                      <th>Date paid</th>
                      <th>Date moved</th>
                      <th>Status</th>
                    </tr>
        </thead>
        <tbody>
                    {registerSlice.map((parcel) => {
                      const buildingCost = (source?.buildings || [])
                        .filter((building) => buildingOnParcel(parcel, building))
                        .reduce((sum, building) => sum + (Number(building.cost) || 0), 0);
                      const landCost = Number(parcel.cost) || 0;
                      return (
                      <tr
                        key={parcel.key}
                        className={selected?.key === parcel.key ? "on" : ""}
                        onClick={() => setSelectedKey(parcel.key)}
                      >
                        <td>
                          <button
                            type="button"
                            className="link"
                            onClick={() => setSelectedKey(parcel.key)}
                          >
                            {parcelCode(parcel)}
                          </button>
                        </td>
                        <td>—</td>
                        <td>{parcel.priceVillage || parcel.village || "—"}</td>
                        <td>{formatNumber(parcel.sqm, 4)}</td>
                        <td title={parcel.rateSource === "village" ? "Village maximum reference price" : "No village price found"}>
                          {parcel.rate ? formatNumber(parcel.rate, 2) : "No price"}
                        </td>
                        <td>
                          {hasBuilding(parcel, source?.buildings)
                            ? "Yes"
                            : "No"}
                        </td>
                        <td>{millions(landCost + buildingCost)}</td>
                        {/* <td>{landCost > 0 ? formatRwf(landCost) : "—"}</td> */}
                        <td>—</td>
                        <td>—</td>
                        <td>
                          <span
                            className={`rr-badge ${statusClass(parcelStatus[parcel.key])}`}
                          >
                            {parcelStatus[parcel.key] || "Identified"}
                            {(parcelProofs?.[parcel.key] || []).length
                              ? ` · ${(parcelProofs[parcel.key] || []).length} proof`
                              : ""}
                          </span>
                        </td>
            </tr>
                      );
                    })}
                    {registerRows.length === 0 && (
                      <tr>
                        <td colSpan={11}>
                          {sourceParcels.length
                            ? "No parcel matches this search."
                            : "Draw an alignment on Map and budget. Its parcels appear here."}
                        </td>
                      </tr>
                    )}
        </tbody>
      </table>
                <div className="rr-register-foot">
                  <span>
                    Showing{" "}
                    {registerRows.length
                      ? `${registerAt * 9 + 1}–${Math.min(registerRows.length, registerAt * 9 + registerSlice.length)}`
                      : "0"}{" "}
                    of {registerRows.length}
                  </span>
                  <div className="rr-pager">
                    <button
                      type="button"
                      disabled={registerAt <= 0}
                      onClick={() => setRegisterPage(registerAt - 1)}
                    >
                      Previous
                    </button>
                    <span>
                      {registerAt + 1} of {registerPages}
                    </span>
                    <button
                      type="button"
                      disabled={registerAt >= registerPages - 1}
                      onClick={() => setRegisterPage(registerAt + 1)}
                    >
                      Next
                    </button>
                  </div>
                </div>
              </div>
              <aside className="rr-card rr-detail">
                {selected ? (
                  <>
                    <header className="rr-page-head">
                      <span className="rr-register-id">
                        <b>{parcelCode(selected)}</b>
                        <span
                          className={`rr-badge ${statusClass(parcelStatus[selected.key])}`}
                        >
                          {parcelStatus[selected.key] || "Identified"}
                        </span>
                      </span>
                      <button
                        type="button"
                        className="rr-btn"
                        onClick={() => onShowParcel?.(selected)}
                      >
                        Show on map
                      </button>
                    </header>
                    <ParcelScene
                      parcel={selected}
                      alignment={alignment}
                      buildings={source?.buildings || buildings}
                      rivers={
                        source?.rivers?.length
                          ? source.rivers
                          : report?.rivers || []
                      }
                      width={source?.widthM || width}
                    />
                  </>
                ) : (
                  <p className="rr-hint">Select a parcel.</p>
                )}
              </aside>
              {selected && (
                <div className="rr-detail-row">
                  <section className="rr-fact">
                    <h4>OWNER</h4>
                    <p>
                      <span>Name</span>
                      <b>—</b>
                    </p>
                    <p>
                      <span>National ID</span>
                      <b>—</b>
                    </p>
                    <p>
                      <span>Phone</span>
                      <b>—</b>
                    </p>
                    <p>
                      <span>Land use</span>
                      <b>—</b>
                    </p>
                    <p>
                      <span>Location</span>
                      <b>
                        {[selected.district, selected.sector, selected.cell]
                          .filter(Boolean)
                          .join(", ") || "—"}
                      </b>
                    </p>
                  </section>
                  <section className="rr-fact">
                    <h4>PROPERTY COST</h4>
                    <p>
                      <span>Land price per m²</span>
                      <b>
                        {selected.rate ? `${formatRwf(selected.rate)}` : "—"}
                      </b>
                    </p>
                    <p>
                      <span>Price source</span>
                      <b>
                        {selected.rateSource === "village"
                          ? `Village max · ${[selected.priceVillage, selected.priceCell, selected.priceSector].filter(Boolean).join(", ")}${selected.priceYear ? ` (${selected.priceYear})` : ""}`
                          : "No village price found · land not costed"}
                      </b>
                    </p>
                    <p>
                      <span>Area inside reserve</span>
                      <b>{formatSqm(selected.sqm)}</b>
                    </p>
                    <p>
                      <span>Land taken Cost</span>
                      <b>
                        {millions(selected.cost)} M
                        {selected.rate ? ` (${formatSqm(selected.sqm)} × ${formatRwf(selected.rate)})` : ""}
                      </b>
                    </p>
                    <p>
                      <span>
                        Building
                        {parcelBuildings.length
                          ? ` (${parcelBuildings.length})`
                          : ""}
                      </span>
                      <b>
                        {parcelBuildings.length
                          ? `${millions(parcelBuildingCost)} M`
                          : "—"}
                      </b>
                    </p>
                    <p>
                      <span>Crops and trees</span>
                      <b>—</b>
                    </p>
                    <p>
                      <span>River</span>
                      <b>{(selected.rivers || []).join(", ") || "—"}</b>
                    </p>
                  </section>
                  <section className="rr-fact">
                    <h4>STATUS FIELDS</h4>
                    <label className="stack">
                      Payment status
                      <select
                        value={parcelStatus[selected.key] || "Identified"}
                        onChange={(event) =>
                          requestStatusChange(selected.key, event.target.value)
                        }
                      >
                        {[
                          "Identified",
                          ...PIPELINE.slice(1),
                          "Not started",
                        ].map((status) => (
                          <option key={status}>{status}</option>
                        ))}
                      </select>
                    </label>
                    <div className="rr-proof-block">
                      <span>Proof of documents</span>
                      {selectedProofs.length === 0 ? (
                        <p className="rr-hint">No proof attached yet.</p>
                      ) : (
                        <ul className="rr-proof-list">
                          {selectedProofs.map((proof) => (
                            <li key={proof.id}>
                              <a
                                href={proof.dataUrl}
                                target="_blank"
                                rel="noreferrer"
                                download={proof.name}
                              >
                                {proof.name}
                              </a>
                              <em>{proof.status}</em>
                              <button
                                type="button"
                                className="rr-proof-remove"
                                aria-label={`Remove ${proof.name}`}
                                onClick={() =>
                                  onRemoveParcelProof?.(selected.key, proof.id)
                                }
                              >
                                Remove
                              </button>
                            </li>
                          ))}
                        </ul>
                      )}
                    </div>
                    <div className="rr-actions">
                      <button
                        type="button"
                        className="parcel-move-out"
                        onClick={() =>
                          requestStatusChange(selected.key, "Moved out")
                        }
                      >
                        Record move-out
                      </button>
                      <button
                        type="button"
                        className="parcel-demolished"
                        onClick={() =>
                          requestStatusChange(selected.key, "Demolished")
                        }
                      >
                        Mark demolished
                      </button>
                    </div>
                  </section>
                </div>
              )}
            </div>
          </section>
        </>
      )}

      {section === "proclamation" && (
        <>
          <div className="rr-title">
            <div>
              <p>Road Reserve / Proclamation and acquisition tracking</p>
              <h2>Reserve status by road</h2>
            </div>
            <div className="rr-actions">
              <button type="button" onClick={() => onSection("budget")}>
                Show on map
              </button>
            </div>
          </div>
          <section className="rr-page">
            <div className="rr-split">
              <div className="rr-card">
                <h3>Roads and legal status</h3>
                <table className="rr-table">
                  <thead>
                    <tr>
                      <th>Road ID</th>
                      <th>Reserve width</th>
                      <th>Legal status</th>
                      <th>Parcels</th>
                    </tr>
                  </thead>
                  <tbody>
                    {options.map((option) => (
                      <tr
                        key={option.id}
                        className={option.id === activeId ? "on" : ""}
                      >
                        <td>
                          <button
                            type="button"
                            className="link"
                            onClick={() => onSelect(option.id)}
                          >
                            {option.label}
                          </button>
                        </td>
                        <td>{option.width} m</td>
                        <td>
                          <span
                            className={`rr-badge ${statusClass(option.legal || "Proposed")}`}
                          >
                            {option.legal || "Proposed"}
                          </span>
                        </td>
                        <td>{option.report?.parcels?.length || 0}</td>
                      </tr>
                    ))}
                    {options.length === 0 && (
                      <tr>
                        <td colSpan={4}>
                          Save a scenario from Map and budget to track it here.
                        </td>
                      </tr>
                    )}
                  </tbody>
                </table>
              </div>
              <aside className="rr-card rr-detail">
                <h3>
                  {options.find((option) => option.id === activeId)?.label ||
                    "No scenario selected"}{" "}
                  <span className="rr-badge">
                    {options.find((option) => option.id === activeId)?.legal ||
                      "Proposed"}
                  </span>
                </h3>
                <p>
                  <span>Reserve width</span>
                  <b>
                    {options.find((option) => option.id === activeId)?.width ||
                      width}{" "}
                    m
                  </b>
                </p>
                <p>
                  <span>Length</span>
                  <b>{source ? formatMetre(source.lengthM) : "—"}</b>
                </p>
                <h4>LEGAL ACTIONS</h4>
                <div className="rr-actions">
                  <button
                    type="button"
                    className="solid"
                    disabled={!activeId}
                    onClick={() => onLegal(activeId, "Proclaimed")}
                  >
                    Proclaim
                  </button>
                  <button
                    type="button"
                    disabled={!activeId}
                    onClick={() => onLegal(activeId, "Re-proclaimed")}
                  >
                    Re-proclaim
                  </button>
                  <button
                    type="button"
                    disabled={!activeId}
                    onClick={() => onLegal(activeId, "De-proclaimed")}
                  >
                    De-proclaim section
                  </button>
                </div>
              </aside>
            </div>
            <div className="rr-card">
              <h3>Acquisition pipeline: {sourceParcels.length} parcels</h3>
              <div className="rr-board">
                {PIPELINE.map((status) => (
                  <div key={status} className="rr-col">
                    <header>
                      <span>{status}</span>
                      <b>{counts[status] || 0}</b>
                    </header>
                    {sourceParcels
                      .filter(
                        (parcel) =>
                          (parcelStatus[parcel.key] || "Identified") === status,
                      )
                      .slice(0, 3)
                      .map((parcel) => (
                        <article key={parcel.key}>
                          <b>{parcelCode(parcel)}</b>
                          <div>
                            {[parcel.district, parcel.sector]
                              .filter(Boolean)
                              .join(" · ") || "Parcel"}
                          </div>
                        </article>
                      ))}
                  </div>
                ))}
              </div>
            </div>
            <div className="rr-card">
              <h3>Status along the road</h3>
              <p className="rr-hint">
                Each block is one affected parcel. Chainage is the alignment
                length, split evenly because the cadastre extract has no
                measure.
              </p>
              <div className="rr-status">
                {sourceParcels.map((parcel) => {
                  const status = parcelStatus[parcel.key] || "Identified";
                  const color =
                    status === "Demolished"
                      ? "#1e3a8a"
                      : status === "Moved out"
                        ? "#0f766e"
                        : status === "Paid, not moved"
                          ? "#d97706"
                          : "#94a3b8";
  return (
                    <span
                      key={parcel.key}
                      style={{ flex: 1, background: color }}
                      title={parcelCode(parcel)}
                    />
                  );
                })}
              </div>
              <p className="rr-hint">
                0+000{" "}
                <span style={{ float: "right" }}>
                  {source ? formatMetre(source.lengthM) : ""}
                </span>
              </p>
            </div>
          </section>
        </>
      )}

      {section === "monitoring" && (
        <>
          <div className="rr-title">
            <div>
              <p>Road Reserve / Monitoring and reports</p>
              <h2>
                Reserve monitoring · Proposal {routeId || "new alignment"}
              </h2>
            </div>
            <div className="rr-actions">
              <button
                type="button"
                disabled={!options.length && !ready}
                onClick={() =>
                  printComparison(
                    options.length ? options : [{ label: "Current", report }],
                    note,
                  )
                }
              >
                Export PDF
              </button>
              <button
                type="button"
                className="solid"
                disabled={!ready && !options.length}
                onClick={exportCurrent}
              >
                Export Excel
              </button>
            </div>
          </div>
          <section className="rr-page">
            <div className="rr-kpis">
              <article>
                <span>Parcels recorded</span>
                <b>
                  {sourceParcels.length
                    ? `${Math.round(((counts["Moved out"] + counts.Demolished) / sourceParcels.length) * 100)}%`
                    : "—"}
                </b>
                <em>
                  {counts["Moved out"] + counts.Demolished} of{" "}
                  {sourceParcels.length} moved or cleared
                </em>
              </article>
              <article>
                <span>Paid owners who moved</span>
                <b>
                  {counts["Paid, not moved"] +
                  counts["Moved out"] +
                  counts.Demolished
                    ? `${Math.round((counts["Moved out"] / Math.max(1, counts["Paid, not moved"] + counts["Moved out"] + counts.Demolished)) * 100)}%`
                    : "—"}
                </b>
              </article>
              <article>
                <span>Paid, not moved</span>
                <b>{counts["Paid, not moved"]}</b>
              </article>
              <article>
                <span>Buildings in reserve</span>
                <b>{source?.buildings?.length || 0}</b>
              </article>
              <article>
                <span>Outstanding estimate</span>
                <b>{source ? rwfM(source.totalCost) : "—"}</b>
              </article>
            </div>
            <div className="rr-card">
              <h3>Report A: owners paid but not moved</h3>
              <table className="rr-table">
                <thead>
                  <tr>
                    <th>Parcel</th>
                    <th>Location</th>
                    <th>Building</th>
                    <th>Status</th>
                  </tr>
                </thead>
                <tbody>
                  {sourceParcels
                    .filter(
                      (parcel) =>
                        parcelStatus[parcel.key] === "Paid, not moved",
                    )
                    .map((parcel) => (
                      <tr key={parcel.key}>
                        <td>{parcelCode(parcel)}</td>
                        <td>{parcel.district || "—"}</td>
                        <td>
                          {hasBuilding(parcel, source?.buildings)
                            ? "Yes"
                            : "No"}
                        </td>
                        <td>
                          <span className="rr-badge amber">
                            Paid, not moved
                          </span>
                        </td>
                      </tr>
                    ))}
                  {sourceParcels.every(
                    (parcel) => parcelStatus[parcel.key] !== "Paid, not moved",
                  ) && (
                    <tr>
                      <td colSpan={4}>
                        No parcel is marked paid but not moved. Set that status
                        in the parcel register.
                      </td>
                    </tr>
                  )}
                </tbody>
              </table>
            </div>
            <div className="rr-card">
              <h3>Report B: structures inside the reserve</h3>
              <table className="rr-table">
                <thead>
                  <tr>
                    <th>Parcel ID</th>
                    <th>Structure</th>
                    <th>Use</th>
                    <th>Affected %</th>
                    <th>Affected (m²)</th>
                    <th>Land Price</th>
                  </tr>
                </thead>
                <tbody>
                  {(source?.buildings || []).map((building) => {
                    const host = parcelForBuilding(
                      building,
                      sourceParcels || [],
                    );
  return (
                      <tr key={building.key}>
                        <td>{host ? parcelCode(host) : "—"}</td>
                        <td>{building.name || building.use || "Building"}</td>
                        <td>{building.use || "—"}</td>
                        <td>{buildingAffectedPct(building)}</td>
                        <td>
                          {formatNumber(building.sqm || 0, 4)}
                        </td>
                        <td>{formatRwf(building.cost)}</td>
                      </tr>
                    );
                  })}
                  {(source?.buildings || []).length === 0 && (
                    <tr>
                      <td colSpan={6}>{buildingGap(source)}</td>
                    </tr>
                  )}
                </tbody>
              </table>
            </div>
            <div className="rr-card">
              <h3>Report library</h3>
              <div className="rr-cards">
                <article>
                  <b>Reserve budget</b>
                  <p className="rr-hint">
                    Parcels, buildings, and the cost estimate.
                  </p>
                  <button
                    type="button"
                    className="rr-link"
                    onClick={exportCurrent}
                  >
                    Excel
                  </button>
                </article>
                <article>
                  <b>Alignment comparison</b>
                  <p className="rr-hint">Saved scenarios side by side.</p>
                  <button
                    type="button"
                    className="rr-link"
                    onClick={() => printComparison(options, note)}
                  >
                    PDF
                  </button>
                </article>
              </div>
            </div>
          </section>
        </>
      )}

      {section === "compare" && (
        <>
          <div className="rr-title">
            <div>
              <p>Road Reserve / Compare alignments</p>
              <h2>
                {projectId
                  ? `${(projects || []).find((project) => project.id === projectId)?.name || "Project"} · ${options.length} of 3 scenarios`
                  : "Compare alignments"}
              </h2>
        </div>
            <div className="rr-actions">
              <button type="button" onClick={() => onSection("budget")}>
                Add saved scenario
          </button>
              <button
                type="button"
                disabled={!options.length}
                onClick={exportCurrent}
              >
                Export Excel
              </button>
              <button
                type="button"
                className="print-pdf"
                disabled={options.length < 1}
                onClick={() => printComparison(options, note)}
              >
                <assetIcons.PdfLogo className="file-logo" aria-hidden="true" />
                <span>PDF</span>
              </button>
            </div>
          </div>
          <section className="rr-page">
            {!projectId && (
              <p className="rr-card rr-hint">
                Create a project first. Each project keeps up to 3 scenarios,
                and the comparison uses only those.
              </p>
            )}
            {projectId && options.length === 0 && (
              <p className="rr-card rr-hint">
                Draw a line on Map and budget, then choose Save scenario. This
                project can hold 3 scenarios.
              </p>
            )}
            {renameError ? (
              <p className="rr-card rr-proof-error">{renameError}</p>
            ) : null}
            <div className="rr-cards">
              {options.map((option, index) => (
                <article
                  key={option.id}
                  className={`rr-card${option.id === activeId ? " on" : ""}`}
                  onClick={() => onSelect(option.id)}
                >
                  <header>
                    <input
                      aria-label={`Name for alignment ${letterOf(index)}`}
                      defaultValue={option.label}
                      key={`${option.id}:${option.label}`}
                      onBlur={(event) => {
                        event.stopPropagation();
                        commitScenarioRename(
                          option.id,
                          event.target.value,
                          event.target,
                        );
                      }}
                      onKeyDown={(event) => {
                        if (event.key === "Enter") {
                          event.preventDefault();
                          event.currentTarget.blur();
                        }
                      }}
                      onClick={(event) => event.stopPropagation()}
                    />
                    {index === 0 && (
                      <span className="rr-badge teal">Baseline</span>
                    )}
                    {option.preferred && (
                      <span className="rr-badge teal">Preferred</span>
                    )}
                  </header>
                  <Sketch vertices={option.vertices} />
                  <footer>
                    <span>Total estimate</span>
                    <b>{rwfM(option.report?.totalCost)}</b>
                    <button
                      type="button"
                      className="rr-scenario-drop"
                      onClick={(event) => {
                        event.stopPropagation();
                        onRemoveOption(option.id);
                      }}
                    >
                      Delete
                    </button>
                  </footer>
                </article>
              ))}
            </div>
        {options.length > 0 && (
              <div className="rr-card">
                <h3>Side-by-side comparison</h3>
                <p className="rr-hint">
                  Lowest value in each row is marked. River crossings are not in
                  the current layers, so that row stays blank.
                </p>
                <table className="rr-table">
                  <thead>
                    <tr>
                      <th>Measure</th>
                      {options.map((option, index) => (
                        <th key={option.id}>
                          {letterOf(index)} · {option.label}
                        </th>
                      ))}
                    </tr>
                  </thead>
                  <tbody>
                    {COMPARE_ROWS.map(([key, label, digits]) => {
                      const values = options.map((option) =>
                        metric(option, key),
                      );
                      const numeric = values.filter((value) => value != null);
                      const best = numeric.length ? Math.min(...numeric) : null;
                      return (
                        <tr key={key}>
                          <th>{label}</th>
                          {values.map((value, index) => (
                            <td
                              key={options[index].id}
                              className={
                                value != null && value !== 0 && value === best
                                  ? "rr-best"
                                  : ""
                              }
                            >
                              {metricText(value, key, digits)}
                              {value != null && value !== 0 && value === best
                                ? " ▼ lowest"
                                : ""}
                            </td>
                          ))}
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              </div>
            )}
            {options.length > 0 && (
              <div className="rr-compare-bottom">
                <section className="rr-card">
                  <h3>Cost breakdown</h3>
                  <p className="rr-hint">
                    Millions of RWF. Bars share one scale.
                  </p>
                  <ul className="rr-bars">
                    {options.map((option, index) => {
                      const reportItem = option.report || {};
                      const maxTotal = Math.max(
                        1,
                        ...options.map((item) => item.report?.totalCost || 0),
                      );
                      const widthOf = (value) =>
                        `${Math.max(0, ((Number(value) || 0) / maxTotal) * 100)}%`;
                      return (
                        <li key={option.id}>
                          <span>
                            {letterOf(index)} · {option.label}
                          </span>
                          <div>
                            <i
                              style={{
                                width: widthOf(reportItem.landCost),
                                background: "#2563eb",
                              }}
                            />
                            <i
                              style={{
                                width: widthOf(reportItem.buildingCost),
                                background: "#ea580c",
                              }}
                            />
                            <i
                              style={{
                                width: widthOf(
                                  (reportItem.disturbance || 0) +
                                    (reportItem.contingency || 0),
                                ),
                                background: "#94a3b8",
                              }}
                            />
                          </div>
                          <b>{millions(reportItem.totalCost)}</b>
                        </li>
                      );
                    })}
                  </ul>
                  <p className="rr-key">
                    <i style={{ background: "#2563eb" }} />
                    Land <i style={{ background: "#ea580c" }} />
                    Buildings <i style={{ background: "#94a3b8" }} />
                    Allowances and contingency
                  </p>
                </section>
                <section className="rr-card rr-notes">
                  <h3>Decision notes</h3>
                  <textarea
                    rows={4}
                    value={note || ""}
                    placeholder="Reason for choosing an alignment"
                    onChange={(event) => onNote(event.target.value)}
                  />
                  <div className="rr-actions">
                    <button
                      type="button"
                      className="solid"
                      disabled={!activeId}
                      onClick={() => onPrefer(activeId)}
                    >
                      Select as preferred
                    </button>
                    <button
                      type="button"
                      disabled={!activeId}
                      onClick={() => {
                        onShowOption(activeId);
                        onSection("budget");
                      }}
                    >
                      Open in map
                    </button>
                  </div>
                </section>
              </div>
            )}
          </section>
        </>
      )}

      {section === "rates" && (
        <>
          <div className="rr-title">
            <div>
              <p>Road Reserve / Rates and rules</p>
              <h2>Rates, widths and workflow rules</h2>
            </div>
          </div>
          <section className="rr-page">
            <p className="rr-hint">
              Land is priced by location: each parcel uses the maximum reference
              price (RWF per m²) of the village it lies in, times the area
              inside the reserve.
            </p>
            <div className="rr-rates">
              <section className="rr-card">
                <h3>Land price</h3>
                <p className="rr-hint">
                  Village maximum from the land reference prices layer
                  (land_reference_prices). A parcel with no village price is
                  flagged and not costed.
                </p>
              </section>
              <section className="rr-card">
                <h3>Building rate</h3>
                <label className="stack">
                  Permanent structures, RWF per m²
                  <input
                    type="number"
                    min="0"
                    value={buildingRate}
                    onChange={(event) =>
                      onBuilding(Number(event.target.value) || 0)
                    }
                  />
                </label>
              </section>
              <section className="rr-card">
                <h3>Other cost items</h3>
                <label className="stack">
                  Disturbance allowance (%)
                  <input
                    type="number"
                    min="0"
                    max="100"
                    step="0.5"
                    value={disturbancePct}
                    onChange={(event) =>
                      onDisturbance(Number(event.target.value) || 0)
                    }
                  />
                </label>
                <label className="stack">
                  Contingency (%)
                  <input
                    type="number"
                    min="0"
                    max="100"
                    step="0.5"
                    value={contingencyPct}
                    onChange={(event) =>
                      onContingency(Number(event.target.value) || 0)
                    }
                  />
                </label>
              </section>
              <section className="rr-card">
                <h3>Default reserve width</h3>
                <p className="rr-hint">
                  The planner can still change it on Map and budget.
                </p>
                <label className="stack">
                  New road, total width (m)
                  <input
                    type="number"
                    min="1"
                    max="2000"
                    value={width}
                    onChange={(event) =>
                      onWidth(Number(event.target.value) || 1)
                    }
                  />
                </label>
              </section>
              <section className="rr-card wide">
                <h3>Data sources</h3>
                <table className="rr-table">
                  <tbody>
                    <tr>
                      <td>Road network and measures</td>
                      <td>Road Location Reference system</td>
                    </tr>
                    <tr>
                      <td>Parcels (cadastre)</td>
                      <td>Land administration services</td>
                    </tr>
                    <tr>
                      <td>Buildings</td>
                      <td>Kiyovu building footprints</td>
                    </tr>
                    <tr>
                      <td>Aerial photos</td>
                      <td>Satellite basemap</td>
                    </tr>
                  </tbody>
                </table>
              </section>
            </div>
          </section>
          </>
        )}
      {busy && (
        <div className="rr-loader" role="status" aria-live="polite">
          <div className="rr-loader-card">
            <span className="rr-spinner" aria-hidden="true" />
            <p>Analyzing the reserve</p>
              </div>
        </div>
      )}
      {saveOpen && (
        <div
          className="rr-modal-backdrop in"
          onMouseDown={() => setSaveOpen(false)}
        >
          <div
            className="rr-modal"
            role="dialog"
            aria-modal="true"
            aria-labelledby="rr-scenario-title"
            onMouseDown={(event) => event.stopPropagation()}
          >
            <h2 id="rr-scenario-title">Save this scenario</h2>
            {!projectId && (
              <p>
                Create a project first. This line stays on the map, and you can
                save it once the project exists.
              </p>
            )}
            {projectId && full && (
              <p>
                This project already has 3 scenarios. Choose one on the map, or
                create another project.
              </p>
            )}
            {projectId && !full && (
              <p>
                Name this alignment to keep it. You can save 3 scenarios in this
                project, then choose any one to show it on the map.
              </p>
            )}
            {report?.error && <p>{report.error}</p>}
            {projectId && !full && (
              <label>
                Scenario name
                <input
                  value={scenarioName}
                  autoFocus
                  placeholder="Scenario name"
                  aria-invalid={Boolean(scenarioNameError)}
                  onChange={(event) => {
                    setScenarioName(event.target.value);
                    if (scenarioNameError) setScenarioNameError("");
                  }}
                  onKeyDown={(event) => {
                    if (event.key === "Enter") confirmSave();
                    if (event.key === "Escape") setSaveOpen(false);
                  }}
                />
              </label>
            )}
            {scenarioNameError ? (
              <p className="rr-proof-error">{scenarioNameError}</p>
            ) : null}
            <div className="rr-actions">
              <button type="button" onClick={() => setSaveOpen(false)}>
                Not now
              </button>
              {!projectId && (
                <button
                  type="button"
                  className="solid"
                  onClick={() => {
                  setProjectNameError("");
                  setProjectOpen(true);
                }}
                >
                  Create project
                </button>
              )}
              {projectId && (
                <button
                  type="button"
                  className="solid"
                  disabled={full || busy || !ready || Boolean(report?.error)}
                  onClick={confirmSave}
                >
                  Save scenario
                </button>
              )}
              </div>
          </div>
        </div>
      )}
      <StatusProofModal
        open={Boolean(statusDraft)}
        parcelLabel={
          statusDraft
            ? parcelCode(
                sourceParcels.find(
                  (parcel) => parcel.key === statusDraft.key,
                ) || { key: statusDraft.key },
              )
            : ""
        }
        status={statusDraft?.status || ""}
        files={statusProofs}
        error={statusProofError}
        onFiles={onStatusProofFiles}
        onConfirm={confirmStatusChange}
        onClose={closeStatusProof}
      />
      <Modal
        open={projectOpen}
        name={projectDraft}
        note={projectId ? "The project that is open will be closed first." : ""}
        error={projectNameError}
        onName={(value) => {
          setProjectDraft(value);
          if (projectNameError) setProjectNameError("");
        }}
        onCreate={createProject}
        onClose={closeProject}
      />
    </>
  );
}
