// core/static/js/dashboard.js
console.log("dashboard.js[v10001]: using /api/enrollments/ for counts and charts");
const API_BASE_URL = "/api";

// Chart instances
let booksTypeChart = null;
let topDepartmentsChart = null;
let issueTrendsChart = null;

const LOW_STOCK_THRESHOLDS = [50, 10, 0];
let lowStockAlerts = [];
let dashboardSystemNotifications = [];
let unreadSystemNotifications = 0;
const dismissedStockCodes = new Set();
const normCode = (value) => String(value || '').toUpperCase().trim();
const normalizeDash = (value) => String(value || '').replace(/[\u2010-\u2015\u2212]/g, '-');
const escapeHtml = (value) => String(value || '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;').replace(/'/g, '&#39;');

function reportCompletenessScore(report) {
    if (!report) return 0;
    let score = 0;
    if (report.course_code) score += 3;
    if (report.course) score += 2;
    if (report.academic_year) score += 3;
    if (report.year !== undefined && report.year !== null && report.year !== '') score += 1;
    return score;
}

function dedupePendingReports(data) {
    const perStudent = new Map();
    (data || []).forEach(raw => {
        if (!raw) return;
        const normalized = { ...raw };
        normalized.academic_year = normalizeDash(normalized.academic_year);
        normalized.year = normalized.year != null ? String(normalized.year) : '';
        const key = normalized.student != null ? normalized.student : normalized.usn || Math.random();
        const existing = perStudent.get(key);
        if (!existing || reportCompletenessScore(normalized) >= reportCompletenessScore(existing)) {
            perStudent.set(key, normalized);
        }
    });
    return Array.from(perStudent.values());
}

// Helper functions
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

async function authFetch(url, options = {}) {
    const response = await fetch(url, options);
    if (response.status === 401) {
        window.location.href = '/login';
        throw new Error('Unauthorized');
    }
    return response;
}

async function loadDashboardNotifications() {
    try {
        const response = await authFetch(`${API_BASE_URL}/notifications/`).catch(() => null);
        if (response && response.ok) {
            const data = await response.json();
            dashboardSystemNotifications = Array.isArray(data?.notifications) ? data.notifications : [];
            unreadSystemNotifications = Number(data?.unread) || 0;
        } else {
            dashboardSystemNotifications = [];
            unreadSystemNotifications = 0;
        }
    } catch (error) {
        console.warn('Failed to load dashboard notifications', error);
        dashboardSystemNotifications = [];
        unreadSystemNotifications = 0;
    }
}

async function markDashboardNotificationRead(notificationId) {
    if (!notificationId) return;
    try {
        await authFetch(`${API_BASE_URL}/notifications/${notificationId}/read/`, {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json',
                'X-CSRFToken': getCookie('csrftoken') || ''
            },
            body: JSON.stringify({})
        });
    } catch (error) {
        console.warn(`Failed to mark notification ${notificationId} as read`, error);
    }
}

async function deleteDashboardNotification(notificationId) {
    if (!notificationId) return { ok: false, reason: 'missing-id' };
    try {
        const response = await authFetch(`${API_BASE_URL}/notifications/${notificationId}/`, {
            method: 'DELETE',
            headers: {
                'Content-Type': 'application/json',
                'X-CSRFToken': getCookie('csrftoken') || ''
            }
        });
        if (response && response.ok) {
            return { ok: true };
        }
        const payload = await response.json().catch(() => ({}));
        const message = payload?.message || payload?.error || 'Notification cannot be removed yet.';
        return { ok: false, reason: 'api', message };
    } catch (error) {
        return { ok: false, reason: 'network', message: error?.message || 'Network error while removing notification.' };
    }
}

function addPendingQuantity(totals, code, qty) {
    const normalized = normCode(code);
    const value = Number(qty) || 0;
    if (!normalized || value <= 0) return false;
    totals[normalized] = (totals[normalized] || 0) + value;
    return true;
}

function addTotalsFromMap(totals, map) {
    let added = false;
    Object.entries(map || {}).forEach(([code, value]) => {
        if (addPendingQuantity(totals, code, value)) added = true;
    });
    return added;
}

function addTotalsFromArray(totals, arr, codeKey = 'item_code', qtyKey = 'pending_qty') {
    let added = false;
    (arr || []).forEach(entry => {
        if (!entry) return;
        if (addPendingQuantity(totals, entry[codeKey], entry[qtyKey])) added = true;
    });
    return added;
}

function addLegacyFromReport(totals, report) {
    addPendingQuantity(totals, '2PN', report?.qty_2PN || 0);
    addPendingQuantity(totals, '2PR', report?.qty_2PR || 0);
    addPendingQuantity(totals, '2PO', report?.qty_2PO || 0);
    addPendingQuantity(totals, '1PN', report?.qty_1PN || 0);
    addPendingQuantity(totals, '1PR', report?.qty_1PR || 0);
    addPendingQuantity(totals, '1PO', report?.qty_1PO || 0);
}

function accumulateLegacyPending(pendingReports, seed = {}) {
    const totals = seed;
    (pendingReports || []).forEach(report => {
        if (!report) return;
        if (addTotalsFromArray(totals, report.pending_detail)) return;
        if (addTotalsFromMap(totals, report.total_pending_by_code)) return;
        if (addTotalsFromMap(totals, report.pending)) return;
        addLegacyFromReport(totals, report);
    });
    return totals;
}

async function computePendingAggregates(pendingReports) {
    const totalsByCode = {};
    const reports = Array.isArray(pendingReports) ? pendingReports : [];
    if (reports.length === 0) {
        return { totalsByCode, totalPending: 0 };
    }

    const buildNormalizedMap = (rawMap = {}) => {
        const normalized = {};
        Object.entries(rawMap || {}).forEach(([code, value]) => {
            const key = normCode(code);
            if (!key) return;
            normalized[key] = Number(value) || 0;
        });
        return normalized;
    };

    const tasks = reports.map(report => async () => {
        try {
            if (!report) return;
            const usn = report.usn || '';
            if (!usn) {
                addLegacyFromReport(totalsByCode, report);
                return;
            }

            const params = new URLSearchParams();
            if (report.course_code) params.append('course_code', report.course_code);
            if (report.course) params.append('course', report.course);
            if (report.year) params.append('year', report.year);
            if (report.academic_year) params.append('academic_year', report.academic_year);
            const qs = params.toString();

            const srUrl = `${API_BASE_URL}/student-records/${encodeURIComponent(usn)}/${qs ? `?${qs}` : ''}`;
            const reqUrl = qs ? `${API_BASE_URL}/requirements/?${qs}` : null;

            const [srResp, reqResp] = await Promise.all([
                authFetch(srUrl).catch(() => null),
                reqUrl ? authFetch(reqUrl).catch(() => null) : Promise.resolve(null)
            ]);

            let pendingMap = {};
            let issuedMap = {};
            if (srResp && srResp.ok) {
                const srData = await srResp.json();
                pendingMap = buildNormalizedMap(srData?.pending || {});
                const issuedArr = Array.isArray(srData?.issued) ? srData.issued : [];
                issuedMap = issuedArr.reduce((acc, item) => {
                    const key = normCode(item?.item_code);
                    if (!key) return acc;
                    acc[key] = (acc[key] || 0) + (Number(item?.qty_issued) || 0);
                    return acc;
                }, {});
            }

            let reqMap = {};
            if (reqResp && reqResp.ok) {
                const reqData = await reqResp.json();
                const list = Array.isArray(reqData?.requirements) ? reqData.requirements : [];
                reqMap = list.reduce((acc, item) => {
                    const key = normCode(item?.item_code);
                    if (!key) return acc;
                    acc[key] = Number(item?.required_qty) || 0;
                    return acc;
                }, {});
            }

            const combinedCodes = new Set([
                ...Object.keys(reqMap),
                ...Object.keys(pendingMap)
            ]);

            let added = false;
            let processedCodes = false;
            combinedCodes.forEach(code => {
                const key = normCode(code);
                if (!key) return;
                processedCodes = true;
                let pendingQty = pendingMap[key];
                if (pendingQty == null) {
                    const reqQty = reqMap[key] || 0;
                    const issuedQty = issuedMap[key] || 0;
                    pendingQty = Math.max(0, reqQty - issuedQty);
                }
                pendingQty = Number(pendingQty) || 0;
                if (!Number.isFinite(pendingQty) || pendingQty < 0) {
                    pendingQty = 0;
                }
                totalsByCode[key] = (totalsByCode[key] || 0) + pendingQty;
                if (pendingQty > 0) {
                    added = true;
                }
            });

            if (!added && processedCodes) {
                // Zero pending but valid data processed – keep totals as zero and skip fallbacks
                return;
            }

            if (!added) {
                added = addTotalsFromMap(totalsByCode, pendingMap);
                if (added) return;
            }

            if (!added) {
                added = addTotalsFromArray(totalsByCode, report.pending_detail);
                if (added) return;
            }

            if (!added) {
                added = addTotalsFromMap(totalsByCode, report.total_pending_by_code);
                if (added) return;
            }

            if (!added) {
                added = addTotalsFromMap(totalsByCode, report.pending);
                if (added) return;
            }

            if (!added) {
                addLegacyFromReport(totalsByCode, report);
            }
        } catch (error) {
            console.warn('Failed to aggregate pending for dashboard', error);
            addLegacyFromReport(totalsByCode, report);
        }
    });

    const chunkSize = 20;
    for (let i = 0; i < tasks.length; i += chunkSize) {
        const batch = tasks.slice(i, i + chunkSize).map(task => task());
        // eslint-disable-next-line no-await-in-loop
        await Promise.all(batch);
    }

    if (Object.keys(totalsByCode).length === 0) {
        accumulateLegacyPending(reports, totalsByCode);
    }

    const totalPending = Object.values(totalsByCode).reduce((acc, value) => acc + value, 0);
    return { totalsByCode, totalPending };
}

function animateNumber(id, target, duration = 1200) {
    const element = document.getElementById(id);
    if (!element) return;
    const startTime = performance.now();

    function update(currentTime) {
        const elapsed = currentTime - startTime;
        const progress = Math.min(elapsed / duration, 1);
        element.textContent = Math.floor(progress * target).toLocaleString();
        if (progress < 1) {
            requestAnimationFrame(update);
        }
    }
    requestAnimationFrame(update);
}

// Load all dashboard data
async function loadDashboardData() {
    try {
        console.log('Loading dashboard data...');
        
        // Fetch departments
        const deptResponse = await authFetch(`${API_BASE_URL}/departments/`);
        const departments = await deptResponse.json();
        console.log('Departments loaded:', departments.length);
        
        // Fetch enrollments (one per student-year)
        const studentsResponse = await authFetch(`${API_BASE_URL}/enrollments/`);
        const enrollments = await studentsResponse.json();
        console.log('Enrollments loaded:', enrollments.length);
        
        // Fetch items (inventory stock)
        let items = [];
        try {
            const itemsResponse = await authFetch(`${API_BASE_URL}/items/`);
            if (itemsResponse.ok) {
                items = await itemsResponse.json();
                console.log('Items loaded:', items.length);
            }
        } catch (err) {
            console.warn('Items endpoint not available');
        }
        
        // Fetch pending reports
        let pendingReports = [];
        try {
            const reportsResp = await authFetch(`${API_BASE_URL}/pending-reports/`).catch(() => null);
            if (reportsResp && reportsResp.ok) {
                const reportsRaw = await reportsResp.json();
                pendingReports = dedupePendingReports(reportsRaw);
                console.log('Pending reports loaded:', pendingReports.length);
            }
        } catch (err) {
            console.warn('Pending reports endpoint encountered an error', err);
        }
        
        // Fetch issues (issue-records endpoint)
        let issues = [];
        try {
            const issuesResponse = await authFetch(`${API_BASE_URL}/issue-records/`);
            if (issuesResponse.ok) {
                issues = await issuesResponse.json();
                console.log('Issues loaded:', issues.length);
            }
        } catch (err) {
            console.warn('Issues endpoint not available, using empty array');
        }

        const pendingAggregates = await computePendingAggregates(pendingReports);
        const closingStockMap = buildClosingStockMap(items, issues);

        updateStatCards(departments, enrollments, items, pendingAggregates, issues, closingStockMap);
        createBooksTypeChart(pendingAggregates);
        createTopDepartmentsChart(departments, enrollments);
        createIssueTrendsChart(issues);
        displayRecentActivity(issues);
        lowStockAlerts = buildLowStockAlerts(items, closingStockMap);
        await loadDashboardNotifications();
        renderDashboardNotifications(lowStockAlerts, {
            systemNotifications: dashboardSystemNotifications,
            unreadCount: unreadSystemNotifications
        });

    } catch (error) {
        console.error('Error loading dashboard:', error);
        // Show error message to user
        document.querySelector('.dashboard-container').innerHTML += 
            '<div style="background:#fee2e2;color:#7f1d1d;padding:16px;border-radius:8px;margin:20px 0;">Error loading dashboard data. Please check console.</div>';
    }
}

// Update stat cards
function updateStatCards(departments, students, items, pendingAggregates, issues, closingStockMap = {}) {
    console.log('Updating stat cards...');
    try {
        const totalDepts = departments?.length || 0;
        const totalStudents = students?.length || 0;

        // Total Books Available = Sum of all item quantities (current closing stock)
        let closingStock = Object.values(closingStockMap || {}).reduce((sum, value) => sum + (Number(value) || 0), 0);
        if (!Number.isFinite(closingStock) || closingStock === 0) {
            closingStock = items?.reduce((sum, item) => sum + (Number(item.quantity) || 0), 0) || 0;
        }
        
        // Books Given to Students = Sum of actual issue records (more accurate)
        const totalIssued = issues?.reduce((sum, issue) => sum + (issue.qty_issued || 0), 0) || 0;

        console.log('Issues data:', issues);
        console.log('Total Issued:', totalIssued);
        
        // Calculate pending books the same way as in the pending reports page
        const totalPending = Number(pendingAggregates?.totalPending) || 0;

        const openingStock = totalPending + totalIssued;

        const safeAnimate = (id, value) => {
            const el = document.getElementById(id);
            if (!el) return;
            if (!Number.isFinite(value)) {
                el.textContent = '0';
                return;
            }
            animateNumber(id, value);
        };
        
        safeAnimate('total-departments', totalDepts);
        safeAnimate('registered-students', totalStudents);
        safeAnimate('books-available', closingStock);
        safeAnimate('books-issued', totalIssued);
        safeAnimate('books-pending', totalPending);

        // Update percentages
        const totalBooksNeeded = totalIssued + totalPending;
        const issuedPercent = totalBooksNeeded > 0 ? Math.round((totalIssued / totalBooksNeeded) * 100) : 0;
        const pendingPercent = 100 - issuedPercent;
        
        const issuedEl = document.getElementById('issued-percentage');
        const pendingEl = document.getElementById('pending-percentage');
        
        if (issuedEl) issuedEl.textContent = `${issuedPercent}%`;
        if (pendingEl) pendingEl.textContent = `${pendingPercent}%`;
        
    } catch (error) {
        console.error('Error in updateStatCards:', error);
        const errorContainer = document.getElementById('error-container');
        if (errorContainer) {
            errorContainer.style.display = 'block';
            errorContainer.textContent = 'Error updating dashboard stats. Check console for details.';
        }
    }
}

function buildClosingStockMap(items, issues) {
    const closing = {};
    const issuedMap = {};
    (issues || []).forEach(issue => {
        const code = normCode(issue?.item_code);
        if (!code) return;
        issuedMap[code] = (issuedMap[code] || 0) + (Number(issue?.qty_issued) || 0);
    });
    (items || []).forEach(item => {
        const code = normCode(item?.item_code);
        if (!code) return;
        const opening = Number(item?.quantity || 0);
        const issued = issuedMap[code] || 0;
        closing[code] = Math.max(0, opening - issued);
    });
    return closing;
}

function buildLowStockAlerts(items, closingStockMap = {}) {
    const alerts = [];
    (items || []).forEach(item => {
        const code = normCode(item?.item_code);
        const fallbackQty = Number(item?.quantity || 0);
        const qty = closingStockMap.hasOwnProperty(code) ? Number(closingStockMap[code] || 0) : fallbackQty;
        let level = null;
        if (qty <= 0) level = 0;
        else if (qty <= 10) level = 10;
        else if (qty <= 50) level = 50;
        if (level !== null) {
            alerts.push({
                level,
                item_code: item.item_code,
                name: item.name || item.item_code,
                quantity: qty
            });
        }
    });
    alerts.sort((a, b) => a.level - b.level || String(a.name).localeCompare(String(b.name)));
    return alerts;
}

function renderDashboardNotifications(alerts, options = {}) {
    const badge = document.getElementById('dashboardNotificationBadge');
    const list = document.getElementById('dashboardNotificationsList');
    if (!badge || !list) return;

    const normalizedAlerts = Array.isArray(alerts) ? alerts : [];
    const systemNotifications = Array.isArray(options.systemNotifications) ? options.systemNotifications : [];

    const chatNotifications = systemNotifications.filter(note => note?.notification_type === 'help_message' || note?.notification_type === 'help_reply');
    const otherSystemNotifications = systemNotifications.filter(note => note && note.notification_type !== 'help_message' && note.notification_type !== 'help_reply');

    const unreadFromApi = Number(options.unreadCount);
    const chatUnread = chatNotifications.reduce((acc, note) => acc + (note && note.is_read === false ? 1 : 0), 0);
    const otherUnread = otherSystemNotifications.reduce((acc, note) => acc + (note && note.is_read === false ? 1 : 0), 0);
    const fallbackUnread = chatUnread + otherUnread;
    const unreadTotal = Number.isFinite(unreadFromApi) && unreadFromApi >= 0
        ? Math.max(unreadFromApi, fallbackUnread)
        : fallbackUnread;
    const totalCount = normalizedAlerts.length + unreadTotal;

    badge.textContent = totalCount;
    if (totalCount > 0) {
        badge.classList.remove('hidden');
    } else {
        badge.classList.add('hidden');
    }

    if (normalizedAlerts.length === 0 && systemNotifications.length === 0) {
        list.innerHTML = `<div class="notification-empty">You're all caught up! No notifications right now.</div>`;
        return;
    }

    const sections = [];

    if (normalizedAlerts.length > 0) {
        const stockButtons = normalizedAlerts.map(alert => {
            const level = Number(alert.level);
            const levelLabel = level === 0 ? 'Out of Stock' : (level === 10 ? 'Critical Low Stock' : 'Low Stock');
            const thresholdText = level === 0 ? 'Threshold: 0' : `Threshold: ≤ ${level}`;
            const itemName = escapeHtml(alert.name || alert.item_code || 'Item');
            const itemCode = escapeHtml(alert.item_code || '');
            const quantity = Math.max(0, Number(alert.quantity) || 0);
            const link = `/items/?search=${encodeURIComponent(alert.item_code || '')}`;
            return `
                <div class="notification-item level-${level}" data-type="stock" data-link="${escapeHtml(link)}" data-code="${itemCode}" tabindex="0" role="button">
                    <div class="icon"><i class="fas fa-triangle-exclamation"></i></div>
                    <div class="content">
                        <strong>${levelLabel}</strong>
                        <div>${itemName}${itemCode ? ` (${itemCode})` : ''}</div>
                        <div class="meta">${thresholdText} • Available: ${quantity}</div>
                        <span class="notification-cta">Review stock</span>
                    </div>
                    <div class="actions">
                        <button type="button" class="notification-dismiss" aria-label="Dismiss notification" title="Dismiss">
                            <i class="fas fa-xmark"></i>
                        </button>
                    </div>
                </div>
            `;
        }).join('');
        sections.push({
            key: 'inventory',
            title: 'Inventory Alerts',
            count: normalizedAlerts.length,
            content: stockButtons
        });
    }

    if (chatNotifications.length > 0) {
        const chatButtons = chatNotifications.map(notification => {
            if (!notification) return '';
            const link = escapeHtml(notification.link || '#');
            const isUnread = notification.is_read === false;
            const message = escapeHtml(notification.message || 'New help center activity');
            const timestamp = formatNotificationTimestamp(notification.created_at);
            const idAttr = notification.id ? ` data-id="${notification.id}"` : '';
            const chatUser = notification.link && notification.link.includes('chat_user=') ? new URL(notification.link, window.location.origin).searchParams.get('chat_user') : '';
            const userAttr = chatUser ? ` data-chat-user="${escapeHtml(chatUser)}"` : '';
            return `
                <div class="notification-item chat ${isUnread ? 'unread' : 'read'}" data-type="chat" data-link="${link}"${idAttr}${userAttr} tabindex="0" role="button">
                    <div class="icon"><i class="fas fa-comments"></i></div>
                    <div class="content">
                        <strong>${isUnread ? 'New message' : 'Help Center'}</strong>
                        <div>${message}</div>
                        ${timestamp ? `<div class="meta">${timestamp}</div>` : ''}
                    </div>
                    <div class="actions">
                        <button type="button" class="notification-dismiss" aria-label="Dismiss notification" title="Dismiss">
                            <i class="fas fa-xmark"></i>
                        </button>
                    </div>
                </div>
            `;
        }).join('');
        sections.push({
            key: 'chat',
            title: 'Help Center',
            count: chatNotifications.length,
            content: chatButtons
        });
    }

    if (otherSystemNotifications.length > 0) {
        const systemButtons = otherSystemNotifications.map(notification => {
            if (!notification) return '';
            const link = escapeHtml(notification.link || '#');
            const isUnread = notification.is_read === false;
            const message = escapeHtml(notification.message || 'Notification');
            const timestamp = formatNotificationTimestamp(notification.created_at);
            const idAttr = notification.id ? ` data-id="${notification.id}"` : '';
            return `
                <div class="notification-item system ${isUnread ? 'unread' : 'read'}" data-type="system" data-link="${link}"${idAttr} tabindex="0" role="button">
                    <div class="icon"><i class="fas fa-bell"></i></div>
                    <div class="content">
                        <strong>${isUnread ? 'New notification' : 'Notification'}</strong>
                        <div>${message}</div>
                        ${timestamp ? `<div class="meta">${timestamp}</div>` : ''}
                    </div>
                    <div class="actions">
                        <button type="button" class="notification-dismiss" aria-label="Dismiss notification" title="Dismiss">
                            <i class="fas fa-xmark"></i>
                        </button>
                    </div>
                </div>
            `;
        }).join('');
        sections.push({
            key: 'system',
            title: 'System Notifications',
            count: otherSystemNotifications.length,
            content: systemButtons
        });
    }

    if (!sections.length) {
        list.innerHTML = `<div class="notification-empty">You're all caught up! No notifications right now.</div>`;
        return;
    }

    list.innerHTML = sections.map(section => {
        const isExpanded = false;
        return `
            <div class="notification-section ${isExpanded ? 'expanded' : ''}" data-section="${section.key}">
                <button type="button" class="notification-section-header" data-action="toggle-section" aria-expanded="${isExpanded}">
                    <span class="notification-section-title">${section.title}</span>
                    <span class="notification-section-count">${section.count}</span>
                    <i class="fas fa-chevron-down" aria-hidden="true"></i>
                </button>
                <div class="notification-section-body">
                    ${section.content}
                </div>
            </div>
        `;
    }).join('');

    attachNotificationSectionToggles();
    attachNotificationClickHandlers();
}

function formatNotificationTimestamp(value) {
    if (!value) return '';
    try {
        const date = new Date(value);
        if (Number.isNaN(date.getTime())) return '';
        const formatted = date.toLocaleString(undefined, {
            month: 'short',
            day: 'numeric',
            hour: 'numeric',
            minute: '2-digit'
        });
        return escapeHtml(formatted);
    } catch (error) {
        return '';
    }
}

function clearNotificationBadge() {
    unreadSystemNotifications = 0;
    const badge = document.getElementById('dashboardNotificationBadge');
    if (badge) {
        badge.textContent = '0';
        badge.classList.add('hidden');
    }
}

function attachNotificationSectionToggles() {
    const list = document.getElementById('dashboardNotificationsList');
    if (!list) return;
    list.querySelectorAll('.notification-section').forEach(section => {
        const header = section.querySelector('[data-action="toggle-section"]');
        const body = section.querySelector('.notification-section-body');
        if (!header || !body) return;
        header.addEventListener('click', () => {
            const isExpanded = section.classList.toggle('expanded');
            header.setAttribute('aria-expanded', String(isExpanded));
        });
    });
}

function attachNotificationClickHandlers() {
    const list = document.getElementById('dashboardNotificationsList');
    if (!list) return;
    const panel = document.getElementById('dashboardNotificationsPanel');
    list.querySelectorAll('.notification-item[data-link]').forEach(button => {
        button.addEventListener('click', async (event) => {
            event.preventDefault();
            const target = event.currentTarget;
            const link = target.dataset.link;
            const notificationId = target.dataset.id;
            const type = target.dataset.type;
            const chatUser = target.dataset.chatUser || '';
            if (panel) {
                panel.classList.add('hidden');
            }
            if (type === 'chat') {
                if (notificationId) {
                    await markDashboardNotificationRead(notificationId);
                }
                if (window.AIMSChat && typeof window.AIMSChat.openFromNotification === 'function') {
                    window.AIMSChat.openFromNotification({ link, chatUser });
                } else if (link && link !== '#') {
                    window.location.href = link;
                }
                loadDashboardNotifications().then(() => renderDashboardNotifications(lowStockAlerts, {
                    systemNotifications: dashboardSystemNotifications,
                    unreadCount: unreadSystemNotifications
                }));
                return;
            }
            if (link && link !== '#') {
                window.location.href = link;
            }
            if (notificationId) {
                setTimeout(async () => {
                    await markDashboardNotificationRead(notificationId);
                    loadDashboardNotifications().then(() => renderDashboardNotifications(lowStockAlerts, {
                        systemNotifications: dashboardSystemNotifications,
                        unreadCount: unreadSystemNotifications
                    }));
                }, 0);
            }
        }, { once: true });
    });

    list.querySelectorAll('.notification-dismiss').forEach(button => {
        button.addEventListener('click', async (event) => {
            event.preventDefault();
            event.stopPropagation();
            const parentItem = event.currentTarget.closest('.notification-item');
            const notificationId = parentItem?.dataset?.id;
            const notificationType = parentItem?.dataset?.type || '';
            const itemCode = parentItem?.dataset?.code || '';
            if (!notificationId) {
                const itemName = itemCode ? `item ${itemCode}` : 'this item';
                alert(`Restock ${itemName} or update inventory to clear this alert.`);
                return;
            }
            const deleteResult = await deleteDashboardNotification(notificationId);
            if (deleteResult.ok) {
                parentItem.classList.add('dismissed');
                parentItem.remove();
                loadDashboardNotifications().then(() => renderDashboardNotifications(lowStockAlerts, {
                    systemNotifications: dashboardSystemNotifications,
                    unreadCount: unreadSystemNotifications
                }));
            } else {
                const message = deleteResult.message || 'Notification cannot be dismissed until the related action is completed.';
                alert(message);
            }
        });
    });
}

// Create Books Type Chart (Doughnut)
function createBooksTypeChart(pendingAggregates) {
    const palette = [
        '#5B8FF9', '#5AD8A6', '#5D7092', '#F6BD16', '#E8684A',
        '#6DC8EC', '#9270CA', '#FF9D4D', '#269A99', '#BDA29A',
        '#6E7074', '#61A0A8', '#DD6B66', '#73C0DE', '#3BA272',
        '#FC8452', '#9A60B4', '#EA7CCC', '#5470C6', '#91CC75'
    ];

    try {
        const totalsByCode = { ...(pendingAggregates?.totalsByCode || {}) };
        const entries = Object.entries(totalsByCode)
            .map(([code, value]) => ({ code, value: Number(value) || 0 }))
            .filter(item => item.value > 0)
            .sort((a, b) => a.code.localeCompare(b.code, undefined, { numeric: true }));

        const codes = entries.map(item => item.code);
        const data = entries.map(item => item.value);

        const chartWrapper = document.querySelector('[data-chart="booksType"]');
        const legendHost = chartWrapper?.querySelector('[data-role="chart-legend"]');
        const ctxEl = document.getElementById('booksTypeChart');
        if (!ctxEl) return;
        const ctx = ctxEl.getContext('2d');
        if (booksTypeChart) booksTypeChart.destroy();
        const bg = codes.map((_, i) => palette[i % palette.length]);

        booksTypeChart = new Chart(ctx, {
            type: 'doughnut',
            data: { labels: codes, datasets: [{ data, backgroundColor: bg, borderWidth: 0, hoverOffset: 10 }] },
            options: {
                responsive: true,
                maintainAspectRatio: false,
                plugins: {
                    legend: { display: false },
                    tooltip: {
                        callbacks: {
                            label: (ctx) => {
                                const code = ctx.label || '';
                                const value = ctx.raw || 0;
                                const total = ctx.dataset.data.reduce((a, b) => a + b, 0);
                                const pct = total > 0 ? Math.round((value / total) * 100) : 0;
                                return `${code}: ${value.toLocaleString()} book${value !== 1 ? 's' : ''} (${pct}%)`;
                            }
                        }
                    }
                },
                cutout: '65%',
                animation: { animateScale: true, animateRotate: true }
            }
        });

        if (legendHost) {
            const total = data.reduce((acc, value) => acc + value, 0) || 0;
            const legendItems = entries.map((item, index) => {
                const { code, value } = item;
                const pct = total > 0 ? Math.round((value / total) * 100) : 0;
                return `
                    <div class="chart-legend-item">
                        <span class="dot" style="background:${bg[index]}"></span>
                        <div class="meta">
                            <span class="label">${code}</span>
                            <span class="sub">${value.toLocaleString()} (${pct}%)</span>
                        </div>
                    </div>
                `;
            }).join('');
            legendHost.innerHTML = legendItems || '<p class="chart-legend-empty">No pending codes available.</p>';
        }
    } catch (error) {
        console.error('Error building donut from pending aggregates:', error);
        const chartContainer = document.querySelector('#booksTypeChart')?.parentNode;
        if (chartContainer) {
            chartContainer.innerHTML = `
                <div style="padding: 20px; text-align: center; color: #6b7280;">
                    <i class="fas fa-exclamation-triangle" style="font-size: 24px; margin-bottom: 10px; color: #f59e0b;"></i>
                    <p>Unable to load pending books data. Please try again later.</p>
                </div>
            `;
        }
    }
}

// Create Top Departments Chart (Bar)
function createTopDepartmentsChart(departments, enrollments) {
    const deptInfo = {};

    // Group strictly by Code + Course + Academic Year + Year using enrollments
    enrollments.forEach(enr => {
        const dept = enr.department || {};
        const code = dept.course_code || '';
        const course = dept.course || 'Unknown';
        const ay = String(enr.academic_year || '');
        const year = String(enr.year || '');
        if (!code || !course || !ay || !year) return;
        const key = `${code}|${course}|${ay}|${year}`;
        if (!deptInfo[key]) {
            deptInfo[key] = { code, course, academic_year: ay, year, count: 0 };
        }
        deptInfo[key].count += 1;
    });

    const topDepts = Object.values(deptInfo)
        .sort((a, b) => b.count - a.count)
        .slice(0, 5);
    
    const ctx = document.getElementById('topDepartmentsChart');
    if (!ctx) return;
    
    if (topDepartmentsChart) topDepartmentsChart.destroy();
    
    // Create varied colors for each bar
    const colors = ['#523596', '#F59E0B', '#10B981', '#3B82F6', '#EC4899'];
    
    // Plugin to draw value labels on bars
    const valueLabelsPlugin = {
        id: 'valueLabels',
        afterDatasetsDraw(chart) {
            const {ctx} = chart;
            const dataset = chart.data.datasets[0];
            if (!dataset) return;
            ctx.save();
            ctx.font = '600 11px Inter, system-ui, -apple-system, Segoe UI, Roboto, Arial';
            ctx.fillStyle = '#111827';
            chart.getDatasetMeta(0).data.forEach((bar, i) => {
                const val = dataset.data[i];
                if (val == null) return;
                const x = bar.x;
                const y = bar.y - 6;
                ctx.textAlign = 'center';
                ctx.fillText(String(val), x, y);
            });
            ctx.restore();
        }
    };

    topDepartmentsChart = new Chart(ctx, {
        type: 'bar',
        data: {
            // Multiline labels: show AY under each bar
            labels: topDepts.map(d => [
                `${d.course} (${d.code})`,
                `${d.academic_year} • Y${d.year}`
            ]),
            datasets: [{
                label: 'Students',
                data: topDepts.map(d => d.count),
                backgroundColor: colors.slice(0, topDepts.length),
                borderRadius: 8,
                borderWidth: 0
            }]
        },
        options: {
            responsive: true,
            maintainAspectRatio: false,
            scales: {
                y: { 
                    beginAtZero: true,
                    ticks: { 
                        font: { size: 11 },
                        stepSize: 5
                    },
                    title: {
                        display: true,
                        text: 'Number of Students',
                        font: { size: 12, weight: 'bold' }
                    }
                },
                x: { 
                    ticks: { 
                        font: { size: 9 },
                        maxRotation: 0,
                        minRotation: 0
                    }
                }
            },
            plugins: {
                legend: { display: false },
                tooltip: {
                    callbacks: {
                        title: (items) => {
                            const idx = items[0].dataIndex;
                            const d = topDepts[idx];
                            return `${d.course} • ${d.code}`;
                        },
                        label: (context) => {
                            const d = topDepts[context.dataIndex];
                            return `${d.academic_year} • Year ${d.year} • ${context.parsed.y} students`;
                        }
                    }
                },
                valueLabels: {}
            }
        },
        plugins: [valueLabelsPlugin]
    });
}

// Create Issue Trends Chart (Line)
function createIssueTrendsChart(issues) {
    const last7Days = [];
    const today = new Date();
    
    for (let i = 6; i >= 0; i--) {
        const date = new Date(today);
        date.setDate(date.getDate() - i);
        last7Days.push(date.toISOString().split('T')[0]);
    }
    
    const issuesByDate = {};
    last7Days.forEach(date => issuesByDate[date] = 0);
    
    issues.forEach(issue => {
        const issueDate = issue.date_issued?.split('T')[0];
        if (issueDate && issuesByDate.hasOwnProperty(issueDate)) {
            issuesByDate[issueDate] += issue.qty_issued || 0;
        }
    });
    
    const ctx = document.getElementById('issueTrendsChart');
    if (!ctx) return;
    
    if (issueTrendsChart) issueTrendsChart.destroy();
    
    issueTrendsChart = new Chart(ctx, {
        type: 'line',
        data: {
            labels: last7Days.map(d => new Date(d).toLocaleDateString('en-US', { month: 'short', day: 'numeric' })),
            datasets: [{
                label: 'Books Issued',
                data: Object.values(issuesByDate),
                borderColor: '#523596',
                backgroundColor: 'rgba(82, 53, 150, 0.1)',
                tension: 0.4,
                fill: true,
                pointRadius: 4,
                pointBackgroundColor: '#523596'
            }]
        },
        options: {
            responsive: true,
            maintainAspectRatio: false,
            scales: {
                y: { beginAtZero: true, ticks: { font: { size: 11 } } },
                x: { ticks: { font: { size: 10 } } }
            },
            plugins: {
                legend: { display: false },
                tooltip: {
                    callbacks: {
                        label: (context) => `Issued: ${context.parsed.y}`
                    }
                }
            }
        }
    });
}

// Display Recent Activity (All recent activities, not just today)
async function displayRecentActivity(issues) {
    const activityContainer = document.getElementById('recent-activity');
    if (!activityContainer) return;
    
    // Fetch activity logs
    let activityLogs = [];
    try {
        const response = await authFetch(`${API_BASE_URL}/activity-logs/`);
        if (response.ok) {
            activityLogs = await response.json();
        }
    } catch (err) {
        console.warn('Activity logs not available');
    }
    
    // Get recent issues (last 10)
    const recentIssues = issues
        .sort((a, b) => new Date(b.date_issued) - new Date(a.date_issued))
        .slice(0, 10);
    
    // Combine and sort by timestamp
    const allActivities = [
        ...activityLogs.map(log => ({
            type: 'log',
            description: log.description,
            timestamp: new Date(log.timestamp)
        })),
        ...recentIssues.map(issue => ({
            type: 'issue',
            description: `Books issued: ${issue.qty_issued} ${issue.item_code} to ${issue.student_usn || 'Unknown'}`,
            timestamp: new Date(issue.date_issued)
        }))
    ].sort((a, b) => b.timestamp - a.timestamp).slice(0, 10);
    
    if (allActivities.length === 0) {
        activityContainer.innerHTML = '<div class="activity-item">No recent activity</div>';
        return;
    }
    
    activityContainer.innerHTML = allActivities.map(activity => {
        const timeAgo = getTimeAgo(activity.timestamp);
        const icon = activity.type === 'issue' ? '📚' : '📝';
        return `
            <div class="activity-item">
                ${icon} ${activity.description}
                <span class="activity-time">${timeAgo}</span>
            </div>
        `;
    }).join('');
}

function getTimeAgo(date) {
    const seconds = Math.floor((new Date() - date) / 1000);
    if (seconds < 60) return 'Just now';
    if (seconds < 3600) return `${Math.floor(seconds / 60)}m ago`;
    if (seconds < 86400) return `${Math.floor(seconds / 3600)}h ago`;
    return `${Math.floor(seconds / 86400)}d ago`;
}

// Initialize
document.addEventListener('DOMContentLoaded', () => {
    loadDashboardData();

    const notifBtn = document.getElementById('dashboardNotificationsBtn');
    const notifPanel = document.getElementById('dashboardNotificationsPanel');
    const notifClose = document.getElementById('dashboardNotificationsClose');
    if (notifBtn && notifPanel) {
        notifPanel.classList.add('hidden');
        notifBtn.addEventListener('click', async (event) => {
            event.preventDefault();
            event.stopPropagation();
            const willOpen = notifPanel.classList.contains('hidden');
            if (willOpen) {
                await loadDashboardNotifications();
                renderDashboardNotifications(lowStockAlerts, {
                    systemNotifications: dashboardSystemNotifications,
                    unreadCount: unreadSystemNotifications
                });
            }
            notifPanel.classList.toggle('hidden');
        });
        document.addEventListener('click', (event) => {
            if (!notifPanel.contains(event.target) && !notifBtn.contains(event.target)) {
                notifPanel.classList.add('hidden');
            }
        });
    }
    if (notifClose && notifPanel) {
        notifClose.addEventListener('click', (event) => {
            event.preventDefault();
            notifPanel.classList.add('hidden');
        });
    }
});