import { useMemo, useState, type DragEvent } from 'react'
import { useStations } from '../lib/useStations'
import {
  FIELDS, RULES, download, guessMapping, hasError, readRows, readSheets, summarise, surveyYearFor, toCsv, validate,
  type FieldKey, type ImportRow, type Mapping, type Sheet, type Severity,
} from '../lib/importValidation'

const STEPS = ['Upload file', 'Map columns', 'Run checks', 'Review batch', 'Accept or reject'] as const
const fmt = (n: number) => n.toLocaleString('en-US')
const pad = (h: number) => `${String(h).padStart(2, '0')}:00`
const PAGE = 100

/** A cell as text: dates without a time as yyyy-mm-dd, times without a date as hh:mm. */
const showCell = (v: unknown): string => {
  if (!(v instanceof Date)) return String(v ?? '')
  const t = v.toISOString()
  if (t.startsWith('1899-12-3') || t.startsWith('1900-01-0')) return t.slice(11, 16)
  return t.endsWith('T00:00:00.000Z') ? t.slice(0, 10) : t.slice(0, 16).replace('T', ' ')
}

type Decision = 'accept' | 'reject'
type Filter = 'all' | Severity

export function ImportValidation() {
  const { stations, loading: stationsLoading, error: stationsError } = useStations()
  const known = useMemo(() => (stations.length ? new Set(stations.map((s) => s.code)) : null), [stations])

  const [step, setStep] = useState(1)
  const [fileName, setFileName] = useState('')
  const [sheets, setSheets] = useState<Sheet[]>([])
  const [sheetIdx, setSheetIdx] = useState(0)
  const [mapping, setMapping] = useState<Mapping | null>(null)
  const [surveyYear, setSurveyYear] = useState('')
  const [edits, setEdits] = useState<Map<number, number>>(new Map())
  const [decisions, setDecisions] = useState<Map<number, Decision>>(new Map())
  const [busy, setBusy] = useState(false)
  const [readError, setReadError] = useState<string | null>(null)
  const [dragOver, setDragOver] = useState(false)
  const [filter, setFilter] = useState<Filter>('all')
  const [ruleFilter, setRuleFilter] = useState('')
  const [shown, setShown] = useState(PAGE)
  const [finished, setFinished] = useState(false)

  const sheet = sheets[sheetIdx] ?? null
  const mapped = mapping != null && FIELDS.every((f) => mapping[f.key] != null)

  const rows = useMemo<ImportRow[]>(
    () => (sheet && mapping && mapped ? validate(readRows(sheet, mapping, edits), known) : []),
    [sheet, mapping, mapped, edits, known],
  )
  const summary = useMemo(() => summarise(rows), [rows])
  const decisionOf = (r: ImportRow): Decision => decisions.get(r.fileRow) ?? (hasError(r) ? 'reject' : 'accept')
  const accepted = rows.filter((r) => decisionOf(r) === 'accept')
  const rejected = rows.filter((r) => decisionOf(r) === 'reject')

  const reset = () => {
    setStep(1); setFileName(''); setSheets([]); setSheetIdx(0); setMapping(null); setSurveyYear('')
    setEdits(new Map()); setDecisions(new Map()); setReadError(null); setFilter('all'); setRuleFilter(''); setShown(PAGE); setFinished(false)
  }

  const load = async (file: File) => {
    setBusy(true); setReadError(null)
    try {
      const read = await readSheets(file)
      if (!read.length || read[0].rows.length < 2) throw new Error('The file has no rows of data under its header.')
      setSheets(read); setSheetIdx(0); setFileName(file.name)
      const m = guessMapping(read[0].rows[0])
      setMapping(m); setEdits(new Map()); setDecisions(new Map()); setFinished(false)
      const first = readRows(read[0], m)[0]
      setSurveyYear(surveyYearFor(first?.date ?? null))
    } catch (e) {
      setReadError(e instanceof Error ? e.message : 'The file could not be read.')
      setSheets([]); setFileName('')
    } finally {
      setBusy(false)
    }
  }

  const onDrop = (e: DragEvent) => {
    e.preventDefault(); setDragOver(false)
    const f = e.dataTransfer.files[0]
    if (f) void load(f)
  }

  const changeSheet = (i: number) => {
    setSheetIdx(i); setMapping(guessMapping(sheets[i].rows[0])); setEdits(new Map()); setDecisions(new Map())
  }

  const flagged = useMemo(
    () => rows.filter((r) => r.issues.length && (filter === 'all' || r.issues.some((i) => i.severity === filter)) && (!ruleFilter || r.issues.some((i) => i.rule === ruleFilter))),
    [rows, filter, ruleFilter],
  )

  const setDecision = (r: ImportRow, d: Decision) => setDecisions((m) => new Map(m).set(r.fileRow, d))
  const bulk = (pick: (r: ImportRow) => boolean, d: Decision) =>
    setDecisions((m) => { const n = new Map(m); for (const r of rows) if (pick(r)) n.set(r.fileRow, d); return n })
  const editVehicles = (r: ImportRow, text: string) => {
    const n = Number(text.replace(/,/g, ''))
    if (text.trim() === '' || !Number.isFinite(n) || n === r.vehicles) return
    setEdits((m) => new Map(m).set(r.fileRow, n))
    // An edited row is checked again, so let the rules decide what happens to it.
    setDecisions((m) => { const x = new Map(m); x.delete(r.fileRow); return x })
  }

  const canNext = step === 1 ? sheets.length > 0 : step === 2 ? mapped && /^\d{4}_\d{4}$/.test(surveyYear.trim()) : true

  const exportAccepted = () => download(`accepted-counts-${surveyYear || 'batch'}.csv`, toCsv(
    ['stationcode', 'surveyyear', 'survey_date', 'time', 'trfdir', 'vehicles'],
    accepted.map((r) => [r.station, surveyYear.trim(), r.date, `${pad(r.hour!)} - ${pad(r.hour! + 1)}`, r.direction, r.vehicles]),
  ))
  const exportRejected = () => download('rejected-rows.csv', toCsv(
    ['file_row', 'station', 'date', 'hour', 'direction', 'vehicles', 'rules', 'details'],
    rejected.map((r) => [r.fileRow, r.station || r.raw.station, r.date ?? r.raw.date, r.hour != null ? pad(r.hour) : r.raw.hour, r.direction ?? r.raw.direction, r.vehicles ?? r.raw.vehicles,
      r.issues.map((i) => i.rule).join('; '), r.issues.map((i) => i.message).join(' ')]),
  ))

  return (
    <main className="page">
      <div className="page-head">
        <div>
          <div className="crumbs">Traffic Management / Import and validation</div>
          <h1>Import and validate hourly counts</h1>
        </div>
        {sheets.length > 0 && <button className="btn" onClick={reset}>Start over</button>}
      </div>

      <ol className="imp-steps" aria-label="Steps">
        {STEPS.map((label, i) => {
          const n = i + 1
          const state = n === step ? 'current' : n < step ? 'done' : ''
          return (
            <li key={label} className={state}>
              <button disabled={n > step} onClick={() => setStep(n)} aria-current={n === step ? 'step' : undefined}>
                <span className="imp-num">{n < step ? '✓' : n}</span>{label}
              </button>
            </li>
          )
        })}
      </ol>

      {/* 1. Upload */}
      {step === 1 && (
        <section className="card imp-card">
          <label
            className={`imp-drop${dragOver ? ' over' : ''}`}
            onDragOver={(e) => { e.preventDefault(); setDragOver(true) }}
            onDragLeave={() => setDragOver(false)}
            onDrop={onDrop}
          >
            <input type="file" accept=".xlsx,.csv,.txt" onChange={(e) => { const f = e.target.files?.[0]; if (f) void load(f); e.target.value = '' }} />
            <svg viewBox="0 0 24 24" width="30" height="30" aria-hidden><path d="M12 16V4M7 9l5-5 5 5M4 16v3a1 1 0 0 0 1 1h14a1 1 0 0 0 1-1v-3" /></svg>
            <strong>{busy ? 'Reading the file…' : 'Drop a file here, or choose one'}</strong>
            <span>Excel (.xlsx) or CSV with one row per station, day, hour and direction. The file stays in your browser.</span>
          </label>
          {readError && <div className="error-box" role="alert">{readError}</div>}
          {sheet && (
            <>
              <div className="imp-file">
                <strong>{fileName}</strong>
                <span>{fmt(sheet.rows.length - 1)} rows · {sheet.rows[0].length} columns</span>
                {sheets.length > 1 && (
                  <label className="inline-field"><span>Sheet</span>
                    <select className="select" value={sheetIdx} onChange={(e) => changeSheet(+e.target.value)}>
                      {sheets.map((s, i) => <option key={s.name} value={i}>{s.name}</option>)}
                    </select>
                  </label>
                )}
              </div>
              <div className="table-scroll imp-preview">
                <table className="data compact">
                  <thead><tr>{sheet.rows[0].map((h, i) => <th key={i}>{String(h ?? '')}</th>)}</tr></thead>
                  <tbody>
                    {sheet.rows.slice(1, 7).map((r, i) => (
                      <tr key={i}>{sheet.rows[0].map((_, c) => <td key={c}>{showCell(r[c])}</td>)}</tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </>
          )}
        </section>
      )}

      {/* 2. Map columns */}
      {step === 2 && sheet && mapping && (
        <section className="card imp-card">
          <h3>Which column holds what?</h3>
          <div className="imp-map">
            {FIELDS.map((f) => (
              <label key={f.key} className="field"><span>{f.label}</span>
                <select
                  className="select"
                  value={mapping[f.key] ?? ''}
                  onChange={(e) => setMapping({ ...mapping, [f.key]: e.target.value === '' ? null : +e.target.value } as Mapping)}
                >
                  <option value="">Not in the file</option>
                  {sheet.rows[0].map((h, i) => <option key={i} value={i}>{String(h ?? '') || `Column ${i + 1}`}</option>)}
                </select>
              </label>
            ))}
            <label className="field"><span>Survey year</span>
              <input className="input" value={surveyYear} placeholder="2025_2026" onChange={(e) => setSurveyYear(e.target.value)} aria-invalid={surveyYear !== '' && !/^\d{4}_\d{4}$/.test(surveyYear.trim())} />
            </label>
          </div>
          {!mapped && <div className="error-box" role="alert">Every column except the survey year must be matched before the checks can run.</div>}
          {mapped && (
            <div className="table-scroll imp-preview">
              <table className="data compact">
                <thead><tr><th>Row</th>{FIELDS.map((f) => <th key={f.key}>{f.label}</th>)}</tr></thead>
                <tbody>
                  {readRows(sheet, mapping).slice(0, 5).map((r) => (
                    <tr key={r.fileRow}>
                      <td className="num">{r.fileRow}</td>
                      <td>{r.station || '—'}</td><td>{r.date ?? <span className="imp-bad">{r.raw.date || '—'}</span>}</td>
                      <td>{r.hour != null ? pad(r.hour) : <span className="imp-bad">{r.raw.hour || '—'}</span>}</td>
                      <td>{r.direction ?? <span className="imp-bad">{r.raw.direction || '—'}</span>}</td>
                      <td className="num">{r.vehicles ?? <span className="imp-bad">{r.raw.vehicles || '—'}</span>}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </section>
      )}

      {/* 3. Run checks */}
      {step === 3 && (
        <section className="card imp-card">
          <div className="imp-cards">
            <div className="stat"><div className="label">Rows</div><div className="value">{fmt(summary.rows)}</div></div>
            <div className="stat"><div className="label">Stations</div><div className="value">{fmt(summary.stations)}</div></div>
            <div className="stat"><div className="label">Station days</div><div className="value">{fmt(summary.days)}</div></div>
            <div className="stat ok"><div className="label">Clean</div><div className="value">{fmt(summary.cleanRows)}</div></div>
            <div className="stat warn"><div className="label">Warnings</div><div className="value">{fmt(summary.warningRows)}</div></div>
            <div className="stat danger"><div className="label">Errors</div><div className="value">{fmt(summary.errorRows)}</div></div>
          </div>
          {summary.rows > 0 && (
            <div className="imp-bar" role="img" aria-label={`${summary.cleanRows} clean, ${summary.warningRows} with warnings, ${summary.errorRows} with errors`}>
              <span className="ok" style={{ width: `${(summary.cleanRows / summary.rows) * 100}%` }} />
              <span className="warn" style={{ width: `${(summary.warningRows / summary.rows) * 100}%` }} />
              <span className="danger" style={{ width: `${(summary.errorRows / summary.rows) * 100}%` }} />
            </div>
          )}
          {!known && <div className="error-box" role="alert">{stationsLoading ? 'The station list is still loading, so unknown stations are not checked yet.' : stationsError ? `The station list could not be loaded (${stationsError.message}), so unknown stations are not checked.` : 'No stations were found, so unknown stations are not checked.'}</div>}
          <div className="table-scroll">
            <table className="data compact">
              <thead><tr><th>Rule</th><th>Kind</th><th className="num">Rows flagged</th><th>What it checks</th></tr></thead>
              <tbody>
                {summary.byRule.map(({ rule, rows: n }) => (
                  <tr key={rule.id} className={n ? 'clickable' : ''} onClick={() => { if (n) { setRuleFilter(rule.id); setFilter('all'); setShown(PAGE); setStep(4) } }}>
                    <td><strong>{rule.label}</strong></td>
                    <td><span className={`pill ${rule.severity === 'error' ? 'danger' : 'warn'}`}>{rule.severity === 'error' ? 'Error' : 'Warning'}</span></td>
                    <td className="num">{n ? <strong>{fmt(n)}</strong> : <span className="imp-ok">✓ 0</span>}</td>
                    <td className="imp-desc">{rule.description}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </section>
      )}

      {/* 4. Review */}
      {step === 4 && (
        <section className="card imp-card">
          <div className="imp-review-head">
            <div className="chips">
              {(['all', 'error', 'warning'] as Filter[]).map((f) => (
                <button key={f} className={`chip${filter === f ? ' on' : ''}`} onClick={() => { setFilter(f); setShown(PAGE) }}>
                  {f === 'all' ? 'All flagged' : f === 'error' ? 'Errors' : 'Warnings'} · {fmt(f === 'all' ? summary.errorRows + summary.warningRows : f === 'error' ? summary.errorRows : summary.warningRows)}
                </button>
              ))}
              <select className="select" aria-label="Rule" value={ruleFilter} onChange={(e) => { setRuleFilter(e.target.value); setShown(PAGE) }}>
                <option value="">All rules</option>
                {RULES.map((r) => <option key={r.id} value={r.id}>{r.label}</option>)}
              </select>
            </div>
            <div className="actions">
              <button className="btn" onClick={() => bulk(hasError, 'reject')}>Reject all errors</button>
              <button className="btn" onClick={() => bulk((r) => !hasError(r) && r.issues.length > 0, 'accept')}>Accept all warnings</button>
            </div>
          </div>

          {flagged.length === 0 ? (
            <div className="placeholder">{summary.errorRows + summary.warningRows === 0 ? 'Nothing was flagged. Every row passed the checks.' : 'No flagged rows match this filter.'}</div>
          ) : (
            <div className="table-scroll imp-review">
              <table className="data compact">
                <thead><tr><th className="num">Row</th><th>Station</th><th>Date</th><th>Hour</th><th>Dir</th><th className="num">Vehicles</th><th>Why it was flagged</th><th>Decision</th></tr></thead>
                <tbody>
                  {flagged.slice(0, shown).map((r) => {
                    const d = decisionOf(r)
                    return (
                      <tr key={r.fileRow} className={d === 'reject' ? 'imp-rejected' : ''}>
                        <td className="num">{r.fileRow}</td>
                        <td>{r.station || <span className="imp-bad">—</span>}</td>
                        <td>{r.date ?? <span className="imp-bad">{r.raw.date || '—'}</span>}</td>
                        <td>{r.hour != null ? pad(r.hour) : <span className="imp-bad">{r.raw.hour || '—'}</span>}</td>
                        <td>{r.direction ?? <span className="imp-bad">{r.raw.direction || '—'}</span>}</td>
                        <td className="num">
                          <input
                            className="input imp-edit" inputMode="numeric" defaultValue={r.vehicles ?? r.raw.vehicles}
                            key={`${r.fileRow}-${r.vehicles}`} aria-label={`Vehicles for row ${r.fileRow}`}
                            onBlur={(e) => editVehicles(r, e.target.value)} onKeyDown={(e) => { if (e.key === 'Enter') (e.target as HTMLInputElement).blur() }}
                          />
                        </td>
                        <td>
                          <ul className="imp-issues">
                            {r.issues.map((i, k) => <li key={k} className={i.severity}><b>{RULES.find((x) => x.id === i.rule)?.label}</b> {i.message}</li>)}
                          </ul>
                        </td>
                        <td>
                          <div className="seg imp-decision" role="group" aria-label={`Decision for row ${r.fileRow}`}>
                            <button className={d === 'accept' ? 'on' : ''} onClick={() => setDecision(r, 'accept')}>Accept</button>
                            <button className={d === 'reject' ? 'on reject' : ''} onClick={() => setDecision(r, 'reject')}>Reject</button>
                          </div>
                        </td>
                      </tr>
                    )
                  })}
                </tbody>
              </table>
            </div>
          )}
          {flagged.length > shown && <button className="btn imp-more" onClick={() => setShown((s) => s + PAGE)}>Show {Math.min(PAGE, flagged.length - shown)} more of {fmt(flagged.length - shown)} remaining</button>}
          <p className="muted-note">Rows with errors start as rejected; rows with only warnings start as accepted. Change a vehicle count to correct a row, and it is checked again.</p>
        </section>
      )}

      {/* 5. Accept or reject */}
      {step === 5 && (
        <section className="card imp-card">
          <div className="imp-cards">
            <div className="stat ok"><div className="label">Accepted rows</div><div className="value">{fmt(accepted.length)}</div></div>
            <div className="stat danger"><div className="label">Rejected rows</div><div className="value">{fmt(rejected.length)}</div></div>
            <div className="stat"><div className="label">Stations accepted</div><div className="value">{fmt(new Set(accepted.map((r) => r.station)).size)}</div></div>
            <div className="stat"><div className="label">Survey year</div><div className="value">{surveyYear || '—'}</div></div>
          </div>
          <div className="imp-notice" role="status">
            <strong>Preview only.</strong> Nothing has been written to ArcGIS. Download the accepted rows to load them into the Traffic_Count table, and the rejection report to fix the rest at the source.
          </div>
          <div className="actions imp-final">
            <button className="btn primary" disabled={!accepted.length} onClick={() => { exportAccepted(); setFinished(true) }}>Download accepted rows</button>
            <button className="btn" disabled={!rejected.length} onClick={exportRejected}>Download rejection report</button>
            <button className="btn" onClick={reset}>Import another file</button>
          </div>
          {finished && <p className="imp-ok" role="status">Accepted rows downloaded.</p>}
        </section>
      )}

      {sheets.length > 0 && (
        <div className="imp-nav">
          <button className="btn" disabled={step === 1} onClick={() => setStep((s) => s - 1)}>Back</button>
          {step < 5 && <button className="btn primary" disabled={!canNext} onClick={() => { setStep((s) => s + 1); setShown(PAGE) }}>{step === 3 ? 'Review the batch' : 'Next'}</button>}
        </div>
      )}
    </main>
  )
}

export type { FieldKey }
