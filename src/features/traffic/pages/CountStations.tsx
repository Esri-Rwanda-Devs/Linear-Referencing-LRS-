import { useEffect, useMemo, useRef, useState } from 'react'
import { useQuery } from '@tanstack/react-query'
import { BAND_COLOURS, BAND_STATUS, type VcBand } from '../config/parameters'
import { Autocomplete, type AutoOption } from '../components/Autocomplete'
import { MapView } from '../components/MapView'
import { StationCountsView, StationHeading } from '../components/StationDialog'
import { NetworkVcTrend } from '../components/VcTrend'
import { KpiIcon } from '../components/KpiIcon'
import { StationInsights } from '../components/StationInsights'
import { formatSurveyYear, useSurveys, vcTrend, yearsInScope } from '../lib/trafficCounts'
import { useStations } from '../lib/useStations'
import {
  adminChoices,
  formatMeasure,
  loadRoadNetwork,
  matchAdmin,
  type Link,
  type StationStatus,
} from '../lib/trafficData'

const fmt = (n: number | null, d = 0) =>
  n == null ? '—' : n.toLocaleString('en-US', { maximumFractionDigits: d, minimumFractionDigits: d })

type SortKey = 'name' | 'status' | 'vc' | 'pcu' | 'capacity' | 'aadt'
const BANDS: VcBand[] = ['free', 'near', 'congested', 'over', 'none']
const BAND_ORDER: Record<VcBand, number> = { free: 0, near: 1, congested: 2, over: 3, none: 4 }

/** The capacity bar runs to 150%, with a tick at 100%, so heavily over-capacity stations stay readable. */
const BAR_MAX = 1.5

function exportCsv(rows: StationStatus[], year: string | null) {
  const head = [
    'Survey year', 'Station', 'Code', 'Road', 'Measure',
    'Province', 'District', 'Sector', 'Status', 'V/C', 'PCU', 'Capacity', 'AADT', '% of capacity',
  ]
  const body = rows.map((s) => [
    year ? formatSurveyYear(year) : '', s.name, s.code, s.routeName || s.routeId, s.measure,
    s.province, s.district, s.sector, BAND_STATUS[s.band],
    s.effectiveVc?.toFixed(2), s.pcu, s.capacity, s.aadt, s.effectiveVc != null ? Math.round(s.effectiveVc * 100) : '',
  ])
  const csv = [head, ...body].map((r) => r.map((c) => `"${String(c ?? '').replace(/"/g, '""')}"`).join(',')).join('\n')
  const a = document.createElement('a')
  a.href = URL.createObjectURL(new Blob([csv], { type: 'text/csv' }))
  a.download = 'count-stations.csv'
  a.click()
  URL.revokeObjectURL(a.href)
}

export function CountStations() {
  const { stations: everyStation, links, year, setYear, years, loading, error } = useStations({ byYear: true })
  // The year is a filter: only stations counted in it are listed, charted, counted and mapped.
  const stations = useMemo(() => everyStation.filter((s) => s.counted), [everyStation])
  const network = useQuery({ queryKey: ['network'], queryFn: loadRoadNetwork, staleTime: Infinity })
  const [selectedId, setSelectedId] = useState<number | null>(null)
  const [findingsSlot, setFindingsSlot] = useState<HTMLElement | null>(null)
  const scrollRef = useRef<HTMLDivElement>(null)
  const rowRefs = useRef(new Map<number, HTMLTableRowElement>())
  const [query, setQuery] = useState('')
  const [province, setProvince] = useState('')
  const [district, setDistrict] = useState('')
  const [sector, setSector] = useState('')
  const [band, setBand] = useState<VcBand | 'all'>('all')
  const [sort, setSort] = useState<{ key: SortKey; dir: 1 | -1 }>({ key: 'vc', dir: -1 })

  // The table works from the Traffic_Count survey years: move off a year that has no counts.
  useEffect(() => {
    if (years.length && year != null && !years.includes(year)) setYear(years[0])
  }, [years, year, setYear])

  const adminFilter = useMemo(
    () => ({
      province: province || undefined,
      district: district || undefined,
      sector: sector || undefined,
    }),
    [province, district, sector],
  )
  const provinces = useMemo(() => adminChoices(stations, 'province'), [stations])
  const districts = useMemo(
    () => adminChoices(stations, 'district', { province: province || undefined }),
    [stations, province],
  )
  const sectors = useMemo(
    () =>
      adminChoices(stations, 'sector', {
        province: province || undefined,
        district: district || undefined,
      }),
    [stations, province, district],
  )

  // Suggestions: every station (by name and code) and every road that has stations.
  const searchOptions = useMemo<AutoOption[]>(() => {
    const out = new Map<string, AutoOption>()
    const roads = new Map<string, { name: string; n: number }>()
    for (const s of stations) {
      const value = s.name || s.code
      if (!out.has(value)) {
        out.set(value, { value, label: s.name ? `${s.name} · ${s.code}` : s.code, hint: s.routeName || s.routeId })
      }
      const r = roads.get(s.routeId) ?? { name: s.routeName, n: 0 }
      r.n++
      roads.set(s.routeId, r)
    }
    for (const [id, r] of roads) {
      if (!out.has(id)) {
        out.set(id, { value: id, label: r.name && r.name !== id ? `${id} · ${r.name}` : id, hint: `road · ${r.n} station${r.n === 1 ? '' : 's'}` })
      }
    }
    return [...out.values()]
  }, [stations])

  // Stations matching search and admin location. Indicators and status chips use this set.
  const inScope = useMemo(() => {
    const q = query.trim().toLowerCase()
    return stations.filter(
      (s) =>
        matchAdmin(s, adminFilter) &&
        (!q ||
          `${s.name} ${s.code} ${s.routeName} ${s.routeId} ${s.province ?? ''} ${s.district ?? ''} ${s.sector ?? ''}`
            .toLowerCase()
            .includes(q)),
    )
  }, [stations, query, adminFilter])

  const counts = useMemo(() => {
    const c: Record<VcBand, number> = { free: 0, near: 0, congested: 0, over: 0, none: 0 }
    for (const s of inScope) c[s.band]++
    return c
  }, [inScope])

  const rows = useMemo(() => {
    const value = (s: StationStatus): number | string => {
      switch (sort.key) {
        case 'name': return (s.name || s.code).toLowerCase()
        case 'status': return BAND_ORDER[s.band]
        case 'vc': return s.effectiveVc ?? -Infinity
        case 'pcu': return s.pcu ?? -Infinity
        case 'capacity': return s.capacity ?? -Infinity
        case 'aadt': return s.aadt ?? -Infinity
      }
    }
    return inScope
      .filter((s) => band === 'all' || s.band === band)
      .sort((a, b) => {
        const x = value(a), y = value(b)
        return (x < y ? -1 : x > y ? 1 : 0) * sort.dir || (a.name || a.code).localeCompare(b.name || b.code)
      })
  }, [inScope, band, sort])

  // Keep the selected row in view inside the table, without moving the page away from the map.
  useEffect(() => {
    const box = scrollRef.current
    const row = selectedId == null ? undefined : rowRefs.current.get(selectedId)
    if (!box || !row) return
    const top = row.getBoundingClientRect().top - box.getBoundingClientRect().top + box.scrollTop
    box.scrollTo({ top: Math.max(0, top - box.clientHeight / 2), behavior: 'smooth' })
  }, [selectedId])

  const selected = stations.find((s) => s.id === selectedId) ?? null
  const filtered = !!query || !!province || !!district || !!sector || band !== 'all'
  const scopeCodes = useMemo(() => new Set(inScope.map((s) => s.code)), [inScope])
  const scopeLabel = [
    province || null,
    district || (!province ? 'All districts' : null),
    sector || null,
    query && `matching "${query}"`,
  ]
    .filter(Boolean)
    .join(', ')
  const surveys = useSurveys()
  const scopeTrend = useMemo(() => vcTrend(yearsInScope(surveys.data ?? [], scopeCodes)), [surveys.data, scopeCodes])
  const trendChange = scopeTrend ? Math.round(scopeTrend.last.vc * 100) / 100 - Math.round(scopeTrend.first.vc * 100) / 100 : null

  // The survey year. The same choice drives the table, the map and the station panel.
  const yearSelect = (
    <select className="select year-select" aria-label="Survey year" value={year ?? ''} onChange={(e) => setYear(e.target.value)}>
      {years.map((y) => <option key={y} value={y}>{formatSurveyYear(y)}</option>)}
      {years.length === 0 && <option value="">All records</option>}
    </select>
  )

  const th = (key: SortKey, label: string, num = false) => (
    <th className={num ? 'num' : ''} aria-sort={sort.key === key ? (sort.dir === 1 ? 'ascending' : 'descending') : 'none'}>
      <button className="th-btn" onClick={() => setSort((s) => ({ key, dir: s.key === key ? (s.dir === 1 ? -1 : 1) : key === 'name' ? 1 : -1 }))}>
        {label}<span className="arrow" aria-hidden>{sort.key === key ? (sort.dir === 1 ? '▲' : '▼') : ''}</span>
      </button>
    </th>
  )

  return (
    <main className="page">
      <div className="page-head">
        <div>
          <div className="crumbs">Traffic Management / Count stations</div>
          <h1>Congestion at count stations</h1>
        </div>
        <div className="actions">
          <button className="btn primary" disabled={!rows.length} onClick={() => exportCsv(rows, year)}>Export CSV</button>
        </div>
      </div>

      {error && <div className="error-box" role="alert"><strong>Could not load data.</strong> {error.message}</div>}

      {/* Selection: everything below (indicators, table, map) follows these choices. */}
      <section className="card selection-bar" aria-label="Selection">
        <label className="inline-field"><span>Province</span>
          <select
            className="select"
            value={province}
            onChange={(e) => {
              setProvince(e.target.value)
              setDistrict('')
              setSector('')
            }}
          >
            <option value="">All provinces</option>
            {provinces.map((p) => <option key={p} value={p}>{p}</option>)}
          </select>
        </label>
        <label className="inline-field"><span>District</span>
          <select
            className="select"
            value={district}
            onChange={(e) => {
              setDistrict(e.target.value)
              setSector('')
            }}
          >
            <option value="">All districts</option>
            {districts.map((d) => <option key={d} value={d}>{d}</option>)}
          </select>
        </label>
        <label className="inline-field"><span>Sector</span>
          <select className="select" value={sector} onChange={(e) => setSector(e.target.value)}>
            <option value="">All sectors</option>
            {sectors.map((s) => <option key={s} value={s}>{s}</option>)}
          </select>
        </label>
        <Autocomplete
          compact
          label="Search stations"
          placeholder="Search station or road"
          value={query}
          onChange={setQuery}
          options={searchOptions}
        />
        <div className="chips">
          <button className={`chip${band === 'all' ? ' on' : ''}`} onClick={() => setBand('all')}>All · {inScope.length}</button>
          {BANDS.filter((b) => counts[b] > 0).map((b) => (
            <button key={b} className={`chip${band === b ? ' on' : ''}`} onClick={() => setBand(b)}>
              <i className="dot" style={{ background: BAND_COLOURS[b] }} />{BAND_STATUS[b]} · {counts[b]}
            </button>
          ))}
        </div>
        {filtered && (
          <button
            className="btn clear"
            onClick={() => {
              setQuery('')
              setProvince('')
              setDistrict('')
              setSector('')
              setBand('all')
            }}
          >
            Clear
          </button>
        )}
      </section>

      <section className="kpis compact">
        <div className="card kpi">
          <div className="label">Count stations</div>
          <div className="value"><KpiIcon name="stations" colour="var(--accent)" /><span>{loading ? '…' : fmt(inScope.length)}<small>{filtered ? `of ${fmt(stations.length)}` : ''}</small></span></div>
        </div>
        {(['free', 'near', 'congested', 'over'] as VcBand[]).map((b) => (
          <div className="card kpi" key={b}>
            <div className="label">{BAND_STATUS[b]}</div>
            <div className="value"><KpiIcon name={b as 'free' | 'near' | 'congested' | 'over'} colour={BAND_COLOURS[b]} /><span>{loading ? '…' : fmt(counts[b])}</span></div>
          </div>
        ))}
        <a className="card kpi kpi-link" href="#network-trend" title="See the network trend across survey years">
          <div className="label">Average V/C trend</div>
          <div className="value">
            <KpiIcon
              name={scopeTrend?.direction ?? 'stable'}
              colour={scopeTrend?.direction === 'rising' ? 'var(--danger)' : scopeTrend?.direction === 'falling' ? 'var(--ok)' : 'var(--muted)'}
            />
            <span>
              {surveys.isLoading ? '…' : !scopeTrend || trendChange == null ? '—' : (
                <>
                  {trendChange > 0 ? '+' : trendChange < 0 ? '−' : '±'}{Math.abs(trendChange).toFixed(2)}
                  <small>{scopeTrend.direction} since {formatSurveyYear(scopeTrend.first.year)}</small>
                </>
              )}
            </span>
          </div>
        </a>
      </section>

      <div className="stations-layout">
        <div className="stations-main">
        <section className="card table-card squeezed">
          <div className="card-head">
            <h3>Stations <span className="muted-count">{rows.length}</span></h3>
            <label className="inline-field"><span>Survey year</span>{yearSelect}</label>
          </div>
          <div className="table-scroll tall" ref={scrollRef}>
            <table className="data stations compact">
              <thead>
                <tr>
                  {th('name', 'Station')}
                  {th('status', 'Status')}
                  {th('vc', 'V/C', true)}
                  {th('pcu', 'PCU', true)}
                  {th('capacity', 'Capacity', true)}
                  {th('aadt', 'AADT', true)}
                  <th className="pct-col">% of capacity</th>
                </tr>
              </thead>
              <tbody>
                {loading && Array.from({ length: 8 }, (_, i) => (
                  <tr key={i}><td colSpan={7}><div className="skeleton" style={{ height: 18 }} /></td></tr>
                ))}
                {!loading && rows.map((s) => {
                  const colour = BAND_COLOURS[s.band]
                  const pct = s.effectiveVc == null ? null : Math.round(s.effectiveVc * 100)
                  return (
                    <tr
                      key={s.id}
                      ref={(el) => { if (el) rowRefs.current.set(s.id, el); else rowRefs.current.delete(s.id) }}
                      aria-selected={s.id === selectedId}
                      className={`clickable${s.id === selectedId ? ' selected' : ''}`}
                      tabIndex={0}
                      title="Show on map and see vehicles counted"
                      onClick={() => setSelectedId(s.id)}
                      onKeyDown={(e) => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); setSelectedId(s.id) } }}
                    >
                      <td>
                        <strong>{s.name || s.code}</strong>
                        <div className="sub">
                          {s.routeName || s.routeId}
                          {s.measure != null && ` · ${formatMeasure(s.measure)}`}
                        </div>
                      </td>
                      <td>
                        <span className="status-pill" style={{ color: colour, background: `color-mix(in srgb, ${colour} 14%, transparent)` }}>
                          {BAND_STATUS[s.band]}
                        </span>
                      </td>
                      <td className="num"><strong style={{ color: colour }}>{s.effectiveVc != null ? s.effectiveVc.toFixed(2) : '—'}</strong>{s.vcSource === 'segment' && <sup title="Taken from the road segment"> *</sup>}</td>
                      <td className="num">{fmt(s.pcu)}</td>
                      <td className="num">{fmt(s.capacity)}</td>
                      <td className="num">{fmt(s.aadt)}</td>
                      <td className="pct-col">
                        <div className="pct">
                          <div className="pct-track" aria-hidden>
                            <div className="pct-fill" style={{ width: `${Math.min(100, ((s.effectiveVc ?? 0) / BAR_MAX) * 100)}%`, background: colour }} />
                            <div className="pct-tick" style={{ left: `${(1 / BAR_MAX) * 100}%` }} />
                          </div>
                          <strong>{pct != null ? `${pct}%` : '—'}</strong>
                        </div>
                      </td>
                    </tr>
                  )
                })}
                {!loading && rows.length === 0 && <tr><td colSpan={7} className="placeholder">No stations match.</td></tr>}
              </tbody>
            </table>
          </div>
        </section>

        <NetworkVcTrend id="network-trend" codes={scopeCodes} scope={scopeLabel} />
        </div>

        <div className="stations-side">
          <section className="card map-card compact">
            <div className="map-toolbar">
              <strong>Map</strong>
              <span className="hint">{rows.length} stations · same selection as the table</span>
            </div>
            {loading ? (
              <div className="map-wrap"><div className="skeleton" style={{ position: 'absolute', inset: 0, borderRadius: 0 }} /></div>
            ) : (
              <MapView
                network={network.data ?? []}
                links={links}
                stations={rows}
                colourOf={(l: Link) => BAND_COLOURS[l.band]}
                widthOf={() => 2.5}
                selectedId={null}
                onSelect={() => setSelectedId(null)}
                showStations
                showNames
                onStationClick={(s) => setSelectedId(s.id)}
                selectedStationId={selectedId}
              />
            )}
            <div className="map-findings" ref={setFindingsSlot} />
          </section>

          <section className="card station-panel" aria-live="polite">
            {selected ? (
              <>
                <div className="panel-top">
                  <StationHeading station={selected} badge="counted" />
                  <button className="icon-btn" aria-label="Clear selection" onClick={() => setSelectedId(null)}>
                    <svg width="16" height="16" viewBox="0 0 16 16" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" aria-hidden><path d="M3 3l10 10M13 3 3 13" /></svg>
                  </button>
                </div>
                <StationInsights
                  key={selected.code}
                  options={[{ code: selected.code, name: selected.name }]}
                  initialCode={selected.code}
                  year={year}
                  onYearChange={setYear}
                  findingsSlot={findingsSlot}
                  extraTabs={[{ key: 'types', label: 'Vehicle types', content: <StationCountsView station={selected} summary={false} compact /> }]}
                />
              </>
            ) : (
              <div className="placeholder">Select a station in the table or on the map to see its key findings on the map: congestion, the trend across years, the busiest hour and the traffic by direction.</div>
            )}
          </section>
        </div>
      </div>
    </main>
  )
}
