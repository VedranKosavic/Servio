/**
 * *Zaključi smjenu* — the arithmetic, written once for the server and the screen.
 *
 * The owner's close is a plain subtraction, not a cash count:
 *
 *     Sav prihod − Dnevnica − Otpis − Rashod − Policija − Osoblje
 *       − Plaćanje robe − Plaćanje okusa za nargilu − Plaćanje žara
 *       − Merkator = Za predati
 *
 * The first six are the server's and nobody types them (the owner's call,
 * 16.09.2026): promet, the venue's fixed daily wage, and the four categories
 * marked on the floor — *Otpis*, *Rashod*, *Policija* and *Osoblje* — which
 * come off the night by themselves, the way *Dnevnica* always has. The other
 * four are what the šanker paid out of the takings and only he can know. The
 * šanker's screen shows a live *Za predati* while he types, and the server
 * stores its own — both call `zaPredati`, so the number he saw is the number
 * that was written. It may be negative, and nothing here hides that.
 */

export interface ClosingAmounts {
  prihod_fen: number
  dnevnica_fen: number
  otpis_fen: number
  rashod_fen: number
  policija_fen: number
  osoblje_fen: number
  roba_fen: number
  okusi_fen: number
  zar_fen: number
  merkator_fen: number
}

/**
 * The four amounts the šanker types, in the order the screen asks for them.
 *
 * *Rashod* left this list on 16.09.2026: it is marked on the table it was drunk
 * at, so the server counts it like *Otpis* and typing it again would subtract
 * it twice.
 */
export const TYPED_KEYS = ['roba_fen', 'okusi_fen', 'zar_fen', 'merkator_fen'] as const
export type TypedKey = (typeof TYPED_KEYS)[number]

/** Every subtracted line, in order, with its Bosnian label. */
export const CLOSING_LINES: { key: Exclude<keyof ClosingAmounts, 'prihod_fen'>, label: string }[] = [
  { key: 'dnevnica_fen', label: 'Dnevnica' },
  { key: 'otpis_fen', label: 'Otpis' },
  { key: 'rashod_fen', label: 'Rashod' },
  { key: 'policija_fen', label: 'Policija' },
  { key: 'osoblje_fen', label: 'Osoblje' },
  { key: 'roba_fen', label: 'Plaćanje robe' },
  { key: 'okusi_fen', label: 'Plaćanje okusa za nargilu' },
  { key: 'zar_fen', label: 'Plaćanje žara' },
  { key: 'merkator_fen', label: 'Merkator' },
]

/** `prihod − everything else`, in feninga. Integers in, an integer out. */
export function zaPredati(a: ClosingAmounts): number {
  return a.prihod_fen
    - a.dnevnica_fen
    - a.otpis_fen
    - a.rashod_fen
    - a.policija_fen
    - a.osoblje_fen
    - a.roba_fen
    - a.okusi_fen
    - a.zar_fen
    - a.merkator_fen
}
