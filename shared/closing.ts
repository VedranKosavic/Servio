/**
 * *Zaključi smjenu* — the arithmetic, written once for the server and the screen.
 *
 * The owner's close is a plain subtraction, not a cash count:
 *
 *     Sav prihod − Dnevnica − Otpis − Rashod − Plaćanje robe
 *       − Plaćanje okusa za nargilu − Plaćanje žara − Merkator = Za predati
 *
 * The first three are the server's (promet, the venue's fixed daily wage, the
 * shift's otpis at menu price); the other five are what the šanker typed. The
 * šanker's screen shows a live *Za predati* while he types, and the server
 * stores its own — both call `zaPredati`, so the number he saw is the number
 * that was written. It may be negative, and nothing here hides that.
 */

export interface ClosingAmounts {
  prihod_fen: number
  dnevnica_fen: number
  otpis_fen: number
  rashod_fen: number
  roba_fen: number
  okusi_fen: number
  zar_fen: number
  merkator_fen: number
}

/** The five amounts the šanker types, in the order the screen asks for them. */
export const TYPED_KEYS = ['rashod_fen', 'roba_fen', 'okusi_fen', 'zar_fen', 'merkator_fen'] as const
export type TypedKey = (typeof TYPED_KEYS)[number]

/** Every subtracted line, in order, with its Bosnian label. */
export const CLOSING_LINES: { key: Exclude<keyof ClosingAmounts, 'prihod_fen'>, label: string }[] = [
  { key: 'dnevnica_fen', label: 'Dnevnica' },
  { key: 'otpis_fen', label: 'Otpis' },
  { key: 'rashod_fen', label: 'Rashod' },
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
    - a.roba_fen
    - a.okusi_fen
    - a.zar_fen
    - a.merkator_fen
}
