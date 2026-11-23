import { losFor, vcBand, type Los, type VcBand } from '../config/parameters'
import type { Link, StationStatus } from './trafficData'

/** A stretch of road between two measures. */
export interface MeasureRange {
  from: number
  to: number
}

export interface StretchSection {
  link: Link
  /** How much of the section lies inside the stretch, in measure units. */
  overlap: number
}

/** The spread of one figure across the sections of a stretch. The mean and std are weighted by how much of each section lies inside. */
export interface Spread {
  mean: number | null
  min: number | null
  max: number | null
  /** Standard deviation; null with fewer than two sections. */
  std: number | null
  /** Sections that have the figure. */
  n: number
}

export interface Stretch extends MeasureRange {
  sections: StretchSection[]
  /** Average over the stretch, each section weighted by how much of it lies inside. */
  vc: number | null
  aadt: number | null
  pcu: number | null
  capacity: number | null
  /** The different capacities along the stretch, lowest first. Capacity is listed, not averaged. */
  capacities: number[]
  spreads: { aadt: Spread; vc: Spread; pcu: Spread; heavyPct: Spread }
  heavyPct: number | null
  band: VcBand
  los: Los | null
  /** The most congested section inside the stretch. */
  worst: Link | null
  /** How much of the stretch is congested or over capacity (V/C of 0.85 or more), in measure units. */
  congestedLength: number
  stations: StationStatus[]
}

const same = (a: number, b: number) => Math.abs(a - b) < 1e-6

/** The sections of a road that have both measures and run forward. */
export const placedSections = (sections: Link[]) =>
  sections.filter((s) => s.from != null && s.to != null && s.to > s.from)

export function roadBounds(sections: Link[]): MeasureRange | null {
  const p = placedSections(sections)
  if (!p.length) return null
  return { from: Math.min(...p.map((s) => s.from!)), to: Math.max(...p.map((s) => s.to!)) }
}

/** The section that spans exactly this range, if there is one. */
export const sectionOf = (sections: Link[], r: MeasureRange | null): Link | null =>
  (r && placedSections(sections).find((s) => same(s.from!, r.from) && same(s.to!, r.to))) || null

function spreadOf(items: { w: number; v: number | null }[]): Spread {
  const xs = items.filter((i): i is { w: number; v: number } => i.v != null)
  if (!xs.length) return { mean: null, min: null, max: null, std: null, n: 0 }
  const total = xs.reduce((s, i) => s + i.w, 0)
  const mean = xs.reduce((s, i) => s + i.v * i.w, 0) / total
  const variance = xs.reduce((s, i) => s + i.w * (i.v - mean) ** 2, 0) / total
  return {
    mean,
    min: Math.min(...xs.map((i) => i.v)),
    max: Math.max(...xs.map((i) => i.v)),
    std: xs.length > 1 ? Math.sqrt(variance) : null,
    n: xs.length,
  }
}

function weighted(items: { w: number; v: number | null }[]): number | null {
  let sum = 0, w = 0
  for (const i of items) if (i.v != null) { sum += i.v * i.w; w += i.w }
  return w > 0 ? sum / w : null
}

/**
 * Works out the figures for everything between two measures. Each section counts in proportion to how much
 * of it lies inside the stretch, so a stretch that is exactly one section gives that section's own figures.
 */
export function analyseStretch(sections: Link[], stations: StationStatus[], range: MeasureRange): Stretch {
  const from = Math.min(range.from, range.to), to = Math.max(range.from, range.to)
  const inside: StretchSection[] = []
  for (const link of placedSections(sections)) {
    const overlap = Math.min(to, link.to!) - Math.max(from, link.from!)
    if (overlap > 1e-9 || (from === to && link.from! <= from && from <= link.to!)) {
      inside.push({ link, overlap: Math.max(overlap, 1e-9) })
    }
  }
  inside.sort((a, b) => a.link.from! - b.link.from!)
  const w = (f: (l: Link) => number | null) => weighted(inside.map((s) => ({ w: s.overlap, v: f(s.link) })))
  const vc = w((l) => l.vc)
  const withVc = inside.filter((s) => s.link.vc != null)
  const worst = withVc.length ? withVc.reduce((a, b) => (b.link.vc! > a.link.vc! ? b : a)).link : null
  return {
    from, to,
    sections: inside,
    vc,
    aadt: w((l) => l.aadt),
    pcu: w((l) => l.pcu),
    capacity: w((l) => l.capacity),
    spreads: {
      aadt: spreadOf(inside.map((x) => ({ w: x.overlap, v: x.link.aadt }))),
      vc: spreadOf(inside.map((x) => ({ w: x.overlap, v: x.link.vc }))),
      pcu: spreadOf(inside.map((x) => ({ w: x.overlap, v: x.link.pcu }))),
      heavyPct: spreadOf(inside.map((x) => ({ w: x.overlap, v: x.link.heavyPct }))),
    },
    capacities: [...new Set(inside.map((x) => x.link.capacity).filter((c): c is number => c != null).map((c) => Math.round(c)))].sort((a, b) => a - b),
    heavyPct: w((l) => l.heavyPct),
    band: vcBand(vc),
    los: losFor(vc),
    worst,
    congestedLength: inside.filter((x) => x.link.band === 'congested' || x.link.band === 'over').reduce((n, x) => n + x.overlap, 0),
    stations: stations
      .filter((s) => s.measure != null && s.measure >= from && s.measure <= to)
      .sort((a, b) => a.measure! - b.measure!),
  }
}
