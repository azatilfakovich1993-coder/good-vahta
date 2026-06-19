/**
 * Jobs API — Supabase CRUD for vacancies table.
 * Schema: { id: text PK, data: jsonb, companyId: text, archived: bool, paused: bool,
 *            workSchedule: text, categoryCustom: text, contactName: text, contactPhone: text }
 */
import { sb } from './supabase.js';

export async function loadJobs() {
  if (!sb) return [];
  const { data, error } = await sb.from('vacancies').select('*').eq('archived', false).eq('paused', false);
  if (error) { console.warn('[jobs] loadJobs:', error.message); return []; }
  return (data || []).map(row => row.data ? { ...row.data, archived: row.archived, paused: row.paused } : row);
}

/**
 * Loads every vacancy (active, paused or archived) belonging to one company.
 * Used to rebuild "Мои вакансии" from the server, so it survives localStorage
 * being cleared/lost — the local cache was previously the only source of truth.
 */
export async function loadMyJobs(companyId) {
  if (!sb || !companyId) return [];
  const { data, error } = await sb.from('vacancies').select('*').eq('companyId', companyId);
  if (error) { console.warn('[jobs] loadMyJobs:', error.message); return []; }
  return (data || []).map(row => row.data ? { ...row.data, archived: row.archived, paused: row.paused } : row);
}

export async function saveJob(job) {
  if (!sb) return false;
  const row = {
    id:             String(job.id),
    data:           job,
    companyId:      job.companyInfo?.code || '',
    archived:       job.archived  || false,
    paused:         job.paused    || false,
    workSchedule:   job.workSchedule   || '',
    categoryCustom: job.categoryCustom || '',
    contactName:    job.contactName    || '',
    contactPhone:   job.contactPhone   || '',
  };
  const { error } = await sb.from('vacancies').upsert(row, { onConflict: 'id' });
  if (error) { console.warn('[jobs] saveJob:', error.message); return false; }
  return true;
}

export async function deleteJob(id) {
  if (!sb) return false;
  const { error } = await sb.from('vacancies').update({ archived: true }).eq('id', String(id));
  if (error) { console.warn('[jobs] deleteJob:', error.message); return false; }
  return true;
}

export async function pauseJob(id, paused) {
  if (!sb) return false;
  const { error } = await sb.from('vacancies').update({ paused }).eq('id', String(id));
  if (error) { console.warn('[jobs] pauseJob:', error.message); return false; }
  return true;
}

export function subscribeJobs(callback) {
  if (!sb) return null;
  return sb.channel('vacancies-changes')
    .on('postgres_changes', { event: '*', schema: 'public', table: 'vacancies' }, callback)
    .subscribe();
}
