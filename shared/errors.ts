/**
 * Every error code, and the Bosnian sentence the guest-facing screen shows.
 *
 * This file is a **barrel and nothing else**. `shared/errors.ts` and
 * `shared/types.ts` are the two files every work package would otherwise have to
 * edit — which contradicts "no package edits another's files" — so both are
 * split the way the schemas are: one fragment per package, one line here.
 *
 * `tests/unit/errors.test.ts` greps `server/services/**` and `server/api/**` for
 * every `SankError(`, `conflict(`, `forbidden(`, `unauthorized(`,
 * `unprocessable(` and `locked(` code literal and asserts each one has a
 * non-empty sentence below — and, the other way, that no sentence is orphaned.
 * Without it a code reaches the phone as raw `TAB_TABLE_MISMATCH`.
 *
 * A message may carry `{placeholders}` (`{retry_after_s}`), filled by the client
 * from the error's `data`.
 */
import { COMMON_ERRORS } from './errors/common'
import { AUTH_ERRORS } from './errors/auth'
import { MONEY_ERRORS } from './errors/money'
import { SHIFT_ERRORS } from './errors/shifts'
import { STOCK_ERRORS } from './errors/stock'
import { SYNC_ERRORS } from './errors/sync'
import { ADMIN_ERRORS } from './errors/admin'
import { CHAT_ERRORS } from './errors/chat'
import { ROSTER_ERRORS } from './errors/roster'
import { RULES_ERRORS } from './errors/rules'
import { SCAN_ERRORS } from './errors/scan'

export const ERROR_MESSAGES: Record<string, string> = {
  ...COMMON_ERRORS,
  ...AUTH_ERRORS,
  ...MONEY_ERRORS,
  ...SHIFT_ERRORS,
  ...STOCK_ERRORS,
  ...SYNC_ERRORS,
  ...ADMIN_ERRORS,
  ...CHAT_ERRORS,
  ...ROSTER_ERRORS,
  ...RULES_ERRORS,
  ...SCAN_ERRORS,
}

/** The sentence for a code, or a safe fallback — never a raw code on a screen. */
export function errorMessage(code: string): string {
  return ERROR_MESSAGES[code] ?? COMMON_ERRORS.SERVER_ERROR
}

export {
  COMMON_ERRORS, AUTH_ERRORS, MONEY_ERRORS, SHIFT_ERRORS,
  STOCK_ERRORS, SYNC_ERRORS, ADMIN_ERRORS,
  CHAT_ERRORS, ROSTER_ERRORS, RULES_ERRORS, SCAN_ERRORS,
}
