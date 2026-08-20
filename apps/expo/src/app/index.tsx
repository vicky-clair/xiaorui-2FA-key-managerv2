import { useEffect, useMemo, useRef, useState } from "react";
import {
  ActivityIndicator,
  Modal,
  Platform,
  Pressable,
  ScrollView,
  StyleSheet,
  TextInput,
  View,
  useWindowDimensions,
} from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";
import { useTranslation } from "react-i18next";

import { ThemedText } from "@/components/themed-text";
import { Spacing } from "@/constants/theme";
import { useTheme } from "@/hooks/use-theme";
import { useThemePreference } from "@/providers/ThemePreferenceProvider";

// Import core crypto, services and storage
import {
  base32ToUint8Array,
  createEncryptedBackup,
  createEncryptedEntry,
  createVault,
  decryptEntryPayload,
  defaultEntitlementService,
  generateTOTP,
  getPeriodProgress,
  getRemainingSeconds,
  parseOtpAuthUri,
  restoreEncryptedBackup,
  unlockVault as unlockVaultCore,
  wipeBytes,
  type BackupEntryItem,
  type EntryPayload,
  type OTPAlgorithm,
  type VaultMetadata,
} from "@sa/core";
import {
  AuthenticatorEntryRepository,
  VaultRepository,
  createDatabase,
} from "@sa/storage";
import { useDatabase } from "@/providers/DatabaseProvider";

type AppState = "loading" | "setup" | "unlock" | "dashboard";

interface DisplayEntry {
  id: string;
  vaultId: string;
  createdAt: string;
  favorite: boolean;
  payload: EntryPayload;
  totpCode: string;
  remainingSeconds: number;
  progress: number;
}

// Curated modern color palettes for service avatar badges
const SERVICE_GRADIENTS: [string, string][] = [
  ["#3b82f6", "#1d4ed8"], // Sapphire Blue
  ["#10b981", "#047857"], // Emerald Green
  ["#8b5cf6", "#6d28d9"], // Royal Purple
  ["#f59e0b", "#b45309"], // Amber Orange
  ["#ec4899", "#be185d"], // Rose Pink
  ["#06b6d4", "#0e7490"], // Electric Cyan
  ["#6366f1", "#4338ca"], // Cyber Indigo
  ["#14b8a6", "#0f766e"], // Teal
];

function getServiceColor(name: string): [string, string] {
  let hash = 0;
  for (let i = 0; i < name.length; i++) {
    hash = name.charCodeAt(i) + ((hash << 5) - hash);
  }
  const index = Math.abs(hash) % SERVICE_GRADIENTS.length;
  return SERVICE_GRADIENTS[index];
}

/**
 * Formats ISO timestamp to human-friendly local datetime string: e.g. 2026/08/19 22:30
 */
function formatAddedDate(isoString?: string): string {
  if (!isoString) return "";
  try {
    const d = new Date(isoString);
    if (isNaN(d.getTime())) return "";
    const y = d.getFullYear();
    const m = String(d.getMonth() + 1).padStart(2, "0");
    const day = String(d.getDate()).padStart(2, "0");
    const h = String(d.getHours()).padStart(2, "0");
    const min = String(d.getMinutes()).padStart(2, "0");
    return `${y}/${m}/${day} ${h}:${min}`;
  } catch {
    return "";
  }
}

/**
 * Downloads backup file to disk via web blob
 */
function downloadBackupBlob(content: string, filename: string) {
  if (typeof document !== "undefined") {
    const blob = new Blob([content], { type: "application/json" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = filename;
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    URL.revokeObjectURL(url);
  }
}

/**
 * Calculates dynamic progress bar and badge colors based on percentage:
 * - > 50%: Emerald Green 🟢 (#10b981)
 * - 25% - 50%: Sapphire Blue 🔵 (#3b82f6)
 * - 10% - 25%: Warm Amber Yellow 🟡 (#f59e0b)
 * - < 10% (last 3-5s): Alert Crimson Red 🔴 (#ef4444)
 */
function getProgressColor(remainingSeconds: number, period: number = 30): {
  barColor: string;
  glowColor: string;
  textColor: string;
  badgeBg: string;
  badgeBorder: string;
} {
  const percentage = (remainingSeconds / period) * 100;
  if (percentage >= 50) {
    return {
      barColor: "#10b981",
      glowColor: "rgba(16, 185, 129, 0.4)",
      textColor: "#10b981",
      badgeBg: "rgba(16, 185, 129, 0.12)",
      badgeBorder: "rgba(16, 185, 129, 0.3)",
    };
  } else if (percentage >= 25) {
    return {
      barColor: "#3b82f6",
      glowColor: "rgba(59, 130, 246, 0.4)",
      textColor: "#3b82f6",
      badgeBg: "rgba(59, 130, 246, 0.12)",
      badgeBorder: "rgba(59, 130, 246, 0.3)",
    };
  } else if (percentage >= 10) {
    return {
      barColor: "#f59e0b",
      glowColor: "rgba(245, 158, 11, 0.4)",
      textColor: "#f59e0b",
      badgeBg: "rgba(245, 158, 11, 0.14)",
      badgeBorder: "rgba(245, 158, 11, 0.35)",
    };
  } else {
    return {
      barColor: "#ef4444",
      glowColor: "rgba(239, 68, 68, 0.5)",
      textColor: "#ef4444",
      badgeBg: "rgba(239, 68, 68, 0.16)",
      badgeBorder: "rgba(239, 68, 68, 0.4)",
    };
  }
}

export default function HomeScreen() {
  const { t } = useTranslation();
  const theme = useTheme();
  const { isDark, toggleColorScheme } = useThemePreference();
  const { width } = useWindowDimensions();

  // Dynamic responsive breakpoint helpers
  const isCompact = width < 680;
  const isUltraCompact = width < 480;

  const [appState, setAppState] = useState<AppState>("loading");
  const [password, setPassword] = useState("");
  const [confirmPassword, setConfirmPassword] = useState("");
  const [formError, setFormError] = useState<string | null>(null);
  const [vaults, setVaults] = useState<VaultMetadata[]>([]);
  const [activeVault, setActiveVault] = useState<VaultMetadata | null>(null);
  const [vaultKey, setVaultKey] = useState<Uint8Array | null>(null);
  const [loading, setLoading] = useState(false);

  // 2FA Entries & Search State
  const [entries, setEntries] = useState<DisplayEntry[]>([]);
  const [searchQuery, setSearchQuery] = useState("");
  const [showAddModal, setShowAddModal] = useState(false);
  const [copiedId, setCopiedId] = useState<string | null>(null);

  // Pro Membership State
  const [isProUser, setIsProUser] = useState<boolean>(() => defaultEntitlementService.isPro());
  const [showProModal, setShowProModal] = useState(false);
  const [licenseInput, setLicenseInput] = useState("");
  const [proModalMsg, setProModalMsg] = useState<{ type: "success" | "error"; text: string } | null>(null);

  // Export Backup State (Pro Only)
  const [showExportModal, setShowExportModal] = useState(false);
  const [exportPassword, setExportPassword] = useState("");
  const [confirmExportPassword, setConfirmExportPassword] = useState("");
  const [exportError, setExportError] = useState<string | null>(null);
  const [exportSuccessMsg, setExportSuccessMsg] = useState<string | null>(null);
  const [exporting, setExporting] = useState(false);

  // Import Backup State
  const [showImportModal, setShowImportModal] = useState(false);
  const [importFileContent, setImportFileContent] = useState("");
  const [importPassword, setImportPassword] = useState("");
  const [importError, setImportError] = useState<string | null>(null);
  const [importSuccessMsg, setImportSuccessMsg] = useState<string | null>(null);
  const [importing, setImporting] = useState(false);

  // Auto-Lock Configuration (Minutes: 1, 5, 15, 30, 0 for never)
  const [autoLockMinutes, setAutoLockMinutes] = useState<number>(() => {
    try {
      if (typeof window !== "undefined" && window.localStorage) {
        const val = window.localStorage.getItem("sa_autolock_minutes");
        if (val !== null) return parseInt(val, 10);
      }
    } catch {}
    return 5; // Default 5 minutes
  });
  const [showAutoLockModal, setShowAutoLockModal] = useState(false);

  // Add 2FA Form
  const [secretOrUri, setSecretOrUri] = useState("");
  const [accountName, setAccountName] = useState("");
  const [addModalError, setAddModalError] = useState<string | null>(null);
  const [addingSaving, setAddingSaving] = useState(false);

  // Auto-lock timer ref
  const inactivityTimerRef = useRef<NodeJS.Timeout | null>(null);
  const lastCopiedCodeRef = useRef<string | null>(null);

  const { isInitialized, error: dbError } = useDatabase();

  const resetInactivityTimer = () => {
    if (inactivityTimerRef.current) {
      clearTimeout(inactivityTimerRef.current);
    }
    if (appState === "dashboard" && vaultKey && autoLockMinutes > 0) {
      inactivityTimerRef.current = setTimeout(() => {
        handleLockVault();
      }, autoLockMinutes * 60 * 1000);
    }
  };

  // Global activity listener for desktop mouse / keyboard / touch
  useEffect(() => {
    if (appState !== "dashboard" || !vaultKey || autoLockMinutes === 0) return;

    const handleUserActivity = () => {
      resetInactivityTimer();
    };

    if (typeof window !== "undefined") {
      window.addEventListener("mousemove", handleUserActivity, { passive: true });
      window.addEventListener("mousedown", handleUserActivity, { passive: true });
      window.addEventListener("keydown", handleUserActivity, { passive: true });
      window.addEventListener("touchstart", handleUserActivity, { passive: true });
      window.addEventListener("scroll", handleUserActivity, { passive: true });
    }

    resetInactivityTimer();

    return () => {
      if (inactivityTimerRef.current) {
        clearTimeout(inactivityTimerRef.current);
      }
      if (typeof window !== "undefined") {
        window.removeEventListener("mousemove", handleUserActivity);
        window.removeEventListener("mousedown", handleUserActivity);
        window.removeEventListener("keydown", handleUserActivity);
        window.removeEventListener("touchstart", handleUserActivity);
        window.removeEventListener("scroll", handleUserActivity);
      }
    };
  }, [appState, vaultKey, autoLockMinutes]);

  const pendingDeepLinkUriRef = useRef<string | null>(null);

  const triggerImportFromUri = (rawUri: string) => {
    try {
      let target = rawUri.trim();
      if (target.includes("?uri=")) {
        const idx = target.indexOf("?uri=");
        target = decodeURIComponent(target.substring(idx + 5));
      }
      if (target.startsWith("otpauth%3A%2F%2F") || target.startsWith("otpauth%3a%2f%2f")) {
        target = decodeURIComponent(target);
      }
      if (target.toLowerCase().startsWith("otpauth://")) {
        const parsed = parseOtpAuthUri(target);
        setSecretOrUri(parsed.secret);
        setAccountName(parsed.account || parsed.issuer || "");
      } else {
        setSecretOrUri(target);
      }
      setAddModalError(null);
      setShowAddModal(true);
    } catch {
      setSecretOrUri(rawUri);
      setAddModalError(null);
      setShowAddModal(true);
    }
  };

  useEffect(() => {
    if (typeof window !== "undefined") {
      const handleUri = (uri: string) => {
        if (appState === "dashboard" && vaultKey) {
          triggerImportFromUri(uri);
        } else {
          pendingDeepLinkUriRef.current = uri;
        }
      };

      (window as any).__onDeepLink = handleUri;
      if ((window as any).__pendingDeepLinkUri) {
        handleUri((window as any).__pendingDeepLinkUri);
        (window as any).__pendingDeepLinkUri = null;
      }
    }
  }, [appState, vaultKey]);

  useEffect(() => {
    if (isInitialized) {
      loadVaults();
    }
  }, [isInitialized]);

  // Real-time TOTP clock update effect
  useEffect(() => {
    if (appState !== "dashboard" || !vaultKey || entries.length === 0) return;

    const interval = setInterval(async () => {
      const now = Date.now();
      const updated = await Promise.all(
        entries.map(async (item) => {
          try {
            const code = await generateTOTP(
              item.payload.secret,
              now,
              item.payload.period || 30,
              item.payload.digits || 6,
              item.payload.algorithm || "SHA1"
            );
            const remaining = getRemainingSeconds(item.payload.period || 30, now);
            const progress = getPeriodProgress(item.payload.period || 30, now);
            return {
              ...item,
              totpCode: code,
              remainingSeconds: remaining,
              progress,
            };
          } catch {
            return item;
          }
        })
      );
      setEntries(updated);
    }, 1000);

    return () => clearInterval(interval);
  }, [appState, vaultKey, entries.length]);

  // Filter entries based on search query
  const filteredEntries = useMemo(() => {
    if (!searchQuery.trim()) return entries;
    const q = searchQuery.toLowerCase().trim();
    return entries.filter(
      (e) =>
        e.payload.issuer.toLowerCase().includes(q) ||
        (e.payload.account && e.payload.account.toLowerCase().includes(q))
    );
  }, [entries, searchQuery]);

  const loadVaults = async () => {
    setLoading(true);
    setFormError(null);
    try {
      const db = await createDatabase();
      const repo = new VaultRepository(db);
      const allVaults = await repo.getAllVaults();
      setVaults(allVaults);

      if (allVaults.length === 0) {
        setAppState("setup");
      } else {
        setActiveVault(allVaults[0]);
        setAppState("unlock");
      }
    } catch (err) {
      setFormError(err instanceof Error ? err.message : "Failed to load vaults");
    } finally {
      setLoading(false);
    }
  };

  const loadEntries = async (currentVaultId: string, currentKey: Uint8Array) => {
    try {
      const db = await createDatabase();
      const entryRepo = new AuthenticatorEntryRepository(db);
      const rawEntries = await entryRepo.getEntriesByVaultId(currentVaultId);

      const now = Date.now();
      const decryptedList: DisplayEntry[] = [];

      for (const item of rawEntries) {
        try {
          const payload = await decryptEntryPayload(item, currentKey);
          const code = await generateTOTP(
            payload.secret,
            now,
            payload.period || 30,
            payload.digits || 6,
            payload.algorithm || "SHA1"
          );
          const remaining = getRemainingSeconds(payload.period || 30, now);
          const progress = getPeriodProgress(payload.period || 30, now);

          decryptedList.push({
            id: item.id,
            vaultId: item.vaultId,
            createdAt: item.createdAt,
            favorite: Boolean(item.favorite),
            payload,
            totpCode: code,
            remainingSeconds: remaining,
            progress,
          });
        } catch {}
      }

      setEntries(decryptedList);
    } catch (err) {
      console.error("Failed to load entries:", err);
    }
  };

  const handleSetupVault = async () => {
    setFormError(null);
    const trimmedPassword = password.trim();
    const trimmedConfirm = confirmPassword.trim();

    if (!trimmedPassword) {
      setFormError(t("enterPassword"));
      return;
    }
    if (trimmedPassword.length < 6) {
      setFormError("密码长度至少为 6 个字符 (Minimum 6 characters)");
      return;
    }
    if (trimmedPassword !== trimmedConfirm) {
      setFormError(t("passwordsDoNotMatch"));
      return;
    }

    setLoading(true);
    try {
      const newVault = await createVault(trimmedPassword, "My Vault");
      const db = await createDatabase();
      const repo = new VaultRepository(db);
      await repo.createVault(newVault);

      const derivedKey = await unlockVaultCore(trimmedPassword, newVault);
      setVaultKey(derivedKey);
      setActiveVault(newVault);

      setPassword("");
      setConfirmPassword("");
      setFormError(null);
      setAppState("dashboard");

      const allVaults = await repo.getAllVaults();
      setVaults(allVaults);
      await loadEntries(newVault.id, derivedKey);

      if (pendingDeepLinkUriRef.current) {
        const pUri = pendingDeepLinkUriRef.current;
        pendingDeepLinkUriRef.current = null;
        setTimeout(() => triggerImportFromUri(pUri), 150);
      }
    } catch (err) {
      setFormError(err instanceof Error ? err.message : "Failed to create vault");
    } finally {
      setLoading(false);
    }
  };

  const handleUnlockVault = async () => {
    setFormError(null);
    const trimmedPassword = password.trim();

    if (!trimmedPassword) {
      setFormError(t("enterPassword"));
      return;
    }

    setLoading(true);
    try {
      const targetVault = activeVault || vaults[0];
      if (!targetVault) {
        setFormError("No vault found");
        return;
      }

      const key = await unlockVaultCore(trimmedPassword, targetVault);
      if (key && key.length > 0) {
        setVaultKey(key);
        setActiveVault(targetVault);
        setPassword("");
        setFormError(null);
        setAppState("dashboard");
        await loadEntries(targetVault.id, key);

        if (pendingDeepLinkUriRef.current) {
          const pUri = pendingDeepLinkUriRef.current;
          pendingDeepLinkUriRef.current = null;
          setTimeout(() => triggerImportFromUri(pUri), 150);
        }
      } else {
        setFormError(t("invalidPassword"));
      }
    } catch {
      setFormError(t("invalidPassword"));
    } finally {
      setLoading(false);
    }
  };

  const handleLockVault = () => {
    if (vaultKey) {
      wipeBytes(vaultKey);
    }
    setVaultKey(null);
    setEntries([]);
    setPassword("");
    setConfirmPassword("");
    setFormError(null);
    setSearchQuery("");
    setAppState("unlock");
  };

  const handleChangeAutoLockTime = (minutes: number) => {
    setAutoLockMinutes(minutes);
    try {
      if (typeof window !== "undefined" && window.localStorage) {
        window.localStorage.setItem("sa_autolock_minutes", String(minutes));
      }
    } catch {}
    setShowAutoLockModal(false);
  };

  const handleSaveNewAccount = async () => {
    resetInactivityTimer();
    setAddModalError(null);

    if (!defaultEntitlementService.canAddEntry(entries.length)) {
      setAddModalError("免费版已达 10 个账号上限，请点击右上角「解锁会员」升级至 Pro 无限版！");
      return;
    }

    let rawInput = secretOrUri.trim();
    if (!rawInput) {
      setAddModalError("请粘贴 2FA 密钥代码或链接");
      return;
    }

    if (rawInput.includes("?uri=")) {
      const idx = rawInput.indexOf("?uri=");
      rawInput = decodeURIComponent(rawInput.substring(idx + 5));
    }
    if (rawInput.startsWith("otpauth%3A%2F%2F") || rawInput.startsWith("otpauth%3a%2f%2f")) {
      rawInput = decodeURIComponent(rawInput);
    }

    let finalSecret = rawInput;
    let finalIssuer = accountName.trim();
    let finalAccount = "";
    let finalAlgorithm: OTPAlgorithm = "SHA1";
    let finalPeriod = 30;
    let finalDigits = 6;

    if (rawInput.toLowerCase().startsWith("otpauth://")) {
      try {
        const parsed = parseOtpAuthUri(rawInput);
        finalSecret = parsed.secret;
        if (!finalIssuer) finalIssuer = parsed.issuer;
        finalAccount = parsed.account;
        finalAlgorithm = parsed.algorithm;
        finalPeriod = parsed.period;
        finalDigits = parsed.digits;
      } catch (err) {
        setAddModalError(err instanceof Error ? err.message : "无效的 otpauth 链接");
        return;
      }
    } else if (rawInput.includes("secret=")) {
      const match = rawInput.match(/secret=([A-Za-z0-9\-_=]+)/i);
      if (match) {
        finalSecret = match[1];
      }
    }

    finalSecret = finalSecret.replace(/[\s\-=_]/g, "").toUpperCase();
    if (!finalIssuer) {
      finalIssuer = "2FA Account";
    }

    try {
      base32ToUint8Array(finalSecret);
    } catch {
      setAddModalError(t("secretInvalid"));
      return;
    }

    if (!vaultKey || !activeVault) {
      setAddModalError("Vault not unlocked");
      return;
    }

    setAddingSaving(true);
    try {
      const payload: EntryPayload = {
        issuer: finalIssuer,
        account: finalAccount || finalIssuer,
        secret: finalSecret,
        algorithm: finalAlgorithm,
        digits: finalDigits,
        period: finalPeriod,
      };

      const encryptedRecord = await createEncryptedEntry(
        payload,
        activeVault.id,
        vaultKey
      );

      const db = await createDatabase();
      const entryRepo = new AuthenticatorEntryRepository(db);
      await entryRepo.createEntry(encryptedRecord);

      setSecretOrUri("");
      setAccountName("");
      setShowAddModal(false);

      await loadEntries(activeVault.id, vaultKey);
    } catch (err) {
      setAddModalError(err instanceof Error ? err.message : "Failed to save entry");
    } finally {
      setAddingSaving(false);
    }
  };

  const handleDeleteEntry = async (id: string) => {
    resetInactivityTimer();
    if (!activeVault || !vaultKey) return;
    try {
      const db = await createDatabase();
      const entryRepo = new AuthenticatorEntryRepository(db);
      await entryRepo.deleteEntry(id);
      await loadEntries(activeVault.id, vaultKey);
    } catch (err) {
      console.error("Failed to delete entry:", err);
    }
  };

  const handleCopyCode = (id: string, code: string) => {
    resetInactivityTimer();
    lastCopiedCodeRef.current = code;

    if (typeof navigator !== "undefined" && navigator.clipboard) {
      navigator.clipboard.writeText(code);

      setTimeout(async () => {
        try {
          if (navigator.clipboard.readText) {
            const currentClip = await navigator.clipboard.readText();
            if (currentClip === code) {
              await navigator.clipboard.writeText("");
            }
          }
        } catch {}
      }, 30000);
    }

    setCopiedId(id);
    setTimeout(() => {
      setCopiedId((prev) => (prev === id ? null : prev));
    }, 2000);
  };

  // Handle Pro License Activation
  const handleActivateLicense = (codeToActivate?: string) => {
    setProModalMsg(null);
    const key = codeToActivate || licenseInput;
    const res = defaultEntitlementService.activateLicense(key);
    if (res.success) {
      setIsProUser(true);
      setProModalMsg({ type: "success", text: res.message });
      setTimeout(() => {
        setShowProModal(false);
      }, 1500);
    } else {
      setProModalMsg({ type: "error", text: res.message });
    }
  };

  // Handle Click Export Backup Button (Pro Gate Check)
  const handleOpenExportModal = () => {
    resetInactivityTimer();
    setExportError(null);
    setExportSuccessMsg(null);
    setExportPassword("");
    setConfirmExportPassword("");

    // Pro Gate check
    if (!defaultEntitlementService.canExportBackup()) {
      setProModalMsg({ type: "error", text: t("exportProOnlyWarning") });
      setShowProModal(true);
      return;
    }

    setShowExportModal(true);
  };

  // Handle Execute Encrypted Backup Export
  const handleExecuteExportBackup = async () => {
    setExportError(null);
    setExportSuccessMsg(null);

    if (!defaultEntitlementService.canExportBackup()) {
      setExportError(t("exportProOnlyWarning"));
      return;
    }

    const trimmedPwd = exportPassword.trim();
    const trimmedConfirm = confirmExportPassword.trim();

    if (!trimmedPwd) {
      setExportError(t("enterPassword"));
      return;
    }
    if (trimmedPwd.length < 6) {
      setExportError("备份密码长度至少为 6 位 (Minimum 6 characters)");
      return;
    }
    if (trimmedPwd !== trimmedConfirm) {
      setExportError(t("passwordsDoNotMatch"));
      return;
    }

    if (entries.length === 0) {
      setExportError("当前保险库无任何 2FA 账号可导出");
      return;
    }

    setExporting(true);
    try {
      const backupItems: BackupEntryItem[] = entries.map((e) => ({
        ...e.payload,
        favorite: e.favorite,
      }));

      const savContent = await createEncryptedBackup(
        backupItems,
        trimmedPwd,
        activeVault?.name || "My Vault"
      );

      const now = new Date();
      const dateStr = `${now.getFullYear()}${String(now.getMonth() + 1).padStart(2, "0")}${String(now.getDate()).padStart(2, "0")}`;
      const filename = `2fas-backup-${dateStr}.sav`;

      downloadBackupBlob(savContent, filename);

      setExportSuccessMsg(t("exportSuccess"));
      setTimeout(() => {
        setShowExportModal(false);
      }, 2000);
    } catch (err) {
      setExportError(err instanceof Error ? err.message : "导出失败");
    } finally {
      setExporting(false);
    }
  };

  // Handle Pick Local .sav File for Import
  const handlePickLocalBackupFile = () => {
    if (typeof document === "undefined") return;
    const input = document.createElement("input");
    input.type = "file";
    input.accept = ".sav,.json,text/plain";
    input.onchange = async (e: any) => {
      const file = e.target.files?.[0];
      if (file) {
        const text = await file.text();
        setImportFileContent(text);
        if (importError) setImportError(null);
      }
    };
    input.click();
  };

  // Handle Execute Encrypted Backup Import
  const handleExecuteImportBackup = async () => {
    setImportError(null);
    setImportSuccessMsg(null);

    if (!vaultKey || !activeVault) {
      setImportError("保险库未解锁");
      return;
    }

    const content = importFileContent.trim();
    if (!content) {
      setImportError("请选择或粘贴 .sav 备份文件内容");
      return;
    }

    const pwd = importPassword.trim();
    if (!pwd) {
      setImportError(t("enterPassword"));
      return;
    }

    setImporting(true);
    try {
      const payload = await restoreEncryptedBackup(content, pwd);
      if (!payload.entries || payload.entries.length === 0) {
        setImportError("备份文件中未包含任何 2FA 账号");
        return;
      }

      // Check entitlement limit if free
      const newTotal = entries.length + payload.entries.length;
      if (!defaultEntitlementService.isPro() && newTotal > 10) {
        setImportError(`导入后总计 ${newTotal} 个账号，超过免费版 10 个上限，请先升级 Pro 商业版！`);
        return;
      }

      // Encrypt each restored item with current vault key and save
      const db = await createDatabase();
      const entryRepo = new AuthenticatorEntryRepository(db);

      for (const item of payload.entries) {
        const encryptedRecord = await createEncryptedEntry(
          {
            issuer: item.issuer,
            account: item.account || item.issuer,
            secret: item.secret,
            algorithm: item.algorithm || "SHA1",
            digits: item.digits || 6,
            period: item.period || 30,
          },
          activeVault.id,
          vaultKey,
          { favorite: item.favorite }
        );
        await entryRepo.createEntry(encryptedRecord);
      }

      await loadEntries(activeVault.id, vaultKey);

      setImportSuccessMsg(`成功恢复并导入 ${payload.entries.length} 个 2FA 账号！`);
      setTimeout(() => {
        setShowImportModal(false);
        setImportFileContent("");
        setImportPassword("");
      }, 1800);
    } catch (err) {
      setImportError(err instanceof Error ? err.message : "解密失败：备份保护密码不正确或文件已损坏");
    } finally {
      setImporting(false);
    }
  };

  const dynamicStyles = StyleSheet.create({
    containerBg: {
      flex: 1,
      backgroundColor: theme.background,
    },
    input: {
      height: 48,
      borderWidth: 1,
      borderColor: formError ? "#ef4444" : theme.border,
      backgroundColor: theme.inputBackground,
      borderRadius: 12,
      paddingHorizontal: Spacing.four,
      color: theme.text,
      fontSize: 15,
      outlineStyle: "none",
    } as any,
    searchInput: {
      flex: 1,
      height: 44,
      borderWidth: 1,
      borderColor: isDark ? "rgba(255, 255, 255, 0.12)" : "rgba(0, 0, 0, 0.08)",
      backgroundColor: isDark ? "rgba(255, 255, 255, 0.05)" : "rgba(0, 0, 0, 0.03)",
      borderRadius: 11,
      paddingHorizontal: Spacing.three,
      color: theme.text,
      fontSize: 14,
      outlineStyle: "none",
      minWidth: 140,
    } as any,
    modalInput: {
      height: 46,
      borderWidth: 1,
      borderColor: theme.border,
      backgroundColor: theme.inputBackground,
      borderRadius: 10,
      paddingHorizontal: Spacing.three,
      color: theme.text,
      fontSize: 14,
      outlineStyle: "none",
    } as any,
    primaryButton: {
      height: 48,
      backgroundColor: "#2563eb",
      borderRadius: 12,
      justifyContent: "center",
      alignItems: "center",
      marginTop: Spacing.two,
      cursor: "pointer",
      shadowColor: "#2563eb",
      shadowOffset: { width: 0, height: 4 },
      shadowOpacity: 0.25,
      shadowRadius: 8,
    } as any,
    // Row 2 Primary Add Action Button
    addAccountBtn: {
      height: 44,
      paddingHorizontal: isCompact ? 14 : 18,
      backgroundColor: "#2563eb",
      borderRadius: 11,
      flexDirection: "row",
      alignItems: "center",
      gap: 6,
      justifyContent: "center",
      cursor: "pointer",
      shadowColor: "#2563eb",
      shadowOffset: { width: 0, height: 3 },
      shadowOpacity: 0.35,
      shadowRadius: 8,
      flexShrink: 0,
    } as any,
    // Row 2 Action Bar Secondary Tool Buttons (Import / Export)
    actionToolBtn: {
      height: 44,
      flexDirection: "row",
      alignItems: "center",
      gap: 5,
      paddingHorizontal: isCompact ? 10 : 14,
      backgroundColor: isDark ? "rgba(255, 255, 255, 0.07)" : "rgba(0, 0, 0, 0.04)",
      borderWidth: 1,
      borderColor: isDark ? "rgba(255, 255, 255, 0.12)" : "rgba(0, 0, 0, 0.08)",
      borderRadius: 11,
      justifyContent: "center",
      cursor: "pointer",
      flexShrink: 0,
      shadowColor: "#000",
      shadowOffset: { width: 0, height: 1 },
      shadowOpacity: 0.05,
      shadowRadius: 3,
    } as any,
    // Row 1 System Top Bar Pill Buttons
    headerBtnPro: {
      flexDirection: "row",
      alignItems: "center",
      gap: 4,
      paddingHorizontal: isCompact ? 8 : 11,
      paddingVertical: 6,
      backgroundColor: isProUser ? "rgba(16, 185, 129, 0.15)" : "rgba(245, 158, 11, 0.15)",
      borderWidth: 1,
      borderColor: isProUser ? "rgba(16, 185, 129, 0.4)" : "rgba(245, 158, 11, 0.4)",
      borderRadius: 8,
      justifyContent: "center",
      cursor: "pointer",
      flexShrink: 0,
    } as any,
    headerBtnPill: {
      flexDirection: "row",
      alignItems: "center",
      gap: 4,
      paddingHorizontal: isCompact ? 7 : 10,
      paddingVertical: 6,
      backgroundColor: isDark ? "rgba(255, 255, 255, 0.07)" : "rgba(0, 0, 0, 0.04)",
      borderWidth: 1,
      borderColor: theme.border,
      borderRadius: 8,
      justifyContent: "center",
      cursor: "pointer",
      flexShrink: 0,
    } as any,
    headerBtnDanger: {
      flexDirection: "row",
      alignItems: "center",
      gap: 3,
      paddingHorizontal: isCompact ? 8 : 11,
      paddingVertical: 6,
      backgroundColor: theme.dangerBg,
      borderWidth: 1,
      borderColor: theme.dangerBorder,
      borderRadius: 8,
      justifyContent: "center",
      cursor: "pointer",
      flexShrink: 0,
    } as any,
    cardSurface: {
      backgroundColor: theme.card,
      borderWidth: 1,
      borderColor: theme.cardBorder,
      borderRadius: 16,
    },
    noticeCard: {
      backgroundColor: isDark ? "rgba(30, 41, 59, 0.7)" : "rgba(241, 245, 249, 0.85)",
      borderColor: isDark ? "rgba(59, 130, 246, 0.25)" : "rgba(37, 99, 235, 0.18)",
      borderWidth: 1,
      borderRadius: 14,
    },
  });

  // 1. Loading Screen
  if (appState === "loading" || !isInitialized) {
    return (
      <View style={[dynamicStyles.containerBg, styles.centered]}>
        <ActivityIndicator size="large" color="#3b82f6" />
        {dbError && (
          <ThemedText style={{ color: "#ef4444", marginTop: Spacing.two }}>
            Database Error: {dbError.message}
          </ThemedText>
        )}
      </View>
    );
  }

  // 2. Setup Master Password Screen (First Time)
  if (appState === "setup") {
    return (
      <View style={[dynamicStyles.containerBg, styles.authWrapper]}>
        <SafeAreaView style={styles.authSafeArea}>
          <ScrollView
            contentContainerStyle={styles.authScrollContent}
            showsVerticalScrollIndicator={false}
          >
            <View style={styles.brandingHeader}>
              <View style={styles.shieldEmblem}>
                <ThemedText style={{ fontSize: 40 }}>🛡️</ThemedText>
              </View>
              <ThemedText type="title" style={styles.authTitle}>
                {t("setupVault")}
              </ThemedText>
              <ThemedText style={[styles.authSubtitle, { color: theme.textSecondary }]}>
                {t("setupInstructions")}
              </ThemedText>
            </View>

            <View style={[dynamicStyles.cardSurface, styles.card]}>
              <TextInput
                style={dynamicStyles.input}
                placeholder={t("masterPassword")}
                placeholderTextColor={theme.textDisabled}
                value={password}
                onChangeText={(val) => {
                  setPassword(val);
                  if (formError) setFormError(null);
                }}
                secureTextEntry
                returnKeyType="next"
                autoFocus
              />

              <TextInput
                style={dynamicStyles.input}
                placeholder={t("confirmPassword")}
                placeholderTextColor={theme.textDisabled}
                value={confirmPassword}
                onChangeText={(val) => {
                  setConfirmPassword(val);
                  if (formError) setFormError(null);
                }}
                secureTextEntry
                returnKeyType="done"
                onSubmitEditing={handleSetupVault}
              />

              {formError && (
                <View style={styles.errorBox}>
                  <ThemedText style={styles.errorText}>⚠️ {formError}</ThemedText>
                </View>
              )}

              <Pressable
                style={({ pressed }) => [
                  dynamicStyles.primaryButton,
                  pressed && { opacity: 0.8 },
                  loading && { opacity: 0.6 },
                ]}
                onPress={handleSetupVault}
                disabled={loading}
              >
                {loading ? (
                  <ActivityIndicator color="#ffffff" />
                ) : (
                  <ThemedText style={styles.primaryButtonText}>{t("createVault")}</ThemedText>
                )}
              </Pressable>
            </View>

            {/* 重要安全说明与备份须知 */}
            <View style={[dynamicStyles.noticeCard, styles.noticeCard]}>
              <View style={styles.noticeHeader}>
                <ThemedText style={{ fontSize: 15 }}>🛡️</ThemedText>
                <ThemedText style={[styles.noticeTitle, { color: isDark ? "#60a5fa" : "#2563eb" }]}>
                  {t("authNoticeTitle")}
                </ThemedText>
              </View>
              <View style={styles.noticeList}>
                <View style={styles.noticeItem}>
                  <ThemedText style={{ fontSize: 12.5, lineHeight: 18, color: theme.textSecondary }}>
                    <ThemedText style={{ fontWeight: "700", color: isDark ? "#93c5fd" : "#1d4ed8" }}>
                      🔒 {t("noticeLocalTitle")}
                    </ThemedText>
                    {t("noticeLocalDesc")}
                  </ThemedText>
                </View>
                <View style={styles.noticeItem}>
                  <ThemedText style={{ fontSize: 12.5, lineHeight: 18, color: theme.textSecondary }}>
                    <ThemedText style={{ fontWeight: "700", color: isDark ? "#fca5a5" : "#dc2626" }}>
                      ⚠️ {t("noticePasswordTitle")}
                    </ThemedText>
                    {t("noticePasswordDesc")}
                  </ThemedText>
                </View>
                <View style={styles.noticeItem}>
                  <ThemedText style={{ fontSize: 12.5, lineHeight: 18, color: theme.textSecondary }}>
                    <ThemedText style={{ fontWeight: "700", color: isDark ? "#fcd34d" : "#d97706" }}>
                      📦 {t("noticeBackupTitle")}
                    </ThemedText>
                    {t("noticeBackupDesc")}
                  </ThemedText>
                </View>
              </View>
            </View>
          </ScrollView>
        </SafeAreaView>
      </View>
    );
  }

  // 3. Unlock Vault Screen
  if (appState === "unlock") {
    return (
      <View style={[dynamicStyles.containerBg, styles.authWrapper]}>
        <SafeAreaView style={styles.authSafeArea}>
          <ScrollView
            contentContainerStyle={styles.authScrollContent}
            showsVerticalScrollIndicator={false}
          >
            <View style={styles.brandingHeader}>
              <View style={styles.shieldEmblem}>
                <ThemedText style={{ fontSize: 40 }}>🔐</ThemedText>
              </View>
              <ThemedText type="title" style={styles.authTitle}>
                {t("unlockVault")}
              </ThemedText>
              <ThemedText style={[styles.authSubtitle, { color: theme.textSecondary }]}>
                {t("unlockInstructions")}
              </ThemedText>
            </View>

            <View style={[dynamicStyles.cardSurface, styles.card]}>
              <TextInput
                style={dynamicStyles.input}
                placeholder={t("enterPassword")}
                placeholderTextColor={theme.textDisabled}
                value={password}
                onChangeText={(val) => {
                  setPassword(val);
                  if (formError) setFormError(null);
                }}
                secureTextEntry
                returnKeyType="done"
                onSubmitEditing={handleUnlockVault}
                autoFocus
              />

              {formError && (
                <View style={styles.errorBox}>
                  <ThemedText style={styles.errorText}>⚠️ {formError}</ThemedText>
                </View>
              )}

              <Pressable
                style={({ pressed }) => [
                  dynamicStyles.primaryButton,
                  pressed && { opacity: 0.8 },
                  loading && { opacity: 0.6 },
                ]}
                onPress={handleUnlockVault}
                disabled={loading}
              >
                {loading ? (
                  <ActivityIndicator color="#ffffff" />
                ) : (
                  <ThemedText style={styles.primaryButtonText}>{t("unlock")}</ThemedText>
                )}
              </Pressable>

              {/* Quick theme toggle on unlock screen */}
              <Pressable
                style={[dynamicStyles.headerBtnPill, { alignSelf: "center", marginTop: Spacing.two }]}
                onPress={toggleColorScheme}
              >
                <ThemedText style={{ fontSize: 13, color: theme.textSecondary }}>
                  {isDark ? "☀️ " + t("themeLight") : "🌙 " + t("themeDark")}
                </ThemedText>
              </Pressable>
            </View>

            {/* 重要说明与安全提示 */}
            <View style={[dynamicStyles.noticeCard, styles.noticeCard]}>
              <View style={styles.noticeHeader}>
                <ThemedText style={{ fontSize: 15 }}>🛡️</ThemedText>
                <ThemedText style={[styles.noticeTitle, { color: isDark ? "#60a5fa" : "#2563eb" }]}>
                  {t("unlockNoticeTitle")}
                </ThemedText>
              </View>
              <View style={styles.noticeList}>
                <View style={styles.noticeItem}>
                  <ThemedText style={{ fontSize: 12.5, lineHeight: 18, color: theme.textSecondary }}>
                    <ThemedText style={{ fontWeight: "700", color: isDark ? "#93c5fd" : "#1d4ed8" }}>
                      🔒 {t("noticeLocalTitle")}
                    </ThemedText>
                    {t("noticeLocalDesc")}
                  </ThemedText>
                </View>
                <View style={styles.noticeItem}>
                  <ThemedText style={{ fontSize: 12.5, lineHeight: 18, color: theme.textSecondary }}>
                    <ThemedText style={{ fontWeight: "700", color: isDark ? "#fcd34d" : "#d97706" }}>
                      📦 {t("noticeBackupTitle")}
                    </ThemedText>
                    {t("unlockBackupDesc")}
                  </ThemedText>
                </View>
              </View>
            </View>
          </ScrollView>
        </SafeAreaView>
      </View>
    );
  }

  // 4. Main 2FA Dashboard (Two-Row Elegant, Spacious, Modern Layout)
  return (
    <View style={dynamicStyles.containerBg} onTouchStart={resetInactivityTimer}>
      <SafeAreaView style={styles.dashboardContainer}>
        {/* ========================================================================= */}
        {/* 🌟 行 1：顶部品牌与系统安全状态栏 (Row 1: Header Brand & System Security Bar) 🌟 */}
        {/* ========================================================================= */}
        <View style={[styles.topSystemBar, { borderBottomColor: theme.border }]}>
          {/* 左侧：品牌 Logo + 名称 + VIP徽章 + 账号统计 */}
          <View style={styles.brandGroup}>
            <View style={styles.brandLogoBox}>
              <ThemedText style={{ fontSize: 18 }}>🛡️</ThemedText>
            </View>
            <View style={{ flexShrink: 1 }}>
              <View style={{ flexDirection: "row", alignItems: "center", gap: 6, flexWrap: "wrap" }}>
                <ThemedText style={styles.brandTitle} numberOfLines={1}>
                  {t("vaultManager")}
                </ThemedText>
                <Pressable
                  onPress={() => setShowProModal(true)}
                  style={[
                    styles.proBadge,
                    {
                      backgroundColor: isProUser
                        ? isDark
                          ? "rgba(16, 185, 129, 0.2)"
                          : "#d1fae5"
                        : isDark
                        ? "rgba(59, 130, 246, 0.2)"
                        : "#dbeafe",
                    },
                  ]}
                >
                  <ThemedText
                    style={{
                      fontSize: 10,
                      fontWeight: "800",
                      color: isProUser ? "#10b981" : "#2563eb",
                    }}
                  >
                    {isProUser ? "PRO VIP" : "FREE"}
                  </ThemedText>
                </Pressable>
              </View>
              <View style={{ flexDirection: "row", alignItems: "center", gap: 5, marginTop: 1 }}>
                <View style={[styles.statusDot, { backgroundColor: isProUser ? "#10b981" : "#3b82f6" }]} />
                <ThemedText style={{ fontSize: 11, color: theme.textSecondary }} numberOfLines={1}>
                  {isProUser ? "无限账号 • 商业保护" : `${entries.length} / 10 账号`}
                </ThemedText>
              </View>
            </View>
          </View>

          {/* 右侧：会员中心 + 自动锁定时间选择 + 主题切换 + 锁定 */}
          <View style={styles.topActionsGroup}>
            {/* Pro Membership Button */}
            <Pressable
              style={({ pressed }) => [
                dynamicStyles.headerBtnPro,
                pressed && { opacity: 0.75 },
              ]}
              onPress={() => {
                resetInactivityTimer();
                setProModalMsg(null);
                setLicenseInput("");
                setShowProModal(true);
              }}
            >
              <ThemedText style={{ fontSize: 13 }}>👑</ThemedText>
              <ThemedText
                style={{
                  fontSize: 12,
                  fontWeight: "700",
                  color: isProUser ? "#10b981" : "#f59e0b",
                }}
              >
                {isProUser ? t("proActive") : t("proMembership")}
              </ThemedText>
            </Pressable>

            {/* Auto-Lock Indicator & Quick Settings Button */}
            <Pressable
              style={({ pressed }) => [
                dynamicStyles.headerBtnPill,
                pressed && { opacity: 0.75 },
              ]}
              onPress={() => {
                resetInactivityTimer();
                setShowAutoLockModal(true);
              }}
              accessibilityLabel={t("autoLock")}
            >
              <ThemedText style={{ fontSize: 12 }}>⏱️</ThemedText>
              {!isUltraCompact && (
                <ThemedText style={{ fontSize: 11, fontWeight: "600", color: theme.textSecondary }}>
                  {autoLockMinutes === 0 ? "从不自动锁" : `${autoLockMinutes}m 锁`}
                </ThemedText>
              )}
            </Pressable>

            {/* Theme Toggle Button */}
            <Pressable
              style={({ pressed }) => [
                dynamicStyles.headerBtnPill,
                pressed && { opacity: 0.7 },
              ]}
              onPress={toggleColorScheme}
              accessibilityLabel={isDark ? t("themeLight") : t("themeDark")}
            >
              <ThemedText style={{ fontSize: 13 }}>{isDark ? "☀️" : "🌙"}</ThemedText>
            </Pressable>

            {/* Lock Vault Button */}
            <Pressable
              style={({ pressed }) => [
                dynamicStyles.headerBtnDanger,
                pressed && { opacity: 0.8 },
              ]}
              onPress={handleLockVault}
              accessibilityLabel={t("lockVault")}
            >
              <ThemedText style={{ fontSize: 12, fontWeight: "700", color: theme.danger }}>
                🔒 {!isUltraCompact && t("lockVault")}
              </ThemedText>
            </Pressable>
          </View>
        </View>

        {/* ========================================================================= */}
        {/* 🌟 行 2：核心业务操作工具栏 (Row 2: Action & Business Operations Toolbar) 🌟 */}
        {/* ========================================================================= */}
        <View style={styles.actionToolRow}>
          {/* 左侧：快速搜索输入框 */}
          <TextInput
            style={dynamicStyles.searchInput}
            placeholder={t("searchPlaceholder")}
            placeholderTextColor={theme.textDisabled}
            value={searchQuery}
            onChangeText={setSearchQuery}
            clearButtonMode="while-editing"
          />

          {/* 右侧业务按钮群：+ 添加 2FA | 📥 导入备份 | 📦 导出备份 */}
          <View style={styles.businessButtonGroup}>
            {/* + 添加 2FA 主按钮 (醒目大号科技蓝) */}
            <Pressable
              style={({ pressed }) => [
                dynamicStyles.addAccountBtn,
                pressed && { opacity: 0.8 },
              ]}
              onPress={() => {
                resetInactivityTimer();
                setAddModalError(null);
                setSecretOrUri("");
                setAccountName("");
                setShowAddModal(true);
              }}
            >
              <ThemedText style={{ color: "#ffffff", fontWeight: "800", fontSize: 13 }}>
                + {t("addAccount")}
              </ThemedText>
            </Pressable>

            {/* 📥 导入备份按钮 (高级磨砂商务灰/蓝) */}
            <Pressable
              style={({ pressed }) => [
                dynamicStyles.actionToolBtn,
                pressed && { opacity: 0.75 },
              ]}
              onPress={() => {
                resetInactivityTimer();
                setImportError(null);
                setImportSuccessMsg(null);
                setImportFileContent("");
                setImportPassword("");
                setShowImportModal(true);
              }}
            >
              <ThemedText style={{ fontSize: 13 }}>📥</ThemedText>
              <ThemedText style={{ fontSize: 12, fontWeight: "700", color: theme.text }}>
                {t("importBackup")}
              </ThemedText>
            </Pressable>

            {/* 📦 导出备份按钮 (PRO 金/绿微光按钮) */}
            <Pressable
              style={({ pressed }) => [
                dynamicStyles.actionToolBtn,
                isProUser
                  ? { borderColor: "rgba(16, 185, 129, 0.4)", backgroundColor: isDark ? "rgba(16, 185, 129, 0.1)" : "rgba(16, 185, 129, 0.06)" }
                  : { borderColor: "rgba(245, 158, 11, 0.4)", backgroundColor: isDark ? "rgba(245, 158, 11, 0.1)" : "rgba(245, 158, 11, 0.06)" },
                pressed && { opacity: 0.75 },
              ]}
              onPress={handleOpenExportModal}
            >
              <ThemedText style={{ fontSize: 13 }}>📦</ThemedText>
              <ThemedText
                style={{
                  fontSize: 12,
                  fontWeight: "700",
                  color: isProUser ? (isDark ? "#34d399" : "#059669") : "#d97706",
                }}
              >
                {t("exportBackup")}
              </ThemedText>
            </Pressable>
          </View>
        </View>

        {/* 2FA Accounts List */}
        <ScrollView
          contentContainerStyle={styles.scrollContent}
          onScrollBeginDrag={resetInactivityTimer}
          showsVerticalScrollIndicator={false}
        >
          {entries.length === 0 ? (
            <View style={[dynamicStyles.cardSurface, styles.emptyCard]}>
              <View style={styles.emptyIconBox}>
                <ThemedText style={{ fontSize: 40 }}>🔐</ThemedText>
              </View>
              <ThemedText type="subtitle" style={{ fontSize: 20, fontWeight: "700", textAlign: "center" }}>
                {t("emptyAccounts")}
              </ThemedText>
              <ThemedText
                style={{ textAlign: "center", color: theme.textSecondary, lineHeight: 22, maxWidth: 440, fontSize: 14 }}
              >
                {t("emptyAccountsDesc")}
              </ThemedText>
              <Pressable
                style={({ pressed }) => [
                  dynamicStyles.primaryButton,
                  { paddingHorizontal: Spacing.five, marginTop: Spacing.two },
                  pressed && { opacity: 0.8 },
                ]}
                onPress={() => {
                  resetInactivityTimer();
                  setAddModalError(null);
                  setSecretOrUri("");
                  setAccountName("");
                  setShowAddModal(true);
                }}
              >
                <ThemedText style={styles.primaryButtonText}>+ {t("addAccount")}</ThemedText>
              </Pressable>
            </View>
          ) : filteredEntries.length === 0 ? (
            <View style={[dynamicStyles.cardSurface, styles.emptyCard]}>
              <ThemedText style={{ fontSize: 28 }}>🔍</ThemedText>
              <ThemedText style={{ color: theme.textSecondary, marginTop: Spacing.one, fontSize: 14 }}>
                {t("noSearchResult")}
              </ThemedText>
            </View>
          ) : (
            <View style={styles.cardsGrid}>
              {filteredEntries.map((item) => {
                const colors = getProgressColor(item.remainingSeconds, item.payload.period || 30);
                const isCopied = copiedId === item.id;
                const [avatarGradStart] = getServiceColor(item.payload.issuer || "2FA");
                const initialChar = (item.payload.issuer || "2").charAt(0).toUpperCase();
                const addedDateFormatted = formatAddedDate(item.createdAt);

                // Split digits into 2 segments (e.g. "849" and "201")
                const code = item.totpCode || "------";
                const mid = Math.ceil(code.length / 2);
                const part1 = code.slice(0, mid);
                const part2 = code.slice(mid);

                return (
                  <View
                    key={item.id}
                    style={[
                      dynamicStyles.cardSurface,
                      styles.totpCard,
                      { padding: isCompact ? 14 : 16 },
                    ]}
                  >
                    {/* Layer 1: Card Top Header (Avatar + Service Name + Account + Added Timestamp + Delete) */}
                    <View style={styles.cardHeaderRow}>
                      <View style={{ flexDirection: "row", alignItems: "center", gap: 10, flex: 1, minWidth: 0 }}>
                        <View style={[styles.serviceAvatar, { backgroundColor: avatarGradStart }]}>
                          <ThemedText style={styles.serviceAvatarText}>{initialChar}</ThemedText>
                        </View>
                        <View style={{ flex: 1, minWidth: 0 }}>
                          <ThemedText style={styles.issuerName} numberOfLines={1}>
                            {item.payload.issuer}
                          </ThemedText>
                          <View style={{ flexDirection: "row", alignItems: "center", flexWrap: "wrap", gap: 6, marginTop: 2 }}>
                            {item.payload.account && item.payload.account !== item.payload.issuer ? (
                              <ThemedText style={{ fontSize: 12, color: theme.textSecondary }} numberOfLines={1}>
                                {item.payload.account}
                              </ThemedText>
                            ) : null}
                            {addedDateFormatted ? (
                              <View style={[styles.dateBadge, { backgroundColor: isDark ? "rgba(255,255,255,0.06)" : "rgba(0,0,0,0.04)" }]}>
                                <ThemedText style={{ fontSize: 11, color: theme.textSecondary }}>
                                  🕒 {t("addedAt")}: {addedDateFormatted}
                                </ThemedText>
                              </View>
                            ) : null}
                          </View>
                        </View>
                      </View>

                      {/* Delete Button */}
                      <Pressable
                        style={({ pressed }) => [
                          styles.deleteBtn,
                          { backgroundColor: isDark ? "rgba(255,255,255,0.05)" : "rgba(0,0,0,0.03)" },
                          pressed && { opacity: 0.6 },
                        ]}
                        onPress={() => handleDeleteEntry(item.id)}
                        accessibilityLabel={t("delete")}
                      >
                        <ThemedText style={{ color: theme.textDisabled, fontSize: 13, fontWeight: "700" }}>✕</ThemedText>
                      </Pressable>
                    </View>

                    {/* Layer 2: Dedicated OTP Digit Capsules (Spacious & Centered) */}
                    <Pressable
                      style={({ pressed }) => [
                        styles.digitsBoxWrapper,
                        {
                          backgroundColor: isDark ? "rgba(10, 15, 29, 0.75)" : "rgba(248, 250, 252, 0.9)",
                          borderColor: isDark ? "rgba(255, 255, 255, 0.08)" : "rgba(203, 213, 225, 0.8)",
                        },
                        pressed && { opacity: 0.85 },
                      ]}
                      onPress={() => handleCopyCode(item.id, item.totpCode)}
                    >
                      <View style={styles.digitsSegmentRow}>
                        <View
                          style={[
                            styles.digitSegmentBox,
                            {
                              backgroundColor: isDark ? "rgba(255,255,255,0.05)" : "#ffffff",
                              paddingHorizontal: isUltraCompact ? 8 : 14,
                            },
                          ]}
                        >
                          <ThemedText
                            style={[
                              styles.totpDigits,
                              {
                                color: isDark ? "#ffffff" : "#0f172a",
                                fontSize: isUltraCompact ? 22 : isCompact ? 26 : 30,
                                letterSpacing: isUltraCompact ? 2 : 4,
                              },
                            ]}
                          >
                            {part1}
                          </ThemedText>
                        </View>

                        <ThemedText style={[styles.digitDivider, { color: colors.textColor }]}>•</ThemedText>

                        <View
                          style={[
                            styles.digitSegmentBox,
                            {
                              backgroundColor: isDark ? "rgba(255,255,255,0.05)" : "#ffffff",
                              paddingHorizontal: isUltraCompact ? 8 : 14,
                            },
                          ]}
                        >
                          <ThemedText
                            style={[
                              styles.totpDigits,
                              {
                                color: isDark ? "#ffffff" : "#0f172a",
                                fontSize: isUltraCompact ? 22 : isCompact ? 26 : 30,
                                letterSpacing: isUltraCompact ? 2 : 4,
                              },
                            ]}
                          >
                            {part2}
                          </ThemedText>
                        </View>
                      </View>
                    </Pressable>

                    {/* Layer 3: Fluid Progress Bar & Controls Row */}
                    <View style={styles.cardControlsRow}>
                      {/* Fluid Progress Bar */}
                      <View style={styles.progressTrackWrapper}>
                        <View style={[styles.progressBarTrack, { backgroundColor: isDark ? "rgba(255,255,255,0.08)" : "rgba(0,0,0,0.06)" }]}>
                          <View
                            style={[
                              styles.progressBarFill,
                              {
                                width: `${Math.max(2, (1 - item.progress) * 100)}%`,
                                backgroundColor: colors.barColor,
                                shadowColor: colors.glowColor,
                              },
                            ]}
                          />
                        </View>
                      </View>

                      {/* Remaining Seconds Pill Badge */}
                      <View
                        style={[
                          styles.countdownPill,
                          {
                            backgroundColor: colors.badgeBg,
                            borderColor: colors.badgeBorder,
                          },
                        ]}
                      >
                        <ThemedText style={{ fontSize: 12 }}>⏱️</ThemedText>
                        <ThemedText style={[styles.countdownText, { color: colors.textColor, fontSize: 12 }]}>
                          {item.remainingSeconds}{t("remaining")}
                        </ThemedText>
                      </View>

                      {/* Tactile Copy Button */}
                      <Pressable
                        style={({ pressed }) => [
                          styles.copyButton,
                          {
                            backgroundColor: isCopied ? "#10b981" : isDark ? "#2563eb" : "#3b82f6",
                          },
                          pressed && { opacity: 0.8 },
                        ]}
                        onPress={() => handleCopyCode(item.id, item.totpCode)}
                      >
                        <ThemedText style={styles.copyButtonText}>
                          {isCopied ? "✓ " + t("copied") : "📋 " + t("copy")}
                        </ThemedText>
                      </Pressable>
                    </View>
                  </View>
                );
              })}
            </View>
          )}
        </ScrollView>

        {/* ⏱️ Auto-Lock Duration Settings Modal */}
        <Modal
          visible={showAutoLockModal}
          transparent
          animationType="fade"
          onRequestClose={() => setShowAutoLockModal(false)}
        >
          <View style={styles.modalOverlay}>
            <View style={[dynamicStyles.cardSurface, styles.modalCard]}>
              <View style={styles.modalHeader}>
                <View style={{ flexDirection: "row", alignItems: "center", gap: 8 }}>
                  <ThemedText style={{ fontSize: 22 }}>⏱️</ThemedText>
                  <ThemedText style={{ fontSize: 18, fontWeight: "800" }}>
                    {t("autoLock")}设置
                  </ThemedText>
                </View>
                <Pressable
                  onPress={() => setShowAutoLockModal(false)}
                  style={{ padding: Spacing.one, cursor: "pointer" } as any}
                >
                  <ThemedText style={{ fontSize: 18, color: theme.textSecondary }}>✕</ThemedText>
                </Pressable>
              </View>

              <ThemedText style={{ fontSize: 13, color: theme.textSecondary, lineHeight: 18 }}>
                当您在设定的时间内未进行任何鼠标、键盘操作时，系统将自动锁定保险库并安全抹除内存密钥。
              </ThemedText>

              <View style={{ gap: 8, marginVertical: 4 }}>
                {[
                  { label: "1 分钟 (极高安全)", value: 1 },
                  { label: "5 分钟 (推荐标准)", value: 5 },
                  { label: "15 分钟 (日常办公)", value: 15 },
                  { label: "30 分钟 (长效保持)", value: 30 },
                  { label: "从不自动锁定 (不建议)", value: 0 },
                ].map((opt) => {
                  const isSelected = autoLockMinutes === opt.value;
                  return (
                    <Pressable
                      key={opt.value}
                      style={({ pressed }) => [
                        styles.autoLockOptionCard,
                        {
                          backgroundColor: isSelected
                            ? isDark
                              ? "rgba(37, 99, 235, 0.2)"
                              : "#eff6ff"
                            : isDark
                            ? "rgba(255, 255, 255, 0.04)"
                            : "rgba(0, 0, 0, 0.02)",
                          borderColor: isSelected ? "#2563eb" : theme.border,
                        },
                        pressed && { opacity: 0.8 },
                      ]}
                      onPress={() => handleChangeAutoLockTime(opt.value)}
                    >
                      <ThemedText
                        style={{
                          fontSize: 14,
                          fontWeight: isSelected ? "800" : "600",
                          color: isSelected ? "#2563eb" : theme.text,
                        }}
                      >
                        {opt.label}
                      </ThemedText>
                      {isSelected && (
                        <ThemedText style={{ fontSize: 16, color: "#2563eb", fontWeight: "800" }}>✓</ThemedText>
                      )}
                    </Pressable>
                  );
                })}
              </View>
            </View>
          </View>
        </Modal>

        {/* 📥 Import Encrypted 2FA Backup Modal */}
        <Modal
          visible={showImportModal}
          transparent
          animationType="fade"
          onRequestClose={() => setShowImportModal(false)}
        >
          <View style={styles.modalOverlay}>
            <View style={[dynamicStyles.cardSurface, styles.modalCard]}>
              <View style={styles.modalHeader}>
                <View style={{ flexDirection: "row", alignItems: "center", gap: 8 }}>
                  <ThemedText style={{ fontSize: 22 }}>📥</ThemedText>
                  <ThemedText style={{ fontSize: 18, fontWeight: "800" }}>
                    {t("importBackupTitle")}
                  </ThemedText>
                </View>
                <Pressable
                  onPress={() => setShowImportModal(false)}
                  style={{ padding: Spacing.one, cursor: "pointer" } as any}
                >
                  <ThemedText style={{ fontSize: 18, color: theme.textSecondary }}>✕</ThemedText>
                </Pressable>
              </View>

              <ThemedText style={{ fontSize: 13, color: theme.textSecondary, lineHeight: 18 }}>
                {t("importBackupDesc")}
              </ThemedText>

              {/* Select File / Paste File Content */}
              <View style={styles.formField}>
                <View style={{ flexDirection: "row", justifyContent: "space-between", alignItems: "center" }}>
                  <ThemedText style={styles.formLabel}>备份文件内容 (.sav) *</ThemedText>
                  <Pressable
                    style={({ pressed }) => [
                      dynamicStyles.headerBtnPill,
                      pressed && { opacity: 0.7 },
                    ]}
                    onPress={handlePickLocalBackupFile}
                  >
                    <ThemedText style={{ fontSize: 12, fontWeight: "700", color: "#3b82f6" }}>
                      📁 {t("selectBackupFile")}
                    </ThemedText>
                  </Pressable>
                </View>

                <TextInput
                  style={[dynamicStyles.modalInput, { height: 72, textAlignVertical: "top", paddingTop: 8 }]}
                  placeholder={t("pasteBackupPlaceholder")}
                  placeholderTextColor={theme.textDisabled}
                  value={importFileContent}
                  onChangeText={(val) => {
                    setImportFileContent(val);
                    if (importError) setImportError(null);
                  }}
                  multiline
                  autoCapitalize="none"
                  autoCorrect={false}
                />
              </View>

              {/* Backup Decryption Password */}
              <View style={styles.formField}>
                <ThemedText style={styles.formLabel}>
                  备份保护密码 (Backup Password) *
                </ThemedText>
                <TextInput
                  style={dynamicStyles.modalInput}
                  placeholder={t("backupPasswordPlaceholder")}
                  placeholderTextColor={theme.textDisabled}
                  value={importPassword}
                  onChangeText={(val) => {
                    setImportPassword(val);
                    if (importError) setImportError(null);
                  }}
                  secureTextEntry
                  returnKeyType="done"
                  onSubmitEditing={handleExecuteImportBackup}
                />
              </View>

              {importError && (
                <View style={styles.errorBox}>
                  <ThemedText style={styles.errorText}>⚠️ {importError}</ThemedText>
                </View>
              )}

              {importSuccessMsg && (
                <View style={[styles.errorBox, { backgroundColor: "rgba(16, 185, 129, 0.12)", borderColor: "rgba(16, 185, 129, 0.3)" }]}>
                  <ThemedText style={{ color: "#10b981", fontSize: 13, textAlign: "center", fontWeight: "700" }}>
                    ✓ {importSuccessMsg}
                  </ThemedText>
                </View>
              )}

              <View style={styles.modalActionRow}>
                <Pressable
                  style={({ pressed }) => [
                    styles.cancelBtn,
                    pressed && { opacity: 0.7 },
                  ]}
                  onPress={() => setShowImportModal(false)}
                >
                  <ThemedText style={{ color: theme.textSecondary, fontWeight: "600" }}>
                    {t("cancel")}
                  </ThemedText>
                </Pressable>

                <Pressable
                  style={({ pressed }) => [
                    styles.submitBtn,
                    pressed && { opacity: 0.8 },
                    importing && { opacity: 0.6 },
                  ]}
                  onPress={handleExecuteImportBackup}
                  disabled={importing}
                >
                  {importing ? (
                    <ActivityIndicator color="#ffffff" size="small" />
                  ) : (
                    <ThemedText style={{ color: "#ffffff", fontWeight: "700", fontSize: 13 }}>
                      {t("importBackupBtn")}
                    </ThemedText>
                  )}
                </Pressable>
              </View>
            </View>
          </View>
        </Modal>

        {/* 📦 Export Encrypted 2FA Backup Modal (Pro Only) */}
        <Modal
          visible={showExportModal}
          transparent
          animationType="fade"
          onRequestClose={() => setShowExportModal(false)}
        >
          <View style={styles.modalOverlay}>
            <View style={[dynamicStyles.cardSurface, styles.modalCard]}>
              <View style={styles.modalHeader}>
                <View style={{ flexDirection: "row", alignItems: "center", gap: 8 }}>
                  <ThemedText style={{ fontSize: 22 }}>📦</ThemedText>
                  <ThemedText style={{ fontSize: 18, fontWeight: "800" }}>
                    {t("exportBackupTitle")}
                  </ThemedText>
                </View>
                <Pressable
                  onPress={() => setShowExportModal(false)}
                  style={{ padding: Spacing.one, cursor: "pointer" } as any}
                >
                  <ThemedText style={{ fontSize: 18, color: theme.textSecondary }}>✕</ThemedText>
                </Pressable>
              </View>

              <ThemedText style={{ fontSize: 13, color: theme.textSecondary, lineHeight: 18 }}>
                {t("exportBackupDesc")}
              </ThemedText>

              {/* Password Input 1 */}
              <View style={styles.formField}>
                <ThemedText style={styles.formLabel}>
                  {t("backupPassword")} *
                </ThemedText>
                <TextInput
                  style={dynamicStyles.modalInput}
                  placeholder={t("backupPasswordPlaceholder")}
                  placeholderTextColor={theme.textDisabled}
                  value={exportPassword}
                  onChangeText={(val) => {
                    setExportPassword(val);
                    if (exportError) setExportError(null);
                  }}
                  secureTextEntry
                  autoFocus
                />
              </View>

              {/* Password Input 2 */}
              <View style={styles.formField}>
                <ThemedText style={styles.formLabel}>
                  {t("confirmBackupPassword")} *
                </ThemedText>
                <TextInput
                  style={dynamicStyles.modalInput}
                  placeholder={t("confirmBackupPassword")}
                  placeholderTextColor={theme.textDisabled}
                  value={confirmExportPassword}
                  onChangeText={(val) => {
                    setConfirmExportPassword(val);
                    if (exportError) setExportError(null);
                  }}
                  secureTextEntry
                  returnKeyType="done"
                  onSubmitEditing={handleExecuteExportBackup}
                />
              </View>

              {exportError && (
                <View style={styles.errorBox}>
                  <ThemedText style={styles.errorText}>⚠️ {exportError}</ThemedText>
                </View>
              )}

              {exportSuccessMsg && (
                <View style={[styles.errorBox, { backgroundColor: "rgba(16, 185, 129, 0.12)", borderColor: "rgba(16, 185, 129, 0.3)" }]}>
                  <ThemedText style={{ color: "#10b981", fontSize: 13, textAlign: "center", fontWeight: "700" }}>
                    ✓ {exportSuccessMsg}
                  </ThemedText>
                </View>
              )}

              <View style={styles.modalActionRow}>
                <Pressable
                  style={({ pressed }) => [
                    styles.cancelBtn,
                    pressed && { opacity: 0.7 },
                  ]}
                  onPress={() => setShowExportModal(false)}
                >
                  <ThemedText style={{ color: theme.textSecondary, fontWeight: "600" }}>
                    {t("cancel")}
                  </ThemedText>
                </Pressable>

                <Pressable
                  style={({ pressed }) => [
                    styles.submitBtn,
                    pressed && { opacity: 0.8 },
                    exporting && { opacity: 0.6 },
                  ]}
                  onPress={handleExecuteExportBackup}
                  disabled={exporting}
                >
                  {exporting ? (
                    <ActivityIndicator color="#ffffff" size="small" />
                  ) : (
                    <ThemedText style={{ color: "#ffffff", fontWeight: "700", fontSize: 13 }}>
                      {t("downloadBackupBtn")}
                    </ThemedText>
                  )}
                </Pressable>
              </View>
            </View>
          </View>
        </Modal>

        {/* 👑 Pro Membership Center Modal */}
        <Modal
          visible={showProModal}
          transparent
          animationType="fade"
          onRequestClose={() => setShowProModal(false)}
        >
          <View style={styles.modalOverlay}>
            <View style={[dynamicStyles.cardSurface, styles.proModalCard]}>
              <View style={styles.modalHeader}>
                <View style={{ flexDirection: "row", alignItems: "center", gap: 8 }}>
                  <ThemedText style={{ fontSize: 22 }}>👑</ThemedText>
                  <ThemedText style={{ fontSize: 18, fontWeight: "800" }}>
                    {t("proCenterTitle")}
                  </ThemedText>
                </View>
                <Pressable
                  onPress={() => setShowProModal(false)}
                  style={{ padding: Spacing.one, cursor: "pointer" } as any}
                >
                  <ThemedText style={{ fontSize: 18, color: theme.textSecondary }}>✕</ThemedText>
                </Pressable>
              </View>

              <ThemedText style={{ fontSize: 13, color: theme.textSecondary, lineHeight: 18 }}>
                {t("proCenterDesc")}
              </ThemedText>

              {/* Tier Comparison Grid */}
              <View style={styles.tierGrid}>
                <View
                  style={[
                    styles.tierCard,
                    {
                      backgroundColor: isDark ? "rgba(255,255,255,0.04)" : "rgba(0,0,0,0.02)",
                      borderColor: theme.border,
                    },
                  ]}
                >
                  <ThemedText style={{ fontSize: 14, fontWeight: "700" }}>{t("freeTier")}</ThemedText>
                  <ThemedText style={{ fontSize: 12, color: theme.textSecondary, marginTop: 2 }}>
                    {t("freeTierDesc")}
                  </ThemedText>
                  <ThemedText style={{ fontSize: 11, color: theme.textDisabled, marginTop: 4 }}>
                    • 本地 AES-256 加密 • 无备份导出
                  </ThemedText>
                </View>

                <View
                  style={[
                    styles.tierCard,
                    {
                      backgroundColor: isDark ? "rgba(245, 158, 11, 0.08)" : "rgba(245, 158, 11, 0.05)",
                      borderColor: "#f59e0b",
                    },
                  ]}
                >
                  <View style={{ flexDirection: "row", justifyContent: "space-between", alignItems: "center" }}>
                    <ThemedText style={{ fontSize: 14, fontWeight: "800", color: "#f59e0b" }}>
                      👑 {t("proTier")}
                    </ThemedText>
                    {isProUser && (
                      <View style={{ backgroundColor: "#10b981", paddingHorizontal: 6, paddingVertical: 2, borderRadius: 4 }}>
                        <ThemedText style={{ fontSize: 10, color: "#ffffff", fontWeight: "700" }}>已激活</ThemedText>
                      </View>
                    )}
                  </View>
                  <ThemedText style={{ fontSize: 12, color: theme.text, marginTop: 2 }}>
                    {t("proTierDesc")}
                  </ThemedText>
                  <ThemedText style={{ fontSize: 11, color: "#10b981", marginTop: 4, fontWeight: "600" }}>
                    ✓ 解锁无限账号 + .sav 离线加密备份导出
                  </ThemedText>
                </View>
              </View>

              {/* License Key Input Box */}
              {!isProUser ? (
                <View style={{ gap: 8 }}>
                  <ThemedText style={{ fontSize: 13, fontWeight: "700" }}>
                    激活码兑换 (License Activation)
                  </ThemedText>
                  <TextInput
                    style={dynamicStyles.modalInput}
                    placeholder={t("licenseKeyPlaceholder")}
                    placeholderTextColor={theme.textDisabled}
                    value={licenseInput}
                    onChangeText={setLicenseInput}
                    autoCapitalize="characters"
                    autoCorrect={false}
                  />

                  {proModalMsg && (
                    <View
                      style={[
                        styles.errorBox,
                        proModalMsg.type === "success" && {
                          backgroundColor: "rgba(16, 185, 129, 0.12)",
                          borderColor: "rgba(16, 185, 129, 0.3)",
                        },
                      ]}
                    >
                      <ThemedText
                        style={[
                          styles.errorText,
                          proModalMsg.type === "success" && { color: "#10b981" },
                        ]}
                      >
                        {proModalMsg.type === "success" ? "✓ " : "⚠️ "}
                        {proModalMsg.text}
                      </ThemedText>
                    </View>
                  )}

                  <View style={{ flexDirection: "row", gap: 8, marginTop: 4 }}>
                    <Pressable
                      style={({ pressed }) => [
                        styles.submitBtn,
                        { flex: 1 },
                        pressed && { opacity: 0.8 },
                      ]}
                      onPress={() => handleActivateLicense()}
                    >
                      <ThemedText style={{ color: "#ffffff", fontWeight: "700", fontSize: 13 }}>
                        {t("activateNow")}
                      </ThemedText>
                    </Pressable>

                    {__DEV__ && (
                      <Pressable
                        style={({ pressed }) => [
                          dynamicStyles.headerBtnPill,
                          pressed && { opacity: 0.8 },
                        ]}
                        onPress={() => handleActivateLicense("PRO-2FAS-8888")}
                      >
                        <ThemedText style={{ color: "#f59e0b", fontWeight: "700", fontSize: 13 }}>
                          ✨ {t("freeUnlimitedDemo")} (开发调试)
                        </ThemedText>
                      </Pressable>
                    )}
                  </View>
                </View>
              ) : (
                <View style={[styles.errorBox, { backgroundColor: "rgba(16, 185, 129, 0.12)", borderColor: "rgba(16, 185, 129, 0.3)" }]}>
                  <ThemedText style={{ color: "#10b981", fontSize: 13, textAlign: "center", fontWeight: "700" }}>
                    🎉 您的账户已拥有 PRO 商业版永久授权，享受无限 2FA 密钥管理与全部高级特权！
                  </ThemedText>
                </View>
              )}
            </View>
          </View>
        </Modal>

        {/* Add Account Modal (Ultra-Modern Glassmorphism) */}
        <Modal
          visible={showAddModal}
          transparent
          animationType="fade"
          onRequestClose={() => setShowAddModal(false)}
        >
          <View style={styles.modalOverlay}>
            <View style={[dynamicStyles.cardSurface, styles.modalCard]}>
              <View style={styles.modalHeader}>
                <View style={{ flexDirection: "row", alignItems: "center", gap: 8 }}>
                  <ThemedText style={{ fontSize: 20 }}>🔑</ThemedText>
                  <ThemedText style={{ fontSize: 18, fontWeight: "700" }}>
                    {t("addAccount")}
                  </ThemedText>
                </View>
                <Pressable
                  onPress={() => setShowAddModal(false)}
                  style={{ padding: Spacing.one, cursor: "pointer" } as any}
                >
                  <ThemedText style={{ fontSize: 18, color: theme.textSecondary }}>✕</ThemedText>
                </Pressable>
              </View>

              <ThemedText style={{ fontSize: 13, color: theme.textSecondary, lineHeight: 18 }}>
                {t("addAccountDesc")}
              </ThemedText>

              {/* 1. 2FA Secret Key / URI Input */}
              <View style={styles.formField}>
                <ThemedText style={styles.formLabel}>
                  {t("secretOrUri")} *
                </ThemedText>
                <TextInput
                  style={dynamicStyles.modalInput}
                  placeholder={t("secretOrUriPlaceholder")}
                  placeholderTextColor={theme.textDisabled}
                  value={secretOrUri}
                  onChangeText={(val) => {
                    setSecretOrUri(val);
                    if (addModalError) setAddModalError(null);
                  }}
                  autoFocus
                  autoCapitalize="none"
                  autoCorrect={false}
                />
              </View>

              {/* 2. Account Name (Optional) */}
              <View style={styles.formField}>
                <ThemedText style={styles.formLabel}>
                  {t("accountName")}
                </ThemedText>
                <TextInput
                  style={dynamicStyles.modalInput}
                  placeholder={t("accountNamePlaceholder")}
                  placeholderTextColor={theme.textDisabled}
                  value={accountName}
                  onChangeText={setAccountName}
                  returnKeyType="done"
                  onSubmitEditing={handleSaveNewAccount}
                />
              </View>

              {addModalError && (
                <View style={styles.errorBox}>
                  <ThemedText style={styles.errorText}>⚠️ {addModalError}</ThemedText>
                </View>
              )}

              <View style={styles.modalActionRow}>
                <Pressable
                  style={({ pressed }) => [
                    styles.cancelBtn,
                    pressed && { opacity: 0.7 },
                  ]}
                  onPress={() => setShowAddModal(false)}
                >
                  <ThemedText style={{ color: theme.textSecondary, fontWeight: "600" }}>
                    {t("cancel")}
                  </ThemedText>
                </Pressable>

                <Pressable
                  style={({ pressed }) => [
                    styles.submitBtn,
                    pressed && { opacity: 0.8 },
                    addingSaving && { opacity: 0.6 },
                  ]}
                  onPress={handleSaveNewAccount}
                  disabled={addingSaving}
                >
                  {addingSaving ? (
                    <ActivityIndicator color="#ffffff" size="small" />
                  ) : (
                    <ThemedText style={{ color: "#ffffff", fontWeight: "700", fontSize: 13 }}>
                      {t("saveAndEncrypt")}
                    </ThemedText>
                  )}
                </Pressable>
              </View>
            </View>
          </View>
        </Modal>
      </SafeAreaView>
    </View>
  );
}

const styles = StyleSheet.create({
  centered: {
    flex: 1,
    justifyContent: "center",
    alignItems: "center",
    padding: Spacing.four,
  },
  authWrapper: {
    flex: 1,
    justifyContent: "center",
    alignItems: "center",
    paddingHorizontal: Spacing.four,
  },
  authSafeArea: {
    maxWidth: 460,
    width: "100%",
  },
  authScrollContent: {
    paddingVertical: Spacing.four,
    gap: Spacing.three,
  },
  brandingHeader: {
    alignItems: "center",
    gap: Spacing.two,
  },
  shieldEmblem: {
    width: 76,
    height: 76,
    borderRadius: 38,
    backgroundColor: "rgba(59, 130, 246, 0.12)",
    justifyContent: "center",
    alignItems: "center",
    borderWidth: 1,
    borderColor: "rgba(59, 130, 246, 0.25)",
  },
  authTitle: {
    fontSize: 26,
    fontWeight: "800",
    textAlign: "center",
  },
  authSubtitle: {
    fontSize: 14,
    textAlign: "center",
    lineHeight: 20,
    paddingHorizontal: Spacing.two,
  },
  card: {
    padding: Spacing.four,
    gap: Spacing.three,
    shadowColor: "#000",
    shadowOffset: { width: 0, height: 6 },
    shadowOpacity: 0.15,
    shadowRadius: 16,
  },
  noticeCard: {
    padding: Spacing.three,
    gap: 8,
  },
  noticeHeader: {
    flexDirection: "row",
    alignItems: "center",
    gap: 6,
    paddingBottom: 6,
    borderBottomWidth: StyleSheet.hairlineWidth,
    borderBottomColor: "rgba(128, 128, 128, 0.2)",
  },
  noticeTitle: {
    fontSize: 13.5,
    fontWeight: "700",
  },
  noticeList: {
    gap: 8,
  },
  noticeItem: {
    flexDirection: "row",
    alignItems: "flex-start",
  },
  primaryButtonText: {
    color: "#ffffff",
    fontSize: 15,
    fontWeight: "700",
  },
  dashboardContainer: {
    flex: 1,
    maxWidth: 960,
    width: "100%",
    alignSelf: "center",
    paddingHorizontal: Spacing.three,
    paddingTop: Spacing.two,
  },
  // Row 1 System Bar
  topSystemBar: {
    flexDirection: "row",
    justifyContent: "space-between",
    alignItems: "center",
    paddingBottom: 10,
    borderBottomWidth: StyleSheet.hairlineWidth,
    marginBottom: 10,
    flexWrap: "wrap",
    gap: 8,
  },
  brandGroup: {
    flexDirection: "row",
    alignItems: "center",
    gap: 10,
    flexShrink: 0,
  },
  brandLogoBox: {
    width: 36,
    height: 36,
    borderRadius: 10,
    backgroundColor: "rgba(37, 99, 235, 0.12)",
    justifyContent: "center",
    alignItems: "center",
    borderWidth: 1,
    borderColor: "rgba(37, 99, 235, 0.2)",
    flexShrink: 0,
  },
  brandTitle: {
    fontSize: 16,
    fontWeight: "800",
    letterSpacing: -0.3,
  },
  proBadge: {
    paddingHorizontal: 5,
    paddingVertical: 1,
    borderRadius: 4,
    cursor: "pointer",
  } as any,
  statusDot: {
    width: 6,
    height: 6,
    borderRadius: 3,
    flexShrink: 0,
  },
  topActionsGroup: {
    flexDirection: "row",
    gap: 6,
    alignItems: "center",
    flexShrink: 0,
  },
  // Row 2 Action Bar
  actionToolRow: {
    flexDirection: "row",
    gap: 8,
    alignItems: "center",
    marginBottom: Spacing.three,
    flexWrap: "wrap",
  },
  businessButtonGroup: {
    flexDirection: "row",
    gap: 8,
    alignItems: "center",
    flexShrink: 0,
  },
  scrollContent: {
    paddingBottom: Spacing.six,
  },
  emptyCard: {
    padding: Spacing.six,
    alignItems: "center",
    gap: Spacing.two,
    marginTop: Spacing.three,
  },
  emptyIconBox: {
    width: 72,
    height: 72,
    borderRadius: 36,
    backgroundColor: "rgba(59, 130, 246, 0.1)",
    justifyContent: "center",
    alignItems: "center",
    marginBottom: Spacing.two,
  },
  cardsGrid: {
    gap: 12,
  },
  totpCard: {
    gap: 12,
    shadowColor: "#000",
    shadowOffset: { width: 0, height: 4 },
    shadowOpacity: 0.08,
    shadowRadius: 14,
  },
  cardHeaderRow: {
    flexDirection: "row",
    justifyContent: "space-between",
    alignItems: "center",
    gap: 8,
  },
  serviceAvatar: {
    width: 36,
    height: 36,
    borderRadius: 10,
    justifyContent: "center",
    alignItems: "center",
    shadowColor: "#000",
    shadowOffset: { width: 0, height: 2 },
    shadowOpacity: 0.2,
    shadowRadius: 4,
    flexShrink: 0,
  },
  serviceAvatarText: {
    color: "#ffffff",
    fontWeight: "800",
    fontSize: 16,
  },
  issuerName: {
    fontSize: 16,
    fontWeight: "800",
    letterSpacing: -0.2,
  },
  dateBadge: {
    paddingHorizontal: 6,
    paddingVertical: 1,
    borderRadius: 5,
  },
  deleteBtn: {
    width: 28,
    height: 28,
    borderRadius: 7,
    justifyContent: "center",
    alignItems: "center",
    cursor: "pointer",
    flexShrink: 0,
  } as any,
  digitsBoxWrapper: {
    paddingVertical: 12,
    paddingHorizontal: 12,
    borderRadius: 12,
    borderWidth: 1,
    cursor: "pointer",
    alignItems: "center",
    justifyContent: "center",
  } as any,
  digitsSegmentRow: {
    flexDirection: "row",
    alignItems: "center",
    gap: 6,
  },
  digitSegmentBox: {
    paddingVertical: 4,
    borderRadius: 8,
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: "rgba(128,128,128,0.2)",
    shadowColor: "#000",
    shadowOffset: { width: 0, height: 1 },
    shadowOpacity: 0.05,
    shadowRadius: 2,
  },
  digitDivider: {
    fontSize: 18,
    fontWeight: "800",
  },
  totpDigits: {
    fontWeight: "800",
    fontFamily: Platform.select({ web: "ui-monospace, SFMono-Regular, Menlo, Monaco, monospace", default: "Courier" }),
  },
  cardControlsRow: {
    flexDirection: "row",
    alignItems: "center",
    gap: 10,
  },
  progressTrackWrapper: {
    flex: 1,
    justifyContent: "center",
  },
  progressBarTrack: {
    width: "100%",
    height: 6,
    borderRadius: 3,
    overflow: "hidden",
  },
  progressBarFill: {
    height: "100%",
    borderRadius: 3,
    shadowOffset: { width: 0, height: 0 },
    shadowOpacity: 0.8,
    shadowRadius: 6,
  },
  countdownPill: {
    flexDirection: "row",
    alignItems: "center",
    gap: 3,
    paddingHorizontal: 8,
    paddingVertical: 4,
    borderRadius: 6,
    borderWidth: 1,
    flexShrink: 0,
  },
  countdownText: {
    fontWeight: "800",
  },
  copyButton: {
    paddingHorizontal: 12,
    paddingVertical: 6,
    borderRadius: 7,
    justifyContent: "center",
    alignItems: "center",
    cursor: "pointer",
    flexShrink: 0,
    shadowColor: "#000",
    shadowOffset: { width: 0, height: 1 },
    shadowOpacity: 0.15,
    shadowRadius: 3,
  } as any,
  copyButtonText: {
    color: "#ffffff",
    fontSize: 12,
    fontWeight: "700",
  },
  errorBox: {
    backgroundColor: "rgba(239, 68, 68, 0.12)",
    padding: Spacing.two,
    borderRadius: 8,
    borderWidth: 1,
    borderColor: "rgba(239, 68, 68, 0.3)",
  },
  errorText: {
    color: "#ef4444",
    fontSize: 13,
    textAlign: "center",
    fontWeight: "600",
  },
  modalOverlay: {
    flex: 1,
    backgroundColor: "rgba(0, 0, 0, 0.65)",
    justifyContent: "center",
    alignItems: "center",
    padding: Spacing.three,
  },
  modalCard: {
    maxWidth: 480,
    width: "100%",
    padding: Spacing.four,
    gap: Spacing.three,
    shadowColor: "#000",
    shadowOffset: { width: 0, height: 12 },
    shadowOpacity: 0.3,
    shadowRadius: 24,
  },
  proModalCard: {
    maxWidth: 520,
    width: "100%",
    padding: Spacing.four,
    gap: Spacing.three,
    shadowColor: "#000",
    shadowOffset: { width: 0, height: 12 },
    shadowOpacity: 0.3,
    shadowRadius: 24,
  },
  tierGrid: {
    gap: 10,
    marginVertical: 4,
  },
  tierCard: {
    padding: 12,
    borderRadius: 10,
    borderWidth: 1,
  },
  autoLockOptionCard: {
    flexDirection: "row",
    justifyContent: "space-between",
    alignItems: "center",
    paddingVertical: 12,
    paddingHorizontal: 14,
    borderRadius: 10,
    borderWidth: 1,
    cursor: "pointer",
  } as any,
  modalHeader: {
    flexDirection: "row",
    justifyContent: "space-between",
    alignItems: "center",
  },
  formField: {
    gap: 6,
  },
  formLabel: {
    fontWeight: "700",
    fontSize: 13,
  },
  modalActionRow: {
    flexDirection: "row",
    justifyContent: "flex-end",
    gap: 8,
    marginTop: Spacing.two,
  },
  cancelBtn: {
    paddingHorizontal: Spacing.four,
    paddingVertical: 9,
    borderRadius: 9,
    justifyContent: "center",
    alignItems: "center",
    cursor: "pointer",
  } as any,
  submitBtn: {
    backgroundColor: "#2563eb",
    paddingHorizontal: Spacing.four,
    paddingVertical: 9,
    borderRadius: 9,
    justifyContent: "center",
    alignItems: "center",
    cursor: "pointer",
    shadowColor: "#2563eb",
    shadowOffset: { width: 0, height: 2 },
    shadowOpacity: 0.3,
    shadowRadius: 6,
  } as any,
});
