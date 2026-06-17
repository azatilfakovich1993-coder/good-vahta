/**
 * Invitations API.
 * Schema: { id, created_at, employer_name, company_name, employer_phone,
 *           employer_telegram, job_title, job_id, message,
 *           candidate_name, candidate_telegram, candidate_phone,
 *           worker_key, status('pending'|'viewed'|'accepted'|'declined') }
 */
import { sb } from './supabase.js';

export async function saveInvitation(inv) {
  if (!sb) return null;
  const { data, error } = await sb
    .from('invitations')
    .insert([inv])
    .select()
    .single();
  if (error) { console.warn('[invitations] save:', error.message); return null; }
  return data;
}

export async function loadInvitationsForWorker(telegram, phone) {
  if (!sb || (!telegram && !phone)) return [];
  const conditions = [];
  if (telegram) conditions.push(`candidate_telegram.eq.${telegram}`);
  if (phone)    conditions.push(`candidate_phone.eq.${phone}`);
  const { data, error } = await sb
    .from('invitations')
    .select('*')
    .or(conditions.join(','))
    .order('created_at', { ascending: false });
  if (error) { console.warn('[invitations] load:', error.message); return []; }
  return data || [];
}

export async function loadInvitationsForEmployer(companyName) {
  if (!sb || !companyName) return [];
  const { data, error } = await sb
    .from('invitations')
    .select('*')
    .eq('company_name', companyName)
    .order('created_at', { ascending: false });
  if (error) { console.warn('[invitations] loadForEmployer:', error.message); return []; }
  return data || [];
}

export async function updateInvitationStatus(id, status) {
  if (!sb) return;
  const { error } = await sb
    .from('invitations')
    .update({ status })
    .eq('id', id);
  if (error) console.warn('[invitations] updateStatus:', error.message);
}

export async function markInvitationViewed(id) {
  return updateInvitationStatus(id, 'viewed');
}
