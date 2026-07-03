-- AI-polished wording, generated automatically at capture time (see
-- createReportedItem) and stored so the reviewer page can show it instantly
-- instead of calling OpenAI on every page load. Null until the background
-- polish call finishes (or if it failed/was skipped, e.g. no API key).
alter table action_items add column if not exists ai_comment text;
