import { STATION_TYPES, type StationType } from '../config/vehicleClasses'
import type { Station } from './trafficData'

/** The calendar year a survey year starts in: "2025_2026" is 2025. */
export const yearNumber = (surveyYear: string): number => Number.parseInt(surveyYear.slice(0, 4), 10)

export interface YearValue {
  year: number
  value: number
}

/** Compound yearly growth fitted through the points (a straight line through the logarithms). Needs two years. */
export function fitGrowth(points: YearValue[]): number | null {
  const p = points.filter((x) => x.value > 0)
  if (new Set(p.map((x) => x.year)).size < 2) return null
  const n = p.length
  const mx = p.reduce((s, x) => s + x.year, 0) / n
  const my = p.reduce((s, x) => s + Math.log(x.value), 0) / n
  const sxx = p.reduce((s, x) => s + (x.year - mx) ** 2, 0)
  if (sxx === 0) return null
  const slope = p.reduce((s, x) => s + (x.year - mx) * (Math.log(x.value) - my), 0) / sxx
  return Math.exp(slope) - 1
}

export interface ClassShare {
  key: StationType
  label: string
  count: number
  share: number
}

/** The mix of vehicle types counted at the given stations, as shares of all vehicles. */
export function classMix(stations: Pick<Station, 'counts'>[]): ClassShare[] {
  const totals = STATION_TYPES.map((t) => ({
    key: t.key, label: t.label, count: stations.reduce((s, st) => s + (st.counts[t.key] ?? 0), 0), share: 0,
  }))
  const all = totals.reduce((s, t) => s + t.count, 0)
  return totals.map((t) => ({ ...t, share: all > 0 ? t.count / all : 0 }))
}

export interface Loading {
  /** E80 per year in each year, in millions, for the design lane. */
  annual: (year: number) => number
  /** Millions of E80 from the first year through the given year. */
  cumulative: (from: number, to: number) => number
}

/**
 * Traffic and loading grow at a steady rate from the latest count. `perVehicle` is the average damage factor
 * of one vehicle (the mix of types times their factors) and `lane` the share of traffic in the design lane.
 */
export function loadingModel(latest: YearValue, rate: number, perVehicle: number, lane: number): Loading {
  const aadt = (year: number) => latest.value * (1 + rate) ** (year - latest.year)
  const annual = (year: number) => (365 * aadt(year) * perVehicle * lane) / 1e6
  return {
    annual,
    cumulative: (from, to) => {
      let sum = 0
      for (let y = from; y <= to; y++) sum += annual(y)
      return sum
    },
  }
}

export interface Life {
  /** Millions of E80 already carried between the build year and the latest count. */
  consumed: number
  /** Years left from the latest count until the design loading is reached; 0 once it has been passed. */
  remaining: number | null
  /** The year the design loading is reached. */
  year: number | null
}

const HORIZON = 100

/** How much of the design loading is used up, and when the rest will be. */
export function remainingLife(model: Loading, built: number, latestYear: number, design: number): Life {
  const consumed = model.cumulative(built, latestYear)
  if (consumed >= design) {
    let y = built, sum = 0
    while (y <= latestYear && sum + model.annual(y) < design) { sum += model.annual(y); y++ }
    return { consumed, remaining: 0, year: y }
  }
  let sum = consumed
  for (let y = latestYear + 1; y <= latestYear + HORIZON; y++) {
    const next = sum + model.annual(y)
    if (next >= design) {
      const fraction = (design - sum) / (next - sum)
      return { consumed, remaining: y - latestYear - 1 + fraction, year: y }
    }
    sum = next
  }
  return { consumed, remaining: null, year: null }
}
