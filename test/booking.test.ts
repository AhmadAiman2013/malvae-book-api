import { createClient } from '@libsql/client';
import { count, eq } from 'drizzle-orm';
import { migrate } from 'drizzle-orm/libsql/migrator';
import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { beforeEach, describe, expect, it } from 'vitest';
import { makeDb, type Db } from '../src/db/client';
import { bookings, occupiedSlots, settings } from '../src/db/app-schema';
import { user } from '../src/db/auth-schema';
import { cancelByToken, cancelPending, confirmBooking, createBooking } from '../src/services/bookings';
import { updateSettings } from '../src/services/settings';

// Fixed clock: 2026-11-09 00:00 MYT. Bookings are on 2026-11-20.
const NOW = Date.parse('2026-11-09T00:00:00+08:00');
const DAY = '2026-11-20';
const at = (h: number, day = DAY) => `${day}T${String(h).padStart(2, '0')}:00`;

let db: Db;

beforeEach(async () => {
    // Real file DB + the real generated migrations, so the test exercise the actual schema.
    const dir = mkdtempSync(join(tmpdir(), 'homestay-'));
    db = makeDb(createClient({ url: `file:${join(dir, 'test.db')}` }));
    await migrate(db, { migrationsFolder: './drizzle' });
    await db.insert(settings).values({
        id: 1, openHour: 9, closeHour: 22, hourlyRateSen: 10_000, maxSlots: 6, maxAttendees: 50, leadMinutes: 60,
    });
});

const who = { guestName: 'Ali', guestEmail: 'ali@example.com', guestPhone: '0123456789', attendees: 10 };
const book = (start: number, end: number, userId: string | null = null, day = DAY) =>
    createBooking(db, { ...who, startAt: at(start, day), endAt: at(end, day) }, userId, NOW);
const slotCount = async () => (await db.select({ n: count() }).from(occupiedSlots))[0].n;
const bookingCount = async () => (await db.select({ n: count() }).from(bookings))[0].n;

describe('double-booking guarantee', () => {
    it('lets exactly one of many concurrent requests take the same slot', async () => {
        // Single-process client = serialized, so this proves the constraint, not Turso's network concurrency.
        const results = await Promise.all(Array.from({ length: 10 }, () => book(10, 11)));
        expect(results.filter((r) => r.ok)).toHaveLength(1);
        expect(results.filter((r) => !r.ok && r.error === 'slots_unavailable')).toHaveLength(9);
        expect(await bookingCount()).toBe(1);
        expect(await slotCount()).toBe(1);
    });

    it('rejects overlapping ranges and rolls back atomically', async () => {
        expect((await book(10, 12)).ok).toBe(true); // 10:00, 11:00
        const b = await book(11, 13); // 11:00 taken, 12:00 free
        expect(b).toEqual({ ok: false, error: 'slots_unavailable' });
        expect(await bookingCount()).toBe(1); // no orphan booking row
        expect(await slotCount()).toBe(2); // 12:00 was not left behind
        const twelve = await db.select().from(occupiedSlots).where(eq(occupiedSlots.slot, at(12)));
        expect(twelve).toHaveLength(0);
    });

    it('allows back-to-back bookings (end is exclusive)', async () => {
        expect((await book(10, 11)).ok).toBe(true);
        expect((await book(11, 12)).ok).toBe(true);
        expect(await slotCount()).toBe(2);
    });
});

describe('creating bookings', () => {
    it('prices flat per hour and locks every hour', async () => {
        const r = await book(10, 13);
        expect(r.ok && r.totalAmount).toBe(30_000);
        expect(await slotCount()).toBe(3);
    });

    it('guest gets a hashed manage token; logged-in user does not', async () => {
        await db.insert(user).values({ id: 'u1', name: 'Test', email: 'test@example.com' });

        const g = await book(10, 11);
        expect(g.ok && g.manageToken).toBeTruthy();
        const [row] = await db.select().from(bookings);
        expect(row.userId).toBeNull();
        expect(row.manageTokenHash).toHaveLength(64);
        expect(row.manageTokenHash).not.toBe(g.ok && g.manageToken); // raw token never stored

        const u = await book(12, 13, 'u1');
        expect(u.ok && u.manageToken).toBeNull();
        const [mine] = await db.select().from(bookings).where(eq(bookings.userId, 'u1'));
        expect(mine.manageTokenHash).toBeNull();
    });

    it.each([
        ['before opening', 8, 9, 'outside_hours'],
        ['past closing', 21, 23, 'outside_hours'],
        ['end before start', 12, 10, 'invalid_range'],
        ['too many slots', 9, 16, 'too_many_slots'],
    ] as const)('rejects %s', async (_n, s, e, error) => {
        expect(await book(s, e)).toEqual({ ok: false, error });
        expect(await bookingCount()).toBe(0);
    });

    it('rejects multi-day, past, and oversized-party bookings', async () => {
        const multi = await createBooking(db, { ...who, startAt: at(21), endAt: at(1, '2026-11-21') }, null, NOW);
        expect(multi).toEqual({ ok: false, error: 'multi_day' });
        expect(await book(10, 11, null, '2026-11-08')).toEqual({ ok: false, error: 'too_soon' });
        const big = await createBooking(db, { ...who, attendees: 51, startAt: at(10), endAt: at(11) }, null, NOW);
        expect(big).toEqual({ ok: false, error: 'too_many_attendees' });
    });
});

describe('cancelling', () => {
    it('guest can cancel a pending booking by token, which frees the slots', async () => {
        const r = await book(10, 12);
        if (!r.ok || !r.manageToken) throw new Error('setup failed');

        expect(await cancelByToken(db, 'wrong-token')).toBe('not_found');
        expect(await cancelByToken(db, r.manageToken)).toBe('cancelled');
        expect(await slotCount()).toBe(0);
        expect((await book(10, 12)).ok).toBe(true); // slots are bookable again
    });

    it('cannot cancel once confirmed; slots stay locked', async () => {
        const r = await book(10, 11);
        if (!r.ok || !r.manageToken) throw new Error('setup failed');

        expect(await confirmBooking(db, r.id)).toBe(true);
        expect(await confirmBooking(db, r.id)).toBe(false); // already confirmed
        expect(await cancelPending(db, r.id)).toBe(false);
        expect(await cancelByToken(db, r.manageToken)).toBe('not_cancellable');
        expect(await slotCount()).toBe(1);
    });

    it('cancelling twice is a no-op the second time', async () => {
        const r = await book(10, 11);
        if (!r.ok) throw new Error('setup failed');
        expect(await cancelPending(db, r.id)).toBe(true);
        expect(await cancelPending(db, r.id)).toBe(false);
    });
});

describe('operating hours are configurable', () => {
    it('applies to new bookings only; existing bookings are untouched', async () => {
        const existing = await book(20, 22); // 20:00 and 21:00
        expect(existing.ok).toBe(true);

        await updateSettings(db, { closeHour: 20 });

        expect(await book(19, 20)).toEqual({ ok: true, id: expect.any(String), ref: expect.any(String), manageToken: expect.any(String), totalAmount: 10_000 });
        expect(await book(20, 21, null, '2026-11-21')).toEqual({ ok: false, error: 'outside_hours' });
        expect(await slotCount()).toBe(3); // 20:00, 21:00 (existing) + 19:00 (new)
    });

    it('rejects nonsensical hours', async () => {
        await expect(updateSettings(db, { openHour: 22, closeHour: 9 })).rejects.toThrow('invalid operating hours');
    });
});
