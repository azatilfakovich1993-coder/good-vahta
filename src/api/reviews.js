/**
 * Reviews API — Supabase CRUD.
 * Bug fix: reviews were previously stored in localStorage only; now persisted in Supabase.
 * Schema: { id: uuid PK, company_name: text, author_name: text, author_id: text,
 *            rating: int (1-5), text: text, created_at: timestamptz }
 */
import { sb } from './supabase.js';

export async function loadReviews(companyName) {
  if (!sb) return _localReviews(companyName);
  const { data, error } = await sb
    .from('reviews')
    .select('*')
    .eq('company_name', companyName)
    .order('created_at', { ascending: false });
  if (error) { console.warn('[reviews] load:', error.message); return _localReviews(companyName); }
  return data || [];
}

/**
 * Load avg ratings for a list of company names.
 * Returns { companyName: { avg, count } }
 */
export async function loadRatingsForCompanies(names) {
  const result = {};
  if (!sb || !names.length) return result;
  const { data, error } = await sb
    .from('reviews')
    .select('company_name, rating')
    .in('company_name', names);
  if (error) { console.warn('[reviews] loadRatings:', error.message); return result; }
  const groups = {};
  (data || []).forEach(r => {
    if (!groups[r.company_name]) groups[r.company_name] = [];
    groups[r.company_name].push(r.rating);
  });
  Object.entries(groups).forEach(([name, ratings]) => {
    const avg = ratings.reduce((s, v) => s + v, 0) / ratings.length;
    result[name] = { avg: Math.round(avg * 10) / 10, count: ratings.length };
  });
  return result;
}

export async function submitReview(companyName, authorName, authorId, rating, text) {
  const row = {
    company_name: companyName,
    author_name:  authorName,
    author_id:    String(authorId || 'anon'),
    rating:       Math.min(5, Math.max(1, rating)),
    text:         text.trim(),
    created_at:   new Date().toISOString(),
  };
  if (!sb) {
    _saveLocalReview(companyName, row);
    return { ok: false, data: { ...row, id: crypto.randomUUID() } };
  }
  const { data, error } = await sb.from('reviews').insert(row).select().single();
  if (error) { console.warn('[reviews] submit:', error.message); return { ok: false, data: null }; }
  return { ok: true, data };
}

function _key(name) { return '_reviews_' + name; }
function _localReviews(name) {
  try { return JSON.parse(localStorage.getItem(_key(name)) || '[]'); } catch { return []; }
}
function _saveLocalReview(name, row) {
  const arr = _localReviews(name);
  arr.unshift({ ...row, id: crypto.randomUUID() });
  try { localStorage.setItem(_key(name), JSON.stringify(arr)); } catch {}
}
