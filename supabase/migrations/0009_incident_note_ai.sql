-- AI-polished wording for incident notes, mirroring action_items.ai_comment:
-- populated in the background at capture time so the reviewer page can offer
-- an "AI suggestion" pill without calling OpenAI on page load.
alter table incident_notes add column if not exists ai_text text;
