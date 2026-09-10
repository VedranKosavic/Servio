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
  /**
   * Since the PIN identifies the person there is no longer a "wrong PIN for
   * *this* name" — the digits either belong to somebody active in this venue or
   * they belong to nobody. One sentence covers both, which is also the only
   * honest one: naming which half was wrong would be a name the pad never asked
   * for.
   */
  INVALID_PIN: 'PIN nije prepoznat. Preostalo pokušaja: {fails_left}.',
  ENROL_CODE_INVALID: 'Kod nije ispravan ili je istekao. Traži novi od vlasnika.',

  // -- Lockout ---------------------------------------------------------------
  LOCKED: 'PIN je zaključan. Pokušaj ponovo za {retry_after_s} s.',

  // -- Devices ---------------------------------------------------------------
  NO_DEVICE: 'Ovaj uređaj nije prijavljen. Unesi kod za prijavu uređaja.',
  DEVICE_REVOKED: 'Uređaj je odjavljen ili zaključan. Javi se vlasniku.',
  DEVICE_MISMATCH: 'Prijava ne pripada ovom uređaju. Prijavi se ponovo.',
  DEVICE_ALREADY_REVOKED: 'Uređaj je već odjavljen.',
  // `DEVICE_NOT_LOCKED` stood here — 'Uređaj nije zaključan.' — and it was the
  // 409 *Otključaj* answered when `devices.locked_at` was null. It refused the
  // two locks that never write that column: the 60-second step at five failures
  // and the 15-minute one at ten are counted in `auth_attempts`, not flagged, so
  // the owner's only key answered "not locked" to a tablet nobody could type on.
  // `unlockDevice` clears the counter unconditionally now, the sentence had no
  // thrower left, and `errors.test.ts` fails on those.
  DEVICE_NOT_FOUND: 'Uređaj nije pronađen.',
  BOUND_USER_REQUIRED: 'Za lični telefon izaberi čiji je.',

  // -- Sessions --------------------------------------------------------------
  NO_SESSION: 'Nisi prijavljen.',
  SESSION_REVOKED: 'Prijava je istekla. Prijavi se ponovo.',

  // `PENDING_OUTBOX` was written here too, beside the `assertNoPendingOutbox`
  // throw in `services/devices.ts`. WP2 wrote it in `errors/shifts.ts` as well,
  // and `SHIFT_ERRORS` is spread after `AUTH_ERRORS`, so that is the sentence a
  // phone actually shows. One code, one sentence: WP2's is the one that ships.

  // -- The PIN rules ---------------------------------------------------------
  ADMIN_DEVICE_ONLY: 'Vlasnik se PIN-om prijavljuje samo na svom telefonu.',
  // `NO_PIN` stood here — 'Nemaš postavljen PIN…' — for the person the lock
  // screen offered before an admin had given him any digits. The pad offers
  // nobody now, so there is no such tap: a person with `pin_hash NULL` is simply
  // not among the candidates the typed digits are compared against, and what he
  // gets is the same `INVALID_PIN` as a stranger. Naming his situation would
  // answer, to whoever is holding the phone, a question the pad refused to ask.
  // The sentence had no thrower left, and `errors.test.ts` fails on those.
  USER_NOT_ACTIVE: 'Ovaj korisnik više nije aktivan.',
  PIN_LENGTH: 'PIN mora imati 4 ili 6 cifara.',
  /**
   * Two people with one PIN is a PIN that identifies neither, so the create-user
   * and reset-PIN routes refuse it. Deactivated people do not hold a PIN
   * against anybody — their rows stay for the history, not for the lock screen.
   */
  PIN_TAKEN: 'Taj PIN već koristi neko drugi. Izaberi drugi.',
  /**
   * The other half of the same rule. Unique digits are not enough while the
   * lengths differ: the pad fires on a fixed number of taps, so a six-digit PIN
   * whose first four are somebody else's would sign that somebody else in on the
   * fourth tap. One length per venue makes that unreachable.
   */
  PIN_LEN_MIXED: 'Svi PIN-ovi u lokalu moraju imati isti broj cifara.',
  /** Belt and braces: the pad must never guess which of two people typed. */
  PIN_AMBIGUOUS: 'Taj PIN koristi više osoba. Javi se vlasniku.',

  // `NOT_YOUR_DEVICE` stood here until the PIN started identifying the person.
  // It was the 403 that a colleague had to answer with `borrow: true` before the
  // pad would let him onto somebody else's phone — but the pad no longer asks
  // *who*, so there is nothing to answer it with. The server marks the session
  // `borrowed` itself (two hours, not fourteen) the moment the PIN resolves to
  // somebody who is not this phone's owner. The property survived; the sentence
  // had nothing left to say.
  //
  // `USER_NOT_FOUND` went the same way as `PENDING_OUTBOX` above, and for the
  // same reason. It was written here ('Korisnik nije pronađen.') and in
  // `errors/money.ts` ('Ta osoba ne postoji.'); `MONEY_ERRORS` is spread after
  // `AUTH_ERRORS`, so WP3's sentence is the one every phone has ever shown.
  // WP8 deleted this copy rather than the shipping one — seven services across
  // five packages throw this code, most of them about picking a colleague
  // ("izaberi kome dajes pazar"), and 'Ta osoba ne postoji.' is the sentence
  // that reads right in all of them. `errors.test.ts` now fails on any code
  // defined in two fragments, so the next one of these is caught the same day.
} as const
