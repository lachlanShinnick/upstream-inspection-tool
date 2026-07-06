-- Incident reports: a fourth report type whose first page is a free-flowing
-- narrative log rather than action items. Photos still use action_items under
-- the hood (each entry = area + description + photos), so only the notes need
-- new storage.

-- 1. Allow the new report type.
alter table inspections
  drop constraint if exists inspections_report_type_check;

alter table inspections
  add constraint inspections_report_type_check
  check (report_type in ('council', 'routine', 'outgoing', 'incident'));

-- 2. Narrative notes, in the order they were written. `local_uuid` makes the
--    offline queue's retries idempotent, mirroring action_items.
--    `original_text` preserves the inspector's as-typed wording once a
--    reviewer edits `text` (same pattern as action_items.original_comment).
create table if not exists incident_notes (
  id uuid primary key default gen_random_uuid(),
  inspection_id uuid not null references inspections(id) on delete cascade,
  local_uuid text unique,
  text text not null,
  original_text text,
  sort_order integer not null default 0,
  created_at timestamptz not null default now()
);
create index if not exists incident_notes_inspection_id_idx
  on incident_notes(inspection_id);
