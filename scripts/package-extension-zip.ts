/**
 * @file package-extension-zip.ts
 * @description 一键将浏览器扩展打包为符合微软 Edge Add-ons / Chrome Web Store 上架要求的规范 ZIP 压缩包
 */

import fs from "fs";
import path from "path";
import { execSync } from "child_process";

const EXTENSION_DIR = path.resolve(__dirname, "../apps/browser-extension");
const OUTPUT_ZIP = path.resolve(__dirname, "../apps/browser-extension/release/xiaorui-2fa-security-vault-extension.zip");
const RELEASE_DIR = path.dirname(OUTPUT_ZIP);

if (!fs.existsSync(RELEASE_DIR)) {
  fs.mkdirSync(RELEASE_DIR, { recursive: true });
}

console.log("📦 正在为微软 Edge 商店打包扩展 ZIP 文件...");

// 借助 PowerShell 的 Compress-Archive 原生生成标准 ZIP (Windows 环境免额外依赖)
const cmd = `powershell -Command "Compress-Archive -Path '${path.join(EXTENSION_DIR, "manifest.json")}', '${path.join(EXTENSION_DIR, "background.js")}', '${path.join(EXTENSION_DIR, "content.js")}', '${path.join(EXTENSION_DIR, "content.css")}', '${path.join(EXTENSION_DIR, "popup")}', '${path.join(EXTENSION_DIR, "icons")}' -DestinationPath '${OUTPUT_ZIP}' -Force"`;

try {
  execSync(cmd, { stdio: "inherit" });
  console.log(`🎉 微软 Edge 扩展提审 ZIP 包生成成功！\n👉 绝对路径: ${OUTPUT_ZIP}`);
} catch (e) {
  console.error("❌ 压缩打包失败:", e);
}
