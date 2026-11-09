<script setup>
import { computed } from "vue";
const props = defineProps({ total: Number, page: Number, size: { type: Number, default: 100 } });
const emit = defineEmits(["update:page"]);
const pages = computed(() => Math.max(1, Math.ceil(props.total / props.size)));
</script>
<template>
  <div v-if="total > size" class="scan-grid-toolbar result-pagination" aria-label="结果分页">
    <span class="muted">共 {{ total.toLocaleString() }} 条 · 每页 {{ size }} 条</span>
    <div class="actions">
      <button :disabled="page <= 1" @click="emit('update:page', page - 1)">上一页</button>
      <label class="scan-block-label">页码<select :value="page" aria-label="结果页码" @change="emit('update:page', Number($event.target.value))">
        <option v-for="p in pages" :key="p" :value="p">{{ p }} / {{ pages }}</option>
      </select></label>
      <button :disabled="page >= pages" @click="emit('update:page', page + 1)">下一页</button>
    </div>
  </div>
</template>
