import { encryptAES256GCM, decryptAES256GCM, type EncryptedData } from "../crypto/aes";
import { deriveKey, DEFAULT_KDF_PARAMS, type KDFParams } from "../crypto/kdf";
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
 * Creates an encrypted backup (.sav) from a list of entries and a backup password.
 */
export async function createEncryptedBackup(
  entries: BackupEntryItem[],
  backupPassword: string,
  vaultName = "My Vault"
): Promise<string> {
  if (!backupPassword || backupPassword.length < 6) {
    throw new Error("Backup password must be at least 6 characters long");
  }

  // 1. Generate fresh random salt for backup KDF
  const salt = uint8ArrayToBase64(generateRandomBytes(16));
  const kdfParams: KDFParams = {
    ...DEFAULT_KDF_PARAMS,
    salt,
  };

  // 2. Derive backup encryption key
  const backupKey = await deriveKey(backupPassword, kdfParams);

  try {
    // 3. Serialize logical entries
    const payload: BackupPayload = {
      vaultName,
      exportedAt: new Date().toISOString(),
      entries,
    };
    const jsonPayload = JSON.stringify(payload);

    // 4. Encrypt payload with AES-256-GCM
    const encrypted = await encryptAES256GCM(jsonPayload, backupKey);

    // 5. Structure backup file
    const backupFile: EncryptedBackupFile = {
      format: "SECURE_AUTHENTICATOR_BACKUP",
      version: 1,
      createdAt: new Date().toISOString(),
      kdf: kdfParams,
      encrypted,
    };

    return JSON.stringify(backupFile, null, 2);
  } finally {
    // Zero out sensitive backup key
    wipeBytes(backupKey);
  }
}

/**
 * Decrypts and restores entries from an encrypted backup (.sav) file.
 */
export async function restoreEncryptedBackup(
  backupFileContent: string,
  backupPassword: string
): Promise<BackupPayload> {
  let parsed: EncryptedBackupFile;
  try {
    parsed = JSON.parse(backupFileContent);
  } catch {
    throw new Error("Invalid backup file: not valid JSON format");
  }

  if (parsed.format !== "SECURE_AUTHENTICATOR_BACKUP") {
    throw new Error("Invalid backup file format");
  }

  if (parsed.version !== 1) {
    throw new Error(`Unsupported backup version: ${parsed.version}`);
  }

  if (!parsed.kdf || !parsed.encrypted) {
    throw new Error("Malformed backup file structure");
  }

  // Derive key from provided backup password and stored salt
  const backupKey = await deriveKey(backupPassword, parsed.kdf);

  try {
    const decryptedJson = await decryptAES256GCM(parsed.encrypted, backupKey);
    const payload: BackupPayload = JSON.parse(decryptedJson);

    if (!Array.isArray(payload.entries)) {
      throw new Error("Invalid backup data: missing entries array");
    }

    return payload;
  } catch {
    throw new Error("Failed to decrypt backup. Incorrect password or corrupted backup file.");
  } finally {
    wipeBytes(backupKey);
  }
}
