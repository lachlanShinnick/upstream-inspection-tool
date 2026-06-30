alter table users
  add column if not exists position text,
  add column if not exists signature_path text;

insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values ('signatures', 'signatures', true, 1048576, array['image/png'])
on conflict (id) do update
set
  public = excluded.public,
  file_size_limit = excluded.file_size_limit,
  allowed_mime_types = excluded.allowed_mime_types;

drop policy if exists "Signatures are publicly readable" on storage.objects;
create policy "Signatures are publicly readable"
on storage.objects
for select
to public
using (bucket_id = 'signatures');

drop policy if exists "Authenticated users can upload signatures" on storage.objects;
create policy "Authenticated users can upload signatures"
on storage.objects
for insert
to authenticated
with check (bucket_id = 'signatures');

drop policy if exists "Authenticated users can update signatures" on storage.objects;
create policy "Authenticated users can update signatures"
on storage.objects
for update
to authenticated
using (bucket_id = 'signatures')
with check (bucket_id = 'signatures');

drop policy if exists "Authenticated users can delete signatures" on storage.objects;
create policy "Authenticated users can delete signatures"
on storage.objects
for delete
to authenticated
using (bucket_id = 'signatures');
