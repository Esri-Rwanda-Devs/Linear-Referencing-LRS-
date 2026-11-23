import { useEffect, useMemo, useState, type ReactNode } from 'react'
import { createPortal } from 'react-dom'
import {
  ALL_STATIONS, aggregateSurveys, formatSurveyYear, stationFindings, summariseDay, surveysByStation, useHours,
  useScopeHours, useSurveys, vcTrend,
  type Finding,
} from '../lib/trafficCounts'
import { HourlyChart, PeakTiles, PeriodTable } from './HourlyTraffic'
import { NetworkVcTrend, StationVcTrend } from './VcTrend'

export interface CountOption {
  code: string
  name: string
  /** Shown after the name, e.g. "on this section". */
  note?: string
}

export interface ExtraTab {
  key: string
  label: string
  content: ReactNode
}

const ICONS: Record<Finding['key'], ReactNode> = {
  congestion: <path d="M4 16a8 8 0 1 1 16 0M12 16l4-5" />,
  trend: <path d="M4 17l5-5 4 3 7-8M15 7h5v5" />,
  busiest: <><circle cx="12" cy="12" r="8" /><path d="M12 7v5l3 2" /></>,
  direction: <path d="M7 4v16M7 20l-3-3M7 20l3-3M17 20V4M17 4l-3 3M17 4l3 3" />,
}

function FindingsList({ findings }: { findings: Finding[] }) {
  return (
    <ul className="findings">
      {findings.map((f) => (
        <li key={f.key} className={`finding ${f.tone}`}>
          <svg viewBox="0 0 24 24" width="18" height="18" aria-hidden>{ICONS[f.key]}</svg>
          <div className="finding-text"><span className="finding-title">{f.title}</span> {f.text}</div>
        </li>
      ))}
    </ul>
  )
}

type Tab = 'hour' | 'year' | string

/**
 * What the hourly counts say about one count station: the key findings first, then the
 * detail behind them on tabs (by hour, by year, and any extra tabs the page adds).
 */
export function StationInsights({
  options, initialCode, wide = false, extraTabs = [], year: controlledYear, onYearChange, findingsSlot,
  code: controlledCode, onCodeChange, scopeCodes = null,
}: {
  options: CountOption[]; initialCode: string | null; wide?: boolean; extraTabs?: ExtraTab[]
  /** When the page owns the station choice (and shows its own selector), pass it here with onCodeChange. */
  code?: string | null; onCodeChange?: (code: string) => void
  /** For the all-stations choice (ALL_STATIONS): the stations it covers, or null for every station. */
  scopeCodes?: string[] | null
  /** When the page owns the survey year (and shows its own selector), pass it here with onYearChange. */
  year?: string | null; onYearChange?: (year: string) => void
  /** Where to show the key findings instead of inside the panel, e.g. floating on the map. */
  findingsSlot?: HTMLElement | null
}) {
  const surveys = useSurveys()
  const [ownCode, setCode] = useState(initialCode ?? options[0]?.code ?? null)
  const code = onCodeChange ? controlledCode ?? null : ownCode
  const isAll = code === ALL_STATIONS
  const scopeSet = useMemo(
    () => (scopeCodes ? new Set(scopeCodes) : new Set((surveys.data ?? []).map((s) => s.code))),
    [scopeCodes, surveys.data],
  )
  const years = useMemo(() => {
    if (!code) return []
    if (isAll) return aggregateSurveys(surveys.data ?? [], scopeCodes ? scopeSet : null)
    return surveysByStation(surveys.data ?? []).get(code) ?? []
  }, [surveys.data, code, isAll, scopeCodes, scopeSet])
  const [ownYear, setYear] = useState<string | null>(null)
  const controlled = onYearChange !== undefined
  const year = controlled ? controlledYear ?? null : ownYear
  const [tab, setTab] = useState<Tab>('hour')
  const [findingsOpen, setFindingsOpen] = useState(true)

  // Open on the latest survey of the chosen station.
  useEffect(() => {
    if (!controlled && years.length && !years.some((s) => s.year === ownYear)) setYear(years[years.length - 1].year)
  }, [controlled, years, ownYear])

  const survey = years.find((s) => s.year === year) ?? null
  const single = useHours(isAll ? null : code, survey ? year : null)
  const scoped = useScopeHours(year, scopeCodes, isAll && !!survey)
  const hours = isAll ? scoped : single
  const summary = useMemo(() => (hours.data ? summariseDay(hours.data) : null), [hours.data])
  const trend = useMemo(() => vcTrend(years), [years])
  const findings = useMemo(() => stationFindings(survey, summary, trend), [survey, summary, trend])
  const noCounts = !surveys.isLoading && !years.length

  const tabs: { key: Tab; label: string }[] = [
    ...(noCounts ? [] : [{ key: 'hour', label: 'By hour' }, { key: 'year', label: 'By year' }]),
    ...extraTabs.map((t) => ({ key: t.key, label: t.label })),
  ]
  const shownTab = tabs.some((t) => t.key === tab) ? tab : tabs[0]?.key

  return (
    <div className={`insights${wide ? ' wide' : ''}`}>
      <div className="insights-head">
        {noCounts && <div className="insights-source">{isAll ? 'No hourly counts for these stations' : 'No hourly counts for this station'}</div>}
        <div className="actions">
          {options.length > 1 && !onCodeChange && (
            <label className="inline-field"><span>Count station</span>
              <select className="select" value={code ?? ''} onChange={(e) => { setCode(e.target.value); setYear(null) }}>
                {options.map((o) => <option key={o.code} value={o.code}>{o.name || o.code}{o.note ? ` · ${o.note}` : ''}</option>)}
              </select>
            </label>
          )}
          {!controlled && years.length > 0 && (
            <label className="inline-field"><span>Survey year</span>
              <select className="select" value={year ?? ''} onChange={(e) => setYear(e.target.value)}>
                {[...years].reverse().map((s) => <option key={s.year} value={s.year}>{formatSurveyYear(s.year)}</option>)}
              </select>
            </label>
          )}
        </div>
      </div>

      {(surveys.error || hours.error) && (
        <div className="error-box" role="alert"><strong>Could not load hourly counts.</strong> {((surveys.error ?? hours.error) as Error).message}</div>
      )}

      {findingsSlot
        ? !(surveys.isLoading || (survey && hours.isLoading)) && findings.length > 0 && createPortal(
            <div className="findings-float" role="region" aria-label="Key findings">
              <button className="findings-toggle" aria-expanded={findingsOpen} onClick={() => setFindingsOpen((o) => !o)}>
                Key findings <span aria-hidden>{findingsOpen ? '▾' : '▸'}</span>
              </button>
              {findingsOpen && <FindingsList findings={findings} />}
            </div>,
            findingsSlot,
          )
        : surveys.isLoading || (survey && hours.isLoading)
          ? <div className="skeleton" style={{ height: 96 }} />
          : findings.length > 0 && <FindingsList findings={findings} />}

      {tabs.length > 0 && (
        <>
          <div className="tabs" role="tablist" aria-label="Details">
            {tabs.map((t) => (
              <button key={t.key} role="tab" aria-selected={shownTab === t.key} className={shownTab === t.key ? 'on' : ''} onClick={() => setTab(t.key)}>
                {t.label}
              </button>
            ))}
          </div>
          <div className="tab-body" role="tabpanel">
            {shownTab === 'hour' && (
              hours.isLoading ? <div className="skeleton" style={{ height: 280 }} />
                : !hours.data ? <div className="placeholder">No hourly counts for this survey year.</div>
                : (
                  <>
                    <PeakTiles summary={summary} />
                    <HourlyChart hours={hours.data} summary={summary} height={wide ? 280 : 220} />
                    {summary && <PeriodTable summary={summary} />}
                  </>
                )
            )}
            {shownTab === 'year' && code && (isAll
              ? <NetworkVcTrend codes={scopeSet} scope={scopeCodes ? `${scopeCodes.length} stations` : 'All stations'} />
              : <StationVcTrend code={code} badge={false} wide={wide} />)}
            {extraTabs.find((t) => t.key === shownTab)?.content}
          </div>
        </>
      )}
    </div>
  )
}
