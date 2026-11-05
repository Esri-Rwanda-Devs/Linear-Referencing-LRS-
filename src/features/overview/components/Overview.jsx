import { useEffect, useMemo, useState } from "react";
import { VALUE_COLORS } from "../../../config";
import { countOverviewArea, groupOverviewTypes, loadBoundaryChoices, loadBoundaryLevels, loadOverview } from "../../mapping/services/lrsService";
import "./Overview.css";

const numberText = (value) => (Number.isFinite(value) ? value.toLocaleString() : "—");

const POINT_RANK = ["Bridges", "Culverts", "Cameras", "Accidents", "Transformers", "LV Supports", "Point Assets", "KM Stones"];

function rankOf(title) {
  const at = POINT_RANK.findIndex((name) => name.toLowerCase() === String(title).toLowerCase());
  return at < 0 ? POINT_RANK.length : at;
}

function plural(label) {
  const text = String(label || "").toLowerCase();
  return text.endsWith("s") ? text : `${text}s`;
}

function typeColor(layerId, name, fallback) {
  const colors = VALUE_COLORS[layerId]?.colors || {};
  const key = String(name).toLowerCase().replace(/[_-]+/g, " ").replace(/\s+/g, " ").trim();
  return colors[key] || fallback || "#94a3b8";
}

function Bars({ items }) {
  const max = Math.max(1, ...items.map((item) => item.count));
  if (!items.length) return null;
  return (
    <ul className="ov-bars">
      {items.map((item) => (
        <li key={item.name}>
          <span title={item.name}>{item.name}</span>
          <i style={{ width: `${Math.max(6, (item.count / max) * 100)}%`, background: item.color }} />
          <b>{numberText(item.count)}</b>
        </li>
      ))}
    </ul>
  );
}

function CountCard({ item, count, caption, loading }) {
  return (
    <article className="ov-asset ov-compact">
      <header>
        {item.swatch && <i style={{ background: item.swatch }} />}
        <span>{item.title}</span>
      </header>
      <strong>{loading ? "…" : numberText(count)}</strong>
      <em>{caption}</em>
      {item.error && <p className="ov-empty">{item.error}</p>}
    </article>
  );
}

export default function Overview({ query = "", onQuery }) {
  const [rows, setRows] = useState([]);
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(true);
  const [scope, setScope] = useState("all");
  const [levels, setLevels] = useState([]);
  const [choices, setChoices] = useState({});
  const [selected, setSelected] = useState({});
  const [boundaryNote, setBoundaryNote] = useState("");
  const [loadingKey, setLoadingKey] = useState("");
  const [areaCounts, setAreaCounts] = useState(null);
  const [areaLoading, setAreaLoading] = useState(false);
  const [typeGroups, setTypeGroups] = useState(null);

  useEffect(() => {
    let dead = false;
    loadOverview()
      .then((result) => {
        if (!dead) setRows(result || []);
      })
      .catch((reason) => {
        if (!dead) setError(reason.message || "Could not load the overview.");
      })
      .finally(() => {
        if (!dead) setLoading(false);
      });
    loadBoundaryLevels()
      .then(async (found) => {
        if (dead) return;
        setLevels(found);
        if (!found.length) {
          setBoundaryNote("The boundary layer has no province field.");
          return;
        }
        setLoadingKey(found[0].id);
        const names = await loadBoundaryChoices(found[0], []);
        if (dead) return;
        setChoices({ [found[0].id]: names });
      })
      .catch((reason) => {
        if (!dead) setBoundaryNote(reason.message || "Could not load administrative boundaries.");
      })
      .finally(() => {
        if (!dead) setLoadingKey("");
      });
    return () => {
      dead = true;
    };
  }, []);

  const active = [...levels].reverse().find((level) => selected[level.id]);

  useEffect(() => {
    if (!active) {
      setAreaCounts(null);
      setAreaLoading(false);
      return undefined;
    }
    let dead = false;
    setAreaLoading(true);
    countOverviewArea(active.id, selected[active.id])
      .then((result) => {
        if (dead) return;
        const next = {};
        result.forEach((item) => {
          next[item.id] = item.count;
        });
        setAreaCounts(next);
      })
      .catch(() => {
        if (!dead) setAreaCounts({});
      })
      .finally(() => {
        if (!dead) setAreaLoading(false);
      });
    return () => {
      dead = true;
    };
  }, [active, selected]);

  useEffect(() => {
    if (!active) {
      setTypeGroups(null);
      return undefined;
    }
    let dead = false;
    groupOverviewTypes(active.id, selected[active.id])
      .then((result) => {
        if (dead) return;
        const next = {};
        result.forEach((item) => {
          next[item.id] = item.groups;
        });
        setTypeGroups(next);
      })
      .catch(() => {
        if (!dead) setTypeGroups({});
      });
    return () => {
      dead = true;
    };
  }, [active, selected]);

  const choose = (index, value) => {
    const nextSelected = {};
    levels.slice(0, index).forEach((level) => {
      nextSelected[level.id] = selected[level.id];
    });
    if (value) nextSelected[levels[index].id] = value;
    setSelected(nextSelected);
    const nextChoices = {};
    levels.slice(0, index + 1).forEach((level) => {
      nextChoices[level.id] = choices[level.id] || [];
    });
    setChoices(nextChoices);
    const child = levels[index + 1];
    if (!value || !child) return;
    setLoadingKey(child.id);
    const parents = levels.slice(0, index + 1).map((level) => ({
      field: level.field,
      type: level.type,
      value: nextSelected[level.id],
    }));
    loadBoundaryChoices(child, parents)
      .then((names) => setChoices((current) => ({ ...current, [child.id]: names })))
      .catch((reason) => setBoundaryNote(reason.message || "Could not load the next boundary."))
      .finally(() => setLoadingKey(""));
  };

  const roads = rows.find((item) => item.route);
  const points = useMemo(
    () => rows.filter((item) => item.kind === "point").sort((a, b) => rankOf(a.title) - rankOf(b.title) || a.title.localeCompare(b.title)),
    [rows],
  );
  const lines = useMemo(
    () => rows.filter((item) => item.kind === "line" && !item.route),
    [rows],
  );
  const needle = query.trim().toLowerCase();
  const matches = (item) => !needle || item.title.toLowerCase().includes(needle) || (item.groups || []).some((group) => group.name.toLowerCase().includes(needle));
  const shownRoads = scope !== "line" && roads && matches(roads);
  const shownPoints = scope === "line" ? [] : points.filter(matches);
  const shownLines = scope === "point" ? [] : lines.filter(matches);
  const place = active ? selected[active.id] : "";

  const figure = (item) => {
    if (!active) return item.count;
    if (!areaCounts || !Object.prototype.hasOwnProperty.call(areaCounts, item.id)) return null;
    return areaCounts[item.id];
  };

  return (
    <section className="overview">
      <header className="ov-head">
        <div>
          <p>Overview</p>
          <h2>Network statistics</h2>
        </div>
        <span>{loading ? "Counting layers…" : error || boundaryNote || (areaLoading ? `Counting ${place}…` : "Choose a province to open the next boundary.")}</span>
      </header>
      <div className="ov-toolbar">
        <div className="ov-filter">
          <span>Show</span>
          <div>
            {[
              ["all", "All"],
              ["point", "Point assets"],
              ["line", "Line events"],
            ].map(([id, label]) => (
              <button key={id} type="button" className={scope === id ? "on" : ""} onClick={() => setScope(id)}>
                {label}
              </button>
            ))}
          </div>
        </div>
        <label className="ov-filter ov-search">
          <span>Search</span>
          <input
            value={query}
            placeholder="Bridges, cameras, paved, divided…"
            onChange={(event) => onQuery?.(event.target.value)}
          />
        </label>
        <div className="ov-cascade">
          {levels.map((level, index) => {
            const previous = levels[index - 1];
            const enabled = index === 0 || Boolean(previous && selected[previous.id]);
            return (
              <label key={level.id} className={enabled ? "" : "is-off"}>
                <span>{level.label}</span>
                <select
                  value={selected[level.id] || ""}
                  disabled={!enabled}
                  onChange={(event) => choose(index, event.target.value)}
                >
                  <option value="">{loadingKey === level.id ? "Loading…" : `All ${plural(level.label)}`}</option>
                  {(choices[level.id] || []).map((name) => (
                    <option key={name} value={name}>{name}</option>
                  ))}
                </select>
              </label>
            );
          })}
        </div>
      </div>
      <div className="ov-board">
        {(shownRoads || shownPoints.length > 0) && (
          <section>
            <h3>Assets</h3>
            <div className="ov-small">
              {shownRoads && (
                <CountCard
                  item={{ ...roads, title: "Roads", swatch: roads.swatch }}
                  count={figure(roads) == null && active ? roads.count : figure(roads)}
                  caption={figure(roads) == null && active ? "National total" : (place || "Total roads")}
                  loading={areaLoading && Boolean(active)}
                />
              )}
              {shownPoints.map((item) => {
                const count = figure(item);
                const missing = Boolean(active) && areaCounts && count == null;
                return (
                  <CountCard
                    key={item.id}
                    item={item}
                    count={missing ? item.count : count}
                    caption={missing ? "No boundary field" : (place || "Total")}
                    loading={areaLoading && Boolean(active)}
                  />
                );
              })}
            </div>
          </section>
        )}
        {shownLines.length > 0 && (
          <section>
            <h3>By type</h3>
            <div className="ov-types">
              {shownLines.map((item) => {
                const count = figure(item);
                const missing = Boolean(active) && areaCounts && count == null;
                const source = typeGroups && Object.prototype.hasOwnProperty.call(typeGroups, item.id) && typeGroups[item.id] != null
                  ? typeGroups[item.id]
                  : (item.groups || []);
                const groups = source.map((group) => ({ ...group, color: typeColor(item.id, group.name, item.swatch) }));
                return (
                  <article key={item.id} className="ov-asset">
                    <header>
                      <i style={{ background: item.swatch }} />
                      <span>{item.title}</span>
                    </header>
                    <strong>{areaLoading && active ? "…" : numberText(missing ? item.count : count)}</strong>
                    <em>{missing ? "National types" : (place || "By type")}</em>
                    {item.error && <p className="ov-empty">{item.error}</p>}
                    {missing && <p className="ov-empty">This layer has no {active.label.toLowerCase()} field.</p>}
                    <Bars items={groups} />
                  </article>
                );
              })}
            </div>
          </section>
        )}
        {!loading && !shownRoads && shownPoints.length === 0 && shownLines.length === 0 && (
          <p className="ov-empty">Nothing matches that filter.</p>
        )}
      </div>
    </section>
  );
}
