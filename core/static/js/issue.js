// core/static/js/issue.js 
const API_BASE_URL = "/api";

// Legacy mapping for department fields (kept for backward compatibility)
const LEGACY_CODE_TO_DEPT_FIELD = {
    '2PN': 'two_hundred_notebook',
    '2PR': 'two_hundred_record',
    '2PO': 'two_hundred_observation',
    '1PN': 'one_hundred_notebook',
    '1PR': 'one_hundred_record',
    '1PO': 'one_hundred_observation',
};
const LEGACY_CODES = Object.keys(LEGACY_CODE_TO_DEPT_FIELD);
let ITEMS_MASTER = [];
const ITEM_STOCK_MAP = new Map();

// Global Data Stores
let allDepartments = []; 
let allStudents = [];      
let allEnrollments = [];   // Enrollment records: student, department, academic_year, year
let studentIssueRecords = {}; // Key: USN, Value: { issued: [], pending: {} }

// ===========================================
// UTILITIES (Unchanged)
// ===========================================

const showMessage = (message, isError = false) => {
    const container = document.querySelector('.message-area') || document.body;
    const messageContainer = document.createElement('div');
    messageContainer.textContent = message;
    messageContainer.className = `message-box ${isError ? 'error' : 'success'}`;
    const existingMessage = container.querySelector('.message-box');
    if (existingMessage) existingMessage.remove();
    container.insertBefore(messageContainer, container.firstChild);
    setTimeout(() => messageContainer.remove(), 5000);
};

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
    return response;
}

function updateInventoryCache(items = []) {
    ITEMS_MASTER = Array.isArray(items) ? items : [];
    ITEM_STOCK_MAP.clear();
    ITEMS_MASTER.forEach(item => {
        const code = String(item.item_code || '').toUpperCase();
        const qty = Number(item.quantity || 0);
        ITEM_STOCK_MAP.set(code, qty);
    });
}

async function refreshInventoryCache() {
    try {
        const resp = await authFetch(`${API_BASE_URL}/items/`);
        if (resp.ok) {
            const items = await resp.json();
            updateInventoryCache(items);
        }
    } catch (error) {
        console.error('Failed to refresh inventory cache:', error);
    }
}

// ===== Helpers for cohort inference =====
function normalizeDash(s){
    return String(s ?? '').replace(/[\u2010-\u2015\u2212]/g, '-').trim();
}

function fmtCell(value) {
    if (value === null || value === undefined) return '-';
    const str = String(value).trim();
    if (!str || str === '-' || str.toUpperCase() === 'N/A' || str.toUpperCase() === '#N/A') return '-';
    const num = Number(str);
    if (Number.isFinite(num)) return num > 0 ? num : '-';
    return '-';
}

function findStudentEnrollment(usn, code, course, ay) {
    const targetAY = normalizeDash(ay);
    const targetCode = code || '';
    const targetCourse = course || '';
    let best = null;
    (allEnrollments || []).forEach(enr => {
        const s = enr.student || {};
        if (String(s.usn || '').toUpperCase() !== String(usn || '').toUpperCase()) return;
        const d = enr.department || {};
        const dAY = normalizeDash(enr.academic_year || d.academic_year);
        const codeOk = !targetCode || d.course_code === targetCode;
        const courseOk = !targetCourse || d.course === targetCourse;
        const ayOk = !targetAY || dAY === targetAY;
        if (codeOk && courseOk && ayOk) {
            best = enr; // last match wins; they should be unique per cohort
        }
    });
    return best;
}

// ===========================================
// DATA FETCHING & INITIALIZATION
// ===========================================

async function fetchInitialData() {
    try {
        const [deptResponse, studentResponse, enrollmentResponse, itemsResp] = await Promise.all([
            authFetch(`${API_BASE_URL}/departments/`), 
            authFetch(`${API_BASE_URL}/students/`),
            authFetch(`${API_BASE_URL}/enrollments/`),
            authFetch(`${API_BASE_URL}/items/`)
        ]);

        allDepartments = await deptResponse.json();
        allStudents = await studentResponse.json();
        allEnrollments = await enrollmentResponse.json();

        // Initial setup for filter dropdowns
        populateDepartmentDropdowns(allDepartments);
        populateStudentDropdowns(allStudents);
        
        updateInventoryCache(await itemsResp.json());

        // Build the issue table rows from current items
        renderIssueRows(ITEMS_MASTER);

        await updateIssueTableData(null); 
    } catch (error) {
        console.error("Error fetching initial data:", error);
        if (error.message !== 'Unauthorized') {
            showMessage("Failed to load departments and students.", true);
        }
    }
}

// ===========================================
// DROPDOWN POPULATION & FILTERING
// ===========================================

function populateDepartmentDropdowns(departments) {
    const codeSelect = document.getElementById("course-code");
    const courseSelect = document.getElementById("course");
    const yearSelect = document.getElementById("year");
    const academicYearSelect = document.getElementById("academic-year");
    
    if (!codeSelect || !courseSelect || !yearSelect) {
        return;
    }

    const uniqueCodes = new Set();
    const uniqueCourses = new Set();

    departments.forEach(dept => {
        uniqueCodes.add(dept.course_code);
        uniqueCourses.add(dept.course);
    });

    const fill = (sel, values, label) => {
        const current = sel.value;
        sel.innerHTML = `<option value="">${label}</option>`;
        // Maintain FCFS order - no sorting
        Array.from(values).forEach(v => sel.innerHTML += `<option value="${v}">${v}</option>`);
        sel.value = current;
    };

    // Populate primary dropdowns in FCFS order
    fill(codeSelect, uniqueCodes, 'Select Code');
    fill(courseSelect, uniqueCourses, 'Select Course');
    
    // Disable and reset dependent dropdowns initially
    if (academicYearSelect) {
        academicYearSelect.innerHTML = '<option value="">Select Academic Year</option>';
        academicYearSelect.disabled = true;
    }
    yearSelect.innerHTML = '<option value="">Select Year</option>';
    yearSelect.disabled = true;
}

function syncDepartmentDropdowns(changedField = null) {
    const codeSelect = document.getElementById("course-code");
    const courseSelect = document.getElementById("course");
    const yearSelect = document.getElementById("year");
    const academicYearSelect = document.getElementById("academic-year");

    if (!codeSelect || !courseSelect || !yearSelect) return;

    // Store current values BEFORE any changes
    const currentCode = codeSelect.value;
    const currentCourse = courseSelect.value;
    const currentYear = yearSelect.value;
    const currentAcademicYear = academicYearSelect?.value || '';

    console.log(`Sync triggered by: ${changedField}, Code: ${currentCode}, Course: ${currentCourse}, Year: ${currentYear}, AY: ${currentAcademicYear}`);

    // Helper to update a dropdown while preserving selection
    const updateSelect = (select, values, selected, label) => {
        select.innerHTML = `<option value="">${label}</option>`;
        const unique = [...new Set(values.filter(v => v))];
        unique.forEach(v => {
            const opt = document.createElement("option");
            opt.value = v;
            opt.textContent = v;
            if (v === selected) opt.selected = true;
            select.appendChild(opt);
        });
    };

    // 1. Update Course Code dropdown (always show all codes, preserve selection)
    const availableCodes = [...new Set(allDepartments.map(d => d.course_code))];
    updateSelect(codeSelect, availableCodes, currentCode, "Select Code");

    // 2. Update Course dropdown based on selected code
    let availableCourses;
    if (currentCode) {
        availableCourses = [...new Set(
            allDepartments
                .filter(d => d.course_code === currentCode)
                .map(d => d.course)
        )];
        // Auto-select if only one course for this code
        if (availableCourses.length === 1) {
            updateSelect(courseSelect, availableCourses, availableCourses[0], "Select Course");
            console.log(`Auto-selected course: ${availableCourses[0]}`);
        } else {
            updateSelect(courseSelect, availableCourses, currentCourse, "Select Course");
        }
    } else if (currentCourse) {
        // If course is selected but code is not, filter codes by course
        const availableCodesForCourse = [...new Set(
            allDepartments
                .filter(d => d.course === currentCourse)
                .map(d => d.course_code)
        )];
        // Auto-select if only one code for this course
        if (availableCodesForCourse.length === 1) {
            updateSelect(codeSelect, availableCodes, availableCodesForCourse[0], "Select Code");
            console.log(`Auto-selected code: ${availableCodesForCourse[0]}`);
        }
        // Show all courses
        availableCourses = [...new Set(allDepartments.map(d => d.course))];
        updateSelect(courseSelect, availableCourses, currentCourse, "Select Course");
    } else {
        // No code or course selected - show all
        availableCourses = [...new Set(allDepartments.map(d => d.course))];
        updateSelect(courseSelect, availableCourses, currentCourse, "Select Course");
    }

    // Re-read values after potential auto-selection
    const finalCode = codeSelect.value;
    const finalCourse = courseSelect.value;

    // 3. Filter departments based on code and course
    const deptsFilteredByCourse = allDepartments.filter(d => 
        (!finalCode || d.course_code === finalCode) &&
        (!finalCourse || d.course === finalCourse)
    );

    // Check if we have a primary selection
    const hasPrimarySelection = finalCode || finalCourse;
    
    if (!hasPrimarySelection) {
        // No primary selection - disable dependent dropdowns
        if (academicYearSelect) {
            academicYearSelect.innerHTML = '<option value="">Select Academic Year</option>';
            academicYearSelect.disabled = true;
        }
        yearSelect.innerHTML = '<option value="">Select Year</option>';
        yearSelect.disabled = true;
        filterStudents([]);
        return;
    }

    // 4. Update Academic Year dropdown (enabled now)
    const availableAcademicYears = [...new Set(
        deptsFilteredByCourse.map(d => d.academic_year).filter(Boolean)
    )].reverse(); // Newest first
    
    if (academicYearSelect) {
        academicYearSelect.disabled = false;
        updateSelect(academicYearSelect, availableAcademicYears, currentAcademicYear, "Select Academic Year");
        
        // Auto-select if only one academic year
        if (availableAcademicYears.length === 1) {
            academicYearSelect.value = availableAcademicYears[0];
        }
    }

    // 5. Update Year dropdown based on Academic Year selection
    const finalAcademicYear = academicYearSelect?.value || '';
    let availableYears;
    
    if (finalAcademicYear) {
        // Filter years by selected academic year
        availableYears = [...new Set(
            deptsFilteredByCourse
                .filter(d => d.academic_year === finalAcademicYear)
                .map(d => String(d.year))
        )];
    } else {
        // No academic year selected - show all years for the course
        availableYears = [...new Set(deptsFilteredByCourse.map(d => String(d.year)))];
    }
    
    yearSelect.disabled = false;
    updateSelect(yearSelect, availableYears, currentYear, "Select Year");
    
    // Auto-select year if only one option
    if (availableYears.length === 1) {
        yearSelect.value = availableYears[0];
    }

    // 6. Filter students based on all final selections
    const finalYear = yearSelect.value;
    const currentlyMatchedDepartments = allDepartments.filter(dept => 
        (!finalCode || dept.course_code === finalCode) &&
        (!finalCourse || dept.course === finalCourse) &&
        (!finalYear || String(dept.year) === finalYear) &&
        (!finalAcademicYear || dept.academic_year === finalAcademicYear)
    );
    
    filterStudents(currentlyMatchedDepartments);
}

function updateDropdownOptions(selectElement, availableValues, selectedValue, defaultLabel, reverseSort = false) {
    if (!selectElement) return;
    const currentValue = selectElement.value;
    selectElement.innerHTML = `<option value="">${defaultLabel}</option>`;
    
    const sortedValues = availableValues.sort((a, b) => {
        if (reverseSort) {
            return String(b).localeCompare(String(a), undefined, { numeric: true });
        }
        return String(a).localeCompare(String(b), undefined, { numeric: true });
    });
    
    sortedValues.forEach(v => {
        selectElement.innerHTML += `<option value="${v}">${v}</option>`;
    });
    
    if (availableValues.includes(selectedValue)) {
        selectElement.value = selectedValue;
    } else if (availableValues.includes(currentValue)) {
        selectElement.value = currentValue;
    }
}

// Helper function to update dropdown without sorting (maintains FCFS order)
function updateDropdownOptionsNoSort(selectElement, availableValues, selectedValue, defaultLabel) {
    if (!selectElement) return;
    selectElement.innerHTML = `<option value="">${defaultLabel}</option>`;
    
    // Maintain original order (FCFS)
    availableValues.forEach(v => {
        selectElement.innerHTML += `<option value="${v}">${v}</option>`;
    });
    
    if (selectedValue && availableValues.includes(selectedValue)) {
        selectElement.value = selectedValue;
    }
}

function filterStudents(matchingDepartments) {
    const usnSelect = document.getElementById('usn');
    const nameSelect = document.getElementById('studentName');
    
    const currentSelectedUSN = usnSelect.value; 

    const matchingDeptIds = matchingDepartments.map(dept => dept.id);

    // Use enrollments to determine which students are eligible for current selection
    // Read current filter selections
    const codeSelect = document.getElementById('course-code');
    const courseSelect = document.getElementById('course');
    const yearSelect = document.getElementById('year');
    const academicYearSelect = document.getElementById('academic-year');
    const code = codeSelect?.value || '';
    const course = courseSelect?.value || '';
    const year = yearSelect?.value || '';
    const ayRaw = academicYearSelect?.value || '';
    const dashNormalize = (s) => String(s ?? '').replace(/[\u2010-\u2015\u2212]/g, '-');
    const ay = dashNormalize(ayRaw);

    let eligibleUSNs = new Set();
    if (matchingDeptIds.length > 0) {
        allEnrollments.forEach(enr => {
            const dept = enr.department || {};
            const enrAY = dashNormalize(enr.academic_year);
            if (
                (!code || dept.course_code === code) &&
                (!course || dept.course === course) &&
                (!year || String(enr.year) === String(year)) &&
                (!ay || enrAY === ay)
            ) {
                const usn = enr.student?.usn || null;
                if (usn) eligibleUSNs.add(usn);
            }
        });
    }

    let filteredStudents;
    if (matchingDeptIds.length > 0) {
        // Intersect all students with eligible USNs from enrollments
        filteredStudents = allStudents.filter(s => eligibleUSNs.has(s.usn));
    } else {
        // If no filters are applied, show all students
        filteredStudents = allStudents;
    }
    
    // Check if there are any students for this combination (reuse earlier variables)
    
    const hasFilters = code || course || year || ay;
    
    if (hasFilters && filteredStudents.length === 0) {
        // No students registered for this combination
        usnSelect.value = '';
        usnSelect.placeholder = 'No students registered yet';
        usnSelect.disabled = true;
        nameSelect.value = '';
        nameSelect.disabled = true;
        updateIssueTableData(null);
        return;
    } else {
        // Re-enable the fields
        usnSelect.disabled = false;
        usnSelect.placeholder = 'Type or select USN';
        nameSelect.disabled = false;
    }
    
    const isStudentStillValid = filteredStudents.some(s => s.usn === currentSelectedUSN);
    
    populateStudentDropdowns(filteredStudents);

    if (!isStudentStillValid) {
        usnSelect.value = '';
        nameSelect.value = '';
        updateIssueTableData(null); 
    } else {
        // Re-apply the selection to keep USN/Name synchronized
        usnSelect.value = currentSelectedUSN;
        nameSelect.value = currentSelectedUSN;
        // Filters changed: clear cached record and refetch cohort-scoped data, then update table
        try { delete studentIssueRecords[currentSelectedUSN]; } catch (_) {}
        fetchStudentRecords(currentSelectedUSN).then(() => {
            updateIssueTableData(currentSelectedUSN);
        });
    }
}

/**
 * Ensures both USN and Name dropdowns are properly populated and synchronized.
 */
function populateStudentDropdowns(students) {
    const usnSelect = document.getElementById("usn");
    const nameSelect = document.getElementById("studentName");

    usnSelect.innerHTML = '<option value="">Select USN</option>';
    nameSelect.innerHTML = '<option value="">Select Name</option>';

    // Populate the dropdowns
    students.forEach(student => {
        usnSelect.innerHTML += `<option value="${student.usn}">${student.usn}</option>`;
        nameSelect.innerHTML += `<option value="${student.usn}">${student.name}</option>`;
    });
}

// ===========================================
// STUDENT SELECTION & TABLE DATA UPDATE
// ===========================================

async function handleStudentSelection(event) {
    const selectedUSN = event.target.value;
    
    if (!selectedUSN) {
        // Clear all filters if student is deselected
        document.getElementById("course-code").value = '';
        document.getElementById("course").value = '';
        document.getElementById("year").value = '';
        const academicYearSelect = document.getElementById("academic-year");
        if (academicYearSelect) {
            academicYearSelect.value = '';
            academicYearSelect.disabled = true;
        }
        const yearSelect = document.getElementById("year");
        if (yearSelect) yearSelect.disabled = true;
        syncDepartmentDropdowns(); // Refilter all to initial state
        updateIssueTableData(null);
        return;
    }
    
    // 1. Sync the other student dropdown
    const targetId = event.target.id;
    if (targetId === 'usn') {
        document.getElementById('studentName').value = selectedUSN;
    } else if (targetId === 'studentName') {
        document.getElementById('usn').value = selectedUSN;
    }

    const student = allStudents.find(s => s.usn === selectedUSN);

    // 2. Sync the department dropdowns (Course Code, Course, Academic Year, Year)
    if (student && student.department) {
        const department = student.department; 
        
        // Set primary dropdowns first
        document.getElementById("course-code").value = department.course_code || '';
        document.getElementById("course").value = department.course || '';
        
        // Trigger sync to enable dependent dropdowns
        syncDepartmentDropdowns('code');
        
        // Then set dependent dropdowns
        const academicYearSelect = document.getElementById("academic-year");
        if (academicYearSelect && department.academic_year) {
            academicYearSelect.value = department.academic_year;
        }
        
        document.getElementById("year").value = student.year || department.year || '';
        
        // Final sync to update students
        syncDepartmentDropdowns('academicYear');
    } else {
        document.getElementById("course-code").value = '';
        document.getElementById("course").value = '';
        document.getElementById("year").value = '';
        const academicYearSelect = document.getElementById("academic-year");
        if (academicYearSelect) {
            academicYearSelect.value = '';
            academicYearSelect.disabled = true;
        }
        const yearSelect = document.getElementById("year");
        if (yearSelect) yearSelect.disabled = true;
    }
    
    // 3. Fetch pending and issued records
    await fetchStudentRecords(selectedUSN);
    
    // 4. Update the static HTML table rows
    await updateIssueTableData(selectedUSN);
}

// ===== RENDER ROWS FROM /api/items/ =====
function renderIssueRows(items) {
    const tbody = document.getElementById('issueTableBody');
    if (!tbody) return;
    tbody.innerHTML = '';
    const sorted = [...(items || [])].sort((a,b)=> String(a.item_code).localeCompare(String(b.item_code)));
    sorted.forEach(it => {
        const code = String(it.item_code || '').toUpperCase();
        const name = it.name || code;
        const tr = document.createElement('tr');
        tr.dataset.itemCode = code;
        // Order must match headers: Items | Qty Issued | Allotted | New Issue | Status | Pending Qty | Remarks
        tr.innerHTML = `
            <td class="item-name">${name} (${code})</td>
            <td class="allotted-qty">${fmtCell(null)}</td>
            <td class="issued-qty">${fmtCell(null)}</td>
            <td class="pending-qty">${fmtCell(null)}</td>
            <td><input type="number" class="new-issue-input" value="0" min="0" max="0"></td>
            <td class="item-status"><span class="status-badge neutral">-</span></td>
            <td><input type="text" class="item-remarks-input" placeholder="Remarks"></td>
        `;
        tbody.appendChild(tr);

        const remarksField = tr.querySelector('.item-remarks-input');
        if (remarksField) {
            remarksField.addEventListener('input', () => {
                const currentValue = remarksField.value;
                const trimmed = currentValue.trim();
                if (trimmed.length) {
                    remarksField.dataset.userEdited = 'true';
                    remarksField.dataset.userText = currentValue;
                } else {
                    delete remarksField.dataset.userEdited;
                    delete remarksField.dataset.userText;
                }
            });
        }
    });
}

// Placeholder for fetching student's current issued/pending records
async function fetchStudentRecords(usn) {
    // This API endpoint MUST return a dictionary like: 
    // { issued: [<IssueRecordSerializer objects>], pending: <PendingReportSerializer object> }
    try {
        // Build cohort-aware query params. If Year is blank but AY is selected,
        // infer student's year from enrollments for this (Code, Course, AY).
        const code = document.getElementById('course-code')?.value || '';
        const course = document.getElementById('course')?.value || '';
        const yearSel = document.getElementById('year')?.value || '';
        const aySel = document.getElementById('academic-year')?.value || '';

        let inferredYear = yearSel;
        if (!inferredYear && (code || course || aySel)) {
            const enr = findStudentEnrollment(usn, code, course, aySel);
            if (enr && enr.year != null) inferredYear = String(enr.year);
        }

        const qs = new URLSearchParams({
            course_code: code,
            course: course,
            academic_year: aySel,
            year: inferredYear
        }).toString();
        const response = await authFetch(`${API_BASE_URL}/student-records/${usn}/?${qs}`);
        
        if (!response.ok) {
             studentIssueRecords[usn] = { issued: [], pending: {} }; 
             return;
        }

        const data = await response.json();
        studentIssueRecords[usn] = data;

    } catch (error) {
        console.error("Error fetching student records:", error);
        if (error.message !== 'Unauthorized') {
             studentIssueRecords[usn] = { issued: [], pending: {} }; 
        }
    }
}

// --- FUNCTION TO UPDATE STATIC ROWS ---
async function updateIssueTableData(usn) {
    const tableRows = document.querySelectorAll('#issueTableBody tr');
    
    let student = null;
    let department = null;
    let issuedMap = {};
    const latestRemarks = {};
    let reqMap = {}; // cohort requirements for non-legacy items
    let records = { issued: [], pending: {} };
    
    // Read current filters for cohort
    const codeSel = document.getElementById('course-code')?.value || '';
    const courseSel = document.getElementById('course')?.value || '';
    const yearSel = document.getElementById('year')?.value || '';
    const aySel = normalizeDash(document.getElementById('academic-year')?.value || '');

    // Require FULL selection before populating: Code, Course, AY, Year, and USN
    const hasFullSelection = !!(codeSel && courseSel && aySel && yearSel && usn);
    if (!hasFullSelection) {
        tableRows.forEach(row => {
            const issuedCell = row.querySelector('.issued-qty');
            const allottedCell = row.querySelector('.allotted-qty');
            const newIssueInput = row.querySelector('.new-issue-input');
            const statusCell = row.querySelector('.item-status');
            const pendingCell = row.querySelector('.pending-qty');
            const remarksInput = row.querySelector('.item-remarks-input');

            if (issuedCell) issuedCell.textContent = fmtCell(null);
            if (allottedCell) allottedCell.textContent = fmtCell(null); // hide cohort allotments until all filters + USN selected
            if (pendingCell) pendingCell.textContent = fmtCell(null);
            if (statusCell) statusCell.innerHTML = '';
            if (newIssueInput) { newIssueInput.value = 0; newIssueInput.max = 0; newIssueInput.disabled = true; }
            if (remarksInput) { remarksInput.value = '-'; remarksInput.disabled = true; }
        });
        updateTotals();
        return;
    }

    if (usn) {
        student = allStudents.find(s => s.usn === usn);
        // Prefer department that matches filters; otherwise from enrollment; else student's department
        let d = allDepartments.find(d =>
            (!codeSel || d.course_code === codeSel) &&
            (!courseSel || d.course === courseSel) &&
            (!aySel || normalizeDash(d.academic_year) === aySel) &&
            (!yearSel || String(d.year) === String(yearSel))
        );
        if (!d) {
            const enr = findStudentEnrollment(usn, codeSel, courseSel, aySel);
            if (enr && enr.department) d = enr.department;
        }
        department = d || (student?.department || null);

        records = studentIssueRecords[usn] || { issued: [], pending: {} };
        // Calculate total issued quantity per item code, strictly for current cohort
        let scopeYear = yearSel;
        if (!scopeYear && (codeSel || courseSel || aySel)) {
            const enr = findStudentEnrollment(student?.usn, codeSel, courseSel, aySel);
            if (enr && enr.year != null) scopeYear = String(enr.year);
        }
        const filteredIssued = (records.issued || []).filter(rec => {
            const recAY = normalizeDash(rec.academic_year);
            const recYear = String(rec.year ?? '');
            if (aySel && recAY !== aySel) return false;
            if (scopeYear && recYear !== String(scopeYear)) return false;
            return true;
        });
        issuedMap = filteredIssued.reduce((acc, record) => {
            const codeKey = String(record.item_code || '').toUpperCase();
            acc[codeKey] = (acc[codeKey] || 0) + (record.qty_issued || 0);
            return acc;
        }, {});
        filteredIssued.forEach(record => {
            const codeKey = String(record.item_code || '').toUpperCase();
            if (!codeKey) return;
            const cleanRemark = (record.remarks || '').trim();
            const timestamp = Date.parse(record.date_issued || record.created_at || '') || 0;
            if (!cleanRemark) return;
            const existing = latestRemarks[codeKey];
            if (!existing || timestamp >= existing.timestamp) {
                latestRemarks[codeKey] = { text: cleanRemark, timestamp };
            }
        });
    } else {
        // Even without student, try to pick a department by filters for legacy allotted display
        department = allDepartments.find(d =>
            (!codeSel || d.course_code === codeSel) &&
            (!courseSel || d.course === courseSel) &&
            (!aySel || normalizeDash(d.academic_year) === aySel) &&
            (!yearSel || String(d.year) === String(yearSel))
        ) || null;
    }

    // Fetch cohort requirements for non-legacy items only when EVERYTHING incl. USN is selected
    const canFetchRequirements = hasFullSelection;
    if (canFetchRequirements) {
        try {
            const qs = new URLSearchParams({
                course_code: codeSel,
                course: courseSel,
                academic_year: aySel,
                year: yearSel
            }).toString();
            const resp = await authFetch(`${API_BASE_URL}/requirements/?${qs}`);
            if (resp.ok) {
                const data = await resp.json();
                const list = Array.isArray(data.requirements) ? data.requirements : [];
                list.forEach(r => { reqMap[String(r.item_code).toUpperCase()] = Number(r.required_qty || 0); });
            }
        } catch (_) {}
    }

    tableRows.forEach(row => {
        const itemCode = row.dataset.itemCode;
        if (!itemCode) return;

        const issuedQty = issuedMap[itemCode] || 0;
        const storedRemark = latestRemarks[itemCode]?.text || '';
        // For legacy items use department fields; for non-legacy use requirements map
        const deptField = LEGACY_CODE_TO_DEPT_FIELD[itemCode];
        const requiredQty = deptField ? (department?.[deptField] || 0) : (reqMap[itemCode] || 0);
        
        // CRITICAL
        // If no student is selected, do not compute cohort-specific pending/status.
        // Only display Allotted; everything else stays neutral.
        const pendingQty = Math.max(0, requiredQty - issuedQty);
        const status = pendingQty > 0 ? 'Pending' : (issuedQty > 0 ? 'Issued' : '-');
        
        const issuedCell = row.querySelector('.issued-qty');
        const allottedCell = row.querySelector('.allotted-qty');
        const newIssueInput = row.querySelector('.new-issue-input');
        const statusCell = row.querySelector('.item-status');
        const pendingCell = row.querySelector('.pending-qty');
        const remarksInput = row.querySelector('.item-remarks-input');

        // 1. Update Cell Values
        issuedCell.textContent = fmtCell(issuedQty);
        allottedCell.textContent = fmtCell(requiredQty);
        
        // Update status with color coding (only if status cell exists in template)
        if (statusCell) {
            statusCell.innerHTML = '';
            const statusBadge = document.createElement('span');
            const statusKey = status === '-' ? 'neutral' : status.toLowerCase();
            statusBadge.className = `status-badge ${statusKey}`;
            statusBadge.textContent = status;
            statusCell.appendChild(statusBadge);
        }
        
        pendingCell.textContent = fmtCell(pendingQty);

        // 2. Update New Issue Input Constraints and Remarks
        newIssueInput.value = 0; 
        newIssueInput.min = 0; // Ensure minimum is 0

        if (requiredQty === 0) {
            // No student selected OR no quantity is allotted (0 required)
            newIssueInput.max = 0;
            newIssueInput.disabled = true;
            const cached = remarksInput.dataset.userText || '';
            remarksInput.value = storedRemark || cached || '-';
            remarksInput.disabled = true;
        } else if (pendingQty === 0) {
            // All required items are issued
            newIssueInput.max = 0;
            newIssueInput.disabled = true;
            const cached = remarksInput.dataset.userText || '';
            remarksInput.value = storedRemark || cached || 'Issued';
            remarksInput.disabled = true;
        } else {
            // Standard state: items can be issued up to pendingQty
            newIssueInput.max = pendingQty;
            newIssueInput.disabled = false;
            if (!remarksInput.dataset.userEdited) {
                const trimmed = (remarksInput.value || '').trim();
                if (!trimmed || trimmed === '-' || trimmed === 'Issued') {
                    const cached = remarksInput.dataset.userText || '';
                    remarksInput.value = storedRemark ? storedRemark : cached;
                }
            }
            remarksInput.disabled = false;
        }
    });

    updateTotals(); 
}

function updateTotals() {
    let totalIssued = 0;
    let totalAllotted = 0;
    let totalPending = 0;
    let totalNew = 0;

    document.querySelectorAll('#issueTableBody .issued-qty').forEach(cell => {
        const val = parseInt(cell.textContent);
        totalIssued += Number.isFinite(val) ? val : 0;
    });
    
    document.querySelectorAll('#issueTableBody .allotted-qty').forEach(cell => {
        totalAllotted += parseInt(cell.textContent) || 0;
    });

    document.querySelectorAll('#issueTableBody .pending-qty').forEach(cell => {
        const val = parseInt(cell.textContent);
        totalPending += Number.isFinite(val) ? val : 0;
    });

    document.querySelectorAll('.new-issue-input').forEach(input => {
        // Ensure input value is a valid number before summing
        const value = parseInt(input.value) || 0;
        if (!input.disabled && value > 0) {
              totalNew += value;
        }
    });

    const setTotal = (id, value) => {
        const el = document.getElementById(id);
        if (el) el.textContent = value > 0 ? value : '-';
    };
    setTotal('totalIssued', totalIssued);
    setTotal('totalAllotted', totalAllotted);
    setTotal('totalPending', totalPending);
    setTotal('totalNew', totalNew);
}

async function handleIssue() {
    const usn = document.getElementById('usn').value;
    if (!usn) {
        showMessage("Please select a student first.", true);
        return;
    }

    const overallRemarks = document.getElementById('overallRemarks').value.trim();
    const issueData = [];
    const lowStockWarnings = [];
    const tableRows = document.querySelectorAll('#issueTableBody tr');

    await refreshInventoryCache();

    tableRows.forEach(row => {
        const input = row.querySelector('.new-issue-input');
        const remarksInput = row.querySelector('.item-remarks-input');
        const qty = parseInt(input.value) || 0;

        // Only include items where a quantity greater than zero is being issued
        if (qty > 0) {
            const code = row.dataset.itemCode;
            const available = ITEM_STOCK_MAP.get(code) ?? 0;
            if (qty > available) {
                const itemName = row.querySelector('.item-name')?.textContent || code;
                showMessage(`Not enough stock for ${itemName}. Available: ${available}. Please restock before issuing.`, true);
                issueData.length = 0;
                throw new Error('Insufficient inventory');
            }
            if (available > 0 && available < 10) {
                const itemName = row.querySelector('.item-name')?.textContent?.trim() || code;
                lowStockWarnings.push({ label: itemName, available });
            }
            issueData.push({
                usn: usn, 
                item_code: code, 
                quantity: qty, 
                // Use item remarks if provided, otherwise overall remarks, otherwise null
                remarks: remarksInput.value.trim() || overallRemarks || null,
            });
        }
    });

    if (issueData.length === 0) {
        showMessage("No items selected for issue.", true);
        return;
    }
    
    try {
        // Build cohort info from current filters; infer year when not selected
        const code = document.getElementById('course-code')?.value || '';
        const course = document.getElementById('course')?.value || '';
        const aySel = document.getElementById('academic-year')?.value || '';
        let yearSel = document.getElementById('year')?.value || '';
        if (!yearSel && (code || course || aySel)) {
            const enr = findStudentEnrollment(usn, code, course, aySel);
            if (enr && enr.year != null) yearSel = String(enr.year);
        }
        const submissionPayload = {
            student_usn: usn,
            issues: issueData,
            course_code: code,
            course: course,
            academic_year: aySel,
            year: yearSel,
            // overall_remarks is handled per item above, but left here for backend flexibility
            overall_remarks: overallRemarks 
        };

        const response = await authFetch(`${API_BASE_URL}/issue-bulk-create/`, { 
            method: 'POST',
            headers: {
                'Content-Type': 'application/json',
                'X-CSRFToken': getCookie('csrftoken')
            },
            body: JSON.stringify(submissionPayload)
        });

        if (!response.ok) {
            let message = `HTTP ${response.status}`;
            try {
                const error = await response.json();
                message = error.error || error.detail || (error.non_field_errors ? error.non_field_errors.join(' ') : JSON.stringify(error));
            } catch (_) {}
            showMessage(`Issue failed: ${message}`, true);
            return;
        }

        const createdRecords = await response.json();
        
        sessionStorage.setItem('lastIssuedReceipt', JSON.stringify({
            studentUsn: usn,
            issueRecords: createdRecords
        }));

        showMessage('Items issued successfully! Generating Receipt...', false);

        if (lowStockWarnings.length > 0) {
            const warningSummary = lowStockWarnings
                .map(w => `${w.label} – ${w.available} left`)
                .join('; ');
            setTimeout(() => {
                showMessage(`Warning: low stock for ${warningSummary}. We'll issue this time, but please restock before the stock gets empty.`, true);
            }, 2000);
        }
        
        // Refresh data and table
        await refreshInventoryCache();
        await fetchStudentRecords(usn);
        await updateIssueTableData(usn); 
        
        document.getElementById('overallRemarks').value = '';

    } catch (error) {
        console.error("Issue submission error:", error);
        if (error.message === 'Insufficient inventory') {
            return;
        }
        if (error.message !== 'Unauthorized') {
            showMessage("An unexpected network error occurred during issue submission. Check console.", true);
        }
    }
}
// ===========================================
// EVENT LISTENERS & INITIAL SETUP
// ===========================================
document.addEventListener("DOMContentLoaded", async function() {
    await fetchInitialData();

    // Change event listeners - these trigger the sync logic
    document.getElementById('course-code')?.addEventListener('change', function(e) {
        console.log('Course Code changed to:', this.value);
        syncDepartmentDropdowns('code');
    });
    
    document.getElementById('course')?.addEventListener('change', function(e) {
        console.log('Course changed to:', this.value);
        syncDepartmentDropdowns('course');
    });
    
    document.getElementById('year')?.addEventListener('change', function(e) {
        console.log('Year changed to:', this.value);
        syncDepartmentDropdowns('year');
    });
    
    document.getElementById('academic-year')?.addEventListener('change', function(e) {
        console.log('Academic Year changed to:', this.value);
        syncDepartmentDropdowns('academicYear');
    });
    
    document.getElementById('usn')?.addEventListener('change', handleStudentSelection);
    document.getElementById('studentName')?.addEventListener('change', handleStudentSelection);
    
    document.querySelector('#issueTableBody')?.addEventListener('input', (event) => {
        if (event.target.classList.contains('new-issue-input')) {
            const max = parseInt(event.target.max);
            const value = parseInt(event.target.value);
            
            // Input validation: limit to max, ensure non-negative
            if (value > max) {
                 event.target.value = max;
            } else if (value < 0 || isNaN(value)) {
                 event.target.value = 0;
            }
            updateTotals();
        }
    });

    // ❗ FIX: Add event.preventDefault() to the button listener for robustness
    document.getElementById('issueBtn')?.addEventListener('click', (event) => {
        event.preventDefault(); 
        handleIssue();
    });
    
    document.getElementById('generate-report-btn')?.addEventListener('click', async (event) => {
        event.preventDefault(); // Prevents default form submission if button is type="submit"
        const usn = document.getElementById('usn').value;
        if (!usn) {
            showMessage("Please select a student to generate a report.", true);
            return;
        }

        // Fetch fresh student records if not already loaded
        if (!studentIssueRecords[usn]) {
            await fetchStudentRecords(usn);
        }

        const studentRecords = studentIssueRecords[usn];
        
        // Store the records fetched from the student-records endpoint, not just the newly issued ones.
        const sessionData = {
            studentUsn: usn,
            issueRecords: studentRecords ? studentRecords.issued : [] // Use the fully fetched issued records
        };
        console.log('Storing session data:', sessionData);
        sessionStorage.setItem('lastIssuedReceipt', JSON.stringify(sessionData));
        
        const reportUrl = document.getElementById('generate-report-btn').dataset.url;
        if (reportUrl) {
            window.location.href = reportUrl;
        } else {
             showMessage("Report URL is not configured on the button.", true);
        }
    });
});