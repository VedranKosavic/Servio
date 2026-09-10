/**
 * The admin catalogue's error sentences (`docs/BACKEND.md` §6.10).
 *
 * WP6 owns this fragment; `shared/errors.ts` spreads it into `ERROR_MESSAGES`.
 * `tests/unit/errors.test.ts` checks both directions — a code thrown under
 * `server/**` with no sentence here, and a sentence here nobody throws.
 *
 * These are read by an admin on a laptop, not by a waiter mid-rush, so they may
 * explain *why* rather than only saying no.
 */
export const ADMIN_ERRORS = {
  // `PRODUCT_NOT_FOUND`, `TABLE_NOT_FOUND` and `STOCK_ITEM_NOT_FOUND` were
  // written here *and* in `errors/{money,stock}.ts`. `ADMIN_ERRORS` is spread
  // last, so this fragment's "… nije pronađen." was silently winning on the
  // waiter's phone as well as on the laptop, and the three sentences the money
  // and stock packages wrote for their own screens were dead text.
  //
  // WP8 deleted this fragment's copies and kept theirs, which are the ones every
  // *other* not-found in the app is already spelled like — 'Ta osoba ne
  // postoji.', 'Taj račun ne postoji.', 'Ta narudžba ne postoji.'. One code, one
  // sentence, and now one voice: "Taj/Ta X ne postoji." `CATEGORY_NOT_FOUND`
  // stays because it is the only fragment that defines it.
  CATEGORY_NOT_FOUND: 'Kategorija ne postoji.',

  /** Nothing to change: a PATCH with no keys would write an empty Dnevnik entry. */
  EMPTY_PATCH: 'Nema izmjena za snimiti.',

  /**
   * A new item without a cost turns off variance, vrijednost otpisa and utrošak
   * without saying so (§3.1), so the cost is asked for once, at the start.
   */
  COST_REQUIRED: 'Unesi nabavnu cijenu — bez nje se manjak ne može izračunati.',

  /**
   * The ledger's `qty_delta` is in the old unit and on hand is `SUM(qty_delta)`.
   * Changing the unit under it would start adding mililitre to grame.
   */
  UNIT_FROZEN: 'Jedinica se više ne može mijenjati — roba već ima promet.',

  TABLE_HAS_OPEN_TAB: 'Sto ima otvoren račun — zatvori ga pa ga onda ugasi.',

  /** One line per item in a normativ; two lines for the same item is a typo. */
  RECIPE_DUPLICATE: 'Ista roba je dva puta u normativu.',

  /** An admin who deactivates himself locks the only door into `/admin`. */
  SELF_DEACTIVATE: 'Ne možeš deaktivirati sam sebe.',

  EMAIL_TAKEN: 'Ta e-mail adresa je već zauzeta.',
} as const
