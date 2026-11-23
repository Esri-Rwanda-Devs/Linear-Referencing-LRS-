import { useEffect, useState } from 'react'
import { useQuery } from '@tanstack/react-query'
import { discoverLayers, loadLinks, loadYears } from './trafficData'

/** Route sections for a survey year. Uses the same query keys as the map, so the data is cached once. */
export function useLinks() {
  const [year, setYear] = useState<string | null>(null)
  const layers = useQuery({ queryKey: ['layers'], queryFn: discoverLayers, staleTime: Infinity })
  const years = useQuery({
    queryKey: ['years', layers.data?.lines],
    queryFn: () => loadYears(layers.data!.lines),
    enabled: !!layers.data,
  })
  useEffect(() => {
    if (year == null && years.data) setYear(years.data[0] ?? '')
  }, [years.data, year])

  const links = useQuery({
    queryKey: ['links', layers.data?.lines, year],
    queryFn: () => loadLinks(layers.data!.lines, year || null),
    enabled: !!layers.data && year != null,
  })

  return {
    year,
    setYear,
    years: years.data ?? [],
    links: links.data ?? [],
    loading: layers.isLoading || years.isLoading || links.isLoading,
    error: (layers.error ?? years.error ?? links.error) as Error | null,
  }
}
