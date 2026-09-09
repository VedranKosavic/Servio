import { defineStore, skipHydrate } from 'pinia'
import { useLocalStorage } from '@vueuse/core'
import type { Role } from '#shared/types'

/**
 * Who is holding this phone: the role picked on the start screen and the person.
 * Kept in localStorage so a reload (or an installed PWA restart) does not ask again.
 * No real login yet — that comes with PIN login in a later step; for now the
 * person is trusted and only used to attribute orders and tickets.
 */
export interface Session {
  role: Role | null
  userId: string | null
  name: string | null
  initials: string | null
}

const EMPTY: Session = { role: null, userId: null, name: null, initials: null }

export const useSessionStore = defineStore('session', () => {
  // skipHydrate: this state comes from the phone's localStorage, never from the
  // server render. Without it Pinia would overwrite the saved session with the
  // empty server value on every reload (and then persist that empty value).
  const state = skipHydrate(useLocalStorage<Session>('sank:session', { ...EMPTY }, { mergeDefaults: true }))

  const isSet = computed(() => !!state.value.role && !!state.value.userId)
  const isWaiter = computed(() => state.value.role === 'waiter')
  const isBartender = computed(() => state.value.role === 'bartender')

  function choose(role: Role, user: { id: string, name: string, initials: string }) {
    state.value = { role, userId: user.id, name: user.name, initials: user.initials }
  }

  function clear() {
    state.value = { ...EMPTY }
  }

  /** Where this role lives: waiters see tables, the bartender sees tickets. */
  const home = computed(() => (state.value.role === 'bartender' ? '/s' : state.value.role === 'waiter' ? '/k' : '/'))

  return { state, isSet, isWaiter, isBartender, home, choose, clear }
})
