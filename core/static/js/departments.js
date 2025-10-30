// core/static/js/departments.js
// Base URL for your Django backend API
const API_BASE_URL = "http://127.0.0.1:8000/api";
const ENABLE_DYNAMIC_ITEM_COLUMNS = true; // show dynamic columns for items present in inventory
let ITEMS_MASTER = [];
const LEGACY_CODES = ['2PN','2PR','2PO','1PN','1PR','1PO'];

// Helper function to get CSRF token from cookie (re-added for self-contained use)
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

function renderDistributionBadges(dept, inventoryCodes) {
    const entries = [];
    if (!dept || !inventoryCodes) return '';

    // Legacy stock fields stored on Department
    const legacyMapping = [
        ['2PN', Number(dept.two_hundred_notebook || 0)],
        ['2PR', Number(dept.two_hundred_record || 0)],
        ['2PO', Number(dept.two_hundred_observation || 0)],
        ['1PN', Number(dept.one_hundred_notebook || 0)],
        ['1PR', Number(dept.one_hundred_record || 0)],
        ['1PO', Number(dept.one_hundred_observation || 0)]
    ];

    legacyMapping.forEach(([code, qty]) => {
        const upper = String(code).toUpperCase();
        if (inventoryCodes.has(upper) && qty > 0) {
            entries.push(`<span style="font-size:9px;background:#f3f4f6;padding:2px 6px;border-radius:10px;">${upper}: ${qty}</span>`);
        }
    });

    const reqMap = dept.__reqMap || {};

function extractApiError(err) {
    if (!err) return '';
    if (typeof err === 'string') return err;
    if (Array.isArray(err)) return err.map(extractApiError).filter(Boolean).join(' ');
    if (typeof err === 'object') {
        if (err.non_field_errors) return extractApiError(err.non_field_errors);
        if (err.detail) return extractApiError(err.detail);
        const dupKeys = ['course_code', 'course', 'year', 'academic_year'];
        if (dupKeys.every(key => err[key])) {
            return 'Duplicate department: the combination of course, course code, academic year, and year must be unique.';
        }
        const keys = Object.keys(err);
        if (keys.length) {
            const key = keys[0];
            const label = key.replace(/_/g, ' ');
            const value = extractApiError(err[key]);
            return value ? `${label}: ${value}` : label;
        }
    }
    return '';
}
    Object.entries(reqMap).forEach(([code, value]) => {
        const upper = String(code).toUpperCase();
        const qty = Number(value || 0);
        if (!qty || qty <= 0) return;
        if (!inventoryCodes.has(upper)) return;
        if (legacyMapping.some(([legacyCode]) => legacyCode === upper)) return;
        entries.push(`<span style="font-size:9px;background:#eef2ff;color:#3730a3;padding:2px 6px;border-radius:10px;">${upper}: ${qty}</span>`);
    });

    if (!entries.length) return '';

    return `
        <div style="padding-top:10px;border-top:1px solid #f0f0f0;">
            <div style="font-size:10px;color:var(--muted);margin-bottom:5px;">Book Distribution</div>
            <div style="display:flex;gap:6px;flex-wrap:wrap;">
                ${entries.join('')}
            </div>
        </div>
    `;
}

// Compute and update the Total cell value for a row based on legacy + dynamic inputs
function recalcRowTotal(row) {
    if (!row) return 0;
    const valOrZero = (el) => {
        if (!el) return 0;
        const v = (el.value || '').trim();
        const n = v === '' ? 0 : Number(v);
        return isNaN(n) ? 0 : n;
    };

    // Sum legacy item inputs if present in this row
    const legacyFields = [
        'two_hundred_notebook',
        'two_hundred_record',
        'two_hundred_observation',
        'one_hundred_notebook',
        'one_hundred_record',
        'one_hundred_observation'
    ];
    let sum = 0;
    legacyFields.forEach(f => {
        const inp = row.querySelector(`td[data-field="${f}"] input[type="number"]`);
        sum += valOrZero(inp);
    });

    // Sum dynamic requirement inputs in this row
    const dynInputs = row.querySelectorAll('td[data-dyn="1"] input[type="number"]');
    dynInputs.forEach(inp => { sum += valOrZero(inp); });

    // Update the Total input if present
    const totalInput = row.querySelector('td[data-field="total"] input[type="number"]');
    if (totalInput) totalInput.value = sum;
    return sum;
}

// Build dynamic inputs for ALL inventory items (including legacy) in Add Department form
function renderDynamicItemInputs() {
    const box = document.getElementById('all-item-dynamic');
    if (!box) return;
    box.innerHTML = '';
    // All inventory items
    const items = (ITEMS_MASTER || []).slice().sort((a,b)=>String(a.item_code).localeCompare(String(b.item_code)));

    items.forEach(it => {
        const code = String(it.item_code || '').toUpperCase();
        const input = document.createElement('input');
        input.type = 'number';
        input.min = '0';
        input.value = '';
        input.placeholder = `${it.name || code} (${code})`;
        input.setAttribute('data-item-code', code);
        input.style.width = '100%';
        box.appendChild(input);
    });
}

// Collect dynamic inputs into requirements payload (defaults blank to 0)
function collectDynamicItemInputs() {
    const box = document.getElementById('all-item-dynamic');
    if (!box) return [];
    const inputs = Array.from(box.querySelectorAll('input[data-item-code]'));
    return inputs.map(inp => {
        const code = inp.getAttribute('data-item-code');
        const v = (inp.value || '').trim();
        const qty = v === '' ? 0 : Number(v);
        return { item_code: code, required_qty: isNaN(qty) ? 0 : qty };
    });
}

function getDynamicInputsMap() {
    const list = collectDynamicItemInputs();
    const map = {};
    list.forEach(r => { map[String(r.item_code).toUpperCase()] = Number(r.required_qty || 0); });
    return map;
}

// ===== Inventory-driven visibility for legacy fields/columns =====
function getInventoryCodes() {
    return new Set((ITEMS_MASTER || []).map(it => String(it.item_code || '').toUpperCase()));
}

function updateLegacyVisibility() {
    const inv = getInventoryCodes();
    // Always hide fixed legacy inputs; we will render from inventory list instead
    ['notebook200','record200','observation200','notebook100','record100','observation100'].forEach(id => {
        const el = document.getElementById(id);
        if (el) el.style.display = 'none';
    });

    // Toggle table header columns and matching cells per row (only show legacy columns if code in inventory)
    const theadRow = document.querySelector('.department-table thead tr');
    if (!theadRow) return;
    const ths = Array.from(theadRow.querySelectorAll('th'));
    // Build index map: code -> column index
    const codeToIndex = {};
    ths.forEach((th, idx) => {
        const code = th.getAttribute('data-code');
        if (code) codeToIndex[code.toUpperCase()] = idx;
    });
    // Toggle header visibility and row cells
    Object.keys(codeToIndex).forEach(code => {
        const idx = codeToIndex[code];
        const present = inv.has(code);
        const th = ths[idx];
        if (th) th.style.display = present ? '' : 'none';
        const rows = document.querySelectorAll('.department-table tbody tr');
        rows.forEach(tr => {
            const tds = tr.children;
            if (tds && tds[idx]) {
                tds[idx].style.display = present ? '' : 'none';
            }
        });
    });
}


// Fetch items list to drive dynamic UI
async function fetchItemsMaster() {
    try {
        const resp = await authFetch(`${API_BASE_URL}/items/`);
        if (!resp.ok) throw new Error('items fetch failed');
        ITEMS_MASTER = await resp.json();
    } catch (e) {
        console.warn('Failed to load items for dynamic UI');
        ITEMS_MASTER = [];
    }
}

// ===== Dynamic Item Requirements Editor =====
let REQ_STATE = { departments: [], currentDeptId: null, rows: [] };

function setupRequirementsEditor() {
    const loadBtn = document.getElementById('req-load-btn');
    const saveBtn = document.getElementById('req-save-btn');
    const addBtn = document.getElementById('add-item-btn');

    loadBtn?.addEventListener('click', onReqLoad);
    saveBtn?.addEventListener('click', onReqSave);
    addBtn?.addEventListener('click', onReqAddItem);
}

function populateReqFilters(departments) {
    REQ_STATE.departments = Array.isArray(departments) ? departments : [];
    const codeSel = document.getElementById('req-course-code');
    const courseSel = document.getElementById('req-course');
    const aySel = document.getElementById('req-academic-year');
    const yearSel = document.getElementById('req-year');
    if (!codeSel || !courseSel || !aySel || !yearSel) return;

    const uniq = (arr) => Array.from(new Set(arr.filter(v => v && String(v).trim() !== '')));
    const codes = uniq(departments.map(d => d.course_code));
    const courses = uniq(departments.map(d => d.course));
    const ays = uniq(departments.map(d => d.academic_year)).reverse();
    const years = uniq(departments.map(d => String(d.year)));

    const fill = (sel, values) => { sel.innerHTML = '<option value="">Select</option>'; values.forEach(v => sel.innerHTML += `<option value="${v}">${v}</option>`); };
    fill(codeSel, codes);
    fill(courseSel, courses);
    fill(aySel, ays);
    fill(yearSel, years);
}

async function onReqLoad() {
    const code = document.getElementById('req-course-code')?.value || '';
    const course = document.getElementById('req-course')?.value || '';
    const ay = document.getElementById('req-academic-year')?.value || '';
    const year = document.getElementById('req-year')?.value || '';
    if (!code || !course || !ay || !year) {
        showMessage('Select Code, Course, Academic Year and Year, then click Load.', true);
        return;
    }

    const qs = new URLSearchParams({ course_code: code, course, academic_year: ay, year }).toString();
    const resp = await authFetch(`${API_BASE_URL.replace(/\/$/, '')}/requirements/?${qs}`);
    if (!resp.ok) {
        const err = await resp.json().catch(() => ({}));
        showMessage(err.error || 'Failed to load requirements', true);
        return;
    }
    const data = await resp.json();
    REQ_STATE.currentDeptId = data.department_id;
    REQ_STATE.rows = Array.isArray(data.requirements) ? data.requirements : [];
    renderReqEditor({ code, course, ay, year });
}

function renderReqEditor(meta) {
    const editor = document.getElementById('req-editor');
    const label = document.getElementById('req-dept-label');
    const tbody = document.getElementById('req-body');
    if (!editor || !label || !tbody) return;
    editor.style.display = 'block';
    label.textContent = `${meta.course} (${meta.code}) • ${meta.ay} • Y${meta.year}`;

    const rows = REQ_STATE.rows;
    tbody.innerHTML = rows.map(r => {
        const code = r.item_code || '';
        const name = r.item_name || '';
        const qty = Number(r.required_qty || 0);
        return `
            <tr data-item-code="${code}">
                <td>${name}</td>
                <td>${code}</td>
                <td><input type="number" min="0" value="${qty}" class="req-qty-input" style="width:100%;"></td>
                <td>
                    <button type="button" class="req-clear-btn">Clear</button>
                </td>
            </tr>
        `;
    }).join('');

    // Wire clear buttons
    tbody.querySelectorAll('.req-clear-btn').forEach(btn => {
        btn.addEventListener('click', (e) => {
            const tr = e.target.closest('tr');
            const input = tr?.querySelector('.req-qty-input');
            if (input) input.value = 0;
        });
    });
}

async function onReqAddItem() {
    const nameEl = document.getElementById('add-item-name');
    const codeEl = document.getElementById('add-item-code');
    const qtyEl = document.getElementById('add-item-qty');
    const name = (nameEl?.value || '').trim();
    const code = (codeEl?.value || '').trim().toUpperCase();
    const qty = parseInt(qtyEl?.value || '0', 10) || 0;
    if (!name || !code) { showMessage('Enter item name and code', true); return; }

    // Ensure item exists
    const createResp = await authFetch(`${API_BASE_URL}/items/`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ item_code: code, name, quantity: 0 })
    });
    if (!createResp.ok && createResp.status !== 400) {
        // 400 may be because item already exists
        const err = await createResp.json().catch(() => ({}));
        if (createResp.status !== 400) {
            showMessage(err.detail || err.error || 'Failed to create item', true);
            return;
        }
    }

    // Append to current table model
    REQ_STATE.rows = REQ_STATE.rows || [];
    // Avoid duplicates
    if (!REQ_STATE.rows.some(r => (r.item_code || '').toUpperCase() === code)) {
        REQ_STATE.rows.push({ item_code: code, item_name: name, required_qty: qty });
    }
    // Re-render keeping label
    const codeSel = document.getElementById('req-course-code')?.value || '';
    const courseSel = document.getElementById('req-course')?.value || '';
    const aySel = document.getElementById('req-academic-year')?.value || '';
    const yearSel = document.getElementById('req-year')?.value || '';
    renderReqEditor({ code: codeSel, course: courseSel, ay: aySel, year: yearSel });
}

async function onReqSave() {
    const tbody = document.getElementById('req-body');
    const deptId = REQ_STATE.currentDeptId;
    if (!tbody || !deptId) { showMessage('Load a cohort first', true); return; }
    const rows = Array.from(tbody.querySelectorAll('tr'));
    const payloadReqs = rows.map(tr => {
        const code = tr.getAttribute('data-item-code');
        const qty = parseInt(tr.querySelector('.req-qty-input')?.value || '0', 10) || 0;
        return { item_code: code, required_qty: qty };
    });
    const resp = await authFetch(`${API_BASE_URL.replace(/\/$/, '')}/requirements/update/`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ department_id: deptId, requirements: payloadReqs })
    });
    const data = await resp.json().catch(() => ({}));
    if (!resp.ok) {
        showMessage(data.error || 'Failed to save requirements', true);
        return;
    }
    showMessage('Requirements saved successfully');
}

// Helper function for making authenticated API requests
async function authFetch(url, options = {}) {
    // Add CSRF token for POST/PUT/DELETE requests if not already present
    if (!options.headers) options.headers = {};
    if (['POST', 'PUT', 'DELETE'].includes(options.method) && !options.headers['X-CSRFToken']) {
        options.headers['X-CSRFToken'] = getCookie('csrftoken');
    }

    const response = await fetch(url, options);

    if (response.status === 401) {
        // Redirect to login page if unauthorized
        window.location.href = '/login';
        throw new Error('Unauthorized');
    }

    return response;
}

// Helper function to display on-page messages
const showMessage = (message, isError = false) => {
    // Target the form container, which is the parent of the actual form elements in the HTML
    const form = document.getElementById("addDepartmentForm"); 
    if (!form) return;

    const messageContainer = document.createElement('div');
    messageContainer.textContent = message;
    messageContainer.className = `message-box ${isError ? 'error' : 'success'}`;
    
    // Insert the message before the form
    const existingMessage = form.parentNode.querySelector('.message-box');
    if (existingMessage) existingMessage.remove();
    
    form.parentNode.insertBefore(messageContainer, form);
    
    setTimeout(() => messageContainer.remove(), 5000);
};

document.addEventListener("DOMContentLoaded", function () {
    // Load items first so UI can build dynamic inputs/columns
    fetchItemsMaster().then(() => {
        try { renderDynamicItemInputs(); } catch(_) {}
        try { updateLegacyVisibility(); } catch(_) {}
        fetchDepartments();
    });

    // Use the form ID to handle submission from the form wrapper
    const addDepartmentForm = document.getElementById("addDepartmentForm");
    if (addDepartmentForm) {
        addDepartmentForm.addEventListener("submit", handleAddDepartment);
    }

    // Setup dynamic total calculation for the add form
    setupDynamicTotalCalculation();

    // Initialize dynamic requirements editor
    setupRequirementsEditor();
});

async function fetchDepartments() {
    try {
        const response = await authFetch(`${API_BASE_URL}/departments/`);
        const departments = await response.json();
        console.log("Fetched departments:", departments); // Debug log
        renderDepartments(departments);
        updateOverviewSection(departments);
    } catch (error) {
        console.error("Error fetching departments:", error);
        if (error.message !== 'Unauthorized') {
            showMessage("Failed to load departments. Please try again.", true);
        }
    }
}

function renderDepartments(departments) {
    const tableBody = document.getElementById("departments-body");
    if (!tableBody) return;
    tableBody.innerHTML = "";
    // Ensure dynamic headers appended
    try { if (ENABLE_DYNAMIC_ITEM_COLUMNS) ensureDynamicHeaders(); } catch(_) {}
    departments.forEach(dept => {
        const row = document.createElement("tr");
        row.dataset.id = dept.id; 
        // Keep cohort attributes on row for dynamic requirements save
        row.dataset.courseCode = dept.course_code || '';
        row.dataset.course = dept.course || '';
        row.dataset.academicYear = dept.academic_year || '';
        row.dataset.year = String(dept.year || '');
        
        // Use Nullish Coalescing (??) to display 0 if the value is null or undefined (not for empty string, which should be handled by serializer)
        const displayValue = (value) => value ?? 0;

        const fields = {
            'course': dept.course,
            'course_code': dept.course_code,
            'academic_year': dept.academic_year || '',
            'year': dept.year,
            'program_type': dept.program_type,
            'intake': displayValue(dept.intake),
            'existing': displayValue(dept.existing),
            'two_hundred_notebook': displayValue(dept.two_hundred_notebook),
            'two_hundred_record': displayValue(dept.two_hundred_record),
            'two_hundred_observation': displayValue(dept.two_hundred_observation),
            'one_hundred_notebook': displayValue(dept.one_hundred_notebook),
            'one_hundred_record': displayValue(dept.one_hundred_record),
            'one_hundred_observation': displayValue(dept.one_hundred_observation),
            'total': displayValue(dept.total)
        };

        row.innerHTML = `
            <td data-field="course" data-value="${fields.course || ''}">${fields.course || ''}</td>
            <td data-field="course_code" data-value="${fields.course_code || ''}">${fields.course_code || ''}</td>
            <td data-field="academic_year" data-value="${fields.academic_year || ''}">${fields.academic_year || ''}</td>
            <td data-field="year" data-value="${fields.year || ''}">${fields.year || ''}</td>
            <td data-field="program_type" data-value="${fields.program_type || ''}">${fields.program_type || ''}</td>
            <td data-field="intake" data-value="${fields.intake}">${fields.intake}</td>
            <td data-field="existing" data-value="${fields.existing}">${fields.existing}</td>
            <td data-field="two_hundred_notebook" data-value="${fields.two_hundred_notebook}">${fields.two_hundred_notebook}</td>
            <td data-field="two_hundred_record" data-value="${fields.two_hundred_record}">${fields.two_hundred_record}</td>
            <td data-field="two_hundred_observation" data-value="${fields.two_hundred_observation}">${fields.two_hundred_observation}</td>
            <td data-field="one_hundred_notebook" data-value="${fields.one_hundred_notebook}">${fields.one_hundred_notebook}</td>
            <td data-field="one_hundred_record" data-value="${fields.one_hundred_record}">${fields.one_hundred_record}</td>
            <td data-field="one_hundred_observation" data-value="${fields.one_hundred_observation}">${fields.one_hundred_observation}</td>
            <td data-field="total" data-value="${fields.total}">${fields.total}</td>
            <td data-actions="1">
                <button class="edit-btn" data-id="${dept.id}" onclick="editDepartment('${dept.id}')">Edit</button>
                <button class="delete-btn" data-id="${dept.id}">Delete</button>
            </td>
        `;
        tableBody.appendChild(row);

        // Append dynamic item cells (default 0; fill asynchronously from requirements)
        if (ENABLE_DYNAMIC_ITEM_COLUMNS) appendDynamicItemCells(row, dept);
    });

    // Update total records count in the header if present
    const countEl = document.getElementById('departments-record-count');
    if (countEl) {
        countEl.textContent = `Total records: ${departments.length}`;
    }

    // Populate cohort filters for requirements editor
    try { populateReqFilters(departments); } catch(_) {}
    // After rows are built, re-apply legacy visibility to hide/show columns and cells
    try { updateLegacyVisibility(); } catch(_) {}
}

// Event listener for edit and delete buttons using event delegation
document.getElementById('departments-body').addEventListener('click', (event) => {
    const target = event.target;
    if (target.classList.contains('edit-btn')) {
        editDepartment(target.dataset.id);
    } else if (target.classList.contains('delete-btn')) {
        deleteDepartment(target.dataset.id);
    }
});

// Exposed globally for onclick in save/cancel buttons
window.saveDepartment = async function(id) { 
    const row = document.querySelector(`tr[data-id='${id}']`);
    if (!row) return;

    const updatedData = {};
    const inputs = row.querySelectorAll('input');
    const stringFields = ['course', 'course_code', 'academic_year', 'year', 'program_type'];

    inputs.forEach(input => {
        const field = input.parentElement.dataset.field;
        const value = input.value.trim();
        
        if (stringFields.includes(field)) {
             // For string fields, just send the value (which might be empty)
             updatedData[field] = value;
        } else {
             // CRITICAL FIX for Numerical Fields: Send '' if blank, allowing the serializer to save NULL.
             if (value === '') {
                 updatedData[field] = '';
             } 
             // Send the number if valid
             else if (!isNaN(Number(value))) {
                 updatedData[field] = Number(value);
             } 
             // OPTIONAL: If it's non-empty but non-numeric, send 0 or just ignore it.
             // We'll send the number if it's a number, or just let it be blank if bad input.
        }
    });

    // Ensure Total equals the sum of all item quantities in this row
    const computedTotal = recalcRowTotal(row);
    if (!isNaN(computedTotal)) {
        updatedData.total = computedTotal;
        const totalInput = row.querySelector('td[data-field="total"] input');
        if (totalInput) totalInput.value = computedTotal;
    }

    try {
        console.log("Sending update for department", id, "with data:", updatedData);
        
        const response = await authFetch(`${API_BASE_URL}/departments/${id}/`, {
            method: 'PUT',
            headers: { 
                'Content-Type': 'application/json'
            },
            body: JSON.stringify(updatedData)
        });
        
        const responseData = await response.json();
        console.log("Update response:", responseData);

        if (response.ok) {
            showMessage("Department updated successfully!", false);
            // After department fields are saved, save dynamic requirements (non-legacy)
            const dynamicReqs = collectRowDynamicReqs(row);
            if (dynamicReqs.length) {
                const deptId = id;
                try {
                    await authFetch(`${API_BASE_URL}/requirements/update/`, {
                        method: 'PUT',
                        headers: { 'Content-Type': 'application/json' },
                        body: JSON.stringify({ department_id: deptId, requirements: dynamicReqs })
                    });
                } catch (_) {}
            }
            // Force a complete refresh of the departments data
            await fetchDepartments();
            
            // Re-apply any active filters/sorting
            const searchInput = document.getElementById('department-search');
            if (searchInput && searchInput.value) {
                filterDepartments();
            }
            
            // Make sure the table is visible
            const table = document.querySelector('.department-table');
            if (table) {
                table.style.display = 'table';
            }
        } else {
            const errorMsg = extractApiError(responseData) || 'Failed to update department.';
            showMessage(`Error updating department: ${errorMsg || 'Duplicate department detected.'}`, true);
        }
    } catch (error) {
        console.error("Error updating department:", error);
        if (error.message !== 'Unauthorized') {
             showMessage('Failed to update department. Check for duplicate combinations of course, code, academic year, and year, then try again.', true);
        }
    }
}

function getDynamicHeaderCodes() {
    const theadRow = document.querySelector('.department-table thead tr');
    if (!theadRow) return [];
    return Array.from(theadRow.querySelectorAll('th[data-dyn="1"]')).map(th => String(th.getAttribute('data-item-code') || '').toUpperCase());
}

function collectRowDynamicReqs(row) {
    const codes = getDynamicHeaderCodes();
    if (!codes.length) return [];
    const inputs = Array.from(row.querySelectorAll('td[data-dyn="1"] input[data-item-code]'));
    const reqs = [];
    inputs.forEach((inp) => {
        const code = String(inp.getAttribute('data-item-code') || '').toUpperCase();
        const v = (inp.value || '').trim();
        const qty = v === '' ? 0 : Number(v);
        if (!isNaN(qty)) reqs.push({ item_code: code, required_qty: qty });
    });
    // Filter out legacy codes (handled by department fields)
    return reqs.filter(r => !LEGACY_CODES.includes(r.item_code));
}

// Exposed globally for onclick in save/cancel buttons
window.cancelEdit = function(id) {
    fetchDepartments(); // Reload data to discard changes
}


window.editDepartment = function(id) {
    const row = document.querySelector(`tr[data-id='${id}']`);
    if (!row) return;

    // Swap Action cell FIRST to avoid losing the click if any later error happens
    try {
        const buttonsCell = row.querySelector('td[data-actions="1"]') || row.querySelector('td:last-child');
        if (buttonsCell) {
            buttonsCell.innerHTML = `
                <button class="save-btn" onclick="saveDepartment('${id}')">Save</button>
                <button class="cancel-btn" onclick="cancelEdit('${id}')">Cancel</button>
            `;
        }
    } catch (_) {}

    // Define all fields to be editable
    const fields = ['course', 'course_code', 'academic_year', 'year', 'program_type', 'intake', 'existing', 'two_hundred_notebook', 'two_hundred_record', 'two_hundred_observation', 'one_hundred_notebook', 'one_hundred_record', 'one_hundred_observation', 'total'];
    
    fields.forEach(field => {
        const cell = row.querySelector(`td[data-field="${field}"]`);
        if (cell) {
            const dataVal = cell.getAttribute('data-value');
            const raw = (dataVal !== null && dataVal !== undefined) ? String(dataVal) : (cell.textContent || '').trim();
            const isNumericField = ['intake', 'existing', 'two_hundred', 'one_hundred', 'total'].some(name => field.includes(name));
            const inputType = isNumericField ? 'number' : 'text';
            const stepAttr = isNumericField ? ' step="1" min="0"' : '';
            const valueAttr = isNumericField ? (raw === '' ? '0' : raw) : raw;
            cell.innerHTML = `<input type="${inputType}"${stepAttr} value="${valueAttr}" data-original-value="${raw}">`;
        }
    });

    // Also convert dynamic requirement cells to number inputs
    try {
        const headerDynCodes = getDynamicHeaderCodes(); // ordered list of codes
        if (headerDynCodes.length) {
            const tds = Array.from(row.querySelectorAll('td[data-dyn="1"]'));
            tds.forEach((td, idx) => {
                const code = headerDynCodes[idx] || '';
                const dataQty = td.getAttribute('data-qty');
                const raw = (dataQty !== null && dataQty !== undefined) ? String(dataQty) : (td.textContent || '').trim();
                const valueAttr = raw === '' ? '0' : raw;
                td.innerHTML = `<input type="number" min="0" step="1" value="${valueAttr}" data-item-code="${code}">`;
            });
        }
    } catch (_) {}

    // Wire up live total recomputation on any number input change
    const numberInputs = row.querySelectorAll('input[type="number"]');
    numberInputs.forEach(inp => inp.addEventListener('input', () => recalcRowTotal(row)));
    // Initialize once
    recalcRowTotal(row);

    // buttons already swapped above
}

async function handleAddDepartment(event) {
    event.preventDefault(); // Stop default form submission

    // --- CRITICAL FIX in getValue: Allows '' to pass through ---
    const getValue = (id) => {
        const element = document.getElementById(id);
        const value = element ? element.value.trim() : '';
        // If it's empty, send the empty string (which the serializer converts to NULL).
        // If it has a value, send the numerical value.
        return value === '' ? '' : Number(value); 
    };

    // Helper to get string values
    const getStringValue = (id) => {
        const element = document.getElementById(id);
        return element ? element.value.trim() : '';
    }

    // Ensure total is computed from the dynamic inputs before reading the value
    const totalFromInputs = calculateTotalFromForm();
    const totalInput = document.getElementById('total');
    if (totalInput) {
        totalInput.value = totalFromInputs;
    }

    // Map dynamic inputs to legacy six fields (default 0 if absent)
    const dynMap = getDynamicInputsMap();

    const departmentData = {
        course: getStringValue("course-name"),
        course_code: getStringValue("course-code"),
        academic_year: getStringValue("academic-year"),
        year: getStringValue("course-year"),
        program_type: getStringValue("program-type"),
        intake: getValue("intake"),
        existing: getValue("existing"),
        two_hundred_notebook: Number(dynMap['2PN'] || 0),
        two_hundred_record: Number(dynMap['2PR'] || 0),
        two_hundred_observation: Number(dynMap['2PO'] || 0),
        one_hundred_notebook: Number(dynMap['1PN'] || 0),
        one_hundred_record: Number(dynMap['1PR'] || 0),
        one_hundred_observation: Number(dynMap['1PO'] || 0),
        total: Number(totalFromInputs || 0)
    };
    
    console.log("Department data being sent:", departmentData);

    try {
        const response = await authFetch(`${API_BASE_URL}/departments/`, {
            method: 'POST',
            headers: { 
                'Content-Type': 'application/json'
            },
            body: JSON.stringify(departmentData)
        });
        
        const result = await response.json();
        
        if (response.ok) {
            showMessage(result.message || "Department added successfully!", false);
            // After department is created, upsert dynamic requirements for NON-LEGACY items only
            const deptId = result.id || result.pk || null;
            if (deptId) {
                const allReqs = collectDynamicItemInputs();
                const reqs = allReqs.filter(r => !LEGACY_CODES.includes(String(r.item_code).toUpperCase()));
                if (reqs.length) {
                    try {
                        await authFetch(`${API_BASE_URL}/requirements/update/`, {
                            method: 'PUT',
                            headers: { 'Content-Type': 'application/json' },
                            body: JSON.stringify({ department_id: deptId, requirements: reqs })
                        });
                    } catch (_) {}
                }
            }
            document.getElementById("addDepartmentForm").reset();
            // Rebuild dynamic inputs (since reset clears values)
            try { renderDynamicItemInputs(); } catch(_) {}
            fetchDepartments();
            // After reset, reinitialize total field to 0
            setupDynamicTotalCalculation();
        } else {
            const errorMsg = extractApiError(result) || 'Duplicate department detected.';
            showMessage(`Error adding department: ${errorMsg}`, true);
        }
    } catch (error) {
        console.error("Error adding department:", error);
        if (error.message !== 'Unauthorized') {
            showMessage('Failed to add department. The same course, course code, academic year, and year may already exist.', true);
        }
    }
}

async function deleteDepartment(id) {
    if (!confirm("Are you sure you want to delete this department? This action cannot be undone.")) {
        return;
    }
    try {
        const response = await authFetch(`${API_BASE_URL}/departments/${id}/`, {
            method: 'DELETE',
            headers: {
                'X-CSRFToken': getCookie('csrftoken')
            }
        });
        if (response.status === 204) {
            showMessage("Department deleted successfully!", false);
            fetchDepartments();
        } else if (response.ok) {
             showMessage("Department deleted successfully!", false);
            fetchDepartments();
        } else {
            const error = await response.json();
            showMessage(`Error deleting department: ${JSON.stringify(error)}`, true);
        }
    } catch (error) {
        console.error("Error deleting department:", error);
        if (error.message !== 'Unauthorized') {
            showMessage("An unexpected error occurred. Please try again.", true);
        }
    }
}

// ---- Helpers for dynamic total on the add form ----
function setupDynamicTotalCalculation() {
    const totalInput = document.getElementById('total');
    const box = document.getElementById('all-item-dynamic');
    if (!totalInput || !box) return;
    const update = () => { totalInput.value = calculateTotalFromForm(); };
    box.addEventListener('input', (e) => {
        if (e.target && e.target.matches('input[data-item-code]')) update();
    });
    update();
}

function ensureDynamicHeaders() {
    const theadRow = document.querySelector('.department-table thead tr');
    if (!theadRow) return;
    const dynamicItems = (ITEMS_MASTER || []).filter(it => !LEGACY_CODES.includes(String(it.item_code).toUpperCase()));
    if (dynamicItems.length === 0) return; // nothing to add
    // Remove any previously added dynamic headers
    Array.from(theadRow.querySelectorAll('th[data-dyn="1"]')).forEach(el => el.remove());
    // Insert dynamic item headers BEFORE the Total column
    const ths = theadRow.querySelectorAll('th');
    if (!ths || ths.length === 0) return;
    const totalTh = Array.from(ths).find(th => th.getAttribute('data-column') === 'total');
    if (!totalTh) return;
    const frag = document.createDocumentFragment();
    dynamicItems.forEach(it => {
        const th = document.createElement('th');
        th.textContent = `${it.name || it.item_code} (${it.item_code})`;
        th.setAttribute('data-dyn','1');
        th.setAttribute('data-item-code', String(it.item_code).toUpperCase());
        frag.appendChild(th);
    });
    theadRow.insertBefore(frag, totalTh);
}

// Safely append dynamic item cells per row and populate from requirements
async function appendDynamicItemCells(row, dept) {
    try {
        const totalCell = row.querySelector('td[data-field="total"]');
        const items = (ITEMS_MASTER || []).filter(it => !LEGACY_CODES.includes(String(it.item_code).toUpperCase()));
        if (!items.length) return;

        const frag = document.createDocumentFragment();
        items.forEach(() => {
            const td = document.createElement('td');
            td.textContent = '0';
            td.setAttribute('data-dyn','1');
            td.setAttribute('data-qty','0');
            frag.appendChild(td);
        });
        if (totalCell && totalCell.parentNode === row) {
            row.insertBefore(frag, totalCell);
        } else {
            row.appendChild(frag);
        }

        // Fetch requirements for this department cohort to fill values
        const qs = new URLSearchParams({
            course_code: dept.course_code || '',
            course: dept.course || '',
            academic_year: dept.academic_year || '',
            year: String(dept.year || '')
        }).toString();
        const resp = await authFetch(`${API_BASE_URL}/requirements/?${qs}`);
        if (!resp.ok) return;
        const data = await resp.json();
        const reqs = Array.isArray(data.requirements) ? data.requirements : [];
        const map = {};
        reqs.forEach(r => { map[String(r.item_code || '').toUpperCase()] = Number(r.required_qty || 0); });

        const allTds = Array.from(row.querySelectorAll('td'));
        const dynamicCount = items.length;
        // Dynamic cells come right before the total cell
        const totalIdx = allTds.findIndex(td => td.getAttribute('data-field') === 'total');
        let startIndex = totalIdx - dynamicCount;
        if (startIndex < 0) startIndex = 0;
        items.forEach((it, idx) => {
            const code = String(it.item_code || '').toUpperCase();
            const td = allTds[startIndex + idx];
            if (td) {
                const val = map.hasOwnProperty(code) ? map[code] : 0;
                td.textContent = val;
                td.setAttribute('data-qty', String(val));
                td.setAttribute('data-item-code', code);
            }
        });
    } catch (e) {
        // Fail silently to avoid breaking page render
        console.warn('appendDynamicItemCells failed', e);
    }
}

function calculateTotalFromForm() {
    const box = document.getElementById('all-item-dynamic');
    if (!box) return 0;
    let sum = 0;
    box.querySelectorAll('input[data-item-code]').forEach(inp => {
        const v = (inp.value || '').trim();
        const n = v === '' ? 0 : Number(v);
        if (!isNaN(n)) sum += n;
    });
    return sum;
}

// ---- Overview Section ----
let allDepartmentsData = [];
let showingAll = false;

async function updateOverviewSection(departments) {
    // Fetch enrollments to get accurate per-cohort registered counts
    let enrollments = [];
    try {
        const enrResp = await authFetch(`${API_BASE_URL}/enrollments/`);
        enrollments = await enrResp.json();
    } catch (err) {
        console.warn('Could not fetch enrollments for overview');
    }
    
    // Calculate summary stats
    const totalDepts = departments.length;
    const enrolledStudents = enrollments.length; // count of enrollments
    const expectedStudents = departments.reduce((sum, d) => sum + (d.existing || 0), 0);
    
    // Update summary stats
    document.getElementById('overview-total-depts').textContent = totalDepts;
    document.getElementById('overview-enrolled-students').textContent = enrolledStudents;
    document.getElementById('overview-expected-students').textContent = expectedStudents;
    
    // Calculate enrollments per department (registered per cohort)
    const deptStudentCount = {};
    enrollments.forEach(enr => {
        const deptId = (
            (enr && typeof enr === 'object')
                ? (enr.department && enr.department.id != null
                    ? enr.department.id
                    : (enr.department_id != null ? enr.department_id : null))
                : null
        );
        if (deptId == null) return;
        const key = Number(deptId);
        deptStudentCount[key] = (deptStudentCount[key] || 0) + 1;
    });

    // Get all departments sorted by student count
    allDepartmentsData = departments.map(d => {
        const key = Number(d.id);
        return {
            ...d,
            studentCount: deptStudentCount[key] || 0
        };
    }).sort((a, b) => b.studentCount - a.studentCount);

    // Hydrate dynamic requirements for ALL departments so any visible card shows latest
    await attachDynamicRequirements(allDepartmentsData);
    // Show only first 3 initially
    renderTop5Cards(allDepartmentsData.slice(0, 3), allDepartmentsData.length);
    
    // Setup view more button
    setupViewMoreButton();
}

function isLegacyCode(code) {
    return LEGACY_CODES.includes(String(code || '').toUpperCase());
}

async function attachDynamicRequirements(depts) {
    const tasks = depts.map(async (dept) => {
        try {
            const qs = new URLSearchParams({
                course_code: dept.course_code || '',
                course: dept.course || '',
                academic_year: dept.academic_year || '',
                year: String(dept.year || '')
            }).toString();
            const resp = await authFetch(`${API_BASE_URL}/requirements/?${qs}`);
            if (!resp.ok) return;
            const data = await resp.json();
            const reqs = Array.isArray(data.requirements) ? data.requirements : [];
            const map = {};
            reqs.forEach(r => {
                const code = String(r.item_code || '').toUpperCase();
                map[code] = Number(r.required_qty || 0);
            });
            dept.__reqMap = map;
        } catch (_) { /* ignore */ }
    });
    await Promise.all(tasks);
}

function renderTop5Cards(topDepts, totalCount) {
    const container = document.getElementById('top-5-cards');
    if (!container) return;
    
    if (topDepts.length === 0) {
        container.innerHTML = '<div style="grid-column:1/-1;text-align:center;padding:20px;color:var(--muted);">No departments added yet</div>';
        return;
    }
    
    const colors = ['#523596', '#F59E0B', '#10B981', '#3B82F6', '#EC4899'];
    
    const inventoryCodes = new Map((ITEMS_MASTER || []).map(it => [String(it.item_code || '').toUpperCase(), it]));

    container.innerHTML = topDepts.map((dept, index) => {
        const color = colors[index % colors.length];
        
        const enrollmentPercentage = dept.existing > 0 ? Math.round((dept.studentCount / dept.existing) * 100) : 0;
        const isUnderEnrolled = dept.studentCount < dept.existing;
        const statusColor = isUnderEnrolled ? '#F59E0B' : '#10B981';
        
        return `
            <div class="top-dept-card" style="background:white;border-radius:8px;padding:14px;border-left:3px solid ${color};box-shadow:0 2px 4px rgba(0,0,0,0.06);transition:transform 0.2s;">
                <div style="display:flex;justify-content:space-between;align-items:start;margin-bottom:10px;">
                    <div>
                        <div style="font-size:14px;font-weight:700;color:#1f2937;margin-bottom:3px;">${dept.course}</div>
                        <div style="font-size:11px;color:var(--muted);">${dept.course_code} - Year ${dept.year} • ${dept.academic_year || ''}</div>
                    </div>
                    <div style="background:${color}15;color:${color};padding:3px 8px;border-radius:12px;font-size:11px;font-weight:700;">
                        #${index + 1}
                    </div>
                </div>
                <div style="display:grid;grid-template-columns:1fr 1fr;gap:8px;margin-bottom:10px;">
                    <div style="background:#f9fafb;padding:8px;border-radius:6px;">
                        <div style="font-size:10px;color:var(--muted);margin-bottom:3px;">Registered</div>
                        <div style="font-size:20px;font-weight:700;color:${color};">${dept.studentCount}</div>
                    </div>
                    <div style="background:#f9fafb;padding:8px;border-radius:6px;">
                        <div style="font-size:10px;color:var(--muted);margin-bottom:3px;">Strength</div>
                        <div style="font-size:20px;font-weight:700;color:#6B7280;">${dept.existing || 0}</div>
                    </div>
                </div>
                ${dept.existing > 0 ? `
                <div style="margin-bottom:10px;">
                    <div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:4px;">
                        <span style="font-size:10px;color:var(--muted);">Enrollment Status</span>
                        <span style="font-size:10px;font-weight:700;color:${statusColor};">${enrollmentPercentage}%</span>
                    </div>
                    <div style="background:#e5e7eb;height:6px;border-radius:3px;overflow:hidden;">
                        <div style="background:${statusColor};height:100%;width:${Math.min(enrollmentPercentage, 100)}%;transition:width 0.3s;"></div>
                    </div>
                </div>
                ` : ''}
                ${renderDistributionBadges(dept, inventoryCodes)}
            </div>
        `;
    }).join('');
    
    // Add hover effect and click handler
    container.querySelectorAll('.top-dept-card').forEach((card, index) => {
        // Hover effect
        card.addEventListener('mouseenter', () => {
            card.style.transform = 'translateY(-3px)';
            card.style.boxShadow = '0 6px 12px rgba(0,0,0,0.1)';
            card.style.cursor = 'pointer';
        });
        card.addEventListener('mouseleave', () => {
            card.style.transform = 'translateY(0)';
            card.style.boxShadow = '0 2px 4px rgba(0,0,0,0.06)';
        });
        
        // Click handler - show message to edit/delete from table
        card.addEventListener('click', () => {
            const dept = topDepts[index];
            showMessage(`To edit or delete "${dept.course}" department, please use the Edit/Delete buttons in the table below.`, false);
            
            // Scroll to table and highlight the row
            const tableBody = document.getElementById('departments-body');
            if (tableBody) {
                const row = tableBody.querySelector(`tr[data-id="${dept.id}"]`);
                if (row) {
                    row.scrollIntoView({ behavior: 'smooth', block: 'center' });
                    row.style.backgroundColor = '#fef3c7';
                    setTimeout(() => {
                        row.style.backgroundColor = '';
                    }, 2000);
                }
            }
        });
    });
}

function setupViewMoreButton() {
    const btn = document.getElementById('view-more-btn');
    if (!btn) return;
    
    // Show button only if more than 3 departments
    if (allDepartmentsData.length > 3) {
        btn.style.display = 'block';
    } else {
        btn.style.display = 'none';
        return;
    }
    
    btn.onclick = () => {
        showingAll = !showingAll;
        if (showingAll) {
            renderTop5Cards(allDepartmentsData, allDepartmentsData.length);
            btn.innerHTML = '<i class="fas fa-chevron-up"></i> View Less';
        } else {
            renderTop5Cards(allDepartmentsData.slice(0, 3), allDepartmentsData.length);
            btn.innerHTML = '<i class="fas fa-chevron-down"></i> View More';
        }
    };
}