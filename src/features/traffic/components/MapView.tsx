import { useEffect, useMemo, useRef, useState } from 'react'
import type { Link, NetworkRoad, StationStatus } from '../lib/trafficData'
import { BAND_COLOURS, BAND_STATUS } from '../config/parameters'
import { BASEMAPS, DEFAULT_BASEMAP, tileUrl } from '../config/basemaps'

interface Props {
  /** Road_Network base lines; their RouteId provides the map labels. */
  network: NetworkRoad[]
  links: Link[]
  stations: StationStatus[]
  colourOf: (l: Link) => string
  widthOf: (l: Link) => number
  selectedId: number | null
  onSelect: (id: number | null) => void
  showStations: boolean
  showNames: boolean
  /** Called when a count station marker is clicked. */
  onStationClick?: (s: StationStatus) => void
  /** Station to highlight; the map moves to it when it changes. */
  selectedStationId?: number | null
}

interface View { k: number; tx: number; ty: number }

// Web Mercator, so lines line up with XYZ basemap tiles. The whole world is W units wide, which
// keeps numbers readable while still precise enough for street level (1 unit is about 40 m).
const W = 1_000_000
const MAX_K = 300

function project(lon: number, lat: number): readonly [number, number] {
  const rad = (Math.max(-85.0511, Math.min(85.0511, lat)) * Math.PI) / 180
  return [((lon + 180) / 360) * W, ((1 - Math.log(Math.tan(rad) + 1 / Math.cos(rad)) / Math.PI) / 2) * W] as const
}

function boundsOf(links: Link[], stations: StationStatus[], network: NetworkRoad[]): readonly [number, number, number, number] {
  let x0 = Infinity, y0 = Infinity, x1 = -Infinity, y1 = -Infinity
  const add = (lon: number, lat: number) => {
    const [x, y] = project(lon, lat)
    if (x < x0) x0 = x; if (x > x1) x1 = x
    if (y < y0) y0 = y; if (y > y1) y1 = y
  }
  for (const r of network) for (const p of r.paths) for (const [x, y] of p) add(x, y)
  for (const l of links) for (const p of l.paths) for (const [x, y] of p) add(x, y)
  for (const s of stations) add(s.x, s.y)
  return x0 === Infinity ? [0, 0, W, W] : [x0, y0, x1, y1]
}

export function MapView({ network, links, stations, colourOf, widthOf, selectedId, onSelect, showStations, showNames, onStationClick, selectedStationId }: Props) {
  const [basemapId, setBasemapId] = useState<string>(() => {
    try { return localStorage.getItem('basemap') ?? DEFAULT_BASEMAP } catch { return DEFAULT_BASEMAP }
  })
  const basemap = BASEMAPS.find((b) => b.id === basemapId) ?? BASEMAPS[0]
  const chooseBasemap = (id: string) => {
    setBasemapId(id)
    try { localStorage.setItem('basemap', id) } catch { /* private mode: the choice just isn't remembered */ }
  }

  const wrapRef = useRef<HTMLDivElement>(null)
  const [size, setSize] = useState({ w: 800, h: 560 })
  const [view, setView] = useState<View>({ k: 1, tx: 0, ty: 0 })
  const [tip, setTip] = useState<{ x: number; y: number; text: string } | null>(null)
  const drag = useRef<{ x: number; y: number; moved: number } | null>(null)

  const bounds = useMemo(() => boundsOf(links, stations, network), [links, stations, network])

  // Base road lines, plus one label per RouteId placed at the middle of that route's longest line.
  const base = useMemo(() => {
    const toD = (paths: number[][][]) =>
      paths.map((p) => 'M' + p.map(([x, y]) => project(x, y).map((n) => n.toFixed(2)).join(' ')).join('L')).join('')
    const longest = new Map<string, { len: number; px: number; py: number }>()
    for (const r of network) {
      if (!r.routeId) continue
      for (const p of r.paths) {
        if (p.length < 2) continue
        const pp = p.map(([x, y]) => project(x, y))
        let len = 0
        for (let i = 1; i < pp.length; i++) len += Math.hypot(pp[i][0] - pp[i - 1][0], pp[i][1] - pp[i - 1][1])
        const prev = longest.get(r.routeId)
        if (!prev || len > prev.len) {
          const mid = pp[Math.floor(pp.length / 2)]
          longest.set(r.routeId, { len, px: mid[0], py: mid[1] })
        }
      }
    }
    return {
      lines: network.map((r) => ({ id: r.id, d: toD(r.paths) })),
      // Longer routes first, so they win when labels compete for space.
      labels: [...longest.entries()].sort((a, b) => b[1].len - a[1].len).map(([routeId, v]) => ({ routeId, ...v })),
    }
  }, [network])

  const paths = useMemo(
    () =>
      links.map((l) => ({
        link: l,
        d: l.paths
          .map((p) => 'M' + p.map(([x, y]) => project(x, y).map((n) => n.toFixed(2)).join(' ')).join('L'))
          .join(''),
      })),
    [links],
  )

  const pts = useMemo(() => stations.map((s) => ({ s, p: project(s.x, s.y) })), [stations])

  useEffect(() => {
    const el = wrapRef.current
    if (!el) return
    const ro = new ResizeObserver(() => setSize({ w: el.clientWidth, h: el.clientHeight }))
    ro.observe(el)
    setSize({ w: el.clientWidth, h: el.clientHeight })
    return () => ro.disconnect()
  }, [])

  const fit = () => {
    const [x0, y0, x1, y1] = bounds
    const bw = Math.max(x1 - x0, 1e-6), bh = Math.max(y1 - y0, 1e-6)
    const k = Math.min(size.w / bw, size.h / bh) * 0.92
    setView({ k, tx: (size.w - bw * k) / 2 - x0 * k, ty: (size.h - bh * k) / 2 - y0 * k })
  }
  // When a station is selected elsewhere (for example in the table), glide the map to it.
  const viewRef = useRef(view)
  viewRef.current = view
  useEffect(() => {
    if (selectedStationId == null) return
    const pt = pts.find((p) => p.s.id === selectedStationId)
    if (!pt) return
    const [x0, y0, x1, y1] = bounds
    const kFit = Math.min(size.w / Math.max(x1 - x0, 1e-6), size.h / Math.max(y1 - y0, 1e-6)) * 0.92
    const from = viewRef.current
    const k = Math.min(MAX_K, Math.max(from.k, kFit * 6))
    const to = { k, tx: size.w / 2 - pt.p[0] * k, ty: size.h / 2 - pt.p[1] * k }
    const still = window.matchMedia?.('(prefers-reduced-motion: reduce)').matches
    const t0 = performance.now()
    let raf = 0
    const step = (now: number) => {
      const t = still ? 1 : Math.min(1, (now - t0) / 450)
      const e = 1 - Math.pow(1 - t, 3)
      setView({ k: from.k + (to.k - from.k) * e, tx: from.tx + (to.tx - from.tx) * e, ty: from.ty + (to.ty - from.ty) * e })
      if (t < 1) raf = requestAnimationFrame(step)
    }
    raf = requestAnimationFrame(step)
    return () => cancelAnimationFrame(raf)
    // Only a change of selection should move the map, not data or size updates.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [selectedStationId])

  // Refit whenever new data arrives or the container is first measured.
  // eslint-disable-next-line react-hooks/exhaustive-deps
  useEffect(fit, [bounds, size.w, size.h])

  const zoomAt = (factor: number, cx: number, cy: number) =>
    setView((v) => {
      const k = Math.min(Math.max(v.k * factor, v.k * 0.2), MAX_K)
      const f = k / v.k
      return { k, tx: cx - (cx - v.tx) * f, ty: cy - (cy - v.ty) * f }
    })

  const onWheel = (e: React.WheelEvent) => {
    const r = wrapRef.current!.getBoundingClientRect()
    zoomAt(e.deltaY < 0 ? 1.2 : 1 / 1.2, e.clientX - r.left, e.clientY - r.top)
  }

  const onPointerDown = (e: React.PointerEvent) => {
    ;(e.currentTarget as Element).setPointerCapture(e.pointerId)
    drag.current = { x: e.clientX, y: e.clientY, moved: 0 }
  }
  const onPointerMove = (e: React.PointerEvent) => {
    const d = drag.current
    if (!d) return
    const dx = e.clientX - d.x, dy = e.clientY - d.y
    d.x = e.clientX; d.y = e.clientY; d.moved += Math.abs(dx) + Math.abs(dy)
    setView((v) => ({ ...v, tx: v.tx + dx, ty: v.ty + dy }))
  }
  const onPointerUp = () => {
    // A click that barely moved on empty map clears the selection.
    if (drag.current && drag.current.moved < 4) onSelect(null)
    drag.current = null
  }

  const hover = (e: React.MouseEvent, text: string | null) => {
    if (!text) return setTip(null)
    const r = wrapRef.current!.getBoundingClientRect()
    setTip({ x: e.clientX - r.left, y: e.clientY - r.top, text })
  }

  const ordered = useMemo(
    () => [...paths].sort((a, b) => Number(a.link.id === selectedId) - Number(b.link.id === selectedId)),
    [paths, selectedId],
  )

  // Declutter: keep at most one RouteId label per screen-space grid cell, longest routes first.
  const visibleLabels = useMemo(() => {
    const taken = new Set<string>()
    const out: JSX.Element[] = []
    for (const l of base.labels) {
      const sx = l.px * view.k + view.tx, sy = l.py * view.k + view.ty
      if (sx < 0 || sy < 0 || sx > size.w || sy > size.h) continue
      const cell = `${Math.floor(sx / 64)}:${Math.floor(sy / 16)}`
      if (taken.has(cell)) continue
      taken.add(cell)
      out.push(
        <text key={l.routeId} x={sx} y={sy - 4} textAnchor="middle" className="map-label">
          {l.routeId}
        </text>,
      )
    }
    return out
  }, [base.labels, view, size.w, size.h])

  // Basemap tiles that cover the current view, at the zoom level closest to the current scale.
  const tiles = useMemo(() => {
    if (!basemap.url) return []
    const z = Math.max(0, Math.min(basemap.maxZoom, Math.round(Math.log2((W * view.k) / 256))))
    const n = 2 ** z
    const left = -view.tx / view.k, right = (size.w - view.tx) / view.k
    const top = -view.ty / view.k, bottom = (size.h - view.ty) / view.k
    const clamp = (v: number) => Math.max(0, Math.min(n - 1, v))
    const x0 = clamp(Math.floor((left / W) * n)), x1 = clamp(Math.floor((right / W) * n))
    const y0 = clamp(Math.floor((top / W) * n)), y1 = clamp(Math.floor((bottom / W) * n))
    const out: { key: string; href: string; x: number; y: number }[] = []
    for (let x = x0; x <= x1 && out.length < 80; x++)
      for (let y = y0; y <= y1 && out.length < 80; y++)
        out.push({ key: `${basemap.id}/${z}/${x}/${y}`, href: tileUrl(basemap, z, x, y), x: (x / n) * W, y: (y / n) * W })
    return out.map((t) => ({ ...t, size: W / n }))
  }, [basemap, view, size.w, size.h])

  return (
    <div className={`map-wrap${basemap.id === 'satellite' ? ' on-imagery' : ''}`} ref={wrapRef}>
      <svg
        onWheel={onWheel}
        onPointerDown={onPointerDown}
        onPointerMove={onPointerMove}
        onPointerUp={onPointerUp}
        role="img"
        aria-label="Road network map"
      >
        <g transform={`translate(${view.tx} ${view.ty}) scale(${view.k})`}>
          {tiles.map((t) => (
            <image
              key={t.key}
              href={t.href}
              x={t.x}
              y={t.y}
              width={t.size + t.size * 0.004}
              height={t.size + t.size * 0.004}
              preserveAspectRatio="none"
              className="map-tile"
              pointerEvents="none"
            />
          ))}
          {base.lines.map((r) => (
            <path key={`n${r.id}`} d={r.d} className="map-base" vectorEffect="non-scaling-stroke" />
          ))}
          {ordered.map(({ link, d }) => (
            <path
              key={link.id}
              d={d}
              className={`map-link${selectedId != null && selectedId !== link.id ? ' dim' : ''}${selectedId === link.id ? ' sel' : ''}`}
              stroke={colourOf(link)}
              strokeWidth={selectedId === link.id ? widthOf(link) + 2 : widthOf(link)}
              vectorEffect="non-scaling-stroke"
              onPointerDown={(e) => e.stopPropagation()}
              onClick={(e) => { e.stopPropagation(); onSelect(link.id) }}
              onMouseMove={(e) => hover(e, `${link.label} (${link.range})${link.vc != null ? ` · V/C ${link.vc.toFixed(2)}` : ''}`)}
              onMouseLeave={() => setTip(null)}
            />
          ))}
        </g>

        {showNames && <g className="map-labels">{visibleLabels}</g>}

        {showStations &&
          pts.map(({ s, p }) => {
            const sx = p[0] * view.k + view.tx, sy = p[1] * view.k + view.ty
            if (sx < -10 || sy < -10 || sx > size.w + 10 || sy > size.h + 10) return null
            const picked = s.id === selectedStationId
            const half = picked ? 7 : 5
            return (
              <g key={s.id}>
              {picked && <circle cx={sx} cy={sy} r={14} className="station-ring" />}
              <rect
                x={sx - half} y={sy - half} width={half * 2} height={half * 2} rx={2}
                fill={BAND_COLOURS[s.band]} stroke="#fff" strokeWidth={2}
                className="map-station"
                onClick={(e) => { e.stopPropagation(); onStationClick?.(s) }}
                role="button"
                aria-label={`Count station ${s.name || s.code}: vehicles counted`}
                onPointerDown={(e) => e.stopPropagation()}
                onMouseMove={(e) =>
                  hover(
                    e,
                    `${s.code}${s.name ? ' · ' + s.name : ''} · ${BAND_STATUS[s.band]}${s.effectiveVc != null ? ` (V/C ${s.effectiveVc.toFixed(2)}${s.vcSource === 'segment' ? ', from segment' : ''})` : ''}`,
                  )
                }
                onMouseLeave={() => setTip(null)}
              />
              </g>
            )
          })}
      </svg>

      <div className="basemap-switch">
        <label>
          <span className="sr-only">Basemap</span>
          <select aria-label="Basemap" value={basemap.id} onChange={(e) => chooseBasemap(e.target.value)}>
            {BASEMAPS.map((b) => <option key={b.id} value={b.id}>{b.label}</option>)}
          </select>
        </label>
      </div>
      {basemap.attribution && <div className="map-attribution">{basemap.attribution}</div>}

      <div className="map-zoom">
        <button aria-label="Zoom in" onClick={() => zoomAt(1.5, size.w / 2, size.h / 2)}>+</button>
        <button aria-label="Zoom out" onClick={() => zoomAt(1 / 1.5, size.w / 2, size.h / 2)}>−</button>
        <button aria-label="Home: zoom to the full network" title="Home" onClick={() => { fit(); setTip(null) }}>
          <svg width="16" height="16" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" aria-hidden>
            <path d="M2 7.5 8 2.5l6 5M3.5 6.5V13h3.2V9.5h2.6V13h3.2V6.5" />
          </svg>
        </button>
      </div>
      {tip && <div className="map-tip" style={{ left: tip.x, top: tip.y }}>{tip.text}</div>}
    </div>
  )
}
