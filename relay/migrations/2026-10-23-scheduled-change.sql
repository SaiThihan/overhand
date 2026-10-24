-- The cancel or pause a customer scheduled for the period's end, so the billing page stops saying "renewing".
-- ALTER TABLE isn't idempotent, so this runs once per database; schema.sql already has the columns for a new one.
--   cd relay && bunx wrangler@4.151.1 d1 execute overhand-relay-staging --remote --env staging --file migrations/2026-10-23-scheduled-change.sql
--   cd relay && bunx wrangler@4.151.1 d1 execute overhand-relay --remote --file migrations/2026-10-23-scheduled-change.sql
ALTER TABLE entitlements ADD COLUMN scheduled_change TEXT;
ALTER TABLE entitlements ADD COLUMN scheduled_at TEXT;
