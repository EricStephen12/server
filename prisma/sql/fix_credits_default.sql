-- New users should not get free bonus scans by default.
-- Admin top-ups still set credits_remaining explicitly.
ALTER TABLE users ALTER COLUMN credits_remaining SET DEFAULT 0;
