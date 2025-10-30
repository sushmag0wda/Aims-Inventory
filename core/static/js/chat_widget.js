// core/static/js/chat_widget.js

(function(){
  const widgetSelector = '.chat-widget';

  function initWidget(widget) {
    if (!widget) return;
    const role = widget.dataset.role || '';
    const isAdmin = role === 'admin';
    const toggle = widget.querySelector('.chat-toggle');
    const panel = widget.querySelector('.chat-panel');
    const badge = toggle?.querySelector('.chat-badge');
    const notificationCenter = document.querySelector(`.chat-notification-center[data-role="${role}"]`) || widget.querySelector('.chat-notification-center');
    const notificationToggle = notificationCenter?.querySelector('.chat-notification-toggle');
    const notificationBadge = notificationCenter?.querySelector('.chat-notification-badge');
    const notificationPanel = notificationCenter?.querySelector('.chat-notification-panel');
    const notificationClose = notificationCenter?.querySelector('.chat-notification-close');
    const notificationList = notificationCenter?.querySelector('.chat-notification-list');
    let notificationCache = [];
    let unreadCache = 0;
    let suppressUnreadBroadcast = false;

    const inboxScreen = panel?.querySelector('.chat-screen--inbox');
    const conversationScreen = panel?.querySelector('.chat-screen--conversation');
    const inboxList = panel?.querySelector('.chat-inbox-list');
    const messagesEl = panel?.querySelector('.chat-messages');
    const composerForm = panel?.querySelector('.chat-composer');
    const chatInput = composerForm?.querySelector('.chat-input');
    const attachBtn = composerForm?.querySelector('.chat-attach-btn');
    const micBtn = composerForm?.querySelector('.chat-mic-btn');
    const sendBtn = composerForm?.querySelector('.chat-send-btn');
    const fileInput = composerForm?.querySelector('input[type="file"]');
    const attachmentPreview = composerForm?.querySelector('.chat-attachment-preview');
    const closeButtons = panel ? Array.from(panel.querySelectorAll('.chat-close')) : [];
    const backButton = panel?.querySelector('.chat-back');

    if (!toggle) return;
    if (!isAdmin && (!panel || !conversationScreen || !messagesEl || !composerForm || !chatInput || !attachBtn || !micBtn || !sendBtn || !fileInput || !attachmentPreview)) return;

    let threadCache = null;
    let activeView = 'conversation';
    const mobileQuery = window.matchMedia('(max-width: 640px)');
    let isMobile = mobileQuery.matches;
    let pollTimer = null;
    let attachmentObjectUrl = null;
    const ADMIN_POLL_INTERVAL = 60000;
    const USER_POLL_INTERVAL = 10000;

    function refreshMobileState() {
      isMobile = mobileQuery.matches;
    }

    function autoScrollToBottom(element, attempts = 8, delay = 80) {
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
      if (delay > 0) setTimeout(() => { element.scrollTop = element.scrollHeight; }, delay);
    }

    function autoScrollAfterMedia(element) {
      if (!element) return;
      const mediaNodes = element.querySelectorAll('img, video, audio');
      mediaNodes.forEach(node => {
        const handler = () => autoScrollToBottom(element, 6, 100);
        if (node.tagName === 'IMG') {
          if (node.complete) handler();
          else node.addEventListener('load', handler, { once: true });
        } else if (node.tagName === 'VIDEO') {
          if (node.readyState >= 2) handler();
          else node.addEventListener('loadeddata', handler, { once: true });
        } else if (node.tagName === 'AUDIO') {
          if (node.readyState >= 1) handler();
          else node.addEventListener('loadeddata', handler, { once: true });
        }
      });
    }

    async function handleMobileChange(event) {
      isMobile = event.matches;
      if (!panel) return;
      if (!panel) return;
      if (!panel.classList.contains('hidden')) {
        showView('conversation');
        await loadThread({ keepView: true, scrollToBottom: true });
        autoScrollToBottom(messagesEl, 12, 160);
        autoScrollAfterMedia(messagesEl);
      }
    }

    if (typeof mobileQuery.addEventListener === 'function') {
      mobileQuery.addEventListener('change', handleMobileChange);
    } else if (typeof mobileQuery.addListener === 'function') {
      mobileQuery.addListener(handleMobileChange);
    }

    function updateToggleBadge(count) {
      if (badge) {
        const value = Number(count || 0);
        if (value > 0) {
          badge.textContent = value;
          badge.classList.remove('hidden');
        } else {
          badge.textContent = '0';
          badge.classList.add('hidden');
        }
      }
      const normalized = Number(count || 0);
      if (normalized !== unreadCache) {
        unreadCache = normalized;
        if (!suppressUnreadBroadcast) {
          document.dispatchEvent(new CustomEvent('chat:unread-update', {
            detail: { count: unreadCache, role, source: 'chat_widget' }
          }));
        }
      }
    }

    function updateNotificationBadge(count) {
      if (!notificationBadge) return;
      const value = Number(count || 0);
      if (value > 0) {
        notificationBadge.textContent = value;
        notificationBadge.classList.remove('hidden');
      } else {
        notificationBadge.textContent = '0';
        notificationBadge.classList.add('hidden');
      }
    }

    function normalizeNotifications(data) {
      const notifications = Array.isArray(data?.notifications) ? data.notifications : [];
      if (isAdmin) {
        return notifications
          .filter(item => item.notification_type === 'help_message' || item.notification_type === 'help_reply' || item.notification_type === 'user_signup')
          .map(item => {
            const url = new URL(item.link || '/manage-users/', window.location.origin);
            const userId = url.searchParams.get('user_id');
            return {
              id: item.id,
              message: item.message,
              created_at: item.created_at,
              is_read: item.is_read,
              notification_type: item.notification_type,
              user_id: userId,
              link: `/manage-users/?user_id=${encodeURIComponent(userId || '')}`
            };
          });
      }
      return notifications
        .filter(item => item.notification_type === 'help_reply')
        .map(item => ({
          id: item.id,
          message: item.message,
          created_at: item.created_at,
          is_read: item.is_read,
          notification_type: item.notification_type,
          link: '/issue/?chat=open'
        }));
    }

    async function markRead(id) {
      try {
        await fetch(`/api/notifications/${id}/read/`, {
          method: 'POST',
          headers: { 'X-CSRFToken': getCookie('csrftoken') }
        });
      } catch (err) {
        console.error('markRead error:', err);
      }
    }

    function showView(view) {
      if (isAdmin || !panel) return;
      activeView = view;
      panel.dataset.view = view;
      if (inboxScreen) inboxScreen.classList.toggle('active', view === 'inbox');
      if (conversationScreen) conversationScreen.classList.toggle('active', view === 'conversation');
      if (view === 'conversation' && messagesEl) {
        requestAnimationFrame(() => autoScrollToBottom(messagesEl, 12, 150));
        setTimeout(() => autoScrollToBottom(messagesEl, 12, 150), 150);
      }
    }

    function summarizeMessage(message) {
      if (!message) return 'No messages yet';
      if (message.content) {
        const trimmed = message.content.trim();
        if (trimmed.length > 60) return `${trimmed.slice(0, 57)}...`;
        return trimmed;
      }
      if (message.attachment_type === 'audio') return '🎙️ Voice message';
      if (message.attachment_type === 'image') return '📷 Photo';
      if (message.attachment_type === 'video') return '🎞️ Video';
      if (message.attachment_type === 'document') return '📄 Document';
      if (message.attachment_type) return '📎 Attachment';
      return 'No messages yet';
    }

    function formatTime(value) {
      if (!value) return '';
      const date = new Date(value);
      if (Number.isNaN(date.getTime())) return '';
      return date.toLocaleString(undefined, {
        hour: '2-digit',
        minute: '2-digit',
        day: '2-digit',
        month: 'short'
      });
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
        const item = document.createElement('button');
        item.type = 'button';
        item.className = `notification-item${entry.is_read ? '' : ' unread'}`;
        item.innerHTML = `
          <div class="icon"><i class="fas fa-headset"></i></div>
          <div class="content">
            <strong>${entry.message}</strong>
            <div class="meta">${formatTime(entry.created_at)}</div>
          </div>
        `;
        item.addEventListener('click', async () => {
          if (!entry.is_read) {
            await markRead(entry.id);
            entry.is_read = true;
            item.classList.remove('unread');
            updateBadgesFromCache();
          }
          openConversation();
        });
        fragment.appendChild(item);
      });
      notificationList.appendChild(fragment);
    }

    function renderAttachmentContent(msg) {
      const card = document.createElement('div');
      card.className = 'chat-attachment-card';
      const header = document.createElement('div');
      header.className = 'chat-attachment-header';
      const icon = document.createElement('div');
      icon.className = 'icon';
      const details = document.createElement('div');
      details.className = 'chat-attachment-details';
      const title = document.createElement('span');
      title.className = 'chat-attachment-title';
      title.textContent = msg.attachment_name || 'Attachment';
      const meta = document.createElement('span');
      meta.className = 'chat-attachment-meta';
      const size = msg.attachment_size;
      if (size) {
        const kb = size / 1024;
        meta.textContent = kb >= 1024 ? `${(kb / 1024).toFixed(1)} MB` : `${kb.toFixed(1)} KB`;
      } else {
        meta.textContent = summarizeMessage(msg);
      }
      details.appendChild(title);
      if (meta.textContent) details.appendChild(meta);

      let iconMarkup = '📎';
      if (msg.attachment_type === 'image') iconMarkup = '<i class="fas fa-image"></i>';
      else if (msg.attachment_type === 'video') iconMarkup = '<i class="fas fa-video"></i>';
      else if (msg.attachment_type === 'audio') iconMarkup = '<i class="fas fa-microphone"></i>';
      else if (msg.attachment_type === 'document') iconMarkup = '<i class="fas fa-file-alt"></i>';
      icon.innerHTML = iconMarkup;
      header.appendChild(icon);
      header.appendChild(details);
      card.appendChild(header);

      if (msg.attachment_type === 'image' || msg.attachment_type === 'video') {
        const media = document.createElement('div');
        media.className = 'chat-attachment-media';
        if (msg.attachment_type === 'image') {
          const img = document.createElement('img');
          img.src = msg.attachment_url;
          img.alt = msg.attachment_name || 'Image attachment';
          media.appendChild(img);
        } else {
          const video = document.createElement('video');
          video.src = msg.attachment_url;
          video.controls = true;
          video.playsInline = true;
          media.appendChild(video);
        }
        card.appendChild(media);
      } else if (msg.attachment_type === 'audio') {
        const audio = document.createElement('div');
        audio.className = 'chat-attachment-media';
        const player = document.createElement('audio');
        player.controls = true;
        player.src = msg.attachment_url;
        audio.appendChild(player);
        card.appendChild(audio);
      }

      const actions = document.createElement('div');
      actions.className = 'chat-attachment-actions';

      const hasInlineView = msg.attachment_type && ['image', 'video', 'audio', 'document'].includes(msg.attachment_type);
      if (hasInlineView) {
        const viewLink = document.createElement('a');
        viewLink.href = msg.attachment_url;
        viewLink.target = '_blank';
        viewLink.rel = 'noopener noreferrer';
        viewLink.textContent = msg.attachment_type === 'audio' ? 'Play in new tab' : 'Open';
        actions.appendChild(viewLink);
      }

      const downloadLink = document.createElement('a');
      downloadLink.href = msg.attachment_url;
      downloadLink.download = msg.attachment_name || '';
      downloadLink.textContent = hasInlineView ? 'Download' : 'Save';
      actions.appendChild(downloadLink);
      card.appendChild(actions);
      return card;
    }

    function renderMessages(messages) {
      if (!messagesEl) return;
      const list = Array.isArray(messages) ? messages : [];
      if (list.length === 0) {
        messagesEl.innerHTML = '<p class="empty">No messages yet.</p>';
        return;
      }
      const fragments = document.createDocumentFragment();
      list.forEach(msg => {
        const bubble = document.createElement('div');
        const isSelf = msg.sender_role !== 'admin';
        bubble.className = `chat-message ${isSelf ? 'chat-message--self' : 'chat-message--other'}`;

        const content = document.createElement('div');
        content.className = 'chat-message__content';
        if (msg.content) {
          const text = document.createElement('p');
          text.textContent = msg.content.trim();
          content.appendChild(text);
        }
        if (msg.attachment_url) {
          content.appendChild(renderAttachmentContent(msg));
        }
        if (!msg.content && !msg.attachment_url) {
          const text = document.createElement('p');
          text.textContent = 'Attachment';
          content.appendChild(text);
        }

        const meta = document.createElement('span');
        meta.className = 'chat-message__time';
        meta.textContent = formatTime(msg.created_at);

        bubble.appendChild(content);
        bubble.appendChild(meta);
        fragments.appendChild(bubble);
      });
      messagesEl.innerHTML = '';
      messagesEl.appendChild(fragments);
      autoScrollToBottom(messagesEl, 10, 120);
      autoScrollAfterMedia(messagesEl);
    }

    function scrollMessagesToBottom() {
      if (!messagesEl) return;
      autoScrollToBottom(messagesEl);
    }

    function updateBadgesFromCache() {
      const unread = notificationCache.filter(entry => !entry.is_read).length;
      updateNotificationBadge(unread);
      const chatUnread = notificationCache.filter(entry => !entry.is_read && (entry.notification_type === 'help_message' || entry.notification_type === 'help_reply')).length;
      updateToggleBadge(chatUnread);
    }

    function openConversation() {
      if (!panel) return;
      panel.classList.remove('hidden');
      showView('conversation');
      loadThread({ keepView: true, scrollToBottom: true });
      requestAnimationFrame(() => autoScrollToBottom(messagesEl, 12, 150));
      if (notificationPanel && !notificationPanel.classList.contains('hidden')) {
        notificationPanel.classList.add('hidden');
      }
    }

    async function fetchNotifications() {
      try {
        const response = await fetch('/api/notifications/');
        if (!response.ok) return;
        const data = await response.json();
        notificationCache = normalizeNotifications(data);
        renderNotificationList(notificationCache);
        updateBadgesFromCache();
      } catch (err) {
        console.error('chat_widget fetch error:', err);
      }
    }

    async function loadThread({ keepView = false, scrollToBottom = false } = {}) {
      refreshMobileState();
      try {
        const response = await fetch('/api/help-thread/');
        if (response.status === 401) {
          window.location.href = '/login/';
          return;
        }
        if (!response.ok) {
          throw new Error('Unable to load messages.');
        }
        const data = await response.json();
        threadCache = data;
        const messages = Array.isArray(data?.messages) ? data.messages : [];
        const unread = messages.filter(msg => msg.sender_role === 'admin' && msg.is_user_read === false).length;
        if (isAdmin) {
          await fetchNotificationsForAdmin();
        } else {
          await fetchNotifications();
        }
        const shouldScroll = scrollToBottom || !keepView || activeView === 'conversation';
        if (activeView === 'conversation' || !keepView) {
          renderMessages(messages);
        }
        if (shouldScroll) {
          autoScrollToBottom(messagesEl, 12, 140);
          autoScrollAfterMedia(messagesEl);
        }
      } catch (err) {
        console.error('chat_widget loadThread error:', err);
        if (notificationList && notificationList.innerHTML.trim() === '') {
          notificationList.innerHTML = '<p class="notification-empty">Unable to load messages.</p>';
        }
      }
    }

    function resetAttachmentPreview() {
      if (!attachmentPreview) return;
      attachmentPreview.classList.remove('active', 'recording');
      attachmentPreview.innerHTML = '';
      delete attachmentPreview.dataset.kind;
      if (attachmentObjectUrl) {
        URL.revokeObjectURL(attachmentObjectUrl);
        attachmentObjectUrl = null;
      }
      if (fileInput) fileInput.value = '';
    }

    function handleFileChange() {
      const file = fileInput.files[0];
      if (!file) {
        resetAttachmentPreview();
        return;
      }
      if (attachmentObjectUrl) {
        URL.revokeObjectURL(attachmentObjectUrl);
        attachmentObjectUrl = null;
      }
      const kind = detectAttachmentKind(file);
      const needsPreviewUrl = ['image', 'video'].includes(kind);
      const previewUrl = needsPreviewUrl ? URL.createObjectURL(file) : null;
      if (previewUrl) {
        attachmentObjectUrl = previewUrl;
      }
      renderAttachmentPreview({ kind, name: file.name, size: file.size, url: previewUrl });
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

    function renderAttachmentPreview({ kind, name, size, url }) {
      if (!attachmentPreview) return;
      attachmentPreview.classList.remove('recording');
      attachmentPreview.classList.add('active');
      attachmentPreview.innerHTML = '';
      if (kind) {
        attachmentPreview.dataset.kind = kind;
      } else {
        delete attachmentPreview.dataset.kind;
      }

      const card = document.createElement('div');
      card.className = 'preview-card';

      const thumb = document.createElement('div');
      thumb.className = 'thumb icon';
      if (kind === 'image' && url) {
        thumb.classList.add('media');
        const img = document.createElement('img');
        img.src = url;
        img.alt = name || 'Attachment preview';
        thumb.appendChild(img);
      } else if (kind === 'video' && url) {
        thumb.classList.add('media');
        const video = document.createElement('video');
        video.src = url;
        video.muted = true;
        video.loop = true;
        video.playsInline = true;
        thumb.appendChild(video);
      } else if (kind === 'audio') {
        thumb.innerHTML = '<i class="fas fa-microphone"></i>';
      } else {
        thumb.innerHTML = '<i class="fas fa-paperclip"></i>';
      }

      const info = document.createElement('div');
      info.className = 'info';
      const title = document.createElement('span');
      title.className = 'title';
      title.textContent = name || 'Attachment';
      info.appendChild(title);
      if (size) {
        const meta = document.createElement('span');
        meta.className = 'meta';
        const kb = size / 1024;
        meta.textContent = kb >= 1024 ? `${(kb / 1024).toFixed(1)} MB` : `${kb.toFixed(1)} KB`;
        info.appendChild(meta);
      }

      const removeBtn = document.createElement('button');
      removeBtn.type = 'button';
      removeBtn.className = 'remove-attachment';
      removeBtn.setAttribute('aria-label', 'Remove attachment');
      removeBtn.textContent = '×';

      card.appendChild(thumb);
      card.appendChild(info);
      card.appendChild(removeBtn);
      attachmentPreview.appendChild(card);
    }

    function buildMessageRequest({ content, attachment }) {
      if (attachment) {
        const form = new FormData();
        if (content) form.append('content', content);
        form.append('attachment', attachment);
        form.append('attachment_type', detectAttachmentKind(attachment));
        return {
          body: form,
          headers: {
            'X-CSRFToken': getCookie('csrftoken')
          }
        };
      }
      return {
        body: JSON.stringify({ content }),
        headers: {
          'Content-Type': 'application/json',
          'X-CSRFToken': getCookie('csrftoken')
        }
      };
    }

    async function sendMessage(content) {
      if (!isMobile) return;
      const payload = { content };
      const file = fileInput.files[0];
      if (file) {
        payload.attachment = file;
      }
      const request = buildMessageRequest(payload);
      try {
        const response = await fetch('/api/help-thread/messages/', {
          method: 'POST',
          headers: request.headers,
          body: request.body
        });
        if (response.status === 401) {
          window.location.href = '/login/';
          return;
        }
        if (!response.ok) {
          const data = await response.json().catch(() => ({}));
          throw new Error(data.message || 'Unable to send message.');
        }
        resetAttachmentPreview();
        await loadThread({ keepView: true });
        showView('conversation');
        scrollMessagesToBottom();
        return true;
      } catch (err) {
        console.error('chat_widget sendMessage error:', err);
        if (window.showMessage) window.showMessage(err.message || 'Unable to send message.', true);
        return false;
      }
    }

    async function fetchNotificationsForAdmin() {
      try {
        const response = await fetch('/api/notifications/');
        if (!response.ok) return;
        const data = await response.json();
        const entries = normalizeNotifications(data);
        const badgeUnread = (entries || []).reduce((count, item) => {
          if (item.notification_type === 'help_message' || item.notification_type === 'help_reply') {
            return item.is_read ? count : count + 1;
          }
          return count;
        }, 0);
        updateToggleBadge(badgeUnread);
      } catch (err) {
        console.error('chat_widget fetch error:', err);
      }
    }

    async function openFromNotification({ link, chatUser } = {}) {
      if (isAdmin) {
        const overlay = document.getElementById('adminChatOverlay');
        if (overlay) overlay.classList.remove('hidden');
        document.body.classList.add('admin-chat-open');
        if (window.AIMSAdminChat && typeof window.AIMSAdminChat.openFromNotification === 'function') {
          window.AIMSAdminChat.openFromNotification({ link, chatUser });
        } else if (window.AIMSAdminChat && typeof window.AIMSAdminChat.open === 'function') {
          window.AIMSAdminChat.open();
        } else if (typeof fetchData === 'function') {
          fetchData();
        }
        return;
      }

      openConversation();
    }

    if (!isAdmin) {
      async function togglePanel(forceState) {
        const shouldShow = forceState != null ? forceState : panel.classList.contains('hidden');
        if (shouldShow) {
          panel.classList.remove('hidden');
          showView('conversation');
          await loadThread({ keepView: true, scrollToBottom: true });
          autoScrollToBottom(messagesEl, 12, 160);
          autoScrollAfterMedia(messagesEl);
        } else {
          panel.classList.add('hidden');
        }
      }

      toggle.addEventListener('click', () => togglePanel());
      closeButtons.forEach(btn => btn.addEventListener('click', () => togglePanel(false)));

      composerForm?.addEventListener('submit', async (event) => {
        event.preventDefault();
        if (!isMobile) return;
        const value = chatInput.value.trim();
        const hasAttachment = Boolean(fileInput.files.length);
        if (!value && !hasAttachment) return;
        chatInput.disabled = true;
        sendBtn.setAttribute('disabled', 'disabled');
        try {
          const success = await sendMessage(value);
          if (success) {
            chatInput.value = '';
          }
        } finally {
          chatInput.disabled = false;
          sendBtn.removeAttribute('disabled');
          chatInput.focus();
        }
      });

      attachBtn?.addEventListener('click', () => {
        if (!isMobile) return;
        fileInput.click();
      });

      micBtn?.addEventListener('click', () => {
        if (!isMobile) return;
        if (navigator.mediaDevices?.getUserMedia) {
          // Future enhancement: integrate audio recording
          if (window.showMessage) window.showMessage('Voice recording is not yet available.', true);
        }
      });

      fileInput.addEventListener('change', handleFileChange);
      attachmentPreview.addEventListener('click', (event) => {
        const remove = event.target.closest('.remove-attachment');
        if (remove) {
          event.preventDefault();
          resetAttachmentPreview();
        }
      });

      document.addEventListener('click', (event) => {
        if (!widget.contains(event.target)) {
          panel.classList.add('hidden');
          if (notificationPanel) notificationPanel.classList.add('hidden');
        }
      });

      notificationToggle?.addEventListener('click', (event) => {
        event.stopPropagation();
        notificationPanel?.classList.toggle('hidden');
        if (!notificationPanel?.classList.contains('hidden')) {
          fetchNotifications();
        }
      });

      notificationClose?.addEventListener('click', (event) => {
        event.stopPropagation();
        notificationPanel?.classList.add('hidden');
      });

      fetchNotifications();
      updateBadgesFromCache();
      window.AIMSChat = Object.assign(window.AIMSChat || {}, { openFromNotification });
    } else {
      toggle.addEventListener('click', () => {
        const overlay = document.getElementById('adminChatOverlay');
        if (overlay) overlay.classList.remove('hidden');
        document.body.classList.add('admin-chat-open');
        if (window.AIMSAdminChat && typeof window.AIMSAdminChat.open === 'function') {
          window.AIMSAdminChat.open();
        } else {
          fetchData();
        }
      });
      window.AIMSChat = Object.assign(window.AIMSChat || {}, { openFromNotification });
    }

    async function fetchNotificationsForAdmin() {
      try {
        const response = await fetch('/api/notifications/');
        if (!response.ok) return;
        const data = await response.json();
        const entries = normalizeNotifications(data);
        const unreadCount = Array.isArray(entries)
          ? entries.filter(entry => (entry.notification_type === 'help_message' || entry.notification_type === 'help_reply') && !entry.is_read).length
          : 0;
        updateToggleBadge(unreadCount);
      } catch (err) {
        console.error('chat_widget fetch error:', err);
      }
    }

    function restartPolling() {
      if (pollTimer) {
        clearInterval(pollTimer);
        pollTimer = null;
      }
      refreshMobileState();
      if (isAdmin) {
        fetchNotificationsForAdmin();
        pollTimer = setInterval(fetchNotificationsForAdmin, ADMIN_POLL_INTERVAL);
        return;
      }
      fetchNotifications();
      pollTimer = setInterval(fetchNotifications, USER_POLL_INTERVAL);
    }

    refreshMobileState();
    restartPolling();

    const handleVisibilityChange = () => {
      if (document.hidden) return;
      if (isAdmin) {
        fetchNotificationsForAdmin();
      } else {
        fetchNotifications();
      }
    };
    document.addEventListener('visibilitychange', handleVisibilityChange);

    document.addEventListener('chat:unread-update', (event) => {
      const detail = event.detail || {};
      if (!detail || (detail.role && detail.role !== role) || detail.source === 'chat_widget') {
        return;
      }
      const value = Number(detail.count || 0);
      suppressUnreadBroadcast = true;
      updateToggleBadge(value);
      if (!isAdmin) {
        updateNotificationBadge(value);
      }
      suppressUnreadBroadcast = false;
    });
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

  document.addEventListener('DOMContentLoaded', () => {
    document.querySelectorAll(widgetSelector).forEach(initWidget);
  });
})();
