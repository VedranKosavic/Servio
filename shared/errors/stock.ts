/**
 * WP4 owns this fragment (`docs/BACKEND.md` §6.8). Every sentence is what a
 * bartender reads at two in the morning, so each one says what happened **and**
 * what to do instead; `tests/unit/errors.test.ts` fails on a thrown code with no
 * sentence here, and on a sentence no code throws.
 */
export const STOCK_ERRORS = {
  STOCK_ITEM_NOT_FOUND: 'Ta roba ne postoji.',
  INVALID_QTY: 'Količina nije ispravna.',

  // -- Početno stanje -------------------------------------------------------
  OPENING_LOCKED: 'Ova roba već ima promet — ispravi je korekcijom, ne početnim stanjem.',

  // -- Prijem robe ----------------------------------------------------------
  DELIVERY_NOT_FOUND: 'Taj prijem robe ne postoji.',
  DELIVERY_ALREADY_REVERSED: 'Ovaj prijem je već storniran.',
  RECEIVING_FORBIDDEN: 'Prijem robe knjiži vlasnik.',

  // -- Otpis ----------------------------------------------------------------
  WASTE_NOT_FOUND: 'Taj otpis ne postoji.',
  WASTE_ALREADY_APPROVED: 'Ovaj otpis je već odobren.',
  REASON_FORBIDDEN: 'Ovaj razlog otpisa upisuje šanker ili vlasnik.',

  // -- Popis ----------------------------------------------------------------
  COUNT_NOT_FOUND: 'Taj popis ne postoji.',
  NO_OPEN_SHIFT: 'Nema otvorene smjene — nema se šta zaključiti.',
  COUNT_EXISTS: 'Ova smjena već ima takav popis.',
  COUNT_ALREADY_CONFIRMED: 'Popis je već potvrđen.',
  LINES_MISSING: 'Fali roba na popisu — popiši sve stavke.',
  PRICE_MISSING: 'Ova roba nema cijenu — unesi je u Početno stanje pa potvrdi popis.',
} as const
