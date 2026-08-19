import { createDatabase, initializeSchema } from "@sa/storage";
import type React from "react";
import { createContext, useContext, useEffect, useState } from "react";

interface DatabaseContextState {
  isInitialized: boolean;
  error: Error | null;
}

const DatabaseContext = createContext<DatabaseContextState | null>(null);

export const useDatabase = () => {
  const context = useContext(DatabaseContext);
  if (!context) {
    throw new Error("useDatabase must be used within a DatabaseProvider");
  }
  return context;
};

export const DatabaseProvider: React.FC<{ children: React.ReactNode }> = ({ children }) => {
  const [isInitialized, setIsInitialized] = useState(false);
  const [error, setError] = useState<Error | null>(null);

  useEffect(() => {
    let active = true;

    async function initDb() {
      try {
        console.log("Initializing local database...");
        const db = await createDatabase();
        await initializeSchema(db);
        if (active) {
          console.log("Database initialized successfully.");
          setIsInitialized(true);
        }
      } catch (err) {
        console.error("Failed to initialize database", err);
        if (active) {
          setError(err instanceof Error ? err : new Error(String(err)));
        }
      }
    }

    initDb();

    return () => {
      active = false;
    };
  }, []);

  return (
    <DatabaseContext.Provider value={{ isInitialized, error }}>{children}</DatabaseContext.Provider>
  );
};
