/**
 * One `:channel` param, checked once.
 *
 * `tenant.ts` already 403'd anything whose normalised key is not in
 * `ROUTE_ROLES`, and `routeKey()` only turns `svi | konobari | admini` into
 * `:channel` — so by the time a handler runs, the segment is one of the three.
 * This is the belt: a route file that forgot the guard would otherwise hand a
 * free-text string to a `WHERE kind = ?`.
 */
import { isChannelKind } from '#shared/chat'
import type { ChannelKind } from '#shared/chat'
import { apiError } from './http'
import { errorMessage } from '#shared/errors'

export function requireChannelParam(value: string): ChannelKind {
  if (!isChannelKind(value)) {
    throw apiError(404, 'CHANNEL_NOT_FOUND', errorMessage('CHANNEL_NOT_FOUND'))
  }
  return value
}
