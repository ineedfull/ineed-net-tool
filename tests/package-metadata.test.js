import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

test("macOS internal bundle name matches Chromium Helper product name", async () => {
  const manifest = JSON.parse(
    await readFile(new URL("../package.json", import.meta.url), "utf8"),
  );
  // Chromium uses this case-sensitive name to locate the packaged Helper.
  assert.equal(manifest.build.mac.extendInfo.CFBundleName, manifest.build.productName);
  assert.equal(manifest.build.mac.extendInfo.CFBundleDisplayName, "iNeed Net Tool");
});
