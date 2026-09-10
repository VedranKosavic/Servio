/**
 * *Razgovor* — the shapes `server/services/chat.ts` answers with (PHASE4 §2.5).
 *
 * One rule shows up in every type here: a channel a role may not see never
 * reaches the wire at all. `ChatSince.channels` is built from `canSee`, not
 * filtered afterwards, and there is no field anywhere below that a screen would
 * have to remember to hide.
 */
import type { ChannelKind } from '../chat'

export type ChatMessageKind = 'text' | 'image' | 'system'

/** The 48 px secondary button a system line may carry. Never an action of its own. */
export interface SystemLink {
  label: string
  route: string
}

export interface SystemPayload {
  link?: SystemLink
  [key: string]: unknown
}

export interface ChatImage {
  upload_id: string
  /** `GET /api/uploads/:id`. Access-checked on every request, 404 when refused. */
  url: string
  width: number
  height: number
  /** The file is gone (retention or the GC); the message stays and says so. */
  expired: boolean
}

export interface ChatMessage {
  id: string
  client_id: string
  channel: ChannelKind
  seq: number
  kind: ChatMessageKind
  body: string | null
  image: ChatImage | null
  author_id: string | null
  author_name: string | null
  author_initials: string | null
  reply_to_id: string | null
  /** The quoted first line, rendered server-side — never the whole message. */
  reply_preview: string | null
  forwarded_from_id: string | null
  system_key: string | null
  system_payload: SystemPayload | null
  at: string
  /** Set means the bubble is a placeholder: who removed it and when, never the text. */
  deleted_at: string | null
  deleted_by_name: string | null
}

/** One room, as the channel list draws it. */
export interface ChatChannelView {
  id: string
  kind: ChannelKind
  name: string
  /** Only `text` and `image` count: a system line is never a badge. */
  unread: number
  last_seq: number
  /** The last human line, one row of it. */
  preview: string | null
  preview_at: string | null
  pinned_text: string | null
  pinned_at: string | null
  /** Everyone the matrix admits, by name — the room is visible to the people in it. */
  members: string[]
}

/**
 * `GET /api/chat/since?cursor=`.
 *
 * `reset` is the honest answer when a phone is more than 1000 messages behind:
 * re-bootstrap rather than paint a partial thread over a stale one.
 */
export interface ChatSince {
  cursor: number
  channels: ChatChannelView[]
  messages: ChatMessage[]
  has_more: boolean
  reset?: true
  /** `chat_muted_until` for the caller, when it is in the future. */
  muted_until?: string | null
}

/** `GET /api/chat/:channel/messages?before_seq=` — *Učitaj starije*, backwards. */
export interface ChatPage {
  messages: ChatMessage[]
  has_more: boolean
}

export interface PostMessageResult {
  message: ChatMessage
  cursor: number
  /** A replayed `client_id`: 200 with the stored row, never a 409. */
  already_applied: boolean
}

/** The badge snapshot `GET /api/changes` carries — the whole of "one poll". */
export interface ChatChangesSnapshot {
  max_seq: number
  total_unread: number
  channels: Array<{ kind: ChannelKind, unread: number, last_seq: number }>
}

export interface UploadResult {
  id: string
  url: string
  width: number
  height: number
  bytes: number
}
