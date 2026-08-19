import { decryptAES256GCM, encryptAES256GCM, generateRandomKey } from "../crypto/aes";
import { DEFAULT_KDF_PARAMS, type KDFParams, deriveKey } from "../crypto/kdf";
import { base64ToUint8Array, uint8ArrayToBase64 } from "../crypto/utils";
import type { VaultMetadata } from "../types/domain";

/**
 * Generates a new UUID v4 string safely across all environments.
 */
function generateUUID(): string {
  if (typeof globalThis.crypto?.randomUUID === "function") {
    return globalThis.crypto.randomUUID();
  }
  const bytes = generateRandomKey(16);
  bytes[6] = (bytes[6] & 0x0f) | 0x40;
  bytes[8] = (bytes[8] & 0x3f) | 0x80;
  let hex = "";
  for (let i = 0; i < 16; i++) {
    hex += bytes[i].toString(16).padStart(2, "0");
  }
  return `${hex.substring(0, 8)}-${hex.substring(8, 12)}-${hex.substring(12, 16)}-${hex.substring(16, 20)}-${hex.substring(20, 32)}`;
}

/**
 * Generates a new Vault encryption key, encrypts it using a KEK derived from the
 * master password, and returns the VaultMetadata ready to be saved to SQLite.
 */
export async function createVault(password: string, name: string): Promise<VaultMetadata> {
  // 1. Generate salt and derive KEK (Key Encryption Key)
  const saltBytes = generateRandomKey(16);
  const params: KDFParams = {
    ...DEFAULT_KDF_PARAMS,
    salt: uint8ArrayToBase64(saltBytes),
  };
  const kek = await deriveKey(password, params);

  // 2. Generate the actual Vault Key
  const vaultKey = generateRandomKey(32);

  // 3. Encrypt the Vault Key with the KEK
  const encryptedVaultKeyData = await encryptAES256GCM(uint8ArrayToBase64(vaultKey), kek);

  // 4. Return VaultMetadata
  return {
    id: generateUUID(),
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString(),
    name,
    salt: params.salt,
    iterations: params.iterations,
    memory: params.memory,
    parallelism: params.parallelism,
    encryptedVaultKey: encryptedVaultKeyData.ciphertext,
    vaultKeyNonce: encryptedVaultKeyData.nonce,
    vaultKeyAuthTag: encryptedVaultKeyData.authTag,
  };
}

/**
 * Unlocks a Vault by verifying the master password and deriving the Vault Key.
 * Note: The derived Vault Key should be held in memory (e.g. React Context),
 * NOT saved to disk.
 */
export async function unlockVault(password: string, vault: VaultMetadata): Promise<Uint8Array> {
  // 1. Re-derive KEK using saved KDF params
  const params: KDFParams = {
    salt: vault.salt,
    iterations: vault.iterations,
    memory: vault.memory,
    parallelism: vault.parallelism,
    hashLength: 32,
  };
  const kek = await deriveKey(password, params);

  // 2. Decrypt the Vault Key using KEK
  const vaultKeyBase64 = await decryptAES256GCM(
    {
      ciphertext: vault.encryptedVaultKey,
      nonce: vault.vaultKeyNonce,
      authTag: vault.vaultKeyAuthTag,
    },
    kek,
  );

  return base64ToUint8Array(vaultKeyBase64);
}
