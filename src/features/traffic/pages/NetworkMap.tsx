import { useEffect, useMemo, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { Link as RouterLink } from "react-router-dom";
import { MapView } from "../components/MapView";
import { Autocomplete, type AutoOption } from "../components/Autocomplete";
import { SortSwitch } from "../components/SortSwitch";
import { BAND_COLOURS, BAND_LABELS, type VcBand } from "../config/parameters";
import {
  FILTER_CHIPS,
  GROUPS,
  GROUP_COLOURS,
  GROUP_ICONS,
  type GroupKey,
} from "../config/vehicleClasses";
import { StationDialog } from "../components/StationDialog";
import { VehicleIcon } from "../components/VehicleIcons";
import {
  adminChoices,
  discoverLayers,
  formatMeasure,
  loadLinks,
  loadRoadNetwork,
  loadStations,
  loadYears,
  matchAdmin,
  sortLinks,
  withStatus,
  type Link,
  type SortMode,
  type StationStatus,
} from "../lib/trafficData";
import { assetIcons } from "../../../assets";
type ColourBy = "vc" | "aadt" | "pcu" | "heavy";

const fmt = (n: number | null, d = 0) =>
  n == null
    ? "—"
    : n.toLocaleString("en-US", {
        maximumFractionDigits: d,
        minimumFractionDigits: d,
      });

/** Green (low) through amber to red (high), t in 0..1. */
const rampColour = (t: number) => `hsl(${Math.round(135 - t * 130)} 65% 42%)`;

function useExport(links: Link[]) {
  return () => {
    const head = [
      "Route",
      "Link",
      "From measure",
      "To measure",
      "Survey year",
      "AADT",
      "PCU",
      "Capacity",
      "V/C",
      "LOS",
      "Heavy %",
    ];
    const rows = links.map((l) => [
      l.routeId,
      l.label,
      l.from,
      l.to,
      l.surveyYear,
      l.aadt,
      l.pcu,
      l.capacity,
      l.vc,
      l.los,
      l.heavyPct?.toFixed(1),
    ]);
    const csv = [head, ...rows]
      .map((r) =>
        r.map((c) => `"${String(c ?? "").replace(/"/g, '""')}"`).join(","),
      )
      .join("\n");
    const a = document.createElement("a");
    a.href = URL.createObjectURL(new Blob([csv], { type: "text/csv" }));
    a.download = "network-links.csv";
    a.click();
    URL.revokeObjectURL(a.href);
  };
}

export function NetworkMap() {
  const [year, setYear] = useState<string | null>(null);
  const [colourBy, setColourBy] = useState<ColourBy>("vc");
  const [cls, setCls] = useState<"all" | GroupKey>("all");
  const [search, setSearch] = useState("");
  const [selectedId, setSelectedId] = useState<number | null>(null);
  const [sortMode, setSortMode] = useState<SortMode>("vc");
  const [openStation, setOpenStation] = useState<StationStatus | null>(null);
  const [showStations, setShowStations] = useState(true);
  const [showNames, setShowNames] = useState(true);
  const [province, setProvince] = useState("");
  const [district, setDistrict] = useState("");
  const [sector, setSector] = useState("");

  const layers = useQuery({
    queryKey: ["layers"],
    queryFn: discoverLayers,
    staleTime: Infinity,
  });
  const years = useQuery({
    queryKey: ["years", layers.data?.lines],
    queryFn: () => loadYears(layers.data!.lines),
    enabled: !!layers.data,
  });
  useEffect(() => {
    if (year == null && years.data) setYear(years.data[0] ?? "");
  }, [years.data, year]);

  const linksQ = useQuery({
    queryKey: ["links", layers.data?.lines, year],
    queryFn: () => loadLinks(layers.data!.lines, year || null),
    enabled: !!layers.data && year != null,
  });
  const stationsQ = useQuery({
    queryKey: ["stations", layers.data?.points],
    queryFn: () => loadStations(layers.data!.points),
    enabled: !!layers.data,
  });
  // Base roads and their RouteId labels come from the Road_Network feature class.
  // A failure here must not block the traffic data, so it is reported separately.
  const networkQ = useQuery({
    queryKey: ["network"],
    queryFn: loadRoadNetwork,
    staleTime: Infinity,
  });

  const error = (layers.error ??
    years.error ??
    linksQ.error ??
    stationsQ.error) as Error | null;
  const all = linksQ.data ?? [];
  const adminFilter = useMemo(
    () => ({
      province: province || undefined,
      district: district || undefined,
      sector: sector || undefined,
    }),
    [province, district, sector],
  );
  const provinces = useMemo(
    () => adminChoices(stationsQ.data ?? [], "province"),
    [stationsQ.data],
  );
  const districts = useMemo(
    () =>
      adminChoices(stationsQ.data ?? [], "district", {
        province: province || undefined,
      }),
    [stationsQ.data, province],
  );
  const sectors = useMemo(
    () =>
      adminChoices(stationsQ.data ?? [], "sector", {
        province: province || undefined,
        district: district || undefined,
      }),
    [stationsQ.data, province, district],
  );
  // Each station gets a congestion status from its V/C, matching the segment colours.
  const stations = useMemo(() => {
    const ranked = withStatus(stationsQ.data ?? [], all);
    return ranked.filter((s) => matchAdmin(s, adminFilter));
  }, [stationsQ.data, all, adminFilter]);
  // Metric used for colouring and ranking. A vehicle-class chip swaps AADT for that class's count.
  const aadtOf = (l: Link) => (cls === "all" ? l.aadt : l.groups[cls]);
  const metric = (l: Link): number | null =>
    colourBy === "vc"
      ? l.vc
      : colourBy === "aadt"
        ? aadtOf(l)
        : colourBy === "pcu"
          ? l.pcu
          : l.heavyPct;

  // One suggestion per road, with how many sections it has in the selected year.
  const roadOptions = useMemo<AutoOption[]>(() => {
    const m = new Map<string, { name: string; n: number }>();
    for (const l of all) {
      const r = m.get(l.routeId) ?? { name: l.routeName, n: 0 };
      r.n++;
      m.set(l.routeId, r);
    }
    return [...m.entries()].map(([id, r]) => ({
      value: id,
      label: r.name && r.name !== id ? `${id} · ${r.name}` : id,
      hint: `${r.n} section${r.n === 1 ? "" : "s"}`,
    }));
  }, [all]);

  const links = useMemo(() => {
    const q = search.trim().toLowerCase();
    return q
      ? all.filter(
          (l) =>
            l.label.toLowerCase().includes(q) ||
            l.routeId.toLowerCase().includes(q),
        )
      : all;
  }, [all, search]);

  const stats = useMemo(() => {
    const maxAadt = Math.max(0, ...links.map((l) => aadtOf(l) ?? 0));
    const maxMetric = Math.max(1e-9, ...links.map((l) => metric(l) ?? 0));
    return { maxAadt, maxMetric };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [links, cls, colourBy]);

  const colourOf = (l: Link) => {
    if (colourBy === "vc") return BAND_COLOURS[l.band];
    const m = metric(l);
    if (m == null) return BAND_COLOURS.none;
    const t = Math.min(1, m / stats.maxMetric);
    return rampColour(t);
  };
  const widthOf = (l: Link) =>
    1.5 + 5 * Math.sqrt((aadtOf(l) ?? 0) / (stats.maxAadt || 1));

  // By V/C: the 100 most congested. By measure: everything, in road and measure order (capped for speed).
  const ranked = useMemo(
    () => sortLinks(links, sortMode).slice(0, sortMode === "vc" ? 100 : 500),
    [links, sortMode],
  );
  const selected =
    links.find((l) => l.id === selectedId) ??
    all.find((l) => l.id === selectedId) ??
    null;
  const selectedRouteId = search.trim() || selected?.routeId || null;

  const selectLink = (id: number | null) => {
    setSelectedId(id);
    if (id == null) return;
    const link = all.find((l) => l.id === id);
    if (link?.routeId) setSearch(link.routeId);
  };

  const selectRoad = (routeId: string | null) => {
    if (!routeId) {
      setSearch("");
      setSelectedId(null);
      return;
    }
    setSearch(routeId);
    const onRoad = all.filter((l) => l.routeId === routeId);
    const keep = selectedId != null && onRoad.some((l) => l.id === selectedId);
    if (!keep) setSelectedId(onRoad[0]?.id ?? null);
  };

  const exportCsv = useExport(links);

  const congested = links.filter((l) => (l.vc ?? 0) > 0.85).length;
  const loading = layers.isLoading || years.isLoading || linksQ.isLoading;

  return (
    <main className="page">
      <div className="page-head">
        <div>
          <div className="crumbs">Traffic Management / Network map</div>
          <h1>Traffic on the road network</h1>
        </div>
        <div className="actions">
          <button
            className="btn primary"
            onClick={exportCsv}
            disabled={links.length === 0}
          >
            Export CSV
          </button>
        </div>
      </div>

      {error && (
        <div className="error-box" role="alert">
          <strong>Could not load data.</strong> {error.message}
        </div>
      )}

      {networkQ.error && (
        <div className="error-box" role="alert">
          <strong>
            Road network (layer 1) could not be loaded, so route labels are
            hidden.
          </strong>{" "}
          {(networkQ.error as Error).message}
        </div>
      )}

      <section className="kpis">
        <div className="card kpi">
          <div className="label">Links on the map</div>
          <div className="value">{loading ? "…" : fmt(links.length)}</div>
        </div>
        <div className="card kpi">
          <div className="label">Links with V/C above 0.85</div>
          <div className={`value${congested ? " danger" : ""}`}>
            {loading ? "…" : fmt(congested)}
          </div>
        </div>
        <div className="card kpi">
          <div className="label">Highest AADT</div>
          <div className="value">{loading ? "…" : fmt(stats.maxAadt)}</div>
        </div>
        <div className="card kpi">
          <div className="label">Count stations</div>
          <div className="value">
            {stationsQ.isLoading ? "…" : fmt(stations.length)}
            <small>
              {
                stations.filter(
                  (s) => s.band === "congested" || s.band === "over",
                ).length
              }{" "}
              congested
            </small>
          </div>
        </div>
        <div className="card kpi">
          <div className="label">Data year</div>
          <div className="value">{year || "—"}</div>
        </div>
      </section>

      <div className="map-grid">
        <aside className="side">
          <div className="card">
            <h3>Filters</h3>
            <label className="field">
              <span>Year</span>
              <select
                className="select"
                value={year ?? ""}
                onChange={(e) => {
                  setYear(e.target.value);
                  setSelectedId(null);
                }}
              >
                {(years.data ?? []).map((y) => (
                  <option key={y} value={y}>
                    {y}
                  </option>
                ))}
                {years.data?.length === 0 && (
                  <option value="">All records</option>
                )}
              </select>
            </label>
            <Autocomplete
              label="Road"
              placeholder="Search or click a road on the map"
              value={search}
              onChange={(v) => {
                setSearch(v);
                if (!v) setSelectedId(null);
              }}
              options={roadOptions}
            />
            <label className="field">
              <span>Province</span>
              <select
                className="select"
                value={province}
                onChange={(e) => {
                  setProvince(e.target.value);
                  setDistrict("");
                  setSector("");
                }}
              >
                <option value="">All provinces</option>
                {provinces.map((p) => (
                  <option key={p} value={p}>
                    {p}
                  </option>
                ))}
              </select>
            </label>
            <label className="field">
              <span>District</span>
              <select
                className="select"
                value={district}
                onChange={(e) => {
                  setDistrict(e.target.value);
                  setSector("");
                }}
              >
                <option value="">All districts</option>
                {districts.map((d) => (
                  <option key={d} value={d}>
                    {d}
                  </option>
                ))}
              </select>
            </label>
            <label className="field">
              <span>Sector</span>
              <select
                className="select"
                value={sector}
                onChange={(e) => setSector(e.target.value)}
              >
                <option value="">All sectors</option>
                {sectors.map((s) => (
                  <option key={s} value={s}>
                    {s}
                  </option>
                ))}
              </select>
            </label>
            <div className="field">
              <span>Vehicle class</span>
              <div className="chips">
                {FILTER_CHIPS.map((c) => (
                  <button
                    key={c.key}
                    className={`chip${cls === c.key ? " on" : ""}`}
                    onClick={() => setCls(c.key)}
                  >
                    {c.key !== "all" && (
                      <VehicleIcon type={GROUP_ICONS[c.key]} size={14} />
                    )}
                    {c.label}
                  </button>
                ))}
              </div>
            </div>
          </div>
          <div className="card">
            <h3>Layers</h3>
            <div className="toggle-row">
              Count stations
              <button
                className={`switch${showStations ? " on" : ""}`}
                role="switch"
                aria-checked={showStations}
                aria-label="Count stations"
                onClick={() => setShowStations((v) => !v)}
              />
            </div>
            <div className="toggle-row">
              Road names
              <button
                className={`switch${showNames ? " on" : ""}`}
                role="switch"
                aria-checked={showNames}
                aria-label="Road names"
                onClick={() => setShowNames((v) => !v)}
              />
            </div>
          </div>
        </aside>

        <section className="card map-card">
          <div className="map-toolbar">
            <div className="seg" aria-label="Colour by">
              {(
                [
                  ["vc", "V/C ratio"],
                  ["aadt", "AADT"],
                  ["pcu", "PCU"],
                  ["heavy", "Heavy vehicles %"],
                ] as const
              ).map(([k, label]) => (
                <button
                  key={k}
                  className={colourBy === k ? "on" : ""}
                  onClick={() => setColourBy(k)}
                >
                  {label}
                </button>
              ))}
            </div>
          </div>
          {loading ? (
            <div className="map-wrap">
              <div
                className="skeleton"
                style={{ position: "absolute", inset: 0, borderRadius: 0 }}
              />
            </div>
          ) : (
            <MapView
              network={networkQ.data ?? []}
              links={links}
              stations={stations}
              colourOf={colourOf}
              widthOf={widthOf}
              selectedId={selectedId}
              onSelect={selectLink}
              selectedRouteId={selectedRouteId}
              onRoadSelect={selectRoad}
              showStations={showStations}
              showNames={showNames}
              onStationClick={setOpenStation}
            />
          )}
          <div className="traffic-legend">
            {colourBy === "vc" ? (
              (["free", "near", "congested", "over"] as VcBand[]).map(
                (b) => {
                  return (
                    <div className="traffic-legend-item" key={b}>
                      <assetIcons.Layout size={14} color={BAND_COLOURS[b]} style={{ height: "14px", width: "14px" }} />
                      <p style={{ fontSize: "12px" }}>{BAND_LABELS[b]}</p>
                    </div>
                  );
                })
               
            ) : (
              <span>
                0
                <i
                  style={{
                    background: `linear-gradient(90deg, ${rampColour(0)}, ${rampColour(0.5)}, ${rampColour(1)})`,
                    width: 90,
                  }}
                />
                {Math.round(stats.maxMetric).toLocaleString()}
              </span>
            )}
            {showStations && (
              <span>
                <i
                  style={{
                    background: BAND_COLOURS.none,
                    width: 10,
                    height: 10,
                    borderRadius: 2,
                    border: "1.5px solid #fff",
                    boxShadow: "0 0 0 1px var(--border)",
                  }}
                />
                Count stations - V/C
              </span>
            )}
          </div>
        </section>

        <aside className="side">
          <div className="card">
            {selected ? (
              <Detail link={selected} />
            ) : (
              <div className="placeholder">
                Click a road on the map, search above, or pick a link in the
                ranking.
              </div>
            )}
          </div>
          <div className="card">
            <h3>
              {sortMode === "vc"
                ? "Ranking by V/C ratio"
                : "Links by road and measure"}
            </h3>
            <SortSwitch value={sortMode} onChange={setSortMode} />
            <p
              className="hint"
              style={{ margin: "0 0 8px", color: "var(--muted)", fontSize: 12 }}
            >
              {sortMode === "vc"
                ? "Most congested first."
                : "Ordered by road, then from measure."}{" "}
              Select a row to open it.
            </p>
            <ol className="rank">
              {ranked.map((l, i) => (
                <li key={l.id}>
                  <button
                    className={selectedId === l.id ? "sel" : ""}
                    onClick={() => selectLink(l.id)}
                  >
                    <span className="n">{i + 1}</span>
                    <span className="name" title={`${l.label} (${l.range})`}>
                      {l.label}
                      <small className="rank-range">
                        From {formatMeasure(l.from)} · To {formatMeasure(l.to)}
                      </small>
                    </span>
                    <span className="mono">{l.vc!.toFixed(2)}</span>
                    <span
                      className="swatch"
                      style={{ background: BAND_COLOURS[l.band] }}
                    />
                  </button>
                </li>
              ))}
              {!loading && ranked.length === 0 && (
                <li className="placeholder">No links with a V/C ratio.</li>
              )}
            </ol>
          </div>
        </aside>
      </div>

      {openStation && (
        <StationDialog
          station={openStation}
          onClose={() => setOpenStation(null)}
        />
      )}
    </main>
  );
}

function Detail({ link }: { link: Link }) {
  const total = Object.values(link.groups).reduce((s, v) => s + v, 0);
  const keys = (Object.keys(GROUPS) as GroupKey[]).filter(
    (k) => link.groups[k] > 0,
  );
  const losClass =
    link.los === "E" || link.los === "F"
      ? "danger"
      : link.los === "D" || link.los === "C"
        ? "warn"
        : "";
  return (
    <>
      <div className="detail-head">
        <div>
          <h3>{link.label}</h3>
          <div className="muted-note" style={{ margin: 0 }}>
            From {formatMeasure(link.from)} · To {formatMeasure(link.to)}
          </div>
        </div>
        {link.los && <span className={`pill ${losClass}`}>LOS {link.los}</span>}
      </div>
      <div className="stats">
        <div className="stat">
          <div className="label">AADT</div>
          <div className="value">{fmt(link.aadt)}</div>
        </div>
        <div className="stat">
          <div className="label">V/C ratio</div>
          <div className="value">{fmt(link.vc, 2)}</div>
        </div>
        <div className="stat">
          <div className="label">PCU per day</div>
          <div className="value">{fmt(link.pcu)}</div>
        </div>
        <div className="stat">
          <div className="label">Capacity (PCU/day)</div>
          <div className="value">{fmt(link.capacity)}</div>
        </div>
        <div className="stat">
          <div className="label">Count stations</div>
          <div className="value">{fmt(link.stationCount)}</div>
        </div>
        <div className="stat">
          <div className="label">Heavy vehicles</div>
          <div className="value">
            {link.heavyPct == null ? "—" : `${link.heavyPct.toFixed(0)}%`}
          </div>
        </div>
      </div>

      <div className="sub-h">Vehicle mix</div>
      {total > 0 ? (
        <>
          <div className="mixbar" role="img" aria-label="Vehicle mix">
            {keys.map((k) => (
              <div
                key={k}
                style={{
                  flexBasis: `${(link.groups[k] / total) * 100}%`,
                  background: GROUP_COLOURS[k],
                }}
              />
            ))}
          </div>
          <div className="mixkey">
            {keys.map((k) => (
              <span key={k}>
                <VehicleIcon type={GROUP_ICONS[k]} size={13} />
                {GROUPS[k].label} {Math.round((link.groups[k] / total) * 100)}%
              </span>
            ))}
          </div>
        </>
      ) : (
        <div className="placeholder">No class counts for this link.</div>
      )}

      <div className="sub-h">Hourly profile</div>
      <div className="placeholder">
        Hourly counts are not connected yet. They need an hourly count table.
      </div>

      <div className="actions" style={{ marginTop: 14 }}>
        <RouterLink className="btn" to="/capacity">
          Capacity analysis
        </RouterLink>
        <RouterLink className="btn" to="/growth">
          Growth and loading
        </RouterLink>
      </div>
    </>
  );
}
