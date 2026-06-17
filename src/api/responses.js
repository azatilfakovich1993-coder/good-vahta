/**
 * Responses API — Supabase CRUD for job_responses table.
 * Fixes the core bug: responses were only in localStorage, so employers
 * couldn't see them from another device/session.
 *
 * Schema: { id: uuid PK, job_id: text, job_title: text, company_id: text,
 *           applicant_id: text, applicant_name: text, specialty: text,
 *           exp: text, salary: int, region: text, telegram: text,
 *           phone: text, gender: text, about: text, status: text,
 *           created_at: timestamptz, resume_data: jsonb }
 */
import { sb } from './supabase.js';
import { showToast } from '../components/toast.js';

/**
 * Load all responses for a specific job (employer view).
 */
export async function loadResponsesForJob(jobId) {
  if (!sb) return [];
  const { data, error } = await sb
    .from('job_responses')
    .select('*')
    .eq('job_id', String(jobId))
    .order('created_at', { ascending: false });
  if (error) { console.warn('[responses] loadForJob:', error.message); return []; }
  return data || [];
}

/**
 * Load all responses made by a specific applicant (worker view).
 */
export async function loadMyResponses(applicantId) {
  if (!sb) return [];
  const { data, error } = await sb
    .from('job_responses')
    .select('*')
    .eq('applicant_id', String(applicantId))
    .order('created_at', { ascending: false });
  if (error) { console.warn('[responses] loadMine:', error.message); return []; }
  return data || [];
}

/**
 * Load all responses for all jobs owned by a company.
 */
export async function loadResponsesForCompany(companyId) {
  if (!sb) return [];
  const { data, error } = await sb
    .from('job_responses')
    .select('*')
    .eq('company_id', String(companyId))
    .order('created_at', { ascending: false });
  if (error) { console.warn('[responses] loadForCompany:', error.message); return []; }
  return data || [];
}

/**
 * Submit a job application.
 * @param {object} job - job object
 * @param {object|null} resume - applicant's resume
 * @param {string} applicantId - platform user ID
 * @param {string} companyId - company code
 * @returns {Promise<{ok: boolean, data: object|null}>}
 */
export async function submitResponse(job, resume, applicantId, companyId) {
  const today = new Date().toISOString();
  const row = {
    job_id:         String(job.id),
    job_title:      job.title,
    company_id:     companyId || job.companyInfo?.code || '',
    applicant_id:   String(applicantId || 'anon'),
    applicant_name: resume?.name || 'Анонимный соискатель',
    specialty:      resume?.specialty || '—',
    exp:            resume?.exp       || '—',
    salary:         Number(resume?.salary) || 0,
    region:         resume?.region    || '—',
    telegram:       resume?.telegram  || '',
    phone:          resume?.phone     || '',
    gender:         resume?.gender    || 'М',
    about:          resume?.about     || '',
    status:         'pending',
    created_at:     today,
    resume_data:    resume ? { ...resume, photo: '' } : null,
  };

  if (!sb) {
    // Offline fallback — store locally only
    return { ok: false, data: { ...row, id: crypto.randomUUID() } };
  }

  const { data, error } = await sb.from('job_responses').insert(row).select().single();
  if (error) {
    console.warn('[responses] submit:', error.message);
    showToast('⚠️ Отклик не сохранён в облаке. Попробуйте позже.');
    return { ok: false, data: { ...row, id: crypto.randomUUID() } };
  }
  return { ok: true, data };
}

/**
 * Update response status (accepted / declined).
 */
export async function updateResponseStatus(responseId, status) {
  if (!sb) return false;
  const { error } = await sb
    .from('job_responses')
    .update({ status })
    .eq('id', responseId);
  if (error) { console.warn('[responses] updateStatus:', error.message); return false; }
  return true;
}

export function subscribeResponses(jobId, callback) {
  if (!sb) return null;
  return sb.channel(`responses-${jobId}`)
    .on('postgres_changes', {
      event: 'INSERT', schema: 'public', table: 'job_responses',
      filter: `job_id=eq.${jobId}`,
    }, callback)
    .subscribe();
}
