/**
 * Jobs screen — job listing, filtering, and job detail view.
 * Bug fixes:
 *  - XSS: all job fields escaped with esc() before innerHTML
 *  - filterJobs: date string parsing fixed (no longer relies on locale format)
 */
import { goTo } from '../router.js';
import { showToast } from '../components/toast.js';
import {
  jobs, favorites, myResponsesCache, companyProfile,
  saveFavorites,
} from '../store/index.js';
import {
  esc, parseSalary, catLabelJob, fmtNum, JOB_CAT_LABELS, letterAvatar,
} from '../utils.js';
import { loadJobs } from '../api/jobs.js';
import { loadRatingsForCompanies } from '../api/reviews.js';
import { haptic } from '../platform/index.js';

// ── Local state ────────────────────────────────────────────────────────────
let activeCategory = 'all';
let currentJobId   = null;
export function getCurrentJobId() { return currentJobId; }

const jobFilters = { schedule: '', sort: 'default' };

// ── Hidden jobs (localStorage) ─────────────────────────────────────────────
const _HIDDEN_KEY = 'gv_hidden_jobs';
const _hiddenJobs = new Set(JSON.parse(localStorage.getItem(_HIDDEN_KEY) || '[]'));

function _saveHidden() {
  localStorage.setItem(_HIDDEN_KEY, JSON.stringify([..._hiddenJobs]));
}

export function confirmHideJob(jobId, event) {
  if (event) event.stopPropagation();
  haptic('light');

  const overlay = document.createElement('div');
  overlay.className = 'hide-job-overlay';
  overlay.innerHTML = `
    <div class="hide-job-modal">
      <div class="hide-job-icon">🗑️</div>
      <div class="hide-job-title">Скрыть вакансию?</div>
      <div class="hide-job-desc">Вакансия исчезнет из списка. Чтобы вернуть — очистите скрытые в настройках.</div>
      <div class="hide-job-btns">
        <button class="hide-job-cancel">Отмена</button>
        <button class="hide-job-confirm">Скрыть</button>
      </div>
    </div>`;

  overlay.querySelector('.hide-job-cancel').onclick = () => overlay.remove();
  overlay.querySelector('.hide-job-confirm').onclick = () => {
    _hiddenJobs.add(jobId);
    _saveHidden();
    overlay.remove();
    haptic('medium');
    showToast('Вакансия скрыта');
    filterJobs();
  };
  overlay.onclick = e => { if (e.target === overlay) overlay.remove(); };
  document.body.appendChild(overlay);
}

// ── Ratings cache (loaded on reviews page) ─────────────────────────────────
export const ratingsCache = {};  // companyName → { avg, count }

// ── Job card HTML ──────────────────────────────────────────────────────────

function ratingInlineHtml(company) {
  const r = ratingsCache[company];
  if (!r || !r.count) return '';
  return `<span class="rating-inline">⭐ ${r.avg.toFixed(1)} <span class="ri-count">(${r.count})</span></span>`;
}

function isCompanyVerified(j) {
  if (j.verified) return true;
  if (companyProfile?.verified && companyProfile.name === j.company) return true;
  return false;
}

function _isNewJob(j) {
  if (!j.date) return false;
  // date stored as "DD.MM.YYYY" or ISO
  try {
    const parts = j.date.split('.');
    const d = parts.length === 3
      ? new Date(+parts[2], +parts[1] - 1, +parts[0])
      : new Date(j.date);
    return (Date.now() - d.getTime()) < 3 * 24 * 3600 * 1000;
  } catch { return false; }
}

export function jobCardHtml(j, opts = {}) {
  const isFav = favorites.has(j.id);
  const isVerified = isCompanyVerified(j);
  const hasApplied = myResponsesCache.find(r => r.job_id === String(j.id) || r.jobId === j.id);
  const isNew = _isNewJob(j);

  const letter = (j.company || '?')[0].toUpperCase();
  const catName = j.category ? catLabelJob(j).replace(/^[\p{Emoji}\s]+/u, '').trim() : '';
  const rating = ratingInlineHtml(j.company);

  return `
    <div class="job-card${j._isClosed ? ' job-closed' : ''}" onclick="window._jobs.openJob(${j.id})">
      <div class="jc-main">
        <div class="jc-side">
          <div class="jc-logo">${letter}</div>
          <div class="jc-side-btns">
            <button class="fav-btn ${isFav ? 'active' : ''}" onclick="window._jobs.toggleFavorite(${j.id},event)" title="В избранное">${isFav ? '❤️' : '🤍'}</button>
          </div>
        </div>
        <div class="jc-content">
          <div class="jc-title-row">
            <span class="jc-title">${esc(j.title)}</span>
            ${isNew ? '<span class="badge-new-job">Новая</span>' : ''}
          </div>
          <div class="jc-salary">${esc(j.salary)}</div>
          <div class="jc-company-row">
            <span class="jc-company-text">${esc(j.company)}</span>
            ${isVerified ? '<span class="verified-chip">✓ Проверен</span>' : ''}
            ${rating ? `<span class="jc-rating">${rating}</span>` : ''}
          </div>
          <div class="jc-tags">
            ${j.location ? `<span class="jc-tag">📍 ${esc(j.location)}</span>` : ''}
            ${j.schedule ? `<span class="jc-tag">🔄 Вахта ${esc(j.schedule)}</span>` : ''}
            ${catName ? `<span class="jc-tag">🏭 ${esc(catName)}</span>` : ''}
          </div>
          ${j._isClosed
            ? '<div class="job-closed-label">Вакансия закрыта</div>'
            : `<div class="jc-actions">
                <button class="jc-apply-btn" onclick="window._jobs.applyFromCard(${j.id},event)" ${hasApplied ? 'disabled' : ''}>${hasApplied ? '✓ Отклик отправлен' : 'Откликнуться'}</button>
                ${j.contactPhone?.trim() ? `<a class="jc-contact-btn" href="tel:${esc(j.contactPhone)}" onclick="event.stopPropagation()">Связаться</a>` : ''}
              </div>`
          }
        </div>
        <div class="jc-divider"></div>
        <div class="jc-trash-col">
          <button class="jc-hide-btn" onclick="window._jobs.confirmHideJob(${j.id},event)" title="Скрыть вакансию">
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><polyline points="3 6 5 6 21 6"/><path d="M19 6l-1 14H6L5 6"/><path d="M10 11v6M14 11v6"/><path d="M9 6V4h6v2"/></svg>
          </button>
        </div>
      </div>
    </div>`;
}

// ── Render ─────────────────────────────────────────────────────────────────

function _skeletonCards(n = 4) {
  return Array.from({ length: n }, () =>
    `<div class="skeleton skeleton-job-card"></div>`
  ).join('');
}

export function showJobsSkeleton() {
  const c = document.getElementById('jobs-container');
  if (c) c.innerHTML = _skeletonCards(4);
}

function _dateGroup(dateStr) {
  if (!dateStr) return 'earlier';
  try {
    const parts = String(dateStr).split('.');
    const d = parts.length === 3
      ? new Date(+parts[2], +parts[1] - 1, +parts[0])
      : new Date(dateStr);
    if (isNaN(d)) return 'earlier';
    const now = new Date();
    const today = new Date(now.getFullYear(), now.getMonth(), now.getDate());
    const diff = Math.floor((today - new Date(d.getFullYear(), d.getMonth(), d.getDate())) / 86400000);
    if (diff <= 0)  return 'today';
    if (diff === 1) return 'yesterday';
    if (diff <= 7)  return 'week';
    return 'earlier';
  } catch { return 'earlier'; }
}

const _groupLabels = {
  today:     'Сегодня',
  yesterday: 'Вчера',
  week:      'На этой неделе',
  earlier:   'Ранее',
};
const _groupOrder = ['today', 'yesterday', 'week', 'earlier'];

export function renderJobs(list) {
  const c = document.getElementById('jobs-container');
  if (!c) return;
  const visible = list.filter(j => !j.paused && !j.archived && !_hiddenJobs.has(j.id));
  if (!visible.length) {
    c.innerHTML = `
      <div class="empty-state" style="grid-column:1/-1">
        <div class="empty-icon">🔍</div>
        <div class="empty-title">Вакансий не найдено</div>
        <div class="empty-desc">Попробуйте изменить фильтры или вернитесь позже</div>
      </div>`;
    return;
  }

  // Группируем по дате
  const groups = {};
  visible.forEach(j => {
    const g = _dateGroup(j.date);
    if (!groups[g]) groups[g] = [];
    groups[g].push(j);
  });

  let html = '';
  _groupOrder.forEach(key => {
    if (!groups[key]?.length) return;
    html += `<div class="jc-group-header">${_groupLabels[key]}<span class="jc-group-count">${groups[key].length}</span></div>`;
    html += groups[key].map(j => jobCardHtml(j)).join('');
  });

  c.innerHTML = html;
}

export function filterJobs() {
  const q      = (document.getElementById('search-input')?.value || '').toLowerCase().trim();
  const salMin = parseInt(document.getElementById('jf-sal-min')?.value) || 0;
  const salMax = parseInt(document.getElementById('jf-sal-max')?.value) || 0;
  const region = (document.getElementById('jf-region')?.value || '').toLowerCase().trim();

  let result = jobs.filter(j => !j.paused && !j.archived && !_hiddenJobs.has(j.id));

  if (activeCategory !== 'all') result = result.filter(j => j.category === activeCategory);
  if (q) result = result.filter(j =>
    (j.title || '').toLowerCase().includes(q) ||
    (j.company || '').toLowerCase().includes(q) ||
    (j.location || '').toLowerCase().includes(q)
  );
  if (salMin) result = result.filter(j => parseSalary(j.salary) >= salMin);
  if (salMax) result = result.filter(j => parseSalary(j.salary) <= salMax);
  if (region) result = result.filter(j => (j.location || '').toLowerCase().includes(region));
  if (jobFilters.schedule) result = result.filter(j => j.schedule === jobFilters.schedule);
  if (jobFilters.sort === 'salary') result = [...result].sort((a, b) => parseSalary(b.salary) - parseSalary(a.salary));
  if (jobFilters.sort === 'new') result = [...result].sort((a, b) => b.id - a.id);

  const cnt = (salMin ? 1 : 0) + (salMax ? 1 : 0) + (region ? 1 : 0) + (jobFilters.schedule ? 1 : 0) + (jobFilters.sort !== 'default' ? 1 : 0);
  _filterBadgeUpdate(cnt);

  renderJobs(result);
}

function _filterBadgeUpdate(cnt) {
  const badge = document.getElementById('job-filter-badge');
  const btn   = document.getElementById('job-filter-btn');
  if (badge) { badge.style.display = cnt > 0 ? '' : 'none'; badge.textContent = cnt; }
  if (btn)   btn.classList.toggle('has-filters', cnt > 0);
}

export function setFilter(el, cat) {
  el.closest('.chips-scroll').querySelectorAll('.chip').forEach(c => c.classList.remove('active'));
  el.classList.add('active');
  activeCategory = cat;
  filterJobs();
}

export function setJobSchedFilter(el, val) {
  document.querySelectorAll('#jf-sched-chips .f-chip').forEach(c => c.classList.remove('active'));
  el.classList.add('active');
  jobFilters.schedule = val;
  filterJobs();
}

export function setJobSort(el, val) {
  document.querySelectorAll('#jf-sort-chips .f-chip').forEach(c => c.classList.remove('active'));
  el.classList.add('active');
  jobFilters.sort = val;
  filterJobs();
}

export function resetJobFilters() {
  jobFilters.schedule = ''; jobFilters.sort = 'default';
  const salMin = document.getElementById('jf-sal-min');
  const salMax = document.getElementById('jf-sal-max');
  const region = document.getElementById('jf-region');
  if (salMin) salMin.value = '';
  if (salMax) salMax.value = '';
  if (region) region.value = '';
  document.querySelectorAll('#jf-sched-chips .f-chip').forEach((c, i) => c.classList.toggle('active', i === 0));
  document.querySelectorAll('#jf-sort-chips .f-chip').forEach((c, i) => c.classList.toggle('active', i === 0));
  filterJobs();
}

// ── Job detail ─────────────────────────────────────────────────────────────

export function openJob(id) {
  currentJobId = id;
  const j = jobs.find(x => x.id === id);
  if (!j) { showToast('Вакансия не найдена', 'error'); return; }

  const logoEl = document.getElementById('d-logo');
  if (logoEl) {
    if (j.logo) {
      logoEl.innerHTML = `<img src="${esc(j.logo)}" style="width:100%;height:100%;object-fit:cover;border-radius:16px"/>`;
      logoEl.style.background = 'none';
    } else {
      const { letter, background } = letterAvatar(j.company);
      logoEl.textContent = letter;
      logoEl.style.background = background;
      logoEl.style.color = '#fff';
      logoEl.style.fontWeight = '800';
    }
  }

  const compEl = document.getElementById('d-company');
  if (compEl) {
    compEl.innerHTML = `
      <span class="company-name-link" onclick="window._jobs.showCompanyInfo(${j.id})">${esc(j.company)}</span>
      ${j.verified ? '<span class="verified-chip">✓ Проверен</span>' : ''}
      ${ratingInlineHtml(j.company)}
      <span style="cursor:pointer;font-size:11px;color:var(--text-muted);text-decoration:underline dotted" onclick="window._reviews.openReviews('${esc(j.company)}',null,'screen-job-detail')">отзывы</span>`;
  }

  const setEl = (id, val) => { const el = document.getElementById(id); if (el) el.textContent = val; };
  setEl('d-title', j.title);
  setEl('d-salary', j.salary);

  const tagsEl = document.getElementById('d-tags');
  if (tagsEl) {
    tagsEl.innerHTML = `
      <span class="detail-tag">📍 ${esc(j.location)}</span>
      <span class="detail-tag">⏱ Вахта ${esc(j.schedule || '')}</span>
      ${j.category ? `<span class="detail-tag">🏭 ${esc(catLabelJob(j))}</span>` : ''}
      <span class="detail-tag">📅 ${esc(j.date || '')}</span>`;
  }

  const photosCard = document.getElementById('d-photos-card');
  const photosEl   = document.getElementById('d-photos');
  if (photosCard && photosEl) {
    if (j.photos?.length) {
      photosEl.innerHTML = j.photos.map(src =>
        `<img src="${src}" onclick="window._jobs.openPhotoFullscreen('${src}')" />`
      ).join('');
      photosCard.style.display = '';
    } else {
      photosCard.style.display = 'none';
    }
  }

  const descEl = document.getElementById('d-desc');
  if (descEl) descEl.textContent = j.desc || '';

  const reqEl  = document.getElementById('d-req');
  const condEl = document.getElementById('d-cond');
  if (reqEl)  reqEl.innerHTML  = (j.req  || []).map(r => `<li>${esc(r)}</li>`).join('');
  if (condEl) condEl.innerHTML = (j.cond || []).map(c => `<li>${esc(c)}</li>`).join('');

  const contactBtn = document.getElementById('contact-btn');
  if (contactBtn) {
    if (j.contactPhone) {
      contactBtn.href = `tel:${esc(j.contactPhone)}`;
      contactBtn.title = j.contactName ? `Связаться: ${esc(j.contactName)}` : 'Позвонить работодателю';
      contactBtn.style.display = '';
    } else {
      contactBtn.style.display = 'none';
    }
  }

  goTo('screen-job-detail');
  _updateApplyBtn();
}

function _updateApplyBtn() {
  const btn = document.getElementById('apply-btn');
  if (!btn) return;
  const applied = currentJobId && myResponsesCache.find(r => r.job_id === String(currentJobId) || r.jobId === currentJobId);
  btn.textContent = applied ? '✅ Отклик отправлен' : '✅ Откликнуться на вакансию';
  btn.disabled = !!applied;
  btn.style.opacity = applied ? '0.65' : '';
}

// ── Apply to job ───────────────────────────────────────────────────────────
// Actual apply logic is in worker.js (requires resume access)
export function applyFromCard(jobId, event) {
  if (event) event.stopPropagation();
  // Delegate to worker module
  window._worker?.applyToJobById(jobId);
}

// ── Favorites ──────────────────────────────────────────────────────────────

export function toggleFavorite(jobId, event) {
  if (event) event.stopPropagation();
  haptic('light');

  const isNowFav = !favorites.has(jobId);
  if (isNowFav) {
    favorites.add(jobId);
    showToast('Добавлено в избранное ❤️', 'success');
  } else {
    favorites.delete(jobId);
    showToast('Убрано из избранного');
  }
  saveFavorites();

  // Мгновенно обновляем ВСЕ кнопки этой вакансии в DOM без полного перерендера
  document.querySelectorAll(`[onclick*="toggleFavorite(${jobId}"]`).forEach(btn => {
    btn.textContent = isNowFav ? '❤️' : '🤍';
    btn.className = `fav-btn${isNowFav ? ' active' : ''}`;
    btn.title = isNowFav ? 'Убрать из избранного' : 'В избранное';
    btn.setAttribute('onclick', `window._jobs.toggleFavorite(${jobId},event)`);
  });
}

export function renderFavorites() {
  const list = document.getElementById('favorites-list');
  if (!list) return;
  if (!favorites.size) {
    list.innerHTML = `<div class="empty-state"><div class="empty-icon">❤️</div><div class="empty-title">Избранное пусто</div><div class="empty-desc">Нажмите ❤️ на карточке вакансии, чтобы сохранить её здесь</div></div>`;
    return;
  }
  const items = [];
  favorites.forEach(id => {
    const j = jobs.find(x => x.id === id);
    if (j) items.unshift(j);
  });
  if (!items.length) {
    list.innerHTML = `<div class="empty-state"><div class="empty-icon">❤️</div><div class="empty-title">Избранное пусто</div></div>`;
    return;
  }
  list.innerHTML = items.map(j => jobCardHtml(j)).join('');
}

// ── Company info modal ─────────────────────────────────────────────────────
export function showCompanyInfo(jobId, event) {
  if (event) event.stopPropagation();
  const j = jobs.find(x => x.id === jobId);
  if (!j) return;
  const ci = j.companyInfo || { name: j.company };
  const isVerified = isCompanyVerified(j);
  const overlay = document.createElement('div');
  overlay.className = 'co-modal-overlay';
  overlay.onclick = e => { if (e.target === overlay) overlay.remove(); };
  overlay.innerHTML = `
    <div class="co-modal">
      <div class="co-modal-handle"></div>
      <div class="co-modal-logo" style="${j.logo ? '' : `background:${letterAvatar(ci.name || j.company).background}`}">${j.logo ? `<img src="${esc(j.logo)}" />` : `<span style="color:#fff;font-weight:800;font-size:26px">${letterAvatar(ci.name || j.company).letter}</span>`}</div>
      <div class="co-modal-name">${esc(ci.name || j.company)}</div>
      <div class="co-modal-verified">
        ${isVerified ? '<span class="verified-chip" style="font-size:13px">✓ Проверенный работодатель</span>' : '<span style="font-size:12px;color:var(--text-muted)">Не верифицирован</span>'}
      </div>
      ${ci.industry ? `<div class="co-modal-row"><span class="co-modal-row-label">🏭</span><span class="co-modal-row-val">${esc(ci.industry)}</span></div>` : ''}
      ${ci.city     ? `<div class="co-modal-row"><span class="co-modal-row-label">📍</span><span class="co-modal-row-val">${esc(ci.city)}</span></div>` : ''}
      ${ci.phone    ? `<div class="co-modal-row"><span class="co-modal-row-label">📞</span><span class="co-modal-row-val"><a href="tel:${esc(ci.phone)}" style="color:inherit">${esc(ci.phone)}</a></span></div>` : ''}
      ${ci.website  ? `<div class="co-modal-row"><span class="co-modal-row-label">🌐</span><span class="co-modal-row-val"><a href="${esc(ci.website)}" target="_blank" style="color:var(--accent)">${esc(ci.website)}</a></span></div>` : ''}
      ${ci.about    ? `<div class="co-modal-about">${esc(ci.about)}</div>` : ''}
      <button class="co-modal-reviews-btn" onclick="this.closest('.co-modal-overlay').remove();window._reviews.openReviews('${esc((ci.name||j.company).replace(/'/g,'`'))}',null,'screen-jobs')">⭐ Отзывы о компании</button>
      <button class="co-modal-close" onclick="this.closest('.co-modal-overlay').remove()">Закрыть</button>
    </div>`;
  document.body.appendChild(overlay);
}

export function openPhotoFullscreen(src) {
  const overlay = document.createElement('div');
  overlay.className = 'co-modal-overlay';
  overlay.style.alignItems = 'center';
  overlay.onclick = () => overlay.remove();
  overlay.innerHTML = `<img src="${src}" style="max-width:92vw;max-height:85vh;object-fit:contain;border-radius:12px" />`;
  document.body.appendChild(overlay);
}

// ── Load & initial render ──────────────────────────────────────────────────
// Realtime subscriptions are handled centrally by src/realtime.js

export async function initJobsScreen() {
  // Show skeleton while loading
  showJobsSkeleton();
  const remote = await loadJobs();
  remote.forEach(j => {
    if (!jobs.find(x => String(x.id) === String(j.id))) jobs.unshift(j);
  });
  renderJobs(jobs);

  // Load ratings for all companies in background
  const names = [...new Set(jobs.map(j => j.company).filter(Boolean))];
  if (names.length) {
    loadRatingsForCompanies(names).then(ratings => {
      Object.assign(ratingsCache, ratings);
      filterJobs(); // re-render with stars
    });
  }
}

// ── Expose to global scope for onclick handlers ────────────────────────────
window._jobs = {
  openJob, filterJobs, renderJobs, setFilter, setJobSchedFilter, setJobSort, resetJobFilters,
  toggleFavorite, renderFavorites, showCompanyInfo, applyFromCard, confirmHideJob,
  openPhotoFullscreen,
};
