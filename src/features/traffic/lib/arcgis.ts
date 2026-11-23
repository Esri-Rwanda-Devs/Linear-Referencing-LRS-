// ArcGIS REST client for traffic layers. Uses the same portal session as the rest of LRS.
import { LRS } from "../../../config";
import { signInToLrs } from "../../mapping/services/lrsService";

export interface LayerInfo {
  id: number
  name: string
  geometryType?: string
  maxRecordCount?: number
}

export interface EsriFeature {
  attributes: Record<string, unknown>
  geometry?: { x?: number; y?: number; paths?: number[][][] }
}

interface QueryResponse {
  features?: EsriFeature[]
  exceededTransferLimit?: boolean
  error?: { code: number; message: string }
}

export class ArcgisError extends Error {}

async function readJson(res: Response) {
  const text = await res.text()
  try {
    return JSON.parse(text)
  } catch {
    throw new ArcgisError(
      `The traffic service returned HTTP ${res.status} with a non-JSON response. Sign in again if your session has expired.`,
    )
  }
}

async function authed(path: string, params: Record<string, string>, post: boolean) {
  let token: string
  try {
    ;({ token } = await signInToLrs())
  } catch (error) {
    const message = error instanceof Error ? error.message : ""
    if (!message || /abort/i.test(message)) {
      throw new ArcgisError("Sign in to load traffic data.")
    }
    throw error
  }
  const url = `${LRS}/${path}`
  const body = new URLSearchParams({ f: "json", token, ...params })
  const res = post
    ? await fetch(url, {
        method: "POST",
        headers: { "Content-Type": "application/x-www-form-urlencoded" },
        body,
      })
    : await fetch(`${url}?${body.toString()}`)
  const json = (await readJson(res)) as { error?: { message?: string; code?: number } }
  if (json.error) throw new ArcgisError(json.error.message ?? `ArcGIS error ${json.error.code}`)
  return json
}

async function post<T>(path: string, params: Record<string, string>): Promise<T> {
  return authed(path, params, true) as Promise<T>
}

export async function getLayerInfo(id: number): Promise<LayerInfo> {
  const j = await authed(String(id), {}, false)
  return { id, name: j.name, geometryType: j.geometryType, maxRecordCount: j.maxRecordCount }
}

export interface QueryOptions {
  where?: string
  outFields?: string
  geometry?: boolean
  /** Generalise geometry (in degrees, since outSR is 4326) to keep payloads light. */
  simplify?: number
  distinct?: boolean
  orderBy?: string
}

export interface Statistic {
  type: 'count' | 'sum' | 'avg' | 'min' | 'max'
  field: string
  as: string
}

/** Grouped statistics computed on the server, so large tables never have to be downloaded. */
export async function queryStats(
  layerId: number,
  opts: { where?: string; groupBy: string[]; stats: Statistic[] },
): Promise<Record<string, unknown>[]> {
  const page = await post<QueryResponse>(`${layerId}/query`, {
    where: opts.where ?? '1=1',
    returnGeometry: 'false',
    groupByFieldsForStatistics: opts.groupBy.join(','),
    outStatistics: JSON.stringify(
      opts.stats.map((s) => ({ statisticType: s.type, onStatisticField: s.field, outStatisticFieldName: s.as })),
    ),
  })
  if (page.exceededTransferLimit) {
    throw new ArcgisError(`Layer ${layerId} returned more groups than the server sends at once.`)
  }
  return (page.features ?? []).map((f) => f.attributes)
}

/** Quotes a value for an ArcGIS where clause. */
export const sqlText = (value: string) => `'${value.replace(/'/g, "''")}'`

/** Fetches every matching feature, paging through the server's maxRecordCount. */
export async function queryAll(layerId: number, opts: QueryOptions = {}): Promise<EsriFeature[]> {
  const pageSize = 1000
  const all: EsriFeature[] = []
  for (let offset = 0; offset < 200_000; offset += pageSize) {
    const params: Record<string, string> = {
      where: opts.where ?? '1=1',
      outFields: opts.outFields ?? '*',
      returnGeometry: String(opts.geometry ?? true),
      outSR: '4326',
      resultOffset: String(offset),
      resultRecordCount: String(pageSize),
    }
    if (opts.simplify) params.maxAllowableOffset = String(opts.simplify)
    if (opts.distinct) params.returnDistinctValues = 'true'
    if (opts.orderBy) params.orderByFields = opts.orderBy
    const page = await post<QueryResponse>(`${layerId}/query`, params)
    const features = page.features ?? []
    all.push(...features)
    if (!page.exceededTransferLimit && features.length < pageSize) break
    if (features.length === 0) break
  }
  return all
}
