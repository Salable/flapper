-- How the physical board moves lives on the design now, not the board.
--
-- Hold, Scroll speed, Landing, Sweep, Sweep shape and Always flip described
-- how a flip looks and how long a message sits, not what a particular board
-- is showing - so they belong to the design's pack, alongside its colours.
-- Two of the six were already shared machinery: the fidget system's own
-- sweep action borrowed Sweep, Sweep shape and Always flip rather than
-- keeping copies. As with the grid and the layout before them, a stored
-- value is removed rather than ignored, because while it exists in the
-- data something will read it.
UPDATE boards
SET config = config
  - 'dwellMs' - 'fastStepMs' - 'landStepMs' - 'sweepMs' - 'staggerMode' - 'alwaysFlip'
WHERE config ?| array['dwellMs', 'fastStepMs', 'landStepMs', 'sweepMs', 'staggerMode', 'alwaysFlip'];
