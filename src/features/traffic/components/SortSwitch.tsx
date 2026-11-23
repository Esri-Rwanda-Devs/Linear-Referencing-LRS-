import type { SortMode } from '../lib/trafficData'

export function SortSwitch({ value, onChange }: { value: SortMode; onChange: (m: SortMode) => void }) {
  return (
    <div className="seg seg-sm" role="group" aria-label="Sort order">
      <button className={value === 'vc' ? 'on' : ''} onClick={() => onChange('vc')}>V/C ratio</button>
      <button className={value === 'measure' ? 'on' : ''} onClick={() => onChange('measure')}>Road and measure</button>
    </div>
  )
}
