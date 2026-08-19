/**
 * @file BackupService.ts
 * @description 零知识安全加密备份 (.sav) 导出与还原服务
 * 采用独立二次加密机制：每次导出由用户单独输入备份保护密码，
 * 底层利用 Argon2id 重新派生高强密钥并执行 AES-256-GCM 封装，彻底杜绝数据泄露。
 */

import { decryptAES256GCM, encryptAES256GCM, type EncryptedData } from "../crypto/aes";
import { DEFAULT_KDF_PARAMS, deriveKey, type KDFParams } from "../crypto/kdf";
import { generateRandomBytes, uint8ArrayToBase64, wipeBytes } from "../crypto/utils";
import type { EntryPayload } from "../types/domain";

export interface BackupEntryItem extends EntryPayload {
  favorite?: boolean;
}

export interface BackupPayload {
  vaultName: string;
  exportedAt: string;
  entries: BackupEntryItem[];
}

export interface EncryptedBackupFile {
  format: "SECURE_AUTHENTICATOR_BACKUP";
  version: number;
  createdAt: string;
  kdf: KDFParams;
  encrypted: EncryptedData;
}

/**
 * 将 2FA 账号列表导出为高强度加密的 .sav 备份 JSON 文本
 * @param entries 需要导出的 2FA 账号明文载荷列表
 * @param backupPassword 专门用于保护该备份文件的专属密码 (至少 6 位)
 * @param vaultName 保险库名称 (可选)
 * @returns 格式化后的 .sav JSON 密文字符串
 */
export async function createEncryptedBackup(
  entries: BackupEntryItem[],
  backupPassword: string,
  vaultName = "My Vault"
): Promise<string> {
  if (!backupPassword || backupPassword.length < 6) {
    throw new Error("备份密码长度至少需要 6 个字符");
  }

  // 1. 为本次备份生成专属密码学随机盐 (16 字节)
  const salt = uint8ArrayToBase64(generateRandomBytes(16));
  const kdfParams: KDFParams = {
    ...DEFAULT_KDF_PARAMS,
    salt,
  };

  // 2. 利用 Argon2id 从备份密码派生独立的 256 位加密密钥
  const backupKey = await deriveKey(backupPassword, kdfParams);

  try {
    // 3. 序列化明文条目载荷
    const payload: BackupPayload = {
      vaultName,
      exportedAt: new Date().toISOString(),
      entries,
    };
    const jsonPayload = JSON.stringify(payload);

    // 4. 使用 AES-256-GCM 进行端到端加密
    const encrypted = await encryptAES256GCM(jsonPayload, backupKey);

    // 5. 组装标准零知识备份文件格式
    const backupFile: EncryptedBackupFile = {
      format: "SECURE_AUTHENTICATOR_BACKUP",
      version: 1,
      createdAt: new Date().toISOString(),
      kdf: kdfParams,
      encrypted,
    };

    return JSON.stringify(backupFile, null, 2);
  } finally {
    // 内存安全清理：物理抹除敏感的派生密钥
    wipeBytes(backupKey);
  }
}

/**
 * 从加密备份文件 (.sav) 中解密并还原 2FA 账号列表
 * @param backupFileContent .sav 文件内容字符串
 * @param backupPassword 导出时设置的备份保护密码
 * @returns 解密后的 BackupPayload 对象 (包含 2FA 账号条目数组)
 */
export async function restoreEncryptedBackup(
  backupFileContent: string,
  backupPassword: string
): Promise<BackupPayload> {
  let parsed: EncryptedBackupFile;
  try {
    parsed = JSON.parse(backupFileContent);
  } catch {
    throw new Error("无效的备份文件：非标准 JSON 格式");
  }

  if (parsed.format !== "SECURE_AUTHENTICATOR_BACKUP") {
    throw new Error("无法识别的备份文件格式标识");
  }

  if (parsed.version !== 1) {
    throw new Error(`不支持的备份版本号: ${parsed.version}`);
  }

  if (!parsed.kdf || !parsed.encrypted) {
    throw new Error("备份文件结构不完整或已损坏");
  }

  // 1. 从备份文件元数据中提取盐值并派生解密密钥
  const backupKey = await deriveKey(backupPassword, parsed.kdf);

  try {
    // 2. 解密并校验 AES-256-GCM 密文与认证标签
    const decryptedJson = await decryptAES256GCM(parsed.encrypted, backupKey);
    const payload: BackupPayload = JSON.parse(decryptedJson);

    if (!Array.isArray(payload.entries)) {
      throw new Error("备份数据异常：缺少有效 2FA 账号条目数组");
    }

    return payload;
  } catch {
    throw new Error("备份解密失败：备份保护密码不正确或文件遭受篡改");
  } finally {
    // 内存安全清理
    wipeBytes(backupKey);
  }
}
