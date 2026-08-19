import { argon2id } from "hash-wasm";
import { base64ToUint8Array } from "./utils";

export interface KDFParams {
  salt: string; // Base64
  iterations: number;
  memory: number; // in KB
  parallelism: number;
  hashLength: number; // Default 32 for AES-256
}

export const DEFAULT_KDF_PARAMS: Omit<KDFParams, "salt"> = {
  iterations: 2,
  memory: 16384, // 16 MB for fast and responsive client-side derivation
  parallelism: 1,
  hashLength: 32,
};

/**
 * Derives a key from a master password using Argon2id (WebAssembly version via hash-wasm).
 *
 * @param password The master password
 * @param params The KDF parameters including salt
 * @returns The derived key as a Uint8Array
 */
export async function deriveKey(password: string, params: KDFParams): Promise<Uint8Array> {
  const derivedKey = await argon2id({
    password,
    salt: base64ToUint8Array(params.salt),
    iterations: params.iterations,
    memorySize: params.memory, // memorySize is in KB
    parallelism: params.parallelism,
    hashLength: params.hashLength,
    outputType: "binary", // returns Uint8Array
  });

  return derivedKey;
}
