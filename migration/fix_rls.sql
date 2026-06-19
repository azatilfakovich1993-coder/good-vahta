-- Fix: RLS was still enabled despite schema.sql intent — disable on all tables
alter table vacancies disable row level security;
alter table companies disable row level security;
alter table job_responses disable row level security;
alter table resumes disable row level security;
alter table reviews disable row level security;
alter table invitations disable row level security;
alter table messages disable row level security;
alter table referrals disable row level security;
