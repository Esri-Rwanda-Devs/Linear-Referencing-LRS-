import { MemoryRouter, Route, Routes } from 'react-router-dom'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { AppShell } from './components/AppShell'
import { NetworkMap } from './pages/NetworkMap'
import { CapacityAnalysis } from './pages/CapacityAnalysis'
import { CountStations } from './pages/CountStations'
import { ImportValidation } from './pages/ImportValidation'
import { GrowthLoading } from './pages/GrowthLoading'
import { ComingSoon } from './pages/ComingSoon'
import './tms.css'

const queryClient = new QueryClient({
  defaultOptions: { queries: { staleTime: 5 * 60_000, refetchOnWindowFocus: false, retry: 1 } },
})

/** Traffic management screens, hosted inside the LRS TMS tab. */
export default function TrafficApp() {
  return (
    <div className="tms">
      <QueryClientProvider client={queryClient}>
        <MemoryRouter>
          <Routes>
            <Route element={<AppShell />}>
              <Route index element={<NetworkMap />} />
              <Route path="stations" element={<CountStations />} />
              <Route path="capacity" element={<CapacityAnalysis />} />
              <Route path="import" element={<ImportValidation />} />
              <Route path="growth" element={<GrowthLoading />} />
              <Route path="*" element={<ComingSoon />} />
            </Route>
          </Routes>
        </MemoryRouter>
      </QueryClientProvider>
    </div>
  )
}
