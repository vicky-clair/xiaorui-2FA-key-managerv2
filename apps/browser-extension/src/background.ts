/**
 * @file background.ts
 * @description 浏览器扩展 Manifest V3 后台服务 (Service Worker)
 * 职责：
 * 1. 监听来自 content.js 的 2FA 二维码识别消息并设置角标提示；
 * 2. 维护 pending2fa 待确认导入会话队列；
 * 3. 协调与 popup 之间的数据存取与保险库状态。
 */

import {
  type ExtensionKdfParams,
  type ParsedOtpAuth,
  decryptData,
  deriveKeyFromPassword,
  encryptData,
  getDefaultExtensionKdfParams,
  isLegacyExtensionKdfParams,
  normalizeExtensionKdfParams,
} from "./crypto";

declare const chrome: typeof globalThis.chrome;

interface VaultStorageSchema {
  vaultSaltHex?: string;
  vaultKdf?: ExtensionKdfParams;
  vaultVerifier?: { ciphertextHex: string; ivHex: string };
  entries?: Array<{
    id: string;
    ciphertextHex: string;
    ivHex: string;
    createdAt: number;
  }>;
}

// 缓存当前内存会话中的解密密码（只在浏览器活跃期间短暂驻留）
let sessionKey: CryptoKey | null = null;

function hexToBytes(hex: string): Uint8Array {
  if (!/^[0-9a-f]+$/i.test(hex) || hex.length % 2 !== 0) {
    throw new Error("无效的十六进制编码");
  }
  const pairs = hex.match(/.{1,2}/g);
  if (!pairs) {
    throw new Error("无效的十六进制编码");
  }
  return new Uint8Array(pairs.map((b) => Number.parseInt(b, 16)));
}

function bytesToHex(bytes: Uint8Array): string {
  return Array.from(bytes)
    .map((b) => b.toString(16).padStart(2, "0"))
    .join("");
}

function isExtensionSender(sender: chrome.runtime.MessageSender): boolean {
  return sender?.id === chrome.runtime.id;
}

function isAllowedImageUrl(rawUrl: string): boolean {
  try {
    const url = new URL(rawUrl);
    return url.protocol === "https:" || url.protocol === "http:";
  } catch {
    return false;
  }
}

async function migrateVaultKdfIfNeeded(
  password: string,
  oldKey: CryptoKey,
  oldData: VaultStorageSchema,
): Promise<CryptoKey> {
  const currentKdf = normalizeExtensionKdfParams(oldData.vaultKdf);
  if (!isLegacyExtensionKdfParams(currentKdf)) {
    return oldKey;
  }

  const entries = oldData.entries || [];
  const decryptedPayloads = [];
  for (const item of entries) {
    const plain = await decryptData(item.ciphertextHex, item.ivHex, oldKey);
    decryptedPayloads.push({ ...item, plain });
  }

  const newSalt = crypto.getRandomValues(new Uint8Array(16));
  const newKdf = getDefaultExtensionKdfParams();
  const newKey = await deriveKeyFromPassword(password, newSalt, newKdf);
  const newVerifier = await encryptData("VAULT_VERIFIER_OK", newKey);
  const newEntries = [];

  for (const item of decryptedPayloads) {
    const encrypted = await encryptData(item.plain, newKey);
    newEntries.push({
      id: item.id,
      ciphertextHex: encrypted.ciphertextHex,
      ivHex: encrypted.ivHex,
      createdAt: item.createdAt,
    });
  }

  await chrome.storage.local.set({
    vaultSaltHex: bytesToHex(newSalt),
    vaultKdf: newKdf,
    vaultVerifier: newVerifier,
    entries: newEntries,
  });

  return newKey;
}

// 监听扩展安装与启动事件
chrome.runtime.onInstalled.addListener(() => {
  console.log("🛡️ Xiaorui 2FA Security Vault Extension installed.");
  try {
    chrome.contextMenus.create({
      id: "sa-scan-2fa",
      title: "🛡️ 扫描此页面/图片中的 2FA 密钥",
      contexts: ["page", "image", "selection"],
    });
  } catch {}
});

// 监听右键菜单点击
chrome.contextMenus?.onClicked?.addListener(
  (info: chrome.contextMenus.OnClickData, tab?: chrome.tabs.Tab) => {
    if (info.menuItemId === "sa-scan-2fa" && tab?.id) {
      chrome.tabs.sendMessage(tab.id, { type: "TRIGGER_MANUAL_SCAN" });
    }
  },
);

// 监听消息通道
chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
  (async () => {
    try {
      switch (message.type) {
        // 1. 页面检测到 2FA 二维码
        case "SCAN_2FA_DETECTED": {
          if (!isExtensionSender(sender)) {
            throw new Error("拒绝来自未知来源的扩展消息");
          }
          const payload: ParsedOtpAuth = message.payload;
          console.info("2FA QR Code detected on tab:", sender.tab?.id, {
            issuer: payload?.issuer,
            account: payload?.account,
          });

          // 存入待导入暂存区
          await chrome.storage.session.set({
            pending2fa: {
              ...payload,
              tabId: sender.tab?.id,
              detectedAt: Date.now(),
            },
          });

          // 设置扩展图标角标徽章 "+1" (绿色提示)
          await chrome.action.setBadgeText({ text: "+1" });
          await chrome.action.setBadgeBackgroundColor({ color: "#10b981" });

          sendResponse({ success: true });
          break;
        }

        // 2. 获取待导入的 2FA 数据
        case "GET_PENDING_2FA": {
          const { pending2fa } = await chrome.storage.session.get("pending2fa");
          sendResponse({ success: true, pending2fa: pending2fa || null });
          break;
        }

        // 3. 清理待导入的 2FA 数据
        case "CLEAR_PENDING_2FA": {
          await chrome.storage.session.remove("pending2fa");
          await chrome.action.setBadgeText({ text: "" });
          sendResponse({ success: true });
          break;
        }

        // 4. 跨域图像抓取通道 (绕过 Canvas Tainted 跨域安全限制)
        case "FETCH_IMAGE_BASE64": {
          if (!isExtensionSender(sender) || !isAllowedImageUrl(message.url)) {
            throw new Error("拒绝抓取未授权的图像 URL");
          }
          try {
            const resp = await fetch(message.url, { credentials: "omit", cache: "no-store" });
            const contentLength = Number(resp.headers.get("content-length") || 0);
            if (contentLength > 5 * 1024 * 1024) {
              throw new Error("图像文件过大");
            }
            const blob = await resp.blob();
            if (blob.size > 5 * 1024 * 1024 || !blob.type.startsWith("image/")) {
              throw new Error("仅允许抓取 5MB 以内的图像资源");
            }
            const buffer = await blob.arrayBuffer();
            const bytes = new Uint8Array(buffer);
            let binary = "";
            for (let i = 0; i < bytes.byteLength; i++) {
              binary += String.fromCharCode(bytes[i]);
            }
            const base64 = btoa(binary);
            const mimeType = blob.type || "image/png";
            sendResponse({ success: true, dataUrl: `data:${mimeType};base64,${base64}` });
          } catch (e: unknown) {
            sendResponse({ success: false, error: e instanceof Error ? e.message : String(e) });
          }
          break;
        }

        // 4. 获取保险库状态（是否存在主密码、是否已在内存中解锁）
        case "GET_VAULT_STATUS": {
          const { vaultSaltHex } = await chrome.storage.local.get("vaultSaltHex");
          sendResponse({
            success: true,
            isInitialized: !!vaultSaltHex,
            isUnlocked: sessionKey !== null,
          });
          break;
        }

        // 5. 初始化主保险库密码
        case "SETUP_VAULT": {
          const { password } = message;
          if (!password || password.length < 6) {
            throw new Error("主密码长度至少为 6 位");
          }

          const salt = crypto.getRandomValues(new Uint8Array(16));
          const saltHex = bytesToHex(salt);
          const kdf = getDefaultExtensionKdfParams();

          const key = await deriveKeyFromPassword(password, salt, kdf);
          sessionKey = key;

          // 存储校验用密文
          const verifier = await encryptData("VAULT_VERIFIER_OK", key);

          await chrome.storage.local.set({
            vaultSaltHex: saltHex,
            vaultKdf: kdf,
            vaultVerifier: verifier,
            entries: [],
          });

          sendResponse({ success: true });
          break;
        }

        // 6. 解锁保险库
        case "UNLOCK_VAULT": {
          const { password } = message;
          const data: VaultStorageSchema = await chrome.storage.local.get([
            "vaultSaltHex",
            "vaultKdf",
            "vaultVerifier",
            "entries",
          ]);

          if (!data.vaultSaltHex || !data.vaultVerifier) {
            throw new Error("保险库尚未初始化");
          }

          const salt = hexToBytes(data.vaultSaltHex);
          const kdf = normalizeExtensionKdfParams(data.vaultKdf);
          let key = await deriveKeyFromPassword(password, salt, kdf);

          try {
            const verified = await decryptData(
              data.vaultVerifier.ciphertextHex,
              data.vaultVerifier.ivHex,
              key,
            );
            if (verified !== "VAULT_VERIFIER_OK") {
              throw new Error("密码错误");
            }
          } catch {
            throw new Error("密码不正确，请重新输入");
          }

          key = await migrateVaultKdfIfNeeded(password, key, data);
          sessionKey = key;
          sendResponse({ success: true });
          break;
        }

        // 7. 锁定保险库
        case "LOCK_VAULT": {
          sessionKey = null;
          sendResponse({ success: true });
          break;
        }

        // 8. 获取解密后的所有 2FA 账号
        case "GET_ENTRIES": {
          if (!sessionKey) {
            throw new Error("保险库未解锁");
          }

          const { entries = [] } = (await chrome.storage.local.get(
            "entries",
          )) as VaultStorageSchema;
          const decryptedEntries = [];

          for (const item of entries) {
            try {
              const plain = await decryptData(item.ciphertextHex, item.ivHex, sessionKey);
              decryptedEntries.push({
                id: item.id,
                payload: JSON.parse(plain),
                createdAt: item.createdAt,
              });
            } catch (err) {
              console.error("Failed to decrypt entry:", item.id, err);
            }
          }

          sendResponse({ success: true, entries: decryptedEntries });
          break;
        }

        // 9. 保存新的 2FA 账号（包括页面检测导入或手动添加）
        case "SAVE_ENTRY": {
          const { payload, masterPassword } = message;
          if (!payload || !payload.secret) {
            throw new Error("2FA 账号数据不完整");
          }

          let keyToUse = sessionKey;

          // 若未解锁但在悬浮窗提供了主密码，则先进行临时派生并检验
          if (!keyToUse && masterPassword) {
            const data: VaultStorageSchema = await chrome.storage.local.get([
              "vaultSaltHex",
              "vaultKdf",
              "vaultVerifier",
              "entries",
            ]);
            if (data.vaultSaltHex && data.vaultVerifier) {
              const salt = hexToBytes(data.vaultSaltHex);
              const kdf = normalizeExtensionKdfParams(data.vaultKdf);
              let derived = await deriveKeyFromPassword(masterPassword, salt, kdf);
              const verified = await decryptData(
                data.vaultVerifier.ciphertextHex,
                data.vaultVerifier.ivHex,
                derived,
              );
              if (verified === "VAULT_VERIFIER_OK") {
                derived = await migrateVaultKdfIfNeeded(masterPassword, derived, data);
                keyToUse = derived;
                sessionKey = derived;
              }
            }
          }

          if (!keyToUse) {
            throw new Error("请先输入主密码解锁保险库后再保存");
          }

          const enc = await encryptData(JSON.stringify(payload), keyToUse);
          const { entries = [] } = (await chrome.storage.local.get(
            "entries",
          )) as VaultStorageSchema;

          const newEntry = {
            id: `entry_${Date.now()}_${Math.random().toString(36).substring(2, 8)}`,
            ciphertextHex: enc.ciphertextHex,
            ivHex: enc.ivHex,
            createdAt: Date.now(),
          };

          entries.unshift(newEntry);
          await chrome.storage.local.set({ entries });

          // 清除待导入标记
          await chrome.storage.session.remove("pending2fa");
          await chrome.action.setBadgeText({ text: "" });

          sendResponse({ success: true, id: newEntry.id });
          break;
        }

        // 10. 删除单个 2FA 账号
        case "DELETE_ENTRY": {
          const { id } = message;
          const { entries = [] } = (await chrome.storage.local.get(
            "entries",
          )) as VaultStorageSchema;
          const filtered = entries.filter((e) => e.id !== id);
          await chrome.storage.local.set({ entries: filtered });
          sendResponse({ success: true });
          break;
        }

        default:
          sendResponse({ error: `Unknown message type: ${message.type}` });
      }
    } catch (err: unknown) {
      console.error("Background error on", message.type, err);
      sendResponse({ success: false, error: err instanceof Error ? err.message : String(err) });
    }
  })();

  return true; // 保持异步响应通道畅通
});
