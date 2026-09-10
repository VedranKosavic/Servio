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
  AdjustmentResult,
  ApiError,
  Bootstrap,
  ChatPage,
  ChatSince,
  ChangesResult,
  CreateDeliveryBody,
  CreateOrderBody,
  CreateOrderResult,
  CreatePaymentBody,
  DeliveryView,
  EnrolResult,
  Health,
  HeartbeatResult,
  LinesPage,
  LoginUser,
  MarkUnpaidBody,
  MeContext,
  MyShift,
  MyShiftRow,
  MySession,
  PaymentResult,
  PendingAdjustment,
  PinLoginResult,
  MyRoster,
  HoursRow,
  PostMessageResult,
  Prep,
  PrepOrder,
  RulesView,
  SwapRequestView,
  UploadResult,
  SettleResult,
  StockResponse,
  Tab,
  TabDetail,
  TablesStateResponse,
  UnpaidResult,
} from '#shared/types'
// Five bodies the `shared/types.ts` barrel does not re-export (it lists the
// request types the Korak 1 screens needed). Taking them straight from the
// schemas is the same definition — `z.infer` of the object the route validates
// against — and it means WP9 changes no file outside `app/`.
import type {
  DecideAdjustmentBody, DiscardDraftBody, EnrolDeviceBody, HeartbeatBody, PinLoginBody, SetModeBody,
  SettleBody, StaffNoteBody,
} from '#shared/schemas'
import type { PostMessageBody, SetPinBody, SwapBody } from '#shared/schemas'
import type { ChannelKind } from '#shared/chat'
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
  method?: 'GET' | 'POST' | 'PUT' | 'PATCH' | 'DELETE'
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
  /**
   * A ceiling on how long this request may hang, in milliseconds.
   *
   * Café wifi does not usually refuse a request — it accepts it and then says
   * nothing, forever, which is worse: the outbox would sit on one entry all
   * night and the poll would never come back. `AbortSignal.timeout(ms)` is the
   * browser's own stopwatch; when it fires, `$fetch` rejects, and the outbox
   * counts that as a *network* error rather than a failure, because the request
   * may well have landed. The replay key is what makes that harmless.
   */
  timeoutMs?: number
}): Promise<T> {
  try {
    return await rawFetch(url, {
      method: options?.method ?? 'GET',
      body: options?.body,
      // The session and device cookies. Same-origin fetches would send them
      // anyway; saying so means an installed PWA on a different origin does too.
      credentials: 'include',
      ...(options?.timeoutMs && import.meta.client
        ? { signal: AbortSignal.timeout(options.timeoutMs) }
        : {}),
      ...(options?.etag && import.meta.client ? { cache: 'default' as RequestCache } : {}),
    }) as T
  } catch (err) {
    throw toApiError(err)
  }
}

/**
 * The five routes the offline outbox may post to, and the only place their URLs
 * are written (WP0, PHASE3 §2.2). Money and stock; nothing else is queueable.
 */
const OUTBOX_URLS = {
  order: '/api/orders',
  pay: '/api/payments',
  unpaid: '/api/tabs/unpaid',
  adjust: '/api/adjustments',
  waste: '/api/stock/waste',
} as const

export type OutboxRoute = keyof typeof OUTBOX_URLS

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
    getLoginUsers: () => request<LoginUser[]>('/api/auth/users'),

    /**
     * Four digits (or six) against the device cookie — and nothing else. The
     * PIN identifies the person, so the body names nobody; `mode` is the
     * optional "I am on the šank tonight" folded into the same call.
     */
    loginWithPin: (body: PinLoginBody) =>
      request<PinLoginResult>('/api/auth/pin', { method: 'POST', body }),

    /**
     * *Na čemu si večeras?* — and the same route again at midnight when a
     * worker moves between the bar and the floor. It answers the whole
     * `MeContext`, so the caller hands it to `useMe().refreshAfterLogin()`.
     */
    setMode: (body: SetModeBody) =>
      request<MeContext>('/api/auth/mode', { method: 'POST', body }),

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
      request<ChangesResult>(`/api/changes?since=${since}`, { etag: true, timeoutMs: 4000 }),

    /**
     * The outbox's one door (§2.2). The body has already been validated by the
     * screen that queued it and is posted back unchanged, however late — which
     * is why this takes an opaque `unknown` rather than a union of five bodies:
     * the entry on disk may have been written by yesterday's build.
     */
    sendQueued: <T>(kind: OutboxRoute, body: unknown) =>
      request<T>(OUTBOX_URLS[kind], { method: 'POST', body, timeoutMs: 8000 }),

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

    // -- Storno i gratis ----------------------------------------------------

    /**
     * *Zatraži storno* / *Zatraži gratis* **with an approver's PIN**, and only
     * with one. Every PIN-less request goes through the outbox instead
     * (`sendQueued('adjust', …)`) — there is one queue for money, not two.
     *
     * A PIN is a credential: it must never be written into IndexedDB and left on
     * a phone for hours, so this branch posts directly and the sheet offers it
     * only while the phone is online (`app/composables/useAdjustments.ts`).
     */
    requestAdjustment: (body: Record<string, unknown>) =>
      request<AdjustmentResult>('/api/adjustments', { method: 'POST', body, timeoutMs: 8000 }),

    /** *Na čekanju*. Scoped by the server: a waiter sees only his own requests. */
    getPendingAdjustments: () => request<PendingAdjustment[]>('/api/adjustments/pending'),

    /**
     * *Odobri* / *Odbij*. Online only — a bartender's authority is a window
     * measured at the moment he decides, so a queued decision would be one he no
     * longer has the right to make.
     */
    decideAdjustment: (id: string, body: DecideAdjustmentBody) =>
      request<AdjustmentResult>(`/api/adjustments/${id}/decide`, { method: 'POST', body }),

    /**
     * *Premjesti sto* — the guests changed table, or stood up from the bar and
     * sat down. Online only: the partial unique index that keeps one open tab
     * per table lives on the server, so a queued move could not be checked
     * against it here.
     */
    moveTab: (tabId: string, tableId: string) =>
      request<Tab>(`/api/tabs/${tabId}/move`, { method: 'POST', body: { table_id: tableId } }),

    /**
     * *Odbaci* on a draft nobody is going to lock. It writes one log entry and
     * no ledger row — the point is that a shift cannot close with an unlocked
     * cart on somebody's phone, and a discard has to leave a trace or that
     * check is a check on nothing.
     */
    discardDraft: (body: DiscardDraftBody) =>
      request<{ ok: true }>('/api/drafts/discard', { method: 'POST', body }),

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

    // -- Moja smjena (S11) --------------------------------------------------

    /** The last thirty nights he was on, newest first, each with its *Napomena*. */
    getMyShifts: (limit = 30) => request<MyShiftRow[]>(`/api/me/shifts?limit=${limit}`),

    /**
     * *Napomena* on one of his own nights. `PUT`, because it is one row per
     * person per night and the body is the row — sending it twice leaves the
     * same note, and an empty string deletes it.
     */
    putShiftNote: (shiftId: string, body: StaffNoteBody) =>
      request<{ note: string | null }>(`/api/me/shifts/${shiftId}/note`, { method: 'PUT', body }),

    /** *Moji podaci* — his own sign-ins, so a login he does not recognise is visible. */
    getMySessions: () => request<MySession[]>('/api/me/sessions'),

    /**
     * The lines behind one of his own numbers. `kat` is a category id, or one
     * of `sve · storno · gratis · nijeplaceno`; `totals` is null until he has
     * settled, the same blindness the strip has.
     */
    getMyShiftLines: (kat = 'sve', cursor?: string) =>
      request<LinesPage>(
        `/api/me/shift/lines?kat=${encodeURIComponent(kat)}${cursor ? `&cursor=${encodeURIComponent(cursor)}` : ''}`,
      ),

    getHealth: () => request<Health>('/api/health'),

    // -- Razgovor (Phase 4) --------------------------------------------------

    /**
     * Bootstrap, catch-up or `reset`. S16 calls this on mount, after every own
     * send and on `visibilitychange` — **never on a timer of its own**: the
     * 15 s `/api/changes` carries the badge counts, and that is the one poll.
     */
    getChatSince: (cursor?: number) =>
      request<ChatSince>(`/api/chat/since${cursor ? `?cursor=${cursor}` : ''}`, { etag: true }),

    /** *Učitaj starije*, backwards from `beforeSeq`. */
    getChatHistory: (channel: ChannelKind, beforeSeq?: number, limit = 50) =>
      request<ChatPage>(
        `/api/chat/${channel}/messages?limit=${limit}`
        + (beforeSeq ? `&before_seq=${beforeSeq}` : ''),
      ),

    /**
     * Send. The chat store's own pending list retries this — a replay of the
     * same `client_id` answers 200 with `already_applied: true`, never a 409, so
     * a photo taken with the wifi off appears exactly once.
     */
    postChatMessage: (channel: ChannelKind, body: PostMessageBody) =>
      request<PostMessageResult>(`/api/chat/${channel}/messages`, {
        method: 'POST', body, timeoutMs: 8000,
      }),

    /** *Za naručiti*: replace, append one line, or *Naručeno ✓* (admin only). */
    setChatPin: (channel: ChannelKind, body: SetPinBody) =>
      request<{ ok: true }>(`/api/chat/${channel}/pin`, { method: 'POST', body }),

    /** *Obriši* / *Ukloni sliku*. A soft delete: the placeholder says who and when. */
    deleteChatMessage: (id: string) =>
      request<{ ok: true }>(`/api/chat/messages/${id}/delete`, { method: 'POST', body: {} }),

    /** *Proslijedi u…* and *Prijavi vlasniku*. */
    forwardChatMessage: (id: string, to: ChannelKind) =>
      request<PostMessageResult>(`/api/chat/messages/${id}/forward`, {
        method: 'POST', body: { to },
      }),

    /** The badge cursor, debounced 1 s on the client. Bumps nothing. */
    markChatRead: (channel: ChannelKind, seq: number) =>
      request<{ ok: true }>('/api/chat/read', { method: 'POST', body: { channel, seq } }),

    /**
     * `POST /api/uploads`, multipart. The phone downscales first
     * (`app/utils/image.ts`); this is the belt, not the braces.
     */
    uploadImage: (blob: Blob, kind: 'chat' | 'delivery' = 'chat') => {
      const form = new FormData()
      form.append('image', blob, 'slika.jpg')
      form.append('kind', kind)
      return request<UploadResult>('/api/uploads', { method: 'POST', body: form, timeoutMs: 20_000 })
    },

    // -- Raspored (Phase 4) --------------------------------------------------

    /**
     * S17. Every write below is **online only** and disabled with "Nema veze"
     * (PHASE4 §3, WP2): a swap is not urgent, and a queued one would need
     * server-side conflict rules for nothing.
     */
    getMyRoster: () => request<MyRoster>('/api/me/roster'),

    /** *Moji sati* — own rows only; the route never takes a user id. */
    getMyHours: (month: string) =>
      request<HoursRow[]>(`/api/me/roster/hours?month=${encodeURIComponent(month)}`),

    /** *Traži zamjenu* — on your own row, optional colleague, reason and note. */
    requestSwap: (body: SwapBody) =>
      request<SwapRequestView>('/api/roster/swaps', { method: 'POST', body }),

    /** *Preuzimam*. `force_double` is the retry after the *Dupla smjena* sheet. */
    acceptSwap: (id: string, forceDouble = false) =>
      request<SwapRequestView>(`/api/roster/swaps/${id}/accept`, {
        method: 'POST', body: forceDouble ? { force_double: true } : {},
      }),

    declineSwap: (id: string) =>
      request<SwapRequestView>(`/api/roster/swaps/${id}/decline`, { method: 'POST', body: {} }),

    /** *Povuci* — the requester's own. A withdrawn `bolest` returns the row to `planned`. */
    cancelSwap: (id: string) =>
      request<SwapRequestView>(`/api/roster/swaps/${id}/cancel`, { method: 'POST', body: {} }),

    // -- Pravila (Phase 4) ---------------------------------------------------

    /**
     * S12. `must_ack` is a **client** rule: nothing on the server refuses an
     * order because a waiter has not read v3 (PHASE4 §2.8).
     */
    getRules: () => request<RulesView>('/api/rules'),

    /** *Potvrđujem Pravila v3*. An old version is 409 `RULES_STALE`. */
    ackRules: (version: number) =>
      request<RulesView>('/api/me/rules/ack', { method: 'POST', body: { version } }),
  }
}
