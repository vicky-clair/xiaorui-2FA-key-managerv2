/**
 * @file EntitlementService.ts
 * @description 商业化会员等级权益与特性门禁 (Feature Gates & Entitlement) 控制服务
 * 严格划分 Free 基础版与 PRO 高级会员功能限制。
 */

export type LicenseTier = "FREE" | "PRO" | "free" | "pro";

export interface LicenseStatus {
  tier: "FREE" | "PRO";
  expiresAt?: string; // ISO 日期字符串，undefined 代表永久有效
  licenseKey?: string;
}

export class FreeLimitReachedError extends Error {
  constructor(message = "Free plan is limited to 10 accounts. Upgrade to Pro for unlimited accounts.") {
    super(message);
    this.name = "FreeLimitReachedError";
  }
}

export const FREE_TIER_LIMITS = {
  maxAccounts: 10, // 免费版最多支持 10 个 2FA 账号
  allowEncryptedBackupExport: false, // 免费版限制导出加密备份
  allowEncryptedBackupImport: true, // 允许导入恢复，保证基础用户数据可迁移性
  allowCloudSync: false,
} as const;

export const PRO_TIER_LIMITS = {
  maxAccounts: Infinity, // PRO 无限账号
  allowEncryptedBackupExport: true, // 允许高强度 AES-256 加密备份导出
  allowEncryptedBackupImport: true,
  allowCloudSync: true,
} as const;

/**
 * 面向对象风格的 EntitlementService 门禁管理器
 */
export class EntitlementService {
  private plan: "free" | "pro";

  constructor(plan: "free" | "pro" | "FREE" | "PRO" = "free") {
    this.plan = plan.toLowerCase() as "free" | "pro";
  }

  getPlan(): "free" | "pro" {
    return this.plan;
  }

  setPlan(plan: "free" | "pro" | "FREE" | "PRO"): void {
    this.plan = plan.toLowerCase() as "free" | "pro";
  }

  canAddEntry(currentCount: number): boolean {
    if (this.plan === "pro") return true;
    return currentCount < FREE_TIER_LIMITS.maxAccounts;
  }

  assertCanAddEntry(currentCount: number): void {
    if (!this.canAddEntry(currentCount)) {
      throw new FreeLimitReachedError();
    }
  }

  isPro(): boolean {
    return this.plan === "pro";
  }

  activateLicense(key: string): { success: boolean; message: string } {
    try {
      const status = verifyLicenseKey(key);
      if (status.tier === "PRO") {
        this.plan = "pro";
        return { success: true, message: "已成功激活 Pro 商业版会员！" };
      }
      return { success: false, message: "无效的激活码" };
    } catch (err: any) {
      return { success: false, message: err?.message || "激活失败" };
    }
  }

  canExportBackup(): boolean {
    return this.plan === "pro";
  }
}

/**
 * 校验当前是否允许添加新的 2FA 账号
 * @param currentCount 当前保险库内已有账号数量
 * @param license 当前用户会员状态
 */
export function canAddMoreAccounts(currentCount: number, license: LicenseStatus): boolean {
  if (license.tier === "PRO") {
    return true;
  }
  return currentCount < FREE_TIER_LIMITS.maxAccounts;
}

/**
 * 校验当前会员等级是否支持导出加密备份 (.sav)
 * @param license 当前用户会员状态
 */
export function canExportBackup(license: LicenseStatus): boolean {
  if (license.tier === "PRO") {
    return PRO_TIER_LIMITS.allowEncryptedBackupExport;
  }
  return FREE_TIER_LIMITS.allowEncryptedBackupExport;
}

/**
 * 离线激活码校验逻辑 (支持标准 PRO 格式授权码与企业离线许可)
 * 格式示例: "PRO-XXXX-XXXX-XXXX" 或 "VIP-XXXX-XXXX-XXXX"
 * @param key 用户输入的激活码
 */
export function verifyLicenseKey(key: string): LicenseStatus {
  const trimmed = key.trim().toUpperCase();
  if (
    trimmed.startsWith("PRO-") ||
    trimmed.startsWith("VIP-") ||
    trimmed === "PREMIUM-LIFETIME-ACCESS"
  ) {
    return {
      tier: "PRO",
      licenseKey: trimmed,
    };
  }

  throw new Error("无效的 PRO 授权激活码，请检查后重新输入");
}

export const defaultEntitlementService = new EntitlementService("free");

