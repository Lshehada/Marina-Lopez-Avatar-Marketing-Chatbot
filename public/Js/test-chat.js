import { isAvatarStopCommand } from './avatar-controls.js';
import {
  LiveAvatarSession
} from 'https://esm.sh/@heygen/liveavatar-web-sdk@0.0.19?bundle';

const statusEl = document.querySelector('#status-text');
const messagesEl = document.querySelector('#messages');
const form = document.querySelector('#chat-form');
const input = document.querySelector('#message-input');
const sendButton = document.querySelector('#send-button');

const marinaLauncher = document.querySelector('#marina-launcher');
const marinaChatPanel = document.querySelector('#marina-chat-panel');
const marinaMinimize = document.querySelector('#marina-minimize');
const marinaClose = document.querySelector('#marina-close');
const resumeConversationButton = document.querySelector('#resume-conversation');

const startAvatarChatButton =
  document.querySelector('#start-avatar-chat');

const stopAvatarChatButton =
  document.querySelector('#stop-avatar-chat');

const avatarChatContainer =
  document.querySelector('#avatar-chat-container');

const liveAvatarVideo =
  document.querySelector('#liveavatar-video');

const avatarLiveStatus =
  document.querySelector('#avatar-live-status');

let conversationId = null;
let currentLanguage = 'en';

let conversationClosed = false;
let requestInProgress = false;
let awaitingCloseReply = false;

let inactivityTimer = null;
let noResponseCloseTimer = null;

let liveAvatarSession = null;
let avatarChatActive = false;
let avatarGeneration = 0;
let avatarStarting = false;
let avatarSpeaking = false;
let avatarSpeechStopped = false;
const avatarQuestionForm = document.querySelector('#avatar-question-form');
const avatarQuestionInput = document.querySelector('#avatar-question-input');
const avatarQuestionSend = document.querySelector('#avatar-question-send');
const avatarMicToggle = document.querySelector('#avatar-mic-toggle');
const avatarClose = document.querySelector('#close-avatar-chat');

const inactivityDelay = 25 * 60 * 1000;
const confirmationDelay = 5 * 60 * 1000;

const supportedLanguages = [
  'en',
  'de',
  'it',
  'es',
  'fr'
];


/*
 * =========================================================
 * GENERAL UI HELPERS
 * =========================================================
 */

function setStatus(text) {
  if (statusEl) {
    statusEl.textContent = String(text || '');
  }
}

function setAvatarStatus(text) {
  if (!avatarLiveStatus) {
    return;
  }

  document.querySelector('#avatar-status-text').textContent = text;
}

function setInputState(disabled) {
  if (input) {
    input.disabled = Boolean(disabled);
  }

  if (sendButton) {
    sendButton.disabled = Boolean(disabled);
  }
}

function focusInput() {
  if (
    input &&
    !input.disabled &&
    !conversationClosed &&
    !avatarChatActive
  ) {
    input.focus();
  }
}

function getRenderedLineCount(element) {
  const styles =
    window.getComputedStyle(element);

  const lineHeight =
    Number.parseFloat(styles.lineHeight);

  if (!Number.isFinite(lineHeight) || lineHeight <= 0) {
    return 0;
  }

  const paddingTop =
    Number.parseFloat(styles.paddingTop) || 0;

  const paddingBottom =
    Number.parseFloat(styles.paddingBottom) || 0;

  const contentHeight =
    element.scrollHeight - paddingTop - paddingBottom;

  return Math.round(contentHeight / lineHeight);
}

function formatAssistantMessage(text, separateQuestion = false) {
  const message =
    String(text || '');

  const trimmed =
    message.trim();

  if (
    !separateQuestion ||
    !trimmed ||
    !trimmed.endsWith('?')
  ) {
    return message;
  }

  const questionStart =
    Math.max(
      trimmed.lastIndexOf('. '),
      trimmed.lastIndexOf('! '),
      trimmed.lastIndexOf(': ')
    );

  if (questionStart === -1) {
    return message;
  }

  const splitAt =
    questionStart + 2;

  const answer =
    trimmed.slice(0, splitAt).trim();

  const question =
    trimmed.slice(splitAt).trim();

  if (!answer || !question) {
    return message;
  }

  return `${answer}\n\n${question}`;
}

function addMessage(text, role = 'assistant') {
  if (!text || !messagesEl) {
    return;
  }

  const messageEl =
    document.createElement('div');

  messageEl.className =
    `message ${role}`;

  messageEl.textContent =
    String(text);

  messagesEl.appendChild(messageEl);

  if (
    role === 'assistant' &&
    getRenderedLineCount(messageEl) >= 6
  ) {
    messageEl.textContent =
      formatAssistantMessage(text, true);
  }

  messagesEl.scrollTop =
    messagesEl.scrollHeight;

  return messageEl;
}

// Reserve positions when speech begins, then fill delayed transcripts in place.
// Several user fragments can precede one answer; never force alternating roles.
function createAvatarTranscript() {
  const queues = { visitor: [], assistant: [] };
  const slots = new Map();
  const seen = new Set();
  function key(role, event) {
    return event.source_event_id ? `${role}:${event.source_event_id}` : null;
  }
  function reserve(role, event = {}) {
    const id = key(role, event);
    if (id && slots.has(id)) return slots.get(id);
    const slot = document.createElement('div');
    slot.className = `message ${role}`;
    slot.hidden = true;
    messagesEl.appendChild(slot);
    queues[role].push(slot);
    if (id) slots.set(id, slot);
    return slot;
  }
  function fill(role, event) {
    if (!event.text || (event.event_id && seen.has(event.event_id))) return;
    if (event.event_id) seen.add(event.event_id);
    const slot = slots.get(key(role, event)) || queues[role][0] || reserve(role, event);
    slot.textContent = event.text;
    slot.hidden = false;
    if (
      role === 'assistant' &&
      getRenderedLineCount(slot) >= 6
    ) {
      slot.textContent =
        formatAssistantMessage(event.text, true);
    }
    const index = queues[role].indexOf(slot);
    if (index !== -1) queues[role].splice(index, 1);
    messagesEl.scrollTop = messagesEl.scrollHeight;
  }
  return {
    userSpeaking: (event) => reserve('visitor', event),
    question: (event) => fill('visitor', event),
    speaking: (event) => reserve('assistant', event),
    answer: (event) => fill('assistant', event)
  };
}

function addTrialMessage(text, url) {
  if (!text || !url || !messagesEl) {
    return;
  }

  const messageEl =
    document.createElement('div');

  messageEl.className =
    'message assistant';

  const textNode =
    document.createTextNode(
      `${text} `
    );

  const link =
    document.createElement('a');

  link.href = url;
  link.target = '_blank';
  link.rel = 'noopener noreferrer';
  link.className = 'trial-inline-link';
  link.textContent = 'here';

  messageEl.appendChild(textNode);
  messageEl.appendChild(link);

  messagesEl.appendChild(messageEl);

  if (getRenderedLineCount(messageEl) >= 6) {
    textNode.textContent =
      `${formatAssistantMessage(text, true)} `;
  }

  messagesEl.scrollTop =
    messagesEl.scrollHeight;
}

function getBrowserLanguage() {
  const rawLanguage =
    navigator.languages?.[0] ||
    navigator.language ||
    'en';

  const language =
    String(rawLanguage)
      .toLowerCase()
      .split('-')[0];

  return supportedLanguages.includes(language)
    ? language
    : 'en';
}


/*
 * =========================================================
 * API HELPER
 * =========================================================
 */

async function api(url, body = {}) {
  const response =
    await fetch(url, {
      method: 'POST',

      headers: {
        'Content-Type':
          'application/json'
      },

      credentials: 'include',

      body: JSON.stringify(body)
    });

  const contentType =
    response.headers.get('content-type') || '';

  let data = {};

  if (contentType.includes('application/json')) {
    data = await response.json();
  } else {
    data.error = await response.text();
  }

  if (!response.ok) {
    const error =
      new Error(
        data.error ||
        data.message ||
        'Request failed.'
      );

    error.status = response.status;

    throw error;
  }

  return data;
}


/*
 * =========================================================
 * INACTIVITY / CONVERSATION ENDING
 * =========================================================
 */

function clearInactivityTimer() {
  if (inactivityTimer) {
    clearTimeout(inactivityTimer);
    inactivityTimer = null;
  }
}

function clearNoResponseTimer() {
  if (noResponseCloseTimer) {
    clearTimeout(noResponseCloseTimer);
    noResponseCloseTimer = null;
  }
}

function clearAllTimers() {
  clearInactivityTimer();
  clearNoResponseTimer();
}

function resetInactivityTimer() {
  clearInactivityTimer();

  if (
    !conversationId ||
    conversationClosed ||
    requestInProgress ||
    awaitingCloseReply ||
    avatarChatActive
  ) {
    return;
  }

  inactivityTimer = setTimeout(
    askIfConversationIsFinished,
    inactivityDelay
  );
}

async function askIfConversationIsFinished() {
  if (
    !conversationId ||
    conversationClosed ||
    requestInProgress ||
    avatarChatActive
  ) {
    return;
  }

  requestInProgress = true;
  setInputState(true);

  try {
    const data = await api(
      '/api/chat/session/closing-check',
      {
        conversationId
      }
    );

    if (data.message) {
      addMessage(
        data.message,
        'assistant'
      );
    }

    awaitingCloseReply = true;

    noResponseCloseTimer = setTimeout(
      abandonConversation,
      confirmationDelay
    );

    setStatus(
      'Please confirm whether you would like to continue.'
    );

  } catch (error) {
    console.error(
      'Could not ask closing question:',
      error
    );

    setStatus(
      `Ready · ${currentLanguage}`
    );

  } finally {
    requestInProgress = false;

    if (!conversationClosed) {
      setInputState(false);
      focusInput();
    }
  }
}

async function abandonConversation() {
  if (
    !conversationId ||
    conversationClosed ||
    requestInProgress
  ) {
    return;
  }

  requestInProgress = true;
  setInputState(true);

  try {
    await api(
      '/api/chat/session/abandon',
      {
        conversationId
      }
    );

    conversationClosed = true;
    form.hidden = true;
    resumeConversationButton.hidden = false;

    setStatus(
      'Conversation closed due to inactivity.'
    );

  } catch (error) {
    console.error(
      'Could not abandon conversation:',
      error
    );
  } finally {
    requestInProgress = false;
  }
}

async function endConversation() {
  if (
    !conversationId ||
    conversationClosed ||
    requestInProgress
  ) {
    return;
  }

  clearAllTimers();

  requestInProgress = true;
  setInputState(true);

  try {
    await stopAvatarChat();
    setStatus('Ending conversation...');

    const data = await api(
      '/api/chat/session/end',
      {
        conversationId
      }
    );

    if (data.message) {
      addMessage(
        data.message,
        'assistant'
      );
    }

    conversationClosed = true;
    form.hidden = true;
    resumeConversationButton.hidden = false;

    setStatus(
      'Conversation completed.'
    );

  } catch (error) {
    console.error(
      'Could not end conversation:',
      error
    );

    setStatus('Could not end conversation. Please try × again.');

    addMessage(
      error.message,
      'error'
    );

    setInputState(false);
  } finally {
    requestInProgress = false;
    if (!conversationClosed) {
      resetInactivityTimer();
    }
  }
}

async function continueConversation() {
  if (
    !conversationId ||
    requestInProgress
  ) {
    return;
  }

  clearAllTimers();

  requestInProgress = true;
  setInputState(true);
  resumeConversationButton.disabled = true;

  try {
    const data = await api(
      '/api/chat/session/continue',
      {
        conversationId
      }
    );

    awaitingCloseReply = false;
    conversationClosed = false;
    form.hidden = false;
    resumeConversationButton.hidden = true;

    if (data.message) {
      addMessage(
        data.message,
        'assistant'
      );
    }

    setStatus(
      `Ready · ${currentLanguage}`
    );

  } catch (error) {
    console.error(
      'Could not continue conversation:',
      error
    );

    addMessage(
      error.message,
      'error'
    );

  } finally {
    requestInProgress = false;
    resumeConversationButton.disabled = false;
    setInputState(conversationClosed);
    focusInput();
    resetInactivityTimer();
  }
}

function isFinishReply(message) {
  const normalized =
    String(message || '')
      .trim()
      .toLowerCase();

  return [
    'yes',
    'done',
    'end',
    'close',
    'end chat',
    'end conversation',
    'ja',
    'fertig',
    'beenden',
    'si',
    'sì',
    'termina',
    'terminar',
    'oui',
    'terminer'
  ].includes(normalized);
}

function isContinueReply(message) {
  const normalized =
    String(message || '')
      .trim()
      .toLowerCase();

  return [
    'no',
    'continue',
    'not yet',
    'nein',
    'weiter',
    'non',
    'continuer',
    'no todavía',
    'continua'
  ].includes(normalized);
}


/*
 * =========================================================
 * NORMAL TEXT CHAT
 * =========================================================
 */

async function sendTextMessage(message) {
  if (
    !conversationId ||
    conversationClosed ||
    requestInProgress ||
    avatarChatActive
  ) {
    return;
  }

  clearAllTimers();

  requestInProgress = true;
  setInputState(true);

  addMessage(message, 'visitor');

  try {
    const data = await api(
      '/api/chat/message',
      {
        conversationId,
        message
      }
    );

    if (data.trialUrl) {
      addTrialMessage(
        data.answer,
        data.trialUrl
      );
    } else if (data.answer) {
      addMessage(
        data.answer,
        'assistant'
      );
    }

    currentLanguage =
      data.language ||
      currentLanguage;

    setStatus(
      `Ready · ${currentLanguage}`
    );

  } catch (error) {
    console.error(
      'Message request failed:',
      error
    );

    addMessage(
      error.message,
      'error'
    );

    setStatus(
      'Could not send message.'
    );

  } finally {
    requestInProgress = false;

    if (!conversationClosed) {
      setInputState(false);
      focusInput();
      resetInactivityTimer();
    }
  }
}


/*
 * =========================================================
 * LIVEAVATAR VOICE CHAT
 * =========================================================
 */

function updateAvatarListeningStatus() {
  const voice = liveAvatarSession?.voiceChat;
  const listening = voice?.state === 'ACTIVE' && !voice.isMuted;
  avatarMicToggle.title = listening ? 'Mute microphone' : 'Enable microphone';
  avatarMicToggle.setAttribute('aria-pressed', String(!listening));
  avatarMicToggle.setAttribute('aria-label', listening ? 'Mute microphone' : 'Enable microphone');
  setAvatarStatus(avatarSpeechStopped ? 'Stopped · Ask a question or say continue' : avatarSpeaking ? 'Marina is speaking' : listening
    ? 'Marina is listening' : 'Microphone off · Type a question');
}

function handleAvatarSpeechCommand(text) {
  if (isAvatarStopCommand(text)) {
    avatarSpeechStopped = true;
    avatarSpeaking = false;
    // Keep the microphone live, but suppress queued audio after interruption.
    liveAvatarVideo.muted = true;
    liveAvatarSession?.interrupt();
    updateAvatarListeningStatus();
    return true;
  }
  if (avatarSpeechStopped) {
    liveAvatarSession?.interrupt();
    avatarSpeechStopped = false;
    liveAvatarVideo.muted = false;
  }
  return false;
}

function setAvatarComposerEnabled(enabled) {
  avatarQuestionInput.disabled = !enabled;
  avatarQuestionSend.disabled = !enabled;
  avatarMicToggle.disabled = !enabled;
}

async function startAvatarChat() {
  if (!conversationId || conversationClosed || requestInProgress || avatarChatActive || avatarStarting) return;
  const generation = ++avatarGeneration;
  let session;
  avatarStarting = true;
  avatarSpeechStopped = false;
  liveAvatarVideo.muted = false;
  clearAllTimers();
  startAvatarChatButton.disabled = true;
  marinaChatPanel.classList.add('avatar-mode');
  avatarChatContainer.hidden = false;
  form.hidden = true;
  setAvatarComposerEnabled(false);
  setAvatarStatus('Connecting to Marina...');

  try {
    const data = await api('/api/liveavatar/session', { conversationId });
    if (generation !== avatarGeneration) return;
    if (!data.sessionToken) throw new Error('The avatar session token was not returned by the server.');
    session = new LiveAvatarSession(data.sessionToken, { autoKeepAlive: true, voiceChat: true });
    liveAvatarSession = session;
    const transcript = createAvatarTranscript();
    const on = (name, callback) => session.on(name, (event) => {
      if (generation === avatarGeneration) callback(event);
    });
    on('avatar.speak_started', (event) => {
      if (avatarSpeechStopped) {
        session.interrupt();
        updateAvatarListeningStatus();
        return;
      }
      transcript.speaking(event);
      avatarSpeaking = true;
      setAvatarStatus('Marina is speaking');
    });
    on('avatar.speak_ended', () => {
      avatarSpeaking = false;
      updateAvatarListeningStatus();
    });
    on('user.speak_started', (event) => {
      transcript.userSpeaking(event);
      setAvatarStatus('Marina is listening');
    });
    on('user.speak_ended', () => setAvatarStatus('Marina is thinking...'));
    on('user.transcription', (event) => {
      transcript.question(event);
      handleAvatarSpeechCommand(event.text);
    });
    on('avatar.transcription', (event) => {
      if (!avatarSpeechStopped) transcript.answer(event);
    });
    on('session.disconnected', () => {
      void stopAvatarChat().then(() => {
        setStatus('Video disconnected. You can continue in text chat.');
      });
    });
    await session.start();
    if (generation !== avatarGeneration) {
      await session.stop();
      return;
    }
    session.attach(liveAvatarVideo);
    avatarChatActive = true;
    setAvatarComposerEnabled(true);
    updateAvatarListeningStatus();
  } catch (error) {
    if (generation !== avatarGeneration) return;
    await stopAvatarChat();
    setStatus('Could not start video chat.');
    addMessage(error.message || 'Could not connect to Marina.', 'error');
  } finally {
    if (generation === avatarGeneration) {
      avatarStarting = false;
      startAvatarChatButton.disabled = false;
    }
  }
}

async function stopAvatarChat() {
  ++avatarGeneration;
  const session = liveAvatarSession;
  liveAvatarSession = null;
  avatarStarting = false;
  avatarChatActive = false;
  avatarSpeaking = false;
  avatarSpeechStopped = false;
  liveAvatarVideo.muted = false;
  setAvatarComposerEnabled(false);
  avatarChatContainer.hidden = true;
  marinaChatPanel.classList.remove('avatar-mode');
  liveAvatarVideo.srcObject = null;
  startAvatarChatButton.disabled = false;
  if (!conversationClosed) {
    form.hidden = false;
    setStatus(`Ready · ${currentLanguage}`);
    setInputState(requestInProgress);
    focusInput();
    resetInactivityTimer();
  }
  try {
    // Release the microphone immediately, even if network shutdown is slow.
    session?.voiceChat.stop();
    await session?.stop();
  } catch (error) {
    console.error('Could not stop avatar chat:', error);
  }
}

avatarQuestionInput.addEventListener('keydown', (event) => {
  if (event.key === 'Enter' && !event.shiftKey && !event.isComposing) {
    event.preventDefault();
    avatarQuestionForm.requestSubmit();
  }
});

avatarQuestionForm.addEventListener('submit', (event) => {
  event.preventDefault();
  const message = avatarQuestionInput.value.trim();
  if (!message || !avatarChatActive || !liveAvatarSession || requestInProgress) return;
  try {
    if (handleAvatarSpeechCommand(message)) {
      addMessage(message, 'visitor');
      avatarQuestionInput.value = '';
      return;
    }
    // Uses the session's custom LLM callback, so Marina answers via our backend.
    liveAvatarSession.message(message);
    avatarQuestionInput.value = '';
    setAvatarStatus('Marina is thinking...');
  } catch (error) {
    setAvatarStatus('Could not send. Please try again.');
  }
});

avatarMicToggle.addEventListener('click', async () => {
  const session = liveAvatarSession;
  if (!session || !avatarChatActive) return;
  avatarMicToggle.disabled = true;
  try {
    if (session.voiceChat.state !== 'ACTIVE') await session.voiceChat.start();
    else if (session.voiceChat.isMuted) await session.voiceChat.unmute();
    else await session.voiceChat.mute();
    if (session === liveAvatarSession) updateAvatarListeningStatus();
  } catch (error) {
    if (session === liveAvatarSession) setAvatarStatus('Microphone unavailable · You can type instead');
  } finally {
    if (session === liveAvatarSession) avatarMicToggle.disabled = false;
  }
});

avatarClose.addEventListener('click', closeMarinaChat);


/*
 * =========================================================
 * FLOATING WIDGET
 * =========================================================
 */

function openMarinaChat() {
  marinaChatPanel.hidden = false;
  marinaLauncher.hidden = true;

  messagesEl.scrollTop =
    messagesEl.scrollHeight;

  focusInput();
  if (conversationClosed) {
    resumeConversationButton.focus();
  }
}

function minimizeMarinaChat() {
  marinaChatPanel.hidden = true;
  marinaLauncher.hidden = false;
}

async function closeMarinaChat() {
  if (
    !marinaChatPanel ||
    !marinaLauncher ||
    requestInProgress
  ) {
    return;
  }

  /*
   * If no conversation was created yet, there is nothing to save.
   * Just close the visual widget.
   */
  if (!conversationId || conversationClosed) {
    minimizeMarinaChat();
    return;
  }

  // Hide immediately; saving and analysis can finish in the background.
  minimizeMarinaChat();

  /*
   * Calls POST /api/chat/session/end.
   * This updates the conversations table:
   * - conversation_status = completed
   * - conversation_stage = closed
   * - ended_at = NOW()
   * It also saves Marina's final message and conversation summary.
   */
  await endConversation();
}


/*
 * =========================================================
 * EVENT LISTENERS
 * =========================================================
 */

form.addEventListener(
  'submit',
  async (event) => {
    event.preventDefault();

    const message =
      input.value.trim();

    if (!message) {
      return;
    }

    input.value = '';

    if (awaitingCloseReply) {
      if (isFinishReply(message)) {
        await endConversation();
        return;
      }

      if (isContinueReply(message)) {
        await continueConversation();
        return;
      }

      awaitingCloseReply = false;
    }

    await sendTextMessage(message);
  }
);

input.addEventListener(
  'focus',
  resetInactivityTimer
);

marinaLauncher?.addEventListener(
  'click',
  openMarinaChat
);

marinaMinimize?.addEventListener(
  'click',
  minimizeMarinaChat
);

marinaClose?.addEventListener(
  'click',
  closeMarinaChat
);

resumeConversationButton?.addEventListener(
  'click',
  continueConversation
);

startAvatarChatButton?.addEventListener(
  'click',
  startAvatarChat
);

stopAvatarChatButton?.addEventListener(
  'click',
  stopAvatarChat
);

document.addEventListener(
  'keydown',
  (event) => {
    if (
      event.key === 'Escape' &&
      !marinaChatPanel.hidden
    ) {
      minimizeMarinaChat();
    }
  }
);

window.addEventListener(
  'pagehide',
  () => {
    liveAvatarSession
      ?.stop()
      .catch(() => {});
  }
);


/*
 * =========================================================
 * START MARINA TEXT SESSION
 * =========================================================
 */

async function start() {
  setInputState(true);

  try {
    const query =
      new URLSearchParams(
        window.location.search
      );

    const browserLanguage =
      getBrowserLanguage();

    const data = await api(
      '/api/chat/session',
      {
        token:
          query.get('sdr_token') ||
          query.get('t') ||
          undefined,

        language: browserLanguage,

        landingPage:
          window.location.href,

        referrer:
          document.referrer ||
          undefined,

        source:
          query.get('utm_source')
            ? 'campaign'
            : 'website',

        utmSource:
          query.get('utm_source') ||
          undefined,

        utmMedium:
          query.get('utm_medium') ||
          undefined,

        utmCampaign:
          query.get('utm_campaign') ||
          undefined,

        utmContent:
          query.get('utm_content') ||
          undefined,

        utmTerm:
          query.get('utm_term') ||
          undefined
      }
    );

    conversationId =
      data.conversationId;

    currentLanguage =
      data.language ||
      browserLanguage;

    if (data.welcome) {
      addMessage(
        data.welcome,
        'assistant'
      );
    }

    setStatus(
      data.identified
        ? `Known SDR contact identified · ${currentLanguage}`
        : `Ready · ${currentLanguage}`
    );

    setInputState(false);
    resetInactivityTimer();

  } catch (error) {
    console.error(
      'Session start failed:',
      error
    );

    addMessage(
      error.message ||
      'Could not start Marina.',
      'error'
    );

    setStatus(
      'Could not start session.'
    );
  }
}

start();
