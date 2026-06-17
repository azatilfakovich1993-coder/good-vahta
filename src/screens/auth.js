/**
 * Web entry — role selection only, no email/password registration.
 * Role (employer/worker) is saved in the session; new users without
 * a profile yet are sent straight to fill it in (company / resume).
 */
import { setWebSession } from '../platform/index.js';
import { goTo } from '../router.js';
import { PLATFORM } from '../platform/index.js';
import { companyProfile, resumes } from '../store/index.js';

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
  const guestId = 'guest_' + crypto.randomUUID().slice(0, 8);
  setWebSession({ id: guestId, firstName: '', email: null, role, username: null, photoUrl: null });
  _renderHomeCabinet(role);

  // New user without a profile yet — send straight to fill it in.
  if (role === 'employer' && !companyProfile?.name) {
    goTo('screen-company-profile');
  } else if (role === 'worker' && resumes.length === 0) {
    goTo('screen-create-resume');
  } else {
    _redirectByRole(role);
  }
};

function _getWebSession() {
  try { return JSON.parse(localStorage.getItem('vahta_web_session') || 'null'); } catch { return null; }
}

window._auth._renderHomeCabinet = _renderHomeCabinet;
