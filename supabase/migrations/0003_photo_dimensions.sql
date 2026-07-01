-- Per-photo pixel dimensions, captured client-side at resize time, so the
-- report renderer can size each image proportionally without decoding bytes.
alter table photos add column if not exists width int;
alter table photos add column if not exists height int;
