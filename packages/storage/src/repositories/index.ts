/**
 * @file repositories/index.ts
 * @description SQLite 数据访问仓储层 (Repository Pattern)
 * 封装 VaultMetadata 和 AuthenticatorEntry 的 CRUD 操作，提供双重驱动回退（原生 SQLite 执行与 Kysely 查询构建器）。
 */

import type { AuthenticatorEntry, VaultMetadata } from "@sa/core";
import * as SQLite from "expo-sqlite";
import type { Kysely } from "kysely";
import type { Database } from "../database";

/**
 * 主保险库元数据仓储 (VaultRepository)
 */
export class VaultRepository {
  constructor(private db: Kysely<Database>) {}

  /**
   * 持久化写入新保险库元数据
   */
  async createVault(vault: VaultMetadata): Promise<void> {
    try {
      const expoDb = await SQLite.openDatabaseAsync("2fas.db");
      await expoDb.runAsync(
        `INSERT INTO vault_metadata (
          id, createdAt, updatedAt, name, salt, iterations, memory, parallelism, encryptedVaultKey, vaultKeyNonce, vaultKeyAuthTag
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?);`,
        [
          vault.id,
          vault.createdAt,
          vault.updatedAt,
          vault.name,
          vault.salt,
          Number(vault.iterations),
          Number(vault.memory),
          Number(vault.parallelism),
          vault.encryptedVaultKey,
          vault.vaultKeyNonce,
          vault.vaultKeyAuthTag,
        ]
      );
    } catch {
      await this.db.insertInto("vault_metadata").values(vault).execute();
    }
  }

  /**
   * 根据 ID 查询特定保险库
   */
  async getVaultById(id: string): Promise<VaultMetadata | undefined> {
    return await this.db
      .selectFrom("vault_metadata")
      .selectAll()
      .where("id", "=", id)
      .executeTakeFirst();
  }

  /**
   * 获取本地所有已创建的保险库列表
   */
  async getAllVaults(): Promise<VaultMetadata[]> {
    return await this.db
      .selectFrom("vault_metadata")
      .selectAll()
      .orderBy("createdAt", "desc")
      .execute();
  }

  /**
   * 更新保险库元数据 (如修改名称或重置主密码派生参数)
   */
  async updateVault(id: string, updates: Partial<VaultMetadata>): Promise<void> {
    await this.db
      .updateTable("vault_metadata")
      .set({
        ...updates,
        updatedAt: new Date().toISOString(),
      })
      .where("id", "=", id)
      .execute();
  }

  /**
   * 删除指定保险库
   */
  async deleteVault(id: string): Promise<void> {
    await this.db.deleteFrom("vault_metadata").where("id", "=", id).execute();
  }
}

/**
 * 2FA 动态口令密文条目仓储 (AuthenticatorEntryRepository)
 */
export class AuthenticatorEntryRepository {
  constructor(private db: Kysely<Database>) {}

  /**
   * 创建并持久化一条新的 2FA 密文条目
   */
  async createEntry(entry: AuthenticatorEntry): Promise<void> {
    const favoriteInt = entry.favorite ? 1 : 0;
    const sortOrderInt = Number(entry.sortOrder) || 0;

    try {
      const expoDb = await SQLite.openDatabaseAsync("2fas.db");
      await expoDb.runAsync(
        `INSERT INTO authenticator_entries (
          id, vaultId, createdAt, updatedAt, favorite, sortOrder, ciphertext, nonce, authTag
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?);`,
        [
          entry.id,
          entry.vaultId,
          entry.createdAt,
          entry.updatedAt,
          favoriteInt,
          sortOrderInt,
          entry.ciphertext,
          entry.nonce,
          entry.authTag,
        ]
      );
    } catch {
      // 回退至 Kysely ORM 插入
      await this.db
        .insertInto("authenticator_entries")
        .values({
          ...entry,
          favorite: favoriteInt,
          sortOrder: sortOrderInt,
        } as any)
        .execute();
    }
  }

  /**
   * 根据 ID 获取单个 2FA 密文记录
   */
  async getEntryById(id: string): Promise<AuthenticatorEntry | undefined> {
    const row: any = await this.db
      .selectFrom("authenticator_entries")
      .selectAll()
      .where("id", "=", id)
      .executeTakeFirst();

    if (!row) return undefined;
    return {
      ...row,
      favorite: Boolean(row.favorite),
    };
  }

  /**
   * 根据保险库 ID 获取其下的全部 2FA 账号列表 (按排序与创建时间排列)
   */
  async getEntriesByVaultId(vaultId: string): Promise<AuthenticatorEntry[]> {
    try {
      const expoDb = await SQLite.openDatabaseAsync("2fas.db");
      const rows = await expoDb.getAllAsync<any>(
        `SELECT * FROM authenticator_entries WHERE vaultId = ? ORDER BY sortOrder ASC, createdAt DESC;`,
        [vaultId]
      );
      return rows.map((row) => ({
        ...row,
        favorite: Boolean(row.favorite),
      }));
    } catch {
      const rows = await this.db
        .selectFrom("authenticator_entries")
        .selectAll()
        .where("vaultId", "=", vaultId)
        .orderBy("sortOrder", "asc")
        .orderBy("createdAt", "desc")
        .execute();

      return rows.map((row: any) => ({
        ...row,
        favorite: Boolean(row.favorite),
      }));
    }
  }

  /**
   * 更新指定 2FA 账号 (如修改收藏状态、备注或重排序)
   */
  async updateEntry(id: string, updates: Partial<AuthenticatorEntry>): Promise<void> {
    const sanitizedUpdates: any = {
      ...updates,
      updatedAt: new Date().toISOString(),
    };
    if (typeof updates.favorite !== "undefined") {
      sanitizedUpdates.favorite = updates.favorite ? 1 : 0;
    }

    await this.db
      .updateTable("authenticator_entries")
      .set(sanitizedUpdates)
      .where("id", "=", id)
      .execute();
  }

  /**
   * 根据 ID 删除 2FA 账号记录
   */
  async deleteEntry(id: string): Promise<void> {
    try {
      const expoDb = await SQLite.openDatabaseAsync("2fas.db");
      await expoDb.runAsync(`DELETE FROM authenticator_entries WHERE id = ?;`, [id]);
    } catch {
      await this.db.deleteFrom("authenticator_entries").where("id", "=", id).execute();
    }
  }
}
