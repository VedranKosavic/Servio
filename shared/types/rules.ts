/**
 * *Pravila* — versioned house rules with acknowledgements (PHASE4 §2.8).
 *
 * `must_ack` is a **client** rule and nothing else. Nothing on the server 403s
 * an order because a waiter has not read v3: refusing to record a round the
 * guest is already drinking would put money outside the ledger, which is the one
 * thing this app exists to prevent. The gate is the S12 screen standing in front
 * of S1 at the next login, and the evidence is the `rules_acked` entry.
 */
export interface RulesView {
  /** 0 when nothing has ever been published. */
  version: number
  body_md: string
  published_at: string | null
  published_by_name: string | null
  /** The reader's own acknowledgement, or 0. */
  my_ack_version: number
  my_ack_at: string | null
  must_ack: boolean
}

export interface RuleAck {
  user_id: string
  user_name: string
  version: number | null
  at: string | null
}

export interface RuleVersion {
  id: string
  version: number
  body_md: string
  published_at: string
  published_by_name: string | null
  /**
   * Who has acknowledged this version, and when — the one screen in the app
   * where a per-person list is not surveillance but the record that the rules
   * were read. Present on the current version only.
   */
  acks?: RuleAck[]
}
