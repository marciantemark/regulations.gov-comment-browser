import React, { createContext, useContext, useEffect, useState } from 'react';
import initSqlJs from 'sql.js';
import type { Database } from 'sql.js';

interface DatabaseContextType {
  db: Database | null;
  loading: boolean;
  error: string | null;
}

const DatabaseContext = createContext<DatabaseContextType>({
  db: null,
  loading: true,
  error: null,
});

export const useDatabase = () => {
  const context = useContext(DatabaseContext);
  if (!context) {
    throw new Error('useDatabase must be used within DatabaseProvider');
  }
  return context;
};

interface DatabaseProviderProps {
  children: React.ReactNode;
}

export const DatabaseProvider: React.FC<DatabaseProviderProps> = ({ children }) => {
  const [db, setDb] = useState<Database | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    const loadDatabase = async () => {
      try {
        // Initialize SQL.js
        const SQL = await initSqlJs({
          locateFile: file => `https://sql.js.org/dist/${file}`
        });

        // Fetch the database file with cache busting
        const timestamp = Date.now();
        console.log('Fetching database from /abstractions.db...');
        const response = await fetch(`/abstractions.db?t=${timestamp}`);
        if (!response.ok) {
          throw new Error(`Failed to fetch database: ${response.status} ${response.statusText}`);
        }

        const buffer = await response.arrayBuffer();
        console.log('Database loaded, size:', buffer.byteLength, 'bytes');
        
        // Create database from buffer
        const db = new SQL.Database(new Uint8Array(buffer));
        
        // Verify database is valid
        try {
          const tables = db.exec("SELECT name FROM sqlite_master WHERE type='table'");
          console.log('Database tables:', tables[0]?.values || 'No tables found');
        } catch (verifyError) {
          console.error('Database verification failed:', verifyError);
          throw new Error('Invalid database file');
        }
        
        setDb(db);
        setLoading(false);
      } catch (err) {
        console.error('Error loading database:', err);
        setError(err instanceof Error ? err.message : 'Failed to load database');
        setLoading(false);
      }
    };

    loadDatabase();
  }, []);

  return (
    <DatabaseContext.Provider value={{ db, loading, error }}>
      {children}
    </DatabaseContext.Provider>
  );
};
