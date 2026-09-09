/**
 * The auth package's error codes and the Bosnian sentence each one shows.
 *
 * WP1 owns this fragment; `shared/errors.ts` spreads it into `ERROR_MESSAGES`
 * (`docs/BACKEND.md` §2), so no work package ever edits another's lines.
 *
 * `{placeholders}` are filled by the client from the error's `data` — a 423
 * carries `retry_after_s`, a wrong PIN carries `fails_left`.
 *
 * Two rules the wording follows, both deliberate:
 *
 * - **A message never says which half was wrong.** `INVALID_CREDENTIALS` is one
 *   sentence for a wrong email and for a wrong password, because "no such
 *   email" is a free answer to somebody enumerating addresses (§5.1).
 * - **A message tells the person how to get back in.** A locked tablet at 23:00
 *   on a Saturday is a bar that cannot take orders, so the sentence names the
 *   way out (wait, or ask the owner) instead of just saying no.
 */
export const AUTH_ERRORS = {
  // -- The three doors -------------------------------------------------------
  /** Wrong email, or wrong password. One sentence for both, on purpose. */
  INVALID_CREDENTIALS: 'Pogrešan email ili lozinka.',
  INVALID_PIN: 'Pogrešan PIN. Preostalo pokušaja: {fails_left}.',
  ENROL_CODE_INVALID: 'Kod nije ispravan ili je istekao. Traži novi od vlasnika.',

  // -- Lockout ---------------------------------------------------------------
  LOCKED: 'PIN je zaključan. Pokušaj ponovo za {retry_after_s} s.',

  // -- Devices ---------------------------------------------------------------
  NO_DEVICE: 'Ovaj uređaj nije prijavljen. Unesi kod za prijavu uređaja.',
  DEVICE_REVOKED: 'Uređaj je odjavljen ili zaključan. Javi se vlasniku.',
  DEVICE_MISMATCH: 'Prijava ne pripada ovom uređaju. Prijavi se ponovo.',
  DEVICE_ALREADY_REVOKED: 'Uređaj je već odjavljen.',
  DEVICE_NOT_LOCKED: 'Uređaj nije zaključan.',
  DEVICE_NOT_FOUND: 'Uređaj nije pronađen.',
  BOUND_USER_REQUIRED: 'Za lični telefon izaberi čiji je.',

  // -- Sessions --------------------------------------------------------------
  NO_SESSION: 'Nisi prijavljen.',
  SESSION_REVOKED: 'Prijava je istekla. Prijavi se ponovo.',

  /**
   * Thrown by `assertNoPendingOutbox` in `services/devices.ts` (§6.6), which is
   * WP1's file — so the sentence lives in WP1's fragment, beside the throw. WP2
   * and WP4 call it through `contracts.ts` and need no message of their own.
   */
  PENDING_OUTBOX: 'Telefon još nije poslao sve ture. Sačekaj da se sinhronizuje.',

  // -- The PIN rules ---------------------------------------------------------
  ADMIN_DEVICE_ONLY: 'Vlasnik se PIN-om prijavljuje samo na svom telefonu.',
  NOT_YOUR_DEVICE: 'Ovo je tuđi telefon. Potvrdi da ga posuđuješ.',
  NO_PIN: 'Nemaš postavljen PIN. Traži od vlasnika da ti ga postavi.',
  USER_NOT_ACTIVE: 'Ovaj korisnik više nije aktivan.',
  PIN_LENGTH: 'PIN mora imati 4 ili 6 cifara.',
  USER_NOT_FOUND: 'Korisnik nije pronađen.',
} as const
