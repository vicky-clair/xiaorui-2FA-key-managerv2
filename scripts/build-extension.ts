/**
 * @file build-extension.ts
 * @description 编译打包 Manifest V3 浏览器扩展
 */

import path from "path";

const EXTENSION_DIR = path.resolve(__dirname, "../apps/browser-extension");

console.log("🚀 Starting Browser Extension Build...");

// 1. 编译 background.ts
const bgResult = await Bun.build({
  entrypoints: [path.join(EXTENSION_DIR, "src/background.ts")],
  outdir: EXTENSION_DIR,
  naming: "background.js",
  target: "browser",
  minify: false,
});
if (!bgResult.success) {
  console.error("❌ Failed to build background.js:", bgResult.logs);
  process.exit(1);
}
console.log("✅ Built background.js");

// 2. 编译 content.ts
const contentResult = await Bun.build({
  entrypoints: [path.join(EXTENSION_DIR, "src/content.ts")],
  outdir: EXTENSION_DIR,
  naming: "content.js",
  target: "browser",
  minify: false,
});
if (!contentResult.success) {
  console.error("❌ Failed to build content.js:", contentResult.logs);
  process.exit(1);
}
console.log("✅ Built content.js");

// 3. 编译 popup.ts
const popupResult = await Bun.build({
  entrypoints: [path.join(EXTENSION_DIR, "src/popup.ts")],
  outdir: path.join(EXTENSION_DIR, "popup"),
  naming: "popup.js",
  target: "browser",
  minify: false,
});
if (!popupResult.success) {
  console.error("❌ Failed to build popup.js:", popupResult.logs);
  process.exit(1);
}
console.log("✅ Built popup/popup.js");

console.log("🎉 Browser Extension build completed successfully!");
