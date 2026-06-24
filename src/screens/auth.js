/**
 * Web entry — role selection only, no email/password registration.
 * Role (employer/worker) is saved in the session; new users without
 * a profile yet are sent straight to fill it in (company / resume).
 * A device can hold several employer profiles — picked via screen-company-select.
 */
import { setWebSession } from '../platform/index.js';
import { goTo } from '../router.js';
import { PLATFORM } from '../platform/index.js';
import {
  companyProfile, companyProfiles, resumes,
  selectCompanyProfile, clearActiveCompanyProfile,
} from '../store/index.js';
import { esc, letterAvatar } from '../utils.js';

// ── Redirect by role ───────────────────────────────────────────────────────

function _redirectByRole(role) {
  if (role === 'employer') {
    goTo('screen-employer');
  } else {
    goTo('screen-worker');
  }
  // Render home cabinet for when user navigates back to home
  _renderHomeCabinet(role);
}

export function _renderHomeCabinet(role) {
  const el = document.getElementById('home-cabinet');
  if (!el) return;
  if (role === 'employer') {
    el.innerHTML = `
      <div class="home-cabinet-card">
        <div class="hcc-icon">🏗️</div>
        <div class="hcc-body">
          <div class="hcc-title">Кабинет работодателя</div>
          <div class="hcc-desc">Управление вакансиями и откликами</div>
        </div>
        <button class="hcc-btn" onclick="goTo('screen-employer')">Открыть →</button>
      </div>
      <div class="mgr-entry-link" onclick="goTo('screen-manager-join')" style="margin-top:12px">
        🔑 Войти как менеджер компании
      </div>`;
  } else {
    el.innerHTML = `
      <div class="home-cabinet-card">
        <div class="hcc-icon">👷</div>
        <div class="hcc-body">
          <div class="hcc-title">Кабинет соискателя</div>
          <div class="hcc-desc">Резюме, отклики и рекомендации</div>
          <div class="hcc-badges">
            <span class="hcc-inv-badge inv-badge-el" style="display:none"></span>
          </div>
        </div>
        <button class="hcc-btn" onclick="goTo('screen-worker')">Открыть →</button>
      </div>`;
  }
}

// ── Init ───────────────────────────────────────────────────────────────────

export function initAuthScreen() {
  if (PLATFORM !== 'web') return;
  const session = _getWebSession();
  if (session?.id) {
    _renderHomeCabinet(session.role || 'worker');
    _redirectByRole(session.role || 'worker');
    return;
  }
  _showRolePicker();
}

function _showRolePicker() {
  const cabinet = document.getElementById('home-cabinet');
  if (!cabinet) return;
  cabinet.innerHTML = `
    <div class="role-grid" style="margin-bottom:8px">
      <div class="role-card worker" onclick="window._auth._pickRole('worker')">
        <div class="icon-wrap">👷</div>
        <div class="label">Соискатель</div>
        <div class="desc">Ищу вахтовую работу</div>
      </div>
      <div class="role-card employer" onclick="window._auth._pickRole('employer')">
        <div class="icon-wrap">🏗️</div>
        <div class="label">Работодатель</div>
        <div class="desc">Размещаю вакансии</div>
      </div>
    </div>
    <div class="mgr-entry-link" onclick="goTo('screen-manager-join')" style="margin-top:8px;text-align:center;font-size:13px;color:var(--text-muted);cursor:pointer;padding:8px">
      🔑 Войти как менеджер (есть код компании)
    </div>
  `;
}

window._auth = window._auth || {};
window._auth._pickRole = function(role) {
  // Reuse the existing device identity if there is one — minting a fresh
  // guestId here would orphan whatever this device already saved to
  // Supabase under the old id (resumes, etc.) every time the user just
  // switches roles or comes back from softExit().
  const existing = _getWebSession();
  const id = existing?.id || ('guest_' + crypto.randomUUID().slice(0, 8));
  setWebSession({
    id,
    firstName: existing?.firstName || '',
    email: existing?.email || null,
    role,
    username: existing?.username || null,
    photoUrl: existing?.photoUrl || null,
  });
  _renderHomeCabinet(role);

  if (role === 'employer') {
    if (companyProfiles.length > 0) {
      goTo('screen-company-select');
      renderCompanySelectList();
    } else {
      goTo('screen-company-profile');
    }
  } else if (resumes.length === 0) {
    goTo('screen-create-resume');
  } else {
    _redirectByRole(role);
  }
};

// ── Company select (switch between employer profiles on this device) ──────

export function renderCompanySelectList() {
  const list = document.getElementById('company-select-list');
  if (!list) return;
  const cards = companyProfiles.map(c => {
    const { letter, background } = letterAvatar(c.name);
    return `
      <div class="cs-card" onclick="window._auth._selectCompany('${esc(c.code)}')">
        <div class="cs-card-avatar" style="${c.logo ? '' : `background:${background}`}">
          ${c.logo ? `<img src="${esc(c.logo)}" />` : letter}
        </div>
        <div>
          <div class="cs-card-name">${esc(c.name)}</div>
          <div class="cs-card-sub">${esc(c.city || '')}</div>
        </div>
        <span class="cs-card-arrow">›</span>
      </div>`;
  }).join('');
  list.innerHTML = cards + `
    <div class="cs-card cs-card--add" onclick="window._auth._addNewCompany()">
      <div class="cs-card-name">+ Новая компания</div>
    </div>`;
}

window._auth._selectCompany = function(code) {
  selectCompanyProfile(code);
  goTo('screen-employer');
  _renderHomeCabinet('employer');
};

window._auth._addNewCompany = function() {
  clearActiveCompanyProfile();
  goTo('screen-company-profile');
};

/** Soft exit — back to the role picker, keeps all saved profiles/resumes intact. */
export function softExit() {
  goTo('screen-home');
  _showRolePicker();
}
window._auth.softExit = softExit;

function _getWebSession() {
  try { return JSON.parse(localStorage.getItem('vahta_web_session') || 'null'); } catch { return null; }
}

window._auth._renderHomeCabinet = _renderHomeCabinet;
