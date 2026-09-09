/**
 * WP3 owns this fragment (`docs/BACKEND.md` §6.1–§6.4): the round, the tab, the
 * naplata and the storno.
 *
 * Every sentence here reaches a waiter mid-service, so it says what happened
 * **and** what to do next. `tests/unit/errors.test.ts` walks `server/**` for
 * every thrown code and fails if one has no sentence — and, the other way, if a
 * sentence has no code, so nothing here is aspirational.
 *
 * Codes shared with the shift package (`NOT_PENDING`, `SELF_APPROVAL`,
 * `ALREADY_DECIDED`, `NOTE_REQUIRED`, `FORBIDDEN`) are deliberately **not**
 * repeated: `shared/errors.ts` spreads the fragments into one object and a
 * second definition of the same key would quietly win or lose depending on the
 * order of two lines nobody reads.
 */
export const MONEY_ERRORS = {
  TABLE_NOT_FOUND: 'Taj sto ne postoji.',
  TABLE_OCCUPIED: 'Na tom stolu je već otvoren račun.',
  USER_NOT_FOUND: 'Ta osoba ne postoji.',
  PRODUCT_NOT_FOUND: 'Taj artikal ne postoji.',
  FLAVOUR_NOT_FOUND: 'Ta aroma ne postoji.',
  FLAVOURS_REQUIRED: 'Nargila treba 1–3 arome.',
  FLAVOURS_NOT_ALLOWED: 'Taj artikal nema arome.',
  PARENT_LINE_NOT_FOUND: 'Ta stavka ne postoji na ovoj turi.',
  ORDER_NOT_FOUND: 'Ta narudžba ne postoji.',
  ORDER_ALREADY_PREPARED: 'Narudžba je već pripremljena.',

  TAB_NOT_FOUND: 'Taj račun ne postoji.',
  TAB_CLOSED: 'Račun je zatvoren.',
  TAB_ALREADY_PAID: 'Račun je već naplaćen.',
  TAB_VOIDED: 'Račun je storniran.',
  TAB_TABLE_MISMATCH: 'Taj račun je na drugom stolu. Osvježi stolove.',

  OVERPAY: 'Iznos je veći od onoga što ostaje za naplatu.',
  METHOD_NOT_ALLOWED: 'Taj način plaćanja nije uključen.',
  INVALID_COVERS: 'Ture koje si označio nisu s ovog računa.',
  NOTHING_TO_MARK: 'Na ovom računu nema šta da se označi.',

  NOT_ASSIGNED: 'Ovaj sto vodi neko drugi.',
  INVALID_TARGET: 'Toj osobi ne možeš predati sto.',
  NOT_OFFERED: 'Ovaj sto nije ponuđen tebi.',

  LINE_NOT_FOUND: 'Ta stavka ne postoji.',
  LINE_ALREADY_ADJUSTED: 'Za ovu stavku je storno već zatražen.',
  ADJUSTMENT_NOT_FOUND: 'Taj zahtjev ne postoji.',
  WINDOW_EXPIRED: 'Isteklo je vrijeme za šankera. Ide vlasniku.',
  ADMIN_PIN_FOREIGN_DEVICE: 'Vlasnik PIN unosi samo na svom telefonu.',
  ADMIN_FOREIGN_DEVICE: 'Vlasnik ovo odlučuje sa svog telefona ili s računara.',
} as const
