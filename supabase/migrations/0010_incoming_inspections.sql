-- Incoming inspections have a mandatory property/tenant setup, mandatory
-- electrical details, optional repeating HVAC/fire-service records, and
-- per-photo condition ratings.

alter table inspections
  drop constraint if exists inspections_report_type_check;

alter table inspections
  add constraint inspections_report_type_check
  check (report_type in ('council', 'routine', 'outgoing', 'incident', 'incoming'));

create table if not exists incoming_inspection_details (
  inspection_id uuid primary key references inspections(id) on delete cascade,
  street_address text not null default '',
  suburb text not null default '',
  property_type text not null default '',
  property_area text not null default '',
  tenant_company text not null default '',
  tenant_contact_name text not null default '',
  tenant_contact_number text not null default '',
  lease_term text not null default '',
  commencement text not null default '',
  electrical_nmi text not null default '',
  electrical_msb_location text not null default '',
  electrical_capacity text not null default '',
  electrical_db_count text not null default '',
  hvac_units jsonb not null default '[]'::jsonb,
  fire_services jsonb not null default '[]'::jsonb,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint incoming_hvac_units_array check (jsonb_typeof(hvac_units) = 'array'),
  constraint incoming_fire_services_array check (jsonb_typeof(fire_services) = 'array')
);

alter table action_items
  add column if not exists condition text;

alter table action_items
  drop constraint if exists action_items_condition_check;

alter table action_items
  add constraint action_items_condition_check
  check (condition is null or condition in ('new', 'good', 'fair', 'poor'));
