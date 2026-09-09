/**
 * The only place `/a` knows a URL.
 *
 * Built exactly like `useApi.ts`, which is the waiter side's version of the same
 * idea: one `request<T>()` with the cookies attached, one method per route, and
 * every answer typed off `shared/types` — the same file the server's services
 * are typed to return. A route that changes shape breaks the build here rather
 * than showing the owner an empty panel.
 *
 * Three rules this file keeps for the whole dashboard:
 *
 * **No body ever names the actor.** There is no `user_id` anywhere below; the
 * server reads `event.context.actor` out of the session cookie. That is true for
 * the owner's laptop as much as for a phone.
 *
 * **A query is an argument, never a string.** `getOwnerLog(q)` takes a
 * `LogQuery` and builds the search string here, so a page cannot invent a filter
 * the server does not have, and a filter that is renamed is a compile error.
 *
 * **Errors come back as `ApiSideError`.** The class is `useApi.ts`'s — there is
 * exactly one — so a screen writes `catch (e) { apiErrorText(e) }` and gets the
 * Bosnian sentence with its numbers filled in.
 */
import { ApiSideError } from '~/composables/useApi'
import type {
  CategoriesReport,
  ConfirmCountBody,
  ConfirmResult,
  CountView,
  CreateDeliveryBody,
  CorrectStockBody,
  DecideAdjustmentBody,
  DecideUnpaidBody,
  DeliveryView,
  DeviceAdmin,
  EnrolCodeResult,
  ItemMovementsPage,
  LinesPage,
  LogEntryDetail,
  LogListResult,
  LogQuery,
  LogWasteBody,
  MeContext,
  NargilaReport,
  OpeningStockBody,
  OwnerLive,
  OwnerShift,
  OwnerShiftRow,
  OwnerStockReport,
  PendingCount,
  PinResetResult,
  ProductAdmin,
  CategoryAdmin,
  Settings,
  SettingsPatch,
  ShiftSummary,
  StockItemAdmin,
  SubmitCountBody,
  TabDetail,
  TableAdmin,
  UserAdmin,
  WasteView,
} from '#shared/types'
// The request bodies. They are `z.infer` of the object each route validates
// against, so a field renamed in a schema is a compile error in the screen
// that sends it — one definition, two uses.
import type {
  AdminLoginBody,
  CreateCategoryBody,
  CreateProductBody,
  CreateStockItemBody,
  CreateTableBody,
  CreateUserBody,
  DecideCashMovementBody,
  MoveFloatBody,
  OpeningFloatBody,
  PickupBody,
  ResetUserPinBody,
  ReviewShiftBody,
  SetRecipeBody,
  UpdateCategoryBody,
  UpdateDeviceBody,
  UpdateProductBody,
  UpdateStockItemBody,
  UpdateTableBody,
  UpdateUserBody,
} from '#shared/schemas'

/**
 * `$fetch` with its route-map generics taken off — see the same note in
 * `useApi.ts`. Nuxt types `$fetch` from a generated map of literal routes, which
 * cannot infer a URL built at runtime; the answer is typed here instead.
 */
const rawFetch = $fetch as unknown as
  (url: string, options?: Record<string, unknown>) => Promise<unknown>

function toApiError(err: unknown): ApiSideError {
  const e = err as {
    status?: number
    statusCode?: number
    data?: { data?: { code: string, message: string } & Record<string, unknown>, message?: string }
  }
  const status = e?.status ?? e?.statusCode ?? 0
  const payload = e?.data?.data
  if (payload?.code) {
    const { code, message, ...rest } = payload
    return new ApiSideError(status, code, message, rest)
  }
  return new ApiSideError(
    status,
    status === 0 ? 'NETWORK' : 'UNKNOWN',
    e?.data?.message ?? 'Greška u vezi',
  )
}

async function request<T>(url: string, options?: {
  method?: 'GET' | 'POST' | 'PATCH' | 'PUT'
  body?: unknown
  /**
   * A GET the server ETags.
   *
   * **An ETag is a fingerprint of an answer**: the server stamps the response
   * with a short version string, the browser sends it back next time, and an
   * unchanged server replies `304 Not Modified` with no body at all. On a
   * laptop that keeps five reads open all evening that is the difference
   * between a poll costing a few hundred bytes and costing a whole report.
   *
   * `cache: 'default'` is what lets the browser keep the copy it needs in order
   * to ask. The tempting `no-store` would throw it away and quietly turn every
   * 304 into a full re-download. Privacy is handled on the server, which sends
   * `Cache-Control: private, no-cache` and `Vary: Cookie`.
   */
  etag?: boolean
}): Promise<T> {
  try {
    return await rawFetch(url, {
      method: options?.method ?? 'GET',
      body: options?.body,
      credentials: 'include',
      ...(options?.etag && import.meta.client ? { cache: 'default' as RequestCache } : {}),
    }) as T
  } catch (err) {
    throw toApiError(err)
  }
}

/** `{ user: 'x', kat: undefined }` → `"?user=x"`. An empty object is no string at all. */
function qs(params: Record<string, string | number | boolean | undefined | null>): string {
  const search = new URLSearchParams()
  for (const [key, value] of Object.entries(params)) {
    if (value === undefined || value === null || value === '') continue
    search.set(key, String(value))
  }
  const text = search.toString()
  return text ? `?${text}` : ''
}

/** A business-date range, the argument every report on `/a` takes. */
export interface Period {
  /** `YYYY-MM-DD`, inclusive. */
  from: string
  /** `YYYY-MM-DD`, inclusive. */
  to: string
}

export function useAdminApi() {
  return {
    // -- Prijava --------------------------------------------------------------

    /**
     * `/a/login` — email and password. Answers the same `MeContext` as
     * `GET /api/me`, so the screen hands it to `useMe().refreshAfterLogin()`
     * instead of assembling a session envelope by hand.
     */
    adminLogin: (body: AdminLoginBody) =>
      request<MeContext>('/api/auth/admin/login', { method: 'POST', body }),

    /** *Odjavi se* in the nav foot. Clears the session cookie and nothing else. */
    logout: () => request<{ ok: true }>('/api/auth/logout', { method: 'POST', body: {} }),

    // -- Puls -----------------------------------------------------------------

    /** Everything on *Puls*, in one read: tiles, pažnja, flags, feed, stolovi. */
    getLive: () => request<OwnerLive>('/api/owner/live'),

    /** One table's rounds, for the sheet that opens when a tile is tapped. */
    getTab: (tabId: string) => request<TabDetail>(`/api/tabs/${tabId}`),

    /**
     * *Odobri* / *Odbij* on a *Zahtijeva pažnju* row.
     *
     * The path is never written in a component: `attentionTarget()` resolves it
     * from `ATTENTION_ROUTES`, and this posts whatever came back. `"POST /api/…"`
     * is the shape that function returns — method and path in one string.
     */
    postAttention: (target: string, body: Record<string, unknown> = {}) => {
      const [, path] = target.split(' ') as [string, string]
      return request<unknown>(path, { method: 'POST', body })
    },

    // -- Smjena ---------------------------------------------------------------

    /** *Smjene* — one row per shift in the period. */
    getShifts: (p: Period) =>
      request<OwnerShiftRow[]>(`/api/owner/shifts${qs({ from: p.from, to: p.to })}`),

    /** The whole *Smjena* page: summary, per-waiter strip, kasa, popisi. */
    getShift: (id: string) => request<OwnerShift>(`/api/owner/shift/${id}`),

    /** The written summary as it was sealed at closing — the reconciliation. */
    getShiftSummary: (id: string) => request<ShiftSummary>(`/api/owner/shift/${id}/summary`),

    /**
     * The drill-down behind a category chip or a waiter's number.
     *
     * `cursor` is a **keyset** cursor, not a page number: it names the last row
     * of the page you have, and the server returns what comes after it. An
     * offset would re-read and re-skip rows that new orders keep shifting.
     */
    getShiftLines: (id: string, q: { user?: string, kat?: string, cursor?: string } = {}) =>
      request<LinesPage>(`/api/owner/shift/${id}/lines${qs(q)}`),

    /** The card total, and *Pregledano* — one route, both jobs. */
    reviewShift: (id: string, body: ReviewShiftBody) =>
      request<unknown>(`/api/shifts/${id}/review`, { method: 'POST', body }),

    /** *Uzeo iz kase* — the owner taking cash out of the drawer. */
    pickup: (shiftId: string, body: PickupBody) =>
      request<unknown>(`/api/shifts/${shiftId}/pickup`, { method: 'POST', body }),

    /** Float in or out of the drawer during the shift. */
    moveFloat: (shiftId: string, body: MoveFloatBody) =>
      request<unknown>(`/api/shifts/${shiftId}/float`, { method: 'POST', body }),

    /** *Početni polog* — what was in the drawer when the shift opened. */
    openingFloat: (shiftId: string, body: OpeningFloatBody) =>
      request<unknown>(`/api/shifts/${shiftId}/opening-float`, { method: 'POST', body }),

    /** *Odobri* / *Odbij* on a payout or a float out. */
    decideCashMovement: (id: string, body: DecideCashMovementBody) =>
      request<unknown>(`/api/cash-movements/${id}/decide`, { method: 'POST', body }),

    /** *Prihvati* a waiter's envelope. */
    acceptSettlement: (shiftId: string, settlementId: string) =>
      request<unknown>(`/api/shifts/${shiftId}/settlements/${settlementId}/accept`, {
        method: 'POST', body: {},
      }),

    /** Close a shift over a waiter who went home — the missing envelopes by name. */
    forceCloseShift: (shiftId: string, body: Record<string, unknown> = {}) =>
      request<unknown>(`/api/shifts/${shiftId}/force-close`, { method: 'POST', body }),

    /** *Odobri* / *Odbij* on a storno or a gratis. */
    decideAdjustment: (id: string, body: DecideAdjustmentBody) =>
      request<unknown>(`/api/adjustments/${id}/decide`, { method: 'POST', body }),

    /** *Odobri* / *Odbij* on a *nije plaćeno* tab. */
    decideUnpaid: (tabId: string, body: DecideUnpaidBody) =>
      request<unknown>(`/api/tabs/${tabId}/unpaid/decide`, { method: 'POST', body }),

    // -- Roba -----------------------------------------------------------------

    /** *Stanje šanka* as the owner reads it: value, status, low and negative. */
    getOwnerStock: () => request<OwnerStockReport>('/api/owner/stock'),

    /** One article's ledger, newest first. `before` is the keyset cursor. */
    getItemMovements: (itemId: string, q: { before?: string, limit?: number } = {}) =>
      request<ItemMovementsPage>(`/api/owner/stock/${itemId}/movements${qs(q)}`),

    /** *Nargila* — grams per bowl per aroma, for one month (`YYYY-MM`). */
    getNargila: (month: string) =>
      request<NargilaReport>(`/api/owner/nargila${qs({ month })}`),

    /** *Kategorije* — nabavka against prodaja, per category, over a period. */
    getCategories: (p: Period) =>
      request<CategoriesReport>(`/api/owner/categories${qs({ from: p.from, to: p.to })}`),

    /** *Prijem robe* — the typed delivery form. */
    postDelivery: (body: CreateDeliveryBody) =>
      request<DeliveryView>('/api/stock/deliveries', { method: 'POST', body }),

    /** Deliveries in a period, for the *Prijem robe* list. */
    getDeliveries: (p: Period) =>
      request<DeliveryView[]>(`/api/stock/deliveries${qs({ from: p.from, to: p.to })}`),

    /** Undo a delivery posted by mistake. Reverses, never deletes. */
    reverseDelivery: (id: string, body: Record<string, unknown> = {}) =>
      request<unknown>(`/api/stock/deliveries/${id}/reverse`, { method: 'POST', body }),

    /** *Popisi* — the counts list, optionally one shift's or one status'. */
    getCounts: (q: { shift_id?: string, status?: string } = {}) =>
      request<PendingCount[]>(`/api/stock/counts${qs(q)}`),

    getCount: (id: string) => request<CountView>(`/api/stock/counts/${id}`),

    /**
     * *Pošalji popis* — the whole count with its lines, in one call.
     *
     * The draft lives on the client until this posts, exactly as on the phone;
     * there is no route that adds a line to a saved count and there must not be.
     */
    submitCount: (body: SubmitCountBody) =>
      request<CountView>('/api/stock/counts', { method: 'POST', body }),

    /** *Primijeni* — confirming a submitted count applies its variance. */
    confirmCount: (id: string, body: ConfirmCountBody) =>
      request<ConfirmResult>(`/api/stock/counts/${id}/confirm`, { method: 'POST', body }),

    /** *Otpis* — writing off what broke or spoiled. */
    postWaste: (body: LogWasteBody) =>
      request<WasteView>('/api/stock/waste', { method: 'POST', body }),

    approveWaste: (id: string, body: Record<string, unknown> = {}) =>
      request<unknown>(`/api/stock/waste/${id}/approve`, { method: 'POST', body }),

    /** A correction to on-hand, with a reason. Append-only, like everything else. */
    correctStock: (body: CorrectStockBody) =>
      request<unknown>('/api/stock/corrections', { method: 'POST', body }),

    /** *Početno stanje* — one time per article (`409 OPENING_LOCKED` after that). */
    postOpeningStock: (body: OpeningStockBody) =>
      request<unknown>('/api/stock/opening', { method: 'POST', body }),

    // -- Meni i postavke ------------------------------------------------------

    getProducts: () => request<ProductAdmin[]>('/api/admin/products'),
    createProduct: (body: CreateProductBody) =>
      request<ProductAdmin>('/api/admin/products', { method: 'POST', body }),
    updateProduct: (id: string, body: UpdateProductBody) =>
      request<ProductAdmin>(`/api/admin/products/${id}`, { method: 'PATCH', body }),
    /** The recipe (*normativ*) replaces the whole set atomically. */
    setRecipe: (id: string, body: SetRecipeBody) =>
      request<ProductAdmin>(`/api/admin/products/${id}/recipe`, { method: 'PUT', body }),

    getAdminCategories: () => request<CategoryAdmin[]>('/api/admin/categories'),
    createCategory: (body: CreateCategoryBody) =>
      request<CategoryAdmin>('/api/admin/categories', { method: 'POST', body }),
    updateCategory: (id: string, body: UpdateCategoryBody) =>
      request<CategoryAdmin>(`/api/admin/categories/${id}`, { method: 'PATCH', body }),

    getTables: () => request<TableAdmin[]>('/api/admin/tables'),
    createTable: (body: CreateTableBody) =>
      request<TableAdmin>('/api/admin/tables', { method: 'POST', body }),
    updateTable: (id: string, body: UpdateTableBody) =>
      request<TableAdmin>(`/api/admin/tables/${id}`, { method: 'PATCH', body }),

    /** The catalogue behind every stock form and every recipe line. */
    getStockItems: () => request<StockItemAdmin[]>('/api/admin/stock-items'),
    createStockItem: (body: CreateStockItemBody) =>
      request<StockItemAdmin>('/api/admin/stock-items', { method: 'POST', body }),
    updateStockItem: (id: string, body: UpdateStockItemBody) =>
      request<StockItemAdmin>(`/api/admin/stock-items/${id}`, { method: 'PATCH', body }),

    getUsers: () => request<UserAdmin[]>('/api/admin/users'),
    createUser: (body: CreateUserBody) =>
      request<UserAdmin>('/api/admin/users', { method: 'POST', body }),
    /** Deactivation is `active: 0`. A person is never deleted. */
    updateUser: (id: string, body: UpdateUserBody) =>
      request<UserAdmin>(`/api/admin/users/${id}`, { method: 'PATCH', body }),
    /** A new PIN. No response anywhere carries a hash. */
    resetUserPin: (id: string, body: ResetUserPinBody) =>
      request<PinResetResult>(`/api/admin/users/${id}/pin`, { method: 'POST', body }),

    getDevices: () => request<DeviceAdmin[]>('/api/admin/devices'),
    updateDevice: (id: string, body: UpdateDeviceBody) =>
      request<DeviceAdmin>(`/api/admin/devices/${id}`, { method: 'PATCH', body }),
    revokeDevice: (id: string) =>
      request<unknown>(`/api/admin/devices/${id}/revoke`, { method: 'POST', body: {} }),
    unlockDevice: (id: string) =>
      request<unknown>(`/api/admin/devices/${id}/unlock`, { method: 'POST', body: {} }),
    /** The six characters the owner reads out across the bar, and their expiry. */
    createEnrolCode: (body: Record<string, unknown> = {}) =>
      request<EnrolCodeResult>('/api/admin/enrol-codes', { method: 'POST', body }),

    getSettings: () => request<Settings>('/api/admin/settings'),
    updateSettings: (body: SettingsPatch) =>
      request<Settings>('/api/admin/settings', { method: 'PATCH', body }),

    // -- Dnevnik --------------------------------------------------------------

    /**
     * The Dnevnik feed. Owner-only, newest first, keyset-paged on `before`.
     *
     * Every filter is a field of `LogQuery`, so a screen cannot ask for one the
     * server does not implement.
     */
    getOwnerLog: (q: LogQuery = {}) => request<LogListResult>(`/api/owner/log${qs({
      before: q.before,
      after: q.after,
      kind: q.kind,
      group: q.group,
      actor: q.actor,
      from: q.from,
      to: q.to,
      important: q.important ? 1 : undefined,
      limit: q.limit,
    })}`),

    /** One entry, with the request it resolved or the decision that resolved it. */
    getOwnerLogEntry: (id: string) => request<LogEntryDetail>(`/api/owner/log/${id}`),

    /** Opening *Dnevnik* clears the nav badge. */
    markLogSeen: () =>
      request<unknown>('/api/owner/log/seen', { method: 'POST', body: {} }),
  }
}
