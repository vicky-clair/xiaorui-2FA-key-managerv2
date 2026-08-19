export type PlanType = "free" | "pro";

export interface EntitlementInfo {
  plan: PlanType;
  maxEntries: number; // 10 for free, -1 for unlimited pro
  canUseWindowsHello: boolean;
  canUseBrowserAutofill: boolean;
  canUseEncryptedBackup: boolean;
  licenseKey?: string;
}

export class FreeLimitReachedError extends Error {
  constructor(message = "Free tier limit of 10 accounts reached. Upgrade to Pro for unlimited 2FA accounts.") {
    super(message);
    this.name = "FreeLimitReachedError";
  }
}

export class ProFeatureRequiredError extends Error {
  constructor(message = "This feature requires a PRO subscription.") {
    super(message);
    this.name = "ProFeatureRequiredError";
  }
}

export class EntitlementService {
  private plan: PlanType = "free";
  private licenseKey?: string;

  constructor(initialPlan: PlanType = "free") {
    this.plan = initialPlan;
    this.loadPersistedPlan();
  }

  private loadPersistedPlan(): void {
    try {
      if (typeof window !== "undefined" && window.localStorage) {
        const savedPlan = window.localStorage.getItem("sa_user_plan") as PlanType | null;
        if (savedPlan === "pro" || savedPlan === "free") {
          this.plan = savedPlan;
          this.licenseKey = window.localStorage.getItem("sa_license_key") || undefined;
        }
      }
    } catch {}
  }

  public getPlan(): PlanType {
    return this.plan;
  }

  public isPro(): boolean {
    return this.plan === "pro";
  }

  public setPlan(plan: PlanType): void {
    this.plan = plan;
    try {
      if (typeof window !== "undefined" && window.localStorage) {
        window.localStorage.setItem("sa_user_plan", plan);
      }
    } catch {}
  }

  public activateLicense(key: string): { success: boolean; message: string } {
    const trimmed = key.trim().toUpperCase();
    if (!trimmed) {
      return { success: false, message: "请输入有效的授权激活码" };
    }

    // Accept valid commercial format or key: e.g. PRO-XXXX-XXXX or VIP or any 6+ char license
    if (trimmed.startsWith("PRO") || trimmed.includes("2FAS") || trimmed.includes("VIP") || trimmed.length >= 6) {
      this.plan = "pro";
      this.licenseKey = trimmed;
      try {
        if (typeof window !== "undefined" && window.localStorage) {
          window.localStorage.setItem("sa_user_plan", "pro");
          window.localStorage.setItem("sa_license_key", trimmed);
        }
      } catch {}
      return { success: true, message: "商业版 Pro 永久授权激活成功！已解锁无限 2FA 账号与全部高级特权！" };
    }

    return { success: false, message: "无效的激活码。格式示例: PRO-2FAS-8888" };
  }

  public resetToFree(): void {
    this.plan = "free";
    this.licenseKey = undefined;
    try {
      if (typeof window !== "undefined" && window.localStorage) {
        window.localStorage.setItem("sa_user_plan", "free");
        window.localStorage.removeItem("sa_license_key");
      }
    } catch {}
  }

  public getEntitlements(): EntitlementInfo {
    const isPro = this.plan === "pro";
    return {
      plan: this.plan,
      maxEntries: isPro ? -1 : 10,
      canUseWindowsHello: isPro,
      canUseBrowserAutofill: isPro,
      canUseEncryptedBackup: isPro, // Exclusively gated for Pro members
      licenseKey: this.licenseKey,
    };
  }

  /**
   * Checks whether a new entry can be added given the current total count.
   */
  public canAddEntry(currentCount: number): boolean {
    const { maxEntries } = this.getEntitlements();
    if (maxEntries === -1) return true;
    return currentCount < maxEntries;
  }

  /**
   * Checks whether the user is entitled to export encrypted backups.
   */
  public canExportBackup(): boolean {
    return this.isPro();
  }

  /**
   * Asserts that a new entry can be added; throws FreeLimitReachedError if exceeded.
   */
  public assertCanAddEntry(currentCount: number): void {
    if (!this.canAddEntry(currentCount)) {
      throw new FreeLimitReachedError();
    }
  }

  /**
   * Asserts that the user can export backup; throws ProFeatureRequiredError if on Free tier.
   */
  public assertCanExportBackup(): void {
    if (!this.canExportBackup()) {
      throw new ProFeatureRequiredError("Exporting encrypted backup is a PRO exclusive feature.");
    }
  }
}

export const defaultEntitlementService = new EntitlementService("free");
