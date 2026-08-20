// apps/browser-extension/src/crypto.ts
async function deriveKeyFromPassword(password, salt) {
  const enc = new TextEncoder;
  const keyMaterial = await crypto.subtle.importKey("raw", enc.encode(password), { name: "PBKDF2" }, false, ["deriveKey"]);
  return crypto.subtle.deriveKey({
    name: "PBKDF2",
    salt,
    iterations: 1e5,
    hash: "SHA-256"
  }, keyMaterial, { name: "AES-GCM", length: 256 }, false, ["encrypt", "decrypt"]);
}
async function encryptData(plaintext, key) {
  const enc = new TextEncoder;
  const iv = crypto.getRandomValues(new Uint8Array(12));
  const encrypted = await crypto.subtle.encrypt({ name: "AES-GCM", iv }, key, enc.encode(plaintext));
  const ciphertextHex = Array.from(new Uint8Array(encrypted)).map((b) => b.toString(16).padStart(2, "0")).join("");
  const ivHex = Array.from(iv).map((b) => b.toString(16).padStart(2, "0")).join("");
  return { ciphertextHex, ivHex };
}
async function decryptData(ciphertextHex, ivHex, key) {
  const ciphertext = new Uint8Array(ciphertextHex.match(/.{1,2}/g).map((byte) => parseInt(byte, 16)));
  const iv = new Uint8Array(ivHex.match(/.{1,2}/g).map((byte) => parseInt(byte, 16)));
  const decrypted = await crypto.subtle.decrypt({ name: "AES-GCM", iv }, key, ciphertext);
  const dec = new TextDecoder;
  return dec.decode(decrypted);
}

// apps/browser-extension/src/background.ts
var sessionKey = null;
chrome.runtime.onInstalled.addListener(() => {
  console.log("\uD83D\uDEE1️ Secure Authenticator Extension installed.");
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
          const payload = message.payload;
          console.log("\uD83D\uDD0D 2FA QR Code detected on tab:", sender.tab?.id, payload);
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
          try {
            const resp = await fetch(message.url);
            const blob = await resp.blob();
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
            sendResponse({ success: false, error: e.message });
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
          const saltHex = Array.from(salt).map((b) => b.toString(16).padStart(2, "0")).join("");
          const key = await deriveKeyFromPassword(password, salt);
          sessionKey = key;
          const verifier = await encryptData("VAULT_VERIFIER_OK", key);
          await chrome.storage.local.set({
            vaultSaltHex: saltHex,
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
            "vaultVerifier"
          ]);
          if (!data.vaultSaltHex || !data.vaultVerifier) {
            throw new Error("保险库尚未初始化");
          }
          const salt = new Uint8Array(data.vaultSaltHex.match(/.{1,2}/g).map((b) => parseInt(b, 16)));
          const key = await deriveKeyFromPassword(password, salt);
          try {
            const verified = await decryptData(data.vaultVerifier.ciphertextHex, data.vaultVerifier.ivHex, key);
            if (verified !== "VAULT_VERIFIER_OK") {
              throw new Error("密码错误");
            }
          } catch {
            throw new Error("密码不正确，请重新输入");
          }
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
              "vaultVerifier"
            ]);
            if (data.vaultSaltHex && data.vaultVerifier) {
              const salt = new Uint8Array(data.vaultSaltHex.match(/.{1,2}/g).map((b) => parseInt(b, 16)));
              const derived = await deriveKeyFromPassword(masterPassword, salt);
              const verified = await decryptData(data.vaultVerifier.ciphertextHex, data.vaultVerifier.ivHex, derived);
              if (verified === "VAULT_VERIFIER_OK") {
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
            id: "entry_" + Date.now() + "_" + Math.random().toString(36).substring(2, 8),
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
          sendResponse({ error: "Unknown message type: " + message.type });
      }
    } catch (err) {
      console.error("Background error on", message.type, err);
      sendResponse({ success: false, error: err.message || String(err) });
    }
  })();
  return true;
});
