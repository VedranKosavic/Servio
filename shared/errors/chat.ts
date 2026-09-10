/**
 * WP0 owns this fragment: *Razgovor* and the image pipeline (PHASE4 §2.5, §2.6).
 *
 * Every sentence says what happened **and** what to do instead, and none of them
 * blames anybody — a waiter reading one of these at 23:40 should know his next
 * tap, not feel accused. `tests/unit/errors.test.ts` fails on a code with no
 * sentence here and on a sentence nobody throws.
 */
export const CHAT_ERRORS = {
  // -- Access ---------------------------------------------------------------
  CHANNEL_FORBIDDEN: 'Ovaj kanal nije dostupan.',
  CHANNEL_NOT_FOUND: 'Taj kanal ne postoji.',
  MESSAGE_NOT_FOUND: 'Ta poruka ne postoji.',
  MUTED: 'Vlasnik te utišao do {until_time}.',

  // -- Slanje ---------------------------------------------------------------
  BODY_EMPTY: 'Poruka je prazna.',
  BODY_TOO_LONG: 'Poruka je preduga — skrati je.',
  UPLOAD_NOT_YOURS: 'Ta slika nije tvoja.',
  REPLY_CROSS_CHANNEL: 'Odgovor ostaje u svom kanalu — koristi Proslijedi.',
  FORWARD_FORBIDDEN: 'Ovu poruku ne možeš proslijediti u taj kanal.',

  // -- Brisanje i moderacija ------------------------------------------------
  DELETE_FORBIDDEN: 'Ovu poruku ne možeš obrisati.',
  DELETE_WINDOW: 'Prošlo je vrijeme za brisanje svoje poruke.',

  // -- Za naručiti ----------------------------------------------------------
  PIN_TOO_LONG: 'Bilješka je preduga — skrati je.',
  PIN_CLEAR_FORBIDDEN: 'Naručeno označava vlasnik.',

  /**
   * A 500, and it should never be seen: `postSystem` refuses a payload with a
   * `*_fen` key outside *Admini*. A waiter's settlement is a Dnevnik entry for
   * admins, never a chat line (PLAN §8).
   */
  SYSTEM_MONEY_LEAK: 'Greška u aplikaciji — iznos ne ide u ovaj kanal.',

  // -- Slike ----------------------------------------------------------------
  NOT_JPEG: 'Ovaj format ne radi — slikaj iz aplikacije.',
  IMAGE_TOO_BIG: 'Slika je prevelika — slikaj iz aplikacije.',
  KIND_FORBIDDEN: 'Ovu vrstu slike šalje šanker ili vlasnik.',
  USER_CAP: 'Dnevni limit slika — sutra opet.',
  STORAGE_CAP: 'Mjesečni limit slika je pun — javi vlasniku.',
  UPLOAD_NOT_FOUND: 'Ta slika više ne postoji.',
}
