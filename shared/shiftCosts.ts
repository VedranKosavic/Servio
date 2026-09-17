/**
 * *Naknadni troškovi* — the kinds of cost an admin can add to a closed shift
 * afterwards (17.09.2026), and the words each one is shown by.
 *
 * Every kind of cost the app already knows, so a bill that was paid out of
 * Tuesday's takings on Wednesday is named the way it would have been named on
 * the night: the šanker's payouts, the day wage, the monthly bills, and *Ostalo*
 * for anything else, which then needs its own name.
 */
export const SHIFT_COST_KINDS = [
  'roba', 'okusi', 'zar', 'kafa', 'merkator', 'dnevnica', 'struja', 'voda', 'kirija', 'ostalo',
] as const
export type ShiftCostKind = (typeof SHIFT_COST_KINDS)[number]

export const SHIFT_COST_LABELS: Record<ShiftCostKind, string> = {
  roba: 'Prijem robe (plaćanje robe)',
  okusi: 'Okusi za nargilu',
  zar: 'Žar',
  kafa: 'Kafa',
  merkator: 'Merkator',
  dnevnica: 'Dnevnica',
  struja: 'Struja',
  voda: 'Voda',
  kirija: 'Kirija',
  ostalo: 'Ostalo',
}

/** How one cost reads on *Kasa*: its own name ("Faktura 17.09.2026."), the kind's otherwise. */
export function shiftCostText(cost: { kind: ShiftCostKind, label: string | null }): string {
  return cost.label ? cost.label : SHIFT_COST_LABELS[cost.kind]
}
