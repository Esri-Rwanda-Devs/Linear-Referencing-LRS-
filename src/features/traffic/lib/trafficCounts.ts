import { useQuery } from '@tanstack/react-query'
import {
  COUNT_PERIODS, DIRECTIONS, LAYERS, VC_TREND_STABLE, vcBand, type Direction, type PeriodKey,
} from '../config/parameters'
import { queryStats, sqlText } from './arcgis'

// Traffic_Count holds one row per station, survey day, hour and direction (24 x 2 rows a day).
// Everything here is aggregated on the server; only grouped totals come back.

/** One station's survey in one survey year, both directions together. */
export interface Survey {
  code: string
  name: string
  year: string
  /** Days counted (a survey week is 7). */
  days: number
  /** Vehicles per day, both directions, averaged over the days counted. */
  daily: number
  dailyByDir: Record<Direction, number>
  vc: number | null
  adt: number | null
  from: Date | null
  to: Date | null
  /** For an aggregate over several stations: how many were counted. */
  stations?: number
}

/** Stands for "all the stations in view" wherever a single station code is expected. */
export const ALL_STATIONS = '*'

export interface HourPoint {
  hour: number
  /** "07:00", the start of the hour. */
  label: string
  Up: number
  Down: number
  total: number
}

const num = (v: unknown): number | null => (typeof v === 'number' && Number.isFinite(v) ? v : null)
const str = (v: unknown): string => (typeof v === 'string' ? v.trim() : '')
const isDirection = (v: string): v is Direction => (DIRECTIONS as readonly string[]).includes(v)
const pad = (h: number) => `${String(h).padStart(2, '0')}:00`

/** "2020_2021" -> "2020/21". */
export const formatSurveyYear = (y: string) => {
  const m = /^(\d{4})_(\d{2})(\d{2})$/.exec(y)
  return m ? `${m[1]}/${m[3]}` : y.replace('_', '/')
}

/** "07:00 - 08:00" -> 7. */
const hourOf = (time: string): number | null => {
  const m = /^(\d{1,2}):\d{2}/.exec(time)
  const h = m ? Number(m[1]) : NaN
  return h >= 0 && h < 24 ? h : null
}

const NOT_DELETED = '(isdeleted IS NULL OR isdeleted <> 1)'

async function loadSurveys(): Promise<Survey[]> {
  const rows = await queryStats(LAYERS.counts, {
    where: NOT_DELETED,
    groupBy: ['stationcode', 'stationname', 'surveyyear', 'trfdir'],
    stats: [
      { type: 'count', field: 'objectid', as: 'n' },
      { type: 'sum', field: 'vehicles', as: 'total' },
      { type: 'avg', field: 'vcr', as: 'vc' },
      { type: 'avg', field: 'avgadt', as: 'adt' },
      { type: 'min', field: 'survey_date', as: 'd0' },
      { type: 'max', field: 'survey_date', as: 'd1' },
    ],
  })

  const byKey = new Map<string, Survey>()
  for (const r of rows) {
    const code = str(r.stationcode)
    const year = str(r.surveyyear)
    const dir = str(r.trfdir)
    if (!code || !year || !isDirection(dir)) continue
    const key = `${code}|${year}`
    const s = byKey.get(key) ?? {
      code, name: str(r.stationname), year, days: 0, daily: 0, dailyByDir: { Up: 0, Down: 0 },
      vc: num(r.vc), adt: num(r.adt), from: null, to: null,
    }
    const days = (num(r.n) ?? 0) / 24
    s.days = Math.max(s.days, days)
    s.dailyByDir[dir] = days > 0 ? (num(r.total) ?? 0) / days : 0
    s.daily = DIRECTIONS.reduce((sum, d) => sum + s.dailyByDir[d], 0)
    const d0 = num(r.d0), d1 = num(r.d1)
    if (d0 != null && (!s.from || d0 < s.from.getTime())) s.from = new Date(d0)
    if (d1 != null && (!s.to || d1 > s.to.getTime())) s.to = new Date(d1)
    byKey.set(key, s)
  }
  return [...byKey.values()].sort((a, b) => a.code.localeCompare(b.code) || a.year.localeCompare(b.year))
}

/** The average day for whatever the where clause selects: vehicles in each hour, per direction. */
async function loadHourPoints(where: string): Promise<HourPoint[]> {
  const rows = await queryStats(LAYERS.counts, {
    where,
    groupBy: ['time', 'trfdir'],
    stats: [{ type: 'avg', field: 'vehicles', as: 'avg' }],
  })
  const hours: HourPoint[] = Array.from({ length: 24 }, (_, hour) => ({ hour, label: pad(hour), Up: 0, Down: 0, total: 0 }))
  for (const r of rows) {
    const hour = hourOf(str(r.time))
    const dir = str(r.trfdir)
    if (hour == null || !isDirection(dir)) continue
    hours[hour][dir] = num(r.avg) ?? 0
  }
  for (const h of hours) h.total = h.Up + h.Down
  return hours
}

/** The average day at one station in one survey year. */
const loadHours = (code: string, year: string) =>
  loadHourPoints(`stationcode = ${sqlText(code)} AND surveyyear = ${sqlText(year)} AND ${NOT_DELETED}`)

/** The average hour of the average station in one survey year; the stations are all of them, or the given codes. */
const loadScopeHours = (year: string, codes: string[] | null) =>
  loadHourPoints(`surveyyear = ${sqlText(year)}${codes ? ` AND stationcode IN (${codes.map(sqlText).join(',')})` : ''} AND ${NOT_DELETED}`)

export function useSurveys(enabled = true) {
  return useQuery({ queryKey: ['count-surveys'], queryFn: loadSurveys, staleTime: Infinity, enabled })
}

export function useHours(code: string | null, year: string | null) {
  return useQuery({
    queryKey: ['count-hours', code, year],
    queryFn: () => loadHours(code!, year!),
    enabled: !!code && !!year,
    staleTime: Infinity,
  })
}

export function useScopeHours(year: string | null, codes: string[] | null, enabled: boolean) {
  return useQuery({
    queryKey: ['count-scope-hours', year, codes ? codes.join(',') : null],
    queryFn: () => loadScopeHours(year!, codes),
    enabled: enabled && !!year && (codes == null || codes.length > 0),
    staleTime: Infinity,
  })
}

/** One survey per year for a group of stations: each figure is the average over the stations counted that year. */
export function aggregateSurveys(surveys: Survey[], codes: Set<string> | null): Survey[] {
  const byYear = new Map<string, Survey[]>()
  for (const s of surveys) {
    if (codes && !codes.has(s.code)) continue
    byYear.set(s.year, [...(byYear.get(s.year) ?? []), s])
  }
  const mean = (xs: (number | null)[]) => {
    const v = xs.filter((x): x is number => x != null)
    return v.length ? v.reduce((a, b) => a + b, 0) / v.length : null
  }
  return [...byYear.entries()].sort(([a], [b]) => a.localeCompare(b)).map(([year, list]) => {
    const dir = (d: Direction) => mean(list.map((s) => s.dailyByDir[d])) ?? 0
    const dailyByDir = { Up: dir('Up'), Down: dir('Down') }
    const dates = (key: 'from' | 'to') => list.map((s) => s[key]).filter((d): d is Date => d != null).map((d) => d.getTime())
    const from = dates('from'), to = dates('to')
    return {
      code: ALL_STATIONS, name: 'All stations', year, stations: list.length,
      days: Math.max(...list.map((s) => s.days)),
      daily: dailyByDir.Up + dailyByDir.Down,
      dailyByDir,
      vc: mean(list.map((s) => s.vc)),
      adt: mean(list.map((s) => s.adt)),
      from: from.length ? new Date(Math.min(...from)) : null,
      to: to.length ? new Date(Math.max(...to)) : null,
    }
  })
}

/** Surveys of each station, oldest year first. */
export function surveysByStation(surveys: Survey[]): Map<string, Survey[]> {
  const m = new Map<string, Survey[]>()
  for (const s of surveys) m.set(s.code, [...(m.get(s.code) ?? []), s])
  return m
}

// ---- Periods ----

export const periodOf = (hour: number): PeriodKey =>
  COUNT_PERIODS.find((p) => hour >= p.from && hour < p.to)?.key ?? 'offpeak'

export const hourRange = (from: number, to: number) => `${pad(from)}–${pad(to % 24)}`

export interface PeriodSummary {
  key: PeriodKey
  label: string
  hours: number[]
  byDir: Record<Direction, number>
  total: number
  perHour: number
  /** Share of the day's vehicles. */
  share: number
}

export interface PeakHour {
  hour: number
  total: number
  byDir: Record<Direction, number>
}

export interface DaySummary {
  periods: PeriodSummary[]
  am: PeakHour | null
  pm: PeakHour | null
  nightPerHour: number
  daily: number
  dirShare: Record<Direction, number>
}

const busiest = (hours: HourPoint[], key: PeriodKey): PeakHour | null => {
  const inPeriod = hours.filter((h) => periodOf(h.hour) === key)
  if (!inPeriod.length) return null
  const top = inPeriod.reduce((a, b) => (b.total > a.total ? b : a))
  return { hour: top.hour, total: top.total, byDir: { Up: top.Up, Down: top.Down } }
}

export function summariseDay(hours: HourPoint[]): DaySummary {
  const daily = hours.reduce((s, h) => s + h.total, 0)
  const keys: { key: PeriodKey; label: string }[] = [
    ...COUNT_PERIODS.filter((p) => p.key !== 'night'),
    { key: 'offpeak', label: 'Off-peak' },
    ...COUNT_PERIODS.filter((p) => p.key === 'night'),
  ]
  const periods = keys.map(({ key, label }) => {
    const inPeriod = hours.filter((h) => periodOf(h.hour) === key)
    const byDir = { Up: 0, Down: 0 }
    for (const h of inPeriod) for (const d of DIRECTIONS) byDir[d] += h[d]
    const total = byDir.Up + byDir.Down
    return {
      key, label, hours: inPeriod.map((h) => h.hour), byDir, total,
      perHour: inPeriod.length ? total / inPeriod.length : 0,
      share: daily > 0 ? total / daily : 0,
    }
  })
  const up = hours.reduce((s, h) => s + h.Up, 0)
  return {
    periods,
    am: busiest(hours, 'am'),
    pm: busiest(hours, 'pm'),
    nightPerHour: periods.find((p) => p.key === 'night')?.perHour ?? 0,
    daily,
    dirShare: { Up: daily > 0 ? up / daily : 0, Down: daily > 0 ? 1 - up / daily : 0 },
  }
}

/** Hours of a period, written as ranges: "07:00–09:00" or "05:00–07:00, 09:00–17:00". */
export function periodRanges(hours: number[]): string {
  const ranges: [number, number][] = []
  for (const h of [...hours].sort((a, b) => a - b)) {
    const last = ranges[ranges.length - 1]
    if (last && last[1] === h) last[1] = h + 1
    else ranges.push([h, h + 1])
  }
  return ranges.map(([a, b]) => hourRange(a, b)).join(', ')
}

// ---- Findings ----

export type FindingTone = 'danger' | 'warn' | 'ok' | 'neutral'

/** One plain-language answer to a question a reader brings to a station. */
export interface Finding {
  key: 'congestion' | 'trend' | 'busiest' | 'direction'
  title: string
  text: string
  tone: FindingTone
}

const twoDp = (n: number) => n.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })
const whole = (n: number) => Math.round(n).toLocaleString('en-US')

/**
 * The four questions, answered for one station: how congested, getting better or worse,
 * when it is busiest, and which way the traffic goes.
 */
export function stationFindings(survey: Survey | null, summary: DaySummary | null, trend: Trend | null): Finding[] {
  const out: Finding[] = []
  if (survey?.vc != null) {
    const vc = survey.vc
    const [status, tone]: [string, FindingTone] =
      vc > 1 ? ['Over capacity', 'danger'] : vc > 0.85 ? ['Congested', 'danger'] : vc >= 0.6 ? ['Near capacity', 'warn'] : ['Free flow', 'ok']
    out.push({ key: 'congestion', title: 'Congestion', tone, text: `${status}: V/C ${twoDp(vc)} in ${formatSurveyYear(survey.year)}.` })
  }

  if (trend) {
    const change = Math.round(trend.last.vc * 100) / 100 - Math.round(trend.first.vc * 100) / 100
    const since = formatSurveyYear(trend.first.year)
    out.push({
      key: 'trend',
      title: 'Year on year',
      tone: trend.direction === 'rising' ? 'danger' : trend.direction === 'falling' ? 'ok' : 'neutral',
      text: trend.direction === 'stable'
        ? `Stable since ${since}: V/C ${twoDp(trend.first.vc)} then, ${twoDp(trend.last.vc)} now.`
        : `${trend.direction === 'rising' ? 'Getting worse' : 'Improving'}: V/C ${twoDp(trend.first.vc)} → ${twoDp(trend.last.vc)} since ${since} (${change > 0 ? '+' : '−'}${twoDp(Math.abs(change))}).`,
    })
  } else if (survey) {
    out.push({ key: 'trend', title: 'Year on year', tone: 'neutral', text: 'Counted in one survey year only, so there is no trend yet.' })
  }

  if (summary?.am && summary.pm) {
    const top = summary.pm.total >= summary.am.total ? summary.pm : summary.am
    const other = top === summary.pm ? summary.am : summary.pm
    const busier = other.total > 0 ? Math.round(((top.total - other.total) / other.total) * 100) : null
    out.push({
      key: 'busiest',
      title: 'Busiest hour',
      tone: 'neutral',
      text: `${hourRange(top.hour, top.hour + 1)}, ${whole(top.total)} vehicles an hour.` +
        (busier ? ` The ${top === summary.pm ? 'PM' : 'AM'} peak is ${busier}% busier than the ${top === summary.pm ? 'AM' : 'PM'} peak.` : ' Both peaks carry the same traffic.'),
    })
  }

  if (summary && summary.daily > 0) {
    const [major, minor] = [...DIRECTIONS].sort((a, b) => summary.dirShare[b] - summary.dirShare[a])
    const share = Math.round(summary.dirShare[major] * 100)
    out.push({
      key: 'direction',
      title: 'Direction',
      tone: 'neutral',
      text: share <= 53
        ? `Balanced: ${major} ${share}%, ${minor} ${100 - share}% of ${whole(summary.daily)} vehicles a day.`
        : `${major} carries ${share}% of the ${whole(summary.daily)} vehicles a day.`,
    })
  }
  return out
}

export interface ScopeYear {
  year: string
  /** Stations counted that year. */
  n: number
  /** Average V/C of those stations. */
  vc: number
  free: number
  near: number
  congested: number
  over: number
}

/** Average V/C and stations per congestion band, year by year, for the given stations. */
export function yearsInScope(surveys: Survey[], codes: Set<string>): ScopeYear[] {
  const m = new Map<string, number[]>()
  for (const s of surveys) {
    if (!codes.has(s.code) || s.vc == null) continue
    m.set(s.year, [...(m.get(s.year) ?? []), s.vc])
  }
  return [...m.entries()].sort(([a], [b]) => a.localeCompare(b)).map(([year, vcs]) => {
    const y: ScopeYear = { year, n: vcs.length, vc: vcs.reduce((s, v) => s + v, 0) / vcs.length, free: 0, near: 0, congested: 0, over: 0 }
    for (const v of vcs) y[vcBand(v) as 'free' | 'near' | 'congested' | 'over']++
    return y
  })
}

// ---- Trend ----

export type TrendDirection = 'rising' | 'falling' | 'stable'

export interface Trend {
  direction: TrendDirection
  first: { year: string; vc: number }
  last: { year: string; vc: number }
  change: number
}

/** Compares the first and last surveyed years that have a V/C. */
export function vcTrend(points: { year: string; vc: number | null }[]): Trend | null {
  const withVc = points.filter((p): p is { year: string; vc: number } => p.vc != null)
  if (withVc.length < 2) return null
  const first = withVc[0], last = withVc[withVc.length - 1]
  const change = last.vc - first.vc
  const direction = Math.abs(change) < VC_TREND_STABLE ? 'stable' : change > 0 ? 'rising' : 'falling'
  return { direction, first, last, change }
}
