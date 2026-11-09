import { z } from 'zod';

const slot = z.string().regex(/^\d{4}-\d{2}-\d{2}T\d{2}:00$/, 'expected YYYY-MM-DDTHH:00');
const date = z.string().regex(/^\d{4}-\d{2}-\d{2}$/, 'expected YYYY-MM-DD');

export const createBookingSchema = z.object({
    startAt: slot,
    endAt: slot,
    attendees: z.number().int().min(1),
    guestName: z.string().trim().min(1).max(100),
    guestEmail: z.string().trim().email().max(200),
    guestPhone: z.string().trim().min(8).max(20),
    notes: z.string().trim().max(500).optional(),
});
export type CreateBookingInput = z.infer<typeof createBookingSchema>;

export const availabilityQuery = z.object({ from: date, to: date });
