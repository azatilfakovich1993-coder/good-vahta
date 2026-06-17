/**
 * Shared utility functions.
 */

/**
 * Escape HTML to prevent XSS.
 * Bug fix: job card HTML was using template literals without escaping.
 */
/** Decode HTML entities (reverse of esc). Used to clean pre-escaped legacy data. */
export function unesc(s) {
  return String(s)
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&amp;/g, '&');
}

/** Escape HTML for safe insertion into innerHTML. Auto-decodes pre-escaped input first. */
export function esc(s) {
  const clean = unesc(String(s)); // strip any pre-existing escaping
  return clean
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;')
    .replace(/\n/g, '<br>');
}

/**
 * Fallback avatar for companies without a logo — first letter of the name on a
 * gradient picked deterministically from the name, so each company keeps "its" color.
 */
const AVATAR_GRADIENTS = [
  'linear-gradient(135deg,#f5a623,#e08a0e)',
  'linear-gradient(135deg,#22c55e,#16a34a)',
  'linear-gradient(135deg,#3b82f6,#1d4ed8)',
  'linear-gradient(135deg,#a855f7,#7e22ce)',
  'linear-gradient(135deg,#ec4899,#be185d)',
  'linear-gradient(135deg,#14b8a6,#0f766e)',
];

const LEGAL_FORM_PREFIX = /^(ООО|ОАО|ЗАО|ПАО|АО|ИП|НКО|ТОО|НАО)\.?\s*[«"']?\s*/i;

export function letterAvatar(name) {
  const clean = (name || '').trim();
  const withoutForm = clean.replace(LEGAL_FORM_PREFIX, '').trim();
  const letter = (withoutForm || clean).charAt(0).toUpperCase() || '?';
  let hash = 0;
  for (let i = 0; i < clean.length; i++) hash = (hash * 31 + clean.charCodeAt(i)) >>> 0;
  return { letter, background: AVATAR_GRADIENTS[hash % AVATAR_GRADIENTS.length] };
}

/**
 * Parse salary string to a minimum number (for sorting/filtering).
 */
export function parseSalary(s) {
  if (typeof s === 'number') return s;
  const n = String(s).replace(/\s/g, '').match(/\d+/);
  return n ? parseInt(n[0]) : 0;
}

/**
 * Format today's date in Russian locale.
 */
export function todayRu() {
  return new Date().toLocaleDateString('ru-RU', { day: 'numeric', month: 'short', year: 'numeric' });
}

/**
 * Parse salary range from formatted string like "50 000 – 80 000 ₽/мес".
 */
export function parseSalaryStr(str) {
  const nums = String(str).replace(/\s/g, '').match(/\d+/g) || [];
  return { from: nums[0] || '', to: nums[1] || '' };
}

/**
 * Compress image data URL via canvas.
 * @param {string} dataUrl
 * @param {number} maxSize - max dimension in px
 * @param {number} quality - 0-1
 * @returns {Promise<string>}
 */
export function compressImage(dataUrl, maxSize = 400, quality = 0.75) {
  return new Promise(resolve => {
    const img = new Image();
    img.onload = () => {
      let { width: w, height: h } = img;
      if (w > maxSize || h > maxSize) {
        if (w > h) { h = Math.round(h * maxSize / w); w = maxSize; }
        else        { w = Math.round(w * maxSize / h); h = maxSize; }
      }
      const canvas = document.createElement('canvas');
      canvas.width = w; canvas.height = h;
      canvas.getContext('2d').drawImage(img, 0, 0, w, h);
      resolve(canvas.toDataURL('image/jpeg', quality));
    };
    img.onerror = () => resolve(dataUrl);
    img.src = dataUrl;
  });
}

/**
 * Format number with Russian locale thousands separator.
 */
export function fmtNum(n) {
  return Number(n).toLocaleString('ru');
}

/**
 * Build salary display string from from/to numbers.
 */
export function buildSalaryStr(from, to) {
  const f = from ? `${fmtNum(from)} ₽` : '';
  const t = to   ? `${fmtNum(to)} ₽`   : '';
  if (f && t) return `${f} – ${t}/мес`;
  if (f)      return `от ${f}/мес`;
  if (t)      return `до ${t}/мес`;
  return 'По договорённості';
}

/**
 * Safe star rating string (e.g. ★★★★☆).
 */
export function starStr(rating) {
  const r = Math.round(Math.min(5, Math.max(0, rating)));
  return '★'.repeat(r) + '☆'.repeat(5 - r);
}

/**
 * Debounce a function.
 */
export function debounce(fn, ms = 300) {
  let timer;
  return (...args) => {
    clearTimeout(timer);
    timer = setTimeout(() => fn(...args), ms);
  };
}

/**
 * Category labels for jobs.
 */
export const JOB_CAT_LABELS = {
  construction: '🏗 Строительство',
  oil:          '⛽ Нефть / Газ',
  mining:       '⛏ Горная добыча',
  forestry:     '🌲 Лесозаготовка',
  transport:    '🚛 Транспорт / Логистика',
  military:     '🛡 Гособоронзаказ',
  manufacturing:'🏭 Производство',
  agriculture:  '🌾 Сельское хозяйство',
  energy:       '⚡ Энергетика',
  other:        '📦 Другое',
};

/**
 * Category labels for resumes.
 */
export const RESUME_CAT_LABELS = {
  construction: '🏗 Строительство',
  oil:          '⛽ Нефть / Газ',
  mining:       '⛏ Горная добыча',
  forestry:     '🌲 Лесозаготовка',
  transport:    '🚛 Транспорт',
  military:     '🛡 Гособоронзаказ',
  manufacturing:'🏭 Производство',
  agriculture:  '🌾 Сельское хозяйство',
  energy:       '⚡ Энергетика',
  it:           '💻 IT / Связь',
  service:      '🍽 Сервис',
  other:        '📦 Другое',
};

export function catLabelJob(job) {
  if (job.category === 'other' && job.categoryCustom) return job.categoryCustom;
  return JOB_CAT_LABELS[job.category] || job.category || '';
}

export function catLabelResume(r) {
  if (r.category === 'other' && r.categoryCustom) return r.categoryCustom;
  return RESUME_CAT_LABELS[r.category] || r.category || '';
}
