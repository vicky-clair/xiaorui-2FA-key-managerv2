import jsQR from "jsqr";
import { type ParsedOtpAuth, base32ToUint8Array, generateTOTP, parseOtpAuthUri } from "./crypto";

declare const chrome: typeof globalThis.chrome;

interface AuthenticatorEntryItem {
  id: string;
  payload: {
    issuer: string;
    account: string;
    secret: string;
    algorithm?: "SHA-1" | "SHA-256" | "SHA-512";
    digits?: number;
    period?: number;
  };
  createdAt: number;
}

interface RuntimeResponse {
  success?: boolean;
  error?: string;
  isInitialized?: boolean;
  isUnlocked?: boolean;
  entries?: AuthenticatorEntryItem[];
  pending2fa?: ParsedOtpAuth;
}

function requireElement<T extends HTMLElement = HTMLElement>(id: string): T {
  const element = document.getElementById(id);
  if (!element) {
    throw new Error(`缺少必要界面元素: ${id}`);
  }
  return element as T;
}

let entries: AuthenticatorEntryItem[] = [];
let pending2faData: ParsedOtpAuth | null = null;
let timerId: number | null = null;

// DOM 元素引用
const viewSetup = requireElement("view-setup");
const viewUnlock = requireElement("view-unlock");
const viewMain = requireElement("view-main");
const headerActions = requireElement("header-actions");
const pendingBanner = requireElement("pending-banner");
const pendingBannerText = requireElement("pending-banner-text");
const entriesList = requireElement("entries-list");
const emptyState = requireElement("empty-state");
const searchInput = requireElement<HTMLInputElement>("search-input");

const modalAdd = requireElement("modal-add-entry");
const addIssuer = requireElement<HTMLInputElement>("add-issuer");
const addAccount = requireElement<HTMLInputElement>("add-account");
const addSecret = requireElement<HTMLInputElement>("add-secret");
const addError = requireElement("add-error");

// 初始化检查保险库状态
async function init() {
  chrome.runtime.sendMessage({ type: "GET_VAULT_STATUS" }, async (res?: RuntimeResponse) => {
    if (!res?.success) {
      showView("setup");
      return;
    }

    if (!res.isInitialized) {
      showView("setup");
    } else if (!res.isUnlocked) {
      showView("unlock");
    } else {
      showView("main");
      await loadEntries();
      await checkPending2Fa();
    }
  });
}

function showView(view: "setup" | "unlock" | "main") {
  viewSetup.style.display = view === "setup" ? "flex" : "none";
  viewUnlock.style.display = view === "unlock" ? "flex" : "none";
  viewMain.style.display = view === "main" ? "flex" : "none";
  headerActions.style.display = view === "main" ? "flex" : "none";

  if (view === "unlock") {
    setTimeout(() => {
      document.getElementById("unlock-pwd")?.focus();
    }, 100);
  }
}

// 检查是否有来自当前网页的待确认 2FA
async function checkPending2Fa() {
  chrome.runtime.sendMessage({ type: "GET_PENDING_2FA" }, (res?: RuntimeResponse) => {
    if (res?.success && res.pending2fa) {
      const pending = res.pending2fa;
      pending2faData = pending;
      pendingBannerText.innerText = `检测到来自「${pending.issuer}」的 2FA 密钥`;
      pendingBanner.style.display = "flex";
    } else {
      pendingBanner.style.display = "none";
    }
  });
}

// 加载并渲染解密后的 2FA 列表
async function loadEntries() {
  chrome.runtime.sendMessage({ type: "GET_ENTRIES" }, (res?: RuntimeResponse) => {
    if (res?.success) {
      entries = res.entries || [];
      renderEntries();
      startTicker();
    }
  });
}

// 启动每秒刷新动态口令计时器
function startTicker() {
  if (timerId) clearInterval(timerId);
  timerId = window.setInterval(() => {
    updateTotpCodes();
  }, 1000);
  updateTotpCodes();
}

async function renderEntries() {
  const query = searchInput.value.trim().toLowerCase();
  const filtered = entries.filter((e) => {
    const issuer = (e.payload.issuer || "").toLowerCase();
    const account = (e.payload.account || "").toLowerCase();
    return issuer.includes(query) || account.includes(query);
  });

  if (filtered.length === 0) {
    entriesList.innerHTML = "";
    emptyState.style.display = "flex";
    return;
  }

  emptyState.style.display = "none";
  entriesList.innerHTML = "";

  for (const entry of filtered) {
    const card = document.createElement("div");
    card.className = "entry-card";
    card.dataset.id = entry.id;

    const totp = await generateTOTP(entry.payload.secret, {
      algorithm: entry.payload.algorithm,
      digits: entry.payload.digits,
      period: entry.payload.period,
    });

    const progressColor =
      totp.remainingSeconds > 10 ? "#10b981" : totp.remainingSeconds > 5 ? "#f59e0b" : "#ef4444";
    const formattedCode =
      totp.code.length === 6 ? `${totp.code.slice(0, 3)} ${totp.code.slice(3)}` : totp.code;

    card.innerHTML = `
      <div class="entry-header">
        <span class="entry-service">${escapeHtml(entry.payload.issuer || "2FA")}</span>
        <span class="entry-account">${escapeHtml(entry.payload.account || "")}</span>
      </div>
      <div class="entry-body">
        <div class="entry-code" id="code-${entry.id}">${formattedCode}</div>
        <div class="entry-actions">
          <button class="btn-copy" data-code="${totp.code}">复制</button>
          <button class="btn-delete" data-id="${entry.id}" title="删除">✕</button>
        </div>
      </div>
      <div class="entry-progress-wrap">
        <div class="entry-progress-bar" id="bar-${entry.id}" style="width: ${totp.progress * 100}%; background-color: ${progressColor};"></div>
      </div>
    `;

    // 绑定点击整张卡片一键复制
    card.querySelector(".btn-copy")?.addEventListener("click", (e) => {
      e.stopPropagation();
      copyToClipboard(totp.code);
    });

    card.addEventListener("click", () => {
      copyToClipboard(totp.code);
    });

    // 绑定删除按钮
    card.querySelector(".btn-delete")?.addEventListener("click", (e) => {
      e.stopPropagation();
      if (confirm(`确定要删除「${entry.payload.issuer}」的 2FA 动态口令吗？`)) {
        deleteEntry(entry.id);
      }
    });

    entriesList.appendChild(card);
  }
}

// 每秒刷新计算
async function updateTotpCodes() {
  for (const entry of entries) {
    const codeEl = document.getElementById(`code-${entry.id}`);
    const barEl = document.getElementById(`bar-${entry.id}`);
    if (!codeEl || !barEl) continue;

    try {
      const totp = await generateTOTP(entry.payload.secret, {
        algorithm: entry.payload.algorithm,
        digits: entry.payload.digits,
        period: entry.payload.period,
      });

      const formattedCode =
        totp.code.length === 6 ? `${totp.code.slice(0, 3)} ${totp.code.slice(3)}` : totp.code;

      codeEl.innerText = formattedCode;
      barEl.style.width = `${totp.progress * 100}%`;
      barEl.style.backgroundColor =
        totp.remainingSeconds > 10 ? "#10b981" : totp.remainingSeconds > 5 ? "#f59e0b" : "#ef4444";
    } catch {}
  }
}

function copyToClipboard(text: string) {
  navigator.clipboard.writeText(text);
  setTimeout(async () => {
    try {
      if ((await navigator.clipboard.readText()) === text) {
        await navigator.clipboard.writeText("");
      }
    } catch {}
  }, 30000);
  showToast("✅ 已复制动态验证码！");
}

function showToast(msg: string) {
  const toast = requireElement("toast");
  toast.innerText = msg;
  toast.style.display = "block";
  setTimeout(() => {
    toast.style.display = "none";
  }, 1800);
}

function deleteEntry(id: string) {
  chrome.runtime.sendMessage({ type: "DELETE_ENTRY", id }, (res?: RuntimeResponse) => {
    if (res?.success) {
      showToast("🗑️ 已删除该 2FA 账号");
      loadEntries();
    }
  });
}

function escapeHtml(str: string): string {
  return String(str).replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
}

// ----------------- 事件监听与绑定 -----------------

// 1. 初次设置主密码
document.getElementById("btn-do-setup")?.addEventListener("click", () => {
  const setupPwd = requireElement<HTMLInputElement>("setup-pwd");
  const setupPwdConfirm = requireElement<HTMLInputElement>("setup-pwd-confirm");
  const p1 = setupPwd.value;
  const p2 = setupPwdConfirm.value;
  const errEl = requireElement("setup-error");

  if (!p1 || p1.length < 6) {
    errEl.style.display = "block";
    errEl.innerText = "主密码长度至少为 6 位";
    return;
  }
  if (p1 !== p2) {
    errEl.style.display = "block";
    errEl.innerText = "两次输入的密码不一致";
    return;
  }

  errEl.style.display = "none";
  chrome.runtime.sendMessage({ type: "SETUP_VAULT", password: p1 }, (res?: RuntimeResponse) => {
    setupPwd.value = "";
    setupPwdConfirm.value = "";
    if (res?.success) {
      showToast("🎉 保险库初始化成功！");
      showView("main");
      loadEntries();
    } else {
      errEl.style.display = "block";
      errEl.innerText = res?.error || "初始化失败";
    }
  });
});

// 2. 解锁主密码
document.getElementById("btn-do-unlock")?.addEventListener("click", doUnlock);
document.getElementById("unlock-pwd")?.addEventListener("keydown", (e) => {
  if (e.key === "Enter") doUnlock();
});

function doUnlock() {
  const unlockPwd = requireElement<HTMLInputElement>("unlock-pwd");
  const pwd = unlockPwd.value;
  const errEl = requireElement("unlock-error");

  if (!pwd) {
    errEl.style.display = "block";
    errEl.innerText = "请输入主密码";
    return;
  }

  errEl.style.display = "none";
  chrome.runtime.sendMessage({ type: "UNLOCK_VAULT", password: pwd }, (res?: RuntimeResponse) => {
    unlockPwd.value = "";
    if (res?.success) {
      showView("main");
      loadEntries();
      checkPending2Fa();
    } else {
      errEl.style.display = "block";
      errEl.innerText = res?.error || "密码不正确";
    }
  });
}

// 3. 锁定保险库
document.getElementById("btn-lock")?.addEventListener("click", () => {
  chrome.runtime.sendMessage({ type: "LOCK_VAULT" }, () => {
    showView("unlock");
    requireElement<HTMLInputElement>("unlock-pwd").value = "";
    showToast("🔒 已安全锁定保险库");
  });
});

// 4. 点击导入待处理 2FA 横幅 -> 直接拉起桌面端软件
document.getElementById("btn-import-pending")?.addEventListener("click", () => {
  if (!pending2faData) return;
  const link = document.createElement("a");
  link.href = `secureauth://import?uri=${encodeURIComponent(pending2faData.rawUri)}`;
  document.body.appendChild(link);
  link.click();
  link.remove();
  showToast("🚀 已唤起桌面端软件！");
});

// 4.1 主动扫描当前活动标签页
document.getElementById("btn-scan-current-page")?.addEventListener("click", () => {
  chrome.tabs.query({ active: true, currentWindow: true }, (tabs: chrome.tabs.Tab[]) => {
    if (tabs[0]?.id) {
      chrome.tabs.sendMessage(tabs[0].id, { type: "TRIGGER_MANUAL_SCAN" }, () => {
        if (chrome.runtime.lastError) {
          showToast("⚠️ 当前页面禁止脚本运行 (如浏览器内部设置页)");
        } else {
          showToast("🔍 已触发全网页 2FA 图像深度扫描");
          setTimeout(() => checkPending2Fa(), 800);
        }
      });
    } else {
      showToast("⚠️ 未找到活动的网页标签");
    }
  });
});

// 4.2 本地选图/截图识别 2FA 二维码并直接拉起软件
const inputQrFile = document.getElementById("input-qr-file") as HTMLInputElement;
document.getElementById("btn-upload-qr")?.addEventListener("click", () => {
  if (inputQrFile) {
    inputQrFile.value = "";
    inputQrFile.click();
  }
});

inputQrFile?.addEventListener("change", async (e: Event) => {
  const target = e.target as HTMLInputElement | null;
  const file = target?.files?.[0];
  if (!file) return;

  const reader = new FileReader();
  reader.onload = (event: ProgressEvent<FileReader>) => {
    const img = new Image();
    img.onload = () => {
      const canvas = document.createElement("canvas");
      canvas.width = img.width;
      canvas.height = img.height;
      const ctx = canvas.getContext("2d");
      if (!ctx) return;
      ctx.drawImage(img, 0, 0);
      const imgData = ctx.getImageData(0, 0, img.width, img.height);
      const qr = jsQR(imgData.data, img.width, img.height);
      if (qr?.data) {
        let uri = qr.data.trim();
        if (uri.startsWith("otpauth%3A%2F%2F") || uri.startsWith("otpauth%3a%2f%2f")) {
          uri = decodeURIComponent(uri);
        }
        if (uri.startsWith("otpauth://")) {
          const link = document.createElement("a");
          link.href = `secureauth://import?uri=${encodeURIComponent(uri)}`;
          document.body.appendChild(link);
          link.click();
          link.remove();
          showToast("🎉 成功识别 2FA！已拉起桌面端软件");
        } else {
          showToast("⚠️ 该二维码不是 2FA 认证密钥");
        }
      } else {
        showToast("⚠️ 未在该图片中检测到有效二维码");
      }
    };
    if (typeof event.target?.result === "string") {
      img.src = event.target.result;
    }
  };
  reader.readAsDataURL(file);
});

// 5. 手动添加 2FA 弹窗
document.getElementById("btn-add")?.addEventListener("click", () => {
  addIssuer.value = "";
  addAccount.value = "";
  addSecret.value = "";
  addError.style.display = "none";
  modalAdd.style.display = "flex";
});

document.getElementById("btn-close-add-modal")?.addEventListener("click", () => {
  modalAdd.style.display = "none";
});
document.getElementById("btn-cancel-add")?.addEventListener("click", () => {
  modalAdd.style.display = "none";
});

// 保存添加的 2FA
document.getElementById("btn-save-add")?.addEventListener("click", () => {
  const inputSecret = addSecret.value.trim();
  const issuer = addIssuer.value.trim();
  const account = addAccount.value.trim();

  if (!inputSecret) {
    showAddError("请输入 2FA 密钥或 otpauth 链接");
    return;
  }

  let finalSecret = inputSecret;
  let finalIssuer = issuer;
  let finalAccount = account;
  let finalAlgo: "SHA-1" | "SHA-256" | "SHA-512" = "SHA-1";
  let finalDigits = 6;
  let finalPeriod = 30;

  if (inputSecret.toLowerCase().startsWith("otpauth://")) {
    try {
      const parsed = parseOtpAuthUri(inputSecret);
      finalSecret = parsed.secret;
      if (!finalIssuer) finalIssuer = parsed.issuer;
      if (!finalAccount) finalAccount = parsed.account;
      finalAlgo = parsed.algorithm;
      finalDigits = parsed.digits;
      finalPeriod = parsed.period;
    } catch (e: unknown) {
      showAddError(e instanceof Error ? e.message : "无效的 otpauth 链接");
      return;
    }
  } else {
    finalSecret = inputSecret.replace(/[\s\-]/g, "").toUpperCase();
    try {
      base32ToUint8Array(finalSecret);
    } catch {
      showAddError("密钥 Base32 格式无效，请检查是否输入正确");
      return;
    }
  }

  const payload = {
    issuer: finalIssuer || "2FA Service",
    account: finalAccount || finalIssuer || "My Account",
    secret: finalSecret,
    algorithm: finalAlgo,
    digits: finalDigits,
    period: finalPeriod,
  };

  chrome.runtime.sendMessage({ type: "SAVE_ENTRY", payload }, (res?: RuntimeResponse) => {
    if (res?.success) {
      modalAdd.style.display = "none";
      showToast("✨ 2FA 账号已安全保存！");
      loadEntries();
      checkPending2Fa();
    } else {
      showAddError(res?.error || "保存失败");
    }
  });
});

function showAddError(text: string) {
  addError.style.display = "block";
  addError.innerText = `⚠️ ${text}`;
}

// 搜索框过滤
searchInput.addEventListener("input", () => {
  renderEntries();
});

// 初始化启动
init();
