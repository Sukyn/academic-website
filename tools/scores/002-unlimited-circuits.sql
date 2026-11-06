-- Circuits are validated by the API, then discarded.
ALTER TABLE scores DROP COLUMN IF EXISTS sequence;
ALTER TABLE scores DROP CONSTRAINT IF EXISTS scores_moves_check;
ALTER TABLE scores ADD CONSTRAINT scores_moves_check CHECK (moves > 0);
