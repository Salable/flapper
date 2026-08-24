-- A board fills the screen it is on.
--
-- It used to be placeable in a percentage rectangle of the screen - four more
-- numbers to type, and a board that could end up disagreeing with the shape it
-- was derived from. Removed with the picker that set it, so nothing is left in
-- the data for something to read.
UPDATE boards
SET config = config - 'layout'
WHERE config ? 'layout';
