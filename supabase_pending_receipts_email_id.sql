-- Step 1: Add email_id column to pending_receipts for deduplication
ALTER TABLE pending_receipts ADD COLUMN IF NOT EXISTS email_id TEXT;

-- Step 2: Create unique constraint on email_id (allowing NULLs)
ALTER TABLE pending_receipts ADD CONSTRAINT pending_receipts_email_id_unique UNIQUE (email_id);

-- Step 3: Index for fast lookups
CREATE INDEX IF NOT EXISTS idx_pending_receipts_email_id ON pending_receipts(email_id) WHERE email_id IS NOT NULL;
