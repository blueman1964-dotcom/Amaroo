-- Clean existing duplicate rows in first_aid_inventory and enforce uniqueness going forward.
-- Safe to run multiple times.

-- Step 1: Remove duplicate rows, keeping the most recently updated row per logical item.
WITH ranked AS (
  SELECT
    id,
    ROW_NUMBER() OVER (
      PARTITION BY
        COALESCE(vessel_id, ''),
        COALESCE(tier, 0),
        LOWER(TRIM(COALESCE(category, ''))),
        LOWER(TRIM(COALESCE(item_name, '')))
      ORDER BY
        updated_at DESC NULLS LAST,
        created_at DESC NULLS LAST,
        id DESC
    ) AS rn
  FROM first_aid_inventory
)
DELETE FROM first_aid_inventory fai
USING ranked r
WHERE fai.id = r.id
  AND r.rn > 1;

-- Step 2: Add a unique expression index so duplicates cannot be inserted again.
CREATE UNIQUE INDEX IF NOT EXISTS idx_first_aid_inventory_unique_item
ON first_aid_inventory (
  COALESCE(vessel_id, ''),
  COALESCE(tier, 0),
  LOWER(TRIM(COALESCE(category, ''))),
  LOWER(TRIM(COALESCE(item_name, '')))
);

-- Optional check: list any remaining logical duplicates (should return zero rows).
SELECT
  COALESCE(vessel_id, '') AS vessel_id,
  COALESCE(tier, 0) AS tier,
  LOWER(TRIM(COALESCE(category, ''))) AS category_key,
  LOWER(TRIM(COALESCE(item_name, ''))) AS item_key,
  COUNT(*) AS row_count
FROM first_aid_inventory
GROUP BY 1, 2, 3, 4
HAVING COUNT(*) > 1;
