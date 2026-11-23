import { useLocation } from 'react-router-dom'
import { TABS } from '../components/AppShell'

export function ComingSoon() {
  const { pathname } = useLocation()
  const tab = TABS.find((t) => t.to === pathname)
  return (
    <main className="page">
      <div className="state card">
        <h2>{tab?.label ?? 'Not found'}</h2>
        <p>This screen is planned next. The Network map is built first.</p>
      </div>
    </main>
  )
}
