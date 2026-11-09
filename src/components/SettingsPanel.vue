<script setup>
import FeedbackBanner from "./FeedbackBanner.vue";
import { computed, reactive, ref, watch } from "vue";
import { Check, LoaderCircle } from "lucide-vue-next";
import DesktopDialog from "./DesktopDialog.vue";

const props = defineProps({
  settings: Object,
  saveSettings: Function,
  desktop: Boolean,
});
const emit = defineEmits(["close", "preview"]);
const draft = reactive({ ...props.settings });
const busy = ref(false);
const error = ref("");
const discardRequested = ref(false);
const dirty = computed(
  () =>
    draft.theme !== props.settings.theme ||
    draft.largeFont !== props.settings.largeFont ||
    draft.ipView !== props.settings.ipView,
);
watch(draft, () => {
  discardRequested.value = false;
  emit("preview", { ...draft });
});

function requestClose() {
  if (busy.value) return;
  if (dirty.value) discardRequested.value = true;
  else emit("close");
}
async function save() {
  if (busy.value) return;
  busy.value = true;
  discardRequested.value = false;
  error.value = "";
  try {
    await props.saveSettings({ ...draft });
    emit("close");
  } catch (reason) {
    error.value = reason.message;
  } finally {
    busy.value = false;
  }
}
</script>

<template>
  <DesktopDialog
    class="settings-panel"
    title="设置"
    title-id="settings-title"
    :busy="busy"
    @close="requestClose"
  >
    <form class="settings-form" @submit.prevent="save">
      <div class="dialog-body settings-body">
      <fieldset :disabled="busy">
        <section class="settings-section">
          <h3>显示设置</h3>
          <div class="setting-row">
            <div>
              <label for="theme-select">主题</label>
              <p class="muted">选择浅色、深色或跟随系统。</p>
            </div>
            <select id="theme-select" v-model="draft.theme" aria-label="主题">
              <option value="light">浅色</option>
              <option value="dark">深色</option>
              <option value="system">跟随系统</option>
            </select>
          </div>
          <div class="setting-row">
            <div>
              <label for="large-font">大字模式</label>
              <p class="muted">同步放大正文、控件、IP 地址和诊断数据。</p>
            </div>
            <input
              id="large-font"
              v-model="draft.largeFont"
              class="toggle"
              type="checkbox"
              aria-label="大字模式"
            />
          </div>
          <div class="setting-row">
            <div>
              <label for="default-scan-view">IP 默认显示方式</label>
              <p class="muted">
                用于探测、网段地址和项目台账，各页面均可随时切换。
              </p>
            </div>
            <select
              id="default-scan-view"
              v-model="draft.ipView"
              aria-label="IP 默认显示方式"
            >
              <option value="table">表格</option>
              <option value="compact">紧凑网格</option>
            </select>
          </div>
          <div class="type-preview" aria-label="字号预览">
            <span>网络数据预览</span
            ><code>192.168.1.10 <span>·</span> 24.60 ms</code>
          </div>
        </section>
        <section class="settings-section">
          <h3>本地数据</h3>
          <p class="muted">
            {{
              desktop
                ? "项目、IP 台账、维护与诊断记录保存在本应用独立的 SQLite 数据库。"
                : "当前规划保存在此浏览器中，与桌面应用的数据独立。"
            }}
          </p>
          <dl class="settings-details">
            <div>
              <dt>诊断记录</dt>
              <dd>最近 100 次任务</dd>
            </div>
            <div>
              <dt>Ping 明细</dt>
              <dd>每次最近 500 条，统计覆盖全部请求</dd>
            </div>
          </dl>
          <p class="hint">
            桌面版可在项目工作台导出 Excel
            台账，也可下载模板后填写并导入。诊断明细单独导出 JSON；最近 100
            次任务为所有项目合计。
          </p>
        </section>
        <FeedbackBanner v-model="error" variant="error" />
      </fieldset>
      </div>
      <div v-if="discardRequested" class="settings-discard" role="alert">
        <span>设置尚未保存，要放弃本次修改吗？</span
        ><button
          type="button"
          :disabled="busy"
          @click="discardRequested = false"
        >
          继续编辑</button
        ><button
          type="button"
          class="danger"
          :disabled="busy"
          @click="emit('close')"
        >
          放弃修改
        </button>
      </div>
      <footer class="dialog-footer">
        <span class="muted">{{
          dirty ? "预览已应用，保存后下次启动生效" : "外观与同系列工具保持一致"
        }}</span
        ><button type="button" :disabled="busy" @click="requestClose">
          取消</button
        ><button class="primary" type="submit" :disabled="busy || !dirty">
          <LoaderCircle v-if="busy" :size="14" class="spin" /><Check
            v-else
            :size="14"
          />{{ busy ? "正在保存…" : "保存设置" }}
        </button>
      </footer>
    </form>
  </DesktopDialog>
</template>
