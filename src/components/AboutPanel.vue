<script setup>
import { ref } from "vue";
import { runtime } from "../runtime.js";
import DesktopDialog from "./DesktopDialog.vue";
import icon from "../assets/icon.svg";
import { version } from "../../package.json";

defineProps({ desktop: Boolean });
const emit = defineEmits(["close"]);
const website = "https://nettool.ineedfull.com/";
const websiteError = ref("");
async function openWebsite(event) {
  if (!runtime.openWebsite) return;
  event.preventDefault();
  websiteError.value = "";
  try { await runtime.openWebsite(); }
  catch { websiteError.value = "无法打开浏览器，请复制官网地址后访问。"; }
}
</script>

<template>
  <DesktopDialog
    class="about-panel"
    title="关于"
    title-id="about-title"
    @close="emit('close')"
  >
    <div
      class="dialog-body about-body"
      tabindex="0"
      role="region"
      aria-label="产品信息"
    >
      <div class="about-identity">
        <img :src="icon" alt="" width="64" height="64" />
        <div><strong>Ineed NetTool</strong><span>网络规划与诊断助手</span></div>
      </div>
      <dl class="about-details">
        <div>
          <dt>版本</dt>
          <dd>{{ version }}</dd>
        </div>
        <div>
          <dt>运行环境</dt>
          <dd>{{ desktop ? "Electron" : "浏览器预览" }}</dd>
        </div>
        <div>
          <dt>主要功能</dt>
          <dd>IPv4 规划 · IP 探测 · Ping · 路由</dd>
        </div>
        <div>
          <dt>本地存储</dt>
          <dd>{{ desktop ? "SQLite 工作区" : "浏览器本地存储" }}</dd>
        </div>
        <div>
          <dt>官方网站</dt>
          <dd><a class="about-website" :href="website" target="_blank" rel="noopener noreferrer" @click="openWebsite">nettool.ineedfull.com</a></dd>
        </div>
      </dl>
      <p v-if="websiteError" class="about-website-error" role="alert">{{ websiteError }}</p>
      <p class="about-note">
        规划地址、探测主机、观察时延与追踪路由。<br />让日常网络排查更顺手。
      </p>
      <small class="muted">版权所有 © 2026 Ineed</small>
    </div>
    <footer class="dialog-footer">
      <button type="button" @click="emit('close')">关闭</button>
    </footer>
  </DesktopDialog>
</template>
