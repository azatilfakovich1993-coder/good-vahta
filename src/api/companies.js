/**
 * Company profiles API.
 * Schema: { code: text PK, name, city, phone, about, industry, website,
 *            email, telegram, logo: text (url), verified: bool, owner_id: text,
 *            created_at: timestamptz }
 */
import { sb } from './supabase.js';

export async function loadCompanyByCode(code) {
  if (!sb || !code) return null;
  const { data, error } = await sb.from('companies').select('*').eq('code', code).single();
  if (error) { return null; }
  return data;
}

export async function saveCompany(profile) {
  if (!sb) return false;
  const row = {
    code:      profile.code,
    name:      profile.name      || '',
    city:      profile.city      || '',
    phone:     profile.phone     || '',
    about:     profile.about     || '',
    industry:  profile.industry  || '',
    website:   profile.website   || '',
    email:     profile.email     || '',
    telegram:  profile.telegram  || '',
    logo:      profile.logo      || '',
    verified:  profile.verified  || false,
    owner_id:  profile.ownerId   || '',
  };
  const { error } = await sb.from('companies').upsert(row, { onConflict: 'code' });
  if (error) { console.warn('[companies] save:', error.message); return false; }
  return true;
}

/**
 * Check verification status from Supabase.
 * Returns updated verified flag.
 */
export async function checkVerification(code) {
  if (!sb || !code) return false;
  const { data, error } = await sb.from('companies').select('verified').eq('code', code).single();
  if (error || !data) return false;
  return !!data.verified;
}

/**
 * Generates a cryptographically random company code (6 chars, uppercase).
 * Bug fix: was using Math.random() which can collide.
 */
export function genCompanyCode() {
  const arr = new Uint8Array(4);
  crypto.getRandomValues(arr);
  return Array.from(arr, b => b.toString(36).padStart(2, '0')).join('').slice(0, 6).toUpperCase();
}
