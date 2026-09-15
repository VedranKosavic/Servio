/**
 * *Prijem robe danas* on *Puls*: today is the café's business day, read off when
 * the delivery was entered, and a reversed delivery is listed but not counted.
 */
import { describe, expect, it } from 'vitest'
import { prijemToday } from '../../app/utils/pulsPrijem'
import type { DeliveryView } from '../../shared/types'

function delivery(patch: Partial<DeliveryView>): DeliveryView {
  return {
    id: 'd-1', client_id: 'c-1', supplier_name: 'Coca-Cola HBC', invoice_no: null,
    delivered_at: '2026-09-15T00:00:00Z', created_at: '2026-09-15T09:00:00Z',
    total_fen: 5088, status: 'posted', reversed_at: null, reversal_note: null,
    entered_by: 'u-1', entered_by_name: 'Haris', note: null, source: 'manual',
    scan_id: null, lines: [], already_applied: false,
    ...patch,
  }
}

describe('prijemToday', () => {
  // 14:38 in Sarajevo on 15.09.2026 — business day 2026-09-15.
  const now = '2026-09-15T12:38:00Z'

  it('keeps the deliveries entered today, newest first, and sums them', () => {
    const result = prijemToday([
      delivery({ id: 'morning', created_at: '2026-09-15T07:10:00Z', total_fen: 1000 }),
      delivery({ id: 'noon', created_at: '2026-09-15T10:05:00Z', total_fen: 2500 }),
      delivery({ id: 'yesterday', created_at: '2026-09-14T15:00:00Z', total_fen: 9999 }),
    ], now)
    expect(result.deliveries.map(d => d.id)).toEqual(['noon', 'morning'])
    expect(result.total_fen).toBe(3500)
    expect(result.last_at).toBe('2026-09-15T10:05:00Z')
  })

  it('reads the entry time, not the invoice date', () => {
    const booked = delivery({ delivered_at: '2026-09-13T00:00:00Z', created_at: '2026-09-15T08:00:00Z' })
    expect(prijemToday([booked], now).deliveries).toHaveLength(1)
  })

  it('counts 02:00 as the night before, because the day starts at 06:00', () => {
    // 01:30 Sarajevo on the 15th belongs to business day 14.
    const late = delivery({ created_at: '2026-09-14T23:30:00Z' })
    expect(prijemToday([late], now).deliveries).toHaveLength(0)
  })

  it('lists a reversed delivery but adds nothing for it', () => {
    const result = prijemToday([
      delivery({ id: 'ok', total_fen: 2000 }),
      delivery({ id: 'undone', total_fen: 7000, reversed_at: '2026-09-15T11:00:00Z' }),
    ], now)
    expect(result.deliveries).toHaveLength(2)
    expect(result.total_fen).toBe(2000)
  })

  it('is empty with no deliveries today', () => {
    expect(prijemToday([], now)).toEqual({ deliveries: [], total_fen: 0, last_at: null })
  })
})
