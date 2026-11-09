import { zValidator } from '@hono/zod-validator';
import { Hono } from 'hono';
import { createAuth } from './auth';
import type { Db } from './db/client';
import { createDb } from './db/worker';
import type { AppEnv } from './env';
import { availabilityQuery, createBookingSchema } from './lib/schemas';
import { createBooking, occupiedBetween } from './services/bookings';
import { getSettings } from './services/settings';

type Vars = { db: Db; user: { id: string; role?: string | null } | null };
const app = new Hono<{ Bindings: AppEnv; Variables: Vars }>();

app.get('/hello', (c) => {
    console.log({ level: 'info', msg: 'call Hello', userAgent: c.req.header('user-agent') })
    return c.json({ message: 'Hello from Hono', time: new Date().toISOString() })
})

// Better Auth owns /api/auth/*. Registered before the session middleware, so it never runs for these.
app.on(['GET', 'POST'], '/api/auth/*', (c) => createAuth(c.env).handler(c.req.raw));

// Session for everything else; user is null for guests.
app.use('/api/*', async (c, next) => {
    const db = createDb(c.env);
    c.set('db', db);
    const session = await createAuth(c.env, db).api.getSession({ headers: c.req.raw.headers });
    c.set('user', session?.user ?? null);
    await next();
});

app.get('/api/availability', zValidator('query', availabilityQuery), async (c) => {
    const { from, to } = c.req.valid('query');
    const db = c.get('db');
    const [s, occupied] = await Promise.all([getSettings(db), occupiedBetween(db, from, to)]);
    return c.json({
        openHour: s.openHour,
        closeHour: s.closeHour,
        hourlyRateSen: s.hourlyRateSen,
        maxSlots: s.maxSlots,
        occupied,
    });
});

app.post('/api/bookings', zValidator('json', createBookingSchema), async (c) => {
    const res = await createBooking(c.get('db'), c.req.valid('json'), c.get('user')?.id ?? null);
    if (res.ok) {
        return c.json({ ref: res.ref, manageToken: res.manageToken, totalAmount: res.totalAmount }, 201);
    }
    return c.json({ error: res.error }, res.error === 'slots_unavailable' ? 409 : 422);
});

export default app;
