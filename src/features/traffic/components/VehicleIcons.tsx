import type { ReactNode } from 'react'

// Simple side-view vehicle glyphs on a 28 x 16 grid. They draw with currentColor, so they follow text colour.
export type VehicleIconType =
  | 'motorcycle' | 'car' | 'minibus' | 'coaster' | 'lgv' | 'bus'
  | 'truck2' | 'truck3' | 'semitrailer' | 'trucktrailer' | 'others'

const wheel = (cx: number, r = 2.2, cy = 12.5) => <circle key={cx} cx={cx} cy={cy} r={r} />

const SHAPES: Record<VehicleIconType, ReactNode> = {
  motorcycle: (
    <>
      {wheel(6, 3, 11.5)}{wheel(22, 3, 11.5)}
      <path d="M6 11.5 11 6h6l5 5.5M17 6l2-3h3M9 5.5h4" />
    </>
  ),
  car: (
    <>
      <path d="M2 12V8.5l3.5-1L9 4h8.5l4 3.5L26 9v3zM9 7.5h13" />
      {wheel(8, 2.3, 12)}{wheel(20, 2.3, 12)}
    </>
  ),
  minibus: (
    <>
      <path d="M2 12V4.5h16.5L24 9v3zM6 4.5v4M11 4.5v4M16 4.5v4" />
      {wheel(7)}{wheel(19)}
    </>
  ),
  coaster: (
    <>
      <path d="M1.5 12V4h18L26 9v3zM6 4v4.5M11 4v4.5M16 4v4.5" />
      {wheel(6)}{wheel(20)}
    </>
  ),
  lgv: (
    <>
      <path d="M2 12V3.5h12V6h6l5 4v2zM14 6v6" />
      {wheel(7)}{wheel(20)}
    </>
  ),
  bus: (
    <>
      <path d="M1.5 12V3h25v9zM1.5 8h25M7 3v5M13 3v5M19 3v5" />
      {wheel(7)}{wheel(21)}
    </>
  ),
  truck2: (
    <>
      <path d="M2 12V6.5h5.5L10 9.5V12zM11 12V3.5h15V12z" />
      {wheel(6)}{wheel(19)}
    </>
  ),
  truck3: (
    <>
      <path d="M2 12V6.5h5.5L10 9.5V12zM11 12V3.5h15V12z" />
      {wheel(6)}{wheel(17)}{wheel(23)}
    </>
  ),
  semitrailer: (
    <>
      <path d="M1.5 12V6.5H6L8 9.5V12zM9 12V4h17.5v8z" />
      {wheel(5)}{wheel(18)}{wheel(23)}
    </>
  ),
  trucktrailer: (
    <>
      <path d="M1.5 12V6.5h4L7.5 9v3zM8 12V4h8v8zM16 10h2M18 12V5h8.5v7z" />
      {wheel(4.5)}{wheel(12)}{wheel(22)}
    </>
  ),
  others: (
    <g fill="currentColor" stroke="none">
      <circle cx="8" cy="8" r="1.5" /><circle cx="14" cy="8" r="1.5" /><circle cx="20" cy="8" r="1.5" />
    </g>
  ),
}

export function VehicleIcon({ type, size = 18, title }: { type: VehicleIconType; size?: number; title?: string }) {
  return (
    <svg
      className="vehicle-icon"
      viewBox="0 0 28 16"
      width={Math.round(size * 1.75)}
      height={size}
      fill="none"
      stroke="currentColor"
      strokeWidth={1.4}
      strokeLinecap="round"
      strokeLinejoin="round"
      role={title ? 'img' : undefined}
      aria-label={title}
      aria-hidden={title ? undefined : true}
    >
      {SHAPES[type]}
    </svg>
  )
}
