UPDATE `tables` SET `added_on_phone` = 1 WHERE `id` IN (
  SELECT json_extract(`body_json`, '$.table_id') FROM `log_entries`
  WHERE `kind` = 'table_changed' AND json_extract(`body_json`, '$.what') = 'dodan sa telefona'
);
-- Every table brought out with *+ Sto* before `added_on_phone` existed. The only
-- record of it is the log entry `addFloorTable` writes, so that is what is read
-- and nothing else guesses. Its own migration, not a second statement in 0023:
-- a dev server that reloads on a new file had already run 0023 as a bare ALTER,
-- and drizzle never runs a recorded migration twice.
