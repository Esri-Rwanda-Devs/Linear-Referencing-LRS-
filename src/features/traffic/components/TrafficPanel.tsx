import { useEffect, useMemo, useState } from 'react'
import { BAND_COLOURS, BAND_STATUS, vcBand, type VcBand } from '../config/parameters'
import { ALL_STATIONS, formatSurveyYear, useSurveys, type Survey } from '../lib/trafficCounts'
import { formatMeasure, type StationStatus } from '../lib/trafficData'
import { KpiIcon } from './KpiIcon'
import { StationInsights, type CountOption } from './StationInsights'

const fmt = (n: number | null, d = 0) =>
  n == null ? '—' : n.toLocaleString('en-US', { maximumFractionDigits: d, minimumFractionDigits: d })
const mean = (xs: number[]) => (xs.length ? xs.reduce((a, b) => a + b, 0) / xs.length : null)

/**
 * Traffic analysis, a tab that fills the screen. It opens on every count station on every road, added up
 * into one picture (the average station, and the total traffic); pick one station to see just that.
 */
export function TrafficPanel({ stations }: { stations: StationStatus[] }) {
  const surveys = useSurveys()
  const [code, setCode] = useState<string>(ALL_STATIONS)
  const [year, setYear] = useState<string | null>(null)

  const all = surveys.data ?? []
  const counted = useMemo(() => new Set(all.map((s) => s.code)), [all])
  const list = useMemo(
    () => stations.filter((s) => counted.has(s.code))
      .sort((a, b) => a.routeId.localeCompare(b.routeId, undefined, { numeric: true }) || (a.measure ?? 0) - (b.measure ?? 0)),
    [stations, counted],
  )
  const station = code === ALL_STATIONS ? null : list.find((s) => s.code === code) ?? null

  // The surveys this panel is about: every station, or just the chosen one.
  const scope = useMemo(() => all.filter((s) => !station || s.code === station.code), [all, station])
  const years = useMemo(() => [...new Set(scope.map((s) => s.year))].sort().reverse(), [scope])
  useEffect(() => {
    if (years.length && (!year || !years.includes(year))) setYear(years[0])
  }, [years, year])

  const inYear = useMemo(() => scope.filter((s) => s.year === year), [scope, year])
  const figures = useMemo(() => {
    const vcs = inYear.map((s) => s.vc).filter((v): v is number => v != null)
    const bands: Record<VcBand, number> = { free: 0, near: 0, congested: 0, over: 0, none: 0 }
    for (const s of inYear) bands[vcBand(s.vc)]++
    const total = inYear.reduce((a, s) => a + s.daily, 0)
    const worst = inYear.filter((s) => s.vc != null).sort((a, b) => b.vc! - a.vc!)[0] as Survey | undefined
    return { n: inYear.length, total, perStation: inYear.length ? total / inYear.length : null, avgVc: mean(vcs), bands, worst, days: inYear[0]?.days ?? null }
  }, [inYear])
  const avgBand = vcBand(figures.avgVc)

  const roads = useMemo(() => [...new Set(list.map((s) => s.routeId))], [list])
  const options = useMemo<CountOption[]>(
    () => [{ code: ALL_STATIONS, name: 'All stations', note: `${list.length}` }, ...list.map((s) => ({ code: s.code, name: s.name || s.code }))],
    [list],
  )

  return (
    <aside className="card traffic-panel" aria-label="Traffic analysis">
      <div className="panel-top">
        <div>
          <h3 className="panel-title">Traffic analysis</h3>
          <div className="sub">{station ? `${station.name || station.code} · ${station.routeName || station.routeId}` : `All roads · ${fmt(list.length)} count stations combined`}</div>
        </div>
      </div>

      <div className="traffic-selects">
        <label className="inline-field"><span>Survey year</span>
          <select className="select" value={year ?? ''} onChange={(e) => setYear(e.target.value)}>
            {years.map((y) => <option key={y} value={y}>{formatSurveyYear(y)}</option>)}
            {years.length === 0 && <option value="">No counts</option>}
          </select>
        </label>
        <label className="inline-field"><span>Station</span>
          <select className="select" value={code} onChange={(e) => setCode(e.target.value)}>
            <option value={ALL_STATIONS}>All stations, combined ({list.length})</option>
            {roads.map((r) => (
              <optgroup key={r} label={r}>
                {list.filter((s) => s.routeId === r).map((s) => <option key={s.code} value={s.code}>{s.name || s.code} · km {formatMeasure(s.measure)}</option>)}
              </optgroup>
            ))}
          </select>
        </label>
      </div>

      <div className="kpis compact traffic-kpis">
        <div className="card kpi">
          <div className="label">{station ? 'Station' : 'Count stations'}</div>
          <div className="value"><KpiIcon name="stations" colour="var(--accent)" /><span>{station ? (station.name || station.code) : fmt(figures.n)}</span></div>
        </div>
        <div className="card kpi">
          <div className="label">Vehicles a day{station ? '' : ', all stations'}</div>
          <div className="value"><KpiIcon name="vehicles" colour="var(--accent)" /><span>{fmt(figures.total)}</span></div>
        </div>
        {station && (
          <div className="card kpi">
            <div className="label">Days counted</div>
            <div className="value"><KpiIcon name="calendar" colour="var(--accent)" /><span>{fmt(figures.days)}</span></div>
          </div>
        )}
        <div className="card kpi">
          <div className="label">{station ? 'V/C ratio' : 'Average V/C'}</div>
          <div className="value">
            <KpiIcon name={avgBand === 'none' ? 'none' : avgBand} colour={BAND_COLOURS[avgBand]} />
            <span style={{ color: BAND_COLOURS[avgBand] }}>{fmt(figures.avgVc, 2)}<small>{BAND_STATUS[avgBand]}</small></span>
          </div>
        </div>
        {!station && (
          <>
            <div className="card kpi">
              <div className="label">Congested or over</div>
              <div className="value">
                <KpiIcon name="congested" colour={BAND_COLOURS.congested} />
                <span>{fmt(figures.bands.congested + figures.bands.over)}<small>of {fmt(figures.n)}</small></span>
              </div>
            </div>
            <div className="card kpi">
              <div className="label">Highest V/C</div>
              <div className="value">
                <KpiIcon name="rising" colour={BAND_COLOURS[vcBand(figures.worst?.vc ?? null)]} />
                <span>{fmt(figures.worst?.vc ?? null, 2)}</span>
              </div>
            </div>
          </>
        )}
      </div>

      {surveys.error ? (
        <div className="error-box" role="alert"><strong>Could not load hourly counts.</strong> {(surveys.error as Error).message}</div>
      ) : surveys.isLoading ? (
        <div className="skeleton" style={{ height: 220 }} />
      ) : list.length === 0 ? (
        <div className="placeholder">No count station has hourly counts yet.</div>
      ) : (
        <StationInsights
          options={options}
          initialCode={ALL_STATIONS}
          code={code}
          onCodeChange={setCode}
          year={year}
          onYearChange={setYear}
          scopeCodes={null}
          wide
        />
      )}
    </aside>
  )
}
