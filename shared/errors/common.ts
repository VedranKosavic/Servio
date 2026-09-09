/**
 * The codes every package can throw. WP0 owns this fragment; each other package
 * owns its own file beside it, so no two branches ever edit the same lines.
 */
export const COMMON_ERRORS = {
  INVALID_BODY: 'Zahtjev nije ispravan.',
  INVALID_PARAM: 'Zahtjev nije ispravan.',
  FORBIDDEN: 'Nemaš pristup ovome.',
  NOT_FOUND: 'Nije pronađeno.',
  RATE_LIMITED: 'Previše pokušaja. Sačekaj malo.',
  NO_VENUE: 'Baza je prazna — pokreni `npm run db:seed`.',
  SERVER_ERROR: 'Greška na serveru. Pokušaj ponovo.',
  /** A `contracts.ts` stub the work package that owns it has not landed yet. */
  NOT_IMPLEMENTED: 'Ova radnja još nije spremna.',
} as const
