/**
 * WP2 owns this fragment (`docs/BACKEND.md` §6.5–§6.7): the shift, the drawer and
 * the envelope.
 *
 * Every sentence here reaches a phone at three in the morning, so each one says
 * what happened **and** what to do next. `tests/unit/errors.test.ts` walks
 * `server/**` for every thrown code and fails if one has no sentence — and, the
 * other way, if a sentence has no code.
 */
export const SHIFT_ERRORS = {
  SHIFT_NOT_FOUND: 'Ta smjena ne postoji.',
  SHIFT_ALREADY_OPEN: 'Smjena je već otvorena.',
  SHIFT_CLOSED: 'Smjena je zatvorena.',
  SHIFT_NOT_CLOSED: 'Smjena još nije zatvorena.',
  OPEN_TABS: 'Ima otvorenih stolova. Naplati ih ili označi kao neplaćene.',
  NO_OPEN_COUNT: 'Nema početnog popisa za ovu smjenu.',
  NOTE_REQUIRED: 'Napiši šta se desilo.',
  ALREADY_LEFT: 'Već si završio smjenu.',
  NOT_APPROVER: 'Ovo ne možeš odobriti.',

  MOVEMENT_NOT_FOUND: 'Ta stavka kase ne postoji.',
  NOT_PENDING: 'Ova stavka ne čeka odluku.',
  ALREADY_DECIDED: 'Već je odlučeno.',
  NOT_RECEIVER: 'Samo onaj ko prima pare može potvrditi.',
  SELF_APPROVAL: 'Svoje pare ne odobravaš sam.',
  OWNER_REQUIRED: 'Ovoliku isplatu odobrava vlasnik.',

  SETTLED: 'Već si predao pazar za ovu smjenu.',
  PENDING_OUTBOX: 'Imaš tura koje nisu poslane. Sačekaj da se pošalju.',
  SETTLEMENT_NOT_FOUND: 'Ta predaja ne postoji.',
  ALREADY_ACCEPTED: 'Predaja je već potvrđena.',
  OWN_SETTLEMENT: 'Svoju predaju ne potvrđuješ sam.',

  SUMMARY_MISMATCH: 'Obračun smjene se ne slaže. Javi vlasniku.',
} as const
