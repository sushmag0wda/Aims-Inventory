// core/static/js/manage_users.js

document.addEventListener('DOMContentLoaded', () => {
    const tableBody = document.getElementById('userTableBody');
    const searchInput = document.getElementById('userSearch');
    const statusFilter = document.getElementById('statusFilter');
    const refreshBtn = document.getElementById('refreshUsers');
    const urlParams = new URLSearchParams(window.location.search);
    const initialUserId = urlParams.get('user_id');
    let activeUserId = initialUserId ? String(initialUserId) : null;
    const config = window.MANAGE_USERS_CONFIG || {};
    const isSuperAdmin = Boolean(config.isSuperAdmin);

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

    function setLoadingRow(message = 'Loading users...') {
        if (!tableBody) return;
        tableBody.innerHTML = `<tr><td colspan="6" class="empty">${message}</td></tr>`;
    }

    function formatDate(value) {
        if (!value) return '-';
        try {
            return new Date(value).toLocaleString();
        } catch (err) {
            return value;
        }
    }

    function createStatusBadge(status) {
        const labelMap = {
            'pending': 'Pending',
            'approved': 'Approved',
            'rejected': 'Rejected'
        };
        const label = labelMap[status] || status || 'Unknown';
        return `<span class="badge ${status}">${label}</span>`;
    }

    function renderActions(user) {
        const isAdminRow = user.role === 'admin';
        const status = user.approval_status;
        const isRejected = status === 'rejected';
        const isApproved = status === 'approved';
        const approveDisabled = isApproved || isRejected;
        const rejectDisabled = isRejected;
        const deleteDisabled = status === 'pending';
        const actionButtons = [];

        if (!isRejected) {
            actionButtons.push(`
                <button type="button" class="primary" data-action="approve" ${approveDisabled ? 'disabled' : ''}>Approve</button>
            `);
        }

        actionButtons.push(`
            <button type="button" class="secondary" data-action="reject" ${rejectDisabled ? 'disabled' : ''}>Reject</button>
        `);

        actionButtons.push(`
            <button type="button" class="danger" data-action="delete" data-lock="${deleteDisabled ? 'locked' : 'ready'}" ${deleteDisabled ? 'disabled' : ''}>Delete</button>
        `);

        if (isAdminRow && !isSuperAdmin) {
            return actionButtons
                .map(btn => btn.replace('>', ' disabled>').replace('class="', 'class="disabled '))
                .join('');
        }

        return actionButtons.join('');
    }

    async function loadUsers() {
        if (!tableBody) return;
        setLoadingRow();
        const search = encodeURIComponent((searchInput?.value || '').trim());
        const status = encodeURIComponent(statusFilter?.value || '');
        const query = `/api/users/pending/?search=${search}&approval_status=${status}`;
        try {
            const response = await fetch(query);
            if (response.status === 401) {
                window.location.href = '/login/';
                return;
            }
            if (!response.ok) {
                throw new Error('Failed to load users');
            }
            const users = await response.json();
            if (!Array.isArray(users) || users.length === 0) {
                setLoadingRow('No users found.');
                return;
            }
            tableBody.innerHTML = '';
            users.forEach(user => {
                const row = document.createElement('tr');
                row.dataset.userId = user.id;
                row.dataset.userRole = user.role || '';
                row.dataset.approvalStatus = user.approval_status || '';
                row.innerHTML = `
                    <td>${user.username || '-'}</td>
                    <td>${user.email || '-'}</td>
                    <td>${user.role || '-'}</td>
                    <td>${createStatusBadge(user.approval_status)}</td>
                    <td>${formatDate(user.date_joined)}</td>
                    <td class="actions">
                        ${renderActions(user)}
                    </td>
                `;
                tableBody.appendChild(row);

                if (activeUserId && String(user.id) === activeUserId) {
                    setTimeout(() => {
                        setActiveRow(user.id);
                        row.scrollIntoView({ behavior: 'smooth', block: 'center' });
                    }, 0);
                }
            });
        } catch (error) {
            console.error('loadUsers error:', error);
            setLoadingRow('Unable to fetch users right now.');
        }
    }

    function setActiveRow(userId) {
        if (!tableBody) return;
        Array.from(tableBody.querySelectorAll('tr')).forEach(row => {
            if (row.dataset.userId === String(userId)) {
                row.classList.add('active');
            } else {
                row.classList.remove('active');
            }
        });
    }

    function guardAdminAction(row, action) {
        if (!row) return false;
        const rowRole = row.dataset.userRole;
        if (rowRole === 'admin' && !isSuperAdmin) {
            alert('You cannot perform this action. Only the Super Admin can perform this.');
            return true;
        }
        return false;
    }

    async function updateUserStatus(userId, action, row) {
        if (guardAdminAction(row, action)) {
            return;
        }
        const payload = { action };
        if (action === 'reject') {
            const reason = prompt('Optional: enter a reason for rejection (leave blank to skip)');
            if (reason === null) {
                return;
            }
            if (reason.trim()) {
                payload.message = reason.trim();
            }
        }
        try {
            const response = await fetch(`/api/users/${userId}/approve/`, {
                method: 'POST',
                headers: {
                    'Content-Type': 'application/json',
                    'X-CSRFToken': getCookie('csrftoken')
                },
                body: JSON.stringify(payload)
            });
            if (response.status === 401) {
                window.location.href = '/login/';
                return;
            }
            const data = await response.json().catch(() => ({}));
            if (!response.ok) {
                throw new Error(data.message || 'Unable to update user.');
            }
            if (window.showMessage) window.showMessage(data.message || 'Status updated.');
            if (data.deleted) {
                const existingRow = tableBody?.querySelector(`tr[data-user-id="${userId}"]`);
                if (existingRow) {
                    existingRow.remove();
                }
                const remainingRows = tableBody?.querySelectorAll('tr');
                if (!remainingRows || remainingRows.length === 0) {
                    setLoadingRow('No users found.');
                }
                activeUserId = null;
                return;
            }
            if (data.user) {
                const updatedRow = tableBody?.querySelector(`tr[data-user-id="${userId}"]`);
                if (updatedRow) {
                    updatedRow.dataset.approvalStatus = data.user.approval_status || '';
                    updatedRow.innerHTML = `
                        <td>${data.user.username || '-'}</td>
                        <td>${data.user.email || '-'}</td>
                        <td>${data.user.role || '-'}</td>
                        <td>${createStatusBadge(data.user.approval_status)}</td>
                        <td>${formatDate(data.user.date_joined)}</td>
                        <td class="actions">
                            ${renderActions(data.user)}
                        </td>
                    `;
                } else {
                    await loadUsers();
                }
            } else {
                activeUserId = String(userId);
                await loadUsers();
            }
        } catch (error) {
            console.error('updateUserStatus error:', error);
            if (window.showMessage) window.showMessage(error.message || 'Failed to update user.', true);
        }
    }

    if (tableBody) {
        tableBody.addEventListener('click', (event) => {
            const target = event.target;
            if (!(target instanceof HTMLElement)) return;
            const row = target.closest('tr');
            if (!row) return;
            const userId = row.dataset.userId;
            const action = target.dataset.action;
            if (!action || !userId) return;
            let proceed = true;
            const deleteButton = row.querySelector('[data-action="delete"]');
            if (action === 'approve') {
                proceed = confirm('Approve this user and grant access? A welcome message will be sent.');
                if (!proceed) return;
                updateUserStatus(userId, 'approve', row).then(() => {
                    if (deleteButton) {
                        deleteButton.disabled = false;
                        deleteButton.dataset.lock = 'ready';
                    }
                });
                return;
            }
            if (action === 'reject') {
                proceed = confirm('Reject this user registration? They will be prevented from accessing the system.');
                if (!proceed) return;
                updateUserStatus(userId, 'reject', row).then(() => {
                    if (deleteButton) {
                        deleteButton.disabled = false;
                        deleteButton.dataset.lock = 'ready';
                    }
                });
                return;
            }
            if (action === 'delete') {
                if (deleteButton && deleteButton.dataset.lock === 'locked') {
                    alert('Reject the user first, then delete the account if needed.');
                    return;
                }
                proceed = confirm('Delete this user account? This cannot be undone.');
                if (!proceed) return;
                updateUserStatus(userId, 'delete', row);
            }
        });
    }

    searchInput?.addEventListener('input', () => {
        clearTimeout(searchInput._debounce);
        searchInput._debounce = setTimeout(loadUsers, 400);
    });

    statusFilter?.addEventListener('change', loadUsers);
    refreshBtn?.addEventListener('click', loadUsers);

    loadUsers();
});
