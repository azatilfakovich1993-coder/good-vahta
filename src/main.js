/**
 * Good_Вахта — main entry point.
 * Initializes platform, loads data, wires up router, mounts screens.
 */
import './styles/main.css';
import './styles/showcase.css';
import './styles/jobcard.css';

import { platformInit, PLATFORM, getPlatformUser, fetchVKUser } from './platform/index.js';
import { initRouter, onScreen, goTo } from './router.js';
import { initAuthScreen } from './screens/auth.js';
import { initJobsScreen, renderJobs, filterJobs } from './screens/jobs.js';
import { renderResumes, loadResumeDb, initWorkerStatusUI, renderRecommendations, renderMyResponses, loadInvitationBadge, loadMyResponseBadge } from './screens/worker.js';
import { renderMyJobs, renderAllEmployerResponses, renderAnalytics, updateVerifyBanner, checkVerificationStatus, updateResponseBadges, initCompanyProfileForm, checkNewReviews, loadSentInvitations } from './screens/employer.js';
import { loadSentInvitationKeys } from './screens/misc.js';
import { toggleTheme } from './screens/misc.js';
import { setTheme, theme, companyProfile, jobs } from './store/index.js';
import { initRealtime, registerRenderer } from './realtime.js';

// ── Import all screen modules (registers window._ globals) ─────────────────
import './screens/jobs.js';
import './screens/worker.js';
import './screens/employer.js';
import './screens/chat.js';
import './screens/reviews.js';
import './screens/misc.js';
import './screens/auth.js';

// ── Boot ───────────────────────────────────────────────────────────────────

async function boot() {
  // Platform
  await platformInit();
  document.body.classList.add(`platform--${PLATFORM}`);

  // VK: fetch user immediately
  if (PLATFORM === 'vk') await fetchVKUser();

  // Apply saved theme
  document.documentElement.classList.toggle('light', theme === 'light');
  const themeIcon = document.getElementById('theme-icon');
  if (themeIcon) themeIcon.textContent = theme === 'dark' ? '🌙' : '☀️';

  // Router
  initRouter();

  // Register per-screen setup callbacks
  onScreen('screen-jobs',               () => filterJobs());
  onScreen('screen-favorites',          () => window._jobs.renderFavorites());
  onScreen('screen-my-resumes',         () => { renderResumes(); initWorkerStatusUI(); });
  onScreen('screen-my-responses',       () => renderMyResponses());
  onScreen('screen-employer-responses', () => renderAllEmployerResponses());
  onScreen('screen-my-jobs',            () => renderMyJobs());
  onScreen('screen-analytics',          () => renderAnalytics());
  onScreen('screen-recommendations',    () => renderRecommendations());

  onScreen('screen-notifications',      () => window._misc.openNotifScreen());
  onScreen('screen-resume-db', async () => {
    await Promise.all([loadResumeDb(), loadSentInvitationKeys()]);
    window._misc.filterResumeDb();
  });
  onScreen('screen-home',   () => loadInvitationBadge());
  onScreen('screen-worker', () => {
    initWorkerStatusUI(); loadInvitationBadge(); loadMyResponseBadge();
    // Sync user name for worker sidebar
    const { getPlatformUser } = window._platform || {};
    const me = typeof getPlatformUser === 'function' ? getPlatformUser() : null;
    const name = me?.firstName || me?.username || '';
    window.__wsb_user = name;
    const el = document.getElementById('wsb-user-name');
    if (el) el.textContent = name || '—';
  });
  onScreen('screen-employer', () => {
    updateVerifyBanner(); updateResponseBadges(); checkNewReviews();
    // Sync company name for sidebar
    const name = companyProfile?.name || '';
    window.__esb_company = name;
    const el = document.getElementById('esb-company-name');
    if (el) el.textContent = name || '—';
  });
  onScreen('screen-company-profile', () => initCompanyProfileForm());
  onScreen('screen-sent-invitations', () => loadSentInvitations());

  // Web: auth check + role-based redirect
  if (PLATFORM === 'web') {
    initAuthScreen();
  }

  // Load jobs and resume DB in background
  initJobsScreen();
  loadResumeDb();

  // Register screen renderers for cross-platform Realtime updates
  registerRenderer('screen-jobs',               filterJobs);
  registerRenderer('screen-my-jobs',            renderMyJobs);
  registerRenderer('screen-my-resumes',         renderResumes);
  registerRenderer('screen-resume-db',          () => window._misc?.filterResumeDb?.());
  registerRenderer('screen-employer-responses', renderAllEmployerResponses);
  registerRenderer('screen-job-responses',      renderAllEmployerResponses);
  registerRenderer('screen-my-responses',       renderMyResponses);
  registerRenderer('screen-recommendations',    renderRecommendations);
  registerRenderer('screen-analytics',          renderAnalytics);
  registerRenderer('screen-employer',           () => { updateVerifyBanner(); updateResponseBadges(); });
  registerRenderer('screen-worker',             initWorkerStatusUI);
  registerRenderer('screen-my-invitations',     () => window._worker?.openInvitations?.());
  registerRenderer('screen-sent-invitations',   loadSentInvitations);

  // Start all Realtime subscriptions (cross-platform live sync)
  initRealtime();

  // Check company verification
  if (companyProfile?.code) {
    checkVerificationStatus();
  }

  // Update response badges
  updateResponseBadges();

  // Load invitation badge (if worker is logged in)
  loadInvitationBadge();

  // Load response status badge (if worker has responses)
  loadMyResponseBadge();

  // Live stats on home screen
  _updateHomeStats();
}


function _updateHomeStats() {
  // Will update when jobs are loaded
  const update = () => {
    const activeJobs = jobs.filter(j => !j.paused && !j.archived).length;
    const jobCountEl = document.getElementById('stat-jobs');
    if (jobCountEl && activeJobs > 0) jobCountEl.textContent = activeJobs.toLocaleString('ru') + '+';
  };
  update();
  setTimeout(update, 3000); // re-check after Supabase loads
}

// ── Global convenience wrapper (for onclick= attributes in HTML) ───────────
window.goTo = goTo;
window.toggleTheme = toggleTheme;

/** Toggle a collapsible filter panel (used in jobs and resume-db screens). */
window.toggleFilterPanel = (panelId, btnId) => {
  const panel = document.getElementById(panelId);
  const btn   = document.getElementById(btnId);
  if (!panel) return;
  const isOpen = panel.classList.toggle('open');
  if (btn) btn.classList.toggle('active', isOpen);
};


// ── Boot ───────────────────────────────────────────────────────────────────
document.addEventListener('DOMContentLoaded', boot);
