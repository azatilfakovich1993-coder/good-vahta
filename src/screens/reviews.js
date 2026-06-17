/**
 * Reviews & ratings screen.
 * Bug fix: reviews were only stored in localStorage; now use Supabase.
 */
import { goTo } from '../router.js';
import { showToast } from '../components/toast.js';
import { esc, starStr } from '../utils.js';
import { loadReviews, submitReview } from '../api/reviews.js';
import { getPlatformUser } from '../platform/index.js';
import { companyProfile } from '../store/index.js';
import { ratingsCache } from './jobs.js';

let _currentCompany = null;
let _backScreen     = null;
let _reviewRating   = 0;

export async function openReviews(companyName, _unused, backScreen) {
  _currentCompany = companyName;
  _backScreen     = backScreen || 'screen-jobs';
  _reviewRating   = 0;

  const titleEl = document.getElementById('reviews-title');
  if (titleEl) titleEl.textContent = `Отзывы — ${companyName}`;

  // Reset star input
  document.querySelectorAll('.star-btn').forEach(b => b.classList.remove('on'));
  const textEl = document.getElementById('review-text');
  if (textEl) textEl.value = '';

  goTo('screen-reviews');

  // Hide review form if viewing own company
  const isOwnCompany = companyProfile?.name && companyProfile.name === companyName;
  const formEl = document.querySelector('.review-form-card');
  if (formEl) formEl.style.display = isOwnCompany ? 'none' : '';

  const container = document.getElementById('reviews-list');
  if (container) container.innerHTML = '<p style="color:var(--text-muted);text-align:center;padding:24px">Загрузка...</p>';

  const reviews = await loadReviews(companyName);
  _renderReviews(reviews, companyName);
}

function _renderReviews(reviews, companyName) {
  // Update summary
  const summaryEl = document.getElementById('reviews-summary');
  if (reviews.length && summaryEl) {
    const avg = reviews.reduce((s, r) => s + (r.rating || 0), 0) / reviews.length;
    const rounded = Math.round(avg * 10) / 10;
    ratingsCache[companyName] = { avg: rounded, count: reviews.length };

    // Bars
    const bars = [5,4,3,2,1].map(star => {
      const cnt = reviews.filter(r => Math.round(r.rating) === star).length;
      const pct = reviews.length ? Math.round(cnt / reviews.length * 100) : 0;
      return `<div class="review-bar-row"><div class="review-bar-label">${star}</div><div class="review-bar-track"><div class="review-bar-fill" style="width:${pct}%"></div></div><div class="review-bar-cnt">${cnt}</div></div>`;
    }).join('');

    summaryEl.innerHTML = `
      <div class="reviews-big-num">${rounded.toFixed(1)}</div>
      <div class="reviews-big-stars">${starStr(rounded)}</div>
      <div class="reviews-big-count">${reviews.length} отзывов</div>
      <div class="review-bars">${bars}</div>`;
  } else if (summaryEl) {
    summaryEl.innerHTML = '<div style="color:var(--text-muted);font-size:13px;padding:16px 0">Отзывов пока нет</div>';
  }

  // List
  const container = document.getElementById('reviews-list');
  if (!container) return;
  if (!reviews.length) {
    container.innerHTML = `<div class="empty-state"><div class="empty-icon">⭐</div><div class="empty-title">Отзывов пока нет</div><div class="empty-desc">Будьте первым!</div></div>`;
    return;
  }
  container.innerHTML = reviews.map(r => `
    <div class="review-card">
      <div class="rc2-header">
        <span class="rc2-author">${esc(r.author_name || 'Аноним')}</span>
        <span class="rc2-date">${r.created_at ? new Date(r.created_at).toLocaleDateString('ru-RU', {day:'numeric',month:'short',year:'numeric'}) : ''}</span>
      </div>
      <div class="rc2-stars">${starStr(r.rating || 0)}</div>
      <div class="rc2-text">${esc(r.text || '')}</div>
    </div>`).join('');
}

export function setReviewStar(star) {
  _reviewRating = star;
  document.querySelectorAll('.star-btn').forEach((b, i) => {
    b.classList.toggle('on', i < star);
  });
  updateSubmitBtn();
}

export function updateSubmitBtn() {
  const btn  = document.getElementById('submit-review-btn');
  const text = document.getElementById('review-text')?.value.trim() || '';
  if (btn) btn.textContent = text ? '📝 Оставить отзыв' : '⭐ Оценить';
}

export async function submitReviewForm() {
  if (!_reviewRating) { showToast('Поставьте оценку', 'error'); return; }
  const textEl = document.getElementById('review-text');
  const text   = textEl?.value.trim() || '';

  const me = getPlatformUser();
  const authorName = me.firstName || 'Пользователь';

  const btn = document.getElementById('submit-review-btn');
  if (btn) { btn.disabled = true; btn.textContent = '⏳ Отправка...'; }

  const { ok } = await submitReview(_currentCompany, authorName, me.id, _reviewRating, text);

  if (btn) { btn.disabled = false; btn.textContent = '📝 Оставить отзыв'; }

  if (ok !== false) {
    showToast('Отзыв отправлен! ✅', 'success');
    if (textEl) textEl.value = '';
    _reviewRating = 0;
    document.querySelectorAll('.star-btn').forEach(b => b.classList.remove('on'));
    const fresh = await loadReviews(_currentCompany);
    _renderReviews(fresh, _currentCompany);
  } else {
    showToast('Не удалось отправить отзыв', 'error');
  }
}

window._reviews = { openReviews, setReviewStar, submitReviewForm, updateSubmitBtn };
