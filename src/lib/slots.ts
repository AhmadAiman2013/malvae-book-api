const HOUR_MS = 3_600_000;

export interface BookingRules {
    openHour: number;
    closeHour: number;
    maxSlots: number;
    leadMinutes: number;
}

export type RangeError = 'invalid_range' | 'too_many_slots' | 'multi_day' | 'outside_hours' | 'too_soon';

// Slots are MYT wall-clock strings ('YYYY-MM-DDTHH:00'). Malaysia has no DST, so
// plain string/UTC-field arithmetic is safe; no timezone conversion is needed
// until we compare against the real clock.
const wallMs = (s: string) => Date.parse(`${s}:00Z`);

export function eachSlot(startAt: string, endAt: string): string[] {
    const out: string[] = [];
    for (let t = wallMs(startAt); t < wallMs(endAt); t += HOUR_MS) {
        out.push(new Date(t).toISOString().slice(0, 13) + ':00');
    }
    return out; // NaN or end <= start yields []
}

export const slotInstantMs = (slot: string) => Date.parse(`${slot}:00+08:00`);

export function validateRange(
    rules: BookingRules,
    startAt: string,
    endAt: string,
    nowMs: number = Date.now(),
): { ok: true; slots: string[] } | { ok: false; error: RangeError } {
    const slots = eachSlot(startAt, endAt);
    if (slots.length === 0) return { ok: false, error: 'invalid_range' };
    if (slots.length > rules.maxSlots) return { ok: false, error: 'too_many_slots' };

    const day = slots[0].slice(0, 10);
    if (slots.some((s) => s.slice(0, 10) !== day)) return { ok: false, error: 'multi_day' };

    const hour = (s: string) => Number(s.slice(11, 13));
    if (slots.some((s) => hour(s) < rules.openHour || hour(s) >= rules.closeHour)) {
        return { ok: false, error: 'outside_hours' };
    }
    if (slotInstantMs(slots[0]) < nowMs + rules.leadMinutes * 60_000) {
        return { ok: false, error: 'too_soon' };
    }
    return { ok: true, slots };
}
