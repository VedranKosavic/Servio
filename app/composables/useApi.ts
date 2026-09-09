/**
 * The only place in the app that knows a URL.
 *
 * Every screen calls a function from here instead of writing `$fetch('/api/…')`
 * by hand, so a route that changes shape breaks the build in one file rather
 * than showing an empty panel on a Saturday night. The types come from
 * `shared/types.ts`, which the server's services are typed against too — one
 * contract, both sides.
 *
 * Errors: the API answers `{ code, message }` inside h3's error envelope. This
 * wrapper unwraps it and re-throws a plain `ApiSideError`, so a screen can write
 * `catch (e) { if (e.code === 'TAB_ALREADY_PAID') … }` without knowing anything
 * about $fetch.
 */
import type {
  ApiError,
  Bootstrap,
  CreateDeliveryBody,
  CreateOrderBody,
  CreateOrderResult,
  CreatePaymentBody,
  Health,
  PaymentResult,
  Prep,
  PrepOrder,
  StockItem,
  TablesStateResponse,
} from '#shared/types'

export class ApiSideError extends Error implements ApiError {
  readonly code: string
  readonly status: number

  constructor(status: number, code: string, message: string) {
    super(message)
    this.name = 'ApiSideError'
    this.status = status
    this.code = code
  }
}

function toApiError(err: unknown): ApiSideError {
  const e = err as { status?: number, statusCode?: number, data?: { data?: ApiError, message?: string } }
  const status = e?.status ?? e?.statusCode ?? 0
  const payload = e?.data?.data
  if (payload?.code) return new ApiSideError(status, payload.code, payload.message)
  // A network failure never reaches the server, so it has no code of its own.
  return new ApiSideError(status, status === 0 ? 'NETWORK' : 'UNKNOWN', e?.data?.message ?? 'Greška u vezi')
}

/**
 * `$fetch`, with its route-map generics taken off.
 *
 * Nuxt types `$fetch` from a generated map of every server route, which is
 * lovely for a literal URL and unusable for one built at runtime (`/api/tabs/
 * ${id}/pay`) — the inference explodes. The answer to each call is typed here
 * instead, from `shared/types.ts`, the same file the services return.
 */
const rawFetch = $fetch as unknown as
  (url: string, options?: { method?: string, body?: unknown }) => Promise<unknown>

async function request<T>(url: string, options?: { method?: 'GET' | 'POST', body?: unknown }): Promise<T> {
  try {
    return await rawFetch(url, {
      method: options?.method ?? 'GET',
      body: options?.body,
    }) as T
  } catch (err) {
    throw toApiError(err)
  }
}

export function useApi() {
  return {
    /** Menu, floor plan, staff and aromas — one call, at app start. */
    getBootstrap: () => request<Bootstrap>('/api/bootstrap'),

    /**
     * The floor plan and the shift strip, in one envelope. WP3 replaced the bare
     * array: a phone that polled the two separately would draw a *Završi smjenu*
     * bar for a shift that had already closed.
     */
    getTablesState: () => request<TablesStateResponse>('/api/tables/state'),

    /**
     * Lock a round. `body.client_id` is a uuid the phone mints once and reuses
     * for every retry of this same round — that is what makes a retry safe.
     */
    postOrder: (body: CreateOrderBody) =>
      request<CreateOrderResult>('/api/orders', { method: 'POST', body }),

    /**
     * *Naplati*. `client_id` is minted once per attempt and reused on every
     * retry: `payments_client_uq` is what makes a retried payment one row rather
     * than two charges. 409 `TAB_ALREADY_PAID` if a colleague got there first.
     */
    postPayment: (body: CreatePaymentBody) =>
      request<PaymentResult>('/api/payments', { method: 'POST', body }),

    /** The bartender's tickets: `open` oldest first, `done` the last ten. */
    getPrep: () => request<Prep>('/api/prep'),

    /** One tap, once. 409 `ORDER_ALREADY_PREPARED` on the second. */
    markPrepared: (orderId: string, userId: string) =>
      request<PrepOrder>(`/api/prep/${orderId}/done`, { method: 'POST', body: { user_id: userId } }),

    /** *Stanje šanka* — every item with its on-hand sum and last movement. */
    getStock: () => request<StockItem[]>('/api/stock'),

    /** *Prijem robe*. Quantities in base units; returns the updated list. */
    postDelivery: (body: CreateDeliveryBody) =>
      request<StockItem[]>('/api/stock/deliveries', { method: 'POST', body }),

    getHealth: () => request<Health>('/api/health'),
  }
}
