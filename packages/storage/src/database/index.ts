/**
 * @file database/index.ts
 * @description SQLite 本地持久化数据库引擎与自动化表结构迁移管理
 * 基于 expo-sqlite + Kysely 查询构建器，提供端到端类型安全、自适应索引与动态热升级支持。
 */

import type { AuthenticatorEntry, VaultMetadata } from "@sa/core";
import * as SQLite from "expo-sqlite";
import { Kysely } from "kysely";
import { ExpoDialect } from "kysely-expo";

/**
 * Kysely 强类型数据库模式定义
 */
export interface Database {
  authenticator_entries: AuthenticatorEntry;
  vault_metadata: VaultMetadata;
}

let dbInstance: Kysely<Database> | null = null;
let schemaInitDone = false;

/**
 * 单例模式获取或创建 Kysely 数据库连接实例
 * @param dbName 数据库文件名，默认为 2fas.db
 */
export async function createDatabase(dbName = "2fas.db"): Promise<Kysely<Database>> {
  if (!dbInstance) {
    const expoDb = await SQLite.openDatabaseAsync(dbName);
    dbInstance = new Kysely<Database>({
      dialect: new ExpoDialect({
        database: expoDb as any,
      }),
    });
  }
  return dbInstance;
}

/**
 * 数据库初始化与安全热迁移 (Auto-Migration)
 * 启动时自动检查表结构与缺失字段，防止旧版本升级后因列不存在引发 SQL 错误
 */
export async function initializeSchema(db?: Kysely<Database>): Promise<void> {
  if (schemaInitDone) return;

  const expoDb = await SQLite.openDatabaseAsync("2fas.db");

  // 1. 确保主保险库元数据表存在 (包含 Argon2 盐值与信封加密后的主密钥)
  await expoDb.execAsync(`
    CREATE TABLE IF NOT EXISTS vault_metadata (
      id TEXT PRIMARY KEY NOT NULL,
      createdAt TEXT NOT NULL,
      updatedAt TEXT NOT NULL,
      name TEXT NOT NULL,
      salt TEXT NOT NULL,
      iterations INTEGER NOT NULL,
      memory INTEGER NOT NULL,
      parallelism INTEGER NOT NULL,
      encryptedVaultKey TEXT NOT NULL,
      vaultKeyNonce TEXT NOT NULL,
      vaultKeyAuthTag TEXT NOT NULL
    );
  `);

  // 2. 确保 2FA 动态口令密文条目表存在 (零明文设计，严密索引)
  await expoDb.execAsync(`
    CREATE TABLE IF NOT EXISTS authenticator_entries (
      id TEXT PRIMARY KEY NOT NULL,
      vaultId TEXT NOT NULL,
      createdAt TEXT NOT NULL,
      updatedAt TEXT NOT NULL,
      favorite INTEGER NOT NULL DEFAULT 0,
      sortOrder INTEGER NOT NULL DEFAULT 0,
      ciphertext TEXT NOT NULL,
      nonce TEXT NOT NULL,
      authTag TEXT NOT NULL
    );

    CREATE INDEX IF NOT EXISTS authenticator_entries_vault_id_idx ON authenticator_entries (vaultId);
  `);

  // 3. 动态热迁移检查：利用 PRAGMA table_info 自动为老数据库补充缺失字段
  try {
    const tableInfo = await expoDb.getAllAsync<{ name: string }>("PRAGMA table_info(authenticator_entries);");
    const columnNames = new Set(tableInfo.map((col) => col.name));

    if (!columnNames.has("vaultId")) {
      await expoDb.execAsync("ALTER TABLE authenticator_entries ADD COLUMN vaultId TEXT;");
    }
    if (!columnNames.has("favorite")) {
      await expoDb.execAsync("ALTER TABLE authenticator_entries ADD COLUMN favorite INTEGER NOT NULL DEFAULT 0;");
    }
    if (!columnNames.has("sortOrder")) {
      await expoDb.execAsync("ALTER TABLE authenticator_entries ADD COLUMN sortOrder INTEGER NOT NULL DEFAULT 0;");
    }
    if (!columnNames.has("ciphertext")) {
      await expoDb.execAsync("ALTER TABLE authenticator_entries ADD COLUMN ciphertext TEXT;");
    }
    if (!columnNames.has("nonce")) {
      await expoDb.execAsync("ALTER TABLE authenticator_entries ADD COLUMN nonce TEXT;");
    }
    if (!columnNames.has("authTag")) {
      await expoDb.execAsync("ALTER TABLE authenticator_entries ADD COLUMN authTag TEXT;");
    }
  } catch (migErr) {
    console.warn("数据库列迁移检查提示:", migErr);
  }

  schemaInitDone = true;
}
