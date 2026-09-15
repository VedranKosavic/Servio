/**
 * *Stolovi* — the pure half of `app/pages/admin/kontrola/stolovi.vue`.
 *
 * The floor plan is data, not layout: `FloorPlan.vue` (the waiter) and
 * `floorZones` in `puls.ts` (the owner) both draw one vertical stack per `col`,
 * ordered by `row`, with a `grp` (today the VIP pair) boxed under its column.
 * So this screen never positions anything — it edits the four numbers those two
 * read, and these helpers keep the list in the same order the plan draws it.
 */
import { bsCompare } from '#shared/collate'
import type { TableAdmin, Zone } from '#shared/types'

/** `unutra` before `basta`, the order the room reads and the plan draws. */
export const STOLOVI_ZONES: ReadonlyArray<{ value: Zone, label: string }> = [
  { value: 'unutra', label: 'Unutra' },
  { value: 'basta', label: 'Bašta' },
]

export interface StoloviZone {
  zone: Zone
  label: string
  tables: TableAdmin[]
}

/**
 * The tables of each zone in plan order: column, then the ordinary stack before
 * a boxed group, then row. A zone with no tables is still returned, so the owner
 * can see *Bašta* is empty rather than wonder where it went.
 */
export function stoloviByZone(tables: TableAdmin[]): StoloviZone[] {
  return STOLOVI_ZONES.map(({ value, label }) => ({
    zone: value,
    label,
    tables: tables
      .filter(t => t.zone === value)
      .slice()
      .sort((a, b) => a.col - b.col
        || bsCompare(a.grp ?? '', b.grp ?? '')
        || a.row - b.row
        || bsCompare(a.name, b.name)),
  }))
}

/** One square on the plan: zone, column, group and row together. */
function spotKey(t: Pick<TableAdmin, 'zone' | 'col' | 'row' | 'grp'>): string {
  return `${t.zone}:${t.col}:${t.grp ?? ''}:${t.row}`
}

/**
 * The ids of active tables that share a square with another active table.
 *
 * The plan does not refuse it — two tables on one row are simply stacked in
 * name order — but it is almost always a typo, so the screen marks both.
 */
export function stoloviClashes(tables: TableAdmin[]): Set<string> {
  const bySpot = new Map<string, string[]>()
  for (const t of tables) {
    if (!t.active) continue
    const key = spotKey(t)
    bySpot.set(key, [...(bySpot.get(key) ?? []), t.id])
  }
  return new Set([...bySpot.values()].filter(ids => ids.length > 1).flat())
}

/** What a new table is prefilled with: the next free name and a free square. */
export interface StoloviDraft {
  name: string
  zone: Zone
  col: number
  row: number
}

/**
 * The next *Sto N* after the highest number the venue has ever used — counting
 * deactivated tables too, because their names still stand on old rounds — and
 * the square under the last table of the zone's first column.
 */
export function stoloviNextDraft(tables: TableAdmin[], zone: Zone): StoloviDraft {
  const numbers = tables
    .map(t => /^sto\s+(\d+)$/i.exec(t.name.trim()))
    .filter((m): m is RegExpExecArray => m !== null)
    .map(m => Number(m[1]))
  const next = numbers.length ? Math.max(...numbers) + 1 : 1

  const inZone = tables.filter(t => t.zone === zone && t.active && !t.grp)
  const col = inZone.length ? Math.min(...inZone.map(t => t.col)) : 1
  const rows = inZone.filter(t => t.col === col).map(t => t.row)
  const row = Math.min(12, rows.length ? Math.max(...rows) + 1 : 1)

  return { name: `Sto ${next}`, zone, col, row }
}

/** "kolona 2 · red 3 · VIP" — where a table sits, in words. */
export function stoloviSpotBs(t: Pick<TableAdmin, 'col' | 'row' | 'grp'>): string {
  const parts = [`kolona ${t.col}`, `red ${t.row}`]
  if (t.grp) parts.push(t.grp.toUpperCase())
  return parts.join(' · ')
}
