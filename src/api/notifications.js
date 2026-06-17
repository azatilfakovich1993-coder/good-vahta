/**
 * Cross-platform notification service.
 * TG: calls /sendMessage via bot API (through Supabase Edge Function to hide token).
 * VK: uses VK Bridge notifications.
 * Web: uses browser Notification API.
 *
 * BOT TOKEN is NOT exposed in client code — all TG notifications go through
 * the Supabase Edge Function `send-tg-message`.
 */
import { sb } from './supabase.js';
import { PLATFORM, getVkBridge } from '../platform/index.js';

/**
 * Send a Telegram message via Supabase Edge Function (bot token stays on server).
 * @param {string|number} chatId  — Telegram chat/user ID
 * @param {string}        text    — message text (HTML parse mode)
 */
export async function sendTgMessage(chatId, text) {
  if (!chatId || !sb) return;
  try {
    await sb.functions.invoke('send-tg-message', {
      body: { chat_id: String(chatId), text },
    });
  } catch (e) {
    console.warn('[notify] sendTgMessage failed:', e);
  }
}

/**
 * Send a VK notification (only works for published VK Mini Apps).
 */
export async function sendVkNotification(message) {
  const bridge = getVkBridge();
  if (!bridge) return;
  try {
    await bridge.send('VKWebAppAllowNotifications');
    // VK notifications are triggered server-side; this just requests permission
  } catch (e) {
    console.warn('[notify] VK notification failed:', e);
  }
}

/**
 * Request Web Push permission.
 */
export async function requestWebPush() {
  if (PLATFORM !== 'web' || !('Notification' in window)) return false;
  const result = await Notification.requestPermission();
  return result === 'granted';
}

/**
 * Show a local browser notification.
 */
export function showWebNotification(title, body) {
  if (PLATFORM !== 'web') return;
  if (Notification.permission !== 'granted') return;
  new Notification(title, { body, icon: '/icons/icon-192.png' });
}

/**
 * Notify employer of a new response — platform-aware.
 * @param {{ ownerChatId: string|null }} job
 * @param {string} applicantName
 */
export function notifyNewResponse(job, applicantName) {
  if (job.ownerChatId && PLATFORM === 'telegram') {
    sendTgMessage(
      job.ownerChatId,
      `📩 <b>Новый отклик!</b>\nНа вакансию «${job.title}» откликнулся <b>${applicantName}</b>.\nОткройте раздел «Отклики» в Good_Вахта.`
    );
  }
}

/**
 * Notify worker of accepted/declined response.
 * @param {string|null} workerChatId
 * @param {string}      jobTitle
 * @param {'accepted'|'declined'} status
 */
export function notifyResponseStatus(workerChatId, jobTitle, status) {
  if (!workerChatId || PLATFORM !== 'telegram') return;
  const msg = status === 'accepted'
    ? `✅ <b>Приглашение!</b>\nВы приглашены на вакансию «${jobTitle}». Откройте Good_Вахта для связи с работодателем.`
    : `❌ <b>Отказ</b>\nК сожалению, по вакансии «${jobTitle}» вам отказали. Продолжайте искать — удача впереди!`;
  sendTgMessage(workerChatId, msg);
}

/**
 * Notify about a new chat message — platform-aware.
 */
export function notifyChatMessage(chatId, recipientTgId, senderName, text) {
  if (PLATFORM === 'telegram' && recipientTgId) {
    const preview = text.length > 60 ? text.slice(0, 60) + '…' : text;
    sendTgMessage(
      recipientTgId,
      `💬 <b>${senderName}</b>:\n${preview}\n\nОткройте Good_Вахта, чтобы ответить.`
    );
  }
}

/**
 * Notify matching workers about a new job.
 */
export function notifyMatchingWorkers(job, resumeDbData) {
  if (PLATFORM !== 'telegram') return;
  resumeDbData.forEach(r => {
    if (!r.telegram) return;
    const categoryMatch = !job.category || !r.category || job.category === r.category || job.category === 'other';
    if (!categoryMatch) return;
    const chatId = r.workerChatId || null;
    if (!chatId) return;
    sendTgMessage(
      chatId,
      `🔔 <b>Новая вакансия!</b>\n«${job.title}» — ${job.salary}\n📍 ${job.location}\n\nОткройте Good_Вахта, чтобы посмотреть подробнее.`
    );
  });
}
