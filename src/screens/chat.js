/**
 * Chat screen — real-time messaging between employer and applicant.
 * Bug fixes:
 *  - Messages no longer lost on page refresh (stored in Supabase)
 *  - XSS: all message content escaped
 *  - Chat ID format standardized as `j{jobId}_a{applicantId}`
 */
import { goTo } from '../router.js';
import { showToast } from '../components/toast.js';
import { esc, unesc } from '../utils.js';
import { fetchMessages, sendMessage, subscribeChat, unsubscribeChat } from '../api/chat.js';
import { notifyChatMessage } from '../api/notifications.js';
import { getPlatformUser } from '../platform/index.js';
import { companyProfile, resumes } from '../store/index.js';
import { sb } from '../api/supabase.js';

const _chat = { id: null, myId: null, myName: null, otherName: null, otherTgId: null, backScreen: null, sub: null };

// ── Chat unread badge system ───────────────────────────────────────────────
const _CHAT_SEEN_KEY = '_chat_last_read';
let _chatUnread = {};   // chatId → unread count
let _globalSub  = null;

/** Subscribe globally to new messages; show badge when something arrives. */
export function initChatNotifications(myId) {
  if (!sb || !myId) return;
  if (_globalSub) return; // already subscribed
  const lastRead = _loadLastRead();

  _globalSub = sb.channel('global_chat_notif')
    .on('postgres_changes', {
      event: 'INSERT', schema: 'public', table: 'messages',
    }, payload => {
      const msg = payload.new;
      if (!msg) return;
      if (String(msg.sender_id) === String(myId)) return; // own message
      // only skip if chat screen is actually open and showing this chat
      const chatScreenActive = document.getElementById('screen-chat')?.classList.contains('active');
      if (chatScreenActive && msg.chat_id === _chat.id) return;
      // Only count if newer than last read for this chat
      const last = lastRead[msg.chat_id];
      if (last && msg.created_at <= last) return;
      _chatUnread[msg.chat_id] = (_chatUnread[msg.chat_id] || 0) + 1;
      _updateChatBadges();
      showToast(`💬 Новое сообщение: ${esc(msg.sender_name || 'Собеседник')}`);
    })
    .subscribe();
}

function _loadLastRead() {
  try { return JSON.parse(localStorage.getItem(_CHAT_SEEN_KEY) || '{}'); } catch { return {}; }
}

function _markRead(chatId) {
  _chatUnread[chatId] = 0;
  const lr = _loadLastRead();
  lr[chatId] = new Date().toISOString();
  try { localStorage.setItem(_CHAT_SEEN_KEY, JSON.stringify(lr)); } catch {}
  _updateChatBadges();
}

function _updateChatBadges() {
  const total = Object.values(_chatUnread).reduce((s, n) => s + n, 0);
  // Global menu badges
  document.querySelectorAll('.chat-unread-badge').forEach(el => {
    el.textContent = total > 0 ? String(total) : '';
    el.style.display = total > 0 ? 'flex' : 'none';
  });
  // Per-card badges: elements with data-chat-id attribute
  document.querySelectorAll('[data-chat-id]').forEach(el => {
    const count = _chatUnread[el.dataset.chatId] || 0;
    el.querySelector('.chat-card-badge')?.remove();
    if (count > 0) {
      const badge = document.createElement('span');
      badge.className = 'chat-card-badge';
      badge.textContent = count;
      el.appendChild(badge);
    }
  });
}

/** Returns unread count for a specific chatId. */
export function getChatUnread(chatId) {
  return _chatUnread[chatId] || 0;
}

export function openChatEr(jobId, applicantId, applicantName, jobTitle) {
  const myName = companyProfile?.name || 'Работодатель';
  const me = getPlatformUser();
  openChat(`j${jobId}_a${applicantId}`, jobTitle, applicantName, 'screen-employer-responses', myName, me.id, applicantId);
}

export function openChatWorker(jobId, companyName, jobTitle) {
  const me = getPlatformUser();
  const myName = resumes[0]?.name || me.firstName || 'Соискатель';
  openChat(`j${jobId}_a${me.id}`, jobTitle, companyName, 'screen-my-responses', myName, me.id, null);
}

/** Worker opens chat from invitation screen. chatId = inv_{invId} */
export function openChatFromInvWorker(invId, companyName, jobTitle) {
  const me = getPlatformUser();
  const myName = resumes[0]?.name || me.firstName || 'Соискатель';
  openChat(`inv_${invId}`, jobTitle, companyName, 'screen-my-invitations', myName, me.id, null);
}

/** Employer opens chat from sent invitations screen. chatId = inv_{invId} */
export function openChatFromInvEmployer(invId, candidateName, jobTitle) {
  const myName = companyProfile?.name || 'Работодатель';
  const me = getPlatformUser();
  openChat(`inv_${invId}`, jobTitle, candidateName, 'screen-sent-invitations', myName, me.id, null);
}

async function openChat(chatId, jobTitle, otherName, backScreen, myName, myId, otherTgId) {
  // Unsubscribe previous chat
  unsubscribeChat(_chat.sub);

  Object.assign(_chat, { id: chatId, myId: String(myId || 'anon'), myName, otherName, otherTgId, backScreen, sub: null });
  _markRead(chatId); // clear unread badge for this chat

  // Update header
  const hdName = document.getElementById('chat-hd-name');
  const hdSub  = document.getElementById('chat-hd-sub');
  const chatAva = document.getElementById('chat-ava');
  const cleanName = unesc(otherName || 'Собеседник');
  const cleanTitle = unesc(jobTitle || '');
  if (hdName) hdName.textContent = cleanName;
  if (hdSub)  hdSub.textContent  = cleanTitle;
  if (chatAva) chatAva.textContent = cleanName[0].toUpperCase();

  goTo('screen-chat');

  // Load messages
  const box = document.getElementById('chat-messages');
  if (box) box.innerHTML = '<div class="chat-empty-msg"><div class="chat-empty-msg-icon">⏳</div><div>Загрузка...</div></div>';

  const msgs = await fetchMessages(chatId);
  _chatRender(msgs);

  // Subscribe
  _chat.sub = subscribeChat(chatId, _chat.myId, (payload, source) => {
    if (source === 'realtime') _chatAppend(payload);
    else if (source === 'poll') _chatRender(payload);
  });
}

export async function sendChatMsg() {
  const ta  = document.getElementById('chat-textarea');
  const text = ta?.value.trim();
  if (!text || !_chat.id) return;
  const btn = document.getElementById('chat-send-btn');
  if (btn) btn.disabled = true;
  ta.value = ''; chatAutoResize(ta);

  const msg = { chat_id: _chat.id, sender_id: _chat.myId, sender_name: _chat.myName, text, created_at: new Date().toISOString() };
  _chatAppend(msg); // optimistic

  await sendMessage(_chat.id, _chat.myId, _chat.myName, text);

  // Notify other party
  if (_chat.otherTgId && String(_chat.otherTgId) !== String(_chat.myId)) {
    notifyChatMessage(_chat.id, _chat.otherTgId, _chat.myName, text);
  }

  if (btn) btn.disabled = false;
}

function _chatRender(msgs) {
  const box = document.getElementById('chat-messages');
  if (!box) return;
  if (!msgs.length) {
    box.innerHTML = '<div class="chat-empty-msg"><div class="chat-empty-msg-icon">💬</div><div>Напишите первое сообщение</div></div>';
    return;
  }
  box.innerHTML = msgs.map(m => _bubbleHtml(m)).join('');
  box.scrollTop = box.scrollHeight;
}

function _chatAppend(m) {
  const box = document.getElementById('chat-messages');
  if (!box) return;
  box.querySelector('.chat-empty-msg')?.remove();
  const el = document.createElement('div');
  el.style.cssText = `display:flex;flex-direction:column;align-items:${String(m.sender_id) === _chat.myId ? 'flex-end' : 'flex-start'};width:100%`;
  el.innerHTML = _bubbleHtml(m);
  box.appendChild(el);
  box.scrollTop = box.scrollHeight;
}

function _bubbleHtml(m) {
  const me = String(m.sender_id) === String(_chat.myId);
  const t  = m.created_at ? new Date(m.created_at).toLocaleTimeString('ru-RU', { hour:'2-digit', minute:'2-digit' }) : '';
  return `<div style="display:flex;flex-direction:column;align-items:${me?'flex-end':'flex-start'};width:100%">
    <div class="chat-bubble ${me?'me':'other'}">
      ${!me ? `<div class="chat-bubble-name">${esc(m.sender_name || 'Собеседник')}</div>` : ''}
      ${esc(m.text)}
      <div class="chat-bubble-time">${t}</div>
    </div></div>`;
}

export function chatAutoResize(el) {
  if (!el) return;
  el.style.height = 'auto';
  el.style.height = Math.min(el.scrollHeight, 110) + 'px';
}

function goBack() { goTo(_chat.backScreen || 'screen-home'); }

window._chat = { openChatEr, openChatWorker, openChatFromInvWorker, openChatFromInvEmployer, sendChatMsg, chatAutoResize, goBack, initChatNotifications, getChatUnread };
