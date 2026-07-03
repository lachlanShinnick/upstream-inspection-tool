-- Multiple inspection report labels use the same capture/generation workflow.
-- Existing inspections are treated as council inspections.
alter table inspections
  add column if not exists report_type text not null default 'council';

alter table inspections
  drop constraint if exists inspections_report_type_check;

alter table inspections
  add constraint inspections_report_type_check
  check (report_type in ('council', 'routine', 'outgoing'));
