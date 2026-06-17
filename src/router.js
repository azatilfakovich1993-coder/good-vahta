/**
 * Client-side router.
 * Manages screen transitions, browser history (back button), and
 * per-screen setup callbacks.
 */
import { onBackButton, hideBackButton, PLATFORM, haptic, getPlatformUser } from './platform/index.js';

/** Map of screen id → setup function (called each time screen opens) */
const _setup = {};

let _current = null;
let _history = [];

/** Screens that get the desktop B2B layout */
const EMPLOYER_SCREENS = new Set([
  'screen-employer', 'screen-my-jobs', 'screen-employer-responses',
  'screen-job-responses', 'screen-resume-db', 'screen-sent-invitations',
  'screen-analytics', 'screen-company-profile', 'screen-create-job',
  'screen-candidate-detail',
]);
const WORKER_SCREENS = new Set([
  'screen-worker', 'screen-jobs', 'screen-job-detail',
  'screen-my-resumes', 'screen-create-resume', 'screen-my-responses',
  'screen-favorites', 'screen-my-invitations', 'screen-recommendations',
  'screen-profile', 'screen-notifications',
]);

function _isDesktopWeb() {
  return false;
}

function _updateDesktopLayout(screenId) {
  const desktop    = _isDesktopWeb();
  const isEmployer = EMPLOYER_SCREENS.has(screenId);
  const isWorker   = WORKER_SCREENS.has(screenId);

  document.body.classList.toggle('employer-desktop', isEmployer && desktop);
  document.body.classList.toggle('worker-desktop',   isWorker   && desktop);

  // Active state on sidebar nav items
  // Для главных экранов кабинетов подсвечиваем дефолтный пункт
  const sidebarActive = screenId === 'screen-employer' ? 'screen-resume-db'
                      : screenId === 'screen-worker'   ? 'screen-jobs'
                      : screenId;
  document.querySelectorAll('#employer-sidebar .sb-item[data-screen], #worker-sidebar .sb-item[data-screen]').forEach(el => {
    el.classList.toggle('active', el.dataset.screen === sidebarActive);
  });

  // Sync names in sidebar footers
  if (desktop) {
    const empName = document.getElementById('esb-company-name');
    if (empName) empName.textContent = window.__esb_company || '—';
    const wrkName = document.getElementById('wsb-user-name');
    if (wrkName) wrkName.textContent = window.__wsb_user || '—';
  }
}

/**
 * Register a setup function for a screen.
 * @param {string} screenId
 * @param {Function} fn
 */
export function onScreen(screenId, fn) {
  _setup[screenId] = fn;
}

/**
 * Navigate to a screen.
 * @param {string} id - screen element id (e.g. 'screen-jobs')
 * @param {boolean} [pushHistory=true] - add to history stack
 */
export function goTo(id, pushHistory = true) {
  // Десктоп: оба кабинета показываются напрямую (без редиректа)

  const screen = document.getElementById(id);
  if (!screen) { console.warn('[router] screen not found:', id); return; }

  // Hide all screens
  document.querySelectorAll('.screen').forEach(s => s.classList.remove('active'));
  screen.classList.add('active');
  window.scrollTo({ top: 0, behavior: 'smooth' });
  haptic('light');

  if (pushHistory) {
    if (_current && _current !== id) _history.push(_current);
    _current = id;
  } else {
    _current = id;
  }

  // Update browser history for web platform
  if (PLATFORM === 'web') {
    history.pushState({ screen: id }, '', '#' + id.replace('screen-', ''));
  }

  // Back button management
  const isHome = id === 'screen-home';
  if (!isHome) {
    onBackButton(goBack);
  } else {
    hideBackButton();
    _history = [];
  }

  // Desktop layout toggle (employer + worker)
  _updateDesktopLayout(id);

  // Ensure chat notifications are active (once per session, after login)
  const me = getPlatformUser();
  if (me?.id) window._chat?.initChatNotifications(me.id);

  // Run setup function if registered
  const setup = _setup[id];
  if (setup) {
    try { setup(); } catch (e) { console.error('[router] setup error for', id, e); }
  }
}

/**
 * Go back to previous screen.
 */
export function goBack() {
  const prev = _history.pop() || 'screen-home';
  goTo(prev, false);
}

/**
 * Get current screen id.
 */
export function currentScreen() { return _current; }

/**
 * Initialize router — handle browser back button for web platform.
 */
export function initRouter() {
  if (PLATFORM === 'web') {
    window.addEventListener('popstate', e => {
      const screen = e.state?.screen;
      if (screen) goTo(screen, false);
      else goBack();
    });
  }
}
