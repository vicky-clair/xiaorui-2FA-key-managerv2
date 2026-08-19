import { Buffer } from "node:buffer";
import Argon2 from "react-native-argon2";

export interface KDFParams {
  salt: string; // Base64
  iterations: number;
  memory: number; // in KB
  parallelism: number;
  hashLength: number; // Default 32 for AES-256
}

export const DEFAULT_KDF_PARAMS: Omit<KDFParams, "salt"> = {
  iterations: 3,
  memory: 65536, // 64 MB
  parallelism: 4,
  hashLength: 32,
};

/**
 * Derives a key from a master password using Argon2id.
 *
 * @param password The master password
 * @param params The KDF parameters including salt
 * @returns The derived key as a Buffer
 */
export async function deriveKey(password: string, params: KDFParams): Promise<Buffer> {
  const result = await Argon2(password, params.salt, {
    iterations: params.iterations,
    memory: params.memory,
    parallelism: params.parallelism,
    hashLength: params.hashLength,
    mode: "argon2id",
  });

  // react-native-argon2 returns a hex string for the hash in result.rawHash
  // Depending on the exact lib version, we parse the raw output:
  return Buffer.from(result.rawHash, "hex");
}
