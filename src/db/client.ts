import { drizzle } from 'drizzle-orm/libsql';
import type { Client } from '@libsql/client';
import * as appSchema from './app-schema';
import * as authSchema from './auth-schema';

export const schema = { ...appSchema, ...authSchema };

// Runtime-agnostic: pass a libSQL client (web client on Workers, node client in test).
export const makeDb = (client: Client) => drizzle(client, { schema });
export type Db = ReturnType<typeof makeDb>;
