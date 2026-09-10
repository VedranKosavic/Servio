<script setup lang="ts">
/**
 * *Sa slike* — the second way to book a delivery (PHASE4 WP3, PLAN §9 F8).
 *
 * Four states, and each one is a whole screen rather than a spinner:
 *
 * 1. **empty** — *Slikaj otpremnicu* (the phone's camera) and *Galerija* (a file
 *    the owner already has on the laptop). Both are the same `<input type="file"
 *    accept="image/*">`; only the first carries `capture="environment"`, which is
 *    what makes a phone open the camera instead of the file browser. The native
 *    camera needs no permission dialog of ours.
 * 2. **waiting** — "Čitam sliku…", said honestly: a model reading a photograph
 *    takes seconds, not milliseconds, and a bar of dots that pretends otherwise
 *    is how somebody ends up taking the picture twice.
 * 3. **draft** — `RobaScanDraft`, the editable otpremnica.
 * 4. **not configured** — a calm card and the typed form beneath it. A venue with
 *    no `ANTHROPIC_API_KEY` is a supported venue, not a broken one; there is no
 *    stack trace, no retry loop and no English.
 */
import type { StockItemAdmin } from '#shared/types'

defineProps<{ items: StockItemAdmin[] }>()

const emit = defineEmits<{
  posted: []
  catalogue: []
  /** The venue has no key — the page opens *Ručno* beneath the card. */
  fallback: []
}>()

// Destructured on purpose: a ref unwraps in a template only when it is a
// top-level binding of `<script setup>`, so this is what lets the markup below
// read `stage` and `draft` instead of `scan.stage.value`.
const { stage, draft, error, preview, busy, waitText, fromFile, discard, reset } = useScan()

const cameraInput = ref<HTMLInputElement | null>(null)
const galleryInput = ref<HTMLInputElement | null>(null)
const okText = ref('')

async function onPick(event: Event) {
  const input = event.target as HTMLInputElement
  const file = input.files?.[0]
  // The input is cleared either way, so picking the same file twice still fires.
  input.value = ''
  if (!file) return
  okText.value = ''
  await fromFile(file)
  if (stage.value === 'not-configured') emit('fallback')
}

function onPosted() {
  okText.value = 'Prijem je proknjižen. Sken je zatvoren.'
  reset()
  emit('posted')
}

async function onDiscard(reason: string) {
  try {
    await discard(reason)
    okText.value = 'Sken je odbačen. Slika se briše u toku sata.'
  } catch (err) {
    error.value = apiErrorText(err)
  }
}
</script>

<template>
  <RobaScanDraft
    v-if="stage === 'draft' && draft"
    :draft="draft"
    :items="items"
    @posted="onPosted"
    @discard="onDiscard"
    @catalogue="emit('catalogue')"
  />

  <UiCard v-else title="Prijem sa slike" :count="stage === 'not-configured' ? 'nije podešeno' : ''">
    <template v-if="stage === 'not-configured'">
      <p class="a-off">
        Prepoznavanje sa slike nije podešeno. Unesi prijem ručno.
      </p>
      <p class="a-muted">
        Sve ostalo radi kao i do sada — forma ispod knjiži prijem isto kao i ranije.
      </p>
    </template>

    <template v-else-if="busy">
      <div class="a-wait">
        <RobaScanFoto v-if="preview" :src="preview" alt="Otpremnica" />
        <p class="a-wait-text">{{ waitText }}</p>
        <p class="a-muted">Ne zatvaraj stranicu.</p>
      </div>
    </template>

    <template v-else>
      <p class="a-muted">
        Slikaj otpremnicu i dobiješ nacrt prijema koji ispraviš prije knjiženja.
        Ništa se ne knjiži dok ne pritisneš Proknjiži.
      </p>

      <div class="a-acts">
        <UiButton variant="primary" @click="cameraInput?.click()">Slikaj otpremnicu</UiButton>
        <UiButton variant="soft" @click="galleryInput?.click()">Galerija</UiButton>
      </div>

      <!-- `capture="environment"` is the whole difference between the two: it
           asks a phone for the back camera. A laptop ignores it and shows the
           file browser, which is the right thing there. -->
      <input
        ref="cameraInput"
        class="a-file"
        type="file"
        accept="image/*"
        capture="environment"
        @change="onPick"
      >
      <input ref="galleryInput" class="a-file" type="file" accept="image/*" @change="onPick">

      <p v-if="okText" class="a-ok">{{ okText }}</p>
      <p v-if="error" class="a-error">{{ error }}</p>
    </template>
  </UiCard>
</template>

<style scoped>
.a-muted { margin: 0; color: var(--muted); font-size: 13px; }
.a-error { margin: 0; color: var(--danger); font-size: 14px; }
.a-ok { margin: 0; color: var(--good); font-size: 14px; }

.a-off {
  margin: 0;
  padding: 12px;
  border: 1px solid var(--line);
  border-radius: 10px;
  background: var(--bg);
  font-size: 15px;
  font-weight: 600;
}

.a-acts { display: flex; gap: 12px; flex-wrap: wrap; }

/* The two buttons are what the owner sees; these inputs are the real file
   pickers and are clicked from script. Hidden with size and opacity rather than
   `display: none`, which some browsers refuse to open a camera from. */
.a-file { position: absolute; width: 1px; height: 1px; opacity: 0; pointer-events: none; }

.a-wait { display: flex; flex-direction: column; gap: 10px; max-width: 420px; }
.a-wait-text { margin: 0; font-size: 16px; font-weight: 600; }

@media (max-width: 1023px) {
  .a-acts > .a-btn { flex-grow: 1; }
}
</style>
