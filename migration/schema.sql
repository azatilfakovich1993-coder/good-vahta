-- Good_Вахта — полная схема БД
-- Выполни в Supabase → SQL Editor

-- ── Vacancies ─────────────────────────────────────────────────────────────────
create table if not exists vacancies (
  id             text primary key,
  data           jsonb,
  "companyId"    text default '',
  archived       boolean default false,
  paused         boolean default false,
  "workSchedule" text default '',
  "categoryCustom" text default '',
  "contactName"  text default '',
  "contactPhone" text default ''
);
alter table vacancies disable row level security;

-- ── Companies ─────────────────────────────────────────────────────────────────
create table if not exists companies (
  code       text primary key,
  name       text default '',
  city       text default '',
  phone      text default '',
  about      text default '',
  industry   text default '',
  website    text default '',
  email      text default '',
  telegram   text default '',
  logo       text default '',
  verified   boolean default false,
  owner_id   text default '',
  created_at timestamptz default now()
);
alter table companies disable row level security;

-- ── Job responses ─────────────────────────────────────────────────────────────
create table if not exists job_responses (
  id             uuid primary key default gen_random_uuid(),
  job_id         text default '',
  job_title      text default '',
  company_id     text default '',
  applicant_id   text default '',
  applicant_name text default '',
  specialty      text default '',
  exp            text default '',
  salary         integer default 0,
  region         text default '',
  telegram       text default '',
  phone          text default '',
  gender         text default '',
  about          text default '',
  status         text default 'pending',
  resume_data    jsonb,
  created_at     timestamptz default now()
);
alter table job_responses disable row level security;

-- ── Resumes ───────────────────────────────────────────────────────────────────
create table if not exists resumes (
  id        text primary key,
  published boolean default true,
  name      text default '',
  specialty text default '',
  region    text default '',
  salary    integer default 0,
  telegram  text default '',
  phone     text default '',
  exp       text default '',
  category  text default '',
  about     text default '',
  data      jsonb
);
alter table resumes disable row level security;

-- ── Reviews ───────────────────────────────────────────────────────────────────
create table if not exists reviews (
  id           uuid primary key default gen_random_uuid(),
  company_name text default '',
  author_name  text default '',
  author_id    text default '',
  rating       integer default 5,
  text         text default '',
  created_at   timestamptz default now()
);
alter table reviews disable row level security;

-- ── Invitations ───────────────────────────────────────────────────────────────
create table if not exists invitations (
  id                 uuid primary key default gen_random_uuid(),
  created_at         timestamptz default now(),
  employer_name      text default '',
  company_name       text default '',
  employer_phone     text default '',
  employer_telegram  text default '',
  job_title          text default '',
  job_id             text default '',
  message            text default '',
  candidate_name     text default '',
  candidate_telegram text default '',
  candidate_phone    text default '',
  worker_key         text default '',
  status             text default 'pending'
);
alter table invitations disable row level security;

-- ── Messages (chat) ───────────────────────────────────────────────────────────
create table if not exists messages (
  id          uuid primary key default gen_random_uuid(),
  chat_id     text default '',
  sender_id   text default '',
  sender_name text default '',
  text        text default '',
  created_at  timestamptz default now()
);
alter table messages disable row level security;

-- ── Referrals ─────────────────────────────────────────────────────────────────
create table if not exists referrals (
  id          uuid primary key default gen_random_uuid(),
  referrer_id text default '',
  referred_id text,
  ref_code    text default '',
  rewarded    boolean default false,
  created_at  timestamptz default now()
);
alter table referrals disable row level security;

-- ── Realtime ──────────────────────────────────────────────────────────────────
alter publication supabase_realtime add table vacancies;
alter publication supabase_realtime add table job_responses;
alter publication supabase_realtime add table resumes;
alter publication supabase_realtime add table invitations;
alter publication supabase_realtime add table messages;
