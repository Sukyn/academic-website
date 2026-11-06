ALTER TABLE scores DROP CONSTRAINT IF EXISTS scores_level_check;
ALTER TABLE scores ADD CONSTRAINT scores_level_check CHECK (level >= 1);
