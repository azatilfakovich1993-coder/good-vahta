/**
 * Worker screen logic — resumes, applications, recommendations, status.
 *
 * Bug fixes:
 *  - applyToJob now checks if worker has a resume and prompts to create one if missing
 *  - Applications are saved to Supabase (job_responses table), not just localStorage
 *  - Photo stored only in localStorage (not in Supabase), avoiding quota/size issues
 */
import { goTo } from '../router.js';
import { showToast } from '../components/toast.js';
import {
  resumes, myResponsesCache, jobs, resumeDbData,
  workerStatus, saveResumes, saveMyResponsesCache, setWorkerStatus,
} from '../store/index.js';
import { esc, compressImage, catLabelResume, todayRu, fmtNum, parseSalaryStr } from '../utils.js';
import { saveResume, deleteResume as deleteResumeDb, loadPublicResumes } from '../api/resumes.js';
import { submitResponse, loadMyResponses } from '../api/responses.js';
import { notifyNewResponse } from '../api/notifications.js';
import { loadInvitationsForWorker, markInvitationViewed, updateInvitationStatus } from '../api/invitations.js';
import { getPlatformUser } from '../platform/index.js';
import { haptic } from '../platform/index.js';

const MAX_RESUMES = 3;

// ── Resume edit state ──────────────────────────────────────────────────────
let crEditIndex   = null;
let crGender      = '';
let crExp         = '';
let crCitizen     = '';
let crPhoto       = '';
let crCategory    = '';
let crWorkRegions = []; // multi-select array

// ── Worker status ──────────────────────────────────────────────────────────
export function initWorkerStatusUI() {
  const s = workerStatus;
  const dot   = document.getElementById('ws-dot');
  const label = document.getElementById('ws-label');
  const sub   = document.getElementById('ws-sub');
  const tog   = document.getElementById('ws-toggle');
  if (!dot) return;

  dot.className   = `status-dot ${s.open ? 'active' : 'inactive'}`;
  label.textContent = s.open ? 'В поиске работы' : 'Не ищу работу';
  sub.textContent   = s.open ? 'Работодатели видят вас в базе' : 'Вы скрыты от работодателей';
  if (tog) tog.checked = !!s.open;
}

export function toggleWorkerStatus() {
  const newStatus = { ...workerStatus, open: !workerStatus.open };
  setWorkerStatus(newStatus);
  initWorkerStatusUI();
  showToast(newStatus.open ? '✅ Вы в поиске работы!' : '🔒 Статус скрыт');

  // Update published resume statuses
  resumes.forEach(r => { r.published = newStatus.open; });
  saveResumes();
  renderResumes();

  // Sync to Supabase — id scheme must match submitResume/deleteResume ('<userId>_resume_<index>')
  const me = getPlatformUser();
  if (me.id) {
    resumes.forEach((r, i) => saveResume(r, me.id + '_resume_' + i));
  }
}

// ── Resumes ────────────────────────────────────────────────────────────────

export function renderResumes() {
  const list = document.getElementById('resume-list');
  const btn  = document.getElementById('btn-add-resume');
  const hint = document.getElementById('resume-count-hint');
  if (!list) return;

  if (btn) btn.disabled = resumes.length >= MAX_RESUMES;
  if (hint) hint.textContent = `${resumes.length} / ${MAX_RESUMES} резюме`;

  if (!resumes.length) {
    list.innerHTML = `<div class="resume-empty"><div class="resume-empty-icon">📄</div><div class="resume-empty-text">У вас ещё нет резюме.<br>Создайте первую анкету!</div></div>`;
    return;
  }

  list.innerHTML = resumes.map((r, i) => {
    const isPub = r.published !== false;
    const avatarHtml = r.photo
      ? `<div class="rc-avatar" style="background:none;padding:0;overflow:hidden"><img src="${esc(r.photo)}" style="width:100%;height:100%;object-fit:cover;border-radius:14px" /></div>`
      : `<div class="rc-avatar">${r.gender === 'Ж' ? '👩' : '👷'}</div>`;
    return `
      <div class="resume-card${isPub ? '' : ' resume-card--archived'}">
        <div class="rc-header">
          ${avatarHtml}
          <div><div class="rc-name">${esc(r.name)}</div><div class="rc-spec">${esc(r.specialty)}</div></div>
          <span class="rc-pub-badge ${isPub ? 'rc-pub-badge--active' : 'rc-pub-badge--hidden'}">${isPub ? '👁 Активно' : '📦 В архиве'}</span>
        </div>
        <div class="rc-meta">
          <span class="rc-tag">💰 от ${fmtNum(r.salary)} ₽</span>
          <span class="rc-tag">📍 ${esc(r.region)}</span>
          <span class="rc-tag">🗂 ${esc(catLabelResume(r))}</span>
          ${r.exp ? `<span class="rc-tag">⏳ ${esc(r.exp)}</span>` : ''}
        </div>
        <div class="rc-actions">
          <button class="rc-btn-edit" onclick="window._worker.openCreateResume(${i})">✏️ Редактировать</button>
          <button class="rc-btn-pub ${isPub ? 'pub-btn-hide' : 'pub-btn-show'}" onclick="window._worker.toggleResumePublished(${i})">${isPub ? '📦 В архив' : '♻️ Активировать'}</button>
          <button class="rc-btn-del" onclick="window._worker.deleteResume(${i})" title="Удалить резюме">🗑</button>
        </div>
        <button class="rc-btn-pdf" onclick="window._worker.downloadResumePDF(${i})">📄 Скачать PDF</button>
      </div>`;
  }).join('');
}

export function selectCitizenship(el, val) {
  document.querySelectorAll('.cr-citizen-chip').forEach(c => c.classList.remove('active'));
  el.classList.add('active');
  crCitizen = val;
  const wrap = document.getElementById('cr-citizen-custom-wrap');
  if (wrap) wrap.style.display = val === 'Другое' ? '' : 'none';
  if (val !== 'Другое') {
    const inp = document.getElementById('cr-citizen-custom');
    if (inp) inp.value = '';
  }
}

export function toggleWorkRegion(el, val) {
  if (val === 'Свой вариант') {
    el.classList.toggle('active');
    const wrap = document.getElementById('cr-workregion-custom-wrap');
    if (wrap) wrap.style.display = el.classList.contains('active') ? '' : 'none';
    return;
  }
  el.classList.toggle('active');
  if (el.classList.contains('active')) {
    if (!crWorkRegions.includes(val)) crWorkRegions.push(val);
  } else {
    crWorkRegions = crWorkRegions.filter(r => r !== val);
  }
}

export function selectResumeCategory(el, cat) {
  document.querySelectorAll('#cr-cat-chips .cr-cat-chip').forEach(c => c.classList.remove('active'));
  el.classList.add('active');
  crCategory = cat;
  const wrap = document.getElementById('cr-custom-cat-wrap');
  if (wrap) wrap.style.display = cat === 'other' ? '' : 'none';
  if (cat !== 'other') {
    const inp = document.getElementById('cr-custom-cat');
    if (inp) inp.value = '';
  }
}

export function openCreateResume(editIndex = null) {
  crEditIndex = editIndex !== null && editIndex !== undefined ? editIndex : null;
  crGender = ''; crExp = ''; crCitizen = ''; crPhoto = ''; crCategory = ''; crWorkRegions = [];
  resetResumeForm();
  if (crEditIndex !== null) {
    const r = resumes[crEditIndex];
    crGender      = r.gender      || '';
    crExp         = r.exp         || '';
    crCitizen     = r.citizen     || '';
    crPhoto       = r.photo       || '';
    crWorkRegions = Array.isArray(r.workRegions) ? [...r.workRegions] : [];
    _prefillResumeForm(r);
  }
  goTo('screen-create-resume');
}

function resetResumeForm() {
  ['cr-name','cr-specialty','cr-salary','cr-region','cr-telegram','cr-phone','cr-about','cr-custom-cat','cr-citizen-custom','cr-workregion-custom'].forEach(id => {
    const el = document.getElementById(id);
    if (el) el.value = '';
  });
  document.querySelectorAll('.gender-chip, .exp-chip, .cr-cat-chip, .cr-citizen-chip, .cr-workregion-chip').forEach(c => c.classList.remove('active'));
  document.getElementById('cr-custom-cat-wrap')?.style && (document.getElementById('cr-custom-cat-wrap').style.display = 'none');
  document.getElementById('cr-citizen-custom-wrap')?.style && (document.getElementById('cr-citizen-custom-wrap').style.display = 'none');
  document.getElementById('cr-workregion-custom-wrap')?.style && (document.getElementById('cr-workregion-custom-wrap').style.display = 'none');
  const photoCircle = document.getElementById('cr-photo-circle');
  if (photoCircle) photoCircle.innerHTML = '📷';
  document.getElementById('cr-form-wrap').style.display = '';
  document.getElementById('cr-success').classList.remove('active');
}

function _prefillResumeForm(r) {
  const setVal = (id, val) => { const el = document.getElementById(id); if (el) el.value = val || ''; };
  setVal('cr-name',      r.name);
  setVal('cr-specialty', r.specialty);
  setVal('cr-salary',    r.salary);
  setVal('cr-region',    r.region);
  setVal('cr-telegram',  r.telegram);
  setVal('cr-phone',     r.phone);
  setVal('cr-about',     r.about);

  if (r.gender) {
    document.querySelectorAll('.gender-chip').forEach(c => c.classList.toggle('active', c.dataset.val === r.gender));
  }
  if (r.exp) {
    document.querySelectorAll('.exp-chip').forEach(c => c.classList.toggle('active', c.dataset.val === r.exp));
  }
  if (r.category) {
    crCategory = r.category;
    const chip = document.querySelector(`#cr-cat-chips [data-cat="${r.category}"]`);
    if (chip) chip.classList.add('active');
    if (r.category === 'other') {
      const wrap = document.getElementById('cr-custom-cat-wrap');
      if (wrap) wrap.style.display = '';
      const inp = document.getElementById('cr-custom-cat');
      if (inp) inp.value = r.categoryCustom || '';
    }
  }
  if (r.citizen) {
    crCitizen = r.citizen;
    document.querySelectorAll('.cr-citizen-chip').forEach(c => {
      const matches = c.textContent.includes(r.citizen) || c.getAttribute('onclick')?.includes(`'${r.citizen}'`);
      c.classList.toggle('active', matches);
    });
    if (!['Россия','Беларусь','Казахстан','Узбекистан'].includes(r.citizen)) {
      const wrap = document.getElementById('cr-citizen-custom-wrap');
      if (wrap) wrap.style.display = '';
      const inp = document.getElementById('cr-citizen-custom');
      if (inp) inp.value = r.citizen;
    }
  }
  if (Array.isArray(r.workRegions) && r.workRegions.length) {
    crWorkRegions = [...r.workRegions];
    document.querySelectorAll('.cr-workregion-chip').forEach(chip => {
      const txt = chip.textContent.replace(/^[^\w]*/, '').trim();
      if (crWorkRegions.includes(txt)) chip.classList.add('active');
    });
    const customVal = crWorkRegions.find(v => !['Север','Ямал','Сибирь','Урал','Дальний Восток','Центральная Россия','Поволжье','Юг России','Весь СНГ'].includes(v));
    if (customVal) {
      const wrap = document.getElementById('cr-workregion-custom-wrap');
      if (wrap) wrap.style.display = '';
      const inp = document.getElementById('cr-workregion-custom');
      if (inp) inp.value = customVal;
    }
  }
  if (r.photo) {
    const circle = document.getElementById('cr-photo-circle');
    if (circle) circle.innerHTML = `<img src="${esc(r.photo)}" alt="Фото" />`;
  }
}

export async function submitResume() {
  const name     = document.getElementById('cr-name').value.trim();
  const specialty= document.getElementById('cr-specialty').value.trim();
  const salary   = document.getElementById('cr-salary').value.trim();
  const region   = document.getElementById('cr-region').value.trim();
  const telegram = document.getElementById('cr-telegram').value.trim().replace('@', '');
  const phone    = document.getElementById('cr-phone').value.trim();
  const about         = document.getElementById('cr-about').value.trim();
  const category      = crCategory || 'other';
  const categoryCustom= document.getElementById('cr-custom-cat')?.value.trim() || '';

  // Determine final citizenship value
  const citizenFinal = crCitizen === 'Другое'
    ? (document.getElementById('cr-citizen-custom')?.value.trim() || '')
    : crCitizen;

  // Collect work regions
  const customRegionVal = document.getElementById('cr-workregion-custom')?.value.trim() || '';
  const workRegions = [...crWorkRegions];
  if (customRegionVal && !workRegions.includes(customRegionVal)) workRegions.push(customRegionVal);

  if (!name)         { showFocus('cr-name');     showToast('Введите ФИО', 'error'); return; }
  if (!specialty)    { showFocus('cr-specialty'); showToast('Введите специальность', 'error'); return; }
  if (!salary)       { showFocus('cr-salary');   showToast('Введите желаемую зарплату', 'error'); return; }
  if (!region)       { showFocus('cr-region');   showToast('Введите регион', 'error'); return; }
  if (!citizenFinal) { showToast('Укажите гражданство', 'error'); return; }
  if (category === 'other' && !categoryCustom) {
    showFocus('cr-custom-cat');
    showToast('Укажите вашу отрасль', 'error');
    return;
  }

  const resume = {
    name, specialty, salary: parseInt(salary) || 0, region,
    telegram, phone, gender: crGender, exp: crExp, citizen: citizenFinal,
    workRegions, about, category, categoryCustom, photo: crPhoto,
  };

  const me = getPlatformUser();
  const id = me.id
    ? me.id + '_resume_' + (crEditIndex !== null ? crEditIndex : resumes.length)
    : 'guest_resume_' + Date.now();

  let finalResume;
  if (crEditIndex !== null) {
    // Preserve existing published/archived state — editing a resume must not
    // silently un-archive it or override the global "open to offers" toggle.
    finalResume = resumes[crEditIndex] = { ...resumes[crEditIndex], ...resume };
    showToast('Резюме обновлено ✅', 'success');
  } else {
    if (resumes.length >= MAX_RESUMES) { showToast('Максимум 3 резюме', 'error'); return; }
    resume.published = workerStatus.open !== false;
    resumes.push(resume);
    finalResume = resume;
    showToast('Резюме создано ✅', 'success');
  }
  saveResumes();
  await saveResume(finalResume, id);

  document.getElementById('cr-form-wrap').style.display = 'none';
  document.getElementById('cr-success').classList.add('active');
}

export async function deleteResume(i) {
  if (!confirm('Удалить резюме?')) return;
  const me = getPlatformUser();
  const id = me.id ? me.id + '_resume_' + i : null;
  resumes.splice(i, 1);
  saveResumes();
  if (id) await deleteResumeDb(id);
  renderResumes();
  showToast('Резюме удалено');
}

export async function toggleResumePublished(i) {
  resumes[i].published = !resumes[i].published;
  saveResumes();
  const me = getPlatformUser();
  const id = me.id ? me.id + '_resume_' + i : null;
  if (id) await saveResume(resumes[i], id);
  renderResumes();
  showToast(resumes[i].published ? '👁 Резюме открыто' : '🔒 Резюме скрыто');
}

// ── Apply to job ───────────────────────────────────────────────────────────

export async function applyToJob() {
  const id = window._jobs?.getCurrentJobId?.();
  if (!id) return;
  await applyToJobById(id);
}

export async function applyToJobById(jobId) {
  // Bug fix: always check if the worker has a resume first
  if (!resumes.length) {
    showToast('Сначала создайте резюме', 'error');
    goTo('screen-my-resumes');
    return;
  }

  const already = myResponsesCache.find(r => r.job_id === String(jobId) || r.jobId === jobId);
  if (already) { showToast('Вы уже откликнулись на эту вакансию'); return; }

  const j = jobs.find(x => x.id === jobId || String(x.id) === String(jobId));
  if (!j) { showToast('Вакансия не найдена', 'error'); return; }

  const me = getPlatformUser();
  const r  = resumes[0]; // primary resume
  const companyId = j.companyInfo?.code || '';

  haptic('medium');

  // Show loading on apply button
  const applyBtn = document.getElementById('apply-btn');
  const cardBtn  = document.querySelector(`[onclick*="applyFromCard(${jobId}"]`);
  [applyBtn, cardBtn].forEach(b => { if (b) { b.disabled = true; b.textContent = '⏳ Отправляю...'; } });

  let result;
  try {
    result = await submitResponse(j, r, me.id, companyId);
  } catch (e) {
    showToast('Ошибка сети. Попробуйте ещё раз.', 'error');
    [applyBtn, cardBtn].forEach(b => { if (b) { b.disabled = false; b.textContent = '✅ Откликнуться'; } });
    return;
  }

  if (!result.ok && !result.data) {
    showToast('Отклик не удалось сохранить. Проверьте подключение.', 'error');
    [applyBtn, cardBtn].forEach(b => { if (b) { b.disabled = false; b.textContent = '✅ Откликнуться'; } });
    return;
  }

  // Add to local cache
  myResponsesCache.unshift({
    ...(result.data || {}),
    job_id:    String(jobId),
    jobId:     jobId,
    job_title: j.title,
    title:     j.title,
    company:   j.company,
    salary:    j.salary,
    status:    'pending',
  });
  saveMyResponsesCache();

  // Notify employer (non-blocking)
  try { notifyNewResponse(j, r?.name || 'Соискатель'); } catch {}

  showToast('Отклик отправлен! Работодатель свяжется с вами. ✅', 'success');
  window._jobs?.filterJobs?.();
}

// ── My responses ───────────────────────────────────────────────────────────

export async function renderMyResponses() {
  const list = document.getElementById('my-resp-list');
  if (!list) return;

  // Try to load fresh from Supabase
  const me = getPlatformUser();
  if (me.id) {
    const fresh = await loadMyResponses(me.id);
    if (fresh.length) {
      myResponsesCache.length = 0;
      myResponsesCache.push(...fresh);
      saveMyResponsesCache();
    }
  }

  if (!myResponsesCache.length) {
    list.innerHTML = `<div class="empty-state"><div class="empty-icon">📋</div><div class="empty-title">Нет откликов</div><div class="empty-desc">Откликнитесь на вакансии, чтобы они появились здесь</div></div>`;
    return;
  }

  // Clear unread badge once worker opens the screen
  _markMyResponsesSeen();

  list.innerHTML = myResponsesCache.map((resp, i) => {
    const statusMap = {
      pending:  { cls: 'rs-pending',  lbl: '⏳ На рассмотрении' },
      viewed:   { cls: 'rs-viewed',   lbl: '👁 Просмотрено' },
      accepted: { cls: 'rs-accepted', lbl: '✅ Приглашён' },
      declined: { cls: 'rs-declined', lbl: '❌ Отказ' },
    };
    const s = statusMap[resp.status] || statusMap.pending;
    return `
      <div class="my-resp-card">
        <div class="mrc-company">${esc(resp.company || resp.job_title || '—')}</div>
        <div class="mrc-title">${esc(resp.title || resp.job_title || '—')}</div>
        <div class="mrc-salary">${esc(resp.salary || '—')}</div>
        <div class="mrc-footer">
          <div class="mrc-date">${resp.created_at ? new Date(resp.created_at).toLocaleDateString('ru-RU', {day:'numeric',month:'short'}) : resp.date || ''}</div>
          <span class="resp-status-badge ${s.cls}">${s.lbl}</span>
        </div>
        ${resp.status === 'accepted' ? `<button class="chat-open-btn" style="width:100%;margin-top:8px" onclick="window._chat.openChatWorker('${resp.job_id||resp.jobId}','${esc(resp.company||'')}','${esc(resp.title||resp.job_title||'')}')">💬 Открыть чат</button>` : ''}
      </div>`;
  }).join('');
}

// ── Recommendations ────────────────────────────────────────────────────────

export function renderRecommendations() {
  const el = document.getElementById('rec-list');
  if (!el) return;

  if (!resumes.length) {
    el.innerHTML = `<div class="rec-resume-hint"><span class="rec-resume-hint-icon">💡</span>Создайте резюме, чтобы получать персональные рекомендации вакансий</div>`;
    return;
  }

  const r = resumes[0];
  const scored = jobs
    .filter(j => !j.archived && !j.paused)
    .map(j => {
      let score = 0;
      const reasons = [];
      if (r.category && j.category && r.category === j.category) { score += 40; reasons.push('Ваша категория'); }
      if (r.region && j.location && j.location.toLowerCase().includes(r.region.toLowerCase())) { score += 20; reasons.push('Ваш регион'); }
      const wantSal = parseInt(r.salary) || 0;
      const jobSal  = parseInt(j.salary?.replace(/\D/g, '')) || 0;
      if (wantSal && jobSal >= wantSal * 0.9) { score += 30; reasons.push('Зарплата подходит'); }
      if (j.verified) { score += 10; reasons.push('Проверен'); }
      return { job: j, score, reasons };
    })
    .filter(x => x.score > 0)
    .sort((a, b) => b.score - a.score)
    .slice(0, 10);

  if (!scored.length) {
    el.innerHTML = `<div class="rec-empty"><div class="rec-empty-icon">🔍</div>Рекомендаций пока нет. Попробуйте обновить резюме.</div>`;
    return;
  }

  el.innerHTML = scored.map(({ job: j, score, reasons }) => {
    const cls = score >= 70 ? 'score-hi' : score >= 40 ? 'score-mid' : 'score-lo';
    return `
      <div class="rec-card" onclick="window._jobs.openJob(${j.id})">
        <div class="rec-card-top">
          <div class="rec-card-title">${esc(j.title)}</div>
          <span class="rec-score-badge ${cls}">${score}% совпадение</span>
        </div>
        <div class="rec-card-company">${esc(j.company)}</div>
        <div class="rec-card-meta">
          <span class="rec-chip">📍 ${esc(j.location)}</span>
          <span class="rec-chip">💰 ${esc(j.salary)}</span>
          ${j.schedule ? `<span class="rec-chip">⏱ ${esc(j.schedule)}</span>` : ''}
        </div>
        <div class="rec-reasons">${reasons.map(r => `<span class="rec-reason">✓ ${esc(r)}</span>`).join('')}</div>
        <div class="rec-progress-bar"><div class="rec-progress-fill" style="width:${score}%"></div></div>
      </div>`;
  }).join('');
}

// ── Photo handling ─────────────────────────────────────────────────────────

export async function handleResumePhoto(input) {
  if (!input.files || !input.files[0]) return;
  const file = input.files[0];
  if (file.size > 5 * 1024 * 1024) { showToast('Фото не должно быть больше 5 МБ', 'error'); input.value = ''; return; }
  const reader = new FileReader();
  reader.onload = async (e) => {
    crPhoto = await compressImage(e.target.result, 400, 0.75);
    const circle = document.getElementById('cr-photo-circle');
    if (circle) circle.innerHTML = `<img src="${crPhoto}" alt="Фото" />`;
  };
  reader.readAsDataURL(file);
}

// ── PDF download ───────────────────────────────────────────────────────────

export function downloadResumePDF(i) {
  const r = resumes[i];
  if (!r) return;

  const catLabel = r.category && r.category !== 'other'
    ? { construction:'Строительство', oil:'Нефть/Газ', mining:'Горнодобыча', transport:'Транспорт', manufacturing:'Производство' }[r.category] || ''
    : (r.categoryCustom || '');

  const row = (label, val) => val
    ? `<tr><td class="label">${label}</td><td>${esc(String(val))}</td></tr>`
    : '';

  const photoHtml = r.photo
    ? `<img class="photo" src="${esc(r.photo)}" alt="Фото" />`
    : '';

  const html = `<!DOCTYPE html>
<html lang="ru">
<head>
<meta charset="UTF-8">
<title>Резюме — ${esc(r.name || '')}</title>
<style>
  * { box-sizing: border-box; margin: 0; padding: 0; }
  body { font-family: Arial, sans-serif; font-size: 13px; color: #111; padding: 32px 40px; }
  .header { display: flex; align-items: flex-start; gap: 20px; margin-bottom: 24px; border-bottom: 2px solid #1a1a2e; padding-bottom: 18px; }
  .photo { width: 90px; height: 90px; border-radius: 12px; object-fit: cover; flex-shrink: 0; }
  .header-text { flex: 1; }
  .name { font-size: 22px; font-weight: 700; color: #1a1a2e; margin-bottom: 4px; }
  .specialty { font-size: 15px; color: #444; margin-bottom: 6px; }
  .salary { font-size: 15px; font-weight: 700; color: #1db954; }
  table { width: 100%; border-collapse: collapse; margin-bottom: 20px; }
  td { padding: 7px 10px; border-bottom: 1px solid #e8e8e8; vertical-align: top; }
  td.label { width: 38%; font-weight: 600; color: #555; white-space: nowrap; }
  .section-title { font-size: 13px; font-weight: 700; text-transform: uppercase; letter-spacing: .06em; color: #1a1a2e; margin: 18px 0 8px; border-bottom: 1px solid #ddd; padding-bottom: 4px; }
  .about { line-height: 1.6; color: #333; white-space: pre-wrap; }
  .contacts a { color: #1a1a2e; text-decoration: none; }
  .footer { margin-top: 32px; font-size: 11px; color: #aaa; text-align: center; }
  @media print {
    body { padding: 20px 28px; }
    @page { margin: 12mm; }
  }
</style>
</head>
<body>
<div class="header">
  ${photoHtml}
  <div class="header-text">
    <div class="name">${esc(r.name || '')}</div>
    <div class="specialty">${esc(r.specialty || '')}</div>
    ${r.salary ? `<div class="salary">от ${fmtNum(r.salary)} ₽ / мес</div>` : ''}
  </div>
</div>

<div class="section-title">Основная информация</div>
<table>
  ${row('Регион', r.region)}
  ${row('Опыт работы', r.exp)}
  ${row('Пол', r.gender === 'М' ? 'Мужской' : r.gender === 'Ж' ? 'Женский' : '')}
  ${row('Гражданство', r.citizen)}
  ${catLabel ? row('Отрасль', catLabel) : ''}
</table>

${r.about ? `<div class="section-title">О себе</div><div class="about">${esc(r.about)}</div>` : ''}

${(r.phone || r.telegram) ? `
<div class="section-title">Контакты</div>
<table class="contacts">
  ${row('Телефон', r.phone)}
  ${r.telegram ? `<tr><td class="label">Telegram</td><td><a href="https://t.me/${esc(r.telegram)}">@${esc(r.telegram)}</a></td></tr>` : ''}
</table>` : ''}

<div class="footer">Резюме создано через Good_Вахта</div>
</body>
</html>`;

  const win = window.open('', '_blank');
  if (!win) { showToast('Разрешите всплывающие окна в браузере', 'error'); return; }
  win.document.write(html);
  win.document.close();
  win.onload = () => { win.focus(); win.print(); };
}

// ── Resume DB loading ──────────────────────────────────────────────────────

// Realtime subscriptions for resumes are handled centrally by src/realtime.js

export async function loadResumeDb() {
  // Full reconcile (not merge) — resumes that became unpublished since the
  // last load must disappear, not linger as stale "ghost" candidates.
  const remote = await loadPublicResumes();
  resumeDbData.length = 0;
  remote.forEach(r => resumeDbData.push(r));
}

// ── Invitations ────────────────────────────────────────────────────────────

/** Fetch pending count and update ALL .inv-badge-el elements on page */
export async function loadInvitationBadge() {
  const myResume = resumes[0];
  const telegram = myResume?.telegram || '';
  const phone    = myResume?.phone    || '';
  if (!telegram && !phone) return;

  const { loadInvitationsForWorker: _load } = await import('../api/invitations.js');
  const invitations = await _load(telegram, phone);
  const pending = invitations.filter(i => i.status === 'pending').length;

  document.querySelectorAll('.inv-badge-el').forEach(el => {
    const isHomeCard = el.classList.contains('hcc-inv-badge');
    el.textContent = isHomeCard
      ? `${pending} новых приглашени${pending === 1 ? 'е' : 'я'}`
      : String(pending);
    el.style.display = pending > 0 ? 'flex' : 'none';
  });
}

export async function openInvitations() {
  goTo('screen-my-invitations');
  const list = document.getElementById('invitations-list');
  if (list) list.innerHTML = '<div style="color:var(--text-muted);font-size:13px;text-align:center;padding:20px">Загрузка...</div>';

  const me = getPlatformUser();
  // Try to get worker's telegram/phone from their resume
  const { resumes: myResumes } = await import('../store/index.js');
  const myResume = myResumes[0];
  const telegram = myResume?.telegram || '';
  const phone    = myResume?.phone    || '';

  const invitations = await loadInvitationsForWorker(telegram, phone);

  // Update badge
  const pending = invitations.filter(i => i.status === 'pending').length;
  const badge = document.getElementById('inv-badge');
  if (badge) {
    badge.style.display = pending > 0 ? 'flex' : 'none';
    badge.textContent = pending > 0 ? String(pending) : '';
  }

  if (!list) return;
  if (!invitations.length) {
    list.innerHTML = `<div class="empty-state"><div class="empty-icon">📨</div><div class="empty-title">Приглашений пока нет</div><div class="empty-sub">Работодатели будут приглашать вас здесь</div></div>`;
    return;
  }

  // Store invitations for access in toggleInvitation
  window._invitationsList = invitations;

  list.innerHTML = invitations.map((inv, idx) => {
    const date       = new Date(inv.created_at).toLocaleDateString('ru-RU', { day:'numeric', month:'long' });
    const status     = inv.status; // pending | viewed | accepted | declined
    const isNew      = status === 'pending';
    const isAnswered = status === 'accepted' || status === 'declined';
    const msgEscaped = esc(inv.message || '').replace(/\n/g, '<br>');

    const statusBadgeHtml = isNew
      ? '<div class="inv-new-badge">Новое</div>'
      : status === 'accepted' ? '<div class="inv-reply-status inv-accepted">✅ Принято</div>'
      : status === 'declined' ? '<div class="inv-reply-status inv-declined">❌ Отказ</div>'
      : '';

    const replyActionsHtml = !isAnswered ? `
      <div class="inv-reply-actions" id="inv-actions-${idx}">
        <button class="inv-reply-btn inv-reply-accept" onclick="window._worker.replyInvitation(${idx},'accepted')">✅ Принять</button>
        <button class="inv-reply-btn inv-reply-decline" onclick="window._worker.replyInvitation(${idx},'declined')">❌ Отказаться</button>
      </div>` : '';

    const chatId  = inv.id ? `inv_${inv.id}` : '';
    const unread  = chatId ? (window._chat?.getChatUnread(chatId) || 0) : 0;
    const chatBtn = inv.id ? `<button class="inv-reply-btn inv-chat-btn" data-chat-id="${chatId}" onclick="window._chat.openChatFromInvWorker('${esc(inv.id)}','${esc(inv.company_name || '')}','${esc(inv.job_title || '')}')">💬 Написать работодателю${unread ? ` <span class="chat-card-badge">${unread}</span>` : ''}</button>` : '';

    const employerContactsHtml = status === 'accepted' ? `
      <div class="inv-employer-contacts">
        <div class="inv-employer-contacts-title">Свяжитесь с работодателем:</div>
        ${inv.employer_phone ? `<a class="inv-reply-btn inv-reply-call" href="tel:${esc(inv.employer_phone)}">📞 ${esc(inv.employer_phone)}</a>` : ''}
      </div>` : '';

    return `
      <div class="invitation-card ${isNew ? 'inv-new' : ''}" id="inv-card-${idx}">
        <div class="inv-card-header">
          <div>
            <div class="inv-company">🏗️ ${esc(inv.company_name || '—')}</div>
            <div class="inv-job-title">${esc(inv.job_title || '—')}</div>
          </div>
          ${statusBadgeHtml}
        </div>
        <div class="inv-date">📅 ${date}</div>
        <div class="inv-message-full">${msgEscaped}</div>
        ${replyActionsHtml}
        ${employerContactsHtml}
        ${chatBtn}
      </div>`;
  }).join('');

  // Mark all pending as viewed
  invitations.filter(i => i.status === 'pending').forEach(i => markInvitationViewed(i.id));
  if (badge) { badge.style.display = 'none'; badge.textContent = ''; }
}

export function toggleInvitation(idx) {
  const body = document.getElementById(`inv-body-${idx}`);
  const hint = document.getElementById(`inv-hint-${idx}`);
  const card = document.getElementById(`inv-card-${idx}`);
  if (!body) return;
  const isOpen = body.style.display !== 'none';
  body.style.display = isOpen ? 'none' : '';
  if (hint) hint.textContent = isOpen ? '▼ Открыть' : '▲ Свернуть';
  // Mark as read visually
  if (card) { card.classList.remove('inv-new'); card.querySelector('.inv-new-badge')?.remove(); }
}

export async function replyInvitation(idx, reply) {
  const inv = window._invitationsList?.[idx];
  if (!inv) return;

  // Optimistic UI update
  if (window._invitationsList[idx]) window._invitationsList[idx].status = reply;

  const card = document.getElementById(`inv-card-${idx}`);
  if (card) {
    // Remove reply actions block
    const actionsEl = document.getElementById(`inv-actions-${idx}`);
    if (actionsEl) actionsEl.remove();

    // Remove old status badges / new badge
    card.classList.remove('inv-new');
    card.querySelector('.inv-new-badge')?.remove();
    card.querySelector('.inv-reply-status')?.remove();

    if (reply === 'accepted') {
      const hasPhone = !!inv.employer_phone;
      const hasTg    = !!inv.employer_telegram;
      const contactsHtml = (hasPhone || hasTg) ? `
        <div class="inv-employer-contacts">
          <div class="inv-employer-contacts-title">Свяжитесь с работодателем:</div>
          ${hasPhone ? `<a class="inv-reply-btn inv-reply-call" href="tel:${esc(inv.employer_phone)}">📞 ${esc(inv.employer_phone)}</a>` : ''}
          ${hasTg    ? `<a class="inv-reply-btn inv-reply-tg" href="https://t.me/${esc(inv.employer_telegram)}" target="_blank">✈️ @${esc(inv.employer_telegram)}</a>` : ''}
        </div>` : '<div class="inv-employer-contacts" style="color:var(--text-muted);font-size:13px">Уточните контакты в сообщении выше</div>';
      card.insertAdjacentHTML('beforeend',
        `<div class="inv-reply-status inv-accepted">✅ Вы приняли приглашение</div>${contactsHtml}`);
      showToast('✅ Принято! Напишите работодателю в чате', 'success');
    } else {
      card.insertAdjacentHTML('beforeend',
        '<div class="inv-reply-status inv-declined">❌ Вы отказались от приглашения</div>');
      showToast('Отказ отправлен работодателю');
    }
  }

  // Save to Supabase (after UI update so user doesn't wait)
  if (inv.id) await updateInvitationStatus(inv.id, reply);
}

// ── My-response badge (unread status changes) ──────────────────────────────

const _SEEN_RESP_KEY = 'my-resp-seen-ids';

/** Update the badge on "Мои отклики" menu item. */
export function loadMyResponseBadge() {
  const seen = new Set(JSON.parse(localStorage.getItem(_SEEN_RESP_KEY) || '[]'));
  // Count responses where employer has reacted (viewed/accepted/declined) but worker hasn't seen
  const count = myResponsesCache.filter(r => r.status && r.status !== 'pending' && !seen.has(r.id)).length;
  document.querySelectorAll('.my-resp-badge').forEach(el => {
    el.textContent = count > 0 ? String(count) : '';
    el.style.display = count > 0 ? 'inline-flex' : 'none';
  });
}

/** Mark all current responses as seen (called when worker opens the screen). */
function _markMyResponsesSeen() {
  const ids = myResponsesCache.map(r => r.id).filter(Boolean);
  localStorage.setItem(_SEEN_RESP_KEY, JSON.stringify(ids));
  document.querySelectorAll('.my-resp-badge').forEach(el => {
    el.style.display = 'none';
    el.textContent = '';
  });
}

// ── Helpers ────────────────────────────────────────────────────────────────
function showFocus(id) {
  const el = document.getElementById(id);
  if (el) { el.classList.add('error'); el.focus(); setTimeout(() => el.classList.remove('error'), 1500); }
}

// ── Expose to global scope ─────────────────────────────────────────────────
window._worker = {
  renderResumes, openCreateResume, submitResume, deleteResume, toggleResumePublished,
  applyToJob, applyToJobById, renderMyResponses, renderRecommendations,
  handleResumePhoto, downloadResumePDF, toggleWorkerStatus, initWorkerStatusUI,
  selectResumeCategory, selectCitizenship, toggleWorkRegion,
  openInvitations, replyInvitation,
  loadInvitationBadge, loadMyResponseBadge,
};
