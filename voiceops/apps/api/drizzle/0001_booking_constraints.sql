-- Hand-written: guarantees no two live bookings overlap on the same resource.
-- Covers holds, pending and confirmed rows. Cancelled, expired, completed and no-show rows don't block.
-- The range uses blocked_until (end + service buffer), so cleaning time is protected too.
CREATE EXTENSION IF NOT EXISTS btree_gist;
--> statement-breakpoint
ALTER TABLE "appointments" ADD CONSTRAINT "appointments_no_overlap"
  EXCLUDE USING gist (
    "resource_id" WITH =,
    tstzrange("starts_at", "blocked_until", '[)') WITH &&
  ) WHERE ("status" IN ('held', 'pending', 'confirmed'));
--> statement-breakpoint
-- Fuzzy matching for FAQ answers and knowledge-gap grouping.
CREATE EXTENSION IF NOT EXISTS pg_trgm;
