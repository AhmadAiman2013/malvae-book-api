import { eq } from 'drizzle-orm';
import type { Db } from '../db/client';
import { settings } from '../db/app-schema';

export type Settings = typeof settings.$inferSelect;

export async function getSettings(db: Db): Promise<Settings> {
    const [row] = await db.select().from(settings).where(eq(settings.id, 1)).limit(1);
    if (!row) throw new Error('settings row missing: run scripts/seed.sql');
    return row;
}

/** Admin-facing. Only affects NEW bookings and the availability grid; existing bookings are never revalidated. */
export async function updateSettings(db: Db, patch: Partial<Omit<Settings, 'id'>>): Promise<Settings> {
    const next = { ...(await getSettings(db)), ...patch };
    if (!(next.openHour >= 0 && next.openHour < next.closeHour && next.closeHour <= 24)) {
        throw new Error('invalid operating hours');
    }
    if (next.hourlyRateSen < 0 || next.maxSlots < 1 || next.maxAttendees < 1 || next.leadMinutes < 0) {
        throw new Error('invalid settings');
    }
    if (Object.keys(patch).length > 0) await db.update(settings).set(patch).where(eq(settings.id, 1));
    return next;
}
