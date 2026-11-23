import { NavLink, Outlet } from 'react-router-dom'

/** A tab marked hidden is left out of the menu; its page and route stay in place. */
export const TABS: { to: string; label: string; end?: boolean; hidden?: boolean }[] = [
  { to: '/', label: 'Network map', end: true },
  { to: '/stations', label: 'Count stations' },
  { to: '/import', label: 'Import and validation' },
  { to: '/capacity', label: 'Capacity analysis' },
  // { to: '/growth', label: 'Growth and loading' },
  { to: '/weighbridge', label: 'Weighbridge', hidden: true },
  { to: '/parameters', label: 'Outputs and parameters', hidden: true },
]

export function AppShell() {
  return (
    <>
      <nav className="tms-nav" aria-label="Traffic sections">
        {TABS.filter((t) => !t.hidden).map((t) => (
          <NavLink key={t.to} to={t.to} end={t.end}>
            {t.label}
          </NavLink>
        ))}
      </nav>
      <div className="tms-scroll">
        <Outlet />
      </div>
    </>
  )
}
