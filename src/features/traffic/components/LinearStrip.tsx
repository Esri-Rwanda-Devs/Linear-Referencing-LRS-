import { useMemo, useRef, useState, type PointerEvent as ReactPointerEvent, type ReactNode } from 'react'
import { BAND_COLOURS, BAND_STATUS, queueRisk } from '../config/parameters'
import { placedSections, type MeasureRange } from '../lib/stretch'
import { formatMeasure, type Link, type StationStatus } from '../lib/trafficData'

const fmt = (n: number | null, d = 0) =>
  n == null ? '—' : n.toLocaleString('en-US', { maximumFractionDigits: d, minimumFractionDigits: d })

interface Props {
  sections: Link[]
  stations: StationStatus[]
  /** The stretch being analysed, from measure to measure. */
  range: MeasureRange | null
  onRangeChange: (range: MeasureRange) => void
  /** Show the count stations row. */
  showPoints?: boolean
  /** Which road attribute rows to draw, in the order of ATTRS. */
  attributes?: AttrKey[]
}

type Hit =
  | { kind: 'section'; section: Link }
  | { kind: 'station'; station: StationStatus }

type Drag = { mode: 'new' | 'from' | 'to'; startM: number; startX: number; moved: boolean }
export type AttrKey = 'vc' | 'los' | 'aadt' | 'capacity' | 'heavy'

const ICON: Record<string, ReactNode> = {
  stations: <><path d="M12 21s-6-5.6-6-10a6 6 0 1 1 12 0c0 4.4-6 10-6 10z" /><circle cx="12" cy="11" r="2" /></>,
  vc: <path d="M4 16a8 8 0 1 1 16 0M12 16l4-5" />,
  los: <path d="M4 20v-5h4v5zM10 20V9h4v11zM16 20V4h4v16z" />,
  aadt: <path d="M5 20V10M12 20V4M19 20v-7" />,
  capacity: <path d="M3 17h18M5 17V9l7-4 7 4v8M10 17v-4h4v4" />,
  heavy: <><path d="M2 7h11v9H2zM13 10h4l3 3v3h-7" /><circle cx="6" cy="17" r="1.6" /><circle cx="17" cy="17" r="1.6" /></>,
}

/** The road attributes that can be drawn as rows. */
export const ATTRS: { key: AttrKey; label: string }[] = [
  { key: 'vc', label: 'V/C ratio' },
  { key: 'los', label: 'Level of service' },
  { key: 'aadt', label: 'AADT' },
  { key: 'capacity', label: 'Capacity (PCU/day)' },
  { key: 'heavy', label: 'Heavy vehicles' },
]

const TOP_H = 34 // the measure ruler and the cursor flag
const POINT_H = 46
const ATTR_H = 34
const STATION_HIT_PX = 14
const DRAG_PX = 4

/** Dark text on the light amber band, white on the others. */
const textOn = (band: string) => (band === 'near' ? '#3b2a07' : '#fff')

const round = (n: number) => Math.round(n * 100) / 100

/**
 * The road laid out by measure, like a linear-referencing viewer: a ruler on top, count stations standing
 * where they are on the road, and one ribbon per road attribute, each section drawn from its from measure to
 * its to measure. A red cursor flag reads the measure under the pointer. Dragging across the road (or its
 * two handles) picks the stretch to analyse.
 */
export function LinearStrip({ sections, stations, range, onRangeChange, showPoints = true, attributes = ATTRS.map((a) => a.key) }: Props) {
  const areaRef = useRef<HTMLDivElement>(null)
  const drag = useRef<Drag | null>(null)
  const justDragged = useRef(false)
  const [cursor, setCursor] = useState<{ x: number; y: number; w: number } | null>(null)
  const [focused, setFocused] = useState<Link | null>(null)
  const [dragging, setDragging] = useState(false)

  const placed = useMemo(() => placedSections(sections), [sections])
  const [min, max] = useMemo(() => {
    if (!placed.length) return [0, 1] as const
    return [Math.min(...placed.map((s) => s.from!)), Math.max(...placed.map((s) => s.to!))] as const
  }, [placed])
  const span = Math.max(max - min, 1e-9)
  const maxOf = useMemo(() => ({
    aadt: Math.max(1, ...placed.map((s) => s.aadt ?? 0)),
    capacity: Math.max(1, ...placed.map((s) => s.capacity ?? 0)),
    heavy: Math.max(1, ...placed.map((s) => s.heavyPct ?? 0)),
  }), [placed])
  const pct = (m: number) => ((m - min) / span) * 100
  const measureAt = (x: number, w: number) => Math.min(max, Math.max(min, min + (x / w) * span))

  const onRoute = useMemo(
    () => stations.filter((s) => s.measure != null && s.measure >= min && s.measure <= max),
    [stations, min, max],
  )

  const visibleAttrs = ATTRS.filter((a) => attributes.includes(a.key))
  const rows = [
    ...(showPoints ? [{ key: 'stations', label: 'Count stations', h: POINT_H }] : []),
    ...visibleAttrs.map((a) => ({ key: a.key, label: a.label, h: ATTR_H })),
  ]
  const bodyH = rows.reduce((s, r) => s + r.h, 0)

  const hit: Hit | null = useMemo(() => {
    if (focused) return { kind: 'section', section: focused }
    if (!cursor || dragging) return null
    const m = measureAt(cursor.x, cursor.w)
    // Over the station row, a nearby station wins over the section underneath it.
    if (showPoints && cursor.y >= TOP_H && cursor.y < TOP_H + POINT_H) {
      let best: StationStatus | null = null, bestPx = STATION_HIT_PX
      for (const s of onRoute) {
        const px = Math.abs(((s.measure! - min) / span) * cursor.w - cursor.x)
        if (px <= bestPx) { best = s; bestPx = px }
      }
      if (best) return { kind: 'station', station: best }
    }
    const section = placed.find((s) => m >= s.from! && m <= s.to!)
    return section ? { kind: 'section', section } : null
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [cursor, focused, dragging, placed, onRoute, min, span, showPoints])

  const local = (e: ReactPointerEvent) => {
    const r = areaRef.current!.getBoundingClientRect()
    return { x: Math.max(0, Math.min(r.width, e.clientX - r.left)), y: e.clientY - r.top, w: r.width }
  }

  const down = (e: ReactPointerEvent) => {
    if (e.button !== 0) return
    const p = local(e)
    const handle = (e.target as HTMLElement).closest<HTMLElement>('[data-handle]')?.dataset.handle as 'from' | 'to' | undefined
    justDragged.current = false
    drag.current = { mode: handle ?? 'new', startM: round(measureAt(p.x, p.w)), startX: p.x, moved: false }
    areaRef.current!.setPointerCapture(e.pointerId)
  }

  const move = (e: ReactPointerEvent) => {
    const p = local(e)
    setCursor(p)
    const d = drag.current
    if (!d) return
    if (d.mode === 'new' && !d.moved && Math.abs(p.x - d.startX) < DRAG_PX) return
    d.moved = true
    justDragged.current = true
    setDragging(true)
    const m = round(measureAt(p.x, p.w))
    if (d.mode === 'new') onRangeChange({ from: Math.min(d.startM, m), to: Math.max(d.startM, m) })
    else if (range) {
      onRangeChange(d.mode === 'from'
        ? { from: Math.min(m, range.to), to: Math.max(m, range.to) }
        : { from: Math.min(range.from, m), to: Math.max(range.from, m) })
    }
  }

  const up = (e: ReactPointerEvent) => {
    const d = drag.current
    drag.current = null
    setDragging(false)
    if (areaRef.current?.hasPointerCapture(e.pointerId)) areaRef.current.releasePointerCapture(e.pointerId)
    // A click without dragging picks the section under the pointer.
    if (d && d.mode === 'new' && !d.moved) {
      const p = local(e)
      const m = measureAt(p.x, p.w)
      const section = placed.find((s) => m >= s.from! && m <= s.to!)
      if (section) onRangeChange({ from: section.from!, to: section.to! })
    }
  }

  const areaW = cursor?.w ?? areaRef.current?.clientWidth ?? 0
  const cursorX = focused ? (pct((focused.from! + focused.to!) / 2) / 100) * areaW : cursor?.x
  const showLine = cursorX != null && (cursor != null || focused != null)
  const cursorMeasure = focused ? (focused.from! + focused.to!) / 2 : cursor ? measureAt(cursor.x, cursor.w) : null

  // Round-number ticks (1, 2 or 5 times a power of ten), about eight across the road.
  const ticks = useMemo(() => {
    const raw = span / 8
    const pow = 10 ** Math.floor(Math.log10(raw))
    const step = [1, 2, 5, 10].map((k) => k * pow).find((v) => v >= raw) ?? raw
    const out: { f: number; m: number }[] = []
    for (let m = Math.ceil(min / step - 1e-9) * step; m <= max + 1e-9; m += step) out.push({ f: (m - min) / span, m })
    return out
  }, [min, max, span])

  if (!placed.length) {
    return <div className="placeholder">These sections have no from and to measures, so they can't be drawn along the road.</div>
  }

  const inRange = (s: Link) => !range || (s.to! > range.from && s.from! < range.to)

  const ribbon = (s: Link, key: AttrKey) => {
    let text: string, background: string, color = 'var(--text)'
    const level = (v: number | null, top: number) => `color-mix(in srgb, var(--accent) ${14 + Math.round(((v ?? 0) / top) * 56)}%, var(--surface))`
    switch (key) {
      case 'vc': text = s.vc != null ? s.vc.toFixed(2) : '—'; background = BAND_COLOURS[s.band]; color = textOn(s.band); break
      case 'los': text = s.los ?? '—'; background = BAND_COLOURS[s.band]; color = textOn(s.band); break
      case 'aadt': text = fmt(s.aadt); background = level(s.aadt, maxOf.aadt); break
      case 'capacity': text = fmt(s.capacity); background = level(s.capacity, maxOf.capacity); break
      case 'heavy': text = s.heavyPct == null ? '—' : `${s.heavyPct.toFixed(0)}%`; background = level(s.heavyPct, maxOf.heavy); break
    }
    return (
      <span
        key={s.id}
        className={`ribbon${inRange(s) ? '' : ' dim'}`}
        style={{ left: `${pct(s.from!)}%`, width: `${((s.to! - s.from!) / span) * 100}%`, background, color }}
      >
        <span>{text}</span>
      </span>
    )
  }

  return (
    <div className="linear" aria-label="The road by measure: count stations and attributes along it">
      <div className="linear-labels" aria-hidden>
        <div className="linear-label head" style={{ height: TOP_H }}>Measure (km)</div>
        {rows.map((r) => (
          <div key={r.key} className="linear-label" style={{ height: r.h }}>
            <svg viewBox="0 0 24 24" width="16" height="16">{ICON[r.key]}</svg>
            <span>{r.label}</span>
          </div>
        ))}
      </div>

      <div
        className={`linear-area${dragging ? ' dragging' : ''}`}
        ref={areaRef}
        onPointerDown={down}
        onPointerMove={move}
        onPointerUp={up}
        onPointerCancel={up}
        onPointerLeave={() => { if (!drag.current) setCursor(null) }}
      >
        {/* Ruler */}
        <div className="linear-ruler" style={{ height: TOP_H }}>
          {ticks.map((t) => (
            <span key={t.m} style={{ left: `${t.f * 100}%` }} className={t.f < 0.001 ? 'first' : t.f > 0.999 ? 'last' : ''}>
              {formatMeasure(round(t.m) + 0)}
            </span>
          ))}
          {showLine && cursorMeasure != null && (
            <span className="cursor-flag" style={{ left: Math.min(Math.max(cursorX!, 34), Math.max(34, areaW - 34)) }}>
              {formatMeasure(round(cursorMeasure))}
            </span>
          )}
        </div>

        <div className="linear-body" style={{ height: bodyH }}>
          {range && (
            <div className="linear-range" style={{ left: `${pct(range.from)}%`, width: `${pct(range.to) - pct(range.from)}%` }} aria-hidden>
              <span className="range-handle" data-handle="from" title="Drag to change the from measure" />
              <span className="range-handle right" data-handle="to" title="Drag to change the to measure" />
            </div>
          )}

          {showPoints && (
            <div className="linear-row stations-row" style={{ height: POINT_H }}>
              <div className="road-line" aria-hidden />
              {onRoute.map((s) => (
                <span key={s.id} className="station-pin" style={{ left: `${pct(s.measure!)}%`, color: BAND_COLOURS[s.band] }} role="img" aria-label={`Count station ${s.name || s.code}, measure ${formatMeasure(s.measure)}`}>
                  <svg width="22" height="30" viewBox="0 0 26 34" aria-hidden>
                    <path d="M13 33C13 33 2 20.5 2 12.5a11 11 0 0 1 22 0C24 20.5 13 33 13 33z" fill="currentColor" stroke="#fff" strokeWidth="2" strokeLinejoin="round" />
                    <path d="M8.5 16V12.5M13 16V8.5M17.5 16V11" stroke="#fff" strokeWidth="2" strokeLinecap="round" />
                  </svg>
                </span>
              ))}
            </div>
          )}

          {visibleAttrs.map((a, i) => (
            <div key={a.key} className="linear-row ribbon-row" style={{ height: ATTR_H }}>
              {placed.map((s) => ribbon(s, a.key))}
              {/* Keyboard access: one focusable control per section, on the first visible row only */}
              {i === 0 && placed.map((s) => (
                <button
                  key={s.id}
                  className="ribbon-focus"
                  style={{ left: `${pct(s.from!)}%`, width: `${((s.to! - s.from!) / span) * 100}%` }}
                  onFocus={() => setFocused(s)}
                  onBlur={() => setFocused(null)}
                  onClick={() => { if (!justDragged.current) onRangeChange({ from: s.from!, to: s.to! }) }}
                  aria-label={`From ${formatMeasure(s.from)} to ${formatMeasure(s.to)}. V/C ${s.vc?.toFixed(2) ?? 'no data'}, LOS ${s.los ?? 'none'}, AADT ${fmt(s.aadt)}. Select to analyse.`}
                />
              ))}
            </div>
          ))}
        </div>

        {showLine && <div className="linear-cursor" style={{ left: cursorX, top: 0, height: TOP_H + bodyH }} aria-hidden />}

        {hit && showLine && !dragging && (
          <div
            className="linear-pop"
            role="status"
            style={{
              left: Math.min(Math.max(cursorX! + 14, 4), Math.max(4, areaW - 250)),
              top: Math.min(Math.max((cursor?.y ?? TOP_H) + 14, TOP_H + 4), Math.max(TOP_H + 4, TOP_H + bodyH - 190)),
            }}
          >
            {hit.kind === 'section' ? <SectionInfo s={hit.section} at={cursor && !focused ? measureAt(cursor.x, cursor.w) : null} /> : <StationInfo s={hit.station} />}
          </div>
        )}
      </div>
    </div>
  )
}

function SectionInfo({ s, at }: { s: Link; at: number | null }) {
  const colour = BAND_COLOURS[s.band]
  const risk = queueRisk(s.vc)
  return (
    <>
      <div className="pop-title">
        <strong>{s.label}</strong>
        <span className="pop-badge" style={{ background: colour, color: textOn(s.band) }}>{s.los ? `LOS ${s.los}` : BAND_STATUS[s.band]}</span>
      </div>
      <div className="pop-sub">Km {formatMeasure(s.from)} to {formatMeasure(s.to)}{at != null && ` · cursor at ${formatMeasure(round(at))}`}</div>
      <dl className="pop-grid">
        <dt>V/C ratio</dt><dd style={{ color: colour }}><strong>{s.vc != null ? s.vc.toFixed(2) : '—'}</strong></dd>
        <dt>AADT</dt><dd>{fmt(s.aadt)}</dd>
        <dt>PCU per day</dt><dd>{fmt(s.pcu)}</dd>
        <dt>Capacity</dt><dd>{fmt(s.capacity)}</dd>
        <dt>Heavy vehicles</dt><dd>{s.heavyPct == null ? '—' : `${s.heavyPct.toFixed(0)}%`}</dd>
        <dt>Queue risk</dt><dd>{risk ?? '—'}</dd>
      </dl>
    </>
  )
}

function StationInfo({ s }: { s: StationStatus }) {
  const colour = BAND_COLOURS[s.band]
  return (
    <>
      <div className="pop-title">
        <strong>{s.name || s.code}</strong>
        <span className="pop-badge" style={{ background: colour, color: textOn(s.band) }}>{BAND_STATUS[s.band]}</span>
      </div>
      <div className="pop-sub">Count station · km {formatMeasure(s.measure)}</div>
      <dl className="pop-grid">
        <dt>V/C ratio</dt><dd style={{ color: colour }}><strong>{s.effectiveVc != null ? s.effectiveVc.toFixed(2) : '—'}</strong></dd>
        <dt>AADT</dt><dd>{fmt(s.aadt)}</dd>
        <dt>PCU per day</dt><dd>{fmt(s.pcu)}</dd>
        <dt>Capacity</dt><dd>{fmt(s.capacity)}</dd>
      </dl>
    </>
  )
}
