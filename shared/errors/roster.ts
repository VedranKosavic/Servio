/**
 * *Raspored* i šabloni smjena.
 *
 * The roster is one weekly pattern with at most two people per shift, so the
 * refusals are about a cell: it is full, the person is already in it, or the
 * person or the template is no longer active.
 */
export const ROSTER_ERRORS = {
  TEMPLATE_NOT_FOUND: 'Taj šablon smjene ne postoji.',
  TEMPLATE_EXISTS: 'Šablon s tim nazivom već postoji.',
  TEMPLATE_NOT_ACTIVE: 'Taj šablon smjene više nije aktivan.',

  // -- Ćelija ---------------------------------------------------------------
  PATTERN_NOT_FOUND: 'Ta osoba više nije u rasporedu.',
  SHIFT_FULL: 'U ovoj smjeni su već dvije osobe.',
  ALREADY_IN_SHIFT: 'Ta osoba je već u ovoj smjeni.',
}
