-- Incoming inspections collect free-text "Other Comments" that the inspector
-- adds one at a time in the field. Stored as a JSON array alongside the other
-- repeating incoming records (hvac_units, fire_services) rather than in their
-- own table, since they're always read and written with the rest of the row.

alter table incoming_inspection_details
  add column if not exists other_comments jsonb not null default '[]'::jsonb;

alter table incoming_inspection_details
  drop constraint if exists incoming_other_comments_array;

alter table incoming_inspection_details
  add constraint incoming_other_comments_array
  check (jsonb_typeof(other_comments) = 'array');
