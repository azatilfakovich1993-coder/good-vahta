/**
 * Platform abstraction layer
 * Detects runtime environment: Telegram Mini App, VK Mini App, or Web
 * Provides a unified API for user identity, theme, share, and back button.
 */

export const PLATFORM = (() => {
  if (window.Telegram?.WebApp?.initData) return 'telegram';
  if (typeof window.vkBridge !== 'undefined') return 'vk';
  return 'web';
})();

// ── Telegram ──────────────────────────────────────────────────────────────
const TG = window.Telegram?.WebApp;

function tgInit() {
  if (!TG) return;
  TG.ready();
  TG.expand();
  // Apply Telegram theme
  const c = TG.themeParams;
  if (c?.bg_color) {
    document.documentElement.style.setProperty('--tg-bg', c.bg_color);
  }
}

// ── VK Bridge ─────────────────────────────────────────────────────────────
let _vkBridge = null;
async function vkInit() {
  try {
    const m = await import('@vkontakte/vk-bridge');
    _vkBridge = m.default;
    await _vkBridge.send('VKWebAppInit');
  } catch (e) {
    console.warn('VK Bridge init failed:', e);
  }
}

// ── Public API ─────────────────────────────────────────────────────────────

/**
 * Initialize the current platform SDK.
 */
export async function platformInit() {
  if (PLATFORM === 'telegram') tgInit();
  if (PLATFORM === 'vk') await vkInit();
}

/**
 * Returns current user info from the platform.
 * Falls back to stored web session if available.
 * @returns {{ id: string|null, firstName: string, lastName: string, username: string|null, photoUrl: string|null }}
 */
export function getPlatformUser() {
  if (PLATFORM === 'telegram') {
    const u = TG?.initDataUnsafe?.user;
    return u
      ? { id: String(u.id), firstName: u.first_name || '', lastName: u.last_name || '', username: u.username || null, photoUrl: u.photo_url || null }
      : nullUser();
  }
  if (PLATFORM === 'vk') {
    // VK user info is fetched async — this returns cached value after login
    const cached = _vkUserCache;
    return cached || nullUser();
  }
  // Web: use localStorage session
  const session = _getWebSession();
  return session || nullUser();
}

function nullUser() {
  return { id: null, firstName: 'Гость', lastName: '', username: null, photoUrl: null };
}

// ── VK user cache ──────────────────────────────────────────────────────────
let _vkUserCache = null;

export async function fetchVKUser() {
  if (!_vkBridge) return null;
  try {
    const data = await _vkBridge.send('VKWebAppGetUserInfo');
    _vkUserCache = {
      id:        String(data.id),
      firstName: data.first_name || '',
      lastName:  data.last_name  || '',
      username:  null,
      photoUrl:  data.photo_200  || null,
    };
    return _vkUserCache;
  } catch (e) {
    console.warn('VKWebAppGetUserInfo failed:', e);
    return null;
  }
}

// ── Web session ────────────────────────────────────────────────────────────
const WEB_SESSION_KEY = 'vahta_web_session';

export function _getWebSession() {
  try {
    const s = localStorage.getItem(WEB_SESSION_KEY);
    return s ? JSON.parse(s) : null;
  } catch { return null; }
}

export function setWebSession(user) {
  try { localStorage.setItem(WEB_SESSION_KEY, JSON.stringify(user)); } catch {}
}

export function clearWebSession() {
  try { localStorage.removeItem(WEB_SESSION_KEY); } catch {}
}

// ── Theme ──────────────────────────────────────────────────────────────────
export function isDarkMode() {
  if (PLATFORM === 'telegram') return TG?.colorScheme === 'dark';
  return window.matchMedia?.('(prefers-color-scheme: dark)').matches ?? true;
}

// ── Back button ────────────────────────────────────────────────────────────
export function onBackButton(callback) {
  if (PLATFORM === 'telegram' && TG) {
    TG.BackButton.show();
    TG.BackButton.onClick(callback);
  }
}

export function hideBackButton() {
  if (PLATFORM === 'telegram' && TG) {
    TG.BackButton.hide();
    TG.BackButton.offClick();
  }
}

// ── Share ──────────────────────────────────────────────────────────────────
export async function shareText(text) {
  if (PLATFORM === 'vk' && _vkBridge) {
    try {
      await _vkBridge.send('VKWebAppShare', { link: text });
      return;
    } catch {}
  }
  if (PLATFORM === 'telegram' && TG) {
    // Open share via Telegram bot link
    window.open(`https://t.me/share/url?url=${encodeURIComponent(text)}`, '_blank');
    return;
  }
  // Web: Web Share API or clipboard
  if (navigator.share) {
    try { await navigator.share({ text }); return; } catch {}
  }
  try { await navigator.clipboard.writeText(text); } catch {}
}

// ── Haptic feedback ────────────────────────────────────────────────────────
export function haptic(type = 'light') {
  if (PLATFORM === 'telegram' && TG?.HapticFeedback) {
    TG.HapticFeedback.impactOccurred(type);
  }
}

// ── VK Bridge re-export ────────────────────────────────────────────────────
export function getVkBridge() { return _vkBridge; }
