/**
 * WP0 owns this fragment: *Raspored*, zamjene i šabloni (PHASE4 §2.7).
 *
 * Two of these are refusals with an override and one is a refusal without one,
 * and the wording says which: *Dupla smjena* offers a retry, *preklapaju se*
 * does not, because one person cannot be in two places at once.
 */
export const ROSTER_ERRORS = {
  ASSIGNMENT_NOT_FOUND: 'Ta smjena ne postoji.',
  TEMPLATE_NOT_FOUND: 'Taj šablon smjene ne postoji.',
  TEMPLATE_EXISTS: 'Šablon s tim nazivom već postoji.',

  // -- Sedmica --------------------------------------------------------------
  WEEK_NOT_EMPTY: 'Ova sedmica već ima raspored.',
  ALREADY_PUBLISHED: 'Raspored za ovu sedmicu je već objavljen.',

  // -- Ćelija ---------------------------------------------------------------
  OVERLAP: 'Ta osoba već radi smjenu koja se preklapa tog dana.',
  DOUBLE_SHIFT: 'Dupla smjena — potvrdi ako je namjerno.',
  ROSTER_LOCKED: 'Prošli dani se ne mijenjaju.',
  PAST_LOCKED: 'Za prošli dan se može označiti samo "nije došao" ili bolovanje.',

  // -- Zamjene --------------------------------------------------------------
  NOT_YOUR_ROW: 'Zamjena se traži za svoju smjenu.',
  NOT_YOUR_SWAP: 'Ova zamjena je ponuđena nekom drugom.',
  SWAP_NOT_FOUND: 'Ta zamjena ne postoji.',
  SWAP_EXISTS: 'Za ovu smjenu već je tražena zamjena.',
  SAME_PERSON: 'Smjenu ne možeš predati sam sebi.',
}
