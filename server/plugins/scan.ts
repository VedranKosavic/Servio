/**
 * `SANK_SCAN_STUB=1` — the deterministic model, installed once at boot.
 *
 * It exists for exactly one reason: the verification run (PHASE4 §5) has to
 * walk *Prijem sa slike* end to end on a fresh database, and it must cost
 * nothing and never call the API. The stub returns a fixed eight-line
 * otpremnica — six green, one amber, one unknown — against whatever catalogue
 * the venue has.
 *
 * It is read **once, here**, and is never true in production: `/opt/sank/.env`
 * does not set it, the same way it does not set `SANK_DEV_ENROL`.
 */
import { setScanModel, stubScanModel } from '../services/scan'

export default defineNitroPlugin(() => {
  if (process.env.SANK_SCAN_STUB !== '1') return
  setScanModel(stubScanModel())
  console.info('[sank] SANK_SCAN_STUB=1 — prijem sa slike koristi lažni model')
})
