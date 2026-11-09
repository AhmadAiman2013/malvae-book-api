import { and, eq, gte, lte, sql } from 'drizzle-orm';
import type { Db } from '../db/client';
import { bookings, occupiedSlots } from '../db/app-schema';
import { isUniqueViolation } from '../lib/errors';
import type { CreateBookingInput } from '../lib/schemas';
import { validateRange, type RangeError } from '../lib/slots';
import { makeRef, randomToken, sha256Hex } from '../lib/tokens';
import { getSettings } from './settings';

export type CreateResult =
    | { ok: true; id: string; ref: string; manageToken: string | null; totalAmount: number }
    | { ok: false; error: RangeError | 'too_many_attendees' | 'slots_unavailable' };

export async function createBooking(
    db: Db,
    input: CreateBookingInput,
    userId: string | null,
    nowMs: number = Date.now(),
): Promise<CreateResult> {
    const rules = await getSettings(db);
    if (input.attendees > rules.maxAttendees) return { ok: false, error: 'too_many_attendees' };

    const v = validateRange(rules, input.startAt, input.endAt, nowMs);
    if (!v.ok) return v;

    const id = crypto.randomUUID();
    const ref = makeRef();
    const manageToken = userId ? null : randomToken(); // guests get a one-time manage token
    const totalAmount = v.slots.length * rules.hourlyRateSen; // price is always computed server-side

    try {
        // One transaction: booking row + one row per hour. If any slot is taken the
        // PRIMARY KEY on occupied_slots.slot fails and everything rolls back.
        await db.batch([
            db.insert(bookings).values({
                id,
                ref,
                userId,
                manageTokenHash: manageToken ? await sha256Hex(manageToken) : null,
                guestName: input.guestName,
                guestEmail: input.guestEmail,
                guestPhone: input.guestPhone,
                attendees: input.attendees,
                notes: input.notes ?? null,
                startAt: input.startAt,
                endAt: input.endAt,
                status: 'pending',
                totalAmount,
            }),
            db.insert(occupiedSlots).values(v.slots.map((slot) => ({ slot, bookingId: id }))),
        ]);
    } catch (e) {
        if (isUniqueViolation(e, 'occupied_slots.slot')) return { ok: false, error: 'slots_unavailable' };
        throw e;
    }
    return { ok: true, id, ref, manageToken, totalAmount };
}

/** Occupied slot strings for dates [from, to] inclusive ('YYYY-MM-DD'). */
export async function occupiedBetween(db: Db, from: string, to: string): Promise<string[]> {
    const rows = await db
        .select({ slot: occupiedSlots.slot })
        .from(occupiedSlots)
        .where(and(gte(occupiedSlots.slot, `${from}T00:00`), lte(occupiedSlots.slot, `${to}T23:00`)));
    return rows.map((r) => r.slot).sort();
}

export async function confirmBooking(db: Db, id: string): Promise<boolean> {
    const res = await db
        .update(bookings)
        .set({ status: 'confirmed' })
        .where(and(eq(bookings.id, id), eq(bookings.status, 'pending')));
    return res.rowsAffected > 0;
}

/**
 * Cancels only while still 'pending' (an admin may confirm at the same moment).
 * Both statements are guarded and run in one transaction; the delete runs first
 * and the status is still 'pending' when the update evaluates its guard.
 */
export async function cancelPending(db: Db, bookingId: string): Promise<boolean> {
    const [, res] = await db.batch([
        db.delete(occupiedSlots).where(
            and(
                eq(occupiedSlots.bookingId, bookingId),
                sql`exists (select 1 from ${bookings} where ${bookings.id} = ${bookingId} and ${bookings.status} = 'pending')`,
            ),
        ),
        db
            .update(bookings)
            .set({ status: 'cancelled' })
            .where(and(eq(bookings.id, bookingId), eq(bookings.status, 'pending'))),
    ]);
    return res.rowsAffected > 0;
}

export async function cancelByToken(
    db: Db,
    token: string,
): Promise<'cancelled' | 'not_cancellable' | 'not_found'> {
    const hash = await sha256Hex(token);
    const [b] = await db
        .select({ id: bookings.id })
        .from(bookings)
        .where(eq(bookings.manageTokenHash, hash))
        .limit(1);
    if (!b) return 'not_found';
    return (await cancelPending(db, b.id)) ? 'cancelled' : 'not_cancellable';
}
