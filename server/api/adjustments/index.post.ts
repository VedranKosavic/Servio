/**
 * `POST /api/adjustments` — *Zatraži storno* / *Zatraži gratis*.
 *
 * PIN-bearing: when the body carries an approver and a PIN it is verified
 * through `verifyPinMetered` **before** the transaction opens, so a wrong PIN
 * leaves an `auth_attempts` row that the rejected transaction cannot roll back.
 */
import { createAdjustmentBody } from '#shared/schemas'
import { useDb } from '../../utils/db'
import { guard, readValidatedJson } from '../../utils/http'
import { requestAdjustment } from '../../services/adjustments'

export default defineEventHandler(async (event) => {
  const body = await readValidatedJson(event, createAdjustmentBody)
  return guard(() => requestAdjustment(useDb(), event.context.venueId, event.context.actor, body))
})
