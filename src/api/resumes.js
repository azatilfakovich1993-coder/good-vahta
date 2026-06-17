/**
 * Resumes API — Supabase CRUD for resumes table.
 * Schema: { id: text PK, published: bool, name, specialty, region, salary, telegram,
 *            phone, exp, category, about, data: jsonb }
 */
import { sb } from './supabase.js';

export async function loadPublicResumes() {
  if (!sb) return [];
  const { data, error } = await sb.from('resumes').select('*').eq('published', true);
  if (error) { console.warn('[resumes] load:', error.message); return []; }
  return (data || []).map(row =>
    row.data && typeof row.data === 'object' ? { ...row.data, id: row.id } : row
  );
}

export async function saveResume(resume, id) {
  if (!sb) return false;
  // Strip base64 photo before saving to DB to avoid size limits
  const row = {
    id,
    published:  resume.published !== false,
    name:       resume.name       || '',
    specialty:  resume.specialty  || '',
    region:     resume.region     || '',
    salary:     Number(resume.salary) || 0,
    telegram:   resume.telegram   || '',
    phone:      resume.phone      || '',
    exp:        resume.exp        || '',
    category:   resume.category   || '',
    about:      resume.about      || '',
    data:       { ...resume, photo: '' },  // don't store photo in DB
  };
  const { error } = await sb.from('resumes').upsert(row, { onConflict: 'id' });
  if (error) { console.warn('[resumes] save:', error.message); return false; }
  return true;
}

export async function deleteResume(id) {
  if (!sb) return false;
  const { error } = await sb.from('resumes').delete().eq('id', String(id));
  if (error) { console.warn('[resumes] delete:', error.message); return false; }
  return true;
}

export function subscribeResumes(callback) {
  if (!sb) return null;
  return sb.channel('resumes-changes')
    .on('postgres_changes', { event: '*', schema: 'public', table: 'resumes' }, callback)
    .subscribe();
}
