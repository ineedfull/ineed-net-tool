<script setup>
import {
  computed,
  onActivated,
  onBeforeUnmount,
  onDeactivated,
  onMounted,
  ref,
  watch,
} from "vue";
import { X } from "lucide-vue-next";

const props = defineProps({
  modelValue: { type: String, default: "" },
  variant: { type: String, default: "success" },
});
const emit = defineEmits(["update:modelValue"]);
const hovered = ref(false);
const focused = ref(false);
const active = ref(true);
const visiblePage = ref(document.visibilityState !== "hidden");
const paused = computed(
  () => hovered.value || focused.value || !active.value || !visiblePage.value,
);
let timer;

function stopTimer() {
  clearTimeout(timer);
  timer = undefined;
}
function dismiss() {
  stopTimer();
  emit("update:modelValue", "");
}
function restartTimer() {
  stopTimer();
  // Errors remain available until acknowledged. Give users a full reading
  // interval after hovering, keyboard interaction or returning to the page.
  if (props.modelValue && props.variant === "success" && !paused.value) {
    timer = setTimeout(dismiss, 6000);
  }
}
function visibilityChanged() {
  visiblePage.value = document.visibilityState !== "hidden";
}
function focusOut(event) {
  focused.value = event.currentTarget.contains(event.relatedTarget);
}
watch(() => [props.modelValue, props.variant, paused.value], restartTimer, {
  immediate: true,
});
watch(
  () => props.modelValue,
  () => {
    if (!props.modelValue) {
      hovered.value = false;
      focused.value = false;
    }
  },
);
onMounted(() =>
  document.addEventListener("visibilitychange", visibilityChanged),
);
onActivated(() => {
  active.value = true;
});
onDeactivated(() => {
  active.value = false;
  hovered.value = false;
  focused.value = false;
  stopTimer();
});
onBeforeUnmount(() => {
  stopTimer();
  document.removeEventListener("visibilitychange", visibilityChanged);
});
</script>

<template>
  <div
    v-if="modelValue"
    :class="['banner', 'feedback-banner', variant]"
    :role="variant === 'error' ? 'alert' : 'status'"
    aria-atomic="true"
    @mouseenter="hovered = true"
    @mouseleave="hovered = false"
    @focusin="focused = true"
    @focusout="focusOut"
  >
    <span class="feedback-banner-text">{{ modelValue }}</span>
    <button
      type="button"
      class="icon-button feedback-banner-close"
      aria-label="关闭提示"
      title="关闭提示"
      @click="dismiss"
    >
      <X :size="16" aria-hidden="true" />
    </button>
  </div>
</template>

<style scoped>
.feedback-banner {
  align-items: flex-start;
}
.feedback-banner-text {
  flex: 1;
  min-width: 0;
  align-self: center;
}
.feedback-banner-close {
  flex: 0 0 auto;
}
.feedback-banner-close:hover {
  background: color-mix(in srgb, currentColor 10%, transparent);
}
</style>
