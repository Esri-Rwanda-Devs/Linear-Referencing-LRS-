// Groups the 12 counted classes in the services into the 5 groups the mockup shows.
// Edit here if your definition differs (e.g. whether jeep counts as a car).

export type ClassCounts = Partial<Record<RawClass, number | null>>

export type RawClass =
  | 'motorcycle' | 'cars' | 'jeep' | 'minibus' | 'coasters' | 'lgv' | 'bus'
  | 'axle2' | 'axle3' | 'semitrailer' | 'trucktrailer' | 'others'

export const GROUPS = {
  motorcycles: { label: 'Motorcycles', members: ['motorcycle'] },
  cars: { label: 'Cars', members: ['cars', 'jeep'] },
  light: { label: 'Light goods', members: ['lgv'] },
  buses: { label: 'Buses', members: ['minibus', 'coasters', 'bus'] },
  trucks: { label: 'Trucks', members: ['axle2', 'axle3', 'semitrailer', 'trucktrailer'] },
  others: { label: 'Others', members: ['others'] },
} as const satisfies Record<string, { label: string; members: readonly RawClass[] }>

export type GroupKey = keyof typeof GROUPS

export const GROUP_COLOURS: Record<GroupKey, string> = {
  cars: '#2f6fb7',
  light: '#9db9e0',
  trucks: '#b8651b',
  buses: '#e0a458',
  motorcycles: '#7a8691',
  others: '#c3cbd1',
}

/** Vehicle class filter chips on the map screen. */
export const FILTER_CHIPS: { key: 'all' | GroupKey; label: string }[] = [
  { key: 'all', label: 'All' },
  { key: 'cars', label: 'Cars' },
  { key: 'trucks', label: 'Trucks' },
  { key: 'buses', label: 'Buses' },
  { key: 'motorcycles', label: 'Motorcycles' },
]

export const sumGroup = (counts: ClassCounts, key: GroupKey) =>
  GROUPS[key].members.reduce<number>((s, m) => s + (counts[m] ?? 0), 0)

export function groupTotals(counts: ClassCounts): Record<GroupKey, number> {
  const out = {} as Record<GroupKey, number>
  for (const k of Object.keys(GROUPS) as GroupKey[]) out[k] = sumGroup(counts, k)
  return out
}

// ---- Vehicle types counted at stations (field names as in Traffic_Stations_Event) ----
export type StationType =
  | 'motorcycles' | 'cars' | 'minibus' | 'coasters' | 'lgv' | 'bus'
  | 'axle2' | 'axle3' | 'semitrailer' | 'trucktrailer' | 'others'

export type VehicleIconKey =
  | 'motorcycle' | 'car' | 'minibus' | 'coaster' | 'lgv' | 'bus'
  | 'truck2' | 'truck3' | 'semitrailer' | 'trucktrailer' | 'others'

export const STATION_TYPES: { key: StationType; label: string; icon: VehicleIconKey }[] = [
  { key: 'motorcycles', label: 'Motorcycles', icon: 'motorcycle' },
  { key: 'cars', label: 'Cars', icon: 'car' },
  { key: 'minibus', label: 'Minibuses', icon: 'minibus' },
  { key: 'coasters', label: 'Coasters', icon: 'coaster' },
  { key: 'lgv', label: 'Light goods (LGV)', icon: 'lgv' },
  { key: 'bus', label: 'Buses', icon: 'bus' },
  { key: 'axle2', label: 'Trucks, 2 axles', icon: 'truck2' },
  { key: 'axle3', label: 'Trucks, 3 axles', icon: 'truck3' },
  { key: 'semitrailer', label: 'Semi-trailers', icon: 'semitrailer' },
  { key: 'trucktrailer', label: 'Truck and trailer', icon: 'trucktrailer' },
  { key: 'others', label: 'Others', icon: 'others' },
]

export type StationCounts = Record<StationType, number | null>

/** Icons for the grouped classes used on the map and in charts. */
export const GROUP_ICONS: Record<GroupKey, VehicleIconKey> = {
  motorcycles: 'motorcycle',
  cars: 'car',
  light: 'lgv',
  buses: 'bus',
  trucks: 'truck2',
  others: 'others',
}

/**
 * Sample vehicle damage factors: equivalent standard axles (E80) caused by one vehicle of each type passing.
 * They are placeholders until the national values are set in Outputs and parameters.
 */
export const VDF_DEFAULTS: Record<StationType, number> = {
  motorcycles: 0,
  cars: 0.0004,
  minibus: 0.003,
  coasters: 0.01,
  lgv: 0.03,
  bus: 0.7,
  axle2: 1.5,
  axle3: 3.0,
  semitrailer: 4.5,
  trucktrailer: 5.5,
  others: 0.2,
}
