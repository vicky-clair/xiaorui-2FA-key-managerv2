/**
 * @file kdf.ts
 * @description 基于 Argon2id 的密钥派生模块 (Key Derivation Function)
 * 采用高性能 WebAssembly (hash-wasm) 实现国际顶级的 Argon2id 算法，将用户主密码安全派生为主加密密钥。
 */

import { argon2id } from "hash-wasm";
import { base64ToUint8Array } from "./utils";

/**
 * Argon2id 密钥派生参数接口
 */
export interface KDFParams {
  salt: string; // Base64 编码的 16 字节随机盐
  iterations: number; // 迭代轮数 (timeCost)
  memory: number; // 内存消耗 (以 KB 为单位，例如 16384 KB = 16 MB)
  parallelism: number; // 并行度
  hashLength: number; // 派生密钥长度 (默认 32 字节 / 256 位，供 AES-256 使用)
}

/**
 * 客户端推荐的默认 Argon2id 密码学安全参数配置
 */
export const DEFAULT_KDF_PARAMS: Omit<KDFParams, "salt"> = {
  iterations: 2,
  memory: 16384, // 16 MB 内存消耗，兼顾客户端响应速度与抗暴力破解强度
  parallelism: 1,
  hashLength: 32,
};

/**
 * 使用 Argon2id 从用户主密码和随机盐中派生 256 位加密密钥
 * @param password 用户输入的主密码 (Master Password)
 * @param params 包含 salt、iterations、memory 的 KDF 配置参数
 * @returns 派生出的 32 字节高强度密钥 (Uint8Array)
 */
export async function deriveKey(password: string, params: KDFParams): Promise<Uint8Array> {
  const derivedKey = await argon2id({
    password,
    salt: base64ToUint8Array(params.salt),
    iterations: params.iterations,
    memorySize: params.memory,
    parallelism: params.parallelism,
    hashLength: params.hashLength,
    outputType: "binary", // 返回 Uint8Array
  });

  return derivedKey;
}
