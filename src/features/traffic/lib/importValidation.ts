// Reading a file of hourly traffic counts and checking it against the validation rules.
// Everything here runs in the browser: the file is never uploaded anywhere.

export type Cell = string | number | boolean | Date | null | undefined

/** What the Traffic_Count table needs from each row of an imported file. */
export const FIELDS = [
  { key: 'station', label: 'Station code', hints: ['stationcode', 'station', 'site', 'code'] },
  { key: 'date', label: 'Survey date', hints: ['surveydate', 'date', 'day'] },
  { key: 'hour', label: 'Hour', hints: ['time', 'hour', 'period', 'interval'] },
  { key: 'direction', label: 'Direction', hints: ['trfdir', 'direction', 'dir'] },
  { key: 'vehicles', label: 'Vehicles', hints: ['vehicles', 'count', 'volume', 'total', 'veh'] },
] as const

export type FieldKey = (typeof FIELDS)[number]['key']
export type Mapping = Record<FieldKey, number | null>

export interface Sheet {
  name: string
  /** The first row is the header. */
  rows: Cell[][]
}

// ---- Reading files ----

/** Reads a CSV (comma or semicolon separated), keeping quoted commas and line breaks inside quotes. */
export function parseCsv(text: string): Cell[][] {
  const clean = text.replace(/^﻿/, '')
  const firstLine = clean.split(/\r?\n/, 1)[0] ?? ''
  const delimiter = (firstLine.match(/;/g)?.length ?? 0) > (firstLine.match(/,/g)?.length ?? 0) ? ';' : ','
  const rows: Cell[][] = []
  let row: string[] = [], field = '', quoted = false
  const endField = () => { row.push(field); field = '' }
  const endRow = () => { endField(); if (row.some((c) => c.trim() !== '')) rows.push(row); row = [] }
  for (let i = 0; i < clean.length; i++) {
    const c = clean[i]
    if (quoted) {
      if (c === '"' && clean[i + 1] === '"') { field += '"'; i++ }
      else if (c === '"') quoted = false
      else field += c
    } else if (c === '"') quoted = true
    else if (c === delimiter) endField()
    else if (c === '\n') endRow()
    else if (c !== '\r') field += c
  }
  if (field !== '' || row.length) endRow()
  return rows
}

/** Reads every sheet of a file: .xlsx through the spreadsheet reader, .csv as text. */
export async function readSheets(file: File): Promise<Sheet[]> {
  const name = file.name.toLowerCase()
  if (name.endsWith('.csv') || name.endsWith('.txt')) {
    return [{ name: file.name, rows: parseCsv(await file.text()) }]
  }
  if (name.endsWith('.xlsx')) {
    const { default: readXlsxFile } = await import('read-excel-file/universal')
    const sheets = await readXlsxFile(file)
    return sheets.map((s) => ({ name: s.sheet, rows: s.data as Cell[][] })).filter((s) => s.rows.length > 1)
  }
  throw new Error('Use an .xlsx or .csv file.')
}

const norm = (v: Cell) => String(v ?? '').toLowerCase().replace(/[^a-z0-9]/g, '')

/** Matches each field to the file column whose header looks most like it. */
export function guessMapping(header: Cell[]): Mapping {
  const names = header.map(norm)
  const used = new Set<number>()
  const mapping = {} as Mapping
  for (const f of FIELDS) {
    let idx = -1
    for (const hint of f.hints) {
      idx = names.findIndex((n, i) => !used.has(i) && n === hint)
      if (idx >= 0) break
    }
    if (idx < 0) {
      for (const hint of f.hints) {
        idx = names.findIndex((n, i) => !used.has(i) && n.includes(hint))
        if (idx >= 0) break
      }
    }
    mapping[f.key] = idx >= 0 ? idx : null
    if (idx >= 0) used.add(idx)
  }
  return mapping
}

// ---- Understanding the values ----

const MONTHS = ['jan', 'feb', 'mar', 'apr', 'may', 'jun', 'jul', 'aug', 'sep', 'oct', 'nov', 'dec']
const iso = (y: number, m: number, d: number) => {
  const date = new Date(Date.UTC(y, m - 1, d))
  return date.getUTCFullYear() === y && date.getUTCMonth() === m - 1 && date.getUTCDate() === d
    ? `${y}-${String(m).padStart(2, '0')}-${String(d).padStart(2, '0')}` : null
}

/** A date as yyyy-mm-dd, from a date cell or text such as 2025-08-24, 24/08/2025 or 24 Aug 2025. */
export function parseDate(v: Cell): string | null {
  if (v instanceof Date) return Number.isNaN(v.getTime()) ? null : iso(v.getUTCFullYear(), v.getUTCMonth() + 1, v.getUTCDate())
  if (typeof v === 'number') return null
  const s = String(v ?? '').trim()
  let m = /^(\d{4})[-/.](\d{1,2})[-/.](\d{1,2})/.exec(s)
  if (m) return iso(+m[1], +m[2], +m[3])
  m = /^(\d{1,2})[-/. ](\d{1,2})[-/. ](\d{4})/.exec(s)
  if (m) return iso(+m[3], +m[2], +m[1])
  m = /^(\d{1,2})[-/. ]([a-z]{3})[a-z]*[-/. ,]*(\d{4})/i.exec(s)
  if (m) {
    const mi = MONTHS.indexOf(m[2].toLowerCase())
    return mi >= 0 ? iso(+m[3], mi + 1, +m[1]) : null
  }
  return null
}

/** The hour a row starts at (0 to 23), from 7, "07:00", "07:00 - 08:00", a time cell or a fraction of a day. */
export function parseHour(v: Cell): number | null {
  if (v instanceof Date) return Number.isNaN(v.getTime()) ? null : v.getUTCHours()
  if (typeof v === 'number') {
    if (v > 0 && v < 1) return Math.floor(v * 24 + 1e-9)
    return Number.isInteger(v) ? v : null
  }
  const s = String(v ?? '').trim()
  const m = /^(\d{1,2})(?::\d{2})?/.exec(s)
  return m ? +m[1] : null
}

const UP = new Set(['up', 'u', '1', 'a', 'inbound', 'in', 'forward'])
const DOWN = new Set(['down', 'd', '2', 'b', 'outbound', 'out', 'backward', 'reverse'])

export function parseDirection(v: Cell): 'Up' | 'Down' | null {
  const s = String(v ?? '').trim().toLowerCase()
  return UP.has(s) ? 'Up' : DOWN.has(s) ? 'Down' : null
}

export function parseVehicles(v: Cell): number | null {
  if (typeof v === 'number') return Number.isFinite(v) ? v : null
  const s = String(v ?? '').replace(/[\s,]/g, '')
  return s !== '' && Number.isFinite(Number(s)) ? Number(s) : null
}

// ---- Rows and rules ----

export type Severity = 'error' | 'warning'

export interface Rule {
  id: string
  label: string
  severity: Severity
  description: string
}

export const RULES: Rule[] = [
  { id: 'missing', label: 'Missing or unreadable value', severity: 'error', description: 'A station, date, hour, direction or vehicle count is empty or cannot be read.' },
  { id: 'station', label: 'Unknown station', severity: 'error', description: 'The station code is not in the Count stations layer.' },
  { id: 'direction', label: 'Direction not Up or Down', severity: 'error', description: 'Direction must be Up or Down.' },
  { id: 'hour', label: 'Hour out of range', severity: 'error', description: 'The hour must be a whole hour from 00 to 23.' },
  { id: 'count', label: 'Invalid vehicle count', severity: 'error', description: 'Vehicles must be a whole number, zero or more.' },
  { id: 'duplicate', label: 'Duplicate row', severity: 'error', description: 'Same station, date, hour and direction appears more than once.' },
  { id: 'outlier', label: 'Unusually high count', severity: 'warning', description: 'Far above the usual hourly count for this station and direction.' },
  { id: 'zeros', label: 'Run of zero counts', severity: 'warning', description: `Three or more daytime hours in a row with no vehicles.` },
  { id: 'gap', label: 'Incomplete day', severity: 'warning', description: 'A station, date and direction with fewer than 24 hours.' },
]
const RULE = Object.fromEntries(RULES.map((r) => [r.id, r])) as Record<string, Rule>

export interface Issue {
  rule: string
  severity: Severity
  message: string
}

export interface ImportRow {
  /** Row number in the file, counting the header as row 1. */
  fileRow: number
  station: string
  date: string | null
  hour: number | null
  direction: 'Up' | 'Down' | null
  vehicles: number | null
  /** What the file said, for the columns that could not be read. */
  raw: Record<FieldKey, string>
  issues: Issue[]
}

const OUTLIER_Z = 4
const OUTLIER_MIN_ROWS = 24
const DAYTIME = [6, 20] as const
const ZERO_RUN = 3

export const surveyYearFor = (date: string | null): string => {
  if (!date) return ''
  const y = +date.slice(0, 4), m = +date.slice(5, 7)
  return m >= 7 ? `${y}_${y + 1}` : `${y - 1}_${y}`
}

export function readRows(sheet: Sheet, mapping: Mapping, edits: Map<number, number> = new Map()): ImportRow[] {
  const cell = (r: Cell[], key: FieldKey) => (mapping[key] == null ? undefined : r[mapping[key]!])
  return sheet.rows.slice(1).map((r, i) => {
    const fileRow = i + 2
    const edited = edits.get(fileRow)
    return {
      fileRow,
      station: String(cell(r, 'station') ?? '').trim(),
      date: parseDate(cell(r, 'date')),
      hour: parseHour(cell(r, 'hour')),
      direction: parseDirection(cell(r, 'direction')),
      vehicles: edited ?? parseVehicles(cell(r, 'vehicles')),
      raw: Object.fromEntries(FIELDS.map((f) => {
        const v = cell(r, f.key)
        return [f.key, v instanceof Date ? v.toISOString().slice(0, 16) : String(v ?? '')]
      })) as Record<FieldKey, string>,
      issues: [],
    }
  }).filter((r) => Object.values(r.raw).some((v) => v.trim() !== ''))
}

const flag = (row: ImportRow, rule: string, message: string) =>
  row.issues.push({ rule, severity: RULE[rule].severity, message })

const pad = (h: number) => `${String(h).padStart(2, '0')}:00`

/** Applies every rule to the rows, adding the issues found to each row. */
export function validate(rows: ImportRow[], knownStations: Set<string> | null): ImportRow[] {
  const seen = new Map<string, number>()
  const groups = new Map<string, ImportRow[]>()
  const perStationDir = new Map<string, number[]>()

  for (const r of rows) {
    r.issues = []
    const missing = [
      !r.station && 'station', !r.date && 'date', r.hour == null && 'hour', !r.direction && 'direction', r.vehicles == null && 'vehicles',
    ].filter(Boolean) as string[]
    // A direction or hour that was written but cannot be understood is reported by its own rule.
    const unreadableDirection = !r.direction && r.raw.direction.trim() !== ''
    const unreadableHour = r.hour == null && r.raw.hour.trim() !== ''
    const m = missing.filter((x) => !(x === 'direction' && unreadableDirection) && !(x === 'hour' && unreadableHour))
    if (m.length) flag(r, 'missing', `No readable ${m.join(', ')}.`)
    if (unreadableDirection) flag(r, 'direction', `"${r.raw.direction}" is not Up or Down.`)
    if (r.hour != null && (r.hour < 0 || r.hour > 23)) flag(r, 'hour', `Hour ${r.hour} is outside 00 to 23.`)
    else if (unreadableHour) flag(r, 'hour', `"${r.raw.hour}" is not a whole hour.`)
    if (r.vehicles != null && (r.vehicles < 0 || !Number.isInteger(r.vehicles))) {
      flag(r, 'count', r.vehicles < 0 ? `${r.vehicles} is negative.` : `${r.vehicles} is not a whole number.`)
    }
    if (r.station && knownStations && !knownStations.has(r.station)) flag(r, 'station', `${r.station} is not a known count station.`)

    if (r.station && r.date && r.hour != null && r.direction) {
      const key = `${r.station}|${r.date}|${r.hour}|${r.direction}`
      const first = seen.get(key)
      if (first != null) flag(r, 'duplicate', `Same as row ${first}.`)
      else seen.set(key, r.fileRow)
    }
    if (r.station && r.date && r.direction) {
      const g = `${r.station}|${r.date}|${r.direction}`
      groups.set(g, [...(groups.get(g) ?? []), r])
    }
    if (r.station && r.direction && r.vehicles != null && r.vehicles >= 0) {
      const g = `${r.station}|${r.direction}`
      perStationDir.set(g, [...(perStationDir.get(g) ?? []), r.vehicles])
    }
  }

  // Counts far above the usual for the same station and direction
  const stats = new Map<string, { mean: number; std: number }>()
  for (const [g, xs] of perStationDir) {
    if (xs.length < OUTLIER_MIN_ROWS) continue
    const mean = xs.reduce((a, b) => a + b, 0) / xs.length
    const std = Math.sqrt(xs.reduce((a, b) => a + (b - mean) ** 2, 0) / xs.length)
    stats.set(g, { mean, std })
  }
  for (const r of rows) {
    if (r.vehicles == null || !r.station || !r.direction) continue
    const s = stats.get(`${r.station}|${r.direction}`)
    if (s && s.std > 0 && r.vehicles > s.mean + OUTLIER_Z * s.std) {
      flag(r, 'outlier', `${r.vehicles.toLocaleString('en-US')} vehicles; the usual hour is about ${Math.round(s.mean).toLocaleString('en-US')}.`)
    }
  }

  // Whole days: missing hours and runs of zeros
  for (const [g, list] of groups) {
    const [station, date, direction] = g.split('|')
    const valid = list.filter((r) => r.hour != null && r.hour >= 0 && r.hour <= 23)
    const hours = new Set(valid.map((r) => r.hour!))
    if (hours.size < 24 && list.length) {
      const absent = Array.from({ length: 24 }, (_, h) => h).filter((h) => !hours.has(h))
      const shown = absent.length > 6 ? `${absent.slice(0, 6).map(pad).join(', ')} and ${absent.length - 6} more` : absent.map(pad).join(', ')
      flag(list[0], 'gap', `${station}, ${direction}, ${date}: ${hours.size} of 24 hours (missing ${shown}).`)
    }
    const byHour = new Map(valid.map((r) => [r.hour!, r]))
    let run: ImportRow[] = []
    const closeRun = () => {
      if (run.length >= ZERO_RUN) for (const r of run) flag(r, 'zeros', `${run.length} hours in a row with no vehicles (${pad(run[0].hour!)} to ${pad(run[run.length - 1].hour! + 1)}).`)
      run = []
    }
    for (let h = DAYTIME[0]; h <= DAYTIME[1]; h++) {
      const r = byHour.get(h)
      if (r && r.vehicles === 0) run.push(r)
      else closeRun()
    }
    closeRun()
  }
  return rows
}

export const hasError = (r: ImportRow) => r.issues.some((i) => i.severity === 'error')

export interface BatchSummary {
  rows: number
  stations: number
  days: number
  errorRows: number
  warningRows: number
  cleanRows: number
  byRule: { rule: Rule; rows: number }[]
}

export function summarise(rows: ImportRow[]): BatchSummary {
  const byRule = RULES.map((rule) => ({ rule, rows: rows.filter((r) => r.issues.some((i) => i.rule === rule.id)).length }))
  const errorRows = rows.filter(hasError).length
  const warningRows = rows.filter((r) => !hasError(r) && r.issues.length).length
  return {
    rows: rows.length,
    stations: new Set(rows.map((r) => r.station).filter(Boolean)).size,
    days: new Set(rows.filter((r) => r.station && r.date).map((r) => `${r.station}|${r.date}`)).size,
    errorRows,
    warningRows,
    cleanRows: rows.length - errorRows - warningRows,
    byRule,
  }
}

export function toCsv(head: string[], body: (string | number | null | undefined)[][]): string {
  return [head, ...body].map((r) => r.map((c) => `"${String(c ?? '').replace(/"/g, '""')}"`).join(',')).join('\n')
}

export function download(name: string, text: string) {
  const a = document.createElement('a')
  a.href = URL.createObjectURL(new Blob([text], { type: 'text/csv' }))
  a.download = name
  a.click()
  URL.revokeObjectURL(a.href)
}
