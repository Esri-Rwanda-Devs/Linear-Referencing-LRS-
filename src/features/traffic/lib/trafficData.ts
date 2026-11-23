import { LAYERS, losFor, vcBand, type Los, type VcBand } from '../config/parameters'
import {
  groupTotals, STATION_TYPES, type ClassCounts, type GroupKey, type RawClass, type StationCounts,
} from '../config/vehicleClasses'
import { getLayerInfo, queryAll, type EsriFeature } from './arcgis'
import type { Survey } from './trafficCounts'

export interface Link {
  id: number
  routeId: string
  routeName: string
  label: string
  /** "from – to" measure of the section, as stored in the service. */
  range: string
  from: number | null
  to: number | null
  aadt: number | null
  pcu: number | null
  capacity: number | null
  vc: number | null
  band: VcBand
  los: Los | null
  stationCount: number | null
  category: string | null
  surveyYear: string | null
  groups: Record<GroupKey, number>
  heavyPct: number | null
  paths: number[][][]
}

export interface Station {
  /** Vehicles counted per type, as stored on the station record. */
  counts: StationCounts
  /** Average daily traffic (the counted period) and the seasonal factor that turns it into AADT. */
  adt: number | null
  seasonFactor: number | null
  id: number
  code: string
  name: string
  routeId: string
  routeName: string
  measure: number | null
  district: string | null
  category: string | null
  aadt: number | null
  pcu: number | null
  capacity: number | null
  vc: number | null
  x: number
  y: number
}

/** A length measured in kilometres, written with its unit: metres when it is under a kilometre, otherwise km. */
export function formatLength(km: number | null): string {
  if (km == null) return '—'
  if (Math.abs(km) < 1) return `${Math.round(km * 1000).toLocaleString('en-US')} m`
  return `${km.toLocaleString('en-US', { maximumFractionDigits: 2 })} km`
}

/** Measures are kilometres along the road. They are shown as stored, without the unit; lengths use formatLength. */
export const formatMeasure = (n: number | null): string =>
  n == null ? '—' : n.toLocaleString('en-US', { maximumFractionDigits: 3 })

const num = (v: unknown): number | null => (typeof v === 'number' && Number.isFinite(v) ? v : null)
const str = (v: unknown): string | null => (typeof v === 'string' && v.trim() ? v.trim() : null)

export interface LayerMap {
  lines: number
  points: number
}

/** Works out which of the configured layers is the line layer and which is the station layer. */
export async function discoverLayers(): Promise<LayerMap> {
  const infos = await Promise.all(LAYERS.ids.map(getLayerInfo))
  const lines = infos.find((i) => i.geometryType === 'esriGeometryPolyline')
  const points = infos.find((i) => i.geometryType === 'esriGeometryPoint')
  if (!lines || !points) {
    throw new Error(
      `Expected one polyline and one point layer, found: ${infos.map((i) => `${i.id}=${i.geometryType}`).join(', ')}`,
    )
  }
  return { lines: lines.id, points: points.id }
}

export async function loadYears(layer: number): Promise<string[]> {
  // Not every layer supports "distinct" queries, so fetch the one field and de-duplicate here.
  // If the field can't be read, fall back to "all records" instead of blocking the map.
  try {
    const rows = await queryAll(layer, { outFields: 'survey_year', geometry: false })
    const years = new Set(rows.map((r) => str(r.attributes.survey_year)).filter((y): y is string => !!y))
    return [...years].sort().reverse()
  } catch {
    return []
  }
}

const CLASS_FIELDS: RawClass[] = [
  'motorcycle', 'cars', 'jeep', 'minibus', 'coasters', 'lgv', 'bus',
  'axle2', 'axle3', 'semitrailer', 'trucktrailer', 'others',
]

function toLink(f: EsriFeature): Link {
  const a = f.attributes
  const counts: ClassCounts = {}
  for (const c of CLASS_FIELDS) counts[c] = num(a[c])
  const groups = groupTotals(counts)
  const classTotal = Object.values(groups).reduce((s, v) => s + v, 0)
  const aadt = num(a.aadt)
  const vc = num(a.vc_ratio)
  const from = num(a.frommeasure)
  const to = num(a.tomeasure)
  const routeId = str(a.routeid) ?? '—'
  const name = str(a.routename) ?? routeId
  return {
    id: a.objectid as number,
    routeId,
    routeName: name,
    label: name,
    range: `${formatMeasure(from)} – ${formatMeasure(to)}`,
    from,
    to,
    aadt,
    pcu: num(a.pcu),
    capacity: num(a.traffic_capacity),
    vc,
    band: vcBand(vc),
    los: losFor(vc),
    stationCount: num(a.station_count),
    category: str(a.traffic_category),
    surveyYear: str(a.survey_year),
    groups,
    heavyPct: classTotal > 0 ? (groups.trucks / classTotal) * 100 : null,
    paths: f.geometry?.paths ?? [],
  }
}

export async function loadLinks(layer: number, year: string | null): Promise<Link[]> {
  const yearClause = year ? `survey_year = '${year.replace(/'/g, "''")}'` : '1=1'
  // Prefer records that are currently valid (event layers keep history); fall back if the SQL isn't supported.
  const current = `${yearClause} AND (todate IS NULL OR todate > CURRENT_TIMESTAMP)`
  let rows: EsriFeature[]
  try {
    rows = await queryAll(layer, { where: current, simplify: 0.0002 })
  } catch {
    rows = await queryAll(layer, { where: yearClause, simplify: 0.0002 })
  }
  return rows.map(toLink).filter((l) => l.paths.length > 0)
}

export interface NetworkRoad {
  id: number
  routeId: string
  paths: number[][][]
}

/** Case-insensitive attribute lookup, since field names differ in case between services. */
function attr(a: Record<string, unknown>, name: string): unknown {
  const key = Object.keys(a).find((k) => k.toLowerCase() === name)
  return key ? a[key] : undefined
}

/** Base road lines from the Road_Network feature class. */
export async function loadRoadNetwork(): Promise<NetworkRoad[]> {
  const rows = await queryAll(LAYERS.network, { simplify: 0.0002 })
  return rows
    .map((f, i) => ({
      id: (attr(f.attributes, 'objectid') as number | undefined) ?? i,
      routeId: str(attr(f.attributes, 'routeid')) ?? '',
      paths: f.geometry?.paths ?? [],
    }))
    .filter((r) => r.paths.length > 0)
}

export async function loadStations(layer: number): Promise<Station[]> {
  const current = '(todate IS NULL OR todate > CURRENT_TIMESTAMP)'
  let rows: EsriFeature[]
  try {
    rows = await queryAll(layer, { where: current })
  } catch {
    rows = await queryAll(layer, {})
  }
  return rows
    .filter((f) => f.geometry?.x != null && f.geometry?.y != null)
    .map((f) => {
      const a = f.attributes
      return {
        id: a.objectid as number,
        code: str(a.station_code) ?? `#${a.objectid}`,
        name: str(a.station_name) ?? '',
        routeId: str(a.routeid) ?? '—',
        routeName: str(a.routename) ?? '',
        measure: num(a.measure),
        district: str(a.district),
        category: str(a.traffic_category),
        aadt: num(a.annual_average_daily_traffic),
        pcu: num(a.pcu),
        capacity: num(a.traffic_capacity),
        counts: Object.fromEntries(STATION_TYPES.map((t) => [t.key, num(a[t.key])])) as StationCounts,
        adt: num(a.average_daily_traffic),
        seasonFactor: num(a.season_factor),
        vc: num(a.vc_ratio),
        x: f.geometry!.x!,
        y: f.geometry!.y!,
      }
    })
}

export interface StationStatus extends Station {
  /** Congestion band, classified with the same thresholds as the road segments. */
  band: VcBand
  /** The V/C used: the station's own vc_ratio, or the V/C of the segment it sits on. */
  effectiveVc: number | null
  vcSource: 'survey' | 'station' | 'segment' | null
  /** False when a year is chosen and the station was not counted in it. */
  counted: boolean
}

/** What "for a survey year" means: the surveys to read, the year chosen, and the latest year on record. */
export interface YearBasis {
  year: string | null
  /** Each station's survey in each year, keyed `code|year`. */
  surveys: Map<string, Survey>
  /** The newest survey year. The station record itself describes this year. */
  currentYear: string | null
}

/**
 * A station's traffic in one survey year. V/C and AADT come from that year's counts; capacity never
 * changes with the counts, so PCU is V/C x the station's capacity. A year with no count for the
 * station has no figures, except the newest year, where the station record itself is used.
 */
function trafficFor(s: Station, basis?: YearBasis): Pick<Station, 'aadt' | 'pcu' | 'vc'> & { fromSurvey: boolean; counted: boolean } {
  const record = { aadt: s.aadt, pcu: s.pcu, vc: s.vc, fromSurvey: false, counted: true }
  if (!basis || !basis.year) return record
  const sv = basis.surveys.get(`${s.code}|${basis.year}`)
  if (sv) {
    const vc = sv.vc
    return {
      aadt: sv.adt ?? sv.daily,
      pcu: vc != null && s.capacity != null ? vc * s.capacity : null,
      vc,
      fromSurvey: true,
      counted: true,
    }
  }
  return basis.year === basis.currentYear ? record : { aadt: null, pcu: null, vc: null, fromSurvey: false, counted: false }
}

/**
 * Classifies each station by V/C. With a year basis, the figures are that survey year's; a station
 * without its own V/C inherits the V/C of the road segment it sits on.
 */
export function withStatus(stations: Station[], links: Link[], basis?: YearBasis): StationStatus[] {
  const byRoute = new Map<string, Link[]>()
  for (const l of links) {
    const list = byRoute.get(l.routeId) ?? []
    list.push(l)
    byRoute.set(l.routeId, list)
  }
  return stations.map((raw) => {
    const { fromSurvey, counted, ...t } = trafficFor(raw, basis)
    const s = { ...raw, ...t, counted }
    if (s.vc != null) {
      return { ...s, band: vcBand(s.vc), effectiveVc: s.vc, vcSource: fromSurvey ? ('survey' as const) : ('station' as const) }
    }
    const seg =
      s.measure == null
        ? undefined
        : byRoute.get(s.routeId)?.find((l) => l.from != null && l.to != null && s.measure! >= l.from && s.measure! <= l.to && l.vc != null)
    if (seg) return { ...s, band: seg.band, effectiveVc: seg.vc, vcSource: 'segment' as const }
    return { ...s, band: 'none' as VcBand, effectiveVc: null, vcSource: null }
  })
}

export type SortMode = 'vc' | 'measure'

/** Road order (natural, so R-2 comes before R-10), then from measure, then to measure. */
export function byRoadAndMeasure(a: Link, b: Link): number {
  return (
    a.routeId.localeCompare(b.routeId, undefined, { numeric: true }) ||
    (a.from ?? Infinity) - (b.from ?? Infinity) ||
    (a.to ?? Infinity) - (b.to ?? Infinity)
  )
}

/** Links with a V/C, ordered by V/C (highest first, ties by road and measure) or by road and measure. */
export function sortLinks(links: Link[], mode: SortMode): Link[] {
  const withVc = links.filter((l) => l.vc != null)
  return withVc.sort(mode === 'vc' ? (a, b) => (b.vc ?? 0) - (a.vc ?? 0) || byRoadAndMeasure(a, b) : byRoadAndMeasure)
}
