// core/static/js/auth.js - RECOMMENDED UPDATE

document.addEventListener('DOMContentLoaded', () => {

    // -------------------- Helper: Get CSRF Token --------------------
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

    // -------------------- Registration Form --------------------
    // IMPORTANT: Make sure the ID in your register.html matches 'registerForm'!
    const registerForm = document.getElementById('registerForm');
    if (registerForm) {
        registerForm.addEventListener('submit', async (e) => {
            e.preventDefault();
            const username = document.getElementById('username').value.trim();
            const password = document.getElementById('password').value;
            const confirmPassword = document.getElementById('confirm-password').value;
            const email = document.getElementById('email').value.trim();

            if (password !== confirmPassword) {
                alert("Passwords do not match!");
                return;
            }

            try {
                const response = await fetch('/api/register/', {
                    method: 'POST',
                    headers: {
                        'Content-Type': 'application/json',
                        'X-CSRFToken': getCookie('csrftoken')
                    },
                    body: JSON.stringify({ username, password, email })
                });
                const data = await response.json();
                
                if (response.ok) {
                    alert(data.message || 'Registration successful! Redirecting to login.');
                    window.location.href = '/login/';
                } else {
                    // 🚨 Enhanced error parsing for Django REST Framework (DRF) errors
                    let errorMsg = 'Registration failed.';
                    if (data && typeof data === 'object') {
                        // Check for non-field errors first (e.g., {"non_field_errors": ["..."]})
                        if (data.non_field_errors) {
                            errorMsg = data.non_field_errors.join(' ');
                        } else {
                            // Combine all other field-specific error messages
                            const fieldErrors = Object.keys(data).map(key => {
                                // Handles nested lists of errors: e.g. ["This field is required."]
                                return `${key.toUpperCase()}: ${data[key].join(' ')}`; 
                            }).join('\n');
                            errorMsg = `Validation Errors:\n${fieldErrors}`;
                        }
                    } else if (data.message) {
                        errorMsg = data.message;
                    }

                    alert(errorMsg);
                }
            } catch (err) {
                console.error('Registration error:', err);
                alert('Network error occurred. Please check your connection and try again.');
            }
        });
    }

    // -------------------- Login Form --------------------
    const loginForm = document.getElementById('login-form');
    if (loginForm) {
        loginForm.addEventListener('submit', async (e) => {
            e.preventDefault();
            const username = document.getElementById('username').value.trim();
            const password = document.getElementById('password').value;
            const roleInput = document.getElementById('role');
            const role = roleInput ? roleInput.value : '';

            try {
                const response = await fetch('/api/login/', {
                    method: 'POST',
                    headers: {
                        'Content-Type': 'application/json',
                        'X-CSRFToken': getCookie('csrftoken')
                    },
                    body: JSON.stringify({ username, password, role })
                });
                const data = await response.json();
                if (response.ok) {
                    if (data.redirect) {
                        window.location.href = data.redirect;
                    } else if (data.role === 'admin') {
                        window.location.href = '/dashboard/';
                    } else {
                        window.location.href = '/issue/';
                    }
                } else {
                    alert(data.message || 'Login failed. Invalid username or password.');
                }
            } catch (err) {
                console.error('Login error:', err);
                alert('Network error occurred. Please try again.');
            }
        });
    }

    // -------------------- Logout --------------------
    // Searches for an anchor tag (<a>) with the exact text 'Logout'
    const logoutLinks = Array.from(document.querySelectorAll('a'))
        .filter(a => a.textContent.trim() === 'Logout');

    const handleLogout = async (e) => {
        e.preventDefault();
        try {
            const response = await fetch('/api/logout/', {
                method: 'POST',
                headers: { 'X-CSRFToken': getCookie('csrftoken') }
            });
            const data = await response.json();
            if (response.ok) {
                alert(data.message || 'Logout successful!');
                window.location.href = '/';
            } else {
                alert(data.message || 'Logout failed.');
            }
        } catch (err) {
            console.error('Logout error:', err);
            alert('Network error during logout.');
        }
    };

    logoutLinks.forEach(link => link.addEventListener('click', handleLogout));
    // -------------------- Hamburger Menu Toggle --------------------
    // Run only if the page has header + nav
    const hamburger = document.querySelector('.hamburger');
    const navLinks = document.querySelector('.site-header nav ul');

    if (hamburger && navLinks) {
        hamburger.addEventListener('click', () => {
            navLinks.classList.toggle('show');      // show/hide menu
            hamburger.classList.toggle('active');   // animate hamburger
        });
    }

    // -------------------- Active Nav Highlight --------------------
    try {
        const currentPath = window.location.pathname.replace(/\/$/, '');
        document.querySelectorAll('.site-header .nav-links a').forEach(a => {
            const hrefPath = (a.getAttribute('href') || '').replace(/\/$/, '');
            if (hrefPath && (currentPath === hrefPath || (hrefPath !== '' && currentPath.startsWith(hrefPath)))) {
                a.classList.add('active');
            } else {
                a.classList.remove('active');
            }
        });
    } catch (_) {}

    // -------------------- Header Notifications --------------------
    const notificationBtn = document.getElementById('headerNotificationBtn');
    const notificationPanel = document.getElementById('headerNotificationPanel');
    const notificationList = document.getElementById('headerNotificationList');
    const notificationBadge = document.getElementById('headerNotificationBadge');
    const notificationClose = document.getElementById('headerNotificationClose');

    async function fetchNotifications() {
        if (!notificationBtn) return;
        try {
            const response = await fetch('/api/notifications/');
            if (!response.ok) {
                if (response.status === 401) {
                    return;
                }
                throw new Error('Failed to load notifications');
            }
            const data = await response.json();
            const { notifications = [], unread = 0 } = data || {};

            if (notificationBadge) {
                if (unread > 0) {
                    notificationBadge.textContent = unread;
                    notificationBadge.classList.remove('hidden');
                } else {
                    notificationBadge.textContent = '0';
                    notificationBadge.classList.add('hidden');
                }
            }

            if (notificationList) {
                notificationList.innerHTML = '';
                if (notifications.length === 0) {
                    notificationList.innerHTML = '<p class="empty">No notifications yet.</p>';
                } else {
                    notifications.forEach(item => {
                        const entry = document.createElement('div');
                        entry.className = `notification-item ${item.is_read ? '' : 'unread'}`;
                        entry.dataset.id = item.id;

                        const message = document.createElement('p');
                        message.textContent = item.message;
                        entry.appendChild(message);

                        const meta = document.createElement('span');
                        meta.className = 'time';
                        meta.textContent = new Date(item.created_at).toLocaleString();
                        entry.appendChild(meta);

                            entry.addEventListener('click', async () => {
                            const targetLink = item.link;
                            if (!item.is_read) {
                                await markNotificationRead(item.id, entry);
                                item.is_read = true;
                            }
                            if (targetLink) {
                                window.location.href = targetLink;
                            }
                        });

                        notificationList.appendChild(entry);
                    });
                }
            }
        } catch (err) {
            console.error('Notification fetch error:', err);
        }
    }

    async function markNotificationRead(id, element) {
        try {
            const response = await fetch(`/api/notifications/${id}/read/`, {
                method: 'POST',
                headers: { 'X-CSRFToken': getCookie('csrftoken') }
            });
            if (response.ok && element) {
                element.classList.remove('unread');
                fetchNotifications();
            }
        } catch (err) {
            console.error('Notification read error:', err);
        }
    }

    if (notificationBtn && notificationPanel) {
        notificationBtn.addEventListener('click', () => {
            notificationPanel.classList.toggle('hidden');
            if (!notificationPanel.classList.contains('hidden')) {
                fetchNotifications();
            }
        });
    }

    if (notificationClose) {
        notificationClose.addEventListener('click', () => {
            notificationPanel?.classList.add('hidden');
        });
    }

    document.addEventListener('click', (event) => {
        if (!notificationPanel || !notificationBtn) return;
        const isClickInside = notificationPanel.contains(event.target) || notificationBtn.contains(event.target);
        if (!isClickInside) {
            notificationPanel.classList.add('hidden');
        }
    });

    if (notificationBtn) {
        fetchNotifications();
        setInterval(fetchNotifications, 60000);
    }
});