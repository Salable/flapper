-- A grid is not something a board has.
--
-- A board records the screen it is designed for and how big its cards should
-- be; how many cards fit is worked out from those two, wherever it is needed.
-- Boards made before that carry a cols/rows pair written by a template, which
-- outlives the template, drifts away from the screen it was meant for, and
-- leaves two boards different shapes for a reason nobody can account for.
--
-- So the stored ones are removed rather than ignored: while they exist in the
-- data, something will read them.
UPDATE boards
SET config = config - 'cols' - 'rows'
WHERE config ? 'cols' OR config ? 'rows';
