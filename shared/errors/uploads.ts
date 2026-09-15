/**
 * The image pipeline (PHASE4 §2.6). These sentences lived in the chat fragment
 * until *Razgovor* was removed; the delivery photo still needs them.
 *
 * Every sentence says what happened **and** what to do instead.
 * `tests/unit/errors.test.ts` fails on a code with no sentence here and on a
 * sentence nobody throws.
 */
export const UPLOAD_ERRORS = {
  NOT_JPEG: 'Ovaj format ne radi — slikaj iz aplikacije.',
  IMAGE_TOO_BIG: 'Slika je prevelika — slikaj iz aplikacije.',
  KIND_FORBIDDEN: 'Ovu vrstu slike šalje vlasnik.',
  USER_CAP: 'Dnevni limit slika — sutra opet.',
  UPLOAD_NOT_FOUND: 'Ta slika više ne postoji.',
}
