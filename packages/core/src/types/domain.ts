export type OTPAlgorithm = "SHA1" | "SHA256" | "SHA512";

/**
 * The inner decrypted payload of an authenticator entry.
 * This is what gets encrypted into `ciphertext`.
 */
export interface EntryPayload {
  issuer: string;
  account: string;
  secret: string;
  algorithm: OTPAlgorithm;
  digits: number;
  period: number;
  icon?: string;
  notes?: string;
}

/**
 * The encrypted database record for an authenticator entry.
 */
export interface AuthenticatorEntry {
  id: string;
  vaultId: string;
  createdAt: string;
  updatedAt: string;
  favorite: boolean;
  sortOrder: number;

  // Encrypted Payload Output (AES-256-GCM)
  ciphertext: string; // Base64
  nonce: string; // Base64
  authTag: string; // Base64
}

export type EntryMetadata = AuthenticatorEntry;

/**
 * The database record for a Vault, containing only KDF and encryption parameters.
 * Master Password -> Argon2id(salt, KDF params) -> KEK
 * KEK -> Decrypts(encryptedVaultKey, nonce, authTag) -> VaultKey
 * VaultKey -> Decrypts(AuthenticatorEntry)
 */
export interface VaultMetadata {
  id: string;
  createdAt: string;
  updatedAt: string;
  name: string;

  // KDF Parameters (Argon2id)
  salt: string; // Base64
  iterations: number; // Time cost
  memory: number; // Memory cost in KB
  parallelism: number; // Parallelism level

  // Encrypted Vault Key Output (AES-256-GCM)
  encryptedVaultKey: string; // Base64
  vaultKeyNonce: string; // Base64
  vaultKeyAuthTag: string; // Base64
}
