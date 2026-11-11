declare module 'duckdb' {
  export class Database {
    constructor(path: string, callback?: (err: Error | null) => void);
    connect(): Connection;
  }

  export class Connection {
    run(sql: string, ...args: any[]): void;
    all(sql: string, ...args: any[]): void;
    close(): void;
  }

  const duckdb: {
    Database: typeof Database;
  };

  export default duckdb;
}
