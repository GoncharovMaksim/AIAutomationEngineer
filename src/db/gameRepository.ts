import { config } from '../config.js';
import { IGameRepository } from './types.js';
import { SqliteDriver } from './sqliteDriver.js';
import { PostgresDriver } from './postgresDriver.js';

export * from './types.js';

function createRepository(): IGameRepository {
  const dbUrl = config.databaseUrl.trim();
  if (dbUrl.startsWith('postgres://') || dbUrl.startsWith('postgresql://')) {
    console.log('[Database] 🐘 Using PostgreSQL Driver (DATABASE_URL configured)');
    return new PostgresDriver(dbUrl);
  }
  console.log('[Database] 🗄️ Using SQLite Driver (Zero-Config WAL mode)');
  return new SqliteDriver();
}

export const gameRepository: IGameRepository = createRepository();
