import { describe, expect, it } from "bun:test";
import {
  createEncryptedBackup,
  restoreEncryptedBackup,
  type BackupEntryItem,
} from "../packages/core/src";

describe("Encrypted Backup (.sav) Test Suite", () => {
  const sampleEntries: BackupEntryItem[] = [
    {
      issuer: "GitHub",
      account: "dev@github.com",
      secret: "JBSWY3DPEHPK3PXP",
      algorithm: "SHA1",
      digits: 6,
      period: 30,
      favorite: true,
    },
    {
      issuer: "Google",
      account: "user@gmail.com",
      secret: "MFRGGZDFMZTWQ2LK",
      algorithm: "SHA1",
      digits: 6,
      period: 30,
      favorite: false,
    },
  ];

  it("should create an encrypted backup file and restore it with the correct password", async () => {
    const backupPassword = "StrongBackupPassword999!";
    const backupContent = await createEncryptedBackup(sampleEntries, backupPassword, "Test Vault");

    expect(backupContent).toContain("SECURE_AUTHENTICATOR_BACKUP");

    const restored = await restoreEncryptedBackup(backupContent, backupPassword);
    expect(restored.vaultName).toBe("Test Vault");
    expect(restored.entries.length).toBe(2);
    expect(restored.entries[0].issuer).toBe("GitHub");
    expect(restored.entries[0].secret).toBe("JBSWY3DPEHPK3PXP");
    expect(restored.entries[1].issuer).toBe("Google");
  });

  it("should fail restoration when an incorrect password is provided", async () => {
    const backupPassword = "CorrectPassword123";
    const backupContent = await createEncryptedBackup(sampleEntries, backupPassword);

    expect(restoreEncryptedBackup(backupContent, "WrongPassword!")).rejects.toThrow();
  });

  it("should fail restoration on corrupted backup content", async () => {
    const backupPassword = "Password123";
    const backupContent = await createEncryptedBackup(sampleEntries, backupPassword);
    const corruptedContent = backupContent.replace(/ciphertext":\s*"[^"]+/, 'ciphertext": "invalidBase64==');

    expect(restoreEncryptedBackup(corruptedContent, backupPassword)).rejects.toThrow();
  });
});
