/**
 * The response shapes, written once and imported by both sides.
 *
 * This file is a **barrel plus four names**. Everything a route answers is
 * *shaped* in the `docs/BACKEND.md` §6 subsection that returns it and lives in
 * that package's fragment under `shared/types/`, so five work packages can add
 * types in parallel without ever touching the same lines. What stays here is
 * only what is genuinely cross-package: `Role`, `Actor`, `LogKind`,
 * `ChangeEntity`, and the re-exported constants.
 *
 * Request types are derived from the Zod schemas in `./schemas` (one definition,
 * two uses). Response types are declared in the fragments, and the service
 * functions in `server/services/*` are typed to return them — so a change to a
 * route's answer is a compile error in the screen that reads it, instead of a
 * blank field discovered on a Saturday night.
 */

// --- the four cross-package names ------------------------------------------

/**
 * Two roles and no more — *Vlasnik* and *Radnik*.
 *
 * `admin` has the special permissions: the dashboard, every live read, the
 * approvals, the catalogue, users and settings, the Dnevnik. He never appears
 * on, and never shares, the staff screens.
 *
 * `radnik` is everybody else. Which screen a worker is on tonight — *Konobar*
 * or *Šanker* — is no longer a property of the account: it is a choice he makes
 * after the PIN, stored on the **session** as `ScreenMode` and switchable
 * without signing out. `waiter` and `bartender` were already identical on the
 * floor, so `0005_radnik.sql` maps both onto this one value.
 *
 * The one thing that was *not* identical — the bartender being a default
 * approver — was never a role rule anyway: it is `settings.approver_roles`, and
 * it now reads `['admin','radnik']` so the person on the šank can still close a
 * shift. An owner who wants approvals to himself drops `radnik` from that list
 * in *Postavke* and the services refuse a worker even where `ROUTE_ROLES` let
 * him through.
 *
 * Korak 1's `'owner'` is gone: the migration renames the value, and the paths
 * that still say `owner` name the owner *dashboard*, not the role.
 */
export type Role = 'admin' | 'radnik'

/**
 * Which staff screen a session is working tonight.
 *
 * `null` on a session that has not chosen yet (the chooser stands in front of
 * it) and on an admin session, which has no mode at all — the owner's landing
 * is `/admin`, even though he may open `/konobar` or `/sanker` by hand, because
 * he also serves tables.
 */
export type ScreenMode = 'konobar' | 'sanker'

/**
 * Who is making this request. Built once by `authorizeRequest` and passed to
 * every mutation as its third argument — no service reads a user id from a body.
 */
export interface Actor {
  venueId: string
  userId: string
  role: Role
  sessionId: string
  /** 'admin' = an email+password session, which has no device. */
  sessionKind: 'admin' | 'staff'
  deviceId: string | null
  /** A personal device: whose it is. */
  deviceBoundUserId: string | null
  /** Somebody PIN'd into a colleague's phone. */
  borrowed: boolean
}

/** What a `changes` row can be about — the sync feed's vocabulary (§4.1). */
export type ChangeEntity =
  | 'table' | 'prep' | 'stock' | 'count' | 'shift' | 'adjustment'
  | 'menu' | 'settings' | 'user' | 'device' | 'log'
  // Phase 4. A chat write bumps `chat` and nothing else — never `table`,
  // `shift` or anything a waiter's floor plan reads.
  | 'chat' | 'roster' | 'rules'

export type { LogKind } from './logTemplates'

// --- the fragments ----------------------------------------------------------

export type * from './types/admin'
export type * from './types/auth'
export type * from './types/chat'
export type * from './types/money'
export type * from './types/owner'
export type * from './types/roster'
export type * from './types/rules'
export type * from './types/scan'
export type * from './types/shifts'
export type * from './types/stock'
export type * from './types/sync'

// --- request bodies, derived from the Zod schemas ---------------------------

export type {
  ApproveWasteBody,
  AssignTabBody,
  ConfirmCountBody,
  CorrectStockBody,
  CreateAdjustmentBody,
  CreateDeliveryBody,
  CreateOrderBody,
  CreatePaymentBody,
  DecideAdjustmentBody,
  DecideUnpaidBody,
  DiscardDraftBody,
  MarkPreparedBody,
  LogWasteBody,
  MarkUnpaidBody,
  MoveTabBody,
  OpeningStockBody,
  OrderLineInput,
  ReverseDeliveryBody,
  SubmitCountBody,
  WasteReason,
} from './schemas'

// Phase 4's bodies, the same way.
export type {
  AckRulesBody,
  AssignmentBody,
  AssignmentPatch,
  DecideSwapBody,
  DiscardScanBody,
  LinkAliasBody,
  MarkReadBody,
  MuteUserBody,
  PostMessageBody,
  PublishRulesBody,
  ScanDeliveryBody,
  SetPinBody,
  ShiftTemplateBody,
  ShiftTemplatePatch,
  SwapBody,
  WeekBody,
} from './schemas'

// --- the shared constants and settings --------------------------------------

export type { ChannelKind } from './chat'
export type { Settings, SettingsPatch } from './settings'
export type { AlertRuleKey } from './constants'
export type { RouteRole } from './routeRoles'
export type { LogGroup, LogNames, LogTemplate } from './logTemplates'

/** The body of every 4xx/5xx this API returns, unwrapped by `useApi`. */
export interface ApiError {
  code: string
  message: string
  data?: Record<string, unknown>
}
