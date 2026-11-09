import { defineConfig } from "@playwright/test";

// Browser geometry checks deliberately do not launch an Electron host.
export default defineConfig({
  testDir: "./tests/ui",
  testMatch: "form-layout.spec.js",
  timeout: 360000,
  workers: 1,
  reporter: "list",
  use: {
    baseURL: "http://127.0.0.1:5197",
    channel: process.env.NET_TOOL_FORM_CHANNEL || "chromium",
    trace: "retain-on-failure",
  },
  projects: [
    {
      name: "preview-chromium",
      metadata: { preview: true },
      use: { browserName: "chromium" },
    },
  ],
  webServer: {
    command: "npm run dev -- --port 5197 --strictPort",
    url: "http://127.0.0.1:5197",
    reuseExistingServer: false,
  },
});
