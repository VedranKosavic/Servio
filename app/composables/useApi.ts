/**
 * The only place in the app that knows a URL.
 *
 * Every screen calls a function from here instead of writing `$fetch('/api/…')`
 * by hand, so a route that changes shape breaks the build in one file rather
 * than showing an empty panel on a Saturday night. The types come from
 * `shared/types.ts`, which the server's services are typed against too — one
 * contract, both sides.
 *
 * Two rules this file enforces for the whole app, and they are the whole of WP9:
 *
 * **No body ever names the actor.** There is no `user_id` anywhere below. The
 * server reads `event.context.actor` out of the session cookie (BACKEND §5.7);
 * a phone that could name the person locking a round could name anybody.
 *
 * **Cookies ride along.** `credentials: 'include'` is set once, here. The
 * session (`sank_s`) and the device (`sank_d`) are httpOnly cookies, so no
 * screen can read them and no screen has to.
 *
 * Errors: the API answers `{ code, message, …data }` inside h3's error
 * envelope. This wrapper unwraps it and re-throws a plain `ApiSideError`, so a
 * screen can write `catch (e) { if (e.code === 'LOCKED') … }` and read
 * `e.data.retry_after_s` without knowing anything about $fetch.
 */
import type {
  ApiError,
  Bootstrap,
  ChangesResult,
  CreateDeliveryBody,
  CreateOrderBody,
  CreateOrderResult,
  CreatePaymentBody,
  DeliveryView,
  EnrolResult,
  Health,
  HeartbeatResult,
  MarkUnpaidBody,
  MeContext,
  MeUser,
  MyShift,
  PaymentResult,
  PinLoginResult,
  Prep,
  PrepOrder,
  SettleResult,
  StockResponse,
  Tab,
  TabDetail,
  TablesStateResponse,
  UnpaidResult,
} from '#shared/types'
// Four bodies the `shared/types.ts` barrel does not re-export (it lists the
// request types the Korak 1 screens needed). Taking them straight from the
// schemas is the same definition — `z.infer` of the object the route validates
// against — and it means WP9 changes no file outside `app/`.
import type {
  EnrolDeviceBody, HeartbeatBody, PinLoginBody, SettleBody,
} from '#shared/schemas'
import { errorMessage } from '#shared/errors'

export class ApiSideError extends Error implements ApiError {
  readonly code: string
  readonly status: number
  /** Whatever the sentence needs to render: `retry_after_s`, `fails_left`. */
  readonly data: Record<string, unknown>

  constructor(status: number, code: string, message: string, data: Record<string, unknown> = {}) {
    super(message)
    this.name = 'ApiSideError'
    this.status = status
    this.code = code
    this.data = data
  }
}

function toApiError(err: unknown): ApiSideError {
  const e = err as {
    status?: number
    statusCode?: number
    data?: { data?: ApiError & Record<string, unknown>, message?: string }
  }
  const status = e?.status ?? e?.statusCode ?? 0
  const payload = e?.data?.data
  if (payload?.code) {
    const { code, message, ...rest } = payload
    return new ApiSideError(status, code, message, rest)
  }
  // A network failure never reaches the server, so it has no code of its own.
  return new ApiSideError(status, status === 0 ? 'NETWORK' : 'UNKNOWN', e?.data?.message ?? 'Greška u vezi')
}

/**
 * The Bosnian sentence for a failure, with its numbers filled in.
 *
 * `shared/errors.ts` holds one sentence per code, and some of them carry
 * `{placeholders}` — "PIN je zaključan. Pokušaj ponovo za {retry_after_s} s."
 * The values come from the error body's own `data`, which is exactly why a 423
 * carries `retry_after_s` and a wrong PIN carries `fails_left` (BACKEND §2). A
 * placeholder with nothing to fill it would put a literal `{retry_after_s}` in
 * front of a waiter, so an unfilled one is dropped along with the space before
 * it.
 *
 * A code with no sentence never reaches a screen as a raw `TAB_TABLE_MISMATCH`:
 * `errorMessage` falls back to the generic one.
 */
export function apiErrorText(err: unknown, fallback = 'Nema veze — pokušaj ponovo'): string {
  const e = err as ApiSideError
  if (!e?.code) return fallback
  if (e.code === 'NETWORK') return fallback
  return errorMessage(e.code).replace(/\s*\{(\w+)\}/g, (whole, key: string) => {
    const value = e.data?.[key]
    return value === undefined || value === null ? '' : whole.replace(`{${key}}`, String(value))
  }).trim()
}

/**
 * `$fetch`, with its route-map generics taken off.
 *
 * Nuxt types `$fetch` from a generated map of every server route, which is
 * lovely for a literal URL and unusable for one built at runtime (`/api/prep/
 * ${id}/done`) — the inference explodes. The answer to each call is typed here
 * instead, from `shared/types.ts`, the same file the services return.
 */
const rawFetch = $fetch as unknown as
  (url: string, options?: Record<string, unknown>) => Promise<unknown>

async function request<T>(url: string, options?: {
  method?: 'GET' | 'POST'
  body?: unknown
  /**
   * A heavy GET the server ETags (BACKEND §4.2).
   *
   * **An ETag is a fingerprint of an answer.** The server sends
   * `ETag: W/"812-waiter-3f9a"` with the floor plan; the browser stores it, and
   * on the next request for the same URL it asks "…unless it is still 812", to
   * which an unchanged server answers `304 Not Modified` with no body at all.
   * The browser then hands us the copy it already had. On a quiet minute the
   * whole poll costs one indexed `MAX(seq)` and a few dozen bytes.
   *
   * The browser does all of that by itself, for free — but only if we let it
   * keep the response. `cache: 'default'` is that permission, spelled out here
   * because the tempting `no-store` (which looks like the private thing to do)
   * would throw the copy away, leave nothing to put in `If-None-Match`, and
   * quietly turn every 304 into a full re-download. Privacy is already handled
   * on the other side: `tenant.ts` sends `Cache-Control: private, no-cache` and
   * `Vary: Cookie`, so the copy is this browser's alone and is never served
   * without asking the server first.
   */
  etag?: boolean
}): Promise<T> {
  try {
    return await rawFetch(url, {
      method: options?.method ?? 'GET',
      body: options?.body,
      // The session and device cookies. Same-origin fetches would send them
      // anyway; saying so means an installed PWA on a different origin does too.
      credentials: 'include',
      ...(options?.etag && import.meta.client ? { cache: 'default' as RequestCache } : {}),
    }) as T
  } catch (err) {
    throw toApiError(err)
  }
}

export function useApi() {
  return {
    // -- Prijava ------------------------------------------------------------

    /**
     * Who is holding this phone, according to the server.
     *
     * 401 `NO_SESSION` means nobody is logged in (the start screen draws the
     * name list); 401 `DEVICE_REVOKED` means the owner threw this phone out and
     * the app has to go back to the enrol screen.
     */
    getMe: () => request<MeContext>('/api/me'),

    /**
     * The names the lock screen draws — served before any session exists, to
     * whoever holds an enrolled device. Nothing but name, initials, role and
     * how many digits the PIN pad should draw.
     */
    getLoginUsers: () => request<MeUser[]>('/api/auth/users'),

    /** Four digits (six for an admin) against the device cookie. */
    loginWithPin: (body: PinLoginBody) =>
      request<PinLoginResult>('/api/auth/pin', { method: 'POST', body }),

    /** The six-character code the owner reads out across the bar. */
    enrolDevice: (body: EnrolDeviceBody) =>
      request<EnrolResult>('/api/devices/enrol', { method: 'POST', body }),

    /**
     * The dev door: one call and this browser is an enrolled device. 404s
     * everywhere `SANK_DEV_ENROL=1` is not set, which is everywhere but a
     * laptop (BACKEND §5.6).
     */
    devEnrol: () => request<EnrolResult>('/api/dev/enrol', { method: 'POST', body: {} }),

    /**
     * *Promijeni korisnika*. Clears the session cookie only — the device stays
     * enrolled and, deliberately, the shift membership stays open (§5.1): a
     * tablet handed across the bar a dozen times a night must not end anybody's
     * hours.
     */
    logout: () => request<{ ok: true }>('/api/auth/logout', { method: 'POST', body: {} }),

    /** Its own 60 s timer, no ETag, never bumps `changes` (§4.3). */
    heartbeat: (body: HeartbeatBody) =>
      request<HeartbeatResult>('/api/devices/heartbeat', { method: 'POST', body }),

    // -- Sinhronizacija -----------------------------------------------------

    /**
     * The one poll. `since = 0` answers `full: true` with every snapshot, which
     * is also how a screen gets its first paint — there is no separate boot read
     * for the floor plan, the tickets or the stock.
     */
    getChanges: (since: number) =>
      request<ChangesResult>(`/api/changes?since=${since}`, { etag: true }),

    /** Menu, floor plan, staff and aromas. Once, then only when `menu_version` moves. */
    getBootstrap: () => request<Bootstrap>('/api/bootstrap', { etag: true }),

    /** The floor plan and the shift strip, in one envelope (§6.2). */
    getTablesState: () => request<TablesStateResponse>('/api/tables/state', { etag: true }),

    // -- Narudžbe i naplata -------------------------------------------------

    /**
     * Lock a round. `body.client_id` is a uuid the phone mints once and reuses
     * for every retry of this same round — that is what makes a retry safe.
     */
    postOrder: (body: CreateOrderBody) =>
      request<CreateOrderResult>('/api/orders', { method: 'POST', body }),

    /** Everything *Pokaži narudžbu* and *Naplati* need. */
    getTab: (tabId: string) => request<TabDetail>(`/api/tabs/${tabId}`),

    /**
     * *Naplati*. `client_id` is minted once per attempt and reused on every
     * retry: `payments_client_uq` is what makes a retried payment one row rather
     * than two charges. 409 `TAB_ALREADY_PAID` if a colleague got there first.
     */
    postPayment: (body: CreatePaymentBody) =>
      request<PaymentResult>('/api/payments', { method: 'POST', body }),

    /**
     * *Nije plaćeno*. Keyed by `tab_client_id`, not by a tab id — a guest can
     * walk out while the phone is offline, on a tab the server has never seen.
     */
    markUnpaid: (body: MarkUnpaidBody) =>
      request<UnpaidResult>('/api/tabs/unpaid', { method: 'POST', body }),

    /** *Predaj sto kolegi* — the offer half. Online only. */
    offerTab: (tabId: string, userId: string) =>
      request<Tab>(`/api/tabs/${tabId}/assign`, { method: 'POST', body: { user_id: userId } }),

    /** *Nudi ti: Sto 7 · Prihvati* — the accept half. */
    acceptTab: (tabId: string) =>
      request<Tab>(`/api/tabs/${tabId}/accept`, { method: 'POST', body: {} }),

    // -- Šank ---------------------------------------------------------------

    /** The bartender's tickets: `open` oldest first, `done` the last ten. */
    getPrep: () => request<Prep>('/api/prep', { etag: true }),

    /**
     * One tap, once. The body is `{}` — WP9 took the `user_id` out of it; who
     * tapped *Gotovo* is the session's business (§5.7). 409
     * `ORDER_ALREADY_PREPARED` on the second tap.
     */
    markPrepared: (orderId: string) =>
      request<PrepOrder>(`/api/prep/${orderId}/done`, { method: 'POST', body: {} }),

    // -- Roba ---------------------------------------------------------------

    /** *Stanje šanka* — `{ seq, items }`, every item with its on-hand and last movement. */
    getStock: () => request<StockResponse>('/api/stock', { etag: true }),

    /** *Prijem robe*. Returns the posted delivery note (BACKEND §6.8). */
    postDelivery: (body: CreateDeliveryBody) =>
      request<DeliveryView>('/api/stock/deliveries', { method: 'POST', body }),

    // -- Smjena -------------------------------------------------------------

    /**
     * *Moja smjena*. `summary` is null until the person has declared — the
     * blindness strip (§6.6). The screen must never show an expected number it
     * did not get from a settle response.
     */
    getMyShift: () => request<MyShift>('/api/me/shift'),

    /** *Završi smjenu* — the blind declaration, and the reveal in the answer. */
    settleShift: (shiftId: string, body: SettleBody) =>
      request<SettleResult>(`/api/shifts/${shiftId}/settle`, { method: 'POST', body }),

    getHealth: () => request<Health>('/api/health'),
  }
}
