/**
 * WP3 owns this fragment (`docs/BACKEND.md` §6.1–§6.4). WP0 seeds it with the
 * codes the Korak 1 order and tab services already throw, so `errors.test.ts`
 * has a complete map from the first day rather than after the rewrite.
 */
export const MONEY_ERRORS = {
  TABLE_NOT_FOUND: 'Taj sto ne postoji.',
  USER_NOT_FOUND: 'Ta osoba ne postoji.',
  PRODUCT_NOT_FOUND: 'Taj artikal ne postoji.',
  FLAVOUR_NOT_FOUND: 'Ta aroma ne postoji.',
  FLAVOURS_REQUIRED: 'Nargila treba 1–3 arome.',
  FLAVOURS_NOT_ALLOWED: 'Taj artikal nema arome.',
  ORDER_NOT_FOUND: 'Ta narudžba ne postoji.',
  ORDER_ALREADY_PREPARED: 'Narudžba je već pripremljena.',
  TAB_NOT_FOUND: 'Taj račun ne postoji.',
  TAB_CLOSED: 'Račun je zatvoren.',
  TAB_ALREADY_PAID: 'Račun je već naplaćen.',
} as const
