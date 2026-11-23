import {
  Bar, BarChart, CartesianGrid, ReferenceArea, ResponsiveContainer, Tooltip, XAxis, YAxis,
  type TooltipProps,
} from 'recharts'
import { COUNT_PERIODS, DIRECTIONS } from '../config/parameters'
import {
  hourRange, periodOf, periodRanges, type DaySummary, type HourPoint, type PeakHour,
} from '../lib/trafficCounts'

const fmt = (n: number | null, d = 0) =>
  n == null ? '—' : n.toLocaleString('en-US', { maximumFractionDigits: d, minimumFractionDigits: d })
const pct = (share: number) => `${Math.round(share * 100)}%`

const PERIOD_LABELS: Record<string, string> = { am: 'AM peak', pm: 'PM peak', night: 'Night', offpeak: 'Off-peak' }

function periodHours(key: 'am' | 'pm' | 'night'): number[] {
  const p = COUNT_PERIODS.find((x) => x.key === key)!
  return Array.from({ length: p.to - p.from }, (_, i) => p.from + i)
}

function DirSplit({ byDir }: { byDir: Record<string, number> }) {
  const total = DIRECTIONS.reduce((s, d) => s + byDir[d], 0)
  if (!total) return null
  return <>{DIRECTIONS.map((d) => `${d} ${pct(byDir[d] / total)}`).join(' · ')}</>
}

/** The average vehicles per hour over the peak period, then its busiest single hour (max veh/hr) and when it falls. */
function PeakTile({ label, average, peak }: { label: string; average: number | null; peak: PeakHour | null }) {
  return (
    <div className="stat hourly-kpi">
      <div className="label">{label}</div>
      <div className="value">{average != null ? fmt(average) : '—'}<small>veh/hr</small></div>
      {peak && (
        <div className="hint">
          Max <strong>{fmt(peak.total)} veh/hr</strong> · {hourRange(peak.hour, peak.hour + 1)}
          <br /><DirSplit byDir={peak.byDir} />
        </div>
      )}
    </div>
  )
}

/** AM peak, PM peak, how they compare, and the night average. */
export function PeakTiles({ summary }: { summary: DaySummary | null }) {
  const am = summary?.am ?? null
  const pm = summary?.pm ?? null
  const diff = am && pm && am.total > 0 ? pm.total - am.total : null
  return (
    <div className="hourly-kpis">
      <PeakTile label={`AM peak, average (${periodRanges(periodHours('am'))})`} average={summary?.periods.find((p) => p.key === 'am')?.perHour ?? null} peak={am} />
      <PeakTile label={`PM peak, average (${periodRanges(periodHours('pm'))})`} average={summary?.periods.find((p) => p.key === 'pm')?.perHour ?? null} peak={pm} />
      <div className="stat hourly-kpi">
        <div className="label">Busiest PM hour compared with busiest AM hour</div>
        <div className="value">
          {diff == null ? '—' : `${diff > 0 ? '+' : diff < 0 ? '−' : ''}${fmt(Math.abs((diff / am!.total) * 100), 1)}%`}
        </div>
        {diff != null && <div className="hint">{diff === 0 ? 'Same volume' : `${diff > 0 ? 'PM' : 'AM'} busier by ${fmt(Math.abs(diff))} veh/hr`}</div>}
      </div>
      <div className="stat hourly-kpi">
        <div className="label">Night average ({periodRanges(periodHours('night'))})</div>
        <div className="value">{summary ? fmt(summary.nightPerHour) : '—'}<small>veh/hr</small></div>
        {summary && <div className="hint">Both directions</div>}
      </div>
    </div>
  )
}

function HourTip({ active, payload }: TooltipProps<number, string>) {
  if (!active || !payload?.length) return null
  const h = payload[0].payload as HourPoint
  return (
    <div className="chart-tip">
      <div className="chart-tip-head">{hourRange(h.hour, h.hour + 1)} <span>{PERIOD_LABELS[periodOf(h.hour)]}</span></div>
      {DIRECTIONS.map((d) => (
        <div key={d} className="chart-tip-row"><i className={`swatch dir-${d.toLowerCase()}`} />{d}<strong>{fmt(h[d])}</strong></div>
      ))}
      <div className="chart-tip-row total">Both directions<strong>{fmt(h.total)}</strong></div>
    </div>
  )
}

/** Vehicles in each hour of the average day, Up and Down side by side, with the periods shaded. */
export function HourlyChart({ hours, summary, height = 280 }: { hours: HourPoint[]; summary: DaySummary | null; height?: number }) {
  return (
    <>
      <div className="chart-legend">
        {DIRECTIONS.map((d) => (
          <span key={d}><i className={`swatch dir-${d.toLowerCase()}`} />{d}{summary ? ` · ${pct(summary.dirShare[d])} of daily traffic` : ''}</span>
        ))}
        <span className="period-key"><i className="swatch period-peak" />Peak periods</span>
        <span className="period-key"><i className="swatch period-night" />Night</span>
      </div>
      <div className="hourly-chart">
        <ResponsiveContainer width="100%" height={height}>
          <BarChart data={hours} barGap={2} barCategoryGap="18%" margin={{ top: 22, right: 8, bottom: 0, left: 0 }}>
            {COUNT_PERIODS.map((p) => (
              <ReferenceArea
                key={p.key}
                x1={`${String(p.from).padStart(2, '0')}:00`}
                x2={`${String(p.to - 1).padStart(2, '0')}:00`}
                className={`period-area ${p.key === 'night' ? 'night' : 'peak'}`}
                label={{ value: p.label, position: 'insideTop', offset: -16, className: 'period-label' }}
                ifOverflow="extendDomain"
              />
            ))}
            <CartesianGrid vertical={false} />
            <XAxis dataKey="label" tickLine={false} axisLine={false} interval={2} tickMargin={6} />
            <YAxis tickLine={false} axisLine={false} width={44} tickFormatter={(v: number) => fmt(v)} />
            <Tooltip content={<HourTip />} cursor={{ className: 'chart-cursor' }} />
            {DIRECTIONS.map((d) => (
              <Bar key={d} dataKey={d} name={d} className={`bar dir-${d.toLowerCase()}`} radius={[4, 4, 0, 0]} maxBarSize={14} isAnimationActive={false} />
            ))}
          </BarChart>
        </ResponsiveContainer>
      </div>
    </>
  )
}

/** Vehicles in each period, per direction, with each period's share of the day. */
export function PeriodTable({ summary }: { summary: DaySummary }) {
  return (
    <div className="table-scroll">
      <table className="data period-table">
        <thead>
          <tr><th>Period</th><th>Hours</th>{DIRECTIONS.map((d) => <th key={d} className="num">{d}</th>)}<th className="num">Both directions</th><th className="num">Average per hour</th><th>Share of the day</th></tr>
        </thead>
        <tbody>
          {summary.periods.map((p) => (
            <tr key={p.key}>
              <td><strong>{p.label}</strong></td>
              <td className="muted">{periodRanges(p.hours)}</td>
              {DIRECTIONS.map((d) => <td key={d} className="num">{fmt(p.byDir[d])}</td>)}
              <td className="num"><strong>{fmt(p.total)}</strong></td>
              <td className="num">{fmt(p.perHour)}</td>
              <td>
                <div className="share">
                  <div className="share-track" aria-hidden><div style={{ width: pct(p.share) }} /></div>
                  <span>{pct(p.share)}</span>
                </div>
              </td>
            </tr>
          ))}
        </tbody>
        <tfoot>
          <tr>
            <td colSpan={2}><strong>Whole day</strong></td>
            {DIRECTIONS.map((d) => <td key={d} className="num">{fmt(summary.periods.reduce((s, p) => s + p.byDir[d], 0))}</td>)}
            <td className="num"><strong>{fmt(summary.daily)}</strong></td>
            <td className="num">{fmt(summary.daily / 24)}</td>
            <td />
          </tr>
        </tfoot>
      </table>
    </div>
  )
}
