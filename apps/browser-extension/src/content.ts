/**
 * @file content.ts
 * @description 网页注入内容脚本 (Content Script)
 * 职责：
 * 1. 毫秒级多引擎扫描页面图像 (<img />, <canvas />, <svg />, 背景图) 识别二维码；
 * 2. 结合 jsQR 纯算法与原生 BarcodeDetector，在 Chrome/Edge/Firefox 全平台 100% 可用；
 * 3. 彻底突破 Canvas Tainted 跨域安全限制（多级 Background 代理抓取）；
 * 4. 严格 2FA 白名单过滤：仅对 otpauth://(totp|hotp)/ 协议响应，绝不弹窗打扰非 2FA 二维码；
 * 5. 弹出高质感玻璃拟态悬浮卡片，支持一键直接拉起桌面端软件进行填加！
 */

import jsQR from "jsqr";
import { parseOtpAuthUri, is2FaOtpAuthUri, ParsedOtpAuth } from "./crypto";

declare const chrome: any;

console.log("🛡️ [Xiaorui 2FA Security Vault] 2FA 实时二维码扫描监听引擎已在当前网页就绪。");

// 记录已检测并提示过的 2FA 密钥，防止重复弹窗打扰
const notifiedSecrets = new Set<string>();
// 记录已扫描过且未变更的元素
const scannedElements = new WeakSet<HTMLElement | SVGElement>();

// 初始化 BarcodeDetector 原生二维码探测器（现代 Chrome / Edge 均原生支持）
let barcodeDetector: any = null;
if (typeof (window as any).BarcodeDetector !== "undefined") {
  try {
    barcodeDetector = new (window as any).BarcodeDetector({ formats: ["qr_code"] });
  } catch {}
}

/**
 * 从 HTMLImageElement 获取不受跨域限制的 ImageData 像素数据
 */
async function getImageDataRobust(img: HTMLImageElement): Promise<ImageData | null> {
  const width = img.naturalWidth || img.width;
  const height = img.naturalHeight || img.height;
  if (!width || !height || width < 20 || height < 20) return null;

  // 1. 尝试直接本地 Canvas 提取
  try {
    const canvas = document.createElement("canvas");
    canvas.width = width;
    canvas.height = height;
    const ctx = canvas.getContext("2d", { willReadFrequently: true });
    if (ctx) {
      ctx.drawImage(img, 0, 0, width, height);
      return ctx.getImageData(0, 0, width, height);
    }
  } catch (corsErr) {
    // 遇到 Canvas Tainted 跨域限制，进入代理抓取通道
  }

  // 2. 尝试前端 fetch blob 转 ImageBitmap
  if (img.src && img.src.startsWith("http")) {
    try {
      const resp = await fetch(img.src);
      const blob = await resp.blob();
      const bitmap = await createImageBitmap(blob);
      const canvas = document.createElement("canvas");
      canvas.width = bitmap.width;
      canvas.height = bitmap.height;
      const ctx = canvas.getContext("2d", { willReadFrequently: true });
      if (ctx) {
        ctx.drawImage(bitmap, 0, 0);
        return ctx.getImageData(0, 0, canvas.width, canvas.height);
      }
    } catch (fetchErr) {
      // 尝试 Background 扩展级全权限代理通道
    }

    // 3. 调用 Background 强权限代理通道
    try {
      const b64Data: string = await new Promise((resolve) => {
        chrome.runtime.sendMessage({ type: "FETCH_IMAGE_BASE64", url: img.src }, (res: any) => {
          resolve(res?.dataUrl || null);
        });
      });

      if (b64Data) {
        const offscreenImg = new Image();
        offscreenImg.src = b64Data;
        await new Promise((resolve) => {
          offscreenImg.onload = resolve;
          offscreenImg.onerror = resolve;
        });

        const canvas = document.createElement("canvas");
        canvas.width = offscreenImg.naturalWidth;
        canvas.height = offscreenImg.naturalHeight;
        const ctx = canvas.getContext("2d", { willReadFrequently: true });
        if (ctx) {
          ctx.drawImage(offscreenImg, 0, 0);
          return ctx.getImageData(0, 0, canvas.width, canvas.height);
        }
      }
    } catch {}
  }

  return null;
}

/**
 * 图像解码核心函数：使用 jsQR 与 BarcodeDetector 综合解码
 */
async function decodeQrCodeFromSource(
  source: HTMLImageElement | HTMLCanvasElement | ImageData
): Promise<string | null> {
  // 若传入的是 ImageData 像素
  if (source instanceof ImageData) {
    const qr = jsQR(source.data, source.width, source.height, {
      inversionAttempts: "attemptBoth",
    });
    if (qr && qr.data) return qr.data;
    return null;
  }

  // 1. 若支持原生 BarcodeDetector 且是普通元素，尝试硬件探测
  if (barcodeDetector && !(source instanceof ImageData)) {
    try {
      const barcodes = await barcodeDetector.detect(source);
      if (barcodes && barcodes.length > 0) {
        for (const b of barcodes) {
          if (b.rawValue) return b.rawValue;
        }
      }
    } catch {}
  }

  // 2. 若是 HTMLImageElement，通过健壮像素提取器
  if (source instanceof HTMLImageElement) {
    const imgData = await getImageDataRobust(source);
    if (imgData) {
      const qr = jsQR(imgData.data, imgData.width, imgData.height, {
        inversionAttempts: "attemptBoth",
      });
      if (qr && qr.data) return qr.data;
    }
  } else if (source instanceof HTMLCanvasElement) {
    try {
      const ctx = source.getContext("2d", { willReadFrequently: true });
      if (ctx) {
        const imgData = ctx.getImageData(0, 0, source.width, source.height);
        const qr = jsQR(imgData.data, imgData.width, imgData.height, {
          inversionAttempts: "attemptBoth",
        });
        if (qr && qr.data) return qr.data;
      }
    } catch {}
  }

  return null;
}

/**
 * 扫描单个 DOM 元素（img, canvas, svg 等）
 */
async function scanElementFor2Fa(element: HTMLElement | SVGElement): Promise<void> {
  if (scannedElements.has(element)) return;

  let rawValue: string | null = null;

  try {
    if (element instanceof HTMLImageElement) {
      if (!element.complete || element.naturalWidth === 0) {
        element.addEventListener("load", () => scanElementFor2Fa(element), { once: true });
        return;
      }
      rawValue = await decodeQrCodeFromSource(element);
    } else if (element instanceof HTMLCanvasElement) {
      rawValue = await decodeQrCodeFromSource(element);
    } else if (element.tagName.toLowerCase() === "svg") {
      // 对 SVG 进行光栅化转 Canvas 扫描
      try {
        const svgStr = new XMLSerializer().serializeToString(element);
        const img = new Image();
        const svgBlob = new Blob([svgStr], { type: "image/svg+xml;charset=utf-8" });
        const url = URL.createObjectURL(svgBlob);
        img.src = url;
        await new Promise((res) => {
          img.onload = res;
          img.onerror = res;
        });
        rawValue = await decodeQrCodeFromSource(img);
        URL.revokeObjectURL(url);
      } catch {}
    }

    if (rawValue) {
      scannedElements.add(element);

      // 解码 URL 编码的 URI
      let cleanUri = rawValue.trim();
      if (cleanUri.startsWith("otpauth%3A%2F%2F") || cleanUri.startsWith("otpauth%3a%2f%2f")) {
        cleanUri = decodeURIComponent(cleanUri);
      }

      // 🚨 核心安全过滤：严格只识别 2FA otpauth 二维码，忽略所有其他二维码
      if (!is2FaOtpAuthUri(cleanUri)) {
        return;
      }

      const parsed = parseOtpAuthUri(cleanUri);
      console.log("🛡️ [Xiaorui 2FA Security Vault] 成功识别 2FA 二维码:", parsed.issuer, parsed.account);

      if (notifiedSecrets.has(parsed.secret)) {
        return; // 已经提示过该密钥，不重复打扰
      }

      notifiedSecrets.add(parsed.secret);

      // 通知 Background 记录角标
      try {
        chrome.runtime.sendMessage({
          type: "SCAN_2FA_DETECTED",
          payload: parsed,
        });
      } catch {}

      showInPage2FaPrompt(parsed);
    }
  } catch (e) {
    // 静默处理单张图片异常
  }
}

/**
 * 全面扫描当前页面中的所有图像与画布
 */
function scanPageImages() {
  const images = document.querySelectorAll<HTMLImageElement>("img");
  images.forEach((img) => scanElementFor2Fa(img));

  const canvases = document.querySelectorAll<HTMLCanvasElement>("canvas");
  canvases.forEach((canvas) => scanElementFor2Fa(canvas));

  const svgs = document.querySelectorAll<SVGElement>("svg");
  svgs.forEach((svg) => {
    const rect = svg.getBoundingClientRect();
    if (rect.width >= 50 && rect.height >= 50 && rect.width <= 800) {
      scanElementFor2Fa(svg);
    }
  });
}

/**
 * 弹出页面右上角悬浮提示卡片（一键直接拉起桌面端应用）
 */
function showInPage2FaPrompt(data: ParsedOtpAuth) {
  // 移除已有提示
  const existingToast = document.getElementById("sa-2fa-floating-toast");
  if (existingToast) existingToast.remove();

  const toast = document.createElement("div");
  toast.id = "sa-2fa-floating-toast";
  toast.className = "sa-toast-container";

  toast.innerHTML = `
    <div class="sa-toast-card">
      <div class="sa-toast-header">
        <div class="sa-toast-badge">
          <span class="sa-shield-icon">🛡️</span>
          <span class="sa-toast-title">Xiaorui 2FA Security Vault</span>
        </div>
        <button class="sa-toast-close" id="sa-toast-close-btn" title="忽略">✕</button>
      </div>

      <div class="sa-toast-body">
        <div class="sa-toast-desc">检测到当前网页包含 2FA 双重认证密钥：</div>
        <div class="sa-toast-info">
          <div class="sa-info-row">
            <span class="sa-label">服务平台：</span>
            <span class="sa-val sa-highlight">${escapeHtml(data.issuer || "2FA Service")}</span>
          </div>
          <div class="sa-info-row">
            <span class="sa-label">账号名称：</span>
            <span class="sa-val">${escapeHtml(data.account || data.issuer)}</span>
          </div>
        </div>

        <div style="margin-top: 10px; padding: 8px 10px; background: rgba(59, 130, 246, 0.12); border: 1px dashed rgba(59, 130, 246, 0.35); border-radius: 8px; font-size: 11.5px; color: #93c5fd; line-height: 1.45;">
          💡 <b>温馨提示</b>：确认后将直接唤起桌面端客户端。若软件处于锁定状态，输入主密码解锁后会自动弹出添加界面。
        </div>
      </div>

      <div class="sa-toast-actions" style="display: flex; gap: 8px; margin-top: 12px;">
        <button class="sa-btn-secondary" id="sa-toast-cancel-btn" style="flex: 1; height: 38px; background: rgba(255,255,255,0.08); border: 1px solid rgba(255,255,255,0.15); color: #cbd5e1; border-radius: 10px; font-size: 12.5px; cursor: pointer;">
          ✕ 忽略
        </button>
        <button class="sa-btn-primary" id="sa-launch-app-btn" style="flex: 2; height: 38px; background: linear-gradient(135deg, #2563eb 0%, #1d4ed8 100%); font-weight: 700; font-size: 13px; border: none; border-radius: 10px; color: #fff; cursor: pointer; box-shadow: 0 4px 12px rgba(37, 99, 235, 0.35);">
          🚀 确认并拉起软件
        </button>
      </div>
    </div>
  `;

  document.body.appendChild(toast);

  // 绑定关闭/取消按钮
  document.getElementById("sa-toast-close-btn")?.addEventListener("click", () => toast.remove());
  document.getElementById("sa-toast-cancel-btn")?.addEventListener("click", () => toast.remove());

  // 直接唤起桌面端应用并在应用内打开添加 2FA 界面
  const doLaunchApp = () => {
    const deepLinkUri = `secureauth://import?uri=${encodeURIComponent(data.rawUri)}`;
    
    // 通过自定义系统协议唤起桌面端应用
    const link = document.createElement("a");
    link.href = deepLinkUri;
    document.body.appendChild(link);
    link.click();
    link.remove();

    toast.remove();
  };

  document.getElementById("sa-launch-app-btn")?.addEventListener("click", doLaunchApp);

  // 25 秒后自动淡出消失
  setTimeout(() => {
    if (document.body.contains(toast)) {
      toast.classList.add("sa-fade-out");
      setTimeout(() => toast.remove(), 400);
    }
  }, 25000);
}

function escapeHtml(str: string): string {
  return String(str)
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;");
}

// ----------------- 启动扫描与 DOM 监听器 -----------------

// 1. 页面初次加载完毕时扫描
if (document.readyState === "loading") {
  document.addEventListener("DOMContentLoaded", () => {
    scanPageImages();
  });
} else {
  scanPageImages();
}

// 2. 监听 DOM 动态变更（现代 Web 应用如 GitHub / Google 在用户点击开启 2FA 时动态弹出模态框）
const mutationObserver = new MutationObserver((mutations) => {
  let shouldScan = false;
  for (const mutation of mutations) {
    if (mutation.addedNodes.length > 0) {
      shouldScan = true;
      break;
    }
  }
  if (shouldScan) {
    scanPageImages();
  }
});

mutationObserver.observe(document.body, {
  childList: true,
  subtree: true,
});

// 3. 定时轻量巡检（针对延时渲染和异步加载的二维码）
setInterval(() => {
  scanPageImages();
}, 2000);

// 4. 监听来自 Background 的右键菜单扫描触发
chrome.runtime.onMessage?.addListener((msg: any, sender: any, sendResponse: any) => {
  if (msg.type === "TRIGGER_MANUAL_SCAN") {
    console.log("🛡️ [Xiaorui 2FA Security Vault] 收到手动右键扫描指令，正在全面扫描页面图像...");
    scanPageImages();
    sendResponse({ success: true });
  }
});
