const KPI_ICONS = {
  stations: <><path d="M12 21s-6-5.6-6-10a6 6 0 1 1 12 0c0 4.4-6 10-6 10z" /><circle cx="12" cy="11" r="2" /></>,
  free: <><circle cx="12" cy="12" r="9" /><path d="M8 12.5l2.7 2.7L16 9.5" /></>,
  near: <path d="M4 16a8 8 0 1 1 16 0M12 16l4-5" />,
  congested: <path d="M12 4l9 16H3zM12 10v4M12 17v.5" />,
  over: <><circle cx="12" cy="12" r="9" /><path d="M12 7.5v5M12 16v.5" /></>,
  none: <><circle cx="12" cy="12" r="9" /><path d="M9 12h6" /></>,
  rising: <path d="M4 17l5-5 4 3 7-8M15 7h5v5" />,
  falling: <path d="M4 7l5 5 4-3 7 8M15 17h5v-5" />,
  stable: <path d="M4 12h16M16 8l4 4-4 4" />,
  vehicles: <><path d="M3 15v-3l2-5h14l2 5v3zM3 15v3h3v-3M18 15v3h3v-3" /><circle cx="7.5" cy="12.5" r="0.6" /><circle cx="16.5" cy="12.5" r="0.6" /></>,
  average: <path d="M4 20V10M10 20V4M16 20v-7M3 14h18" />,
  calendar: <><rect x="4" y="5" width="16" height="15" rx="2" /><path d="M4 10h16M9 3v4M15 3v4" /></>,
  road: <path d="M8 3 5 21M16 3l3 18M12 4v3M12 11v3M12 18v3" />,
}

export type KpiIconName = keyof typeof KPI_ICONS

/** A small tinted icon that sits in front of the figure on an indicator card. */
export function KpiIcon({ name, colour }: { name: KpiIconName; colour: string }) {
  return (
    <span className="kpi-icon" style={{ color: colour, background: `color-mix(in srgb, ${colour} 14%, transparent)` }} aria-hidden>
      <svg viewBox="0 0 24 24" width="18" height="18">{KPI_ICONS[name]}</svg>
    </span>
  )
}
