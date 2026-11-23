// Raster tile basemaps (Web Mercator, XYZ). Add or replace entries here, for example with
// your organisation's own tile service, which avoids sending viewers' requests to third parties.
export interface Basemap {
  id: string
  label: string
  /** {z}/{x}/{y} are tile coordinates; {s} is a subdomain from `subdomains`. */
  url: string | null
  subdomains?: string
  maxZoom: number
  attribution: string
}

export const BASEMAPS: Basemap[] = [
  {
    id: 'satellite',
    label: 'Satellite',
    url: 'https://server.arcgisonline.com/ArcGIS/rest/services/World_Imagery/MapServer/tile/{z}/{y}/{x}',
    maxZoom: 18,
    attribution: 'Imagery © Esri, Maxar, Earthstar Geographics',
  },
  {
    id: 'streets',
    label: 'Streets',
    url: 'https://tile.openstreetmap.org/{z}/{x}/{y}.png',
    maxZoom: 19,
    attribution: '© OpenStreetMap contributors',
  },
  {
    id: 'topo',
    label: 'Topographic',
    url: 'https://server.arcgisonline.com/ArcGIS/rest/services/World_Topo_Map/MapServer/tile/{z}/{y}/{x}',
    maxZoom: 18,
    attribution: 'Tiles © Esri',
  },
  { id: 'none', label: 'None', url: null, maxZoom: 19, attribution: '' },
]

export const DEFAULT_BASEMAP = 'satellite'

export function tileUrl(b: Basemap, z: number, x: number, y: number): string {
  const s = b.subdomains ? b.subdomains[(x + y) % b.subdomains.length] : ''
  return (b.url ?? '').replace('{s}', s).replace('{z}', String(z)).replace('{x}', String(x)).replace('{y}', String(y))
}
