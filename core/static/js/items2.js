// core/static/js/items2.js
const API_BASE_URL = "/api";
let currentInventory = []; // Global state to hold fetched items for CRUD logic
let inventoryChart = null; // Global chart instance
let ordersCache = [];
let receiptsCache = [];
let stockLogCache = [];
let studentPendingByCode = {};

const closingStockByCode = {};
const destroyInventoryChartInstance = (canvasEl = null) => {
  if (inventoryChart) {
    try {
      inventoryChart.destroy();
    } catch (error) {
      console.warn('Could not destroy inventory chart via cache variable:', error);
    }
    inventoryChart = null;
  }
  const target = canvasEl || document.getElementById('inventoryChart');
  if (target && typeof Chart?.getChart === 'function') {
    const existing = Chart.getChart(target);
    if (existing) {
      try {
        existing.destroy();
      } catch (error) {
        console.warn('Could not destroy inventory chart via Chart.getChart:', error);
      }
    }
  }
};
const resetInventoryChartCanvas = (canvasEl = null) => {
  const canvas = canvasEl || document.getElementById('inventoryChart');
  if (!canvas || !canvas.parentNode) return canvas;
  const cloned = canvas.cloneNode(false);
  canvas.parentNode.replaceChild(cloned, canvas);
  return cloned;
};
const normalizeCode = (value) => (value || '').toString().trim().toUpperCase();
const normalizeDash = (value) => (value || '').toString().replace(/[\u2010-\u2015\u2212]/g, '-').trim();

// Register Chart.js plugins
Chart.register(ChartDataLabels);

// ===========================================
// UTILITIES
// ===========================================

function cssVar(name) {
  return getComputedStyle(document.documentElement).getPropertyValue(name).trim() || '';
}


function hexToRgba(hex, alpha = 1) {
  if (!hex) return `rgba(0,0,0,${alpha})`;
  let c = hex.replace('#','');
  if (c.length === 3) c = c.split('').map(ch => ch+ch).join('');
  const num = parseInt(c, 16);
  const r = (num >> 16) & 255;
  const g = (num >> 8) & 255;
  const b = num & 255;
  return `rgba(${r},${g},${b},${alpha})`;
}

function escapeHtml(value) {
  if (value === undefined || value === null) return '';
  return String(value)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

async function authFetch(url, options = {}) {
  const opts = { ...options };
  opts.method = (opts.method || 'GET').toUpperCase();
  opts.headers = opts.headers ? { ...opts.headers } : {};
  if (opts.method !== 'GET' && !opts.headers['X-CSRFToken']) {
    opts.headers['X-CSRFToken'] = getCookie('csrftoken');
  }
  const response = await fetch(url, opts);
  return response;
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

const showMessage = (message, isError = false) => {
  const container = document.querySelector('.items-container') || document.body;
  const messageContainer = document.createElement('div');
  messageContainer.textContent = message;
  messageContainer.className = `message-box ${isError ? 'error' : 'success'}`;
  const existingMessage = container.querySelector('.message-box');
  if (existingMessage) existingMessage.remove();
  container.insertBefore(messageContainer, container.firstChild);
  setTimeout(() => messageContainer.remove(), 5000);
};

// ===========================================
// API DATA HELPERS
// ===========================================

async function fetchOrders() {
  try {
    const response = await authFetch(`${API_BASE_URL}/inventory-orders/`);
    if (!response.ok) throw new Error(`Orders fetch failed: ${response.status}`);
    ordersCache = await response.json();
  } catch (error) {
    console.error('Error fetching orders:', error);
    ordersCache = [];
  }
}

async function deleteInventoryItem(itemId, itemName) {
  try {
    const resp = await authFetch(`${API_BASE_URL}/items/${itemId}/`, {
      method: 'DELETE',
      headers: { 'Content-Type': 'application/json', 'X-CSRFToken': getCookie('csrftoken') }
    });
    if (![200, 202, 204].includes(resp.status)) {
      const error = await resp.json().catch(() => ({}));
      const message = error.message || error.detail || error.error || 'Failed to delete item.';
      throw new Error(message);
    }
    showMessage(`${itemName} removed from inventory.`, false);
    await fetchItems();
    renderOrdersTable();
    renderStockLog();
    return true;
  } catch (error) {
    console.error('Error deleting item:', error);
    showMessage(`Failed to delete ${itemName}: ${error.message}`, true);
    return false;
  }
}

async function createOrder(itemCode, itemName, qty, ref) {
  try {
    const payload = {
      item_id: getItemByCode(itemCode)?.id,
      ordered_qty: qty,
      reference: ref || ''
    };
    if (!payload.item_id) {
      showMessage('Unable to find that item. Refresh the page and try again.', true);
      return null;
    }
    const resp = await authFetch(`${API_BASE_URL}/inventory-orders/`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload)
    });
    if (!resp.ok) {
      const error = await resp.json().catch(() => ({}));
      throw new Error(error.detail || error.error || 'Failed to create order');
    }
    const order = await resp.json();
    ordersCache.unshift(order);
    await fetchStockLogs();
    return order;
  } catch (error) {
    console.error('Error creating order:', error);
    showMessage(`Failed to create order: ${error.message}`, true);
    return null;
  }
}

async function deleteOrder(id) {
  try {
    const resp = await authFetch(`${API_BASE_URL}/inventory-orders/${id}/`, {
      method: 'DELETE'
    });
    if (![200, 202, 204].includes(resp.status)) {
      const error = await resp.json().catch(() => ({}));
      throw new Error(error.detail || error.error || 'Failed to delete order');
    }
    ordersCache = ordersCache.filter(order => order.id !== id);
    await fetchStockLogs();
    return true;
  } catch (error) {
    console.error('Error deleting order:', error);
    showMessage(`Failed to delete order: ${error.message}`, true);
    return false;
  }
}

async function receiveOrder(id, qty, note = '') {
  try {
    const resp = await authFetch(`${API_BASE_URL}/inventory-orders/${id}/receive/`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ quantity: qty, note })
    });
    if (!resp.ok) {
      const error = await resp.json().catch(() => ({}));
      throw new Error(error.error || error.detail || 'Failed to receive order');
    }
    const data = await resp.json();
    const updatedOrder = data?.order;
    if (updatedOrder) {
      ordersCache = ordersCache.map(order => order.id === updatedOrder.id ? updatedOrder : order);
    }
    receiptsCache = Array.isArray(data?.receipt) ? data.receipt : receiptsCache;
    await fetchReceipts();
    await fetchStockLogs();
    renderReceivedSummary();
    return updatedOrder;
  } catch (error) {
    console.error('Error receiving order:', error);
    showMessage(`Failed to receive order: ${error.message}`, true);
    return null;
  }
}

async function fetchReceipts() {
  try {
    const response = await authFetch(`${API_BASE_URL}/inventory-receipts/`);
    if (!response.ok) throw new Error(`Receipts fetch failed: ${response.status}`);
    receiptsCache = await response.json();
  } catch (error) {
    console.error('Error fetching receipts:', error);
    receiptsCache = [];
  }
}

async function fetchStockLogs() {
  try {
    const response = await authFetch(`${API_BASE_URL}/stock-logs/`);
    if (!response.ok) throw new Error(`Stock log fetch failed: ${response.status}`);
    stockLogCache = await response.json();
  } catch (error) {
    console.error('Error fetching stock logs:', error);
    stockLogCache = [];
  }
}

function addStudentPending(totals, code, quantity) {
  const norm = normalizeCode(code);
  const value = Number(quantity) || 0;
  if (!norm || value <= 0) return false;
  totals[norm] = (totals[norm] || 0) + value;
  return true;
}

function accumulateStudentPending(totals, report) {
  if (!report) return;
  if (Array.isArray(report.pending_detail) && report.pending_detail.length) {
    report.pending_detail.forEach(entry => addStudentPending(totals, entry?.item_code, entry?.pending_qty));
    return;
  }
  if (report.total_pending_by_code && typeof report.total_pending_by_code === 'object') {
    Object.entries(report.total_pending_by_code).forEach(([code, qty]) => addStudentPending(totals, code, qty));
    return;
  }
  if (report.pending && typeof report.pending === 'object') {
    Object.entries(report.pending).forEach(([code, qty]) => addStudentPending(totals, code, qty));
    return;
  }
  addStudentPending(totals, '2PN', report.qty_2PN);
  addStudentPending(totals, '2PR', report.qty_2PR);
  addStudentPending(totals, '2PO', report.qty_2PO);
  addStudentPending(totals, '1PN', report.qty_1PN);
  addStudentPending(totals, '1PR', report.qty_1PR);
  addStudentPending(totals, '1PO', report.qty_1PO);
}

function buildNormalizedPendingMap(raw = {}) {
  const normalized = {};
  Object.entries(raw || {}).forEach(([code, qty]) => {
    const key = normalizeCode(code);
    if (!key) return;
    const value = Number(qty) || 0;
    if (value <= 0) return;
    normalized[key] = value;
  });
  return normalized;
}

function pendingReportScore(report = {}) {
  let score = 0;
  if ((report.usn || report.student_usn || report.student) != null) score += 4;
  if (report.course_code) score += 3;
  if (report.course) score += 2;
  if (report.academic_year) score += 3;
  if (report.year !== undefined && report.year !== null && report.year !== '') score += 1;
  return score;
}

function dedupePendingReportsData(reports = []) {
  const map = new Map();
  reports.forEach((reportRaw) => {
    if (!reportRaw) return;
    const report = { ...reportRaw };
    const studentKey = normalizeCode(report.student_usn || report.usn || report.student || report.student_id || '');
    const courseCodeKey = normalizeCode(report.course_code || '');
    const courseKey = normalizeCode(report.course || '');
    const yearKey = report.year !== undefined && report.year !== null ? String(report.year).trim() : '';
    const ayKey = normalizeDash(report.academic_year || '');
    const key = [studentKey, courseCodeKey, courseKey, yearKey, ayKey].join('|');
    if (!map.has(key)) {
      map.set(key, report);
      return;
    }
    const existing = map.get(key);
    if (pendingReportScore(report) > pendingReportScore(existing)) {
      map.set(key, report);
    }
  });
  return Array.from(map.values());
}

function addTotalsFromMapInventory(totals, map) {
  let added = false;
  Object.entries(map || {}).forEach(([code, qty]) => {
    if (addStudentPending(totals, code, qty)) added = true;
  });
  return added;
}

function addTotalsFromArrayInventory(totals, arr, codeKey = 'item_code', qtyKey = 'pending_qty') {
  let added = false;
  (arr || []).forEach(entry => {
    if (!entry) return;
    if (addStudentPending(totals, entry[codeKey], entry[qtyKey])) added = true;
  });
  return added;
}

function addLegacyFromReportInventory(totals, report) {
  addStudentPending(totals, '2PN', report?.qty_2PN || 0);
  addStudentPending(totals, '2PR', report?.qty_2PR || 0);
  addStudentPending(totals, '2PO', report?.qty_2PO || 0);
  addStudentPending(totals, '1PN', report?.qty_1PN || 0);
  addStudentPending(totals, '1PR', report?.qty_1PR || 0);
  addStudentPending(totals, '1PO', report?.qty_1PO || 0);
}

function accumulateLegacyPendingInventory(pendingReports, seed = {}) {
  const totals = seed;
  (pendingReports || []).forEach(report => {
    if (!report) return;
    if (addTotalsFromArrayInventory(totals, report.pending_detail)) return;
    if (addTotalsFromMapInventory(totals, report.total_pending_by_code)) return;
    if (addTotalsFromMapInventory(totals, report.pending)) return;
    addLegacyFromReportInventory(totals, report);
  });
  return totals;
}

async function computePendingAggregatesForInventory(reports) {
  const totalsByCode = {};
  const list = Array.isArray(reports) ? reports : [];
  if (list.length === 0) {
    return { totalsByCode, totalPending: 0 };
  }

  const buildNormalizedMap = (rawMap = {}) => {
    const normalized = {};
    Object.entries(rawMap || {}).forEach(([code, value]) => {
      const key = normalizeCode(code);
      if (!key) return;
      normalized[key] = Number(value) || 0;
    });
    return normalized;
  };

  const tasks = list.map(report => async () => {
    try {
      if (!report) return;
      const usn = report.usn || report.student_usn || '';
      if (!usn) {
        addLegacyFromReportInventory(totalsByCode, report);
        return;
      }

      const params = new URLSearchParams();
      if (report.course_code) params.append('course_code', report.course_code);
      if (report.course) params.append('course', report.course);
      if (report.year != null && report.year !== '') params.append('year', report.year);
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
          const key = normalizeCode(item?.item_code);
          if (!key) return acc;
          acc[key] = (acc[key] || 0) + (Number(item?.qty_issued) || 0);
          return acc;
        }, {});
      }

      let reqMap = {};
      if (reqResp && reqResp.ok) {
        const reqData = await reqResp.json();
        const reqList = Array.isArray(reqData?.requirements) ? reqData.requirements : [];
        reqMap = reqList.reduce((acc, item) => {
          const key = normalizeCode(item?.item_code);
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
        const key = normalizeCode(code);
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
        if (pendingQty > 0) added = true;
      });

      if (!added && processedCodes) {
        return;
      }

      if (!added) {
        added = addTotalsFromMapInventory(totalsByCode, pendingMap);
        if (added) return;
      }

      if (!added) {
        added = addTotalsFromArrayInventory(totalsByCode, report.pending_detail);
        if (added) return;
      }

      if (!added) {
        added = addTotalsFromMapInventory(totalsByCode, report.total_pending_by_code);
        if (added) return;
      }

      if (!added) {
        added = addTotalsFromMapInventory(totalsByCode, report.pending);
        if (added) return;
      }

      if (!added) {
        addLegacyFromReportInventory(totalsByCode, report);
      }
    } catch (error) {
      console.warn('Failed to aggregate pending for inventory', error);
      addLegacyFromReportInventory(totalsByCode, report);
    }
  });

  const chunkSize = 20;
  for (let i = 0; i < tasks.length; i += chunkSize) {
    const batch = tasks.slice(i, i + chunkSize).map(task => task());
    // eslint-disable-next-line no-await-in-loop
    await Promise.all(batch);
  }

  if (Object.keys(totalsByCode).length === 0) {
    accumulateLegacyPendingInventory(list, totalsByCode);
  }

  const totalPending = Object.values(totalsByCode).reduce((acc, value) => acc + value, 0);
  return { totalsByCode, totalPending };
}

async function fetchStudentPending() {
  try {
    const response = await authFetch(`${API_BASE_URL}/pending-reports/`);
    if (!response.ok) throw new Error(`Pending reports fetch failed: ${response.status}`);
    const reportsData = await response.json();
    const reportsArray = Array.isArray(reportsData) ? dedupePendingReportsData(reportsData) : [];
    const aggregates = await computePendingAggregatesForInventory(reportsArray);
    studentPendingByCode = aggregates?.totalsByCode || {};
  } catch (error) {
    console.error('Error fetching student pending reports:', error);
    studentPendingByCode = {};
  }
}

function getItemByCode(code) {
  const norm = normalizeCode(code);
  return currentInventory.find(item => normalizeCode(item.item_code) === norm);
}

function getAvailableFromReceipt(receipt) {
  const provided = receipt?.available_qty;
  if (provided !== undefined && provided !== null) return Math.max(0, Number(provided));
  const quantity = Number(receipt?.quantity || 0);
  const consumed = Number(receipt?.consumed_qty || 0);
  return Math.max(0, quantity - consumed);
}

function getPendingReceivedFromCache(itemCode) {
  const norm = normalizeCode(itemCode);
  if (!norm) return 0;
  return receiptsCache.reduce((sum, receipt) => {
    return normalizeCode(receipt?.item_code) === norm ? sum + getAvailableFromReceipt(receipt) : sum;
  }, 0);
}

function getOutstandingFromCache(itemCode) {
  const norm = normalizeCode(itemCode);
  if (!norm) return 0;
  return ordersCache.reduce((sum, order) => {
    return normalizeCode(order?.item_code) === norm ? sum + Math.max(0, Number(order?.pending_qty || 0)) : sum;
  }, 0);
}

function getReceiptStats(itemCode) {
  const norm = normalizeCode(itemCode);
  let totalReceived = 0;
  let totalConsumed = 0;
  if (!norm) return { totalReceived: 0, totalConsumed: 0, pending: 0 };
  (receiptsCache || []).forEach(receipt => {
    if (normalizeCode(receipt?.item_code) !== norm) return;
    totalReceived += Number(receipt?.quantity || 0);
    totalConsumed += Number(receipt?.consumed_qty || 0);
  });
  const pending = Math.max(0, totalReceived - totalConsumed);
  return { totalReceived, totalConsumed, pending };
}

async function consumeReceived(itemCode, qty) {
  if (!qty || qty <= 0) return;
  const item = getItemByCode(itemCode);
  if (!item) return;
  try {
    const resp = await authFetch(`${API_BASE_URL}/inventory-receipts/consume/`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ item_id: item.id, quantity: qty })
    });
    if (!resp.ok) {
      const error = await resp.json().catch(() => ({}));
      throw new Error(error.error || 'Failed to consume receipts');
    }
    receiptsCache = await resp.json();
    renderReceivedSummary();
  } catch (error) {
    console.error('Error consuming receipts:', error);
    showMessage(`Failed to update receipts for ${item.item_code}.`, true);
  }
}

async function increaseReceived(itemCode, qty) {
  if (!qty || qty <= 0) return;
  const item = getItemByCode(itemCode);
  if (!item) return;
  try {
    const resp = await authFetch(`${API_BASE_URL}/inventory-receipts/restore/`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ item_id: item.id, quantity: qty })
    });
    let payload = null;
    if (resp.status === 206) {
      payload = await resp.json().catch(() => null);
      const restored = payload?.restored_amount ?? 0;
      const requested = payload?.requested_amount ?? qty;
      if (restored > 0) {
        showMessage(`Only ${restored} of ${requested} units restored for ${item.item_code}. Remaining quantity may have been returned earlier.`, true);
      } else {
        showMessage('No consumed stock could be restored.', true);
      }
      receiptsCache = Array.isArray(payload?.receipts) ? payload.receipts : receiptsCache;
      renderReceivedSummary();
      return;
    }
    if (resp.status === 400) {
      const error = await resp.json().catch(() => ({}));
      const message = error.error || error.detail || 'No consumed stock available to restore.';
      showMessage(message, true);
      return;
    }
    if (!resp.ok) {
      const error = await resp.json().catch(() => ({}));
      const message = error.error || error.detail || 'Failed to restore receipts';
      throw new Error(message);
    }
    payload = await resp.json();
    receiptsCache = payload;
    renderReceivedSummary();
  } catch (error) {
    console.error('Error restoring receipts:', error);
    showMessage(`Failed to restore receipts for ${item.item_code}: ${error.message}`, true);
  }
}

async function createStockLogEntry(item, change, reason, extra = {}) {
  if (!item || !item.id || !Number.isFinite(Number(change)) || Number(change) === 0) return;
  try {
    const payload = {
      item_id: item.id,
      change: Number(change),
      reason: reason || '',
      pending_delta: Number(extra.pendingDelta || 0)
    };
    if (extra.applyChange === false) payload.apply_change = false;
    if (extra.previousQuantity !== undefined) payload.previous_quantity = Number(extra.previousQuantity);
    if (extra.newQuantity !== undefined) payload.new_quantity = Number(extra.newQuantity);
    const resp = await authFetch(`${API_BASE_URL}/stock-logs/`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload)
    });
    if (!resp.ok) {
      const error = await resp.json().catch(() => ({}));
      throw new Error(error.error || error.detail || 'Failed to record stock log');
    }
    return await resp.json();
  } catch (error) {
    console.error('Error creating stock log entry:', error);
    throw error;
  }
}

async function appendStockLog(item_code, item_name, change, reason, options = {}) {
  const delta = Number(change || 0);
  if (!delta) return;
  const norm = normalizeCode(item_code);
  let item = getItemByCode(norm);
  if (!item) {
    await fetchItems();
    item = getItemByCode(norm);
  }
  if (!item) {
    console.warn('appendStockLog: unable to resolve item for code', item_code);
    return;
  }
  const previous = options.previousQuantity !== undefined ? Number(options.previousQuantity) : Number(item.quantity || 0);
  const next = options.newQuantity !== undefined ? Number(options.newQuantity) : previous + delta;
  try {
    await createStockLogEntry(item, delta, reason, {
      applyChange: false,
      pendingDelta: options.pendingDelta || 0,
      previousQuantity: previous,
      newQuantity: next
    });
    await fetchStockLogs();
    renderStockLog();
  } catch (error) {
    showMessage('Failed to record stock change log entry.', true);
  }
}

function updateReceivedBadge(item_code) {
  const badge = document.getElementById('received-available');
  if (!badge) return;
  if (!item_code) {
    badge.textContent = 'Received available: 0';
    badge.dataset.max = '0';
    return;
  }
  const remaining = getPendingReceivedFromCache(item_code);
  const outstanding = getOutstandingFromCache(item_code);
  badge.textContent = `Received available: ${remaining} / Outstanding: ${outstanding}`;
  badge.dataset.max = String(remaining);
}

function renderReceivedSummary() {
  const container = document.getElementById('receivedSummary');
  if (!container) return;

  const codes = new Map();
  (currentInventory || []).forEach(item => {
    const code = normalizeCode(item?.item_code);
    if (!code) return;
    const closingVal = closingStockByCode[item.item_code] ?? closingStockByCode[code] ?? item?.quantity;
    codes.set(code, {
      code,
      name: item?.name || item?.item_code || code,
      closing: Math.max(0, Number(closingVal || 0)),
      itemId: item?.id ?? null
    });
  });

  (receiptsCache || []).forEach(receipt => {
    const code = normalizeCode(receipt?.item_code);
    if (!code) return;
    if (!codes.has(code)) codes.set(code, { code, name: receipt?.item_name || receipt?.item_code || code, closing: 0 });
    const entry = codes.get(code);
    entry.pending = (entry.pending || 0) + getAvailableFromReceipt(receipt);
  });

  (ordersCache || []).forEach(order => {
    const code = normalizeCode(order?.item_code);
    if (!code) return;
    if (!codes.has(code)) codes.set(code, { code, name: order?.item_name || order?.item_code || code, closing: 0 });
    const entry = codes.get(code);
    entry.outstanding = (entry.outstanding || 0) + Math.max(0, Number(order?.pending_qty || 0));
  });

  if (codes.size === 0) {
    container.innerHTML = '<p class="empty">No receipt or order activity yet.</p>';
    return;
  }

  const tiles = Array.from(codes.values())
    .sort((a, b) => String(a.name || a.code || '').localeCompare(String(b.name || b.code || '')))
    .map(({ code, name, pending = 0, closing = 0, outstanding = 0, itemId = null }) => {
      const safeName = escapeHtml(name || code || 'Item');
      const safeCode = escapeHtml(code || '');
      const pendingValue = Math.max(0, Number(pending) || 0);
      const closingValue = Math.max(0, Number(closing) || 0);
      const outstandingValue = Math.max(0, Number(outstanding) || 0);
      const studentPendingValue = Math.max(0, Number(studentPendingByCode[code] || 0));
      const itemIdValue = itemId != null ? itemId : '';
      const attrs = [
        `data-item-id="${itemIdValue}"`,
        `data-pending="${pendingValue}"`,
        `data-code="${safeCode}"`,
        `data-name="${safeName}"`,
        `data-closing="${closingValue}"`,
        `data-outstanding="${outstandingValue}"`,
        `data-student-pending="${studentPendingValue}"`
      ].join(' ');
      return `
      <div class="received-badge" ${attrs}>
        <div class="received-badge-title">
          <span class="name">${safeName}</span>
          <span class="code">${safeCode}</span>
          <button type="button" class="received-badge-remove" title="Remove item" aria-label="Remove item">
            <i class="fas fa-xmark"></i>
          </button>
        </div>
        <div class="received-badge-stats">
          <span class="received-pill pill received">R: ${pendingValue}</span>
          <span class="received-pill pill instock">S: ${closingValue}</span>
          <span class="received-pill pill outstanding">Y: ${outstandingValue}</span>
          <span class="received-pill pill pending-issue">P: ${studentPendingValue}</span>
        </div>
      </div>`;
    })
    .join('');

  container.innerHTML = `
    <div class="received-badge-legend">
      <span class="legend-pill received">R = Received</span>
      <span class="legend-pill instock">S = In stock</span>
      <span class="legend-pill outstanding">Y = Yet to receive</span>
      <span class="legend-pill pending-issue">P = Pending to issue</span>
    </div>
    <div class="received-badge-grid">${tiles}</div>
  `;

  container.querySelectorAll('.received-badge-remove').forEach(button => {
    button.addEventListener('click', async (event) => {
      event.preventDefault();
      event.stopPropagation();
      const tile = event.currentTarget.closest('.received-badge');
      if (!tile) return;
      const itemIdValue = Number(tile.dataset.itemId || '');
      const itemCode = tile.dataset.code || '';
      const itemName = tile.dataset.name || itemCode || 'Item';
      const studentPendingValue = Number(tile.dataset.studentPending || '0');
      if (studentPendingValue > 0) {
        alert(`${itemName} cannot be deleted because ${studentPendingValue} pending-to-issue unit(s) remain.`);
        return;
      }
      if (!Number.isFinite(itemIdValue) || itemIdValue <= 0) {
        alert(`Unable to remove ${itemName} because the inventory record was not found.`);
        return;
      }
      const confirmMessage = `${itemName} has ${studentPendingValue} pending-to-issue unit(s). Delete ${itemName} (${itemCode}) from inventory?`;
      const confirmed = window.confirm(confirmMessage);
      if (!confirmed) return;

      const success = await deleteInventoryItem(itemIdValue, itemName);
      if (success) {
        renderReceivedSummary();
      }
    });
  });
}

function populateStockLogFilters(logs) {
  const yearSelect = document.getElementById('stock-log-year');
  const monthSelect = document.getElementById('stock-log-month');
  if (!yearSelect || !monthSelect) return;

  const uniqueYears = new Set();
  logs.forEach(log => {
    if (!log?.date) return;
    const dt = new Date(log.date);
    if (!Number.isNaN(dt.getTime())) uniqueYears.add(dt.getFullYear());
  });

  const selectedYear = yearSelect.value;
  yearSelect.innerHTML = '<option value="">All Years</option>';
  Array.from(uniqueYears).sort((a, b) => b - a).forEach(year => {
    const opt = document.createElement('option');
    opt.value = String(year);
    opt.textContent = String(year);
    yearSelect.appendChild(opt);
  });
  if (selectedYear && uniqueYears.has(Number(selectedYear))) {
    yearSelect.value = selectedYear;
  }

  const selectedMonth = monthSelect.value;
  monthSelect.innerHTML = '<option value="">All Months</option>';

  const months = [
    '01','02','03','04','05','06','07','08','09','10','11','12'
  ];
  months.forEach((month, idx) => {
    const opt = document.createElement('option');
    opt.value = month;
    const label = new Date(2000, idx, 1).toLocaleString(undefined, { month: 'long' });
    opt.textContent = label;
    monthSelect.appendChild(opt);
  });

  if (selectedMonth && months.includes(selectedMonth)) {
    monthSelect.value = selectedMonth;
  }
}

function renderStockLog() {
  const tbody = document.getElementById('stock-log-body');
  if (!tbody) return;
  const logs = Array.isArray(stockLogCache) ? [...stockLogCache] : [];
  const yearSelect = document.getElementById('stock-log-year');
  const monthSelect = document.getElementById('stock-log-month');
  const selectedYear = yearSelect?.value;
  const selectedMonth = monthSelect?.value;

  populateStockLogFilters(logs);

  let nextIndex = 1;
  tbody.innerHTML = '';
  logs.forEach((log) => {
    const dt = log?.created_at ? new Date(log.created_at) : null;
    if (!dt || Number.isNaN(dt.getTime())) return;
    const year = String(dt.getFullYear());
    const month = String(dt.getMonth() + 1).padStart(2, '0');
    if (selectedYear && year !== selectedYear) return;
    if (selectedMonth && month !== selectedMonth) return;
    const changeVal = Number(log?.change || 0);
    const tr = document.createElement('tr');
    tr.innerHTML = `
      <td>${nextIndex++}</td>
      <td>${(log.item_name || log.item_code || '')}</td>
      <td>${changeVal >= 0 ? '+' + changeVal : changeVal}</td>
      <td>${log.reason || '-'}</td>
      <td>${dt.toLocaleString()}</td>
    `;
    tbody.appendChild(tr);
  });
}

function exportStockLogXLSX() {
  const logs = Array.isArray(stockLogCache) ? [...stockLogCache] : [];
  const year = document.getElementById('stock-log-year')?.value;
  const month = document.getElementById('stock-log-month')?.value;
  let counter = 1;
  const monthLabel = month ? new Date(2000, Number(month) - 1, 1).toLocaleString(undefined, { month: 'long' }) : 'All Months';
  const titleRow = ['Stock Change Log'];
  const filterRow = [
    'Filters',
    `Year: ${year || 'All Years'}`,
    `Month: ${month ? monthLabel : 'All Months'}`
  ];
  const rows = [titleRow, filterRow, [], ['#','Item','Change','Reason','Date']];
  logs.forEach((log) => {
    const dt = log?.created_at ? new Date(log.created_at) : null;
    if (!dt || Number.isNaN(dt.getTime())) return;
    const logYear = String(dt.getFullYear());
    const logMonth = String(dt.getMonth() + 1).padStart(2, '0');
    if (year && logYear !== year) return;
    if (month && logMonth !== month) return;
    rows.push([
      counter++,
      String(log.item_name || log.item_code || ''),
      log.change,
      String(log.reason || ''),
      dt.toLocaleString()
    ]);
  });
  const wb = XLSX.utils.book_new();
  const ws = XLSX.utils.aoa_to_sheet(rows);
  ws['!merges'] = [{ s: { r: 0, c: 0 }, e: { r: 0, c: 4 } }];
  ws['!autofilter'] = { ref: `A4:E${Math.max(4, rows.length)}` };
  ws['!cols'] = [ {wch:4}, {wch:36}, {wch:10}, {wch:28}, {wch:24} ];
  XLSX.utils.book_append_sheet(wb, ws, 'Stock Log');
  const filename = `stock_change_log_${new Date().toISOString().slice(0,19).replace(/[:T]/g,'-')}.xlsx`;
  XLSX.writeFile(wb, filename);
}

function renderOrdersTable() {
  const tbody = document.getElementById('orders-table-body');
  if (!tbody) return;
  const orders = Array.isArray(ordersCache) ? [...ordersCache] : [];
  tbody.innerHTML = '';
  orders.forEach((o, idx) => {
    const pending = Math.max(0, (o.ordered_qty || 0) - (o.received_qty || 0));
    const statusLabel = pending === 0 ? 'Received' : (pending === (o.ordered_qty || 0) ? 'Pending' : 'Partial');
    const statusClass = pending === 0 ? 'chip chip-success' : (pending === (o.ordered_qty || 0) ? 'chip chip-neutral' : 'chip chip-warning');
    const referenceValue = (o.reference || '').trim();
    const safeReference = referenceValue ? escapeHtml(referenceValue) : '-';
    const orderedDate = o.ordered_at ? new Date(o.ordered_at) : null;
    const dateDisplay = orderedDate && !Number.isNaN(orderedDate.getTime()) ? orderedDate.toLocaleString() : '-';
    const actionsHtml = `<div class="orders-actions">
           <input type="number" min="1" placeholder="Qty" class="orders-recv-input" data-recv-input="${o.id}"> 
           <button class="btn-icon btn-recv" title="Receive" data-recv="${o.id}"><i class="fas fa-inbox"></i></button>
           <button class="btn-icon btn-del" title="Delete" data-del="${o.id}"><i class="fas fa-trash"></i></button>
         </div>`;
    const tr = document.createElement('tr');
    tr.innerHTML = `
      <td>${idx + 1}</td>
      <td>${o.item_name || o.item_code}</td>
      <td>${o.ordered_qty}</td>
      <td>${o.received_qty || 0}</td>
      <td>${pending}</td>
      <td><span class="${statusClass}">${statusLabel}</span></td>
      <td>${safeReference}</td>
      <td>${dateDisplay}</td>
      <td>${actionsHtml}</td>
    `;
    tbody.appendChild(tr);
  });

  // Wire actions
  tbody.querySelectorAll('button[data-recv]').forEach(btn => {
    btn.addEventListener('click', async () => {
      const id = Number(btn.getAttribute('data-recv'));
      const input = tbody.querySelector(`input[data-recv-input="${id}"]`);
      const qty = parseInt(input?.value);
      if (isNaN(qty) || qty <= 0) { showMessage('Enter a quantity to receive.', true); return; }
      const idx = ordersCache.findIndex(x => x.id === id);
      if (idx === -1) return;
      const o = ordersCache[idx];
      const pending = Math.max(0, (o.ordered_qty || 0) - (o.received_qty || 0));
      if (pending <= 0) { showMessage('This order is already fully received.', true); return; }
      const apply = Math.min(qty, pending);
      if (apply <= 0) { showMessage('Enter a quantity to receive.', true); return; }

      const successMessage = `${apply} units of ${o.item_name || o.item_code} received and awaiting stocking.`;
      receiveOrder(id, apply).then(updated => {
        if (updated) {
          showMessage(successMessage, false);
          fetchOrders().then(() => {
            renderOrdersTable();
            renderStockLog();
          });
        }
      });
    });
  });
  tbody.querySelectorAll('button[data-del]').forEach(btn => {
    btn.addEventListener('click', () => {
      const id = Number(btn.getAttribute('data-del'));
      const ord = ordersCache.find(o => o.id === id);
      const referenceLabel = (ord?.reference || '').trim();
      const label = ord ? `${ord.item_name || ord.item_code}${referenceLabel ? ` (Ref: ${referenceLabel})` : ''}` : '';
      const ok = window.confirm(`Are you sure you want to delete this order${label ? `: ${label}` : ''}?`);
      if (!ok) return;
      deleteOrder(id).then(success => {
        if (success) {
          fetchOrders().then(() => {
            renderOrdersTable();
            renderReceivedSummary();
            renderStockLog();
          });
        }
      });
    });
  });

  renderReceivedSummary();
}

function wireOrderForm() {
  const form = document.getElementById('order-form');
  if (!form) return;
  form.addEventListener('submit', (e) => {
    e.preventDefault();
    const code = document.getElementById('order-item-code')?.value;
    const qty = parseInt(document.getElementById('order-qty')?.value);
    const ref = (document.getElementById('order-ref')?.value || '').trim();
    if (!code || isNaN(qty) || qty <= 0) { showMessage('Select item and enter order quantity.', true); return; }
    const item = currentInventory.find(i => i.item_code === code) || { item_code: code, name: code };
    createOrder(item.item_code, item.name || item.item_code, qty, ref).then(order => {
      if (order) {
        form.reset();
        populateOrderDropdownFromInventory(currentInventory);
        renderOrdersTable();
        showMessage('Order added.', false);
        renderReceivedSummary();
        renderStockLog();
      }
    });
  });
}

// No hardcoded item list anymore; everything is read from backend

// ===========================================
// DATA FETCHING AND RENDERING
// ===========================================

function populateItemDropdownFromInventory(items) {
  const dropdown = document.getElementById('item-name');
  if (!dropdown) return;
  dropdown.innerHTML = '<option value="" disabled selected>Select an Item</option>';
  const sorted = [...(items || [])].sort((a, b) => String(a.item_code).localeCompare(String(b.item_code)));
  sorted.forEach(item => {
    const option = document.createElement('option');
    option.value = item.item_code;
    const label = item.name ? `${item.name} (${item.item_code})` : item.item_code;
    option.textContent = label;
    dropdown.appendChild(option);
  });
  updateReceivedBadge(dropdown.value);
  dropdown.addEventListener('change', (e) => updateReceivedBadge(e.target.value));
}

function populateOrderDropdownFromInventory(items) {
  const sel = document.getElementById('order-item-code');
  if (!sel) return;
  sel.innerHTML = '<option value="" disabled selected>Select an Item</option>';
  const sorted = [...(items || [])].sort((a, b) => String(a.item_code).localeCompare(String(b.item_code)));
  sorted.forEach(item => {
    const option = document.createElement('option');
    option.value = item.item_code;
    const label = item.name ? `${item.name} (${item.item_code})` : item.item_code;
    option.textContent = label;
    sel.appendChild(option);
  });
}

async function fetchItems() {
  try {
    const response = await authFetch(`${API_BASE_URL}/items/`);
    if (!response.ok) {
      throw new Error(`API failed with status: ${response.status}`);
    }
    const items = await response.json();
    currentInventory = items;
    await Promise.all([fetchOrders(), fetchReceipts(), fetchStockLogs(), fetchStudentPending()]);
    await renderItems(items);
  } catch (error) {
    console.error('Error fetching inventory items:', error);
    showMessage('Failed to load inventory stock. Ensure the API is running.', true);
  }
}

async function renderItems(items) {
  populateItemDropdownFromInventory(items);
  populateOrderDropdownFromInventory(items);
  await renderInventoryChart(items);
  const selected = document.getElementById('item-name')?.value;
  updateReceivedBadge(selected);
  renderReceivedSummary();
}

async function renderInventoryChart(items) {
  let canvas = document.getElementById('inventoryChart');
  if (!canvas) return;

  destroyInventoryChartInstance(canvas);
  const refreshedCanvas = resetInventoryChartCanvas(canvas);
  if (refreshedCanvas) {
    canvas = refreshedCanvas;
  }

  Object.keys(closingStockByCode).forEach(key => delete closingStockByCode[key]);

  try {
    const issueRecordsRes = await authFetch(`${API_BASE_URL}/issue-records/`);
    const issueRecords = await issueRecordsRes.json();

    const issuedQuantities = {};
    issueRecords.forEach(record => {
      issuedQuantities[record.item_code] = (issuedQuantities[record.item_code] || 0) + (record.qty_issued || 0);
    });

    const sortedItems = [...(items || [])].sort((a, b) => {
      const nameA = String(a.name || a.item_code || '').toLowerCase();
      const nameB = String(b.name || b.item_code || '').toLowerCase();
      if (nameA < nameB) return -1;
      if (nameA > nameB) return 1;
      return 0;
    });

    const chartItems = sortedItems;
    const labels = [];
    const openingStock = [];
    const closingStock = [];
    const itemIds = [];
    const itemCodes = [];

    let maxValue = 0;
    sortedItems.forEach(item => {
      const itemName = item.name || item.item_code;
      labels.push(itemName);
      itemIds.push(item.id);
      const issued = issuedQuantities[item.item_code] || 0;
      const opening = item.quantity || 0;
      openingStock.push(opening);
      const closing = Math.max(0, opening - issued);
      closingStock.push(closing);
      maxValue = Math.max(maxValue, opening, closing);
      itemCodes.push(item.item_code);
      const rawCode = item.item_code || '';
      const norm = normalizeCode(rawCode);
      closingStockByCode[rawCode] = closing;
      if (norm) closingStockByCode[norm] = closing;
    });

    // Use theme-aware professional palette (purple + complementary teal)
    const primaryPurple = cssVar('--purple') || '#7C3AED';
    const secondaryTeal = cssVar('--teal') || cssVar('--success') || '#14B8A6';

    inventoryChart = new Chart(canvas, {
      type: 'bar',
      data: {
        labels,
        datasets: [
          {
            label: 'Opening Stock',
            data: openingStock,
            backgroundColor: 'rgba(34,197,94,0.7)',
            borderColor: 'rgba(34,197,94,1)',
            borderWidth: 2,
            minBarLength: 14,
            itemIds,
            itemCodes,
            itemType: 'opening'
          },
          {
            label: 'Closing Stock',
            data: closingStock,
            backgroundColor: 'rgba(82,53,150,0.65)',
            borderColor: 'rgba(82,53,150,1)',
            borderWidth: 2,
            minBarLength: 14,
            itemIds,
            itemCodes,
            itemType: 'closing'
          }
        ]
      },
      options: {
        responsive: true,
        maintainAspectRatio: false,
        layout: { padding: { top: 36 } },
        interaction: { mode: 'nearest', intersect: false, axis: 'x' },
        plugins: {
          legend: {
            display: true,
            position: 'top',
            labels: { usePointStyle: true, padding: 16 }
          },
          tooltip: {
            callbacks: {
              afterLabel: function() { return 'Click to adjust'; }
            }
          },
          datalabels: {
            display: true,
            color: '#111827',
            font: { weight: 'bold', size: 12 },
            formatter: (v) => v,
            anchor: 'end', align: 'top', offset: 12
          }
        },
        scales: {
          y: { beginAtZero: true, suggestedMax: Math.ceil(maxValue * 1.15), grid: { color: 'rgba(0,0,0,0.05)' }, title: { display: true, text: 'Quantity' } },
          x: { grid: { display: false }, title: { display: true, text: 'Items' } }
        },
        onClick: (event, elements, chart) => {
          const targetChart = chart || inventoryChart;
          if (!targetChart) return;
          const points = (elements && elements.length)
            ? elements
            : targetChart.getElementsAtEventForMode(event, 'nearest', { intersect: false, axis: 'x' }, true) || [];
          if (!points.length) {
            console.debug('Inventory chart click: no elements resolved');
            return;
          }

          const { datasetIndex, index } = points[0];
          const dataset = targetChart.data?.datasets?.[datasetIndex];
          if (!dataset) {
            console.warn('Inventory chart click: dataset missing for point', points[0]);
            return;
          }

          let item = chartItems?.[index];

          if (!item) {
            const datasetItemIds = dataset.itemIds || itemIds;
            const datasetItemCodes = dataset.itemCodes || itemCodes;
            const rawId = datasetItemIds ? datasetItemIds[index] : undefined;
            const itemId = rawId !== undefined && rawId !== null ? rawId : undefined;
            const itemCode = datasetItemCodes ? datasetItemCodes[index] : undefined;

            if (itemId !== undefined) {
              item = chartItems.find(i => String(i.id) === String(itemId));
              if (!item && items) {
                item = items.find(i => String(i.id) === String(itemId));
              }
            }
            if (!item && itemCode) {
              item = chartItems.find(i => i.item_code === itemCode);
              if (!item && items) {
                item = items.find(i => i.item_code === itemCode);
              }
            }

            if (!item) {
              console.warn('Inventory chart click could not resolve item for index', { datasetIndex, index, itemId, itemCode });
            }
          }

          if (item) {
            console.debug('Inventory chart click resolved item', { datasetIndex, index, item });
            showItemEditModal(item);
          } else {
            showMessage('Unable to resolve item for that bar. Try refreshing the page.', true);
          }
        }
      }
    });
  } catch (error) {
    console.error('Error loading issue records:', error);
    showMessage('Failed to load stock data', true);
  }
}

function showItemEditModal(item) {
  if (!item) return;
  const itemName = item.name || item.item_code || 'Unknown Item';
  const { pending } = getReceiptStats(item.item_code);

  const modal = document.createElement('div');
  modal.className = 'modal-overlay';
  modal.innerHTML = `
    <div class="modal-content">
      <h3>Edit Item: ${itemName}</h3>
      <div class="modal-body">
        <label for="adjust-quantity">Adjust by (e.g., 10):</label>
        <input type="number" id="adjust-quantity" value="0" min="0" required>
        <div style="font-size:12px;color:#6b7280;margin-top:4px;">
          Increase will add to current stock. Decrease will subtract. Received available to stock: <strong>${pending}</strong>.
        </div>
      </div>
      <div class="modal-actions">
        <button id="increase-item" class="btn-primary">Increase</button>
        <button id="decrease-item" class="btn-danger">Decrease</button>
        <button id="cancel-edit" class="btn-secondary">Cancel</button>
      </div>
    </div>
  `;

  document.body.appendChild(modal);

  const closeModal = () => modal.remove();
  const qtyInput = modal.querySelector('#adjust-quantity');
  const increaseBtn = modal.querySelector('#increase-item');
  const decreaseBtn = modal.querySelector('#decrease-item');
  const cancelBtn = modal.querySelector('#cancel-edit');

  const parseDelta = () => {
    const raw = parseInt(qtyInput?.value, 10);
    return Number.isFinite(raw) ? raw : NaN;
  };

  if (increaseBtn) {
    increaseBtn.addEventListener('click', async () => {
      const delta = parseDelta();
      if (delta > 0) {
        const ok = await updateItemQuantityDelta(item, delta);
        if (ok) closeModal();
      } else {
        showMessage('Enter a positive number to increase.', true);
      }
    });
  }

  if (decreaseBtn) {
    decreaseBtn.addEventListener('click', async () => {
      const delta = parseDelta();
      if (delta > 0) {
        const ok = await updateItemQuantityDelta(item, -delta, null, { restoreToPending: true });
        if (ok) closeModal();
      } else {
        showMessage('Enter a positive number to decrease.', true);
      }
    });
  }

  if (cancelBtn) cancelBtn.addEventListener('click', closeModal);
  modal.addEventListener('click', (event) => { if (event.target === modal) closeModal(); });
}

async function updateItemQuantity(itemId, newQuantity) {
  try {
    const existing = currentInventory.find(i => i.id === itemId) || {};
    const name = existing.name || existing.item_code;
    const item_code = existing.item_code;
    if (typeof item_code === 'string') {
      const { totalReceived } = getReceiptStats(item_code);
      if (totalReceived && Number(newQuantity) > totalReceived) {
        showMessage(`You have received only ${totalReceived} units of ${name}. Cannot set inventory to ${newQuantity}.`, true);
        return;
      }
    }
    const response = await authFetch(`${API_BASE_URL}/items/${itemId}/`, {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json', 'X-CSRFToken': getCookie('csrftoken') },
      body: JSON.stringify({ item_code: existing.item_code, name: name, quantity: newQuantity })
    });

    if (response.ok) {
      showMessage('Item quantity updated successfully!', false);
      appendStockLog(existing.item_code, name, (newQuantity - (existing.quantity || 0)), 'Direct set');
      fetchItems();
    } else {
      const error = await response.json();
      throw new Error(JSON.stringify(error) || 'Update failed.');
    }
  } catch (error) {
    console.error('Error updating item:', error);
    showMessage(`Error updating item: ${error.message}`, true);
  }
}

async function updateItemQuantityDelta(item, delta, reasonOverride = null, options = {}) {
  try {
    const name = item.name || item.item_code;
    const previousQuantity = Number(item.quantity || 0);
    const newQuantity = Math.max(0, previousQuantity + delta);
    const receivedIncrement = Math.max(0, Number(options.receivedIncrement || 0));
    const successMessageOverride = options.successMessage;
    const { pending } = getReceiptStats(item.item_code);
    if (delta > 0 && delta > pending) {
      showMessage(`Only ${pending} units received for ${name}. Add a smaller quantity or receive more stock first.`, true);
      return false;
    }
    if (delta < 0 && Math.abs(delta) > previousQuantity) {
      showMessage(`${name} has only ${previousQuantity} units in stock. Cannot decrease by ${Math.abs(delta)}.`, true);
      return false;
    }
    const response = await authFetch(`${API_BASE_URL}/items/${item.id}/`, {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json', 'X-CSRFToken': getCookie('csrftoken') },
      body: JSON.stringify({ item_code: item.item_code, name: name, quantity: newQuantity })
    });

    if (response.ok) {
      const actionText = delta >= 0 ? `increased by ${delta}` : `decreased by ${-delta}`;
      const reason = reasonOverride || (delta >= 0 ? 'Manual increase' : 'Manual decrease');
      const messageText = successMessageOverride || `${name} stock ${actionText}.`;
      showMessage(messageText, false);
      appendStockLog(item.item_code, name, delta, reason, { previousQuantity, newQuantity });
      currentInventory = currentInventory.map(invItem =>
        invItem.id === item.id
          ? { ...invItem, quantity: newQuantity }
          : invItem
      );

      let updatedClosing = null;
      if (inventoryChart) {
        const chartData = inventoryChart.data;
        if (chartData?.datasets?.length) {
          chartData.datasets.forEach(dataset => {
            const idx = dataset.itemIds?.findIndex(id => String(id) === String(item.id));
            if (idx != null && idx !== -1) {
              if (dataset.itemType === 'opening') dataset.data[idx] = newQuantity;
              if (dataset.itemType === 'closing') {
                dataset.data[idx] = Math.max(0, dataset.data[idx] + delta);
                updatedClosing = dataset.data[idx];
              }
            }
          });
          inventoryChart.update();
        }
      }

      const rawCode = item.item_code || '';
      const normCode = normalizeCode(rawCode);
      if (updatedClosing == null) {
        const currentClosingValue = (rawCode && closingStockByCode[rawCode] != null)
          ? closingStockByCode[rawCode]
          : (normCode && closingStockByCode[normCode] != null)
            ? closingStockByCode[normCode]
            : previousQuantity;
        updatedClosing = Math.max(0, currentClosingValue + delta);
      }
      if (rawCode) closingStockByCode[rawCode] = updatedClosing;
      if (normCode) closingStockByCode[normCode] = updatedClosing;

      item.quantity = newQuantity;
      renderReceivedSummary();
      if (delta > 0) {
        await consumeReceived(item.item_code, delta);
      } else if (delta < 0 && options.restoreToPending) {
        await increaseReceived(item.item_code, Math.abs(delta));
      }
      return true;
    } else {
      const error = await response.json();
      throw new Error(JSON.stringify(error) || 'Update failed.');
    }
  } catch (error) {
    console.error('Error updating item:', error);
    showMessage(`Error updating item: ${error.message}`, true);
    return false;
  }
}

// ===========================================
// CRUD LOGIC: ADD (now supports creating new items dynamically)
// ===========================================

const addItem = async (event) => {
  event.preventDefault();

  const qtyInput = document.getElementById('item-qty');
  const rawQty = qtyInput?.value || '';
  const parsedQty = parseInt(rawQty, 10);
  const quantity = Number.isFinite(parsedQty) && parsedQty > 0 ? parsedQty : 0;

  const itemCode = (document.getElementById('new-item-code')?.value || '').trim().toUpperCase();
  const itemName = (document.getElementById('new-item-name')?.value || '').trim();

  if (!itemCode || !itemName) {
    showMessage('Enter item code and name.', true);
    return;
  }

  if (parsedQty < 0) {
    showMessage('Initial quantity cannot be negative.', true);
    return;
  }

  const existingItem = currentInventory.find(item => normalizeCode(item.item_code) === normalizeCode(itemCode));
  if (existingItem) {
    showMessage(`${itemCode} already exists. Use the inventory chart to adjust stock.`, true);
    return;
  }

  const nameExists = currentInventory.some(item => (item.name || '').trim().toLowerCase() === itemName.toLowerCase());
  if (nameExists) {
    showMessage(`An item named "${itemName}" already exists. Choose a different name.`, true);
    return;
  }

  const method = 'POST';
  const url = `${API_BASE_URL}/items/`;
  const bodyData = { name: itemName, item_code: itemCode, quantity };

  try {
    const response = await authFetch(url, {
      method,
      headers: { 'Content-Type': 'application/json', 'X-CSRFToken': getCookie('csrftoken') },
      body: JSON.stringify(bodyData)
    });

    if (!response.ok) {
      const error = await response.json();
      throw new Error(JSON.stringify(error) || `${method} failed.`);
    }

    const quantityMessage = quantity > 0 ? ' with initial stock added' : '';
    showMessage(`${itemName} created${quantityMessage} successfully!`, false);
    if (quantity > 0) {
      appendStockLog(
        itemCode,
        itemName,
        quantity,
        'Initial stock on creation',
        { applyChange: false, previousQuantity: 0, newQuantity: quantity }
      );
    }
    if (qtyInput) qtyInput.value = '';
    const codeInput = document.getElementById('new-item-code');
    const nameInput = document.getElementById('new-item-name');
    if (codeInput) codeInput.value = '';
    if (nameInput) nameInput.value = '';
    fetchItems();
  } catch (error) {
    console.error('Error saving item:', error);
    showMessage(`Error saving item: ${error.message}`, true);
  }
};

// ===========================================
// INIT
// ===========================================

document.addEventListener('DOMContentLoaded', function () {
  fetchItems().then(() => {
    renderOrdersTable();
    renderStockLog();
  }).catch((error) => {
    console.error('Initial data load failed:', error);
  });

  const itemForm = document.getElementById('item-form');
  if (itemForm) itemForm.addEventListener('submit', addItem);

  wireOrderForm();

  // Export button
  const exportBtn = document.getElementById('export-stock-log');
  if (exportBtn) exportBtn.addEventListener('click', exportStockLogXLSX);
  const yearSelect = document.getElementById('stock-log-year');
  const monthSelect = document.getElementById('stock-log-month');
  if (yearSelect) yearSelect.addEventListener('change', renderStockLog);
  if (monthSelect) monthSelect.addEventListener('change', renderStockLog);
  const clearLogBtn = document.getElementById('clear-stock-log');
  if (clearLogBtn) {
    clearLogBtn.addEventListener('click', () => {
      const ok = window.confirm('Delete all stock change log entries? This cannot be undone.');
      if (!ok) return;
      authFetch(`${API_BASE_URL}/stock-logs/clear/`, {
        method: 'DELETE'
      }).then(async (resp) => {
        if (!resp.ok) throw new Error(`Clear failed: ${resp.status}`);
        await fetchStockLogs();
        renderStockLog();
        showMessage('Stock change log cleared.', false);
      }).catch((error) => {
        console.error('Error clearing stock logs:', error);
        showMessage('Failed to clear stock change log.', true);
      });
    });
  }
});
