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
  companyProfiles: 'vahta_companyProfiles',
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

/** Company profile (employer) — the currently active one */
export let companyProfile = lsLoad(LS_KEYS.companyProfile, null);

/** All companies ever filled in on this device — lets one device manage several employer profiles */
export let companyProfiles = lsLoad(LS_KEYS.companyProfiles, companyProfile ? [companyProfile] : []);

/** User profile (worker) */
export let userProfile = lsLoad(LS_KEYS.userProfile, null);

/** Worker availability status */
export let workerStatus = lsLoad(LS_KEYS.workerStatus, { open: true, schedule: '' });

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

  // Keep the registry of all companies on this device in sync.
  if (profile?.code) {
    const idx = companyProfiles.findIndex(c => c.code === profile.code);
    if (idx === -1) companyProfiles.push(profile);
    else companyProfiles[idx] = profile;
    lsSave(LS_KEYS.companyProfiles, companyProfiles);
  }
}

/** Switch the active company to one already saved on this device (by code). */
export function selectCompanyProfile(code) {
  const found = companyProfiles.find(c => c.code === code);
  if (!found) return false;
  companyProfile = found;
  lsSave(LS_KEYS.companyProfile, found);
  return true;
}

/** Clear the active company pointer only — used before filling a brand-new one. */
export function clearActiveCompanyProfile() {
  companyProfile = null;
  lsSave(LS_KEYS.companyProfile, null);
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

/**
 * Photos are saved to Supabase (vacancies.data) and re-fetched from there
 * (see syncMyJobsFromServer). Keeping them out of the local mirror too avoids
 * blowing the localStorage quota, which used to silently fail other saves.
 */
function _withoutPhotos(jobsArr) {
  return jobsArr.map(j => j.photos ? { ...j, photos: undefined } : j);
}

export function saveMyJobs() {
  lsSave(LS_KEYS.myJobs, _withoutPhotos(myJobs));
  // Also save under company key for manager sharing
  const code = activeCompanyCode || companyProfile?.code;
  if (code) lsSave(`vahta_co_${code}_myJobs`, _withoutPhotos(myJobs));
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
