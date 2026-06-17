/**
 * Miscellaneous screens: profile, notifications, referral, resume DB, invitations.
 */
import { goTo } from '../router.js';
import { showToast } from '../components/toast.js';
import { esc, catLabelResume, fmtNum } from '../utils.js';
import { setUserProfile, userProfile, resumeDbData, notifSettings, setNotifSettings, setTheme, theme, myJobs, companyProfile } from '../store/index.js';
import { getPlatformUser, shareText, PLATFORM } from '../platform/index.js';
import { sb } from '../api/supabase.js';
import { saveInvitation, loadInvitationsForEmployer } from '../api/invitations.js';
import { sendTgMessage } from '../api/notifications.js';

// ── Theme ──────────────────────────────────────────────────────────────────

export function toggleTheme() {
  const next = theme === 'dark' ? 'light' : 'dark';
  setTheme(next);
  const icon = document.getElementById('theme-icon');
  if (icon) icon.textContent = next === 'dark' ? '🌙' : '☀️';
}

// ── Profile screen ─────────────────────────────────────────────────────────

export function openProfileScreen() {
  const me = getPlatformUser();
  const tgHandle = document.getElementById('prof-tg-handle');
  if (tgHandle) tgHandle.textContent = me.username ? `@${me.username}` : '';

  if (userProfile) {
    const setEl = (id, val) => { const el = document.getElementById(id); if (el) el.value = val || ''; };
    setEl('prof-name',  userProfile.name);
    setEl('prof-phone', userProfile.phone);
    setEl('prof-city',  userProfile.city);
    setEl('prof-about', userProfile.about);
    const aboutEl = document.getElementById('prof-about');
    if (aboutEl) aboutEl.dispatchEvent(new Event('input'));
  } else if (me.firstName) {
    const nameEl = document.getElementById('prof-name');
    if (nameEl && !nameEl.value) nameEl.value = [me.firstName, me.lastName].filter(Boolean).join(' ');
  }
  document.getElementById('prof-form-wrap').style.display = '';
  document.getElementById('prof-success').classList.remove('active');
  goTo('screen-profile');
}

export function saveProfile() {
  const name  = document.getElementById('prof-name').value.trim();
  const phone = document.getElementById('prof-phone').value.trim();
  if (!name)  { shakeFocus('prof-name');  showToast('Введите имя', 'error'); return; }
  if (!phone) { shakeFocus('prof-phone'); showToast('Введите телефон', 'error'); return; }

  const updated = {
    name, phone,
    city:  document.getElementById('prof-city')?.value.trim()  || '',
    about: document.getElementById('prof-about')?.value.trim() || '',
  };
  setUserProfile(updated);
  document.getElementById('prof-form-wrap').style.display = 'none';
  document.getElementById('prof-success').classList.add('active');
  showToast('Профиль сохранён ✅', 'success');
}

// ── Notifications screen ───────────────────────────────────────────────────

export function openNotifScreen() {
  const s = notifSettings;
  const setToggle = (id, val) => {
    const el = document.getElementById(id);
    if (el) el.checked = !!val;
  };
  setToggle('notif-new-jobs', s.newJobs);
  setToggle('notif-responses', s.responses);
  setToggle('notif-chat',    s.chat);
}

export function saveNotifSettings() {
  setNotifSettings({
    newJobs:   document.getElementById('notif-new-jobs')?.checked ?? true,
    responses: document.getElementById('notif-responses')?.checked ?? true,
    chat:      document.getElementById('notif-chat')?.checked ?? true,
  });
  showToast('Настройки сохранены', 'success');
}

// ── Referral ───────────────────────────────────────────────────────────────


// ── Resume DB ──────────────────────────────────────────────────────────────

let rdbCatFilter = 'all';
let rdbActiveOnly = false;
let _sentInvitationKeys = new Set(); // worker_key values already invited by this employer

/** Load which candidates already received invitations from this employer. */
export async function loadSentInvitationKeys() {
  _sentInvitationKeys.clear();
  if (!companyProfile?.name) return;
  const invs = await loadInvitationsForEmployer(companyProfile.name);
  invs.forEach(inv => {
    if (inv.worker_key) _sentInvitationKeys.add(inv.worker_key);
    if (inv.candidate_telegram) _sentInvitationKeys.add(inv.candidate_telegram);
    if (inv.candidate_phone)    _sentInvitationKeys.add(inv.candidate_phone);
  });
}

export function filterResumeDb() {
  const q = (document.getElementById('rdb-search')?.value || '').toLowerCase().trim();
  let result = [...resumeDbData];
  if (rdbCatFilter !== 'all') result = result.filter(r => r.category === rdbCatFilter);
  if (rdbActiveOnly) result = result.filter(r => r.status?.open);
  if (q) result = result.filter(r =>
    (r.name || '').toLowerCase().includes(q) ||
    (r.specialty || '').toLowerCase().includes(q) ||
    (r.region || '').toLowerCase().includes(q)
  );
  _renderResumeDb(result);
}

export function setRdbCatFilter(el, cat) {
  el.closest('.chips-scroll').querySelectorAll('.chip').forEach(c => c.classList.remove('active'));
  el.classList.add('active');
  rdbCatFilter = cat;
  filterResumeDb();
}

export function toggleRdbActive(checked) {
  rdbActiveOnly = checked;
  filterResumeDb();
}

function _renderResumeDb(list) {
  const c = document.getElementById('rdb-list');
  if (!c) return;
  if (!list.length) {
    c.innerHTML = `<div class="empty-state"><div class="empty-icon">👷</div><div class="empty-title">Соискателей не найдено</div></div>`;
    return;
  }
  c.innerHTML = list.map((r, i) => {
    const avatarHtml = r.photo
      ? `<div class="rc-avatar" style="background:none;padding:0;overflow:hidden"><img src="${esc(r.photo)}" style="width:100%;height:100%;object-fit:cover;border-radius:14px" /></div>`
      : `<div class="rc-avatar">${r.gender === 'Ж' ? '👩' : '👷'}</div>`;
    const candidateKey = r.telegram || r.phone || '';
    const alreadyInvited = candidateKey && _sentInvitationKeys.has(candidateKey);
    const inviteBtn = alreadyInvited
      ? `<button class="rc-btn-invite rc-btn-invited" disabled>✅ Приглашён</button>`
      : `<button class="rc-btn-invite" onclick="window._misc.openInviteModal(window._misc._getCandidateByIndex(${i}))">✉️ Пригласить</button>`;
    return `
      <div class="resume-card${alreadyInvited ? ' rc-already-invited' : ''}">
        <div class="rc-header">${avatarHtml}<div><div class="rc-name">${esc(r.name || '')}</div><div class="rc-spec">${esc(r.specialty || '')}</div></div>${alreadyInvited ? '<span class="rc-invited-badge">✅ Приглашён</span>' : ''}</div>
        <div class="rc-meta">
          ${r.salary ? `<span class="rc-tag">💰 от ${fmtNum(r.salary)} ₽</span>` : ''}
          <span class="rc-tag">📍 ${esc(r.region || '')}</span>
          ${r.category ? `<span class="rc-tag">🗂 ${esc(catLabelResume(r))}</span>` : ''}
          ${r.exp ? `<span class="rc-tag">⏳ ${esc(r.exp)}</span>` : ''}
        </div>
        <div class="rc-actions">
          ${r.phone    ? `<a class="rc-btn-edit" href="tel:${esc(r.phone)}">📞 Позвонить</a>` : ''}
          ${r.telegram ? `<a class="rc-btn-edit" href="https://t.me/${esc(r.telegram)}" target="_blank">✈️ Telegram</a>` : ''}
          <button class="rc-btn-view" onclick="window._misc.openCandidateProfile(${i})">👁 Профиль</button>
          ${inviteBtn}
        </div>
      </div>`;
  }).join('');
}

export function _getCandidateByIndex(i) {
  const r = resumeDbData[i];
  if (!r) return {};
  return { name: r.name, telegram: r.telegram, phone: r.phone, workerChatId: r.workerChatId || null };
}

export function openCandidateProfile(i) {
  const r = resumeDbData[i];
  if (!r) return;
  _invCandidate = { name: r.name, telegram: r.telegram, phone: r.phone, workerChatId: r.workerChatId || null };
  _fillCandidateDetail(r);
  goTo('screen-candidate-detail');
}

function _fillCandidateDetail(r) {
  const setText = (id, val) => { const el = document.getElementById(id); if (el) el.textContent = val || '—'; };
  const avatar = document.getElementById('cd-avatar');
  if (avatar) {
    avatar.innerHTML = r.photo ? `<img src="${esc(r.photo)}" alt="Фото" />` : (r.gender === 'Ж' ? '👩' : '👷');
  }
  setText('cd-name',   r.name);
  setText('cd-spec',   r.specialty);
  setText('cd-salary', `от ${fmtNum(r.salary || 0)} ₽/мес`);
  setText('cd-region', r.region);
  setText('cd-exp',    r.exp);
  setText('cd-gender', r.gender === 'М' ? 'Мужской' : r.gender === 'Ж' ? 'Женский' : '—');
  const aboutCard = document.getElementById('cd-about-card');
  const aboutEl   = document.getElementById('cd-about');
  if (aboutCard) aboutCard.style.display = r.about ? '' : 'none';
  if (aboutEl && r.about) aboutEl.textContent = r.about;
  const wrap = document.getElementById('cd-contact-wrap');
  if (wrap) {
    wrap.innerHTML =
      (r.phone    ? `<a class="cand-contact-btn" href="tel:${esc(r.phone)}">📞 ${esc(r.phone)}</a>` : '') +
      (r.telegram ? `<a class="cand-contact-btn" style="background:linear-gradient(135deg,#2196F3,#21CBF3)" href="https://t.me/${esc(r.telegram)}" target="_blank">✈️ @${esc(r.telegram)}</a>` : '');
  }
}

// ── Char counter ───────────────────────────────────────────────────────────

export function updateChar(inputId, counterId, max) {
  const el = document.getElementById(inputId);
  const cnt = document.getElementById(counterId);
  if (!el || !cnt) return;
  const len = el.value.length;
  cnt.textContent = `${len}/${max}`;
  cnt.className = `char-count ${len > max ? 'over' : len > max * 0.85 ? 'warn' : ''}`;
  if (el.tagName === 'TEXTAREA') {
    el.style.height = 'auto';
    el.style.height = el.scrollHeight + 'px';
  }
}

// ── Helpers ────────────────────────────────────────────────────────────────

function shakeFocus(id) {
  const el = document.getElementById(id);
  if (!el) return;
  el.classList.add('error'); el.focus();
  setTimeout(() => el.classList.remove('error'), 1400);
}

// ── Logout ─────────────────────────────────────────────────────────────────

export async function logout() {
  const confirmed = window.confirm('Выйти из аккаунта?');
  if (!confirmed) return;

  // Sign out from Supabase
  if (sb && PLATFORM === 'web') {
    try { await sb.auth.signOut(); } catch {}
  }

  // Clear all local session data
  const keysToKeep = ['vahta_theme']; // keep theme preference
  const allKeys = Object.keys(localStorage);
  allKeys.forEach(k => {
    if (!keysToKeep.includes(k)) localStorage.removeItem(k);
  });

  showToast('Вы вышли из аккаунта');
  // Redirect to auth screen
  setTimeout(() => { location.reload(); }, 700);
}

// ── Invite candidate ───────────────────────────────────────────────────────

let _invCandidate = null; // { name, telegram, phone }

export function openInviteModal(candidate) {
  _invCandidate = candidate;

  // Fill job selector
  const sel = document.getElementById('inv-job-select');
  if (sel) {
    const published = myJobs.filter(j => j.status !== 'paused');
    sel.innerHTML = '<option value="">— Выберите вакансию —</option>' +
      published.map((j, i) => `<option value="${i}">${esc(j.title)}${j.location ? ' · ' + esc(j.location) : ''}</option>`).join('');
  }

  // Show/hide TG button
  const tgBtn = document.getElementById('inv-tg-btn');
  if (tgBtn) tgBtn.style.display = candidate.telegram ? '' : 'none';

  // Reset message
  const ta = document.getElementById('inv-message');
  if (ta) { ta.value = ''; updateInviteCharCount(); }

  document.getElementById('modal-invite').style.display = 'flex';
}

export function openInviteModalForCandidate() {
  // Called from candidate detail screen — _invCandidate already set by openCandidateProfile or _setInvCandidate
  if (_invCandidate) openInviteModal(_invCandidate);
}

export function _setInvCandidate(candidate) {
  _invCandidate = candidate;
}

export function closeInviteModal() {
  document.getElementById('modal-invite').style.display = 'none';
}

export function updateInviteTemplate() {
  const sel = document.getElementById('inv-job-select');
  if (!sel || !sel.value) return;
  const idx = parseInt(sel.value);
  const job = myJobs.filter(j => j.status !== 'paused')[idx];
  if (!job) return;

  const company = companyProfile?.name || 'наша компания';
  const salary  = job.salary || '';
  const loc     = job.location || '';

  const template =
`Здравствуйте, ${_invCandidate?.name ? _invCandidate.name.split(' ')[0] : ''}!

Меня зовут представитель компании «${company}». Мы ознакомились с вашим резюме и хотели бы пригласить вас на вакансию:

📋 ${job.title}${loc ? '\n📍 ' + loc : ''}${salary ? '\n💰 ' + salary : ''}

Мы готовы обсудить подробности и ответить на ваши вопросы. Пожалуйста, свяжитесь с нами или ответьте на это сообщение, если вам интересно предложение.

С уважением,
${company}`;

  const ta = document.getElementById('inv-message');
  if (ta) { ta.value = template; updateInviteCharCount(); }
}

export function updateInviteCharCount() {
  const ta  = document.getElementById('inv-message');
  const cnt = document.getElementById('inv-char-count');
  if (!ta || !cnt) return;
  const len = ta.value.length;
  cnt.textContent = `${len}/800`;
  cnt.className = `char-count ${len > 800 ? 'over' : len > 680 ? 'warn' : ''}`;
}

export async function sendInvitation() {
  const sel = document.getElementById('inv-job-select');
  const msg = document.getElementById('inv-message')?.value.trim();
  const btn = document.getElementById('inv-send-btn');

  if (!sel?.value) { showToast('Выберите вакансию', 'error'); return; }
  if (!msg)        { showToast('Напишите сообщение', 'error'); return; }

  const idx = parseInt(sel.value);
  const job = myJobs.filter(j => j.status !== 'paused')[idx];
  if (!job) return;

  if (btn) { btn.disabled = true; btn.textContent = '⏳ Отправляю...'; }

  const inv = {
    employer_name:      companyProfile?.name || '',
    company_name:       companyProfile?.name || '',
    employer_phone:     companyProfile?.phone    || '',
    employer_telegram:  companyProfile?.telegram || '',
    job_title:          job.title,
    job_id:             job.id || String(idx),
    message:            msg,
    candidate_name:     _invCandidate?.name || '',
    candidate_telegram: _invCandidate?.telegram || '',
    candidate_phone:    _invCandidate?.phone || '',
    worker_key:         _invCandidate?.telegram || _invCandidate?.phone || '',
    status:             'pending',
  };

  const saved = await saveInvitation(inv);

  // Also send via Telegram if candidate has TG and we're on TG platform
  if (_invCandidate?.telegram && PLATFORM === 'telegram' && _invCandidate?.workerChatId) {
    try {
      await sendTgMessage(
        _invCandidate.workerChatId,
        `📨 <b>Приглашение на вакансию!</b>\n\n<b>${esc(job.title)}</b> — ${esc(companyProfile?.name || '')}\n\n${msg}\n\nОткройте Good_Вахта → Приглашения`
      );
    } catch {}
  }

  if (btn) { btn.disabled = false; btn.textContent = '📲 Отправить в приложении'; }

  if (saved) {
    // Mark this candidate as invited so the badge appears immediately
    const key = _invCandidate?.telegram || _invCandidate?.phone || '';
    if (key) _sentInvitationKeys.add(key);
    showToast('✅ Приглашение отправлено!', 'success');
    closeInviteModal();
    filterResumeDb(); // re-render to show "Приглашён" badge
  } else {
    showToast('Ошибка отправки. Скопируйте текст вручную.', 'error');
  }
}

export function copyInviteText() {
  const msg = document.getElementById('inv-message')?.value;
  if (!msg) { showToast('Сообщение пусто', 'error'); return; }
  navigator.clipboard?.writeText(msg);
  showToast('Текст скопирован 📋');
}

export function openInviteTelegram() {
  const msg = document.getElementById('inv-message')?.value || '';
  const tg  = _invCandidate?.telegram;
  if (!tg) return;
  const encoded = encodeURIComponent(msg);
  window.open(`https://t.me/${tg}?text=${encoded}`, '_blank');
}

window._misc = {
  toggleTheme, openProfileScreen, saveProfile, logout,
  openNotifScreen, saveNotifSettings,
  filterResumeDb, setRdbCatFilter, toggleRdbActive, openCandidateProfile, loadSentInvitationKeys,
  updateChar,
  openInviteModal, openInviteModalForCandidate, closeInviteModal, _setInvCandidate,
  updateInviteTemplate, updateInviteCharCount,
  sendInvitation, copyInviteText, openInviteTelegram,
  _getCandidateByIndex,
};
