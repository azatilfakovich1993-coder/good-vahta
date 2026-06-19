/**
 * Employer screen — company profile, job management, responses, analytics.
 *
 * Bug fixes:
 *  - Response statuses now sync to Supabase, visible from any device
 *  - Verification status checked from Supabase on load, not just localStorage
 *  - Company code uses crypto.getRandomValues() instead of Math.random()
 */
import { goTo } from '../router.js';
import { showToast } from '../components/toast.js';
import {
  myJobs, jobs, jobResponsesCache, companyProfile, companyProfiles, favorites,
  saveMyJobs, saveJobResponsesCache, setCompanyProfile, activeCompanyCode,
} from '../store/index.js';
import { esc, todayRu, buildSalaryStr, parseSalaryStr, fmtNum, catLabelJob, JOB_CAT_LABELS } from '../utils.js';
import { saveJob, deleteJob as deleteJobDb, pauseJob, loadMyJobs } from '../api/jobs.js';
import { saveCompany, genCompanyCode, checkVerification, loadCompanyByCode } from '../api/companies.js';
import { lookupCompanyByInn } from '../api/dadata.js';
import { loadResponsesForCompany, updateResponseStatus } from '../api/responses.js';
import { loadInvitationsForEmployer } from '../api/invitations.js';
import { notifyResponseStatus } from '../api/notifications.js';
import { haptic } from '../platform/index.js';
import { getPlatformUser } from '../platform/index.js';
import { compressImage } from '../utils.js';
import { renderCompanySelectList } from './auth.js';

// ── Create Job form state ──────────────────────────────────────────────────
let cjStep = 1;
let cjSchedule = '';
let cjWorkSchedule = '';
let cjCategory = '';
let cjEditIndex = null;
let dynCounters = {};
let cpLogo = '';
let cjPhotos = [];
const MAX_JOB_PHOTOS = 10;
const KNOWN_INDUSTRIES = ['construction', 'oil', 'mining', 'transport', 'manufacturing', 'forestry', 'energy'];

export function onIndustryChange(value) {
  const otherEl = document.getElementById('cp-industry-other');
  if (!otherEl) return;
  otherEl.style.display = value === 'other' ? '' : 'none';
  if (value !== 'other') otherEl.value = '';
}

// ── Verification block ─────────────────────────────────────────────────────

export function updateVerifyBanner() {
  const verBanner = document.getElementById('verified-banner');
  if (!verBanner) return;
  if (!companyProfile) { verBanner.style.display = 'none'; return; }
  verBanner.style.display = '';
  const actionBtn = document.getElementById('vb-action-btn');
  if (companyProfile.verified) {
    verBanner.className = 'verified-banner';
    verBanner.querySelector('.vb-title').textContent = '✅ Компания верифицирована';
    verBanner.querySelector('.vb-desc').textContent  = 'Ваши вакансии помечены знаком проверки';
    if (actionBtn) actionBtn.style.display = 'none';
  } else {
    verBanner.className = 'verified-banner vb-unverified';
    verBanner.querySelector('.vb-title').textContent = '⚠️ Верификация не пройдена';
    verBanner.querySelector('.vb-desc').textContent  = 'Заполните профиль компании — модераторы проверят данные и активируют значок ✓';
    if (actionBtn) { actionBtn.style.display = ''; actionBtn.textContent = 'Заполнить профиль →'; }
  }
}

export async function checkVerificationStatus() {
  if (!companyProfile?.code) return;
  const verified = await checkVerification(companyProfile.code);
  if (verified !== companyProfile.verified) {
    setCompanyProfile({ ...companyProfile, verified });
    if (verified) {
      myJobs.forEach(j => { if (j.company === companyProfile.name) j.verified = true; });
      jobs.forEach(j => { if (j.company === companyProfile.name) j.verified = true; });
      showToast('🎉 Компания верифицирована!', 'success');
    }
  }
  updateVerifyBanner();
}

// ── Company profile ────────────────────────────────────────────────────────

/**
 * Back from the company-profile form: if there's an active company, that means
 * we got here to edit it — go back to its dashboard. Otherwise we're filling
 * in a brand-new company — go back to the picker (or home if none exist yet).
 */
export function companyProfileBack() {
  if (companyProfile?.name) {
    goTo('screen-employer');
  } else if (companyProfiles.length > 0) {
    goTo('screen-company-select');
    renderCompanySelectList();
  } else {
    goTo('screen-home');
  }
}

/** Prefill company profile form with existing data (called on screen entry). */
export function initCompanyProfileForm() {
  // Always show form, hide success screen
  const formWrap = document.getElementById('cp-form-wrap');
  const success  = document.getElementById('cp-success');
  if (formWrap) formWrap.style.display = '';
  if (success)  success.classList.remove('active');

  if (!companyProfile?.name) return; // no profile yet — blank form
  const cp = companyProfile;
  const _s = (id, v) => { const el = document.getElementById(id); if (el) el.value = v || ''; };
  _s('cp-name',     cp.name);
  _s('cp-inn',      cp.inn);
  _s('cp-city',     cp.city);
  _s('cp-phone',    cp.phone);
  _s('cp-website',  cp.website);
  _s('cp-email',    cp.email);
  _s('cp-about',    cp.about);
  const aboutEl = document.getElementById('cp-about');
  if (aboutEl) { aboutEl.style.height = 'auto'; aboutEl.style.height = aboutEl.scrollHeight + 'px'; }
  const indEl   = document.getElementById('cp-industry');
  const otherEl = document.getElementById('cp-industry-other');
  if (indEl && cp.industry) {
    const isKnown = KNOWN_INDUSTRIES.includes(cp.industry);
    indEl.value = isKnown ? cp.industry : 'other';
    if (otherEl) {
      otherEl.style.display = isKnown ? 'none' : '';
      otherEl.value = isKnown ? '' : cp.industry;
    }
  } else if (otherEl) {
    otherEl.style.display = 'none';
    otherEl.value = '';
  }
  // Logo
  if (cp.logo) {
    const circle = document.getElementById('cp-logo-circle');
    if (circle) circle.innerHTML = `<img src="${cp.logo}" alt="Логотип" />`;
    cpLogo = cp.logo;
  }
}

// ── INN auto-lookup (DaData) ────────────────────────────────────────────────
let _innLookupTimer = null;

/** Called on every keystroke in the ИНН field — debounced lookup once 10/12 digits are typed. */
export function onInnInput(value) {
  clearTimeout(_innLookupTimer);
  const digits = (value || '').replace(/\D/g, '');
  if (digits.length !== 10 && digits.length !== 12) return;
  _innLookupTimer = setTimeout(() => _runInnLookup(digits), 500);
}

async function _runInnLookup(inn) {
  const suggestion = await lookupCompanyByInn(inn);
  if (!suggestion) return;

  const cityEl = document.getElementById('cp-city');
  const city = suggestion.data?.address?.data?.city || suggestion.data?.address?.data?.settlement || '';
  if (cityEl && !cityEl.value.trim() && city) cityEl.value = city;

  const status = suggestion.data?.state?.status;
  if (status === 'LIQUIDATED' || status === 'LIQUIDATING') {
    showToast('⚠️ По данным ФНС компания ликвидирована — проверьте ИНН', 'error');
  } else if (status === 'ACTIVE') {
    showToast('✅ Компания найдена в ЕГРЮЛ, статус: действующая', 'success');
  }
}

export async function saveCompanyProfile() {
  const name    = document.getElementById('cp-name').value.trim();
  const inn     = document.getElementById('cp-inn').value.trim();
  const city    = document.getElementById('cp-city').value.trim();
  const phone   = document.getElementById('cp-phone').value.trim();
  const about   = document.getElementById('cp-about').value.trim();
  const indEl     = document.getElementById('cp-industry');
  const indOtherEl= document.getElementById('cp-industry-other');
  const industry  = indEl?.value === 'other' ? (indOtherEl?.value.trim() || '') : (indEl ? indEl.value : '');
  const website = document.getElementById('cp-website').value.trim();
  const email   = document.getElementById('cp-email').value.trim();

  if (!name) { showFocus('cp-name'); showToast('Введите название компании', 'error'); return; }
  if (!inn || !/^\d{10}(\d{2})?$/.test(inn)) { showFocus('cp-inn'); showToast('Введите корректный ИНН (10 или 12 цифр)', 'error'); return; }
  if (!city) { showFocus('cp-city'); showToast('Введите город', 'error'); return; }
  if (!email || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) { showFocus('cp-email'); showToast('Введите корректный email', 'error'); return; }

  const me = getPlatformUser();
  const existingCode = companyProfile?.code || genCompanyCode();

  const updated = {
    ...companyProfile,
    name, inn, city, phone, about, industry, website, email,
    logo:    cpLogo || companyProfile?.logo || '',
    code:    existingCode,
    verified: companyProfile?.verified || false,
    ownerId:  me.id || companyProfile?.ownerId || '',
    ownerChatId: me.id || companyProfile?.ownerChatId || null,
  };

  setCompanyProfile(updated);
  const synced = await saveCompany(updated);
  if (!synced) showToast('⚠️ Сохранено только на этом устройстве — нет связи с сервером', 'error');

  // Update company code display
  const codeDisplay = document.getElementById('cp-code-display');
  if (codeDisplay) codeDisplay.textContent = existingCode;

  // Copy code button
  const copyBtn = document.getElementById('cp-code-copy');
  if (copyBtn) copyBtn.onclick = () => {
    navigator.clipboard?.writeText(existingCode);
    showToast('Код скопирован 📋');
  };

  // Update logo in all jobs
  myJobs.forEach(j => {
    if (j.company === (companyProfile?.name || name)) {
      j.logo = updated.logo;
      j.verified = updated.verified;
      j.companyInfo = {
        name: updated.name, industry: updated.industry, city: updated.city,
        about: updated.about, website: updated.website, phone: updated.phone,
        email: updated.email, logo: updated.logo,
        code: updated.code,
      };
    }
  });
  saveMyJobs();

  document.getElementById('cp-form-wrap').style.display = 'none';
  document.getElementById('cp-success').classList.add('active');
  updateVerifyBanner();
  showToast('Профиль компании сохранён ✅', 'success');
}

export async function handleCompanyLogo(input) {
  if (!input.files?.[0]) return;
  const file = input.files[0];
  if (file.size > 5 * 1024 * 1024) { showToast('Логотип не должен быть больше 5 МБ', 'error'); return; }
  const reader = new FileReader();
  reader.onload = async (e) => {
    cpLogo = await compressImage(e.target.result, 300, 0.8);
    const circle = document.getElementById('cp-logo-circle');
    if (circle) circle.innerHTML = `<img src="${cpLogo}" alt="Логотип" />`;
  };
  reader.readAsDataURL(file);
}

// ── Job photos (up to MAX_JOB_PHOTOS) ───────────────────────────────────────

function renderJobPhotos() {
  const grid  = document.getElementById('cj-photo-grid');
  const count = document.getElementById('cj-photo-count');
  if (!grid) return;
  const thumbs = cjPhotos.map((src, i) => `
    <div class="job-photo-thumb">
      <img src="${src}" alt="Фото ${i + 1}" />
      <button class="job-photo-remove" onclick="window._employer.removeJobPhoto(${i})">×</button>
    </div>`).join('');
  const addBtn = cjPhotos.length < MAX_JOB_PHOTOS
    ? `<div class="job-photo-add" onclick="document.getElementById('cj-photo-input').click()">+</div>`
    : '';
  grid.innerHTML = thumbs + addBtn;
  if (count) count.textContent = `${cjPhotos.length}/${MAX_JOB_PHOTOS}`;
}

export async function handleJobPhotos(input) {
  const files = Array.from(input.files || []);
  input.value = ''; // allow re-selecting the same file later
  if (!files.length) return;
  const room = MAX_JOB_PHOTOS - cjPhotos.length;
  if (room <= 0) { showToast(`Можно добавить максимум ${MAX_JOB_PHOTOS} фото`, 'error'); return; }
  const toAdd = files.slice(0, room);
  if (files.length > room) showToast(`Добавлено только ${room} из ${files.length} — лимит ${MAX_JOB_PHOTOS} фото`, 'error');

  for (const file of toAdd) {
    if (file.size > 25 * 1024 * 1024) { showToast(`«${file.name}» больше 25 МБ — пропущено`, 'error'); continue; }
    try {
      const dataUrl = await new Promise((resolve, reject) => {
        const reader = new FileReader();
        reader.onload = e => resolve(e.target.result);
        reader.onerror = () => reject(new Error('read failed'));
        reader.readAsDataURL(file);
      });
      cjPhotos.push(await compressImage(dataUrl, 1600, 0.88));
    } catch {
      showToast(`Не удалось загрузить «${file.name}»`, 'error');
    }
  }
  renderJobPhotos();
}

export function removeJobPhoto(idx) {
  cjPhotos.splice(idx, 1);
  renderJobPhotos();
}

// ── Create Job ─────────────────────────────────────────────────────────────

export function openCreateJob() {
  if (!companyProfile) {
    showToast('Сначала создайте профиль компании', 'error');
    goTo('screen-company-profile');
    return;
  }
  cjEditIndex = null;
  resetJobForm();
  document.querySelector('#screen-create-job .section-title').textContent = 'Новая вакансия 📋';
  goTo('screen-create-job');
}

export function openEditJob(idx) {
  cjEditIndex = idx;
  const j = myJobs[idx];
  resetJobForm();
  cjEditIndex = idx;
  document.querySelector('#screen-create-job .section-title').textContent = 'Редактировать вакансию ✏️';
  const sal = parseSalaryStr(j.salary);
  _setVal('cj-title',    j.title);
  _setVal('cj-location', j.location);
  _setVal('cj-salary-from', sal.from);
  _setVal('cj-salary-to',   sal.to);
  _setVal('cj-desc', j.desc);
  _setVal('cj-contact-name',  j.contactName);
  _setVal('cj-contact-phone', j.contactPhone);
  _setVal('cj-contact-email', j.contactEmail);
  cjSchedule     = j.schedule     || '';
  cjWorkSchedule = j.workSchedule || '';
  cjCategory     = j.category     || '';
  if (j.req)  j.req.forEach(v  => addDynItem('req-list',  'req',  'Требование', v));
  if (j.cond) j.cond.forEach(v => addDynItem('cond-list', 'cond', 'Условие', v));
  cjPhotos = [...(j.photos || [])];
  renderJobPhotos();
  goTo('screen-create-job');
}

function resetJobForm() {
  cjStep = 1; cjSchedule = ''; cjWorkSchedule = ''; cjCategory = '';
  dynCounters = {};
  cjPhotos = [];
  renderJobPhotos();
  ['cj-title','cj-location','cj-salary-from','cj-salary-to','cj-desc','cj-contact-name','cj-contact-phone','cj-contact-email'].forEach(id => {
    const el = document.getElementById(id); if (el) el.value = '';
  });
  document.querySelectorAll('#sched-chips .sched-chip, #work-sched-chips .sched-chip, #cj-cat-chips .sched-chip').forEach(c => c.classList.remove('active'));
  document.getElementById('cj-work-schedule-custom-wrap')?.style && (document.getElementById('cj-work-schedule-custom-wrap').style.display = 'none');
  document.getElementById('cj-work-schedule-custom') && (document.getElementById('cj-work-schedule-custom').value = '');
  const reqList  = document.getElementById('req-list');
  const condList = document.getElementById('cond-list');
  if (reqList)  reqList.innerHTML  = '';
  if (condList) condList.innerHTML = '';
  // Template chips reset (re-enable all)
  document.querySelectorAll('.tmpl-chip').forEach(c => { c.classList.remove('tmpl-chip--used'); c.style.display = ''; });
  document.getElementById('cj-form-wrap').style.display = 'flex';
  document.getElementById('cj-success').classList.remove('active');
  renderJobFormStep(1);
}

/**
 * Add a dynamic list item (requirement or condition).
 * @param {string} listId  - container element id
 * @param {string} prefix  - 'req' or 'cond'
 * @param {string} ph      - placeholder text
 * @param {HTMLElement|string} tmplChipOrVal - template chip element (marks as used) OR pre-filled string value
 */
export function addDynItem(listId, prefix, ph, tmplChipOrVal = '') {
  const list = document.getElementById(listId);
  if (!list) return;
  if (!(prefix in dynCounters)) dynCounters[prefix] = 0;
  const idx = dynCounters[prefix]++;
  const id  = `${prefix}-${idx}`;
  const row = document.createElement('div');
  row.className = 'dyn-item';
  row.id = `${id}-row`;

  // Determine prefill value
  let fillVal = '';
  if (tmplChipOrVal instanceof HTMLElement) {
    fillVal = tmplChipOrVal.textContent.trim(); // chip text — no regex, works with Cyrillic
    tmplChipOrVal.classList.add('tmpl-chip--used');
    setTimeout(() => { tmplChipOrVal.style.display = 'none'; }, 220);
  } else if (typeof tmplChipOrVal === 'string') {
    fillVal = tmplChipOrVal;
  }

  const input = document.createElement('input');
  input.className = 'dyn-input';
  input.id = id;
  input.type = 'text';
  input.placeholder = ph || 'Введите текст';
  input.maxLength = 140;
  input.value = fillVal;

  const removeBtn = document.createElement('button');
  removeBtn.className = 'dyn-remove';
  removeBtn.title = 'Удалить';
  removeBtn.textContent = '×';
  removeBtn.onclick = () => row.remove();

  row.appendChild(input);
  row.appendChild(removeBtn);
  list.appendChild(row);
}

function getListValues(listId) {
  return [...document.querySelectorAll(`#${listId} .dyn-input`)]
    .map(el => el.value.trim())
    .filter(Boolean);
}

export function renderJobFormStep(step) {
  cjStep = step;
  [1,2,3].forEach(s => {
    const el = document.getElementById(`cj-step-${s}`);
    if (el) el.style.display = s === step ? '' : 'none';
  });
  // Update progress dots
  [1,2,3].forEach(s => {
    const dot = document.querySelector(`.fp-step:nth-child(${s === 1 ? 1 : s === 2 ? 3 : 5}) .fp-dot`);
    if (dot) {
      dot.className = `fp-dot ${s < step ? 'done' : s === step ? 'active' : ''}`;
    }
    if (s < 3) {
      const line = document.querySelector(`.fp-step:nth-child(${s === 1 ? 2 : 4}) .fp-line`);
      if (line) line.className = `fp-line ${s < step ? 'done' : ''}`;
    }
  });
  const prevBtn = document.getElementById('cj-prev');
  const nextBtn = document.getElementById('cj-next');
  const submitBtn = document.getElementById('cj-submit');
  if (prevBtn) prevBtn.style.display = step > 1 ? '' : 'none';
  if (nextBtn)   nextBtn.style.display   = step < 3 ? '' : 'none';
  if (submitBtn) submitBtn.style.display = step === 3 ? '' : 'none';
}

export function jobFormNext() {
  if (!validateJobStep(cjStep)) return;
  renderJobFormStep(cjStep + 1);
}

export function jobFormPrev() {
  renderJobFormStep(cjStep - 1);
}

function validateJobStep(step) {
  if (step === 1) {
    const title = document.getElementById('cj-title').value.trim();
    const loc   = document.getElementById('cj-location').value.trim();
    const salF  = document.getElementById('cj-salary-from').value.trim();
    const salT  = document.getElementById('cj-salary-to').value.trim();
    if (!title) { showFocus('cj-title'); showToast('Введите название вакансии', 'error'); return false; }
    if (!loc)   { showFocus('cj-location'); showToast('Введите местоположение', 'error'); return false; }
    if (!salF && !salT) { showFocus('cj-salary-from'); showToast('Введите зарплату', 'error'); return false; }
    if (!cjSchedule) { showToast('Выберите график вахты', 'error'); return false; }
  }
  if (step === 2) {
    const desc = document.getElementById('cj-desc').value.trim();
    if (!desc) { showFocus('cj-desc'); showToast('Добавьте описание вакансии', 'error'); return false; }
  }
  return true;
}

export function selectSchedule(el, val) {
  document.querySelectorAll('#sched-chips .sched-chip').forEach(c => c.classList.remove('active'));
  el.classList.add('active');
  cjSchedule = val;
  const customWrap = document.getElementById('cj-schedule-custom-wrap');
  if (customWrap) customWrap.style.display = val === 'Другой' ? '' : 'none';
}

export function selectWorkSchedule(el, val) {
  document.querySelectorAll('#work-sched-chips .sched-chip').forEach(c => c.classList.remove('active'));
  el.classList.add('active');
  cjWorkSchedule = val;
  const wrap = document.getElementById('cj-work-schedule-custom-wrap');
  if (wrap) wrap.style.display = val === 'Другой' ? '' : 'none';
}

export function selectJobCategory(el, cat) {
  document.querySelectorAll('#cj-cat-chips .sched-chip').forEach(c => c.classList.remove('active'));
  el.classList.add('active');
  cjCategory = cat;
  const wrap = document.getElementById('cj-custom-cat-wrap');
  if (wrap) wrap.style.display = cat === 'other' ? 'block' : 'none';
}

export async function submitJob() {
  if (!validateJobStep(3)) return;

  const btn = document.getElementById('cj-submit');
  if (btn) { btn.disabled = true; btn.textContent = '⏳ Публикую...'; }

  try {
    await _doSubmitJob();
  } catch (e) {
    console.error('[submitJob]', e);
    showToast('Ошибка публикации: ' + (e.message || e), 'error');
  } finally {
    if (btn) { btn.disabled = false; btn.textContent = '✅ Опубликовать'; }
  }
}

function _renderJobPreview(job) {
  const preview = document.getElementById('cj-preview');
  if (!preview) return;
  preview.innerHTML = `
    <div class="pc-header">
      <div class="pc-logo">📋</div>
      <div>
        <div class="pc-company">${esc(companyProfile?.name || 'Компания')}${companyProfile?.verified ? ' <span class="verified-chip">✓ Проверен</span>' : ''}</div>
        <div class="pc-title">${esc(job.title)}</div>
      </div>
    </div>
    <div class="pc-salary">${esc(job.salary)}</div>
    <div class="pc-meta">
      <span class="pc-tag">📍 ${esc(job.location)}</span>
      <span class="pc-tag">⏱ Вахта ${esc(job.schedule)}</span>
      ${job.workSchedule ? `<span class="pc-tag">📆 ${esc(job.workSchedule)}</span>` : ''}
      <span class="pc-tag">📅 ${esc(job.date || todayRu())}</span>
    </div>`;
}

async function _doSubmitJob() {
  const title        = document.getElementById('cj-title').value.trim();
  const salFrom      = document.getElementById('cj-salary-from').value.trim();
  const salTo        = document.getElementById('cj-salary-to').value.trim();
  const location     = document.getElementById('cj-location').value.trim();
  const schedule     = cjSchedule === 'Другой'
    ? document.getElementById('cj-schedule-custom').value.trim()
    : cjSchedule;
  const workSchedule = cjWorkSchedule === 'Другой'
    ? document.getElementById('cj-work-schedule-custom')?.value.trim() || ''
    : cjWorkSchedule;
  const desc         = document.getElementById('cj-desc').value.trim();
  const reqs         = getListValues('req-list');
  const conds        = getListValues('cond-list');
  const contactName  = document.getElementById('cj-contact-name').value.trim();
  const contactPhone = document.getElementById('cj-contact-phone').value.trim();
  const contactEmail = document.getElementById('cj-contact-email').value.trim();
  const catCustomEl  = document.getElementById('cj-custom-cat');
  const catCustom    = catCustomEl ? catCustomEl.value.trim() : '';

  const salaryStr = buildSalaryStr(Number(salFrom) || 0, Number(salTo) || 0);
  const today = todayRu();
  const me = getPlatformUser();

  // Edit mode
  if (cjEditIndex !== null) {
    const oldId = myJobs[cjEditIndex].id;
    const updated = {
      ...myJobs[cjEditIndex],
      title, location, salary: salaryStr, schedule, workSchedule,
      category: cjCategory || 'other', categoryCustom: catCustom,
      desc, req: reqs, cond: conds, contactName, contactPhone, contactEmail,
      photos: [...cjPhotos],
    };
    myJobs[cjEditIndex] = updated;
    const jIdx = jobs.findIndex(j => j.id === oldId);
    if (jIdx !== -1) jobs[jIdx] = { ...jobs[jIdx], ...updated };
    saveMyJobs();
    const synced1 = await saveJob({ ...updated });
    window._jobs?.renderJobs(jobs);
    showToast(synced1 ? 'Вакансия обновлена ✏️' : '⚠️ Обновлено только локально — нет связи с сервером', synced1 ? 'success' : 'error');
    _renderJobPreview(updated);
    const successTitle = document.querySelector('#cj-success .success-title');
    if (successTitle) successTitle.textContent = 'Вакансия обновлена!';
    document.getElementById('cj-form-wrap').style.display = 'none';
    document.getElementById('cj-success').classList.add('active');
    cjEditIndex = null;
    return;
  }

  // New job
  const newId = Date.now();
  const newJob = {
    id: newId, emoji: '📋', color: 'rgba(233,69,96,.25)',
    logo: companyProfile?.logo || '',
    category: cjCategory || 'other', categoryCustom: catCustom,
    company: companyProfile?.name || 'Ваша компания',
    verified: companyProfile?.verified || false,
    companyInfo: companyProfile ? {
      name: companyProfile.name, industry: companyProfile.industry,
      city: companyProfile.city, about: companyProfile.about,
      website: companyProfile.website, phone: companyProfile.phone,
      email: companyProfile.email,
      logo: companyProfile.logo, code: companyProfile.code,
    } : null,
    ownerChatId: me.id || null,
    title, location, salary: salaryStr, schedule, workSchedule, date: today,
    desc, req: reqs, cond: conds, contactName, contactPhone, contactEmail,
    photos: [...cjPhotos],
    paused: false, archived: false,
  };

  jobs.unshift(newJob);
  myJobs.unshift({ ...newJob });
  saveMyJobs();
  const synced2 = await saveJob({ ...newJob });
  if (!synced2) showToast('⚠️ Вакансия сохранена только локально — нет связи с сервером', 'error');

  // Notify matching workers
  window._notifications?.notifyMatchingWorkers?.(newJob);
  window._jobs?.renderJobs(jobs);
  haptic('success');

  _renderJobPreview(newJob);
  const successTitle = document.querySelector('#cj-success .success-title');
  if (successTitle) successTitle.textContent = 'Вакансия опубликована!';
  document.getElementById('cj-form-wrap').style.display = 'none';
  document.getElementById('cj-success').classList.add('active');
}

// ── My Jobs ────────────────────────────────────────────────────────────────

/** Jobs belonging to the currently active company only — each company manages its own list. */
function myCompanyJobs() {
  if (!companyProfile?.code) return [];
  return myJobs.filter(j => j.companyInfo?.code === companyProfile.code);
}

/**
 * Pulls the active company's vacancies from Supabase and merges them into the
 * local cache. "Мои вакансии" used to rely solely on localStorage — if that got
 * cleared (cache wipe, quota limits, new device) the list looked empty even
 * though the jobs still existed on the server. This keeps it in sync.
 */
export async function syncMyJobsFromServer() {
  if (!companyProfile?.code) return;
  const fresh = await loadMyJobs(companyProfile.code);
  if (!fresh.length) return;
  const freshIds = new Set(fresh.map(j => String(j.id)));
  for (let i = myJobs.length - 1; i >= 0; i--) {
    if (freshIds.has(String(myJobs[i].id))) myJobs.splice(i, 1);
  }
  myJobs.unshift(...fresh);
  saveMyJobs();
  renderMyJobs();
}

export function renderMyJobs() {
  const c = document.getElementById('my-jobs-list');
  if (!c) return;
  const mine     = myCompanyJobs();
  const active   = mine.filter(j => !j.archived && !j.paused);
  const paused   = mine.filter(j => !j.archived &&  j.paused);
  const archived = mine.filter(j =>  j.archived);

  if (!mine.length) {
    c.innerHTML = `<div class="empty-state"><div class="empty-icon">📋</div><div class="empty-title">Нет вакансий</div><div class="empty-desc">Создайте первую вакансию</div></div>`;
    return;
  }

  const renderCard = (j) => {
    const idx        = myJobs.indexOf(j);
    const respCount  = (jobResponsesCache[j.id] || []).length;
    const newCount   = (jobResponsesCache[j.id] || []).filter(r => !r.status || r.status === 'pending').length;
    const newBadge   = newCount ? `<span class="mjc-new-badge">${newCount}</span>` : '';

    if (j.archived) {
      return `
        <div class="my-job-card mjc-archived">
          <div class="mjc-header">
            <div class="mjc-title">${esc(j.title)}</div>
            <span class="status-badge">Архив</span>
          </div>
          <div class="mjc-meta">
            <span class="mjc-meta-item">${esc(j.location)}</span>
            <span class="mjc-meta-item">${esc(j.salary)}</span>
          </div>
          <div class="mjc-actions">
            <button class="mjc-btn mjc-btn--icon" onclick="window._employer.previewMyJob(${idx})" title="Просмотр">Просмотр</button>
            <button class="mjc-btn mjc-btn--icon" onclick="window._employer.openJobResponses('${j.id}')" title="Отклики">Отклики ${newBadge}</button>
            <button class="mjc-btn mjc-btn--restore" onclick="window._employer.restoreJob(${idx})">Восстановить</button>
          </div>
        </div>`;
    }

    const statusLabel = j.paused ? 'Пауза' : 'Активна';
    const statusClass = j.paused ? 'status-paused' : 'status-active';
    const pauseLabel  = j.paused ? 'Возобновить' : 'Пауза';

    return `
      <div class="my-job-card">
        <div class="mjc-header">
          <div class="mjc-title">${esc(j.title)}</div>
          <span class="status-badge ${statusClass}">${statusLabel}</span>
        </div>
        <div class="mjc-meta">
          <span class="mjc-meta-item">${esc(j.location)}</span>
          <span class="mjc-meta-item">${esc(j.salary)}</span>
          <span class="mjc-meta-item">${esc(j.date || '')}</span>
        </div>
        <div class="mjc-stats">
          <div class="mjc-stat"><div class="mjc-stat-num">${respCount}</div><div class="mjc-stat-label">Откликов</div></div>
          <div class="mjc-stat"><div class="mjc-stat-num">${newCount}</div><div class="mjc-stat-label">Новых</div></div>
          <div class="mjc-stat"><div class="mjc-stat-num mjc-stat-num--verify">${j.verified ? 'Да' : '—'}</div><div class="mjc-stat-label">Верифицирована</div></div>
        </div>
        <div class="mjc-actions">
          <button class="mjc-btn" onclick="window._employer.previewMyJob(${idx})" title="Просмотр">Просмотр</button>
          <button class="mjc-btn" onclick="window._employer.openEditJob(${idx})" title="Редактировать">Редактировать</button>
          <button class="mjc-btn mjc-btn--responses" onclick="window._employer.openJobResponses('${j.id}')">Отклики${newBadge}</button>
        </div>
        <div class="mjc-actions mjc-actions--secondary">
          <button class="mjc-btn mjc-btn--pause" onclick="window._employer.togglePauseJob(${idx})">${pauseLabel}</button>
          <button class="mjc-btn mjc-btn--archive" onclick="window._employer.archiveJob(${idx})">В архив</button>
        </div>
      </div>`;
  };

  let html = '';

  if (active.length || paused.length) {
    if (active.length) {
      html += `<div class="mjc-section-header">Активные вакансии <span class="mjc-section-count">${active.length}</span></div>`;
      html += active.map(renderCard).join('');
    }
    if (paused.length) {
      html += `<div class="mjc-section-header mjc-section-header--paused">На паузе <span class="mjc-section-count">${paused.length}</span></div>`;
      html += paused.map(renderCard).join('');
    }
  }

  if (archived.length) {
    html += `<div class="mjc-section-header mjc-section-header--archive">Архив <span class="mjc-section-count">${archived.length}</span></div>`;
    html += archived.map(renderCard).join('');
  }

  c.innerHTML = html;
}

export async function togglePauseJob(idx) {
  const j = myJobs[idx];
  j.paused = !j.paused;
  const jIdx = jobs.findIndex(x => x.id === j.id);
  if (jIdx !== -1) jobs[jIdx].paused = j.paused;
  saveMyJobs();
  await pauseJob(j.id, j.paused);
  window._jobs?.renderJobs(jobs);
  renderMyJobs();
  showToast(j.paused ? '⏸ Вакансия на паузе' : '▶️ Вакансия активирована');
}

export async function archiveJob(idx) {
  if (!confirm('Архивировать вакансию?')) return;
  const j = myJobs[idx];
  j.archived = true;
  const jIdx = jobs.findIndex(x => x.id === j.id);
  if (jIdx !== -1) jobs.splice(jIdx, 1);
  saveMyJobs();
  await deleteJobDb(j.id);
  window._jobs?.renderJobs(jobs);
  renderMyJobs();
  showToast('📦 Вакансия перемещена в архив');
}

export async function restoreJob(idx) {
  const j = myJobs[idx];
  if (!j) return;
  j.archived = false;
  j.paused   = false;
  saveMyJobs();
  await saveJob(j); // upsert with archived:false restores in Supabase
  if (!jobs.find(x => String(x.id) === String(j.id))) jobs.unshift(j);
  window._jobs?.renderJobs(jobs);
  renderMyJobs();
  showToast('♻️ Вакансия восстановлена');
}

// ── Responses ──────────────────────────────────────────────────────────────

let _currentResponseJobId = null;

export async function renderAllEmployerResponses() {
  const c = document.getElementById('all-responses-list');
  if (!c) return;

  // Load from Supabase
  const companyId = activeCompanyCode || companyProfile?.code;
  if (companyId) {
    const fresh = await loadResponsesForCompany(companyId);
    fresh.forEach(resp => {
      const existing = jobResponsesCache[resp.job_id];
      if (!existing) jobResponsesCache[resp.job_id] = [];
      const idx = jobResponsesCache[resp.job_id].findIndex(r => r.id === resp.id);
      if (idx === -1) jobResponsesCache[resp.job_id].unshift(resp);
      else jobResponsesCache[resp.job_id][idx] = resp;
    });
    saveJobResponsesCache();
  }

  const myJobIds = new Set(myCompanyJobs().map(j => String(j.id)));
  const all = [];
  Object.entries(jobResponsesCache).forEach(([jobId, resps]) => {
    if (jobId === '__all' || !Array.isArray(resps) || !myJobIds.has(String(jobId))) return;
    resps.forEach((r, i) => all.push({ ...r, _jobId: jobId, _idx: i }));
  });
  all.sort((a, b) => new Date(b.created_at || b.date || 0) - new Date(a.created_at || a.date || 0));

  if (!all.length) {
    c.innerHTML = `<div class="empty-state"><div class="empty-icon">📩</div><div class="empty-title">Откликов пока нет</div></div>`;
    return;
  }
  c.innerHTML = all.map((r, i) => _responseCardHtml(r, i)).join('');
}

export function openJobResponses(jobId) {
  _currentResponseJobId = jobId;
  renderJobResponseList(jobId);
  goTo('screen-job-responses');
}

export function renderJobResponseList(jobId) {
  const c = document.getElementById('job-resp-list');
  if (!c) return;
  const resps = jobResponsesCache[jobId] || [];
  if (!resps.length) {
    c.innerHTML = `<div class="empty-state"><div class="empty-icon">📩</div><div class="empty-title">Откликов нет</div></div>`;
    return;
  }
  c.innerHTML = resps.map((r, i) => _responseCardHtml(r, i)).join('');
}

function _responseCardHtml(r, i) {
  const statusCls = { pending:'rs-pending', viewed:'rs-viewed', accepted:'rs-accepted', declined:'rs-declined' }[r.status] || 'rs-pending';
  const statusLbl = { pending:'⏳ Новый', viewed:'👁 Просмотрен', accepted:'✅ Приглашён', declined:'❌ Отказ' }[r.status] || '⏳ Новый';
  const isNew = !r.status || r.status === 'pending';
  const name = esc(r.applicant_name || r.name || 'Соискатель');
  const spec = esc(r.specialty || '—');
  const jId = r._jobId || r.job_id;
  return `
    <div class="response-card${isNew ? ' response-card--new' : ''}" onclick="window._employer.openCandidateFromResponse('${jId}',${i},'${r.id}')">
      <div class="resp-header">
        <div class="resp-avatar">${r.gender === 'Ж' ? '👩' : '👷'}</div>
        <div>
          <div class="resp-name">${name}</div>
          <div class="resp-spec">${spec}</div>
        </div>
        <span class="resp-status-badge ${statusCls}" style="margin-left:auto">${statusLbl}</span>
      </div>
      <div class="resp-meta">
        ${r.salary ? `<span class="resp-tag">💰 от ${fmtNum(r.salary || 0)} ₽</span>` : ''}
        ${r.region ? `<span class="resp-tag">📍 ${esc(r.region)}</span>` : ''}
        ${r.exp    ? `<span class="resp-tag">⏳ ${esc(r.exp)}</span>` : ''}
      </div>
      <div class="resp-actions" onclick="event.stopPropagation()">
        ${r.status !== 'accepted' ? `<button class="resp-btn-accept" onclick="window._employer.acceptResponse('${jId}',${i},'${r.id}','${esc(r.telegram||'')}','${esc(r.applicant_name||r.name||'')}')">✅ Пригласить</button>` : ''}
        ${r.status !== 'declined' && r.status !== 'accepted' ? `<button class="resp-btn-decline" onclick="window._employer.declineResponse('${jId}',${i},'${r.id}','${esc(r.applicant_name||r.name||'')}')">✕</button>` : ''}
        ${r.status === 'accepted' ? `<button class="chat-open-btn" onclick="window._chat.openChatEr('${jId}','${esc(r.applicant_id||'')}','${esc(r.applicant_name||r.name||'')}','${esc(r.job_title||'')}')">💬 Чат</button>` : ''}
      </div>
    </div>`;
}

export async function openCandidateFromResponse(jobId, idx, responseId) {
  // Find response in cache
  const resp = (jobResponsesCache[jobId] || []).find(r => r.id === responseId)
            || Object.values(jobResponsesCache).flat().find(r => r.id === responseId)
            || { id: responseId, job_id: jobId };

  // Mark as viewed if still pending
  if (!resp.status || resp.status === 'pending') {
    resp.status = 'viewed';
    saveJobResponsesCache();
    if (responseId) await updateResponseStatus(responseId, 'viewed');
  }

  // Populate screen-candidate-detail with response data
  const rd = resp.resume_data || {};
  const name    = resp.applicant_name || rd.name    || 'Соискатель';
  const spec    = resp.specialty      || rd.specialty || '—';
  const salary  = resp.salary         || rd.salary   || 0;
  const region  = resp.region         || rd.region   || '—';
  const exp     = resp.exp            || rd.exp      || '—';
  const gender  = resp.gender         || rd.gender   || 'М';
  const about   = resp.about          || rd.about    || '';
  const tg      = resp.telegram       || rd.telegram || '';
  const phone   = resp.phone          || rd.phone    || '';

  const avatarEl = document.getElementById('cd-avatar');
  const nameEl   = document.getElementById('cd-name');
  const specEl   = document.getElementById('cd-spec');
  if (avatarEl) avatarEl.textContent = gender === 'Ж' ? '👩' : '👷';
  if (nameEl)   nameEl.textContent   = name;
  if (specEl)   specEl.textContent   = spec;

  const salEl  = document.getElementById('cd-salary');
  const regEl  = document.getElementById('cd-region');
  const expEl  = document.getElementById('cd-exp');
  const genEl  = document.getElementById('cd-gender');
  if (salEl) salEl.textContent  = salary ? fmtNum(salary) + ' ₽' : '—';
  if (regEl) regEl.textContent  = region;
  if (expEl) expEl.textContent  = exp;
  if (genEl) genEl.textContent  = gender === 'Ж' ? 'Женский' : 'Мужской';

  const aboutCard = document.getElementById('cd-about-card');
  const aboutEl   = document.getElementById('cd-about');
  if (aboutCard && aboutEl) {
    if (about) { aboutCard.style.display = ''; aboutEl.textContent = about; }
    else        { aboutCard.style.display = 'none'; }
  }

  const contactWrap = document.getElementById('cd-contact-wrap');
  if (contactWrap) {
    contactWrap.innerHTML = (tg || phone) ? `
      <div class="cand-detail-card">
        <div class="cand-detail-card-title">Контакты</div>
        ${tg    ? `<div class="cand-detail-row"><span class="cand-detail-row-label">✈️ Telegram</span><a class="cand-detail-row-val" href="https://t.me/${esc(tg)}" target="_blank">@${esc(tg)}</a></div>` : ''}
        ${phone ? `<div class="cand-detail-row"><span class="cand-detail-row-label">📞 Телефон</span><a class="cand-detail-row-val" href="tel:${esc(phone)}">${esc(phone)}</a></div>` : ''}
      </div>` : '';
  }

  // Show which job the candidate applied for
  const jobTitleBadge = document.getElementById('cd-applied-job');
  if (jobTitleBadge) {
    const jt = resp.job_title || '';
    jobTitleBadge.textContent = jt ? `Отклик на: ${jt}` : '';
    jobTitleBadge.style.display = jt ? '' : 'none';
  }

  // Back from candidate detail should go back to responses screen
  const backBtn = document.querySelector('#screen-candidate-detail .back-btn');
  if (backBtn) backBtn.onclick = () => history.back();

  // Store candidate for invite modal
  window._misc?._setInvCandidate?.({ name, telegram: tg, phone, workerChatId: resp.applicant_id });

  goTo('screen-candidate-detail');

  // Re-render responses in background to update status badge
  renderAllEmployerResponses();
}

export async function acceptResponse(jobId, idx, responseId, telegram, name) {
  const resp = (jobResponsesCache[jobId] || [])[idx];
  if (resp) resp.status = 'accepted';
  saveJobResponsesCache();
  if (responseId) await updateResponseStatus(responseId, 'accepted');
  notifyResponseStatus(resp?.applicant_id, resp?.job_title || '', 'accepted');
  renderAllEmployerResponses();
  showToast(`✅ ${name} приглашён`, 'success');
}

export async function declineResponse(jobId, idx, responseId, name) {
  const resp = (jobResponsesCache[jobId] || [])[idx];
  if (resp) resp.status = 'declined';
  saveJobResponsesCache();
  if (responseId) await updateResponseStatus(responseId, 'declined');
  notifyResponseStatus(resp?.applicant_id, resp?.job_title || '', 'declined');
  renderAllEmployerResponses();
  showToast(`Отказ отправлен — ${name}`);
}

export function updateResponseBadges() {
  const myJobIds = new Set(myCompanyJobs().map(j => String(j.id)));
  let total = 0;
  Object.entries(jobResponsesCache).forEach(([jobId, arr]) => {
    if (!myJobIds.has(String(jobId)) || !Array.isArray(arr)) return;
    arr.forEach(r => { if (!r.status || r.status === 'pending') total++; });
  });
  const badge = document.getElementById('resp-badge');
  if (badge) { badge.className = `mi-resp-badge ${total ? 'visible' : ''}`; badge.textContent = total || ''; }
}

// ── Analytics ──────────────────────────────────────────────────────────────

export async function renderAnalytics() {
  const el = document.getElementById('an-content');
  if (!el) return;

  el.innerHTML = `<div class="an-empty">⏳ Загрузка данных...</div>`;

  // Always load fresh data from Supabase
  const companyId = activeCompanyCode || companyProfile?.code;
  if (companyId) {
    const fresh = await loadResponsesForCompany(companyId);
    // Rebuild cache by job_id (skip __all)
    fresh.forEach(r => {
      if (!jobResponsesCache[r.job_id]) jobResponsesCache[r.job_id] = [];
      const idx = jobResponsesCache[r.job_id].findIndex(x => x.id === r.id);
      if (idx === -1) jobResponsesCache[r.job_id].push(r);
      else jobResponsesCache[r.job_id][idx] = r;
    });
    saveJobResponsesCache();
  }

  // Load invitations
  const invitations = companyProfile?.name
    ? await loadInvitationsForEmployer(companyProfile.name)
    : [];

  const mine = myCompanyJobs();
  if (!mine.length) {
    el.innerHTML = `<div class="an-empty">📋 Создайте первую вакансию,<br>чтобы увидеть аналитику</div>`;
    return;
  }

  // Collect responses for this company's jobs only (no __all key)
  const myJobIds = new Set(mine.map(j => String(j.id)));
  const allResps = [];
  Object.entries(jobResponsesCache).forEach(([key, arr]) => {
    if (key === '__all' || !Array.isArray(arr) || !myJobIds.has(String(key))) return;
    arr.forEach(r => allResps.push(r));
  });

  const totalResp     = allResps.length;
  const totalNew      = allResps.filter(r => !r.status || r.status === 'pending').length;
  const totalViewed   = allResps.filter(r => r.status === 'viewed').length;
  const totalAccepted = allResps.filter(r => r.status === 'accepted').length;
  const totalDeclined = allResps.filter(r => r.status === 'declined').length;

  const invTotal    = invitations.length;
  const invAccepted = invitations.filter(i => i.status === 'accepted').length;
  const invDeclined = invitations.filter(i => i.status === 'declined').length;
  const invPending  = invitations.filter(i => i.status === 'pending' || i.status === 'viewed').length;

  const activeJobs  = mine.filter(j => !j.archived && !j.paused).length;
  const pausedJobs  = mine.filter(j => j.paused && !j.archived).length;
  const archivedJobs = mine.filter(j => j.archived).length;
  const acceptRate  = totalResp ? Math.round(totalAccepted / totalResp * 100) : 0;

  // Per-job stats
  const jobStats = mine
    .filter(j => !j.archived)
    .map(j => {
      const resps = (jobResponsesCache[j.id] || []);
      return { job: j, total: resps.length,
        accepted: resps.filter(r => r.status === 'accepted').length,
        declined: resps.filter(r => r.status === 'declined').length,
        newR: resps.filter(r => !r.status || r.status === 'pending').length };
    })
    .sort((a, b) => b.total - a.total);

  // 7-day timeline
  const days = [];
  for (let i = 6; i >= 0; i--) {
    const d = new Date(); d.setDate(d.getDate() - i);
    days.push({ label: d.toLocaleDateString('ru', { weekday:'short' }), count: 0 });
  }
  allResps.forEach(r => {
    if (!r.created_at && !r.date) return;
    const rd = new Date(r.created_at || r.date);
    const today = new Date(); today.setHours(23,59,59,999);
    const diff = Math.round((today - rd) / 86400000);
    if (diff >= 0 && diff < 7) days[6 - diff].count++;
  });
  const maxDay = Math.max(...days.map(d => d.count), 1);

  const tlBars = days.map(d => {
    const h = Math.round(d.count / maxDay * 56);
    return `<div class="an-timeline-col">
      <div class="an-timeline-bar" style="height:${Math.max(h, 2)}px"></div>
      <div class="an-timeline-label">${d.label}</div>
      ${d.count ? `<div class="an-timeline-cnt">${d.count}</div>` : ''}
    </div>`;
  }).join('');

  // Top jobs list
  const topJobsHtml = jobStats.slice(0, 5).filter(x => x.total > 0).map(({ job: j, total, accepted, newR }) => `
    <div class="an-top-job">
      <div class="an-top-job-emoji">${j.paused ? '⏸' : '📋'}</div>
      <div class="an-top-job-info">
        <div class="an-top-job-title">${esc(j.title)}</div>
        <div class="an-top-job-meta">${esc(j.location || '')}${j.salary ? ' · ' + esc(j.salary) : ''}</div>
      </div>
      <div style="display:flex;flex-direction:column;align-items:flex-end;gap:2px">
        <div class="an-top-job-badge">${total} откл</div>
        ${accepted ? `<div style="font-size:10px;color:#1db954">✅ ${accepted} приглашён</div>` : ''}
        ${newR ? `<div style="font-size:10px;color:#f5a623">🆕 ${newR} новых</div>` : ''}
      </div>
    </div>`).join('');

  el.innerHTML = `
    <div class="an-kpi-grid">
      <div class="an-kpi-card">
        <div class="an-kpi-num">${mine.length}</div>
        <div class="an-kpi-label">Вакансий</div>
        <div class="an-kpi-sub">${activeJobs} активных${pausedJobs ? ` · ${pausedJobs} на паузе` : ''}${archivedJobs ? ` · ${archivedJobs} в архиве` : ''}</div>
      </div>
      <div class="an-kpi-card">
        <div class="an-kpi-num">${totalResp}</div>
        <div class="an-kpi-label">Откликов</div>
        <div class="an-kpi-sub">${totalNew} новых · ${totalViewed} просмотрено</div>
      </div>
      <div class="an-kpi-card">
        <div class="an-kpi-num" style="color:#1db954">${acceptRate}%</div>
        <div class="an-kpi-label">Конверсия</div>
        <div class="an-kpi-sub">${totalAccepted} приглашено · ${totalDeclined} отказ</div>
      </div>
      <div class="an-kpi-card">
        <div class="an-kpi-num">${invTotal}</div>
        <div class="an-kpi-label">Приглашений</div>
        <div class="an-kpi-sub">${invAccepted} приняли · ${invDeclined} отказ · ${invPending} ждут</div>
      </div>
    </div>

    <div class="an-section">
      <div class="an-section-title">Отклики за 7 дней</div>
      <div class="an-timeline">${tlBars}</div>
    </div>

    ${topJobsHtml ? `<div class="an-section"><div class="an-section-title">Вакансии по откликам</div>${topJobsHtml}</div>` : ''}
  `;
}

// ── Manager join ────────────────────────────────────────────────────────────

export async function joinAsManager() {
  const input = document.getElementById('mgr-code-input');
  const code = (input?.value || '').trim().toUpperCase();
  if (code.length < 4) { showToast('Введите корректный код', 'error'); return; }
  const company = await loadCompanyByCode(code);
  if (!company) { showToast('Компания не найдена. Проверьте код.', 'error'); return; }
  // Store as active manager code
  setActiveCompanyCode(code);
  // Load company jobs from shared key
  setCompanyProfile({ ...company, ownerId: company.owner_id });
  showToast(`✅ Вы вошли как менеджер: ${company.name}`, 'success');
  goTo('screen-employer');
}

// ── Helpers ────────────────────────────────────────────────────────────────

function showFocus(id) {
  const el = document.getElementById(id);
  if (!el) return;
  el.classList.add('error'); el.focus();
  setTimeout(() => el.classList.remove('error'), 1500);
}

function _setVal(id, val) { const el = document.getElementById(id); if (el) el.value = val || ''; }

// ── Expose ─────────────────────────────────────────────────────────────────
// ── Sent Invitations ───────────────────────────────────────────────────────

/** Navigate to sent invitations screen. Data loads via onScreen callback. */
export function openSentInvitations() {
  goTo('screen-sent-invitations');
}

/** Load and render sent invitations (called by onScreen + realtime refresh). */
export async function loadSentInvitations() {
  const list = document.getElementById('sent-inv-list');
  if (list) list.innerHTML = '<div style="color:var(--text-muted);font-size:13px;text-align:center;padding:20px">Загрузка...</div>';

  const invitations = await loadInvitationsForEmployer(companyProfile?.name || '');

  // Update employer badge
  _updateEmpInvBadge(invitations);

  if (!list) return;
  if (!invitations.length) {
    list.innerHTML = `<div class="empty-state"><div class="empty-icon">📨</div><div class="empty-title">Приглашений ещё нет</div><div class="empty-sub">Пригласите кандидатов из базы резюме</div></div>`;
    return;
  }

  const statusLabel = {
    pending:  { icon: '⏳', text: 'Ожидает ответа', cls: 'si-pending'  },
    viewed:   { icon: '👁',  text: 'Просмотрено',    cls: 'si-viewed'   },
    accepted: { icon: '✅', text: 'Принято!',        cls: 'si-accepted' },
    declined: { icon: '❌', text: 'Отказ',           cls: 'si-declined' },
  };

  const seenIds = _loadSeenInvIds();

  list.innerHTML = invitations.map(inv => {
    const date = new Date(inv.created_at).toLocaleDateString('ru-RU', { day:'numeric', month:'long' });
    const s = statusLabel[inv.status] || statusLabel.pending;
    const hasPhone = !!inv.candidate_phone;
    const chatId   = inv.id ? `inv_${inv.id}` : '';
    const unread   = chatId ? (window._chat?.getChatUnread(chatId) || 0) : 0;
    const chatBtn  = inv.id ? `<button class="inv-reply-btn inv-chat-btn" data-chat-id="${chatId}" onclick="window._chat.openChatFromInvEmployer('${esc(inv.id)}','${esc(inv.candidate_name || 'Соискатель')}','${esc(inv.job_title || '')}')">💬 Написать${unread ? ` <span class="chat-card-badge">${unread}</span>` : ''}</button>` : '';
    const hasReply = inv.status === 'accepted' || inv.status === 'declined';
    const isNew    = hasReply && !seenIds.has(String(inv.id));
    const cardCls  = hasReply && !isNew ? ' inv-card--seen' : (isNew ? ' inv-card--new-reply' : '');
    return `
      <div class="invitation-card${cardCls}">
        <div class="inv-card-header">
          <div>
            <div class="inv-company" style="font-size:12px">📋 ${esc(inv.job_title || '—')}</div>
            <div style="font-weight:700;font-size:15px;margin-top:2px">👤 ${esc(inv.candidate_name || 'Соискатель')}</div>
          </div>
          <div class="si-status ${s.cls}">${s.icon} ${s.text}${isNew ? ' <span class="inv-new-dot"></span>' : ''}</div>
        </div>
        <div class="inv-date">📅 ${date}</div>
        <div class="inv-card-actions" style="margin-top:10px">
          ${hasPhone ? `<a class="inv-reply-btn inv-reply-call" href="tel:${esc(inv.candidate_phone)}">📞 ${esc(inv.candidate_phone)}</a>` : ''}
          ${chatBtn}
        </div>
      </div>`;
  }).join('');

  // Mark replied invitations as seen — clears badge on next render
  _markInvSeen(invitations);
  _updateEmpInvBadge(invitations);
}

const _INV_SEEN_KEY = 'emp-inv-seen';

function _loadSeenInvIds() {
  try { return new Set(JSON.parse(localStorage.getItem(_INV_SEEN_KEY) || '[]')); } catch { return new Set(); }
}

function _saveSeenInvIds(set) {
  try { localStorage.setItem(_INV_SEEN_KEY, JSON.stringify([...set])); } catch {}
}

/** Mark all currently replied invitations as seen and clear the badge. */
function _markInvSeen(invitations) {
  const seen = _loadSeenInvIds();
  invitations.forEach(i => { if (i.status === 'accepted' || i.status === 'declined') seen.add(String(i.id)); });
  _saveSeenInvIds(seen);
}

function _updateEmpInvBadge(invitations) {
  const seen = _loadSeenInvIds();
  const newReplies = invitations.filter(i =>
    (i.status === 'accepted' || i.status === 'declined') && !seen.has(String(i.id))
  ).length;
  document.querySelectorAll('.emp-inv-badge').forEach(el => {
    el.textContent = newReplies > 0 ? String(newReplies) : '';
    el.style.display = newReplies > 0 ? 'flex' : 'none';
  });
}

export async function updateEmpInvBadge() {
  const invitations = await loadInvitationsForEmployer(companyProfile?.name || '');
  _updateEmpInvBadge(invitations);
}

/** Open employer's own job as a preview (shows job detail screen). */
export function previewMyJob(idx) {
  const j = myJobs[idx];
  if (!j) return;
  // Ensure job is in global jobs list so openJob can find it
  if (!jobs.find(x => String(x.id) === String(j.id))) jobs.unshift(j);
  window._jobs.openJob(j.id);
  // Override back button so employer returns to their jobs list, not worker screen
  requestAnimationFrame(() => {
    const backBtn = document.querySelector('#screen-job-detail .back-btn');
    if (backBtn) backBtn.onclick = () => goTo('screen-my-jobs');
  });
}

const _REVIEW_SEEN_KEY = 'emp-reviews-seen';

/** Check for new reviews on employer's company and show badge/toast. */
export async function checkNewReviews() {
  if (!companyProfile?.name) return;
  const { loadReviews: _lr } = await import('../api/reviews.js');
  const reviews = await _lr(companyProfile.name);
  if (!reviews.length) return;

  const seenIds = new Set(JSON.parse(localStorage.getItem(_REVIEW_SEEN_KEY) || '[]'));
  const newOnes = reviews.filter(r => r.id && !seenIds.has(r.id));

  // Update badge on employer cabinet
  document.querySelectorAll('.emp-review-badge').forEach(el => {
    el.textContent = newOnes.length > 0 ? String(newOnes.length) : '';
    el.style.display = newOnes.length > 0 ? 'inline-flex' : 'none';
  });

  if (newOnes.length > 0) {
    const latest = newOnes[0];
    const stars = '⭐'.repeat(latest.rating || 0);
    showToast(`${stars} Новый отзыв о вашей компании!`, 'success');
  }
}

/** Mark all current reviews as seen. */
export function markReviewsSeen() {
  if (!companyProfile?.name) return;
  import('../api/reviews.js').then(({ loadReviews: _lr }) => {
    _lr(companyProfile.name).then(reviews => {
      const ids = reviews.map(r => r.id).filter(Boolean);
      localStorage.setItem(_REVIEW_SEEN_KEY, JSON.stringify(ids));
      document.querySelectorAll('.emp-review-badge').forEach(el => { el.style.display = 'none'; });
    });
  });
}

window._employer = {
  openCreateJob, openEditJob, submitJob, jobFormNext, jobFormPrev, renderJobFormStep,
  selectSchedule, selectWorkSchedule, selectJobCategory, addDynItem,
  renderMyJobs, togglePauseJob, archiveJob, restoreJob,
  renderAllEmployerResponses, openJobResponses, renderJobResponseList,
  acceptResponse, declineResponse, updateResponseBadges, openCandidateFromResponse,
  renderAnalytics, updateVerifyBanner, checkVerificationStatus,
  saveCompanyProfile, initCompanyProfileForm, handleCompanyLogo, joinAsManager, onInnInput, onIndustryChange,
  companyProfileBack,
  handleJobPhotos, removeJobPhoto,
  openSentInvitations, loadSentInvitations, previewMyJob, checkNewReviews, markReviewsSeen,
  syncMyJobsFromServer,
  _getCompanyName: () => companyProfile?.name || '',
};
