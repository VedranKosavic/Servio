/**
 * *Storno* and *na račun kuće* — the phone's half of PLAN F6 and F7.
 *
 * One composable behind three sheets and one screen: `AdjVoidSheet` asks for a
 * void, `AdjCompSheet` asks for a gratis, `AdjPinSheet` collects an approver's
 * PIN on the requester's own phone, and `/sanker/cekanje` is where a bartender
 * answers what is waiting.
 *
 * ## The ladder, as the phone sees it
 *
 * The server decides — always, and its answer is the only one that counts
 * (`server/services/adjustments.ts`). But a waiter's thumb cannot wait for a
 * router, so this file predicts the same ladder locally in order to draw the
 * line struck grey or struck amber straight away:
 *
 *   1. his own line, unpaid tab, inside `void_self_window_s` → applies itself;
 *   2. an approver's PIN typed here, inside `bartender_approve_window_s` → applied;
 *   3. otherwise it waits, and the amount stays in his own pazar until somebody
 *      decides.
 *
 * The prediction is never treated as the truth: every request bumps `adjustment`
 * and `table` in the change feed, so the real state arrives on the next poll and
 * replaces it. Where the two can disagree (the bartender already lit the bowl,
 * or the sixth self-void of the night crossed the cap) the poll corrects the
 * line within seconds and the *Na čekanju* queue shows the request.
 *
 * ## Two send paths, and why the second one exists
 *
 * A PIN-less request goes through the **outbox** like every other piece of money
 * (PHASE3 §2.2): queued, flushed in order, exactly once. That is the path a dead
 * spot behind the fridge needs.
 *
 * A **PIN-bearing** request does not. A PIN is a credential, and an outbox entry
 * is a row in IndexedDB that can sit on a phone for hours — writing Emir's six
 * digits there, on Amar's handset, would undo the whole point of scrypt-hashing
 * PINs on the server (CLAUDE.md: nothing secret ships to the client). So the
 * approver's branch is offered **only while the phone is online** and posts
 * directly; and if that post cannot reach the server after all, the same request
 * is queued again *without* the PIN, under the same `client_id`. Nothing is
 * lost: it lands `pending`, which is exactly what the offline copy promises —
 * "Nema veze — ide na čekanje, Emir potvrđuje sa svog telefona."
 *
 * A **decision** (*Odobri* / *Odbij*) is online-only for a different reason: a
 * bartender's authority is a window measured at the moment he decides, so a
 * decision flushed an hour later would be a decision he no longer had the right
 * to make. It fails honestly instead of queueing.
 */
import { formatKm } from '#shared/money'
import type { MeUser, PendingAdjustment, Role } from '#shared/types'

// ---------------------------------------------------------------------------
// The chips
// ---------------------------------------------------------------------------

export type VoidReason = 'wrong_entry' | 'guest_changed_mind' | 'not_served' | 'complaint' | 'other'
export type CompReason = 'staff_drink' | 'owner_guest' | 'complaint' | 'promo'

export interface ReasonChip<T extends string> {
  id: T
  label: string
  /** Do the goods go back on the shelf? Mirrors `RESTOCK_REASONS` (F6 step 2). */
  restock?: boolean
}

/**
 * Why a line is struck. `restock` here is the same list the server reads from
 * `RESTOCK_REASONS`, spelled out so the sheet can say *"Vraća robu na stanje:
 * da / ne"* before anything is sent — the waiter should know what he is doing to
 * the shelf while he is still choosing.
 *
 * `walked_out` is deliberately absent: a guest who left without paying is *Nije
 * plaćeno*, not a storno, and the two must never be the same button.
 */
export const VOID_REASONS: ReasonChip<VoidReason>[] = [
  { id: 'wrong_entry', label: 'Greška u kucanju', restock: true },
  { id: 'guest_changed_mind', label: 'Gost se predomislio', restock: true },
  { id: 'not_served', label: 'Nije posluženo', restock: true },
  { id: 'complaint', label: 'Žalba gosta', restock: false },
  { id: 'other', label: 'Drugo', restock: false },
]

/** *Na račun kuće*. Only *Osoblje* can authorise itself, and only under the cap. */
export const COMP_REASONS: ReasonChip<CompReason>[] = [
  { id: 'staff_drink', label: 'Osoblje' },
  { id: 'owner_guest', label: 'Gost vlasnika' },
  { id: 'complaint', label: 'Žalba gosta' },
  { id: 'promo', label: 'Promocija' },
]

/** *Drugo* says nothing on its own, so it has to be written out (F6 step 2). */
export const NOTE_MIN_LENGTH = 5

export function reasonLabel(reason: string): string {
  return [...VOID_REASONS, ...COMP_REASONS].find(r => r.id === reason)?.label ?? reason
}

// ---------------------------------------------------------------------------
// What a request looks like from a screen
// ---------------------------------------------------------------------------

export interface AdjustmentRequest {
  /** The line's uuid — minted on the phone when the tile was tapped. */
  order_line_id: string
  kind: 'void' | 'comp'
  reason: VoidReason | CompReason
  note?: string
  /** What a failure blocks: this table's queue, and no other table's. */
  tab_client_id?: string
  /** *Sto 7 · Kafa* on the failed card. Display only, never sent. */
  label?: string
  /** The line's own money, for the copy and the failed card. */
  amount_fen: number
  /** Whose PIN grants it here and now. Online only — see the header. */
  approver?: { user_id: string, pin: string }
  /**
   * What the phone knows about the line, for the local prediction. All three
   * come from the tab this screen is already showing.
   */
  facts?: {
    /** `orders.created_at` of the round the line belongs to. */
    locked_at?: string | null
    /** Did *this* person lock it? A self-void is only ever your own line. */
    mine?: boolean
    /** A paid tab is never a self-void. */
    tab_paid?: boolean
  }
}

/** What the sheet renders after *Potvrdi*. */
export interface AdjustmentOutcome {
  /** Where the request is: with the server, or still on this phone. */
  sent: boolean
  /** What we believe the server did (or will do) with it. */
  status: 'applied' | 'pending'
  /** The Bosnian sentence for the strip under the line, and for the toast. */
  message: string
  /** Present only when the server answered in this breath. */
  adjustment?: PendingAdjustment
}

export function useAdjustments() {
  const api = useApi()
  const me = useMe()
  const cart = useCartStore()
  const { enqueue, outbox } = useOutbox()
  const { data: boot } = useBootstrapData()

  const settings = computed(() => me.settings.value)
  const selfWindowS = computed(() => settings.value?.void_self_window_s ?? 300)
  const approveWindowS = computed(() => settings.value?.bartender_approve_window_s ?? 900)
  const staffDrinkMaxFen = computed(() => settings.value?.staff_drink_max_fen ?? 300)
  const staffDrinksPerShift = computed(() => settings.value?.staff_drinks_per_shift ?? 2)

  // -- who may be asked for a PIN --------------------------------------------

  /**
   * The names this phone may offer an approver's PIN for.
   *
   * The rows come from `GET /api/auth/users` rather than from the bootstrap
   * catalogue, for one small reason that matters at the keypad: that response
   * carries `pin_len`, and the pad has to draw four dots for Amar and six for
   * Emir. It is the lock screen's own read — device-scoped, session-free, and
   * carrying nothing but a name, initials, a role and a PIN length.
   *
   * Three filters, all of them the server's rules drawn on the screen rather
   * than discovered by a 403: only roles in `approver_roles`, never yourself,
   * and never the owner unless this is his own bound phone, because
   * `ADMIN_PIN_FOREIGN_DEVICE` refuses that and a button that always fails is
   * worse than no button.
   */
  const staff = ref<MeUser[]>([])

  async function loadApprovers(): Promise<void> {
    if (staff.value.length > 0) return
    try {
      staff.value = await api.getLoginUsers()
    } catch {
      // Only the PIN branch needs this list, and that branch is online-only.
      // An empty list simply means the sheet offers no PIN this minute.
    }
  }

  const approvers = computed<MeUser[]>(() => {
    const roles = (settings.value?.approver_roles ?? ['admin', 'bartender']) as Role[]
    const boundTo = me.device.value?.bound_user_id ?? null
    return staff.value.filter(user => (
      roles.includes(user.role)
      && user.id !== me.user.value?.id
      && (user.role !== 'admin' || boundTo === user.id)
    ))
  })

  /**
   * The bartender to name in the offline sentence — PLAN's copy says "Emir
   * potvrđuje sa svog telefona", and a name only helps if it is the right one.
   * With more than one bartender on the staff list there is no way to know which
   * of them is behind the bar tonight, so the sentence falls back to the role.
   */
  const approverName = computed(() => {
    const bartenders = (boot.value?.users ?? []).filter(u => u.role === 'bartender')
    return bartenders.length === 1 ? bartenders[0]!.name : 'šanker'
  })

  // -- the local half of the ladder ------------------------------------------

  /** Seconds since the round was locked, as this phone reads its own clock. */
  function secondsSinceLock(lockedAt?: string | null): number | null {
    if (!lockedAt) return null
    const ms = Date.parse(lockedAt)
    if (!Number.isFinite(ms)) return null
    return Math.max(0, Math.floor((Date.now() - ms) / 1000))
  }

  /** Would this request apply itself, as far as the phone can tell? */
  function predict(input: AdjustmentRequest): 'applied' | 'pending' {
    const age = secondsSinceLock(input.facts?.locked_at)

    if (input.approver) {
      // An approver's PIN grants it — a bartender's only inside his window. The
      // owner's has no window at all.
      const isAdmin = approvers.value.find(u => u.id === input.approver!.user_id)?.role === 'admin'
      if (isAdmin) return 'applied'
      return age !== null && age <= approveWindowS.value ? 'applied' : 'pending'
    }

    if (input.kind === 'void') {
      const self = input.facts?.mine === true
        && input.facts?.tab_paid !== true
        && age !== null && age <= selfWindowS.value
      return self ? 'applied' : 'pending'
    }

    // A gratis: only *Osoblje*, only under the per-drink cap, and only on your
    // own line. The per-shift count is the server's to check — the phone has no
    // honest way to know it until `GET /api/me/shift` carries `counts.gratis`.
    const selfComp = input.reason === 'staff_drink'
      && input.facts?.mine === true
      && input.amount_fen <= staffDrinkMaxFen.value
    return selfComp ? 'applied' : 'pending'
  }

  /** The sentence under the line, in the four cases it can be in. */
  function outcomeMessage(
    kind: 'void' | 'comp', status: 'applied' | 'pending', sent: boolean, amountFen: number,
  ): string {
    if (!sent) {
      return `Nema veze — ide na čekanje, ${approverName.value} potvrđuje sa svog telefona.`
    }
    if (status === 'applied') {
      return kind === 'void'
        ? `Storno urađen · ${formatKm(amountFen)}`
        : `Na račun kuće · ${formatKm(amountFen)}`
    }
    return kind === 'void'
      ? `Storno čeka odobrenje — ${formatKm(amountFen)} ostaje u tvom pazaru dok se ne odobri.`
      : `Gratis čeka odobrenje — ${formatKm(amountFen)} ostaje u tvom pazaru dok se ne odobri.`
  }

  // -- asking ----------------------------------------------------------------

  const requesting = ref(false)

  /**
   * *Zatraži storno* / *Zatraži gratis*.
   *
   * Throws only on a 4xx the person can do something about — a wrong PIN, a line
   * somebody already struck. Everything else ends as an outcome, because a
   * network that is not there is not the waiter's mistake.
   */
  async function request(input: AdjustmentRequest): Promise<AdjustmentOutcome> {
    // One uuid for both attempts: if the PIN request landed but its answer got
    // lost, the queued retry carries the same key and the server answers with
    // the row it already wrote instead of striking the line twice.
    const clientId = crypto.randomUUID()
    const body: Record<string, unknown> = {
      client_id: clientId,
      order_line_id: input.order_line_id,
      kind: input.kind,
      reason: input.reason,
      ...(input.note ? { note: input.note } : {}),
      // When the thumb moved. Ten minutes in a dead spot must not cost a waiter
      // the 300 s window this claim exists to protect (PHASE3 §1.2).
      client_created_at: new Date().toISOString(),
    }

    requesting.value = true
    try {
      if (input.approver) {
        try {
          const result = await api.requestAdjustment({
            ...body,
            approver_user_id: input.approver.user_id,
            pin: input.approver.pin,
          })
          const status = result.applied ? 'applied' : 'pending'
          return {
            sent: true,
            status,
            adjustment: result.adjustment,
            message: outcomeMessage(input.kind, status, true, result.adjustment.amount_fen),
          }
        } catch (err) {
          const e = err as ApiSideError
          // A refusal the person can answer — wrong PIN, not an approver, the
          // line is already struck. Straight back to the sheet.
          if (e?.status >= 400 && e.status < 500) throw err
          // The router, not the PIN. Queue the same request without the six
          // digits: it lands `pending`, which is what the offline copy says.
        }
      }

      await enqueue({
        kind: 'adjust',
        client_id: clientId,
        payload: body,
        ...(input.tab_client_id ? { tab_client_id: input.tab_client_id } : {}),
        ...(input.label ? { label: input.label } : {}),
        amount_fen: input.amount_fen,
      })

      // Enqueue flushes in the same breath, so "did it leave" is a question with
      // an answer by the time the sheet closes.
      const stillQueued = outbox.entries.some(e => e.client_id === clientId)
      const status = predict(input)
      return {
        sent: !stillQueued,
        status,
        message: outcomeMessage(input.kind, status, !stillQueued, input.amount_fen),
      }
    } finally {
      requesting.value = false
    }
  }

  // -- the queue -------------------------------------------------------------

  const pending = ref<PendingAdjustment[]>([])
  const loaded = ref(false)
  const loadError = ref<string | null>(null)
  const deciding = ref<string | null>(null)

  async function load(): Promise<void> {
    try {
      pending.value = await api.getPendingAdjustments()
      loadError.value = null
      loaded.value = true
    } catch (err) {
      // A list that could not refresh says so rather than showing a stale queue
      // as if it were current (PHASE3 §4, *Honesty*).
      loadError.value = apiErrorText(err, 'Nema veze — lista možda nije svježa')
      void me.handleAuthError(err)
    }
  }

  /**
   * *Odobri* / *Odbij*. Online only: the bartender's window is measured at the
   * moment of the decision, so a queued one would be an authority he no longer
   * has. `restock` is left to the server, which already knows what the reason
   * implied — the sheet on `/admin` is where an owner flips it.
   */
  async function decide(id: string, outcome: 'applied' | 'rejected'): Promise<void> {
    if (deciding.value) return
    deciding.value = id
    try {
      await api.decideAdjustment(id, { outcome })
      pending.value = pending.value.filter(row => row.id !== id)
      loadError.value = null
    } catch (err) {
      loadError.value = apiErrorText(err)
      void me.handleAuthError(err)
      // Whatever the server thinks now is what the queue should show.
      await load()
    } finally {
      deciding.value = null
    }
  }

  // -- what a table's own screen needs ---------------------------------------

  /** This line's storno, if one is queued on this phone but not yet sent. */
  function queuedFor(orderLineId: string): boolean {
    return outbox.entries.some((entry) => {
      if (entry.kind !== 'adjust') return false
      const payload = entry.payload as { order_line_id?: string }
      return payload?.order_line_id === orderLineId
    })
  }

  /** The tab id a queued storno should name, mirroring the pay sheet's rule. */
  function tabClientIdFor(tableId: string | null, serverTabClientId?: string | null): string {
    return serverTabClientId ?? cart.ensureTabClientId(tableId)
  }

  return {
    // rules on screen
    selfWindowS,
    approveWindowS,
    staffDrinkMaxFen,
    staffDrinksPerShift,
    approvers,
    approverName,
    loadApprovers,
    // asking
    request,
    requesting,
    predict,
    secondsSinceLock,
    queuedFor,
    tabClientIdFor,
    // the queue
    pending,
    loaded,
    loadError,
    deciding,
    load,
    decide,
  }
}
