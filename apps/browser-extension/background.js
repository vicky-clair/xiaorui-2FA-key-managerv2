// apps/browser-extension/src/crypto.ts
var EXTENSION_KDF_NAME = "PBKDF2-SHA256";
var EXTENSION_KDF_ITERATIONS = 600000;
var LEGACY_EXTENSION_KDF_ITERATIONS = 1e5;
function getDefaultExtensionKdfParams() {
  return {
    name: EXTENSION_KDF_NAME,
    iterations: EXTENSION_KDF_ITERATIONS
  };
}
function normalizeExtensionKdfParams(params) {
  const iterations = params?.iterations ?? LEGACY_EXTENSION_KDF_ITERATIONS;
  if (params?.name && params.name !== EXTENSION_KDF_NAME) {
    throw new Error("不支持的扩展保险库 KDF 参数");
  }
  if (!Number.isInteger(iterations) || iterations < LEGACY_EXTENSION_KDF_ITERATIONS || iterations > EXTENSION_KDF_ITERATIONS) {
    throw new Error("扩展保险库 KDF 参数超出安全范围");
  }
  return {
    name: EXTENSION_KDF_NAME,
    iterations
  };
}
function isLegacyExtensionKdfParams(params) {
  return params.iterations < EXTENSION_KDF_ITERATIONS;
}
function toArrayBuffer(bytes) {
  return new Uint8Array(bytes).buffer;
}
function hexToBytes(hex) {
  if (!/^[0-9a-f]+$/i.test(hex) || hex.length % 2 !== 0) {
    throw new Error("无效的十六进制编码");
  }
  const pairs = hex.match(/.{1,2}/g);
  if (!pairs) {
    throw new Error("无效的十六进制编码");
  }
  return new Uint8Array(pairs.map((byte) => Number.parseInt(byte, 16)));
}
async function deriveKeyFromPassword(password, salt, params = getDefaultExtensionKdfParams()) {
  const safeParams = normalizeExtensionKdfParams(params);
  const enc = new TextEncoder;
  const keyMaterial = await crypto.subtle.importKey("raw", toArrayBuffer(enc.encode(password)), { name: "PBKDF2" }, false, ["deriveKey"]);
  return crypto.subtle.deriveKey({
    name: "PBKDF2",
    salt: toArrayBuffer(salt),
    iterations: safeParams.iterations,
    hash: "SHA-256"
  }, keyMaterial, { name: "AES-GCM", length: 256 }, false, ["encrypt", "decrypt"]);
}
async function encryptData(plaintext, key) {
  const enc = new TextEncoder;
  const iv = crypto.getRandomValues(new Uint8Array(12));
  const encodedPlaintext = enc.encode(plaintext);
  const encrypted = await crypto.subtle.encrypt({ name: "AES-GCM", iv: toArrayBuffer(iv) }, key, toArrayBuffer(encodedPlaintext));
  const ciphertextHex = Array.from(new Uint8Array(encrypted)).map((b) => b.toString(16).padStart(2, "0")).join("");
  const ivHex = Array.from(iv).map((b) => b.toString(16).padStart(2, "0")).join("");
  return { ciphertextHex, ivHex };
}
async function decryptData(ciphertextHex, ivHex, key) {
  const ciphertext = hexToBytes(ciphertextHex);
  const iv = hexToBytes(ivHex);
  const decrypted = await crypto.subtle.decrypt({ name: "AES-GCM", iv: toArrayBuffer(iv) }, key, toArrayBuffer(ciphertext));
  const dec = new TextDecoder;
  return dec.decode(decrypted);
}

// apps/browser-extension/src/background.ts
var sessionKey = null;
function hexToBytes2(hex) {
  if (!/^[0-9a-f]+$/i.test(hex) || hex.length % 2 !== 0) {
    throw new Error("无效的十六进制编码");
  }
  const pairs = hex.match(/.{1,2}/g);
  if (!pairs) {
    throw new Error("无效的十六进制编码");
  }
  return new Uint8Array(pairs.map((b) => Number.parseInt(b, 16)));
}
function bytesToHex(bytes) {
  return Array.from(bytes).map((b) => b.toString(16).padStart(2, "0")).join("");
}
function isExtensionSender(sender) {
  return sender?.id === chrome.runtime.id;
}
function isAllowedImageUrl(rawUrl) {
  try {
    const url = new URL(rawUrl);
    return url.protocol === "https:" || url.protocol === "http:";
  } catch {
    return false;
  }
}
async function migrateVaultKdfIfNeeded(password, oldKey, oldData) {
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
      createdAt: item.createdAt
    });
  }
  await chrome.storage.local.set({
    vaultSaltHex: bytesToHex(newSalt),
    vaultKdf: newKdf,
    vaultVerifier: newVerifier,
    entries: newEntries
  });
  return newKey;
}
chrome.runtime.onInstalled.addListener(() => {
  console.log("\uD83D\uDEE1️ Xiaorui 2FA Security Vault Extension installed.");
  try {
    chrome.contextMenus.create({
      id: "sa-scan-2fa",
      title: "\uD83D\uDEE1️ 扫描此页面/图片中的 2FA 密钥",
      contexts: ["page", "image", "selection"]
    });
  } catch {}
});
chrome.contextMenus?.onClicked?.addListener((info, tab) => {
  if (info.menuItemId === "sa-scan-2fa" && tab?.id) {
    chrome.tabs.sendMessage(tab.id, { type: "TRIGGER_MANUAL_SCAN" });
  }
});
chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
  (async () => {
    try {
      switch (message.type) {
        case "SCAN_2FA_DETECTED": {
          if (!isExtensionSender(sender)) {
            throw new Error("拒绝来自未知来源的扩展消息");
          }
          const payload = message.payload;
          console.info("2FA QR Code detected on tab:", sender.tab?.id, {
            issuer: payload?.issuer,
            account: payload?.account
          });
          await chrome.storage.session.set({
            pending2fa: {
              ...payload,
              tabId: sender.tab?.id,
              detectedAt: Date.now()
            }
          });
          await chrome.action.setBadgeText({ text: "+1" });
          await chrome.action.setBadgeBackgroundColor({ color: "#10b981" });
          sendResponse({ success: true });
          break;
        }
        case "GET_PENDING_2FA": {
          const { pending2fa } = await chrome.storage.session.get("pending2fa");
          sendResponse({ success: true, pending2fa: pending2fa || null });
          break;
        }
        case "CLEAR_PENDING_2FA": {
          await chrome.storage.session.remove("pending2fa");
          await chrome.action.setBadgeText({ text: "" });
          sendResponse({ success: true });
          break;
        }
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
            for (let i = 0;i < bytes.byteLength; i++) {
              binary += String.fromCharCode(bytes[i]);
            }
            const base64 = btoa(binary);
            const mimeType = blob.type || "image/png";
            sendResponse({ success: true, dataUrl: `data:${mimeType};base64,${base64}` });
          } catch (e) {
            sendResponse({ success: false, error: e instanceof Error ? e.message : String(e) });
          }
          break;
        }
        case "GET_VAULT_STATUS": {
          const { vaultSaltHex } = await chrome.storage.local.get("vaultSaltHex");
          sendResponse({
            success: true,
            isInitialized: !!vaultSaltHex,
            isUnlocked: sessionKey !== null
          });
          break;
        }
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
          const verifier = await encryptData("VAULT_VERIFIER_OK", key);
          await chrome.storage.local.set({
            vaultSaltHex: saltHex,
            vaultKdf: kdf,
            vaultVerifier: verifier,
            entries: []
          });
          sendResponse({ success: true });
          break;
        }
        case "UNLOCK_VAULT": {
          const { password } = message;
          const data = await chrome.storage.local.get([
            "vaultSaltHex",
            "vaultKdf",
            "vaultVerifier",
            "entries"
          ]);
          if (!data.vaultSaltHex || !data.vaultVerifier) {
            throw new Error("保险库尚未初始化");
          }
          const salt = hexToBytes2(data.vaultSaltHex);
          const kdf = normalizeExtensionKdfParams(data.vaultKdf);
          let key = await deriveKeyFromPassword(password, salt, kdf);
          try {
            const verified = await decryptData(data.vaultVerifier.ciphertextHex, data.vaultVerifier.ivHex, key);
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
        case "LOCK_VAULT": {
          sessionKey = null;
          sendResponse({ success: true });
          break;
        }
        case "GET_ENTRIES": {
          if (!sessionKey) {
            throw new Error("保险库未解锁");
          }
          const { entries = [] } = await chrome.storage.local.get("entries");
          const decryptedEntries = [];
          for (const item of entries) {
            try {
              const plain = await decryptData(item.ciphertextHex, item.ivHex, sessionKey);
              decryptedEntries.push({
                id: item.id,
                payload: JSON.parse(plain),
                createdAt: item.createdAt
              });
            } catch (err) {
              console.error("Failed to decrypt entry:", item.id, err);
            }
          }
          sendResponse({ success: true, entries: decryptedEntries });
          break;
        }
        case "SAVE_ENTRY": {
          const { payload, masterPassword } = message;
          if (!payload || !payload.secret) {
            throw new Error("2FA 账号数据不完整");
          }
          let keyToUse = sessionKey;
          if (!keyToUse && masterPassword) {
            const data = await chrome.storage.local.get([
              "vaultSaltHex",
              "vaultKdf",
              "vaultVerifier",
              "entries"
            ]);
            if (data.vaultSaltHex && data.vaultVerifier) {
              const salt = hexToBytes2(data.vaultSaltHex);
              const kdf = normalizeExtensionKdfParams(data.vaultKdf);
              let derived = await deriveKeyFromPassword(masterPassword, salt, kdf);
              const verified = await decryptData(data.vaultVerifier.ciphertextHex, data.vaultVerifier.ivHex, derived);
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
          const { entries = [] } = await chrome.storage.local.get("entries");
          const newEntry = {
            id: `entry_${Date.now()}_${Math.random().toString(36).substring(2, 8)}`,
            ciphertextHex: enc.ciphertextHex,
            ivHex: enc.ivHex,
            createdAt: Date.now()
          };
          entries.unshift(newEntry);
          await chrome.storage.local.set({ entries });
          await chrome.storage.session.remove("pending2fa");
          await chrome.action.setBadgeText({ text: "" });
          sendResponse({ success: true, id: newEntry.id });
          break;
        }
        case "DELETE_ENTRY": {
          const { id } = message;
          const { entries = [] } = await chrome.storage.local.get("entries");
          const filtered = entries.filter((e) => e.id !== id);
          await chrome.storage.local.set({ entries: filtered });
          sendResponse({ success: true });
          break;
        }
        default:
          sendResponse({ error: `Unknown message type: ${message.type}` });
      }
    } catch (err) {
      console.error("Background error on", message.type, err);
      sendResponse({ success: false, error: err instanceof Error ? err.message : String(err) });
    }
  })();
  return true;
});
