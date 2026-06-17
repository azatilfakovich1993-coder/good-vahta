/**
 * Centralised Supabase Realtime manager.
 *
 * Each subscription does three things on every change:
 *   1. Refresh the in-memory store (source of truth)
 *   2. Re-render every currently-visible screen that shows this data
 *   3. Update global UI elements (badges, counters) regardless of active screen
 *
 * Tables covered:
 *   vacancies      → jobs / my-jobs / recommendations / home stats / analytics
 *   resumes        → resume-db / my-resumes
 *   job_responses  → employer-responses / job-responses / my-responses / response badge
 *   companies      → company-profile / employer cabinet / verify banner
 *   invitations    → my-invitations / invitation badge everywhere
 */

import { sb } from './api/supabase.js';
import { loadJobs } from './api/jobs.js';
import { loadPublicResumes } from './api/resumes.js';
import { loadResponsesForCompany, loadMyResponses } from './api/responses.js';
import { loadInvitationsForWorker } from './api/invitations.js';
import {
  jobs, myJobs, resumeDbData, jobResponsesCache, myResponsesCache,
  companyProfile, resumes, saveJobResponsesCache, saveMyResponsesCache,
  setCompanyProfile,
} from './store/index.js';
import { loadCompanyByCode } from './api/companies.js';
import { currentScreen } from './router.js';
import { getPlatformUser } from './platform/index.js';
import { showToast } from './components/toast.js';
import { esc } from './utils.js';

// ── Active subscriptions ───────────────────────────────────────────────────
let _channels = [];

// ── Debounce ───────────────────────────────────────────────────────────────
function debounce(fn, ms) {
  let t;
  return (...args) => { clearTimeout(t); t = setTimeout(() => fn(...args), ms); };
}

// ── Screen renderer registry ───────────────────────────────────────────────
const _renderers = {};

export function registerRenderer(screenId, fn) {
  _renderers[screenId] = fn;
}

/** Re-render a screen only if it is currently visible. */
function refreshIfActive(screenId) {
  if (currentScreen() === screenId && _renderers[screenId]) {
    try { _renderers[screenId](); } catch (e) { console.warn('[realtime] render error', screenId, e); }
  }
}

/** Re-render a list of screens — whichever is currently active. */
function refreshAny(...screenIds) {
  screenIds.forEach(id => refreshIfActive(id));
}

// ── Global UI updaters (run regardless of active screen) ──────────────────

/** Update response badge on employer cabinet menu item. */
function _updateResponseBadge() {
  let total = 0;
  Object.entries(jobResponsesCache).forEach(([key, arr]) => {
    if (key === '__all' || !Array.isArray(arr)) return;
    arr.forEach(r => { if (!r.status || r.status === 'pending') total++; });
  });
  const badge = document.getElementById('resp-badge');
  if (badge) {
    badge.className = `mi-resp-badge ${total ? 'visible' : ''}`;
    badge.textContent = total || '';
  }
  // Sidebar badge
  document.querySelectorAll('.esb-resp-badge').forEach(el => {
    el.textContent = total > 0 ? String(total) : '';
    el.style.display = total > 0 ? 'flex' : 'none';
  });
}

/** Immediate: toast to employer when a new response arrives. */
function _handleResponseInsert(payload) {
  const r = payload?.new;
  if (!r) return;
  if (!companyProfile?.code) return;
  // Only notify if this response belongs to our company
  const allResps = Object.values(jobResponsesCache).flat().filter(x => x?.id);
  const alreadyKnown = allResps.some(x => String(x.id) === String(r.id));
  if (!alreadyKnown) {
    showToast(`📩 Новый отклик: ${esc(r.applicant_name || r.name || 'Соискатель')}`);
  }
}

/** Update home screen job count stat. */
function _updateHomeStats() {
  const activeJobs = jobs.filter(j => !j.paused && !j.archived).length;
  const el = document.getElementById('stat-jobs');
  if (el && activeJobs > 0) el.textContent = activeJobs.toLocaleString('ru') + '+';
}

/** Update invitation badge on all .inv-badge-el elements. */
async function _updateInvitationBadge() {
  const myResume = resumes[0];
  const telegram = myResume?.telegram || '';
  const phone    = myResume?.phone    || '';
  if (!telegram && !phone) return;

  const invitations = await loadInvitationsForWorker(telegram, phone);
  const pending = invitations.filter(i => i.status === 'pending').length;

  document.querySelectorAll('.inv-badge-el').forEach(el => {
    const isHomeCard = el.classList.contains('hcc-inv-badge');
    el.textContent = isHomeCard
      ? `${pending} новых приглашени${pending === 1 ? 'е' : 'я'}`
      : String(pending);
    el.style.display = pending > 0 ? 'flex' : 'none';
  });
}

// ── Vacancies handler ──────────────────────────────────────────────────────
const _handleVacancyChange = debounce(async () => {
  // 1. Refresh store
  const updated = await loadJobs();
  jobs.length = 0;
  updated.forEach(j => jobs.push(j));
  myJobs.forEach(j => {
    if (!jobs.find(x => String(x.id) === String(j.id)) && !j.archived) jobs.unshift(j);
  });

  // 2. Re-render active screen
  refreshAny('screen-jobs', 'screen-my-jobs', 'screen-recommendations', 'screen-analytics');

  // 3. Global UI
  _updateHomeStats();
}, 400);

// ── Resumes handler ────────────────────────────────────────────────────────
const _handleResumeChange = debounce(async () => {
  // 1. Refresh store
  const updated = await loadPublicResumes();
  resumeDbData.length = 0;
  updated.forEach(r => resumeDbData.push(r));

  // 2. Re-render active screen
  refreshAny('screen-resume-db', 'screen-my-resumes');
}, 400);

// ── Responses handler ──────────────────────────────────────────────────────
const _handleResponseChange = debounce(async () => {
  const me = getPlatformUser();

  // 1a. Refresh employer response cache
  const code = companyProfile?.code;
  if (code) {
    const fresh = await loadResponsesForCompany(code);
    jobResponsesCache.__all = fresh;
    fresh.forEach(r => {
      if (!jobResponsesCache[r.job_id]) jobResponsesCache[r.job_id] = [];
      const idx = jobResponsesCache[r.job_id].findIndex(x => x.id === r.id);
      if (idx === -1) jobResponsesCache[r.job_id].push(r);
      else jobResponsesCache[r.job_id][idx] = r;
    });
    saveJobResponsesCache();
  }

  // 1b. Refresh worker response cache
  if (me?.id) {
    const fresh = await loadMyResponses(String(me.id));
    myResponsesCache.length = 0;
    fresh.forEach(r => myResponsesCache.push(r));
    saveMyResponsesCache();
  }

  // 2. Re-render active screen
  refreshAny(
    'screen-employer-responses',
    'screen-job-responses',
    'screen-my-responses',
    'screen-analytics',
  );

  // 3. Global UI — badges always update (employer + worker)
  _updateResponseBadge();
  window._worker?.loadMyResponseBadge?.();
}, 500);

// ── Companies handler ──────────────────────────────────────────────────────
const _handleCompanyChange = debounce(async (payload) => {
  if (!companyProfile?.code) return;
  const rec = payload?.new;
  if (!rec || rec.code !== companyProfile.code) return;

  // 1. Refresh store
  const fresh = await loadCompanyByCode(companyProfile.code);
  if (fresh) setCompanyProfile({ ...companyProfile, ...fresh });

  // 2. Re-render active screen
  refreshAny('screen-employer', 'screen-company-profile', 'screen-my-jobs');

  // 3. Global UI — verify banner always updates
  try { window._employer?.updateVerifyBanner?.(); } catch {}
}, 600);

// ── Invitations handler ────────────────────────────────────────────────────

/** Immediate: toast to worker when employer sends a new invitation. */
function _handleInvitationInsert(payload) {
  const inv = payload?.new;
  if (!inv) return;
  const myResume = resumes[0];
  const myTg    = myResume?.telegram || '';
  const myPhone = myResume?.phone    || '';
  const isForMe = (myTg    && String(inv.candidate_telegram) === String(myTg)) ||
                  (myPhone && String(inv.candidate_phone)    === String(myPhone));
  if (isForMe) {
    showToast(`📨 Новое приглашение: ${esc(inv.job_title || inv.employer_name || 'Работодатель')}!`);
  }
}

const _handleInvitationChange = debounce(async () => {
  // Worker side: badge + screen
  await _updateInvitationBadge();
  refreshAny('screen-my-invitations');

  // Employer side: badge + screen (when worker replies)
  try { window._employer?.updateEmpInvBadge?.(); } catch {}
  refreshAny('screen-sent-invitations');
}, 400);

// ── Bootstrap ──────────────────────────────────────────────────────────────

export function initRealtime() {
  if (!sb) {
    console.warn('[realtime] Supabase unavailable — Realtime disabled');
    return;
  }

  _channels.forEach(ch => { try { sb.removeChannel(ch); } catch {} });
  _channels = [];

  const subscribe = (name, table, event, handler) => {
    const ch = sb.channel(`rt-${name}`)
      .on('postgres_changes', { event, schema: 'public', table }, handler)
      .subscribe(status => {
        if (status === 'SUBSCRIBED') console.info(`[realtime] ${name} ✓`);
      });
    _channels.push(ch);
  };

  subscribe('vacancies',          'vacancies',     '*',      _handleVacancyChange);
  subscribe('resumes',            'resumes',       '*',      _handleResumeChange);
  subscribe('job_responses',      'job_responses', '*',      _handleResponseChange);
  subscribe('job_resp_insert',    'job_responses', 'INSERT', _handleResponseInsert);
  subscribe('companies',          'companies',     '*',      _handleCompanyChange);
  subscribe('invitations',        'invitations',   '*',      _handleInvitationChange);
  subscribe('invitations_insert', 'invitations',   'INSERT', _handleInvitationInsert);

  console.info('[realtime] all subscriptions started');
}

export function destroyRealtime() {
  if (!sb) return;
  _channels.forEach(ch => { try { sb.removeChannel(ch); } catch {} });
  _channels = [];
}
