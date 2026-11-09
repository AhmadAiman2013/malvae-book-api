import { createClient } from '@libsql/client/web';
import type { AppEnv } from '../env';
import { makeDb } from './client';

export const createDb = (env: AppEnv) =>
    makeDb(createClient({ url: env.TURSO_DATABASE_URL, authToken: env.TURSO_AUTH_TOKEN }));
