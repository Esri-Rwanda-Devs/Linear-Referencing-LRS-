import { useMemo } from 'react'
import { useQuery } from '@tanstack/react-query'
import { discoverLayers, loadStations, withStatus, type YearBasis } from './trafficData'
import { useSurveys } from './trafficCounts'
import { useLinks } from './useLinks'

interface Options {
  /**
   * Work out each station's figures for the selected survey year from the counts (V/C and AADT from the
   * survey, PCU = V/C x capacity). Without it, stations show their own record, whatever the year.
   */
  byYear?: boolean
}

/** Count stations with a congestion status. Same query keys as the map, so data is fetched once. */
export function useStations({ byYear = false }: Options = {}) {
  const { links, loading: linksLoading, error: linksError, year, setYear, years: linkYears } = useLinks()
  const layers = useQuery({ queryKey: ['layers'], queryFn: discoverLayers, staleTime: Infinity })
  const raw = useQuery({
    queryKey: ['stations', layers.data?.points],
    queryFn: () => loadStations(layers.data!.points),
    enabled: !!layers.data,
  })
  const surveys = useSurveys(byYear)

  // Years to pick from: the survey years found in Traffic_Count, newest first (road-section years until they load).
  const years = useMemo(() => {
    if (!byYear || !surveys.data?.length) return linkYears
    return [...new Set(surveys.data.map((s) => s.year))].sort().reverse()
  }, [byYear, linkYears, surveys.data])

  const basis = useMemo<YearBasis | undefined>(() => {
    if (!byYear || !surveys.data) return undefined
    return {
      year,
      surveys: new Map(surveys.data.map((s) => [`${s.code}|${s.year}`, s])),
      currentYear: years[0] ?? null,
    }
  }, [byYear, surveys.data, year, years])

  // A station without its own V/C inherits the V/C of the segment it sits on.
  const stations = useMemo(() => withStatus(raw.data ?? [], links, basis), [raw.data, links, basis])
  return {
    stations,
    links,
    year, setYear, years,
    loading: layers.isLoading || raw.isLoading || linksLoading || (byYear && surveys.isLoading),
    error: (raw.error ?? linksError ?? (byYear ? surveys.error : null)) as Error | null,
  }
}
