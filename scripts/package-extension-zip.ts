/**
 * @file package-extension-zip.ts
 * @description 一键将浏览器扩展打包为符合微软 Edge Add-ons / Chrome Web Store 上架要求的规范 ZIP 压缩包
 */

import { execFileSync } from "node:child_process";
import fs from "node:fs";
import path from "node:path";

const EXTENSION_DIR = path.resolve(__dirname, "../apps/browser-extension");
const OUTPUT_ZIP = path.resolve(
  __dirname,
  "../apps/browser-extension/release/xiaorui-2fa-security-vault-extension.zip",
);
const RELEASE_DIR = path.dirname(OUTPUT_ZIP);

if (!fs.existsSync(RELEASE_DIR)) {
  fs.mkdirSync(RELEASE_DIR, { recursive: true });
}

console.log("📦 正在为微软 Edge 商店打包扩展 ZIP 文件...");

const archiveEntries = [
  "manifest.json",
  "background.js",
  "content.js",
  "content.css",
  "popup",
  "icons",
];

if (fs.existsSync(OUTPUT_ZIP)) {
  fs.unlinkSync(OUTPUT_ZIP);
}

try {
  execFileSync("tar", ["-a", "-cf", OUTPUT_ZIP, ...archiveEntries], {
    cwd: EXTENSION_DIR,
    stdio: "inherit",
  });
  console.log(`🎉 微软 Edge 扩展提审 ZIP 包生成成功！\n👉 绝对路径: ${OUTPUT_ZIP}`);
} catch (e) {
  console.error("❌ 压缩打包失败:", e);
  process.exitCode = 1;
}
