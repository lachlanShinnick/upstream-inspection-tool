-- Reviewer magic-link support: preserve the inspector's original wording
-- once a reviewer edits `comment`, and add a token-based access mechanism
-- for the unauthenticated /review/[token] page.

-- 1. Preserve original wording. Backfilled from the current `comment` value,
--    since the true as-typed text was never stored separately before this.
alter table action_items add column if not exists original_comment text;
update action_items set original_comment = comment where original_comment is null;

-- 2. Reviewer magic-link tokens. A separate table (not columns on
--    `inspections`) so a token has its own lifecycle independent of the
--    inspection row itself.
create table if not exists review_tokens (
  id uuid primary key default gen_random_uuid(),
  inspection_id uuid not null references inspections(id) on delete cascade,
  token text not null unique,
  expires_at timestamptz not null,
  created_at timestamptz not null default now(),
  last_accessed_at timestamptz
);
create index if not exists review_tokens_inspection_id_idx on review_tokens(inspection_id);
