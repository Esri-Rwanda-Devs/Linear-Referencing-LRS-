import { useEffect, useRef, type ReactNode } from 'react'
import { BAND_COLOURS, BAND_STATUS } from '../config/parameters'
import { STATION_TYPES } from '../config/vehicleClasses'
import type { StationStatus } from '../lib/trafficData'
import { VehicleIcon } from './VehicleIcons'

const fmt = (n: number | null, d = 0) =>
  n == null ? '—' : n.toLocaleString('en-US', { maximumFractionDigits: d, minimumFractionDigits: d })

export const totalCounted = (station: StationStatus) =>
  STATION_TYPES.reduce((s, t) => s + (station.counts[t.key] ?? 0), 0)

/**
 * Station name, location and a badge. The badge shows the congestion status by default;
 * with badge="counted" it shows the total vehicles counted instead, in the same style.
 */
export function StationHeading({ station, badge = 'status', extra }: { station: StationStatus; badge?: 'status' | 'counted'; extra?: ReactNode }) {
  const colour = badge === 'counted' ? 'var(--accent)' : BAND_COLOURS[station.band]
  return (
    <div className="station-heading">
      <div>
        <h2 id="station-title">{station.name || station.code}</h2>
        <div className="sub">
          {station.routeName || station.routeId}
          {[station.province, station.district, station.sector]
            .filter(Boolean)
            .map((part) => ` · ${part}`)
            .join('')}
        </div>
      </div>
      <span className="status-pill" style={{ color: colour, background: `color-mix(in srgb, ${colour} 14%, transparent)` }}>
        {badge === 'counted' ? `${fmt(totalCounted(station))} vehicles` : BAND_STATUS[station.band]}
      </span>
      {extra}
    </div>
  )
}

/** Summary cards and the vehicles counted per type, each with its icon. Used in the window and inline. */
export function StationCountsView({ station, summary = true, compact = false }: { station: StationStatus; summary?: boolean; compact?: boolean }) {
  const rows = STATION_TYPES.map((t) => ({ ...t, count: station.counts[t.key] }))
  const total = rows.reduce((s, r) => s + (r.count ?? 0), 0)
  const max = Math.max(1, ...rows.map((r) => r.count ?? 0))
  const hasCounts = rows.some((r) => r.count != null)
  const colour = BAND_COLOURS[station.band]

  return (
    <>
      {summary && (
        <div className="stats stats-4">
          <div className="stat"><div className="label">Vehicles counted</div><div className="value">{fmt(total)}</div></div>
          <div className="stat"><div className="label">Average daily traffic</div><div className="value">{fmt(station.adt)}</div></div>
          <div className="stat"><div className="label">AADT</div><div className="value">{fmt(station.aadt)}</div></div>
          <div className="stat"><div className="label">V/C ratio</div><div className="value" style={{ color: colour }}>{station.effectiveVc != null ? station.effectiveVc.toFixed(2) : '—'}</div></div>
        </div>
      )}

      <div className="sub-h">Vehicles counted by type</div>
      {hasCounts ? (
        <ul className={`vehicle-list${compact ? ' compact' : ''}`}>
          {rows.map((r) => {
            const share = total > 0 && r.count != null ? (r.count / total) * 100 : 0
            return (
              <li key={r.key} className={r.count ? '' : 'zero'}>
                <span className="vehicle-ico"><VehicleIcon type={r.icon} size={20} /></span>
                <span className="vehicle-name">{r.label}</span>
                <span className="vehicle-bar" aria-hidden>
                  <span style={{ width: `${((r.count ?? 0) / max) * 100}%` }} />
                </span>
                <strong className="vehicle-count">{fmt(r.count)}</strong>
                <span className="vehicle-share">{r.count != null ? `${share.toFixed(share < 10 && share > 0 ? 1 : 0)}%` : '—'}</span>
              </li>
            )
          })}
        </ul>
      ) : (
        <div className="placeholder">No counts by vehicle type are stored for this station.</div>
      )}

      {station.seasonFactor != null && (
        <p className="muted-note">Seasonal factor {station.seasonFactor.toFixed(2)} converts the average daily traffic into AADT. Counts are as stored for the station record.</p>
      )}
    </>
  )
}

/** Window that opens when a count station is clicked on the Network map. */
export function StationDialog({ station, onClose }: { station: StationStatus; onClose: () => void }) {
  const closeRef = useRef<HTMLButtonElement>(null)

  useEffect(() => {
    const previous = document.activeElement as HTMLElement | null
    closeRef.current?.focus()
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') onClose() }
    document.addEventListener('keydown', onKey)
    const overflow = document.body.style.overflow
    document.body.style.overflow = 'hidden'
    return () => {
      document.removeEventListener('keydown', onKey)
      document.body.style.overflow = overflow
      previous?.focus?.() // hand focus back to what opened the window
    }
  }, [onClose])

  return (
    <div className="dialog-backdrop" onMouseDown={(e) => { if (e.target === e.currentTarget) onClose() }}>
      <div className="dialog" role="dialog" aria-modal="true" aria-labelledby="station-title">
        <header className="dialog-head">
          <StationHeading station={station} />
          <button ref={closeRef} className="icon-btn" aria-label="Close" onClick={onClose}>
            <svg width="16" height="16" viewBox="0 0 16 16" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" aria-hidden>
              <path d="M3 3l10 10M13 3 3 13" />
            </svg>
          </button>
        </header>
        <StationCountsView station={station} />
      </div>
    </div>
  )
}
