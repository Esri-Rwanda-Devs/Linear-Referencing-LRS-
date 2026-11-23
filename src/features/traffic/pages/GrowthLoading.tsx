import { useMemo, useState } from 'react'
import {
  CartesianGrid, Line, LineChart, ReferenceLine, ResponsiveContainer, Tooltip, XAxis, YAxis, type TooltipProps,
} from 'recharts'
import { KpiIcon } from '../components/KpiIcon'
import { VehicleIcon } from '../components/VehicleIcons'
import { STATION_TYPES, VDF_DEFAULTS, type StationType } from '../config/vehicleClasses'
import { classMix, fitGrowth, loadingModel, remainingLife, yearNumber } from '../lib/growth'
import { aggregateSurveys, formatSurveyYear, useSurveys } from '../lib/trafficCounts'
import { formatMeasure } from '../lib/trafficData'
import { useStations } from '../lib/useStations'

const fmt = (n: number | null, d = 0) =>
  n == null ? '—' : n.toLocaleString('en-US', { maximumFractionDigits: d, minimumFractionDigits: d })
const pctFmt = (n: number | null, d = 1) => (n == null ? '—' : `${n > 0 ? '+' : n < 0 ? '−' : ''}${Math.abs(n * 100).toFixed(d)}%`)

const DEFAULTS = { horizon: 20, design: 10, lane: 50, fallbackGrowth: 3 }

/** A number typed into a box. It applies when the box loses focus or Enter is pressed; an empty box means "use the default". */
function NumberField({ label, value, placeholder, onChange, width = 84, suffix }: {
  label: string; value: number | null; placeholder?: string; onChange: (n: number | null) => void; width?: number; suffix?: string
}) {
  const [text, setText] = useState(value == null ? '' : String(value))
  const [seen, setSeen] = useState(value)
  if (seen !== value) { setSeen(value); setText(value == null ? '' : String(value)) }
  const commit = () => {
    const t = text.trim().replace(',', '.')
    if (t === '') return onChange(null)
    const n = Number(t)
    if (Number.isFinite(n)) onChange(n)
    else setText(value == null ? '' : String(value))
  }
  return (
    <label className="inline-field"><span>{label}</span>
      <input
        className="input num-input" style={{ width }} inputMode="decimal" value={text} placeholder={placeholder}
        onChange={(e) => setText(e.target.value)} onBlur={commit} onKeyDown={(e) => { if (e.key === 'Enter') commit() }}
      />
      {suffix && <span className="suffix">{suffix}</span>}
    </label>
  )
}

function Tip({ active, payload, label, unit }: TooltipProps<number, string> & { unit: string }) {
  if (!active || !payload?.length) return null
  return (
    <div className="chart-tip">
      <div className="chart-tip-head">{label}</div>
      {payload.filter((p) => p.value != null).map((p) => (
        <div key={p.dataKey as string} className="chart-tip-row">{p.name}<strong>{fmt(p.value as number, unit === 'MSA' ? 2 : 0)} {unit === 'MSA' ? 'million E80' : ''}</strong></div>
      ))}
    </div>
  )
}

/**
 * Growth and loading: how traffic on a road has grown, where it is heading, how much damage the heavy vehicles do
 * (in equivalent standard axles, E80) and how much of the pavement's design loading is left.
 */
export function GrowthLoading() {
  const { stations, error } = useStations()
  const surveys = useSurveys()
  const [roadId, setRoadId] = useState('')
  const [code, setCode] = useState('')
  const [horizon, setHorizon] = useState<number | null>(null)
  const [growth, setGrowth] = useState<number | null>(null)
  const [design, setDesign] = useState<number | null>(null)
  const [built, setBuilt] = useState<number | null>(null)
  const [lane, setLane] = useState<number | null>(null)
  const [vdf, setVdf] = useState<Record<StationType, number>>(VDF_DEFAULTS)

  const all = surveys.data ?? []
  const counted = useMemo(() => new Set(all.map((s) => s.code)), [all])
  const list = useMemo(
    () => stations.filter((s) => counted.has(s.code))
      .sort((a, b) => a.routeId.localeCompare(b.routeId, undefined, { numeric: true }) || (a.measure ?? 0) - (b.measure ?? 0)),
    [stations, counted],
  )
  const roads = useMemo(() => [...new Set(list.map((s) => s.routeId))], [list])
  const inScope = useMemo(
    () => list.filter((s) => (code ? s.code === code : !roadId || s.routeId === roadId)),
    [list, roadId, code],
  )
  const station = code ? list.find((s) => s.code === code) ?? null : null

  // Traffic by year: the average over the stations in scope.
  const history = useMemo(
    () => aggregateSurveys(all, new Set(inScope.map((s) => s.code)))
      .map((s) => ({ year: yearNumber(s.year), label: s.year, value: s.adt ?? s.daily }))
      .filter((p) => Number.isFinite(p.year) && p.value > 0),
    [all, inScope],
  )
  const latest = history[history.length - 1] ?? null
  const fitted = useMemo(() => fitGrowth(history), [history])

  const horizonYears = horizon ?? DEFAULTS.horizon
  const rate = growth != null ? growth / 100 : fitted ?? DEFAULTS.fallbackGrowth / 100
  const designMsa = design ?? DEFAULTS.design
  const laneShare = (lane ?? DEFAULTS.lane) / 100
  const builtYear = built ?? (latest ? latest.year - 10 : null)

  const mix = useMemo(() => classMix(inScope), [inScope])
  const perVehicle = mix.reduce((s, c) => s + c.share * vdf[c.key], 0)
  const hasMix = mix.some((c) => c.count > 0)

  const model = useMemo(
    () => (latest && hasMix ? loadingModel({ year: latest.year, value: latest.value }, rate, perVehicle, laneShare) : null),
    [latest, hasMix, rate, perVehicle, laneShare],
  )
  const life = useMemo(
    () => (model && latest && builtYear != null ? remainingLife(model, Math.min(builtYear, latest.year), latest.year, designMsa) : null),
    [model, latest, builtYear, designMsa],
  )

  const aadtAt = (year: number) => (latest ? latest.value * (1 + rate) ** (year - latest.year) : 0)
  const forecast = latest ? aadtAt(latest.year + horizonYears) : null
  const e80Day = latest && hasMix ? latest.value * perVehicle * laneShare : null

  // Charts
  const trafficChart = useMemo(() => {
    if (!latest) return []
    const years = new Set<number>([...history.map((h) => h.year)])
    for (let y = latest.year; y <= latest.year + horizonYears; y++) years.add(y)
    return [...years].sort((a, b) => a - b).map((y) => ({
      year: String(y),
      counted: history.find((h) => h.year === y)?.value ?? null,
      forecast: y >= latest.year ? aadtAt(y) : null,
    }))
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [history, latest, horizonYears, rate])

  const loadChart = useMemo(() => {
    if (!model || !latest || builtYear == null) return []
    const start = Math.min(builtYear, latest.year)
    const out: { year: string; carried: number | null; ahead: number | null }[] = []
    let sum = 0
    for (let y = start; y <= latest.year + horizonYears; y++) {
      sum += model.annual(y)
      out.push({ year: String(y), carried: y <= latest.year ? sum : null, ahead: y >= latest.year ? sum : null })
    }
    return out
  }, [model, latest, builtYear, horizonYears])

  const lifeText = !life ? '—' : life.remaining === 0 ? 'Used up' : life.remaining == null ? 'Over 100 years' : `${fmt(life.remaining, 1)} years`
  const used = life && designMsa > 0 ? Math.min(1, life.consumed / designMsa) : null

  return (
    <main className="page">
      <div className="page-head">
        <div>
          <div className="crumbs">Traffic Management / Growth and loading</div>
          <h1>Traffic growth, axle loading and remaining pavement life</h1>
        </div>
      </div>

      {(error || surveys.error) && <div className="error-box" role="alert"><strong>Could not load data.</strong> {((error ?? surveys.error) as Error).message}</div>}

      <section className="card selection-bar" aria-label="Selection and assumptions">
        <label className="inline-field"><span>Road</span>
          <select className="select" value={roadId} onChange={(e) => { setRoadId(e.target.value); setCode('') }}>
            <option value="">All roads</option>
            {roads.map((r) => <option key={r} value={r}>{r}</option>)}
          </select>
        </label>
        <label className="inline-field"><span>Station</span>
          <select className="select" value={code} onChange={(e) => setCode(e.target.value)}>
            <option value="">All stations ({(roadId ? list.filter((s) => s.routeId === roadId) : list).length})</option>
            {(roadId ? [roadId] : roads).map((r) => (
              <optgroup key={r} label={r}>
                {list.filter((s) => s.routeId === r).map((s) => <option key={s.code} value={s.code}>{s.name || s.code} · km {formatMeasure(s.measure)}</option>)}
              </optgroup>
            ))}
          </select>
        </label>
        <span className="sep" aria-hidden />
        <NumberField label="Growth a year" value={growth} placeholder={fitted != null ? (fitted * 100).toFixed(1) : String(DEFAULTS.fallbackGrowth)} onChange={setGrowth} width={72} suffix="%" />
        <NumberField label="Forecast" value={horizon} placeholder={String(DEFAULTS.horizon)} onChange={(n) => setHorizon(n == null ? null : Math.max(1, Math.min(50, Math.round(n))))} width={60} suffix="years" />
        <NumberField label="Design loading" value={design} placeholder={String(DEFAULTS.design)} onChange={(n) => setDesign(n != null && n > 0 ? n : null)} width={72} suffix="million E80" />
        <NumberField label="Built or overlaid" value={built} placeholder={builtYear != null ? String(builtYear) : ''} onChange={(n) => setBuilt(n == null ? null : Math.round(n))} width={72} />
        <NumberField label="Design lane" value={lane} placeholder={String(DEFAULTS.lane)} onChange={(n) => setLane(n != null && n > 0 && n <= 100 ? n : null)} width={64} suffix="% of traffic" />
      </section>

      <section className="kpis compact">
        <div className="card kpi">
          <div className="label">Traffic now{latest ? ` · ${latest.year}` : ''}</div>
          <div className="value"><KpiIcon name="vehicles" colour="var(--accent)" /><span>{fmt(latest?.value ?? null)}<small>a day</small></span></div>
        </div>
        <div className="card kpi">
          <div className="label">Growth a year</div>
          <div className="value"><KpiIcon name={rate > 0.005 ? 'rising' : rate < -0.005 ? 'falling' : 'stable'} colour={rate > 0.005 ? 'var(--danger)' : rate < -0.005 ? 'var(--ok)' : 'var(--muted)'} /><span>{pctFmt(rate)}<small>{growth != null ? 'entered' : fitted != null ? 'from counts' : 'assumed'}</small></span></div>
        </div>
        <div className="card kpi">
          <div className="label">Traffic in {latest ? latest.year + horizonYears : '—'}</div>
          <div className="value"><KpiIcon name="average" colour="var(--accent)" /><span>{fmt(forecast)}<small>a day</small></span></div>
        </div>
        <div className="card kpi">
          <div className="label">Axle loading a day</div>
          <div className="value"><KpiIcon name="congested" colour="var(--accent)" /><span>{fmt(e80Day, 0)}<small>E80</small></span></div>
        </div>
        <div className="card kpi">
          <div className="label">Loading used so far</div>
          <div className="value"><KpiIcon name="calendar" colour="var(--accent)" /><span>{life ? fmt(life.consumed, 2) : '—'}<small>of {fmt(designMsa, 1)} million</small></span></div>
        </div>
        <div className="card kpi">
          <div className="label">Remaining life{life?.year ? ` · to ${life.year}` : ''}</div>
          <div className="value">
            <KpiIcon name={life?.remaining === 0 ? 'over' : 'free'} colour={life?.remaining === 0 ? 'var(--danger)' : 'var(--ok)'} />
            <span>{lifeText}</span>
          </div>
        </div>
      </section>

      {surveys.isLoading ? (
        <div className="skeleton" style={{ height: 280 }} />
      ) : !latest ? (
        <div className="card placeholder">No counts to work from for this selection.</div>
      ) : (
        <>
          <div className="trend-pair growth-charts">
            <section className="card">
              <h3>Traffic a day: counted and forecast{station ? ` · ${station.name || station.code}` : roadId ? ` · ${roadId}` : ''}</h3>
              <div className="chart-legend">
                <span><i className="swatch" style={{ background: 'var(--accent)' }} />Counted</span>
                <span><i className="swatch dashed" />Forecast at {pctFmt(rate)} a year</span>
              </div>
              <ResponsiveContainer width="100%" height={260}>
                <LineChart data={trafficChart} margin={{ top: 10, right: 16, bottom: 0, left: 0 }}>
                  <CartesianGrid vertical={false} className="chart-grid" />
                  <XAxis dataKey="year" tickLine={false} axisLine={false} tickMargin={6} minTickGap={18} />
                  <YAxis tickLine={false} axisLine={false} width={48} tickFormatter={(v: number) => fmt(v)} domain={[0, 'auto']} />
                  <Tooltip content={<Tip unit="" />} cursor={{ className: 'chart-cursor-line' }} />
                  <Line name="Forecast" dataKey="forecast" type="monotone" className="growth-fore" strokeWidth={2} strokeDasharray="6 5" dot={false} isAnimationActive={false} connectNulls />
                  <Line name="Counted" dataKey="counted" type="linear" className="growth-hist" strokeWidth={2.4} dot={{ r: 4 }} isAnimationActive={false} connectNulls />
                </LineChart>
              </ResponsiveContainer>
            </section>

            <section className="card">
              <h3>Axle loading carried and ahead, against the design loading</h3>
              <div className="chart-legend">
                <span><i className="swatch" style={{ background: 'var(--accent)' }} />Carried so far</span>
                <span><i className="swatch dashed" />Still to come</span>
                <span><i className="swatch" style={{ background: 'var(--danger)' }} />Design loading, {fmt(designMsa, 1)} million</span>
              </div>
              {model ? (
                <ResponsiveContainer width="100%" height={260}>
                  <LineChart data={loadChart} margin={{ top: 10, right: 16, bottom: 0, left: 0 }}>
                    <CartesianGrid vertical={false} className="chart-grid" />
                    <XAxis dataKey="year" tickLine={false} axisLine={false} tickMargin={6} minTickGap={18} />
                    <YAxis tickLine={false} axisLine={false} width={40} tickFormatter={(v: number) => fmt(v, 1)} domain={[0, (max: number) => Math.max(max, designMsa) * 1.1]} />
                    <ReferenceLine y={designMsa} stroke="var(--danger)" strokeDasharray="4 4" ifOverflow="extendDomain" />
                    <Tooltip content={<Tip unit="MSA" />} cursor={{ className: 'chart-cursor-line' }} />
                    <Line name="Still to come" dataKey="ahead" type="monotone" className="growth-fore" strokeWidth={2} strokeDasharray="6 5" dot={false} isAnimationActive={false} connectNulls />
                    <Line name="Carried so far" dataKey="carried" type="monotone" className="growth-hist" strokeWidth={2.4} dot={false} isAnimationActive={false} connectNulls />
                  </LineChart>
                </ResponsiveContainer>
              ) : <div className="placeholder">No vehicle types were counted at these stations, so the axle loading cannot be worked out.</div>}
              {used != null && (
                <div className="life-bar" role="img" aria-label={`${Math.round(used * 100)}% of the design loading used`}>
                  <span style={{ width: `${used * 100}%`, background: used >= 1 ? 'var(--danger)' : used > 0.8 ? 'var(--warn)' : 'var(--accent)' }} />
                  <em>{Math.round(used * 100)}% used</em>
                </div>
              )}
            </section>
          </div>

          <section className="card table-card no-limit">
            <div className="card-head">
              <h3>Axle loading by vehicle type</h3>
              <button className="btn" onClick={() => setVdf(VDF_DEFAULTS)} disabled={STATION_TYPES.every((t) => vdf[t.key] === VDF_DEFAULTS[t.key])}>Reset factors</button>
            </div>
            <div className="table-scroll">
              <table className="data compact">
                <thead>
                  <tr><th>Vehicle type</th><th className="num">Counted</th><th className="num">Share of traffic</th><th className="num">A day</th><th className="num">Damage factor (E80 each)</th><th className="num">E80 a day</th><th>Share of loading</th></tr>
                </thead>
                <tbody>
                  {mix.map((c) => {
                    const type = STATION_TYPES.find((t) => t.key === c.key)!
                    const perDay = latest.value * c.share
                    const e80 = perDay * vdf[c.key] * laneShare
                    const loadShare = perVehicle > 0 ? (c.share * vdf[c.key]) / perVehicle : 0
                    return (
                      <tr key={c.key}>
                        <td><span className="type-cell"><VehicleIcon type={type.icon} size={18} />{c.label}</span></td>
                        <td className="num">{fmt(c.count)}</td>
                        <td className="num">{(c.share * 100).toFixed(1)}%</td>
                        <td className="num">{fmt(perDay)}</td>
                        <td className="num">
                          <input
                            className="input vdf-input" inputMode="decimal" defaultValue={vdf[c.key]} key={`${c.key}-${vdf[c.key]}`} aria-label={`Damage factor for ${c.label}`}
                            onBlur={(e) => { const n = Number(e.target.value.replace(',', '.')); if (Number.isFinite(n) && n >= 0 && n !== vdf[c.key]) setVdf({ ...vdf, [c.key]: n }) }}
                            onKeyDown={(e) => { if (e.key === 'Enter') (e.target as HTMLInputElement).blur() }}
                          />
                        </td>
                        <td className="num"><strong>{fmt(e80, e80 < 10 ? 1 : 0)}</strong></td>
                        <td>
                          <div className="share-bar" aria-hidden><span style={{ width: `${loadShare * 100}%` }} /></div>
                          <span className="share-text">{(loadShare * 100).toFixed(0)}%</span>
                        </td>
                      </tr>
                    )
                  })}
                </tbody>
                <tfoot>
                  <tr>
                    <td><strong>All traffic</strong></td><td className="num">{fmt(mix.reduce((s, c) => s + c.count, 0))}</td><td className="num">100%</td>
                    <td className="num">{fmt(latest.value)}</td>
                    <td className="num"><strong>{perVehicle.toFixed(3)}</strong> avg</td>
                    <td className="num"><strong>{fmt(e80Day, 0)}</strong></td><td />
                  </tr>
                </tfoot>
              </table>
            </div>
          </section>

          <section className="card table-card">
            <div className="card-head"><h3>Traffic counted, year by year</h3></div>
            <div className="table-scroll">
              <table className="data compact">
                <thead><tr><th>Survey year</th><th className="num">Traffic a day</th><th className="num">Change on the year before</th></tr></thead>
                <tbody>
                  {[...history].reverse().map((h, i, arr) => {
                    const before = arr[i + 1]
                    const change = before ? (h.value / before.value) ** (1 / Math.max(1, h.year - before.year)) - 1 : null
                    return (
                      <tr key={h.year}>
                        <td>{formatSurveyYear(h.label)}</td><td className="num">{fmt(h.value)}</td>
                        <td className="num">{change == null ? '—' : <strong style={{ color: change > 0 ? 'var(--danger)' : change < 0 ? 'var(--ok)' : undefined }}>{pctFmt(change)}</strong>}</td>
                      </tr>
                    )
                  })}
                </tbody>
              </table>
            </div>
          </section>
        </>
      )}
    </main>
  )
}
