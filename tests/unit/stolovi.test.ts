/**
 * *Stolovi* — the list order, the square check, the prefill, and the one sync
 * gap this screen exposed.
 *
 * **The sync.** A table edit bumps `table` and `menu` (see `admin.test.ts`).
 * Every screen that holds the bootstrap — which is where a table's name, zone
 * and square live — must refetch it when the catalogue moves, or a table added
 * on a laptop stays off that screen's plan until a reload. The phones did so
 * through `useChanges`' `menu` handler; *Puls* and the popis screen did not.
 * The last test here reads the sources, so the next screen to hold the
 * bootstrap cannot forget it either.
 */
import { readFileSync, readdirSync, statSync } from 'node:fs'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'
import type { TableAdmin } from '../../shared/types'
import {
  stoloviByZone, stoloviClashes, stoloviNextDraft, stoloviSpotBs,
} from '../../app/utils/stolovi'
import { catalogueMoved } from '../../app/utils/puls'

let n = 0
function table(patch: Partial<TableAdmin>): TableAdmin {
  n += 1
  return {
    id: `t${n}`,
    name: `Sto ${n}`,
    zone: 'unutra',
    col: 1,
    row: 1,
    grp: null,
    sort: 0,
    active: true,
    has_open_tab: false,
    ...patch,
  }
}

describe('stoloviByZone', () => {
  it('lists each zone in the order the plan draws it, and keeps an empty zone', () => {
    const rows = [
      table({ id: 'c2', col: 2, row: 1 }),
      table({ id: 'vip', col: 1, row: 1, grp: 'vip' }),
      table({ id: 'c1r2', col: 1, row: 2 }),
      table({ id: 'c1r1', col: 1, row: 1 }),
    ]
    const zones = stoloviByZone(rows)
    expect(zones.map(z => z.zone)).toEqual(['unutra', 'basta'])
    expect(zones[0]!.tables.map(t => t.id)).toEqual(['c1r1', 'c1r2', 'vip', 'c2'])
    expect(zones[1]!.tables).toEqual([])
  })
})

describe('stoloviClashes', () => {
  it('marks two active tables on one square, and ignores a switched-off one', () => {
    const a = table({ col: 2, row: 3 })
    const b = table({ col: 2, row: 3 })
    const off = table({ col: 1, row: 1, active: false })
    const c = table({ col: 1, row: 1 })
    // Same col and row, but inside the VIP box: a different square.
    const vip = table({ col: 2, row: 3, grp: 'vip' })
    expect([...stoloviClashes([a, b, off, c, vip])].sort()).toEqual([a.id, b.id].sort())
  })
})

describe('stoloviNextDraft', () => {
  it('names the next table past every number ever used, and puts it under the first column', () => {
    const rows = [
      table({ name: 'Sto 3', col: 1, row: 2 }),
      table({ name: 'Sto 14', col: 1, row: 5, active: false }),
      table({ name: 'Sto 2', col: 1, row: 4 }),
      table({ name: 'Šank', col: 2, row: 9 }),
    ]
    expect(stoloviNextDraft(rows, 'unutra')).toEqual({ name: 'Sto 15', zone: 'unutra', col: 1, row: 5 })
    expect(stoloviNextDraft(rows, 'basta')).toEqual({ name: 'Sto 15', zone: 'basta', col: 1, row: 1 })
  })

  it('never proposes a row the schema would refuse', () => {
    expect(stoloviNextDraft([table({ row: 12 })], 'unutra').row).toBe(12)
  })
})

describe('stoloviSpotBs', () => {
  it('says where a table sits', () => {
    expect(stoloviSpotBs({ col: 3, row: 1, grp: 'vip' })).toBe('kolona 3 · red 1 · VIP')
    expect(stoloviSpotBs({ col: 1, row: 6, grp: null })).toBe('kolona 1 · red 6')
  })
})

describe('a table edit reaches every plan', () => {
  it('treats the two entities behind menu_version as a stale bootstrap', () => {
    expect(catalogueMoved('menu')).toBe(true)
    expect(catalogueMoved('settings')).toBe(true)
    expect(catalogueMoved('table')).toBe(false)
    expect(catalogueMoved('stock')).toBe(false)
  })

  it('every screen that holds the bootstrap and polls refetches it when the catalogue moves', () => {
    const files: string[] = []
    const walk = (dir: string) => {
      for (const name of readdirSync(dir)) {
        const path = join(dir, name)
        if (statSync(path).isDirectory()) walk(path)
        else if (name.endsWith('.vue')) files.push(path)
      }
    }
    walk('app/pages')
    walk('app/components')

    const holders = files.filter((path) => {
      const src = readFileSync(path, 'utf8')
      return src.includes('useBootstrapData()')
        && (src.includes('useChanges(') || src.includes('useAdminChanges('))
    })
    // The floor plan's three: the waiter, *Puls*, and the table sheet.
    expect(holders).toEqual(expect.arrayContaining([
      join('app/pages/konobar/index.vue'),
      join('app/pages/admin/index.vue'),
      join('app/pages/konobar/sto/[id].vue'),
    ]))

    const stale = holders.filter((path) => {
      const src = readFileSync(path, 'utf8')
      const refresh = /refresh:\s*(\w+)[^}]*\}\s*=\s*useBootstrapData\(\)/.exec(src)?.[1]
      if (!refresh) return true
      const onMenu = new RegExp(`menu:\\s*\\(\\)\\s*=>\\s*${refresh}\\(`).test(src)
      const onEntity = new RegExp(`catalogueMoved\\(\\w+\\)\\)\\s*void\\s+${refresh}\\(`).test(src)
      return !onMenu && !onEntity
    })
    expect(stale).toEqual([])
  })
})
