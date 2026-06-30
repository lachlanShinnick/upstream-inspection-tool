-- Inspection creation flow no longer uses a pre-registered properties table.
-- Property identity is denormalized straight onto each inspection from the
-- SharePoint folder the inspector picks.

-- 1. Reshape inspections.
alter table inspections
  drop column if exists property_id,
  add column if not exists property_name text,
  add column if not exists onedrive_drive_id text,
  add column if not exists onedrive_property_folder_id text;

-- 2. Drop the now-unused properties table (cascade clears any leftover FKs).
drop table if exists properties cascade;
