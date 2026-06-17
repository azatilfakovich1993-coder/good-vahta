let _timer;

/**
 * Show a toast notification.
 * @param {string} msg
 * @param {'info'|'error'|'success'} [type='info']
 */
export function showToast(msg, type = 'info') {
  const t = document.getElementById('toast');
  if (!t) return;
  t.textContent = msg;
  t.className = `toast show toast--${type}`;
  clearTimeout(_timer);
  _timer = setTimeout(() => t.classList.remove('show'), 2400);
}
