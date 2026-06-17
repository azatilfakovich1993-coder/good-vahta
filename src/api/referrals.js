/**
 * Referral program API.
 * Schema: { id: uuid, referrer_id: text, referred_id: text,
 *            ref_code: text, rewarded: bool, created_at: timestamptz }
 */
import { sb } from './supabase.js';

export async function loadMyReferrals(userId) {
  if (!sb || !userId) return [];
  const { data, error } = await sb
    .from('referrals')
    .select('*')
    .eq('referrer_id', String(userId))
    .order('created_at', { ascending: false });
  if (error) { console.warn('[referrals] load:', error.message); return []; }
  return data || [];
}

export async function registerReferral(refCode, referredId) {
  if (!sb || !refCode || !referredId) return false;
  // Look up referrer by code
  const { data: referrer } = await sb
    .from('referrals')
    .select('referrer_id')
    .eq('ref_code', refCode)
    .maybeSingle();
  if (!referrer) return false;
  const { error } = await sb.from('referrals').insert({
    referrer_id: referrer.referrer_id,
    referred_id: String(referredId),
    ref_code:    refCode,
    rewarded:    false,
    created_at:  new Date().toISOString(),
  });
  return !error;
}

export async function ensureReferralCode(userId, existingCode) {
  if (existingCode) return existingCode;
  if (!sb || !userId) return _localRefCode(userId);
  // Check if user already has a referral entry
  const { data } = await sb
    .from('referrals')
    .select('ref_code')
    .eq('referrer_id', String(userId))
    .limit(1)
    .maybeSingle();
  if (data?.ref_code) return data.ref_code;
  // Create new ref code
  const code = _genRefCode(userId);
  await sb.from('referrals').insert({
    referrer_id: String(userId),
    referred_id: null,
    ref_code:    code,
    rewarded:    false,
    created_at:  new Date().toISOString(),
  });
  return code;
}

function _genRefCode(userId) {
  const arr = new Uint8Array(3);
  crypto.getRandomValues(arr);
  return (String(userId).slice(-3) + Array.from(arr, b => b.toString(36)).join('')).toUpperCase().slice(0, 8);
}

function _localRefCode(userId) {
  const key = '_ref_code_' + userId;
  let code = localStorage.getItem(key);
  if (!code) { code = _genRefCode(userId); localStorage.setItem(key, code); }
  return code;
}
