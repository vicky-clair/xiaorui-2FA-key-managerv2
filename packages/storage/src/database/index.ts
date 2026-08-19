import type { AuthenticatorEntry, VaultMetadata } from "@sa/core";
import * as SQLite from "expo-sqlite";
import { Kysely } from "kysely";
import { ExpoDialect } from "kysely-expo";

export interface Database {
  authenticator_entries: AuthenticatorEntry;
  vault_metadata: VaultMetadata;
}

let dbInstance: Kysely<Database> | null = null;
let schemaInitDone = false;

export async function createDatabase(dbName = "2fas.db"): Promise<Kysely<Database>> {
  if (!dbInstance) {
    const expoDb = await SQLite.openDatabaseAsync(dbName);
    dbInstance = new Kysely<Database>({
      dialect: new ExpoDialect({
        database: expoDb,
      }),
    });
  }
  return dbInstance;
}

/**
 * Initializes and auto-migrates the SQLite database schema directly using SQLite DDL.
 */
export async function initializeSchema(db?: Kysely<Database>): Promise<void> {
  if (schemaInitDone) return;

  const expoDb = await SQLite.openDatabaseAsync("2fas.db");

  // 1. Ensure vault_metadata table exists
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

  // 2. Ensure authenticator_entries table exists
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

  // 3. Auto-migration check: verify all columns exist in authenticator_entries
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
    console.warn("Table column migration check warning:", migErr);
  }

  schemaInitDone = true;
}
