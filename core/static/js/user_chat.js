// core/static/js/user_chat.js

(function () {
  const overlay = document.getElementById('stationeryChatOverlay');
  if (!overlay) return;

  const ROLE = overlay.dataset.role || 'stationery';
  const BODY_LOCK_CLASS = 'stationery-chat-open';

  const chatWidget = document.querySelector(`.chat-widget[data-role="${ROLE}"]`);
  const toggle = chatWidget?.querySelector('.chat-toggle');
  const toggleBadge = chatWidget?.querySelector('.chat-badge');

  const notificationCenter = document.querySelector(`.chat-notification-center[data-role="${ROLE}"]`);
  const notificationToggle = notificationCenter?.querySelector('.chat-notification-toggle');
  const notificationBadge = notificationCenter?.querySelector('.chat-notification-badge');
  const notificationPanel = notificationCenter?.querySelector('.chat-notification-panel');
  const notificationClose = notificationCenter?.querySelector('.chat-notification-close');
  const notificationList = notificationCenter?.querySelector('.chat-notification-list');

  const messagesEl = document.getElementById('stationeryChatMessages');
  const composerForm = document.getElementById('stationeryChatComposer');
  const messageInput = document.getElementById('stationeryChatMessageInput');
  const fileInput = document.getElementById('stationeryChatFileInput');
  const attachBtn = document.getElementById('stationeryChatAttachBtn');
  const voiceBtn = document.getElementById('stationeryChatVoiceBtn');
  const attachmentPreview = document.getElementById('stationeryChatAttachmentPreview');
  const sendBtn = composerForm?.querySelector('.send-btn');
  const closeControls = overlay.querySelectorAll('[data-action="close"]');

  const threadCard = document.getElementById('stationeryChatThread');
  const threadPreview = document.getElementById('stationeryChatThreadPreview');
  const threadTime = document.getElementById('stationeryChatThreadTime');
  const threadBadge = document.getElementById('stationeryChatThreadBadge');
  const avatarEl = document.getElementById('stationeryChatAvatar');
  const titleEl = document.getElementById('stationeryChatTitle');
  const subtitleEl = document.getElementById('stationeryChatSubtitle');

  let notificationCache = [];
  let pollTimer = null;
  let notificationPollTimer = null;
  let attachmentObjectUrl = null;
  let isOverlayOpen = false;
  let recorder = null;
  let recordingStream = null;
  let audioChunks = [];
  let recording = false;
  let recordingTimer = null;
  let recordingStart = null;
  let recordingCancelled = false;
  let lastRecordingDuration = null;

  function openAttachmentPreview(url) {
    if (!url) return;
    const win = window.open(url, '_blank', 'noopener');
    if (!win) {
      window.location.href = url;
    }
  }

  async function deleteMessage(messageId) {
    if (!messageId) return;
    try {
      const response = await fetch(`/api/help-thread/messages/${messageId}/`, {
        method: 'DELETE',
        headers: {
          'X-CSRFToken': getCookie('csrftoken')
        }
      });
      if (!response.ok && response.status !== 204) {
        const payload = await response.json().catch(() => ({}));
        const message = payload?.message || 'Unable to delete message.';
        window.showMessage ? window.showMessage(message, true) : alert(message);
        return;
      }
      document.dispatchEvent(new CustomEvent('chat:thread-updated', { detail: { source: 'user_chat', action: 'delete_message' } }));
      await loadThread({ scrollToBottom: false });
    } catch (err) {
      console.error('[user_chat] deleteMessage error:', err);
      window.showMessage ? window.showMessage('Unable to delete message.', true) : alert('Unable to delete message.');
    }
  }

  function handleMessageContextMenu(event) {
    const messageEl = event.target.closest('[data-message-id]');
    if (!messageEl) return;
    event.preventDefault();
    const messageId = messageEl.dataset.messageId;
    if (!messageId) return;
    const confirmed = window.confirm('Delete this message?');
    if (!confirmed) return;
    deleteMessage(messageId);
  }

  function setBodyLock(active) {
    document.body.classList.toggle(BODY_LOCK_CLASS, active);
  }

  function getCookie(name) {
    let cookieValue = null;
    if (document.cookie && document.cookie !== '') {
      const cookies = document.cookie.split(';');
      for (let i = 0; i < cookies.length; i++) {
        const cookie = cookies[i].trim();
        if (cookie.startsWith(name + '=')) {
          cookieValue = decodeURIComponent(cookie.substring(name.length + 1));
          break;
        }
      }
    }
    return cookieValue;
  }

  function escapeHtml(value) {
    if (value === null || value === undefined) return '';
    return String(value)
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;')
      .replace(/'/g, '&#39;');
  }

  function formatFileSize(bytes) {
    if (!bytes || Number.isNaN(bytes)) return '';
    if (bytes >= 1024 * 1024) {
      return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
    }
    return `${(bytes / 1024).toFixed(1)} KB`;
  }

  function formatTimestamp(value) {
    if (!value) return '';
    const date = new Date(value);
    if (Number.isNaN(date.getTime())) return '';
    const today = new Date();
    const sameDay = date.toDateString() === today.toDateString();
    if (sameDay) {
      return date.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
    }
    return date.toLocaleDateString([], { month: 'short', day: 'numeric' });
  }

  function formatDateTime(value) {
    if (!value) return '';
    const date = new Date(value);
    if (Number.isNaN(date.getTime())) return '';
    return date.toLocaleString([], {
      hour: '2-digit',
      minute: '2-digit',
      month: 'short',
      day: 'numeric'
    });
  }

  function summarizeMessage(message) {
    if (!message) return 'No messages yet.';
    if (message.content) {
      const trimmed = message.content.trim();
      if (trimmed.length > 60) return `${trimmed.slice(0, 57)}...`;
      if (trimmed.length > 0) return trimmed;
    }
    switch (message.attachment_type) {
      case 'audio': return '🎙️ Voice message';
      case 'image': return '📷 Photo';
      case 'video': return '🎞️ Video';
      case 'document': return '📄 Document';
      default:
        if (message.attachment_type) return '📎 Attachment';
        return 'No messages yet.';
    }
  }

  function detectAttachmentKind(file) {
    if (!file) return 'file';
    const mime = (file.type || '').toLowerCase();
    if (mime.startsWith('image/')) return 'image';
    if (mime.startsWith('video/')) return 'video';
    if (mime.startsWith('audio/')) return 'audio';
    if (mime === 'application/pdf') return 'document';
    const ext = (file.name || '').split('.').pop().toLowerCase();
    if (['pdf', 'doc', 'docx', 'ppt', 'pptx', 'xls', 'xlsx', 'csv'].includes(ext)) return 'document';
    return 'file';
  }

  function autoScrollToBottom(element, attempts = 6, delay = 80) {
    if (!element) return;
    let count = 0;
    const tick = () => {
      element.scrollTop = element.scrollHeight;
      count += 1;
      if (count < attempts) requestAnimationFrame(tick);
    };
    requestAnimationFrame(tick);
    if (delay > 0) setTimeout(() => { element.scrollTop = element.scrollHeight; }, delay);
  }

  function autoScrollAfterMedia(element) {
    if (!element) return;
    const mediaNodes = element.querySelectorAll('img, video, audio');
    mediaNodes.forEach(node => {
      const handler = () => autoScrollToBottom(element, 6, 120);
      if (node.tagName === 'IMG') {
        if (node.complete) handler();
        else node.addEventListener('load', handler, { once: true });
      } else if (node.readyState >= 1) {
        handler();
      } else {
        node.addEventListener('loadeddata', handler, { once: true });
      }
    });
  }

  let suppressUnreadBroadcast = false;

  function updateNotificationBadge(count) {
    if (!notificationBadge) return;
    const value = Number(count || 0);
    if (value > 0) {
      notificationBadge.textContent = String(value);
      notificationBadge.classList.remove('hidden');
    } else {
      notificationBadge.textContent = '';
      notificationBadge.classList.add('hidden');
    }
  }

  function updateToggleBadge(count) {
    if (!toggleBadge) return;
    const value = Number(count || 0);
    if (value > 0) {
      toggleBadge.textContent = String(value);
      toggleBadge.classList.remove('hidden');
    } else {
      toggleBadge.textContent = '';
      toggleBadge.classList.add('hidden');
    }
    if (!suppressUnreadBroadcast) {
      document.dispatchEvent(new CustomEvent('chat:unread-update', {
        detail: { count: value, role: ROLE, source: 'user_chat' }
      }));
    }
  }

  function updateThreadBadge(count) {
    if (!threadBadge) return;
    const value = Number(count || 0);
    if (value > 0) {
      threadBadge.textContent = String(value);
      threadBadge.classList.remove('hidden');
      threadCard?.classList.add('has-unread');
    } else {
      threadBadge.textContent = '';
      threadBadge.classList.add('hidden');
      threadCard?.classList.remove('has-unread');
    }
  }

  function resetAttachmentPreview() {
    if (attachmentObjectUrl) {
      URL.revokeObjectURL(attachmentObjectUrl);
      attachmentObjectUrl = null;
    }
    if (attachmentPreview) {
      attachmentPreview.classList.remove('active');
      attachmentPreview.innerHTML = '';
      delete attachmentPreview.dataset.kind;
      delete attachmentPreview.dataset.duration;
    }
    if (fileInput) fileInput.value = '';
  }

  function renderAttachmentPreview({ kind, name, size, url }) {
    if (!attachmentPreview) return;
    attachmentPreview.classList.add('active');
    attachmentPreview.dataset.kind = kind;
    const safeName = escapeHtml(name || 'Attachment');
    const sizeText = size ? formatFileSize(size) : '';
    let thumb = '<div class="thumb icon"><i class="fas fa-paperclip"></i></div>';
    if (kind === 'image' && url) {
      thumb = `<div class="thumb media"><img src="${url}" alt="${safeName}"></div>`;
    } else if (kind === 'video' && url) {
      thumb = `<div class="thumb media"><video src="${url}" muted loop playsinline></video></div>`;
    } else if (kind === 'audio') {
      thumb = '<div class="thumb icon"><i class="fas fa-microphone"></i></div>';
    } else if (kind === 'document') {
      thumb = '<div class="thumb icon"><i class="fas fa-file-alt"></i></div>';
    }
    attachmentPreview.innerHTML = `
      <div class="preview-card ${kind}">
        ${thumb}
        <div class="info">
          <span class="title">${safeName}</span>
          ${sizeText ? `<span class="meta">${sizeText}</span>` : ''}
        </div>
        <button type="button" class="remove-attachment" aria-label="Remove attachment">×</button>
      </div>
    `;
  }

  function renderRecordingPreview() {
    if (!attachmentPreview) return;
    attachmentPreview.classList.add('active', 'recording');
    attachmentPreview.dataset.kind = 'audio';
    attachmentPreview.innerHTML = `
      <div class="preview-card recording" data-role="recording-card">
        <button type="button" class="recording-stop" data-action="stop-recording" aria-label="Stop recording">
          <i class="fas fa-stop"></i>
        </button>
        <div class="timer">
          <span class="dot"></span>
          <span class="value" data-role="recording-timer">0:00</span>
        </div>
        <div class="spacer"></div>
        <button type="button" class="recording-cancel" data-action="cancel-recording" aria-label="Cancel recording">
          <i class="fas fa-trash"></i>
        </button>
      </div>
    `;
  }

  function updateRecordingTimerDisplay() {
    if (!attachmentPreview || !recordingStart) return;
    const timerEl = attachmentPreview.querySelector('[data-role="recording-timer"]');
    if (!timerEl) return;
    const duration = Date.now() - recordingStart;
    const totalSeconds = Math.max(0, Math.floor(duration / 1000));
    const minutes = Math.floor(totalSeconds / 60);
    const seconds = totalSeconds % 60;
    timerEl.textContent = `${minutes}:${seconds.toString().padStart(2, '0')}`;
    attachmentPreview.dataset.duration = duration;
  }

  function handleAttachmentPreviewClick(event) {
    const stopBtn = event.target.closest('[data-action="stop-recording"]');
    if (stopBtn && recording) {
      event.preventDefault();
      stopRecording(false);
      return;
    }
    const cancelBtn = event.target.closest('[data-action="cancel-recording"], .remove-attachment');
    if (cancelBtn) {
      event.preventDefault();
      if (recording) {
        stopRecording(true);
      }
      resetAttachmentPreview();
    }
  }

  function buildAttachmentMarkup(message) {
    if (!message?.attachment_url) return '';
    const safeName = escapeHtml(message.attachment_name || 'Attachment');
    const sizeText = message.attachment_size ? formatFileSize(message.attachment_size) : '';
    const rawUrl = message.attachment_url;
    const previewUrl = message.id ? `/media/help-attachments/${message.id}/` : rawUrl;
    switch (message.attachment_type) {
      case 'image':
        return `
          <div class="chat-attachment image">
            <img src="${previewUrl}" alt="${safeName}">
            <div class="actions">
              <a class="btn" href="${previewUrl}" target="_blank" rel="noopener">View</a>
              <a class="btn" href="${rawUrl}" download>Download</a>
            </div>
          </div>
        `;
      case 'video':
        return `
          <div class="chat-attachment video">
            <video controls src="${previewUrl}"></video>
            <div class="actions">
              <a class="btn" href="${previewUrl}" target="_blank" rel="noopener">Open</a>
              <a class="btn" href="${rawUrl}" download>Download</a>
            </div>
          </div>
        `;
      case 'audio':
        return `
          <div class="chat-attachment audio">
            <div class="icon"><i class="fas fa-microphone"></i></div>
            <audio controls src="${previewUrl}"></audio>
            <div class="details">
              <span class="name">${safeName}</span>
            </div>
          </div>
        `;
      case 'document':
      case 'file':
      default:
        return `
          <div class="chat-attachment file">
            <div class="icon"><i class="fas fa-paperclip"></i></div>
            <div class="details">
              <span class="name">${safeName}</span>
              ${sizeText ? `<span class="size">${sizeText}</span>` : ''}
            </div>
            <div class="actions">
              <button type="button" class="btn" data-action="open-preview" data-url="${previewUrl}">View</button>
              <a class="btn" href="${rawUrl}" download>Download</a>
            </div>
          </div>
        `;
    }
  }

  async function startRecording() {
    try {
      recordingStream = await navigator.mediaDevices.getUserMedia({ audio: true });
    } catch (err) {
      console.error('[user_chat] startRecording error:', err);
      if (window.showMessage) window.showMessage('Microphone not available.', true);
      return;
    }
    recorder = new MediaRecorder(recordingStream);
    audioChunks = [];
    recordingCancelled = false;
    recorder.addEventListener('dataavailable', (event) => {
      if (event.data.size > 0) audioChunks.push(event.data);
    });
    recorder.addEventListener('stop', () => {
      if (recordingTimer) {
        clearInterval(recordingTimer);
        recordingTimer = null;
      }
      if (recordingStream) {
        recordingStream.getTracks().forEach(track => track.stop());
        recordingStream = null;
      }
      if (recordingCancelled) {
        audioChunks = [];
        resetAttachmentPreview();
        recordingCancelled = false;
        return;
      }
      if (!audioChunks.length) {
        resetAttachmentPreview();
        return;
      }
      const blob = new Blob(audioChunks, { type: 'audio/webm' });
      const file = new File([blob], `voice-${Date.now()}.webm`, { type: 'audio/webm' });
      const transfer = new DataTransfer();
      transfer.items.add(file);
      if (fileInput) {
        fileInput.files = transfer.files;
        handleFileChange({ preserveDuration: lastRecordingDuration });
      }
    });
    recorder.start();
    recording = true;
    recordingStart = Date.now();
    lastRecordingDuration = null;
    voiceBtn?.classList.add('recording');
    renderRecordingPreview();
    updateRecordingTimerDisplay();
    recordingTimer = setInterval(updateRecordingTimerDisplay, 500);
  }

  function stopRecording(cancel = false) {
    if (!recording) return;
    recording = false;
    recordingCancelled = cancel;
    if (!cancel && recordingStart) {
      lastRecordingDuration = Date.now() - recordingStart;
    }
    voiceBtn?.classList.remove('recording');
    if (recordingTimer) {
      clearInterval(recordingTimer);
      recordingTimer = null;
    }
    try {
      recorder?.stop();
    } catch (err) {
      console.error('[user_chat] stopRecording error:', err);
    }
    recorder = null;
    recordingStart = null;
  }

  async function toggleRecording() {
    if (recording) {
      stopRecording(false);
      return;
    }
    resetAttachmentPreview();
    await startRecording();
  }

  function renderMessages(messages) {
    if (!messagesEl) return;
    const list = Array.isArray(messages) ? messages : [];
    if (list.length === 0) {
      messagesEl.innerHTML = '<div class="empty">No messages yet.</div>';
      return;
    }
    const html = list.map(msg => {
      const isSelf = msg.sender_role !== 'admin';
      const classes = ['admin-chat-message'];
      if (isSelf) classes.push('self');
      const safeContent = msg.content ? `<p>${escapeHtml(msg.content)}</p>` : '';
      const attachmentMarkup = buildAttachmentMarkup(msg);
      const metaLabel = isSelf ? 'You' : (msg.sender_username || 'Admin');
      const timestamp = formatDateTime(msg.created_at);
      return `
        <div class="${classes.join(' ')}" data-message-id="${msg.id}" data-sender-role="${msg.sender_role || ''}">
          ${safeContent || attachmentMarkup || '<p>(no content)</p>'}
          ${attachmentMarkup && safeContent ? attachmentMarkup : ''}
          <div class="meta">${metaLabel} • ${timestamp}</div>
        </div>
      `;
    }).join('');
    messagesEl.innerHTML = html;
    autoScrollToBottom(messagesEl, 8, 100);
    autoScrollAfterMedia(messagesEl);
  }

  function updateThreadSummary(data) {
    const title = data?.admin_name || 'Admin Team';
    const subtitle = data?.admin_email || 'Help Center thread';
    if (titleEl) titleEl.textContent = title;
    if (subtitleEl) subtitleEl.textContent = subtitle;
    if (threadPreview) {
      const messages = Array.isArray(data?.messages) ? data.messages : [];
      const lastMessage = messages.length ? messages[messages.length - 1] : null;
      threadPreview.textContent = summarizeMessage(lastMessage);
      threadTime.textContent = formatTimestamp(lastMessage?.created_at);
      const unread = messages.filter(msg => msg.sender_role === 'admin' && msg.is_user_read === false).length;
      updateThreadBadge(unread);
    }
    if (avatarEl && title) {
      const initials = title.split(' ').map(part => part.charAt(0)).join('').slice(0, 2).toUpperCase();
      avatarEl.textContent = initials || 'AD';
    }
  }

  function renderConversation(data) {
    threadData = data;
    const messages = Array.isArray(data?.messages) ? data.messages : [];
    renderMessages(messages);
    updateThreadSummary(data);
  }

  async function loadThread({ scrollToBottom = true, markRead = false } = {}) {
    try {
      const response = await fetch(`/api/help-thread/${markRead ? '?mark_read=1' : ''}`);
      if (response.status === 401) {
        window.location.href = '/login/';
        return;
      }
      if (!response.ok) {
        throw new Error('Unable to load conversation');
      }
      const data = await response.json();
      renderConversation(data);
      if (markRead) {
        await markThreadRead();
      }
      if (scrollToBottom) {
        autoScrollToBottom(messagesEl, 8, 100);
      }
    } catch (err) {
      console.error('[user_chat] loadThread error:', err);
      if (messagesEl) messagesEl.innerHTML = '<div class="empty">Unable to load conversation.</div>';
    }
  }

  function normalizeNotifications(data) {
    const notifications = Array.isArray(data?.notifications) ? data.notifications : [];
    return notifications
      .filter(item => item.notification_type === 'help_reply')
      .map(item => ({
        id: item.id,
        message: item.message,
        created_at: item.created_at,
        is_read: item.is_read,
        link: '/issue/?chat=open'
      }));
  }

  function renderNotificationList(entries) {
    if (!notificationList) return;
    notificationList.innerHTML = '';
    if (!entries || entries.length === 0) {
      notificationList.innerHTML = '<p class="notification-empty">No notifications yet.</p>';
      return;
    }
    const fragment = document.createDocumentFragment();
    entries.forEach(entry => {
      const item = document.createElement('div');
      item.className = `notification-item${entry.is_read ? '' : ' unread'}`;

      const button = document.createElement('button');
      button.type = 'button';
      button.className = 'notification-main';
      button.innerHTML = `
        <div class="icon"><i class="fas fa-headset"></i></div>
        <div class="content">
          <strong>${escapeHtml(entry.message)}</strong>
          <div class="meta">${formatDateTime(entry.created_at)}</div>
        </div>
      `;
      button.addEventListener('click', async () => {
        if (!entry.is_read) {
          await markNotificationRead(entry.id);
          entry.is_read = true;
          item.classList.remove('unread');
          updateNotificationState();
        }
        openOverlay();
      });

      const dismiss = document.createElement('button');
      dismiss.type = 'button';
      dismiss.className = 'notification-dismiss';
      dismiss.innerHTML = '<i class="fas fa-times"></i>';
      dismiss.addEventListener('click', async (event) => {
        event.stopPropagation();
        dismiss.disabled = true;
        const success = await markNotificationRead(entry.id);
        if (!success) {
          dismiss.disabled = false;
          return;
        }
        entry.is_read = true;
        item.classList.remove('unread');
        updateNotificationState();
        dismiss.disabled = false;
      });

      item.appendChild(button);
      item.appendChild(dismiss);
      fragment.appendChild(item);
    });
    notificationList.appendChild(fragment);
  }

  async function fetchNotifications() {
    try {
      const response = await fetch('/api/notifications/');
      if (!response.ok) return;
      const data = await response.json();
      notificationCache = normalizeNotifications(data);
      renderNotificationList(notificationCache);
      updateNotificationState();
    } catch (err) {
      console.error('[user_chat] fetchNotifications error:', err);
    }
  }

  function updateNotificationState() {
    const unread = notificationCache.filter(item => !item.is_read).length;
    updateNotificationBadge(unread);
    updateToggleBadge(unread);
    window.dispatchEvent(new CustomEvent('unreadCountChange', { detail: { unread, source: 'user-chat' } }));
  }

  async function markNotificationRead(id) {
    try {
      const response = await fetch(`/api/notifications/${id}/read/`, {
        method: 'POST',
        headers: {
          'X-CSRFToken': getCookie('csrftoken')
        }
      });
      if (!response.ok) {
        throw new Error('Failed to mark notification as read');
      }
      notificationCache = notificationCache.map(entry => entry.id === id ? { ...entry, is_read: true } : entry);
      return true;
    } catch (err) {
      console.error('[user_chat] markNotificationRead error:', err);
      if (window.showMessage) window.showMessage('Unable to update notification status.', true);
      return false;
    }
  }

  async function markThreadRead() {
    try {
      const response = await fetch('/api/help-thread/mark-read/', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'X-CSRFToken': getCookie('csrftoken')
        },
        body: JSON.stringify({})
      });
      if (response.ok) {
        notificationCache = notificationCache.map(entry => ({ ...entry, is_read: true }));
        updateNotificationState();
        renderNotificationList(notificationCache);
      }
    } catch (err) {
      console.error('[user_chat] markThreadRead error:', err);
    }
  }

  async function sendMessage(event) {
    event.preventDefault();
    if (!composerForm || !messageInput) return;
    const content = messageInput.value.trim();
    const file = fileInput?.files?.[0];
    const attachmentKind = attachmentPreview?.dataset.kind;
    if (!content && !file) {
      messageInput.focus();
      return;
    }
    const formData = new FormData();
    if (content) {
      formData.append('content', content);
    }
    if (file) {
      formData.append('attachment', file);
      const kind = detectAttachmentKind(file);
      formData.append('attachment_type', kind);
      if (kind === 'audio') {
        const duration = attachmentPreview?.dataset.duration || lastRecordingDuration;
        if (duration) {
          formData.append('attachment_duration', Math.floor(duration));
        }
      }
    }

    messageInput.disabled = true;
    sendBtn?.setAttribute('disabled', 'disabled');

    try {
      const response = await fetch('/api/help-thread/messages/', {
        method: 'POST',
        headers: {
          'X-CSRFToken': getCookie('csrftoken')
        },
        body: formData
      });
      if (response.status === 401) {
        window.location.href = '/login/';
        return;
      }
      if (!response.ok) {
        throw new Error('Unable to send message');
      }
      messageInput.value = '';
      resetAttachmentPreview();
      await loadThread({ scrollToBottom: true });
      await fetchNotifications();
    } catch (err) {
      console.error('[user_chat] sendMessage error:', err);
      if (window.showMessage) window.showMessage(err.message || 'Unable to send message.', true);
    } finally {
      messageInput.disabled = false;
      sendBtn?.removeAttribute('disabled');
      messageInput.focus();
    }
  }

  function handleFileChange(options = {}) {
    if (recording) return;
    const file = fileInput?.files?.[0];
    if (!file) {
      resetAttachmentPreview();
      return;
    }
    if (attachmentObjectUrl) {
      URL.revokeObjectURL(attachmentObjectUrl);
      attachmentObjectUrl = null;
    }
    const kind = detectAttachmentKind(file);
    const needsPreview = ['image', 'video'].includes(kind);
    const url = needsPreview ? URL.createObjectURL(file) : null;
    if (url) attachmentObjectUrl = url;
    renderAttachmentPreview({ kind, name: file.name, size: file.size, url });
    if (kind === 'audio') {
      const preserved = options?.preserveDuration;
      if (preserved) {
        attachmentPreview.dataset.duration = preserved;
      }
    }
  }

  function toggleNotificationPanel(force) {
    if (!notificationPanel) return;
    const shouldShow = force != null ? force : notificationPanel.classList.contains('hidden');
    notificationPanel.classList.toggle('hidden', !shouldShow);
  }

  async function openOverlay(options = {}) {
    if (isOverlayOpen) {
      await loadThread({ scrollToBottom: options.scrollToBottom !== false, markRead: true });
      return;
    }
    overlay.classList.remove('hidden');
    setBodyLock(true);
    isOverlayOpen = true;
    await loadThread({ scrollToBottom: options.scrollToBottom !== false, markRead: true });
  }

  function closeOverlay() {
    overlay.classList.add('hidden');
    setBodyLock(false);
    isOverlayOpen = false;
    if (recording) {
      stopRecording(true);
    }
    resetAttachmentPreview();
  }

  function startPolling() {
    if (!notificationPollTimer) {
      notificationPollTimer = setInterval(fetchNotifications, 10000);
    }
    if (!pollTimer) {
      pollTimer = setInterval(() => {
        if (isOverlayOpen) {
          loadThread({ scrollToBottom: false });
        }
      }, 4000);
    }
  }

  function stopPolling() {
    if (pollTimer) {
      clearInterval(pollTimer);
      pollTimer = null;
    }
    if (notificationPollTimer) {
      clearInterval(notificationPollTimer);
      notificationPollTimer = null;
    }
  }

  function handleEscape(event) {
    if (event.key === 'Escape' && isOverlayOpen) {
      if (recording) {
        stopRecording(true);
      }
      closeOverlay();
    }
  }

  // Event bindings
  toggle?.addEventListener('click', () => openOverlay());
  threadCard?.addEventListener('click', () => openOverlay());
  composerForm?.addEventListener('submit', sendMessage);
  attachBtn?.addEventListener('click', () => fileInput?.click());
  voiceBtn?.addEventListener('click', () => toggleRecording());
  fileInput?.addEventListener('change', () => handleFileChange());
  attachmentPreview?.addEventListener('click', handleAttachmentPreviewClick);
  messagesEl?.addEventListener('click', (event) => {
    const previewBtn = event.target.closest('[data-action="open-preview"]');
    if (previewBtn) {
      event.preventDefault();
      openAttachmentPreview(previewBtn.dataset.url);
    }
  });
  messagesEl?.addEventListener('contextmenu', handleMessageContextMenu);
  closeControls.forEach(btn => btn.addEventListener('click', closeOverlay));
  overlay.addEventListener('click', (event) => {
    if (event.target.dataset.action === 'close') closeOverlay();
  });
  document.addEventListener('keydown', handleEscape);

  notificationToggle?.addEventListener('click', (event) => {
    event.stopPropagation();
    const panelWasHidden = notificationPanel?.classList.contains('hidden');
    toggleNotificationPanel();
    if (panelWasHidden) {
      fetchNotifications();
    }
  });
  notificationClose?.addEventListener('click', (event) => {
    event.stopPropagation();
    toggleNotificationPanel(false);
  });
  document.addEventListener('click', (event) => {
    if (!notificationCenter || !notificationPanel) return;
    if (!notificationCenter.contains(event.target)) {
      notificationPanel.classList.add('hidden');
    }
  });

  // Initial load
  fetchNotifications();
  loadThread({ scrollToBottom: false });
  startPolling();

  const params = new URLSearchParams(window.location.search);
  const chatParam = params.get('chat');
  if (chatParam === 'open') {
    openOverlay();
    params.delete('chat');
    const newUrl = `${window.location.pathname}${params.toString() ? `?${params}` : ''}`;
    window.history.replaceState({}, document.title, newUrl);
  }

  window.AIMSChat = Object.assign(window.AIMSChat || {}, {
    openFromNotification: async () => {
      await openOverlay();
      toggleNotificationPanel(false);
    }
  });

  window.addEventListener('beforeunload', () => {
    stopPolling();
    if (recording) {
      stopRecording(true);
    }
    if (attachmentObjectUrl) URL.revokeObjectURL(attachmentObjectUrl);
  });

  document.addEventListener('chat:unread-update', (event) => {
    const detail = event.detail || {};
    if (!detail || detail.role !== ROLE || detail.source === 'user_chat') {
      return;
    }
    const value = Number(detail.count || 0);
    suppressUnreadBroadcast = true;
    updateNotificationBadge(value);
    updateToggleBadge(value);
    suppressUnreadBroadcast = false;
  });

  document.addEventListener('chat:thread-updated', (event) => {
    const detail = event.detail || {};
    if (detail.source === 'user_chat') return;
    loadThread({ scrollToBottom: false });
    fetchNotifications();
  });
})();
