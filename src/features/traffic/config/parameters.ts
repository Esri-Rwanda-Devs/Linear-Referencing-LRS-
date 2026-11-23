// Planning parameters. The mockup's "Outputs and parameters" screen will edit these later;
// until then they are the single place where thresholds live (nothing is hard-coded in components).

import type { VehicleIconKey } from './vehicleClasses'

export const LAYERS = {
  /** Layer ids in Road_Asset_LRS. Their geometry type is auto-detected at runtime, so order doesn't matter. */
  ids: [15, 16],
  /** Road_Network feature class: the base road lines. Its RouteId is what the map labels show. */
  network: 1,
  /** Traffic_Count table: hourly counts per direction, one survey week per station and survey year. */
  counts: 21,
}

export const VC_THRESHOLDS = {
  freeFlow: 0.6, // below: free flow
  congested: 0.85, // above: congested
  over: 1.0, // above: over capacity
}

export type Los = 'A' | 'B' | 'C' | 'D' | 'E' | 'F'

/** Upper V/C bound for each level of service (A..E); anything higher is F. */
export const LOS_BOUNDS: [Los, number][] = [
  ['A', 0.35],
  ['B', 0.6],
  ['C', 0.75],
  ['D', 0.85],
  ['E', 1.0],
]

export function losFor(vc: number | null): Los | null {
  if (vc == null || Number.isNaN(vc)) return null
  for (const [los, max] of LOS_BOUNDS) if (vc <= max) return los
  return 'F'
}

export type VcBand = 'free' | 'near' | 'congested' | 'over' | 'none'

export function vcBand(vc: number | null): VcBand {
  if (vc == null) return 'none'
  if (vc < VC_THRESHOLDS.freeFlow) return 'free'
  if (vc <= VC_THRESHOLDS.congested) return 'near'
  if (vc <= VC_THRESHOLDS.over) return 'congested'
  return 'over'
}

export const BAND_COLOURS: Record<VcBand, string> = {
  free: '#2f6fb7',
  near: '#e0a458',
  congested: '#b3261e',
  over: '#5c1010',
  none: '#9aa5ad',
}

export const BAND_LABELS: Record<VcBand, string> = {
  free: 'Below 0.6 free flow',
  near: '0.6 to 0.85 near capacity',
  congested: '0.85 to 1.0 congested',
  over: 'Above 1.0 over capacity',
  none: 'No data',
}

/** Short congestion status shown for segments and count stations (same bands, same thresholds). */
export const BAND_STATUS: Record<VcBand, string> = {
  free: 'Free flow',
  near: 'Near capacity',
  congested: 'Congested',
  over: 'Over capacity',
  none: 'No V/C data',
}

// ---- Capacity analysis ----
// Sample defaults taken from the mockup. The "Outputs and parameters" screen will edit these later.
export const CAPACITY_PARAMS = {
  baseCapacityPcuPerHourLane: 1370,
  peakHourSharePct: 8.7,
}

export const PCU_FACTORS: { label: string; value: number; icon: VehicleIconKey }[] = [
  { label: 'Car', value: 1.0, icon: 'car' },
  { label: 'Light goods', value: 1.0, icon: 'lgv' },
  { label: 'Bus', value: 3.0, icon: 'bus' },
  { label: 'Truck, 2 axles', value: 2.0, icon: 'truck2' },
  { label: 'Truck, 3+ axles', value: 2.5, icon: 'truck3' },
  { label: 'Motorcycle', value: 0.5, icon: 'motorcycle' },
]

// ---- Hourly counts ----
// Hours are whole clock hours, from inclusive, to exclusive. Every hour outside the three periods is off-peak.
export type PeriodKey = 'am' | 'pm' | 'offpeak' | 'night'

export const COUNT_PERIODS: { key: Exclude<PeriodKey, 'offpeak'>; label: string; from: number; to: number }[] = [
  { key: 'am', label: 'AM peak', from: 7, to: 10 },
  { key: 'pm', label: 'PM peak', from: 17, to: 21 },
  { key: 'night', label: 'Night', from: 0, to: 5 },
]

/** Traffic directions as stored in TrfDir. Their colours are --dir-up and --dir-down in theme.css. */
export const DIRECTIONS = ['Up', 'Down'] as const
export type Direction = (typeof DIRECTIONS)[number]

/** A change in V/C smaller than this between the first and last survey reads as stable. */
export const VC_TREND_STABLE = 0.03

export type QueueRisk = 'High' | 'Medium' | 'Low'

/** Queue risk is derived from V/C: above 1.0 high, from 0.7 medium, otherwise low. */
export function queueRisk(vc: number | null): QueueRisk | null {
  if (vc == null) return null
  if (vc > 1.0) return 'High'
  if (vc >= 0.7) return 'Medium'
  return 'Low'
}
