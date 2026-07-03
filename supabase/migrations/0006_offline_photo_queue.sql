-- Offline capture queue: photos are recorded on-device first and uploaded to
-- OneDrive in the background, so a photo row can now exist before its OneDrive
-- file does. onedrive_file_id/filename are patched in (matched by local_uuid)
-- when the upload lands; sync_status tracks 'pending' -> 'uploaded'.
alter table photos alter column onedrive_file_id drop not null;
alter table photos alter column filename drop not null;
alter table photos add column if not exists local_uuid uuid;
alter table photos add column if not exists sync_status text default 'uploaded';

-- local_uuid is the client-generated idempotency key: upload retries patch the
-- same row, and item-save retries upsert photos with "on conflict do nothing".
create unique index if not exists photos_local_uuid_key
  on photos (local_uuid)
  where local_uuid is not null;

-- Same idempotency for action items: a retried offline save of the same item
-- (client keeps the uuid in its queue) must not create a duplicate.
alter table action_items add column if not exists local_uuid uuid;
create unique index if not exists action_items_local_uuid_key
  on action_items (local_uuid);
