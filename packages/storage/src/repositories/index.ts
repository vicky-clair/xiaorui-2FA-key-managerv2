import type { AuthenticatorEntry, VaultMetadata } from "@sa/core";
import type { Kysely } from "kysely";
import type { Database } from "../database";
import * as SQLite from "expo-sqlite";

export class VaultRepository {
  constructor(private db: Kysely<Database>) {}

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

  async getVaultById(id: string): Promise<VaultMetadata | undefined> {
    return await this.db
      .selectFrom("vault_metadata")
      .selectAll()
      .where("id", "=", id)
      .executeTakeFirst();
  }

  async getAllVaults(): Promise<VaultMetadata[]> {
    return await this.db
      .selectFrom("vault_metadata")
      .selectAll()
      .orderBy("createdAt", "desc")
      .execute();
  }

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

  async deleteVault(id: string): Promise<void> {
    await this.db.deleteFrom("vault_metadata").where("id", "=", id).execute();
  }
}

export class AuthenticatorEntryRepository {
  constructor(private db: Kysely<Database>) {}

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
      // Fallback to kysely
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

  async deleteEntry(id: string): Promise<void> {
    try {
      const expoDb = await SQLite.openDatabaseAsync("2fas.db");
      await expoDb.runAsync(`DELETE FROM authenticator_entries WHERE id = ?;`, [id]);
    } catch {
      await this.db.deleteFrom("authenticator_entries").where("id", "=", id).execute();
    }
  }
}
