import { useEffect, useState } from "react";
import { LRS_LAYER_DEFS, VALUE_COLORS } from "../config";
import { addFeature, adminAt, layerFields, lineMergePlan, loadFeature, mergeMatchingLine, updateFeature } from "../lrs/lrsService";
import RoutePicker from "./RoutePicker";
import { ChartSymbol } from "./StripChart";

const isFrom = (name) => /^(frommeasure|from_measure|fromm|beginmeasure)$/i.test(name);
const isTo = (name) => /^(tomeasure|to_measure|tom|endmeasure)$/i.test(name);
const isRouteId = (name) => /route_?id$/i.test(name);
const isRouteName = (name) => /route_?name$/i.test(name);
const isLocError = (name) => /^loc_?error$/i.test(name);
const isMeasure = (name) => name.toLowerCase() === "measure";
const isEventId = (name) => /^event_?id$/i.test(name);
const isProvince = (name) => /^province(_name)?$/i.test(name);
const isDistrict = (name) => /^district(_name)?$/i.test(name);
const isSector = (name) => /^sector(_name)?$/i.test(name);
const isCell = (name) => /^cell(_name)?$/i.test(name);
const isVillage = (name) => /^village(_name)?$/i.test(name);

function placeValue(field, text) {
  if (!text) return "";
  const codes = field.domain?.codedValues || [];
  const match = codes.find((item) => String(item.name).toLowerCase() === text.toLowerCase() || String(item.code).toLowerCase() === text.toLowerCase());
  return match ? String(match.code) : text;
}

function geometryPoint(geometry) {
  if (!geometry) return null;
  if (geometry.x != null && geometry.y != null) return [geometry.x, geometry.y];
  const path = geometry.paths?.[0];
  if (!path?.length) return null;
  return path[Math.floor((path.length - 1) / 2)];
}

function applyPlace(fields, values, place, onlyEmpty) {
  if (!place) return;
  fields.forEach((field) => {
    if (onlyEmpty && values[field.name]) return;
    const text = isProvince(field.name) ? place.province
      : isDistrict(field.name) ? place.district
        : isSector(field.name) ? place.sector
          : isCell(field.name) ? place.cell
            : isVillage(field.name) ? place.village
              : "";
    if (text) values[field.name] = placeValue(field, text);
  });
}

/** Filled from the route click, so they stay off the form. */
function isAutomatic(field) {
  const name = field.name.toLowerCase();
  if (field.type === "esriFieldTypeDate" || /date/.test(name)) return true;
  if (/shape/.test(name)) return true;
  return isEventId(name) || isRouteId(name) || isRouteName(name) || isLocError(name) || isMeasure(name) || isFrom(name) || isTo(name);
}

function locErrorValue(field) {
  const codes = field.domain?.codedValues || [];
  const match = codes.find((item) => /no\s*error/i.test(`${item.name} ${item.code}`));
  return match ? String(match.code) : "NO ERROR";
}

function newEventId() {
  const id = crypto.randomUUID().toUpperCase();
  return `{${id}}`;
}

function toInput(field, raw) {
  if (raw === null || raw === undefined) return "";
  if (field.type === "esriFieldTypeDate") {
    const ms = Number(raw);
    if (!Number.isFinite(ms) || ms <= 0) return "";
    const date = new Date(ms);
    return Number.isNaN(date.getTime()) ? "" : date.toISOString().slice(0, 10);
  }
  return String(raw);
}

function fromInput(field, text) {
  if (text === "" || text === undefined) return null;
  if (field.type === "esriFieldTypeDate") {
    const ms = Date.parse(text);
    return Number.isFinite(ms) ? ms : null;
  }
  if (/Integer|Small/i.test(field.type || "")) {
    const parsed = Number.parseInt(text, 10);
    return Number.isFinite(parsed) ? parsed : null;
  }
  if (/Double|Single/i.test(field.type || "")) {
    const parsed = Number(text);
    return Number.isFinite(parsed) ? parsed : null;
  }
  const codes = field.domain?.codedValues;
  if (codes?.length && codes.every((item) => typeof item.code === "number")) {
    const parsed = Number(text);
    return Number.isFinite(parsed) ? parsed : text;
  }
  return text;
}

function FieldInput({ field, value, onChange }) {
  const disabled = field.editable === false;
  const coded = field.domain?.codedValues;
  if (coded?.length) {
    return (
      <select value={value} disabled={disabled} onChange={(event) => onChange(event.target.value)}>
        <option value="">—</option>
        {coded.map((item) => (
          <option key={String(item.code)} value={String(item.code)}>{item.name}</option>
        ))}
      </select>
    );
  }
  if (field.type === "esriFieldTypeDate") {
    return <input type="date" value={value} disabled={disabled} onChange={(event) => onChange(event.target.value)} />;
  }
  if (/Integer|Double|Single|Small/i.test(field.type || "")) {
    return <input type="number" step="any" value={value} disabled={disabled} onChange={(event) => onChange(event.target.value)} />;
  }
  if ((field.length || 0) > 80 || /detail|comment|desc/i.test(field.name)) {
    return <textarea rows={2} value={value} maxLength={field.length || undefined} disabled={disabled} onChange={(event) => onChange(event.target.value)} />;
  }
  return <input type="text" value={value} maxLength={field.length || undefined} disabled={disabled} onChange={(event) => onChange(event.target.value)} />;
}

export function EditorSidebar({ hiddenLayerIds, onToggle, placingId, lineAnchor, catalog, activeRouteId, activeRouteName, roadReady, onSelectRoute, notice, onBeginAdd, onCancelAdd }) {
  return (
    <aside className="edit-side">
      <h2>Editing</h2>
      <label className="editor-route">
        <span>Route</span>
        <RoutePicker catalog={catalog} value={activeRouteId} placeholder="Select a route…" onChange={onSelectRoute} disabled={placingId != null} />
      </label>
      {activeRouteId && (
        <p className="editor-note">
          {roadReady ? `${activeRouteId} is active${activeRouteName ? ` · ${activeRouteName}` : ""}.` : `Reading ${activeRouteId}…`}
        </p>
      )}
      <p>Select the route, then tick a layer to show it on that road only. Other roads stay faded while you edit or add. Cancel Add, or leave Edit, to choose another route. A click on an existing line opens it for edit.</p>
      {notice && <p className="editor-warn">{notice}</p>}
      <ul className="editor-layers">
        {LRS_LAYER_DEFS.map((layer) => {
          const hidden = hiddenLayerIds.includes(layer.id);
          return (
            <li key={layer.id}>
              <label>
                <input type="checkbox" checked={!hidden} onChange={() => onToggle(layer.id)} />
                <svg width="14" height="14" viewBox="0 0 14 14">
                  <ChartSymbol shape={layer.kind === "point" ? layer.shape : "bar"} color={layer.swatch} x={7} y={7} size={0.7} />
                </svg>
                <span>{layer.title}</span>
              </label>
              {!layer.route && !layer.readOnly && (
                <button type="button" className={placingId === layer.id ? "on" : ""} onClick={() => (placingId === layer.id ? onCancelAdd() : onBeginAdd(layer))}>
                  {placingId === layer.id ? "Cancel" : "Add"}
                </button>
              )}
            </li>
          );
        })}
      </ul>
      {placingId != null && (
        <p className="editor-note">
          {!activeRouteId
            ? "Select a route above, or click it on the map."
            : !roadReady
              ? `Reading ${activeRouteId}…`
              : lineAnchor
                ? `From ${lineAnchor.measure.toFixed(3)} km on ${activeRouteId}. Move along the road, then click the end.`
                : LRS_LAYER_DEFS.find((layer) => layer.id === placingId)?.kind === "point"
                  ? `${activeRouteId} is active. Click it to place the point.`
                  : `${activeRouteId} is active. Click your own start (including where another ${LRS_LAYER_DEFS.find((layer) => layer.id === placingId)?.title || "line"} ends), then click the end.`}
        </p>
      )}
    </aside>
  );
}

function typeFieldOf(fields, layerId) {
  const rule = VALUE_COLORS[layerId];
  if (!rule) return null;
  const wanted = rule.field.toLowerCase().replace(/[^a-z0-9]/g, "");
  return fields.find((field) => field.name.toLowerCase().replace(/[^a-z0-9]/g, "") === wanted) || null;
}

export function EditorPopup({ selection, route, events = [], onClear, onSaved }) {
  const [fields, setFields] = useState([]);
  const [oidField, setOidField] = useState("OBJECTID");
  const [values, setValues] = useState({});
  const [oid, setOid] = useState(null);
  const [geometry, setGeometry] = useState(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const def = selection ? LRS_LAYER_DEFS.find((layer) => layer.id === selection.layerId) : null;

  useEffect(() => {
    if (!selection) return undefined;
    const layer = LRS_LAYER_DEFS.find((item) => item.id === selection.layerId);
    if (!layer) return undefined;
    let cancel = false;
    setBusy(true);
    setError("");
    layerFields(layer).then(async (schema) => {
      if (cancel) return;
      setFields(schema.fields);
      setOidField(schema.oidField);
      if (selection.oid != null) {
        const feature = await loadFeature(layer, selection.oid);
        if (cancel) return;
        if (!feature) {
          setError("That record could not be read.");
          return;
        }
        const next = {};
        schema.fields.forEach((field) => { next[field.name] = toInput(field, feature.attributes?.[field.name]); });
        const here = geometryPoint(feature.geometry);
        const place = here ? await adminAt(here[0], here[1]).catch(() => null) : null;
        if (cancel) return;
        applyPlace(schema.fields, next, place, true);
        setValues(next);
        setOid(feature.attributes?.[schema.oidField] ?? selection.oid);
        setGeometry(feature.geometry || null);
        return;
      }
      const next = {};
      schema.fields.forEach((field) => { next[field.name] = ""; });
      const measureText = (value) => (Number.isFinite(value) ? String(Number(value.toFixed(3))) : "");
      schema.fields.forEach((field) => {
        if (isRouteId(field.name) && selection.routeId) next[field.name] = selection.routeId;
        if (isRouteName(field.name) && selection.routeName) next[field.name] = selection.routeName;
        if (isLocError(field.name)) next[field.name] = locErrorValue(field);
        if (isMeasure(field.name)) next[field.name] = measureText(selection.measure);
        if (isFrom(field.name)) next[field.name] = measureText(selection.from);
        if (isTo(field.name)) next[field.name] = measureText(selection.to);
        if (isEventId(field.name)) next[field.name] = newEventId();
      });
      const here = geometryPoint(selection.geometry);
      const place = here ? await adminAt(here[0], here[1]).catch(() => null) : null;
      if (cancel) return;
      applyPlace(schema.fields, next, place, false);
      setValues(next);
      setOid(null);
      setGeometry(selection.geometry || null);
    }).catch((err) => {
      if (!cancel) setError(err.message || "The table could not be opened.");
    }).finally(() => {
      if (!cancel) setBusy(false);
    });
    return () => { cancel = true; };
  }, [selection]);

  const save = async () => {
    if (!def) return;
    setBusy(true);
    setError("");
    try {
      const attributes = {};
      fields.forEach((field) => {
        if (field.editable === false) return;
        const value = fromInput(field, values[field.name]);
        if (value === null || value === "") return;
        attributes[field.name] = value;
      });
      let merged = null;
      if (oid != null) {
        attributes[oidField] = oid;
        await updateFeature(def, attributes);
      } else {
        const typeField = typeFieldOf(fields, def.id);
        if (def.kind === "line" && selection?.from != null && selection?.to != null) {
          const fromField = fields.find((field) => isFrom(field.name));
          const toField = fields.find((field) => isTo(field.name));
          if (fromField) attributes[fromField.name] = Number(Number(selection.from).toFixed(3));
          if (toField) attributes[toField.name] = Number(Number(selection.to).toFixed(3));
        }
        merged = def.kind === "line"
          ? await mergeMatchingLine(def, attributes, route, events, typeField)
          : null;
        if (!merged) {
          const geom = geometry || selection?.geometry;
          if (!geom) throw new Error("Click the route so the shape can be saved.");
          await addFeature(def, attributes, geom);
        }
      }
      await onSaved?.(def.id);
      onClear?.(merged ? {
        sidebar: `Same ${merged.label} ${def.title} joined into one segment, ${merged.from.toFixed(3)}–${merged.to.toFixed(3)} km.`,
        map: `Same ${merged.label} ${def.title}.\nJoined into one segment.`,
      } : null);
    } catch (err) {
      console.error("[LRS] Save failed", { layer: def.title, id: def.id, error: err });
      setError(err.message || "The edit was rejected.");
    } finally {
      setBusy(false);
    }
  };

  if (!def) return null;
  const typeField = typeFieldOf(fields, def.id);
  const mergePlan = oid == null && typeField && selection?.from != null && selection?.to != null
    ? lineMergePlan(def, { [typeField.name]: values[typeField.name] }, events, typeField, selection.from, selection.to)
    : null;

  return (
    <form className="map-popup editor-form" onSubmit={(event) => { event.preventDefault(); save(); }}>
          <div className="analysis-head">
            <b>{oid != null ? `Edit ${def.title}` : `New ${def.title}`}</b>
            <button type="button" className="link" onClick={onClear}>Close</button>
          </div>
          {selection?.notice && <p className="editor-warn">{selection.notice}</p>}
          {mergePlan && (
            <p className="editor-note">
              This matches an existing {def.title} ({mergePlan.label}). Save joins them into one segment, {mergePlan.from.toFixed(3)}–{mergePlan.to.toFixed(3)} km.
            </p>
          )}
          {selection?.routeId && (
            <p className="editor-note">
              {selection.measure != null
                ? `Route ${selection.routeId} · measure ${Number(selection.measure).toFixed(3)} km. The point and event id are saved with the shape.`
                : `Route ${selection.routeId} · ${Number(selection.from).toFixed(3)} – ${Number(selection.to).toFixed(3)} km. The line and event id are saved with the shape.`}
            </p>
          )}
          {busy && !fields.length ? <p className="editor-note">Reading the table…</p> : fields.filter((field) => !isAutomatic(field)).map((field) => (
            <label key={field.name}>
              <span>{field.alias || field.name}</span>
              <FieldInput field={field} value={values[field.name] ?? ""} onChange={(value) => setValues((current) => ({ ...current, [field.name]: value }))} />
            </label>
          ))}
          {error && <p className="editor-error">{error}</p>}
      <div className="segment-actions">
        <button type="submit" disabled={busy || !fields.length}>{busy ? "Saving…" : "Save"}</button>
      </div>
    </form>
  );
}
