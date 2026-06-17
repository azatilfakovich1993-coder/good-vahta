/**
 * Central application state store.
 * All state lives here; screens read from and write to this store.
 * localStorage is used for persistence across sessions.
 */

// ── localStorage helpers ────────────────────────────────────────────────────
const LS_KEYS = {
  resumes:        'vahta_resumes',
  myJobs:         'vahta_myJobs',
  jobResponses:   'vahta_jobResponses',   // legacy offline cache
  myResponses:    'vahta_myResponses',    // legacy offline cache
  favorites:      'vahta_favorites',
  companyProfile: 'vahta_companyProfile',
  userProfile:    'vahta_userProfile',
  workerStatus:   'vahta_workerStatus',
  notifSettings:  'vahta_notifSettings',
  theme:          'vahta_theme',
};

function lsSave(key, val) {
  try {
    localStorage.setItem(key, JSON.stringify(val));
  } catch (e) {
    if (e?.name === 'QuotaExceededError' || e?.code === 22) {
      import('../components/toast.js').then(m => m.showToast('⚠️ Недостаточно места. Фото не сохранено.'));
    }
  }
}

function lsLoad(key, fallback) {
  try {
    const s = localStorage.getItem(key);
    return s !== null ? JSON.parse(s) : fallback;
  } catch { return fallback; }
}

// ── State ────────────────────────────────────────────────────────────────────

/** Public job listings (loaded from Supabase + locally created) */
export const jobs = [];

/** Employer's own jobs */
export const myJobs = lsLoad(LS_KEYS.myJobs, []);

/** Worker's own resumes */
export const resumes = lsLoad(LS_KEYS.resumes, []);

/** Resume database (other users' public resumes) */
export const resumeDbData = [];

/** Favorites set (job IDs) */
export const favorites = new Set(lsLoad(LS_KEYS.favorites, []));

/**
 * Job responses — OFFLINE CACHE only.
 * Source of truth is now Supabase job_responses table.
 * This cache is used when Supabase is unavailable.
 * @type {Record<string, Array>}
 */
export const jobResponsesCache = lsLoad(LS_KEYS.jobResponses, {});

/**
 * Worker's own responses — OFFLINE CACHE only.
 * Source of truth is Supabase job_responses table.
 * @type {Array}
 */
export const myResponsesCache = (() => {
  const loaded = lsLoad(LS_KEYS.myResponses, []);
  // Older versions stored in reverse order — normalize
  return Array.isArray(loaded) ? loaded : [];
})();

/** Company profile (employer) */
export let companyProfile = lsLoad(LS_KEYS.companyProfile, null);

/** User profile (worker) */
export let userProfile = lsLoad(LS_KEYS.userProfile, null);

/** Worker availability status */
export let workerStatus = lsLoad(LS_KEYS.workerStatus, { open: false, schedule: '' });

/** Notification settings */
export let notifSettings = lsLoad(LS_KEYS.notifSettings, {
  newJobs: true, responses: true, chat: true,
});

/** Active manager company code (null = owner mode) */
export let activeCompanyCode = null;

/** Current role: 'employer' | 'worker' | null */
export let currentRole = null;

/** Theme: 'dark' | 'light' */
export let theme = lsLoad(LS_KEYS.theme, 'dark');

// ── Setters / persist helpers ─────────────────────────────────────────────

export function setCompanyProfile(profile) {
  companyProfile = profile;
  lsSave(LS_KEYS.companyProfile, profile);
}

export function setUserProfile(profile) {
  userProfile = profile;
  lsSave(LS_KEYS.userProfile, profile);
}

export function setWorkerStatus(status) {
  workerStatus = status;
  lsSave(LS_KEYS.workerStatus, status);
}

export function setNotifSettings(settings) {
  notifSettings = { ...notifSettings, ...settings };
  lsSave(LS_KEYS.notifSettings, notifSettings);
}

export function setActiveCompanyCode(code) {
  activeCompanyCode = code || null;
}

export function setCurrentRole(role) {
  currentRole = role;
}

export function setTheme(t) {
  theme = t;
  lsSave(LS_KEYS.theme, t);
  document.documentElement.classList.toggle('light', t === 'light');
}

export function saveMyJobs() {
  lsSave(LS_KEYS.myJobs, myJobs);
  // Also save under company key for manager sharing
  const code = activeCompanyCode || companyProfile?.code;
  if (code) lsSave(`vahta_co_${code}_myJobs`, myJobs);
}

export function saveResumes() {
  lsSave(LS_KEYS.resumes, resumes);
}

export function saveFavorites() {
  lsSave(LS_KEYS.favorites, [...favorites]);
}

export function saveJobResponsesCache() {
  lsSave(LS_KEYS.jobResponses, jobResponsesCache);
  const code = activeCompanyCode || companyProfile?.code;
  if (code) lsSave(`vahta_co_${code}_jobResponses`, jobResponsesCache);
}

export function saveMyResponsesCache() {
  lsSave(LS_KEYS.myResponses, myResponsesCache);
}

// ── Bootstrap ─────────────────────────────────────────────────────────────

// Add locally-created (non-archived) jobs to public listings on startup
myJobs.filter(j => !j.archived).forEach(j => {
  if (!jobs.find(x => x.id === j.id)) jobs.unshift(j);
});

// Apply theme on startup
document.documentElement.classList.toggle('light', theme === 'light');
