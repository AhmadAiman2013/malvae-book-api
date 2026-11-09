export type AppEnv = {
    TURSO_DATABASE_URL: string;
    TURSO_AUTH_TOKEN: string;
    BETTER_AUTH_SECRET: string;
    PUBLIC_ORIGIN: string; // the Vue worker's public origin (http://localhost:5173 in dev)
};
