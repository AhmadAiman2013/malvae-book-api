import { betterAuth } from 'better-auth';
import { drizzleAdapter } from 'better-auth/adapters/drizzle';
import { admin } from 'better-auth/plugins';
import type { AppEnv } from './env';
import type { Db } from './db/client';
import { createDb } from './db/worker';
import * as authSchema from './db/auth-schema';

// Bindings exist per request on Workers, so build auth per request.
// Keep plugins/options in sync with src/auth.cli.ts.
export function createAuth(env: AppEnv, db: Db = createDb(env)) {
    return betterAuth({
        baseURL: env.PUBLIC_ORIGIN, // the Vue worker's public origin; cookies are first-party there
        secret: env.BETTER_AUTH_SECRET,
        trustedOrigins: [env.PUBLIC_ORIGIN],
        database: drizzleAdapter(db, { provider: 'sqlite', schema: authSchema }),
        emailAndPassword: { enabled: true, requireEmailVerification: false },
        plugins: [admin()], // adds user.role ('user' | 'admin')
    });
}
