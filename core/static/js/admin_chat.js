// core/static/js/admin_chat.js

(function(){
  const overlay = document.getElementById('adminChatOverlay');
  if (!overlay) {
    window.AIMSAdminChat = {
      open: () => {},
      close: () => {}
    };
    return;
  }

  const threadListEl = document.getElementById('adminChatThreadList');
  const searchInput = document.getElementById('adminChatSearch');
  const messagesEl = document.getElementById('adminChatMessages');
  const composerForm = document.getElementById('adminChatComposer');
  const messageInput = document.getElementById('adminChatMessageInput');
  const fileInput = document.getElementById('adminChatFileInput');
  const attachBtn = document.getElementById('adminChatAttachBtn');
  const voiceBtn = document.getElementById('adminChatVoiceBtn');
  const attachmentPreview = document.getElementById('adminChatAttachmentPreview');
  const launcherBadge = document.querySelector('#adminChatLauncherBadge');
  let recorder = null;
  let recordingStream = null;
  let audioChunks = [];
  let recording = false;
  let attachmentObjectUrl = null;
  let lastRecordingDuration = null;
  let lastRecordingFile = null;

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
      if (activeUserId) {
        await loadConversation(activeUserId, { scrollToBottom: false });
      }
      if (isAdmin) {
        await loadThreads(searchInput?.value || '');
      }
    } catch (err) {
      console.error('[admin-chat] deleteMessage error:', err);
      window.showMessage ? window.showMessage('Unable to delete message.', true) : alert('Unable to delete message.');
    }
  }

  function handleMessageContextMenu(event) {
    const msgEl = event.target.closest('[data-message-id]');
    if (!msgEl) return;
    event.preventDefault();
    const messageId = msgEl.dataset.messageId;
    if (!messageId) return;
    const confirmed = window.confirm('Delete this message?');
    if (!confirmed) return;
    deleteMessage(messageId);
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

  function formatDuration(ms) {
    const totalSeconds = Math.max(0, Math.floor(ms / 1000));
    const minutes = Math.floor(totalSeconds / 60);
    const seconds = totalSeconds % 60;
    return `${minutes}:${seconds.toString().padStart(2, '0')}`;
  }

  function detectFileKind(file) {
    if (!file) return { kind: null };
    const mime = (file.type || '').toLowerCase();
    const name = file.name || '';
    if (mime.startsWith('image/')) return { kind: 'image' };
    if (mime.startsWith('video/')) return { kind: 'video' };
    if (mime.startsWith('audio/')) return { kind: 'audio' };
    const ext = name.split('.').pop().toLowerCase();
    if (['pdf'].includes(ext)) return { kind: 'document', icon: 'fa-file-pdf' };
    if (['doc', 'docx'].includes(ext)) return { kind: 'document', icon: 'fa-file-word' };
    if (['ppt', 'pptx', 'pps', 'ppsx'].includes(ext)) return { kind: 'document', icon: 'fa-file-powerpoint' };
    if (['xls', 'xlsx', 'csv'].includes(ext)) return { kind: 'document', icon: 'fa-file-excel' };
    if (['zip', 'rar', '7z'].includes(ext)) return { kind: 'file', icon: 'fa-file-archive' };
    return { kind: 'file' };
  }

  function iconForDocument(name) {
    const ext = (name || '').split('.').pop().toLowerCase();
    if (ext === 'pdf') return 'fa-file-pdf';
    if (['doc', 'docx'].includes(ext)) return 'fa-file-word';
    if (['ppt', 'pptx', 'pps', 'ppsx'].includes(ext)) return 'fa-file-powerpoint';
    if (['xls', 'xlsx', 'csv'].includes(ext)) return 'fa-file-excel';
    if (['zip', 'rar', '7z'].includes(ext)) return 'fa-file-archive';
    return 'fa-file-alt';
  }

  function previewLabelForKind(kind) {
    switch (kind) {
      case 'image':
        return '📷 Photo';
      case 'video':
        return '🎞️ Video';
      case 'audio':
        return '🎙️ Voice message';
      case 'document':
        return '📄 Document';
      case 'file':
        return '📎 Attachment';
      default:
        return 'No messages yet';
    }
  }

  function clearAttachmentPreview() {
    if (attachmentObjectUrl) {
      URL.revokeObjectURL(attachmentObjectUrl);
      attachmentObjectUrl = null;
    }
    if (attachmentPreview) {
      attachmentPreview.innerHTML = '';
      attachmentPreview.classList.remove('active', 'recording');
      delete attachmentPreview.dataset.kind;
      delete attachmentPreview.dataset.duration;
      delete attachmentPreview.dataset.size;
      delete attachmentPreview.dataset.name;
    }
    if (fileInput) {
      fileInput.value = '';
    }
    lastRecordingDuration = null;
  }

  function renderAttachmentPreview({ kind, name, size, url }) {
    if (!attachmentPreview) return;
    attachmentPreview.classList.remove('recording');
    attachmentPreview.classList.add('active');
    attachmentPreview.dataset.kind = kind || '';
    attachmentPreview.dataset.size = size || '';
    attachmentPreview.dataset.name = name || '';
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
      thumb = `<div class="thumb icon"><i class="fas ${iconForDocument(name)}"></i></div>`;
    }
    attachmentPreview.innerHTML = `
      <div class="preview-card ${kind || 'file'}">
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
    attachmentPreview.dataset.name = `voice-${Date.now()}.webm`;
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
    timerEl.textContent = formatDuration(duration);
    attachmentPreview.dataset.duration = duration;
    pendingAttachmentMetadata = {
      kind: 'audio',
      name: `voice-${Date.now()}.webm`,
      size: null,
      url: null,
      duration: duration
    };
  }

  function handleAttachClick() {
    if (recording) {
      stopRecording(true);
      return;
    }
    fileInput?.click();
  }

  function handleFileChange() {
    if (!attachmentPreview) return;
    if (recording) return; // ignore changes while recorder running
    const file = fileInput?.files?.[0];
    if (!file) {
      clearAttachmentPreview();
      return;
    }
    if (attachmentObjectUrl) {
      URL.revokeObjectURL(attachmentObjectUrl);
      attachmentObjectUrl = null;
    }
    const { kind } = detectFileKind(file);
    const needsPreviewUrl = ['image', 'video'].includes(kind) || (kind === 'audio');
    const previewUrl = needsPreviewUrl ? URL.createObjectURL(file) : null;
    if (kind === 'image' || kind === 'video') {
      attachmentObjectUrl = URL.createObjectURL(file);
      renderAttachmentPreview({ kind, name: file.name, size: file.size, url: attachmentObjectUrl });
    } else {
      renderAttachmentPreview({ kind, name: file.name, size: file.size });
    }
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
      clearAttachmentPreview();
    }
  }

  function openAttachmentPreview(url) {
    if (!url) return;
    const win = window.open(url, '_blank', 'noopener');
    if (!win) {
      window.location.href = url;
    }
  }

  async function startRecording() {
    try {
      recordingStream = await navigator.mediaDevices.getUserMedia({ audio: true });
    } catch (err) {
      console.error('Voice recording error:', err);
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
        clearAttachmentPreview();
        recordingCancelled = false;
        return;
      }
      if (!audioChunks.length) {
        clearAttachmentPreview();
        return;
      }
      const blob = new Blob(audioChunks, { type: 'audio/webm' });
      const file = new File([blob], `voice-${Date.now()}.webm`, { type: 'audio/webm' });
      const transfer = new DataTransfer();
      transfer.items.add(file);
      if (fileInput) {
        fileInput.files = transfer.files;
        handleFileChange();
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
    if (cancel) {
      audioChunks = [];
    }
    try {
      recorder?.stop();
    } catch (err) {
      console.error('Error stopping recorder', err);
    }
    recorder = null;
  }

  async function toggleRecording() {
    if (recording) {
      stopRecording(false);
      return;
    }
    clearAttachmentPreview();
    await startRecording();
  }

  const titleEl = document.getElementById('adminChatConversationTitle');
  const subEl = document.getElementById('adminChatConversationSub');
  const closeControls = overlay.querySelectorAll('[data-action="close"]');
  const role = (overlay.dataset.role || '').toLowerCase();
  const isAdmin = role === 'admin';
  const isStationery = role === 'stationery';

  let threads = [];
  let activeUserId = null;
  let isOverlayOpen = false;
  let searchTimeout = null;
  let loadingThreads = false;
  let loadingThreadMap = new Map();
  let cachedStationeryThread = null;

  function scrollLastMessageIntoView(element, delay = 0) {
    if (!element) return;
    const action = () => {
      const last = element.lastElementChild;
      if (last && typeof last.scrollIntoView === 'function') {
        last.scrollIntoView({ block: 'end', behavior: 'auto' });
      }
    };
    if (delay > 0) {
      setTimeout(action, delay);
    } else {
      action();
    }
  }

  function autoScrollToBottom(element, attempts = 8, delay = 60) {
    if (!element) return;
    let count = 0;
    const tick = () => {
      element.scrollTop = element.scrollHeight;
      count += 1;
      if (count < attempts) {
        requestAnimationFrame(tick);
      }
    };
    requestAnimationFrame(tick);
    if (delay > 0) {
      setTimeout(() => {
        element.scrollTop = element.scrollHeight;
      }, delay);
    }
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

  function formatDate(value) {
    if (!value) return '';
    try {
      const date = new Date(value);
      const today = new Date();
      const sameDay = date.toDateString() === today.toDateString();
      return sameDay ? date.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }) : date.toLocaleDateString();
    } catch (err) {
      return value;
    }
  }

  function renderThreads(list) {
    if (!threadListEl) return;
    if (!Array.isArray(list) || list.length === 0) {
      threadListEl.innerHTML = '<p class="empty">No conversations yet.</p>';
      return;
    }
    const uniqueMap = new Map();
    list.forEach(thread => {
      const key = String(thread.user_id);
      const existing = uniqueMap.get(key);
      if (!existing || new Date(thread.last_message_at || thread.updated_at || 0) > new Date(existing.last_message_at || existing.updated_at || 0)) {
        uniqueMap.set(key, thread);
      }
    });
    const dedupedList = Array.from(uniqueMap.values());
    const items = dedupedList.map(thread => {
      const initials = (thread.user_username || '?').slice(0, 2).toUpperCase();
      const active = String(thread.user_id) === String(activeUserId);
      const unreadBadge = thread.unread_count > 0 ? `<span class="badge">${thread.unread_count}</span>` : '';
      let preview = thread.last_message ? escapeHtml(thread.last_message) : 'No messages yet';
      if (!thread.last_message && thread.last_attachment_type) {
        preview = previewLabelForKind(thread.last_attachment_type);
      }
      const time = thread.last_message_at || thread.updated_at;
      const roleLower = (thread.user_role || '').toLowerCase();

      let displayName = thread.user_username || 'User';
      if (roleLower === 'admin') {
        displayName = 'Admin';
      } else if (roleLower && roleLower !== 'user') {
        const roleLabel = roleLower.charAt(0).toUpperCase() + roleLower.slice(1);
        displayName = `${displayName} (${roleLabel})`;
      }

      return `
        <div class="admin-chat-thread ${active ? 'active' : ''}" data-user-id="${thread.user_id}">
          <div class="admin-chat-thread-avatar">${initials}</div>
          <div class="admin-chat-thread-body">
            <h4>${displayName}</h4>
            <div class="preview">${preview}</div>
          </div>
          <div class="admin-chat-thread-meta">
            <span class="time">${formatDate(time)}</span>
            ${unreadBadge}
          </div>
        </div>
      `;
    }).join('');
    threadListEl.innerHTML = items;
  }

  async function deleteConversation(userId) {
    if (!isAdmin || !userId) return;
    try {
      const response = await fetch(`/api/help-thread/?user_id=${encodeURIComponent(userId)}`, {
        method: 'DELETE',
        headers: {
          'X-CSRFToken': getCookie('csrftoken')
        }
      });
      if (response.status === 401) {
        window.location.href = '/login/';
        return;
      }
      if (!response.ok) {
        const payload = await response.json().catch(() => ({}));
        const message = payload?.message || 'Unable to delete conversation.';
        window.showMessage ? window.showMessage(message, true) : alert(message);
        return;
      }
      threads = threads.filter(thread => String(thread.user_id) !== String(userId));
      if (String(activeUserId) === String(userId)) {
        activeUserId = null;
        if (messagesEl) {
          messagesEl.innerHTML = '<div class="empty">Conversation deleted.</div>';
        }
        if (titleEl) titleEl.textContent = 'Help Center thread';
        if (subEl) subEl.textContent = '';
      }
      renderThreads(threads);
      loadThreads(searchInput?.value || '');
    } catch (err) {
      console.error('deleteConversation error:', err);
      window.showMessage ? window.showMessage('Unable to delete conversation.', true) : alert('Unable to delete conversation.');
    }
  }

  function renderMessages(dataOrList) {
    if (!messagesEl) return;
    const list = Array.isArray(dataOrList)
      ? dataOrList
      : Array.isArray(dataOrList?.messages)
        ? dataOrList.messages
        : [];
    const currentUserId = (overlay.dataset.userId || '').toString();
    if (list.length === 0) {
      messagesEl.innerHTML = '<div class="empty">No messages yet. Start the conversation to assist this user.</div>';
      return;
    }
    const html = list.map(msg => {
      const classes = ['admin-chat-message'];
      if (String(msg.sender) === currentUserId) {
        classes.push('self');
      }
      const parts = [];
      if (msg.content) {
        parts.push(`<p>${escapeHtml(msg.content)}</p>`);
      }
      if (msg.attachment_url) {
        const safeName = msg.attachment_name || 'Attachment';
        const rawUrl = msg.attachment_url;
        const previewUrl = msg.attachment_id ? `/media/help-attachments/${msg.attachment_id}/` : rawUrl;
        if (msg.attachment_type === 'audio') {
          const duration = msg.metadata?.duration ? formatDuration(msg.metadata.duration) : '';
          parts.push(`
            <div class="chat-attachment audio">
              <div class="icon"><i class="fas fa-microphone"></i></div>
              <audio controls src="${previewUrl}"></audio>
              <span class="details">
                <span class="name">${escapeHtml(safeName)}</span>
                ${duration ? `<span class="meta">${duration}</span>` : ''}
              </span>
            </div>
          `);
        } else if (msg.attachment_type === 'image') {
          parts.push(`
            <div class="chat-attachment image">
              <img src="${previewUrl}" alt="${escapeHtml(safeName)}">
              <div class="actions">
                <a class="btn" href="${previewUrl}" target="_blank" rel="noopener">View</a>
                <a class="btn" href="${rawUrl}" download>Download</a>
              </div>
            </div>
          `);
        } else if (msg.attachment_type === 'video') {
          parts.push(`
            <div class="chat-attachment video">
              <video controls src="${previewUrl}"></video>
              <div class="actions">
                <a class="btn" href="${previewUrl}" target="_blank" rel="noopener">Open</a>
                <a class="btn" href="${rawUrl}" download>Download</a>
              </div>
            </div>
          `);
        } else if (msg.attachment_type === 'document') {
          const sizeText = msg.attachment_size ? formatFileSize(msg.attachment_size) : '';
          parts.push(`
            <div class="chat-attachment document">
              <div class="icon"><i class="fas ${iconForDocument(safeName)}"></i></div>
              <div class="details">
                <span class="name">${escapeHtml(safeName)}</span>
                ${sizeText ? `<span class="size">${sizeText}</span>` : ''}
              </div>
              <div class="actions">
                <button type="button" class="btn" data-action="open-preview" data-url="${previewUrl}">Open</button>
                <a class="btn" href="${rawUrl}" download>Download</a>
              </div>
            </div>
          `);
        } else {
          const sizeText = msg.attachment_size ? formatFileSize(msg.attachment_size) : '';
          parts.push(`
            <div class="chat-attachment file">
              <div class="icon"><i class="fas fa-paperclip"></i></div>
              <div class="details">
                <span class="name">${escapeHtml(safeName)}</span>
                ${sizeText ? `<span class="size">${sizeText}</span>` : ''}
              </div>
              <div class="actions">
                <button type="button" class="btn" data-action="open-preview" data-url="${previewUrl}">Open</button>
                <a class="btn" href="${rawUrl}" download>Download</a>
              </div>
            </div>
          `);
        }
      }
      return `
        <div class="${classes.join(' ')}" data-message-id="${msg.id}">
          ${parts.join('') || '<p>(no content)</p>'}
          <div class="meta">${msg.sender_username} • ${formatDate(msg.created_at)}</div>
        </div>
      `;
    }).join('');
    messagesEl.innerHTML = html;
    autoScrollToBottom(messagesEl);
    scrollLastMessageIntoView(messagesEl, 40);
  }

  async function loadThreads(searchTerm = '') {
    if (loadingThreads) return;
    loadingThreads = true;
    if (threadListEl) threadListEl.innerHTML = '<p class="empty">Loading conversations...</p>';
    try {
      if (isAdmin) {
        const baseUrl = '/api/help-threads/';
        const query = searchTerm ? `?search=${encodeURIComponent(searchTerm)}` : '';
        const response = await fetch(`${baseUrl}${query}`);
        if (response.status === 401) {
          window.location.href = '/login/';
          return;
        }
        if (!response.ok) {
          const text = await response.text();
          throw new Error(text || 'Unable to load conversations');
        }
        const data = await response.json();
        threads = data && Array.isArray(data.threads) ? data.threads : [];
        renderThreads(threads);
      } else if (isStationery) {
        const response = await fetch('/api/help-thread/');
        if (response.status === 401) {
          window.location.href = '/login/';
          return;
        }
        if (!response.ok) {
          const text = await response.text();
          throw new Error(text || 'Unable to load conversation');
        }
        const data = await response.json();
        cachedStationeryThread = data;
        const allMessages = Array.isArray(data.messages) ? data.messages : [];
        const lastMessage = allMessages.length ? allMessages[allMessages.length - 1] : null;
        threads = [{
          thread_id: data.id,
          user_id: data.user,
          user_username: 'Admin Team',
          user_role: 'admin',
          last_message: lastMessage ? lastMessage.content : 'No messages yet',
          last_message_at: lastMessage ? lastMessage.created_at : null,
          unread_count: allMessages.filter(msg => msg.sender_role === 'admin' && msg.is_user_read === false).length,
          conversation: data
        }];
        renderThreads(threads);
        if (threads.length > 0) {
          activeUserId = String(threads[0].user_id || 'admin');
          highlightActiveThread();
          renderConversationData(threads[0].conversation);
        }
      } else {
        threads = [];
        renderThreads(threads);
      }
    } catch (err) {
      console.error('[admin-chat] loadThreads error:', err);
      if (threadListEl) threadListEl.innerHTML = `<p class="empty">Error loading chats. ${err && err.message ? err.message : ''}</p>`;
    } finally {
      loadingThreads = false;
    }
  }

  async function loadConversation(userId, options = {}) {
    if (!isAdmin) {
      try {
        if (messagesEl) messagesEl.innerHTML = '<div class="empty">Loading messages...</div>';
        const response = await fetch('/api/help-thread/');
        if (response.status === 401) {
          window.location.href = '/login/';
          return;
        }
        if (!response.ok) {
          throw new Error('Unable to load conversation');
        }
        const data = await response.json();
        cachedStationeryThread = data;
        renderConversationData(data);
      } catch (err) {
        console.error('loadConversation error:', err);
        if (messagesEl) messagesEl.innerHTML = '<div class="empty">Unable to load conversation.</div>';
      }
      return;
    }

    if (loadingThreadMap.get(userId)) return;
    loadingThreadMap.set(userId, true);
    try {
      if (messagesEl) messagesEl.innerHTML = '<div class="empty">Loading messages...</div>';
      const response = await fetch(`/api/help-thread/?user_id=${userId}`);
      if (response.status === 401) {
        window.location.href = '/login/';
        return;
      }
      if (!response.ok) {
        throw new Error('Unable to load conversation');
      }
      const data = await response.json();
      activeUserId = String(userId);
      highlightActiveThread();
      renderConversationData(data);
      if (options.scrollToBottom !== false && messagesEl) {
        autoScrollToBottom(messagesEl);
        scrollLastMessageIntoView(messagesEl, 40);
      }
      if (options.refreshList !== false) {
        await loadThreads(searchInput?.value || '');
      }
      document.dispatchEvent(new CustomEvent('chat:unread-update', {
        detail: { count: 0, role: 'admin' }
      }));
    } catch (err) {
      console.error('loadConversation error:', err);
      if (messagesEl) messagesEl.innerHTML = '<div class="empty">Unable to load conversation.</div>';
    } finally {
      loadingThreadMap.delete(userId);
    }
  }

  function highlightActiveThread() {
    if (!threadListEl) return;
    const rows = threadListEl.querySelectorAll('.admin-chat-thread');
    rows.forEach(row => {
      if (row.dataset.userId === String(activeUserId)) {
        row.classList.add('active');
      } else {
        row.classList.remove('active');
      }
    });
  }

  function renderConversationData(data) {
    if (!data) return;
    const threadInfo = isAdmin ? threads.find(t => String(t.user_id) === String(activeUserId)) : {
      user_username: data?.admin_name || 'Admin',
      user_role: 'admin'
    };
    const username = threadInfo ? threadInfo.user_username : data.user_username;
    const roleLabel = threadInfo ? threadInfo.user_role : data.user_role;
    let titleText;
    if (!isAdmin) {
      titleText = username || 'Admin';
    } else {
      const normalizedRole = roleLabel ? roleLabel.toString().toLowerCase() : '';
      let roleText = '';
      if (normalizedRole === 'admin') roleText = 'Admin';
      else if (normalizedRole === 'stationery') roleText = 'Stationery';
      else if (normalizedRole) roleText = normalizedRole.charAt(0).toUpperCase() + normalizedRole.slice(1);
      const titleParts = [];
      if (username) titleParts.push(username);
      if (roleText) titleParts.push(`(${roleText})`);
      titleText = titleParts.join(' ').trim();
    }
    if (titleEl) titleEl.textContent = titleText;
    const sub = data.user_email ? data.user_email : (isAdmin ? 'Help Center thread' : (overlay.dataset.username || 'You'));
    if (subEl) subEl.textContent = sub;
    renderMessages(data);
    if (launcherBadge) {
      launcherBadge.textContent = '0';
      launcherBadge.classList.add('hidden');
    }
    if (messageInput) {
      messageInput.disabled = false;
      messageInput.value = '';
    }
    if (composerForm) {
      composerForm.querySelector('button.send-btn').disabled = false;
      if (isAdmin) {
        composerForm.dataset.targetUserId = activeUserId;
      } else {
        delete composerForm.dataset.targetUserId;
      }
    }
  }

  async function sendMessage(event) {
    event.preventDefault();
    if (!composerForm || !messageInput) return;
    const userId = composerForm.dataset.targetUserId;
    if (isAdmin && !userId) {
      messageInput.focus();
      return;
    }
    const content = messageInput.value.trim();
    const attachmentFile = fileInput?.files?.[0];
    const hasAttachment = Boolean(attachmentFile);
    const attachmentKind = attachmentPreview?.dataset.kind;
    const payload = new FormData();
    if (isAdmin && userId) payload.append('user_id', userId);
    if (content) payload.append('content', content);
    if (hasAttachment) {
      payload.append('attachment', attachmentFile);
      const detectedKind = attachmentKind || detectFileKind(attachmentFile).kind || 'file';
      payload.append('attachment_type', detectedKind);
      if (detectedKind === 'audio') {
        const duration = attachmentPreview?.dataset.duration || lastRecordingDuration;
        if (duration) {
          payload.append('attachment_duration', Math.floor(duration));
        }
      }
    }
    if (!content && !hasAttachment) {
      messageInput.focus();
      return;
    }
    composerForm.querySelector('.send-btn').disabled = true;
    messageInput.disabled = true;
    try {
      const response = await fetch('/api/help-thread/messages/', {
        method: 'POST',
        headers: {
          'X-CSRFToken': getCookie('csrftoken')
        },
        body: payload
      });
      if (response.status === 401) {
        window.location.href = '/login/';
        return;
      }
      if (!response.ok) {
        throw new Error('Unable to send message');
      }
      messageInput.value = '';
      messageInput.style.height = '';
      clearAttachmentPreview();
      if (isAdmin) {
        await loadConversation(userId, { refreshList: true });
      } else {
        await loadConversation(null, { refreshList: true });
      }
    } catch (err) {
      console.error('sendMessage error:', err);
      if (window.showMessage) window.showMessage('Could not send reply.', true);
    } finally {
      messageInput.disabled = false;
      composerForm.querySelector('.send-btn').disabled = false;
      messageInput.focus();
    }
  }

  function closeOverlay() {
    overlay.classList.add('hidden');
    document.body.classList.remove('admin-chat-open');
    isOverlayOpen = false;
  }

  async function openOverlay(options = {}) {
    if (isOverlayOpen) {
      if (options.userId) {
        await ensureThreadLoaded(options.userId);
      } else if (!isAdmin) {
        await ensureThreadLoaded(null);
      }
      return;
    }
    overlay.classList.remove('hidden');
    document.body.classList.add('admin-chat-open');
    isOverlayOpen = true;
    await loadThreads();
    if (options.userId) {
      await ensureThreadLoaded(options.userId);
    } else if (!isAdmin) {
      await ensureThreadLoaded(null);
    }
  }

  async function ensureThreadLoaded(userId) {
    if (!isAdmin) {
      await loadThreads();
      await loadConversation(null);
      return;
    }
    if (!threads.find(t => String(t.user_id) === String(userId))) {
      await loadThreads(searchInput?.value || '');
    }
    await loadConversation(userId);
  }

  function handleThreadClick(event) {
    const item = event.target.closest('.admin-chat-thread');
    if (!item) return;
    const userId = item.dataset.userId;
    if (!userId) return;
    loadConversation(userId);
  }

  function handleThreadContextMenu(event) {
    if (!isAdmin) return;
    const item = event.target.closest('.admin-chat-thread');
    if (!item) return;
    event.preventDefault();
    const userId = item.dataset.userId;
    if (!userId) return;
    const confirmDelete = confirm('Delete this conversation? This will remove the entire chat history.');
    if (!confirmDelete) return;
    deleteConversation(userId);
  }

  function handleSearchInput() {
    if (!isAdmin) return;
    clearTimeout(searchTimeout);
    searchTimeout = setTimeout(() => {
      loadThreads(searchInput.value || '');
    }, 350);
  }

  function handleKeyDown(event) {
    if (event.key === 'Escape' && isOverlayOpen) {
      closeOverlay();
    }
  }

  closeControls.forEach(btn => btn.addEventListener('click', closeOverlay));
  overlay.addEventListener('click', (event) => {
    if (event.target.dataset.action === 'close') {
      closeOverlay();
    }
  });
  threadListEl?.addEventListener('click', handleThreadClick);
  threadListEl?.addEventListener('contextmenu', handleThreadContextMenu);
  searchInput?.addEventListener('input', handleSearchInput);
  composerForm?.addEventListener('submit', sendMessage);
  attachBtn?.addEventListener('click', handleAttachClick);
  fileInput?.addEventListener('change', handleFileChange);
  attachmentPreview?.addEventListener('click', handleAttachmentPreviewClick);
  voiceBtn?.addEventListener('click', toggleRecording);
  document.addEventListener('keydown', handleKeyDown);

  messagesEl?.addEventListener('click', (event) => {
    const previewBtn = event.target.closest('[data-action="open-preview"]');
    if (previewBtn) {
      event.preventDefault();
      openAttachmentPreview(previewBtn.dataset.url);
    }
  });
  messagesEl?.addEventListener('contextmenu', handleMessageContextMenu);

  document.addEventListener('chat:unread-update', (event) => {
    if (!launcherBadge) return;
    const detail = event.detail || {};
    if (detail.role !== 'admin') return;
    const value = Number(detail.count || 0);
    if (value > 0) {
      launcherBadge.textContent = String(value);
      launcherBadge.classList.remove('hidden');
    } else {
      launcherBadge.textContent = '0';
      launcherBadge.classList.add('hidden');
    }
  });

  if (messageInput) {
    messageInput.addEventListener('input', () => {
      messageInput.style.height = 'auto';
      messageInput.style.height = `${Math.min(messageInput.scrollHeight, 140)}px`;
    });
  }

  const params = new URLSearchParams(window.location.search);
  const deepLinkUser = params.get('chat_user');
  const chatParam = params.get('chat');
  const replaceUrl = () => {
    params.delete('chat_user');
    params.delete('chat');
    const newUrl = `${window.location.pathname}${params.toString() ? '?' + params.toString() : ''}`;
    window.history.replaceState({}, document.title, newUrl);
  };

  if (deepLinkUser) {
    openOverlay({ userId: deepLinkUser }).then(replaceUrl);
  } else if ((chatParam === 'open') || (!isAdmin && window.location.pathname.includes('/help-center'))) {
    openOverlay().then(replaceUrl);
  }

  window.AIMSAdminChat = {
    open: openOverlay,
    close: closeOverlay,
    async openFromNotification({ userId } = {}) {
      await openOverlay({ userId });
    }
  };
})();
