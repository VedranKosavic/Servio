/**
 * `PUT /api/admin/products/:id/recipe` — the *normativ*, replaced whole.
 *
 * `PUT` and not `PATCH` because the body is the entire recipe: sending three
 * lines means the product consumes exactly those three afterwards.
 */
import { setRecipeBody } from '#shared/schemas'
import { useDb } from '../../../../utils/db'
import { guard, readValidatedJson, requiredParam } from '../../../../utils/http'
import { requireRole } from '../../../../utils/auth'
import { setRecipe } from '../../../../services/admin'

export default defineEventHandler(async (event) => {
  requireRole(event.context.actor, 'admin')
  const id = requiredParam(event, 'id')
  const body = await readValidatedJson(event, setRecipeBody)
  return guard(() => setRecipe(useDb(), event.context.venueId, event.context.actor, id, body))
})
