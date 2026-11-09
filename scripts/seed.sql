-- Run once after migrating:  turso db shell homestay < scripts/seed.sql
-- hourly_rate_sen is in sen (10000 = RM100/hour). PLACEHOLDER: set your real rate.
INSERT INTO settings (id, open_hour, close_hour, hourly_rate_sen, max_slots, max_attendees, lead_minutes)
VALUES (1, 9, 22, 10000, 6, 50, 60);

-- Promote yourself after signing up once through the app (replace the email):
-- UPDATE user SET role = 'admin' WHERE email = 'you@example.com';
