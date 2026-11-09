// Used ONLY by `npm run auth:generate` (Better Auth CLI). It must not import
// ./db/auth-schema, which doesn't exist until the CLI has generated it.
// Keep plugins/options in sync with src/auth.ts.
import { createClient } from '@libsql/client';
import { betterAuth } from 'better-auth';
import { drizzleAdapter } from 'better-auth/adapters/drizzle';
import { admin } from 'better-auth/plugins';
import { drizzle } from 'drizzle-orm/libsql';

const db = drizzle(createClient({ url: 'file:cli-dummy.db' }));

export const auth = betterAuth({
    database: drizzleAdapter(db, { provider: 'sqlite' }),
    emailAndPassword: { enabled: true, requireEmailVerification: false },
    plugins: [admin()],
});
