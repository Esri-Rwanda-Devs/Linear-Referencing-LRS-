import { useMemo } from 'react'
import {
  Bar, BarChart, CartesianGrid, Line, LineChart, ReferenceLine, ResponsiveContainer, Tooltip, XAxis, YAxis,
  type DotProps, type TooltipProps,
} from 'recharts'
import { BAND_COLOURS, BAND_STATUS, DIRECTIONS, VC_THRESHOLDS, vcBand, type VcBand } from '../config/parameters'
import { formatSurveyYear, surveysByStation, useSurveys, vcTrend, yearsInScope, type Trend } from '../lib/trafficCounts'

const fmt = (n: number | null, d = 0) =>
  n == null ? '—' : n.toLocaleString('en-US', { maximumFractionDigits: d, minimumFractionDigits: d })

const THRESHOLDS: { value: number; label: string }[] = [
  { value: VC_THRESHOLDS.freeFlow, label: String(VC_THRESHOLDS.freeFlow) },
  { value: VC_THRESHOLDS.congested, label: String(VC_THRESHOLDS.congested) },
  { value: VC_THRESHOLDS.over, label: 'Capacity' },
]
const BANDS: VcBand[] = ['free', 'near', 'congested', 'over']

/** "Rising", "Falling" or "Stable", always with an arrow and the numbers, never colour alone. */
export function TrendBadge({ trend, what = 'V/C' }: { trend: Trend | null; what?: string }) {
  if (!trend) return <span className="pill trend-pill">One survey only, no trend yet</span>
  const arrow = trend.direction === 'rising' ? '▲' : trend.direction === 'falling' ? '▼' : '▶'
  const word = trend.direction === 'rising' ? 'Rising' : trend.direction === 'falling' ? 'Falling' : 'Stable'
  const tone = trend.direction === 'rising' ? 'danger' : trend.direction === 'falling' ? '' : 'neutral'
  // The change is taken from the rounded values shown, so the numbers in the badge add up.
  const shown = (v: number) => Math.round(v * 100) / 100
  const change = shown(trend.last.vc) - shown(trend.first.vc)
  const sign = change > 0 ? '+' : change < 0 ? '−' : '±'
  return (
    <span className={`pill trend-pill ${tone}`}>
      <span aria-hidden>{arrow}</span> {word}: {what} {fmt(trend.first.vc, 2)} → {fmt(trend.last.vc, 2)} ({sign}{fmt(Math.abs(change), 2)}),{' '}
      {formatSurveyYear(trend.first.year)} to {formatSurveyYear(trend.last.year)}
    </span>
  )
}

function BandDot({ cx, cy, payload }: DotProps & { payload?: { vc: number | null } }) {
  if (cx == null || cy == null || payload?.vc == null) return null
  return <circle cx={cx} cy={cy} r={5} fill={BAND_COLOURS[vcBand(payload.vc)]} className="band-dot" />
}

function VcTip({ active, payload }: TooltipProps<number, string>) {
  if (!active || !payload?.length) return null
  const p = payload[0].payload as { year: string; vc: number | null; extra?: string }
  return (
    <div className="chart-tip">
      <div className="chart-tip-head">{formatSurveyYear(p.year)}</div>
      <div className="chart-tip-row">
        <i className="swatch" style={{ background: BAND_COLOURS[vcBand(p.vc)] }} />V/C<strong>{fmt(p.vc, 2)}</strong>
      </div>
      <div className="chart-tip-row">{BAND_STATUS[vcBand(p.vc)]}</div>
      {p.extra && <div className="chart-tip-row">{p.extra}</div>}
    </div>
  )
}

function VcLine({ data, height }: { data: { year: string; vc: number | null; extra?: string }[]; height: number }) {
  // Round steps (0.3 up to 1.5, then 0.5) so the axis reads 0.6, 0.9, 1.2 rather than 0.8, 2.3.
  const raw = Math.max(1.1, ...data.map((d) => d.vc ?? 0)) * 1.08
  const step = raw > 1.5 ? 0.5 : 0.3
  const top = Math.ceil(raw / step) * step
  const ticks = Array.from({ length: Math.round(top / step) + 1 }, (_, i) => Math.round(i * step * 10) / 10)
  // Thresholds 0.25 apart overlap on a tall scale; then only the capacity line keeps its label.
  const roomy = (0.25 / top) * (height - 40) >= 14
  return (
    <ResponsiveContainer width="100%" height={height}>
      <LineChart data={data} margin={{ top: 10, right: 58, bottom: 0, left: 0 }}>
        <CartesianGrid vertical={false} className="chart-grid" />
        <XAxis dataKey="year" tickFormatter={formatSurveyYear} tickLine={false} axisLine={false} tickMargin={6} padding={{ left: 14, right: 14 }} />
        <YAxis domain={[0, top]} ticks={ticks} tickLine={false} axisLine={false} width={36} tickFormatter={(v: number) => fmt(v, 1)} />
        {THRESHOLDS.map((t) => (
          <ReferenceLine key={t.value} y={t.value} className="threshold" ifOverflow="extendDomain"
            label={roomy || t.value === VC_THRESHOLDS.over ? { value: t.label, position: 'right', className: 'threshold-label' } : undefined} />
        ))}
        <Tooltip content={<VcTip />} cursor={{ className: 'chart-cursor-line' }} />
        <Line type="linear" dataKey="vc" className="vc-line" strokeWidth={2} dot={<BandDot />} activeDot={{ r: 7, className: 'band-dot' }} connectNulls isAnimationActive={false} />
      </LineChart>
    </ResponsiveContainer>
  )
}

/** V/C and daily traffic of one count station, survey year by survey year. */
export function StationVcTrend({ code, badge = true, wide = false }: { code: string; badge?: boolean; wide?: boolean }) {
  const surveys = useSurveys()
  const rows = useMemo(() => surveysByStation(surveys.data ?? []).get(code) ?? [], [surveys.data, code])
  const trend = useMemo(() => vcTrend(rows), [rows])

  if (surveys.isLoading) return <div className="skeleton" style={{ height: 180 }} />
  if (surveys.error) return <div className="placeholder">Could not load the survey years: {(surveys.error as Error).message}</div>
  if (!rows.length) return <div className="placeholder">No hourly counts are stored for this station.</div>

  return (
    <div className={`vc-trend${wide ? ' wide' : ''}`}>
      {badge && <TrendBadge trend={trend} />}
      <VcLine height={wide ? 230 : 170} data={rows.map((r) => ({ year: r.year, vc: r.vc, extra: `${fmt(r.daily)} vehicles a day` }))} />
      <table className="data compact trend-table">
        <thead><tr><th>Survey year</th><th className="num">V/C</th><th className="num">Vehicles a day</th>{DIRECTIONS.map((d) => <th key={d} className="num">{d}</th>)}</tr></thead>
        <tbody>
          {[...rows].reverse().map((r) => (
            <tr key={r.year}>
              <td>{formatSurveyYear(r.year)}</td>
              <td className="num"><i className="dot" style={{ background: BAND_COLOURS[vcBand(r.vc)] }} /><strong>{fmt(r.vc, 2)}</strong></td>
              <td className="num">{fmt(r.daily)}</td>
              {DIRECTIONS.map((d) => <td key={d} className="num">{fmt(r.dailyByDir[d])}</td>)}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  )
}

function ShareTip({ active, payload }: TooltipProps<number, string>) {
  if (!active || !payload?.length) return null
  const p = payload[0].payload as { year: string; n: number } & Record<VcBand, number>
  return (
    <div className="chart-tip">
      <div className="chart-tip-head">{formatSurveyYear(p.year)} <span>{p.n} stations</span></div>
      {[...BANDS].reverse().map((b) => (
        <div key={b} className="chart-tip-row"><i className="swatch" style={{ background: BAND_COLOURS[b] }} />{BAND_STATUS[b]}<strong>{p[b]}</strong></div>
      ))}
    </div>
  )
}

/** How congestion changes from year to year across the stations in view. */
export function NetworkVcTrend({ codes, scope, id }: { codes: Set<string>; scope: string; id?: string }) {
  const surveys = useSurveys()
  const years = useMemo(
    () => yearsInScope(surveys.data ?? [], codes).map((y) => ({ ...y, extra: `Average of ${y.n} stations` })),
    [surveys.data, codes],
  )
  const trend = useMemo(() => vcTrend(years), [years])

  return (
    <section className="card network-trend" id={id}>
      <div className="card-head">
        <div>
          <h3>Network trend across survey years</h3>
          <p className="muted-note">{scope}. Each year includes the stations counted that year, so the number of stations changes.</p>
        </div>
        {!surveys.isLoading && years.length > 0 && <TrendBadge trend={trend} what="average V/C" />}
      </div>
      {surveys.isLoading ? (
        <div className="skeleton" style={{ height: 220 }} />
      ) : surveys.error ? (
        <div className="error-box" role="alert"><strong>Could not load hourly counts.</strong> {(surveys.error as Error).message}</div>
      ) : years.length === 0 ? (
        <div className="placeholder">None of the stations in view have hourly counts.</div>
      ) : (
        <div className="trend-pair">
          <div>
            <div className="sub-h">Average V/C</div>
            <VcLine height={220} data={years} />
          </div>
          <div>
            <div className="sub-h">Stations by congestion status</div>
            <ResponsiveContainer width="100%" height={220}>
              <BarChart data={years} margin={{ top: 10, right: 8, bottom: 0, left: 0 }} barCategoryGap="28%">
                <CartesianGrid vertical={false} className="chart-grid" />
                <XAxis dataKey="year" tickFormatter={formatSurveyYear} tickLine={false} axisLine={false} tickMargin={6} />
                <YAxis allowDecimals={false} tickLine={false} axisLine={false} width={32} />
                <Tooltip content={<ShareTip />} cursor={{ className: 'chart-cursor' }} />
                {BANDS.map((b, i) => (
                  <Bar key={b} dataKey={b} stackId="bands" fill={BAND_COLOURS[b]} className="stack-seg" maxBarSize={44}
                    radius={i === BANDS.length - 1 ? [4, 4, 0, 0] : 0} isAnimationActive={false} />
                ))}
              </BarChart>
            </ResponsiveContainer>
            <div className="chart-legend">
              {BANDS.map((b) => <span key={b}><i className="swatch" style={{ background: BAND_COLOURS[b] }} />{BAND_STATUS[b]}</span>)}
            </div>
          </div>
        </div>
      )}
    </section>
  )
}
