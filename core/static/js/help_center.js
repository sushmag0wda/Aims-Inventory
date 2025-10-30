// core/static/js/help_center.js

document.addEventListener('DOMContentLoaded', () => {
    const messagesContainer = document.getElementById('userHelpMessages');
    const form = document.getElementById('helpMessageForm');
    const messageInput = document.getElementById('helpMessageInput');

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
        if (!value) return '-';
        try {
            return new Date(value).toLocaleString();
        } catch (err) {
            return value;
        }
    }

    function renderMessages(messages) {
        if (!messagesContainer) return;
        messagesContainer.innerHTML = '';
        if (!Array.isArray(messages) || messages.length === 0) {
            messagesContainer.innerHTML = '<p class="empty">No messages yet. Use the form below to contact the admin.</p>';
            return;
        }
        messages.forEach(msg => {
            const wrapper = document.createElement('div');
            const isAdmin = msg.sender_role === 'admin';
            wrapper.className = `message ${isAdmin ? 'admin' : 'user'}`;

            const text = document.createElement('p');
            text.textContent = msg.content;
            wrapper.appendChild(text);

            const meta = document.createElement('span');
            meta.className = 'meta';
            meta.textContent = `${msg.sender_username} • ${formatDate(msg.created_at)}`;
            wrapper.appendChild(meta);

            messagesContainer.appendChild(wrapper);
        });
        messagesContainer.scrollTop = messagesContainer.scrollHeight;
    }

    async function loadThread() {
        if (!messagesContainer) return;
        messagesContainer.innerHTML = '<p class="empty">Loading conversation...</p>';
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
            renderMessages(data.messages || []);
        } catch (error) {
            console.error('loadThread error:', error);
            messagesContainer.innerHTML = '<p class="empty">Unable to load messages right now.</p>';
        }
    }

    async function submitMessage(event) {
        event.preventDefault();
        if (!messageInput) return;
        const content = messageInput.value.trim();
        if (!content) {
            if (window.showMessage) window.showMessage('Message cannot be empty.', true);
            return;
        }
        messageInput.disabled = true;
        form.querySelector('button')?.setAttribute('disabled', 'disabled');
        try {
            const response = await fetch('/api/help-thread/messages/', {
                method: 'POST',
                headers: {
                    'Content-Type': 'application/json',
                    'X-CSRFToken': getCookie('csrftoken')
                },
                body: JSON.stringify({ content })
            });
            if (response.status === 401) {
                window.location.href = '/login/';
                return;
            }
            const data = await response.json().catch(() => ({}));
            if (!response.ok) {
                throw new Error(data.message || 'Failed to send message.');
            }
            messageInput.value = '';
            if (window.showMessage) window.showMessage('Message sent.');
            await loadThread();
        } catch (error) {
            console.error('submitMessage error:', error);
            if (window.showMessage) window.showMessage(error.message || 'Unable to send message.', true);
        } finally {
            messageInput.disabled = false;
            form.querySelector('button')?.removeAttribute('disabled');
            messageInput.focus();
        }
    }

    form?.addEventListener('submit', submitMessage);

    loadThread();
    setInterval(loadThread, 60000);
});
