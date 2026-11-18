import { useEffect, useMemo, useState } from "react";
import { assetIcons } from "../../../assets";
import { LRS_LAYER_DEFS, VALUE_COLORS } from "../../../config";
import { iconUrl } from "../../mapping/icons";
import {
  countOverviewArea,
  groupOverviewTypes,
  loadBoundaryChoices,
  loadBoundaryLevels,
  loadOverview,
} from "../../mapping/services/lrsService";
import OverviewMap from "./OverviewMap";
import "./Overview.css";

const numberText = (value) =>
  Number.isFinite(value) ? value.toLocaleString() : "—";

const PLACEHOLDER_ROWS = LRS_LAYER_DEFS.filter(
  (def) => def.kind === "point" || def.kind === "line",
).map((def) => ({
  id: def.id,
  title: def.title,
  kind: def.kind,
  group: def.group,
  swatch: def.swatch,
  shape: def.shape,
  route: Boolean(def.route),
  count: null,
  groups: [],
  error: "",
}));

const POINT_RANK = [
  "Bridges",
  "Culverts",
  "Cameras",
  "Traffic",
  "Accidents",
  "Transformers",
  "LV Supports",
  "MV Supports",
  "Point Assets",
  "KM Stones",
];

function rankOf(title) {
  const at = POINT_RANK.findIndex(
    (name) => name.toLowerCase() === String(title).toLowerCase(),
  );
  return at < 0 ? POINT_RANK.length : at;
}

function plural(label) {
  const text = String(label || "").toLowerCase();
  return text.endsWith("s") ? text : `${text}s`;
}

function typeColor(layerId, name, fallback) {
  const colors = VALUE_COLORS[layerId]?.colors || {};
  const key = String(name)
    .toLowerCase()
    .replace(/[_-]+/g, " ")
    .replace(/\s+/g, " ")
    .trim();
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
          <i
            style={{
              width: `${Math.max(6, (item.count / max) * 100)}%`,
              background: item.color,
            }}
          />
          <b>{numberText(item.count)}</b>
        </li>
      ))}
    </ul>
  );
}

const kmText = (value) => {
  if (!Number.isFinite(value)) return "—";
  const digits = value > 0 && value < 10 ? 2 : 1;
  return value.toLocaleString(undefined, { maximumFractionDigits: digits });
};

function niceStep(max) {
  const raw = max / 4;
  const power = 10 ** Math.floor(Math.log10(raw || 1));
  const scaled = raw / power;
  return (scaled <= 1 ? 1 : scaled <= 2 ? 2 : scaled <= 5 ? 5 : 10) * power;
}

function LengthChart({ title, items, loading, mark }) {
  const measured = items.filter((item) => Number.isFinite(item.km));
  const max = Math.max(0, ...measured.map((item) => item.km));
  const step = niceStep(max || 1);
  const top = Math.max(step, Math.ceil(max / step) * step);
  const ticks = [];
  for (let value = top; value >= 0; value -= step) ticks.push(value);
  const total = measured.reduce((sum, item) => sum + item.km, 0);
  return (
    <article className="ov-asset ov-chart">
      <header>
        <span>
          <CardMark item={mark} />
          Length per {title}
        </span>
        <b>{measured.length ? `${kmText(total)} km` : ""}</b>
      </header>
      {loading && (
        <div className="ov-chart-loading" role="status">
          <span className="ov-spinner" aria-hidden="true" />
          <span>Loading lengths…</span>
        </div>
      )}
      {!loading && measured.length > 0 && (
        <div className="ov-chart-body">
          <div className="ov-chart-axis">
            {ticks.map((value) => (
              <span key={value}>{kmText(value)}</span>
            ))}
          </div>
          <div
            className="ov-chart-plot"
            style={{ "--ov-ticks": ticks.length - 1 }}
          >
            {measured.map((item) => (
              <div
                key={item.name}
                className="ov-col"
                style={{ "--ov-bar": `${Math.max(1, (item.km / top) * 100)}%` }}
                title={`${item.name}: ${kmText(item.km)} km · ${numberText(item.count)} events`}
              >
                <b>{kmText(item.km)}</b>
                <i style={{ background: item.color }} />
              </div>
            ))}
          </div>
          <div />
          <div className="ov-chart-labels">
            {measured.map((item) => (
              <span key={item.name} title={item.name}>
                {item.name}
              </span>
            ))}
          </div>
        </div>
      )}
      {!loading && !measured.length && (
        <p className="ov-empty">No length data for this filter yet.</p>
      )}
    </article>
  );
}

function CardMark({ item }) {
  const href = iconUrl(item?.shape, item?.swatch);
  if (href) return <img className="ov-icon" src={href} alt="" />;
  if (item?.route) {
    const RouteIcon = assetIcons.GiRoad;
    return <RouteIcon className="ov-icon" style={{ color: item.swatch }} />;
  }
  return <i style={{ background: item?.swatch }} />;
}

function CountCard({ item, count, loading }) {
  return (
    <article className="ov-asset ov-compact">
      <header>
        <CardMark item={item} />
        <span>{item.title}</span>
      </header>
      <strong>{loading ? "…" : numberText(count)}</strong>
    </article>
  );
}

export default function Overview({ query = "", onQuery }) {
  const [rows, setRows] = useState(PLACEHOLDER_ROWS);
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
  const [muted, setMuted] = useState([]);

  useEffect(() => {
    let dead = false;
    loadOverview()
      .then((result) => {
        if (dead) return;
        const byId = new Map((result || []).map((item) => [item.id, item]));
        // Keep every layer card visible from the start; fill in live counts.
        setRows(
          PLACEHOLDER_ROWS.map((placeholder) => {
            const live = byId.get(placeholder.id);
            return live ? { ...placeholder, ...live } : placeholder;
          }),
        );
      })
      .catch((reason) => {
        if (!dead) {
          setError(reason.message || "Could not load the overview.");
          setRows(PLACEHOLDER_ROWS);
        }
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
        if (!dead)
          setBoundaryNote(
            reason.message || "Could not load administrative boundaries.",
          );
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
    setTypeGroups(null);
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
      .then((names) =>
        setChoices((current) => ({ ...current, [child.id]: names })),
      )
      .catch((reason) =>
        setBoundaryNote(reason.message || "Could not load the next boundary."),
      )
      .finally(() => setLoadingKey(""));
  };

  const roads = rows.find((item) => item.route);
  const points = useMemo(
    () =>
      rows
        .filter((item) => item.kind === "point")
        .sort(
          (a, b) =>
            rankOf(a.title) - rankOf(b.title) || a.title.localeCompare(b.title),
        ),
    [rows],
  );
  const lines = useMemo(
    () => rows.filter((item) => item.kind === "line" && !item.route),
    [rows],
  );
  const needle = query.trim().toLowerCase();
  const matches = (item) =>
    !needle ||
    item.title.toLowerCase().includes(needle) ||
    (item.groups || []).some((group) =>
      group.name.toLowerCase().includes(needle),
    );
  const shownRoads = scope !== "line" && roads && matches(roads);
  const shownPoints = scope === "line" ? [] : points.filter(matches);
  const shownLines = scope === "point" ? [] : lines.filter(matches);
  const place = active ? selected[active.id] : "";
  const boundary = active
    ? {
        id: active.id,
        name: selected[active.id],
        field: active.field,
        type: active.type,
        label: active.label,
      }
    : null;

  const figure = (item) => {
    if (!active) return item.count;
    if (
      !areaCounts ||
      !Object.prototype.hasOwnProperty.call(areaCounts, item.id)
    )
      return null;
    return areaCounts[item.id];
  };

  const typesPending = Boolean(active) && typeGroups == null;
  const lineCards = shownLines.map((item) => {
    const count = figure(item);
    const missing = Boolean(active) && areaCounts && count == null;
    const scoped =
      typeGroups &&
      Object.prototype.hasOwnProperty.call(typeGroups, item.id) &&
      typeGroups[item.id] != null;
    const source = scoped ? typeGroups[item.id] : item.groups || [];
    const titleHit = !needle || item.title.toLowerCase().includes(needle);
    const groups = source
      .filter((group) => titleHit || group.name.toLowerCase().includes(needle))
      .map((group) => ({
        ...group,
        color: typeColor(item.id, group.name, item.swatch),
      }));
    return {
      item,
      count,
      missing,
      groups,
      national: Boolean(active) && !scoped,
    };
  });

  return (
    <section className="overview">
      <header className="ov-head">
       
       
      </header>
      <div className="ov-toolbar">
        <label className="ov-filter ov-scope">
          <span>Show</span>
          <select
            value={scope}
            aria-label="Show assets"
            onChange={(event) => setScope(event.target.value)}
          >
            <option value="all">All</option>
            <option value="point">Point assets</option>
            <option value="line">Line events</option>
          </select>
        </label>
        <label className="ov-filter ov-search">
          <span>Search</span>
          <input
            value={query}
            placeholder="Search…"
            onChange={(event) => onQuery?.(event.target.value)}
          />
        </label>
        {levels.map((level, index) => {
          const previous = levels[index - 1];
          const enabled =
            index === 0 || Boolean(previous && selected[previous.id]);
          return (
            <label
              key={level.id}
              className={`ov-filter ov-bound${enabled ? "" : " is-off"}`}
            >
              <span>{level.label}</span>
              <select
                value={selected[level.id] || ""}
                disabled={!enabled}
                onChange={(event) => choose(index, event.target.value)}
              >
                <option value="">
                  {loadingKey === level.id
                    ? "Loading…"
                    : `All ${plural(level.label)}`}
                </option>
                {(choices[level.id] || []).map((name) => (
                  <option key={name} value={name}>
                    {name}
                  </option>
                ))}
              </select>
            </label>
          );
        })}
      </div>
      <div className="ov-board">
        {(shownRoads || shownPoints.length > 0) && (
          <section className="ov-points">
            <h3>Point assets{place ? ` · ${place}` : ""}</h3>
            <div className="ov-small">
              {shownRoads && (
                <CountCard
                  item={{ ...roads, title: "Roads", swatch: roads.swatch }}
                  count={
                    figure(roads) == null && active
                      ? roads.count
                      : figure(roads)
                  }
                  loading={loading || (areaLoading && Boolean(active))}
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
                    loading={loading || (areaLoading && Boolean(active))}
                  />
                );
              })}
            </div>
          </section>
        )}
        <div className="ov-main">
          <section className="ov-map-section">
            <h3>Asset map{place ? ` · ${place}` : ""}</h3>
            <OverviewMap
              scope={scope}
              query={query}
              rows={rows}
              boundary={boundary}
              muted={muted}
              onToggle={(id) =>
                setMuted((current) =>
                  current.includes(id)
                    ? current.filter((item) => item !== id)
                    : [...current, id],
                )
              }
            />
          </section>
          <section className="ov-lines">
            <h3>Length by type (km){place ? ` · ${place}` : ""}</h3>
            <div className="ov-charts">
              {(lineCards.length
                ? lineCards
                : PLACEHOLDER_ROWS.filter(
                    (item) => item.kind === "line" && !item.route,
                  ).map((item) => ({
                    item,
                    groups: [],
                    national: false,
                  }))
              ).map(({ item, groups }) => (
                <LengthChart
                  key={item.id}
                  title={item.title}
                  mark={item}
                  items={groups}
                  loading={loading || typesPending}
                />
              ))}
            </div>
          </section>
        </div>
        {!loading &&
          !shownRoads &&
          shownPoints.length === 0 &&
          shownLines.length === 0 && (
            <p className="ov-empty">Nothing matches that filter.</p>
          )}
      </div>
      {/* {(loading || areaLoading) && (
        <div className="ov-loader" role="status" aria-live="polite">
          <div className="ov-loader-card">
            <span className="ov-spinner" aria-hidden="true" />
            <p>{areaLoading ? `Loading ${place || "area"}…` : "Loading overview data…"}</p>
            <span>
              {error
                ? "Some layers are still catching up."
                : "Cards, map, and graphs stay visible while counts load."}
            </span>
          </div>
        </div>
      )} */}
    </section>
  );
}
