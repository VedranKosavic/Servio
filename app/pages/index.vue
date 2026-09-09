<script setup lang="ts">
/**
 * The start screen: who is holding this phone?
 *
 * There is no login yet — the phone says who it is and the server believes it
 * (PLAN.md §5 "Auth" is a later step). So this screen has one job: put a role
 * and a name into the session store, which every other screen reads.
 *
 * The choice survives a reload because the session lives in localStorage, which
 * is also why the whole screen is wrapped in `<ClientOnly>`: the server has no
 * way of knowing whether Amar already picked himself an hour ago.
 */
import type { Role, User } from '#shared/types'

useHead({ title: 'Ko si?' })

const session = useSessionStore()
const { data: boot, status, refresh } = useBootstrapData()

/** Which role's name list is open; null means the two big buttons are showing. */
const picking = ref<Role | null>(null)
/** Set when the waiter taps "Promijeni" — hides the "Nastavi kao …" shortcut. */
const changing = ref(false)

const waiters = computed(() => boot.value?.users.filter(u => u.role === 'waiter') ?? [])
const bartenders = computed(() => boot.value?.users.filter(u => u.role === 'bartender') ?? [])

const ROLE_LABEL: Record<Role, string> = {
  waiter: 'konobar',
  bartender: 'šanker',
  owner: 'vlasnik',
}

const showContinue = computed(() => session.isSet && !changing.value && !picking.value)

function openRole(role: Role) {
  const people = role === 'waiter' ? waiters.value : bartenders.value
  // One bartender is the normal case in this café: asking "which one?" of a
  // list of one is a tap for nothing.
  if (role === 'bartender' && people.length === 1) {
    choose(role, people[0]!)
    return
  }
  picking.value = role
}

function choose(role: Role, user: User) {
  session.choose(role, user)
  navigateTo(role === 'bartender' ? '/s' : '/k')
}

function goHome() {
  navigateTo(session.home)
}
</script>

<template>
  <main class="mx-auto flex w-full max-w-[480px] flex-1 flex-col justify-center gap-8 py-10">
    <div class="text-center">
      <h1 class="text-5xl font-extrabold tracking-tight">
        Šank
      </h1>
    </div>

    <ClientOnly>
      <!-- Already chosen: one tap back into the shift -->
      <div v-if="showContinue" class="flex flex-col gap-3">
        <button type="button" class="btn btn-accent h-16 text-xl" @click="goHome">
          Nastavi kao {{ session.state.name }} ({{ ROLE_LABEL[session.state.role!] }})
        </button>
        <button type="button" class="btn btn-ghost" @click="changing = true">
          Promijeni
        </button>
      </div>

      <div v-else-if="status === 'error'" class="flex flex-col gap-3 text-center">
        <p class="text-danger">
          Nema veze sa serverom.
        </p>
        <button type="button" class="btn" @click="refresh()">
          Pokušaj ponovo
        </button>
      </div>

      <!-- Waiting for the staff list -->
      <p v-else-if="!boot" class="text-center text-text-2">
        Učitavanje…
      </p>

      <!-- Pick a name -->
      <div v-else-if="picking" class="flex flex-col gap-3">
        <h2 class="text-center text-2xl font-semibold">
          {{ picking === 'waiter' ? 'Koji konobar?' : 'Koji šanker?' }}
        </h2>
        <button
          v-for="person in (picking === 'waiter' ? waiters : bartenders)"
          :key="person.id"
          type="button"
          class="btn h-16 text-xl"
          @click="choose(picking!, person)"
        >
          {{ person.name }}
        </button>
        <button type="button" class="btn btn-ghost" @click="picking = null">
          Nazad
        </button>
      </div>

      <!-- Pick a role -->
      <div v-else class="flex flex-col gap-3">
        <h2 class="text-center text-2xl font-semibold">
          Ko si?
        </h2>
        <button type="button" class="btn btn-accent h-16 text-xl" @click="openRole('waiter')">
          Konobar
        </button>
        <button type="button" class="btn h-16 text-xl" @click="openRole('bartender')">
          Šanker
        </button>
      </div>

      <template #fallback>
        <p class="text-center text-text-2">
          Učitavanje…
        </p>
      </template>
    </ClientOnly>
  </main>
</template>
