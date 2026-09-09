/**
 * *Brzi popis*, *Otpis* and *Dopuni smjenu* — the four routes those three
 * screens post to, and the one place their URLs are written (WP2).
 *
 * **Why this is not in `useApi.ts`.** A path in Šank has exactly one owner
 * (`docs/PHASE3.md` §3), and four packages are building four screens at the
 * same time. Each one keeps its own routes in its own composable — WP1 in
 * `useAdjustments.ts`, WP4 in `useMe.ts` — so nobody's PR is a merge conflict on
 * a file everybody touched. The rules `useApi.ts` sets still hold here and are
 * not negotiable: no body ever names the actor (the session does), cookies ride
 * along, and every failure comes back as an `ApiSideError` with a `code` a
 * screen can branch on.
 *
 * **Why the count does not go through the outbox.** The outbox is money and
 * stock *movements* — an order, a payment, an otpis. A count is neither: it is a
 * reading of the shelf at one instant, and the server refuses it outright while
 * any phone in the shift still holds unsent rounds (409 `PENDING_OUTBOX`),
 * precisely because a round that lands after the reading would be read as
 * shrinkage. Queueing a count would queue that contradiction. So *Predaj popis*
 * is online-only and says so, while *Otpis* — which is a movement — is enqueued
 * like everything else and never posts itself.
 */
import type { CashMovement, CountView, SubmitCountBody } from '#shared/types'
// Not in the `shared/types.ts` barrel (it lists the bodies Korak 1's screens
// needed); `z.infer` of the object the route validates against is the same
// definition, taken straight from the schema exactly as `useApi.ts` does.
import type { MoveFloatBody } from '#shared/schemas'
import { ApiSideError } from '~/composables/useApi'

/**
 * The h3 error envelope, unwrapped into the same `ApiSideError` the rest of the
 * app catches: `{ code, message, ...data }` sits at `err.data.data`, and
 * `apiErrorText()` needs `code` and `data` to fill in a sentence's numbers
 * (*"Amarov telefon se javio prije 3 min"*).
 */
function toApiError(err: unknown): ApiSideError {
  const e = err as {
    status?: number
    statusCode?: number
    data?: { data?: { code?: string, message?: string } & Record<string, unknown>, message?: string }
  }
  const status = e?.status ?? e?.statusCode ?? 0
  const payload = e?.data?.data
  if (payload?.code) {
    const { code, message, ...rest } = payload
    return new ApiSideError(status, code, message ?? '', rest)
  }
  return new ApiSideError(
    status,
    status === 0 ? 'NETWORK' : 'UNKNOWN',
    e?.data?.message ?? 'Greška u vezi',
  )
}

const rawFetch = $fetch as unknown as
  (url: string, options?: Record<string, unknown>) => Promise<unknown>

async function request<T>(
  url: string, options: { method?: 'GET' | 'POST', body?: unknown } = {},
): Promise<T> {
  try {
    return await rawFetch(url, {
      method: options.method ?? 'GET',
      body: options.body,
      credentials: 'include',
      // A count of nineteen items is one big body; the café's wifi gets eight
      // seconds to take it, the same ceiling the outbox gives a round.
      ...(import.meta.client ? { signal: AbortSignal.timeout(8000) } : {}),
    }) as T
  } catch (err) {
    throw toApiError(err)
  }
}

export function useCounts() {
  return {
    /**
     * *Predaj popis*. The whole count in one body — there is no per-line route
     * and none is to be added (BACKEND §14.5): a half-submitted count is a count
     * whose missing items silently keep their theoretical quantity.
     */
    submitCount: (body: SubmitCountBody) =>
      request<CountView>('/api/stock/counts', { method: 'POST', body }),

    /** *Potvrđujem stanje* — the incoming custodian, on this same phone. */
    witnessCount: (countId: string) =>
      request<CountView>(`/api/stock/counts/${countId}/witness`, { method: 'POST', body: {} }),

    /** One count with its lines and their variances. */
    getCount: (countId: string) => request<CountView>(`/api/stock/counts/${countId}`),

    /** The shift's counts — how the screen knows whether the opening one exists. */
    listCounts: (params: { shift_id?: string, status?: 'submitted' | 'confirmed' } = {}) => {
      const query = new URLSearchParams()
      if (params.shift_id) query.set('shift_id', params.shift_id)
      if (params.status) query.set('status', params.status)
      const tail = query.toString()
      return request<CountView[]>(`/api/stock/counts${tail ? `?${tail}` : ''}`)
    },

    /** *Dopuni smjenu*: change out of the drawer, into one waiter's hands. */
    moveFloat: (shiftId: string, body: MoveFloatBody) =>
      request<CashMovement>(`/api/shifts/${shiftId}/float`, { method: 'POST', body }),
  }
}
