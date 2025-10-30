// Normalize unicode dashes in Academic Year
const normalizeDash = (s) => String(s || '').replace(/[\u2010-\u2015\u2212]/g, '-');
// core/static/js/pending2.js
const API_BASE_URL = "/api";
const normCode = (c) => String(c || '').toUpperCase().trim();
let ITEMS_MASTER = [];
let DISPLAY_CODES = [];
const codeSorter = (a, b) => a.localeCompare(b, undefined, { numeric: true });

const LEGACY_CODES = ['2PN','2PR','2PO','1PN','1PR','1PO'];
const LEGACY_CODES_SET = new Set(LEGACY_CODES);


let allStudentsMap = new Map();
let allDepartments = [];
let departmentsById = new Map();
let originalPendingReports = [];
const studentPendingCache = new Map(); // usn -> { pending: {...}, issued: [...] }
const requirementsCache = new Map();   // key: code|course|year|ay -> { CODE: required_qty }

function findDepartmentForReport(report = null, student = null) {
  if (student) {
    if (student.department && typeof student.department === 'object') {
      return student.department;
    }
    const deptId = student.department_id != null ? student.department_id : student.department;
    if (deptId != null && departmentsById.has(deptId)) {
      return departmentsById.get(deptId);
    }
  }
  if (report) {
    if (report.department && typeof report.department === 'object') {
      return report.department;
    }
    const deptId = report.department_id != null ? report.department_id : report.department;
    if (deptId != null && departmentsById.has(deptId)) {
      return departmentsById.get(deptId);
    }
    if (report.course_code || report.course) {
      return allDepartments.find(d => {
        const sameCode = !report.course_code || d.course_code === report.course_code;
        const sameCourse = !report.course || d.course === report.course;
        const sameYear = report.year == null || String(d.year) === String(report.year);
        const sameAY = !report.academic_year || normalizeDash(d.academic_year) === normalizeDash(report.academic_year);
        return sameCode && sameCourse && sameYear && sameAY;
      }) || null;
    }
  }
  return null;
}

function enrichReportWithStudent(report, student) {
  if (!student) return { ...report };
  const dept = findDepartmentForReport(report, student);
  const academicYear = normalizeDash(report.academic_year || (dept && dept.academic_year) || '');
  return {
    ...report,
    course_code: report.course_code || (dept && dept.course_code) || '',
    course: report.course || (dept && dept.course) || '',
    year: report.year != null && report.year !== '' ? report.year : (student.year != null ? String(student.year) : (dept && dept.year != null ? String(dept.year) : '')),
    academic_year: academicYear,
  };
}

function reportCompletenessScore(report) {
  let score = 0;
  if (report.course_code) score += 3;
  if (report.course) score += 2;
  if (report.academic_year) score += 3;
  if (report.year !== undefined && report.year !== null && report.year !== '') score += 1;
  return score;
}

function dedupePendingReports(data) {
  const unique = new Map();
  (data || []).forEach(raw => {
    const student = allStudentsMap.get(raw.student);
    const enriched = enrichReportWithStudent(raw, student);
    const key = [
      enriched.student,
      normalizeDash(enriched.course_code || ''),
      normalizeDash(enriched.course || ''),
      String(enriched.year || ''),
      normalizeDash(enriched.academic_year || '')
    ].join('|');

    const existing = unique.get(key);
    if (!existing || reportCompletenessScore(enriched) >= reportCompletenessScore(existing)) {
      unique.set(key, enriched);
    }
  });
  return Array.from(unique.values());
}

function setSummaryLoading() {
  const totalElement = document.getElementById('total-pending');
  if (totalElement) {
    totalElement.textContent = '';
    totalElement.classList.add('pending-loading');
  }
  const container = document.querySelector('.summary-details');
  if (!container) return;
  container.innerHTML = '';
  (DISPLAY_CODES.length ? DISPLAY_CODES : ['…']).forEach(code => {
    const badge = document.createElement('span');
    badge.className = 'book-type';
    badge.appendChild(document.createTextNode(`${code}: `));
    const valueSpan = document.createElement('span');
    valueSpan.classList.add('pending-loading');
    valueSpan.textContent = '';
    badge.appendChild(valueSpan);
    container.appendChild(badge);
  });
}

// Helper to display year from report first
function rptYear(report) {
  if (report && report.year != null && report.year !== '') return report.year;
  return '';
}

function rptAcademicYear(report, student = null) {
  if (report && report.academic_year) return normalizeDash(report.academic_year);
  const dept = findDepartmentForReport(report, student);
  if (dept && dept.academic_year) return normalizeDash(dept.academic_year);
  return '';
}

// -------------------------------------------
// Utilities
// -------------------------------------------

// Display helper: show '-' for zero/empty values (used across table rendering and summary)
function fmtCell(v) {
  if (v === null || v === undefined) return '-';
  const str = String(v).trim();
  if (!str || str === '-' || str.toUpperCase() === 'N/A' || str.toUpperCase() === '#N/A') return '-';
  const n = Number(str);
  if (Number.isFinite(n)) return n > 0 ? n : '-';
  return '-';
}

// Function to update the summary counts in the UI with better error handling and logging
function updateSummaryCounts(counts, dynamicCodes = []) {
  if (!counts || typeof counts !== 'object') return;

  // Compute total across all keys
  const total = Object.values(counts).reduce((a,b)=> a + (parseInt(b,10)||0), 0);

  // Update total
  const totalElement = document.getElementById('total-pending');
  if (totalElement) {
    totalElement.classList.remove('pending-loading');
    totalElement.textContent = total;
  }

  // Rebuild badges container dynamically
  const container = document.querySelector('.summary-details');
  if (!container) return;
  container.innerHTML = '';

  const addBadge = (label, value) => {
    const badge = document.createElement('span');
    badge.className = 'book-type';
    badge.appendChild(document.createTextNode(`${label}: `));
    const valueSpan = document.createElement('span');
    valueSpan.textContent = fmtCell(value);
    badge.appendChild(valueSpan);
    container.appendChild(badge);
  };

  const combined = Array.from(new Set([...(DISPLAY_CODES || []), ...dynamicCodes])).sort(codeSorter);
  combined.forEach(code => {
    const key = code.toLowerCase();
    if (key in counts) {
      addBadge(code, counts[key] || 0);
    }
  });
}
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

async function authFetch(url, options = {}) {
  const resp = await fetch(url, options);
  return resp;
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

// -------------------------------------------
// Gauge Chart
// -------------------------------------------
let fulfillmentGauge = null;

function createFulfillmentGauge(fulfilled, pending) {
    const ctx = document.getElementById('fulfillmentGauge');
    if (!ctx) return;
    
    const total = fulfilled + pending;
    const percentage = total > 0 ? Math.round((fulfilled / total) * 100) : 0;
    
    // Update the percentage display
    const percentageElement = document.getElementById('fulfillmentPercentage');
    if (percentageElement) {
        percentageElement.textContent = `${percentage}%`;
    }
    
    // Destroy existing chart if it exists
    if (fulfillmentGauge) {
        fulfillmentGauge.destroy();
    }
    
    // Create new gauge chart
    fulfillmentGauge = new Chart(ctx, {
        data: {
            labels: ['Fulfilled', 'Pending'],
            datasets: [{
                data: [fulfilled, pending],
                backgroundColor: ['#10B981', '#E5E7EB'],
                borderWidth: 0,
                circumference: 180,
                rotation: 270
            }]
        },
        options: {
            responsive: true,
            maintainAspectRatio: false,
            cutout: '80%',
            plugins: {
                legend: {
                    display: false
                },
                tooltip: {
                    callbacks: {
                        label: function(context) {
                            const label = context.label || '';
                            const value = context.parsed || 0;
                            const total = context.dataset.data.reduce((a, b) => a + b, 0);
                            const percentage = Math.round((value / total) * 100);
                            return `${label}: ${value} (${percentage}%)`;
                        }
                    }
                }
            }
        }
    });
    
    return fulfillmentGauge;
}

// -------------------------------------------
// Init
// -------------------------------------------

document.addEventListener('DOMContentLoaded', () => {
  initializePendingPage();
  addScrollButtons();
  
  // Initialize gauge with 0 values
  createFulfillmentGauge(0, 0);

  document.getElementById('courseCode')?.addEventListener('change', () => handleFilterChange('code'));
  document.getElementById('courseName')?.addEventListener('change', () => handleFilterChange('course'));
  document.getElementById('year')?.addEventListener('change', () => handleFilterChange('year'));
  document.getElementById('academicYear')?.addEventListener('change', () => handleFilterChange('academicYear'));

  document.getElementById('generateReportButton')?.addEventListener('click', generateReport);
  document.getElementById('generatePdf')?.addEventListener('click', generateExcel);
});

// Quickly build table header with legacy + dynamic codes (from Items) so columns appear immediately
function buildHeaderImmediate() {
  try {
    const table = document.getElementById('pendingTable');
    const theadRow = table?.querySelector('thead tr');
    if (!theadRow) return;
    const dynCodes = DISPLAY_CODES.length ? DISPLAY_CODES : [];
    const base = [
      '<th>Sl.No</th>',
      '<th>USN</th>',
      '<th>Name</th>',
      '<th>Code</th>',
      '<th>Course</th>',
      '<th>Year</th>',
      '<th>Academic Year</th>'
    ];
    const itemCols = dynCodes.map(c => `<th data-item="${c}">${c}</th>`);
    base.push(...itemCols);
    base.push('<th>Total</th>','<th>Status</th>');
    theadRow.setAttribute('data-dynamic', '1');
    theadRow.innerHTML = base.join('');
  } catch(_) {}
}

// Simple loading overlay for the table section
function setTableLoading(isLoading) {
  const section = document.querySelector('.table-section');
  if (!section) return;
  let overlay = section.querySelector('.table-loading-overlay');
  if (isLoading) {
    if (!overlay) {
      overlay = document.createElement('div');
      overlay.className = 'table-loading-overlay';
      overlay.style.cssText = 'position:relative;';
      const mask = document.createElement('div');
      mask.style.cssText = 'position:absolute;inset:0;background:rgba(255,255,255,0.7);display:flex;align-items:center;justify-content:center;z-index:10;font-weight:600;color:#4b5563;';
      mask.textContent = 'Loading program-wise pending...';
      overlay.appendChild(mask);
      // Wrap the existing table container
      const container = section.querySelector('.table-container');
      if (container && !container.parentElement.classList.contains('table-loading-overlay')) {
        section.insertBefore(overlay, container);
        overlay.appendChild(container);
      }
    }
  } else {
    if (overlay) {
      const container = overlay.querySelector('.table-container');
      if (container) section.insertBefore(container, overlay);
      overlay.remove();
    }
  }
}

// Fetch and cache a student's pending map for the current filter context.
async function getPendingMap(usn, report = null) {
  try {
    const selectedCode = document.getElementById('courseCode')?.value || '';
    const selectedCourse = document.getElementById('courseName')?.value || '';
    const selectedYear = document.getElementById('year')?.value || '';
    const selectedAy = document.getElementById('academicYear')?.value || '';
    const code = (report && report.course_code) || selectedCode;
    const course = (report && report.course) || selectedCourse;
    const year = (report && report.year != null && report.year !== '') ? String(report.year) : selectedYear;
    const ay = (report && report.academic_year) || selectedAy;
    const cacheKey = `${usn}|${code}|${course}|${year}|${ay}`;
    if (studentPendingCache.has(cacheKey)) {
      return studentPendingCache.get(cacheKey).pending || {};
    }
    const params = new URLSearchParams();
    if (code) params.append('course_code', code);
    if (course) params.append('course', course);
    if (year) params.append('year', year);
    if (ay) params.append('academic_year', ay);
    const qs = params.toString();
    const resp = await authFetch(`${API_BASE_URL}/student-records/${encodeURIComponent(usn)}/${qs ? `?${qs}` : ''}`);
    if (resp.ok) {
      const data = await resp.json();
      const pendingMap = data.pending || {};
      studentPendingCache.set(cacheKey, { pending: pendingMap, issued: data.issued || [] });
      return pendingMap;
    }
  } catch (_) {}
  return {};
}

// Build an issued map for a student in the current cohort context from cached student-records
function getIssuedMap(usn, report = null) {
  const selectedCode = document.getElementById('courseCode')?.value || '';
  const selectedCourse = document.getElementById('courseName')?.value || '';
  const selectedYear = document.getElementById('year')?.value || '';
  const selectedAy = document.getElementById('academicYear')?.value || '';
  const code = (report && report.course_code) || selectedCode;
  const course = (report && report.course) || selectedCourse;
  const year = (report && report.year != null && report.year !== '') ? String(report.year) : selectedYear;
  const ay = (report && report.academic_year) || selectedAy;
  const cacheKey = `${usn}|${code}|${course}|${year}|${ay}`;
  const entry = studentPendingCache.get(cacheKey);
  const issuedArr = (entry && entry.issued) || [];
  const issuedMap = {};
  issuedArr.forEach(r => {
    const k = normCode(r.item_code);
    issuedMap[k] = (issuedMap[k] || 0) + Number(r.qty_issued || 0);
  });
  return issuedMap;
}

// Fetch cohort requirements and cache them per (code,course,year,ay)
async function getRequirementsMap(report = null) {
  try {
    // Prefer the cohort from the report row; fallback to UI only if missing
    const code = (report && report.course_code) || document.getElementById('courseCode')?.value || '';
    const course = (report && report.course) || document.getElementById('courseName')?.value || '';
    const year = (report && String(report.year || '')) || document.getElementById('year')?.value || '';
    const ay = (report && report.academic_year) || document.getElementById('academicYear')?.value || '';
    const key = `${code}|${course}|${year}|${ay}`;
    if (requirementsCache.has(key)) return requirementsCache.get(key);
    // If any cohort parameter is blank, do not call API; cache empty
    if (!code || !course || !year || !ay) { requirementsCache.set(key, {}); return {}; }
    const qs = new URLSearchParams({ course_code: code, course, year, academic_year: ay }).toString();
    const resp = await authFetch(`${API_BASE_URL}/requirements/?${qs}`);
    const reqMap = {};
    if (resp.ok) {
      const data = await resp.json();
      const list = Array.isArray(data.requirements) ? data.requirements : [];
      list.forEach(r => { reqMap[normCode(r.item_code)] = Number(r.required_qty || 0); });
    }
    requirementsCache.set(key, reqMap);
    return reqMap;
  } catch (_) {
    return {};
  }
}

async function initializePendingPage() {
  try {
    setSummaryLoading();
    setTableLoading(true);
    const [studentsResponse, deptResponse, itemsResp] = await Promise.all([
      authFetch(`${API_BASE_URL}/students/`),
      authFetch(`${API_BASE_URL}/departments/`),
      authFetch(`${API_BASE_URL}/items/`)
    ]);

    const students = await studentsResponse.json();
    allDepartments = (await deptResponse.json()) || [];
    allDepartments = allDepartments.map(dept => ({
      ...dept,
      academic_year: normalizeDash(dept.academic_year)
    }));
    departmentsById = new Map(allDepartments.filter(d => d && d.id != null).map(d => [d.id, d]));

    const normalizedStudents = (students || []).map(student => {
      const clone = { ...student };
      const deptValue = typeof clone.department === 'object'
        ? clone.department
        : departmentsById.get(clone.department_id != null ? clone.department_id : clone.department);
      if (deptValue) {
        clone.department = deptValue;
        clone.department_id = deptValue.id;
      }
      return clone;
    });

    allStudentsMap = new Map(normalizedStudents.map(s => [s.id, s]));
    ITEMS_MASTER = await itemsResp.json();
    DISPLAY_CODES = Array.from(new Set((ITEMS_MASTER || []).map(i => normCode(i.item_code)))).filter(Boolean).sort(codeSorter);
    setSummaryLoading();

    populateDepartmentDropdowns(allDepartments);

    // Build header immediately so user sees columns instantly
    buildHeaderImmediate();

    // Ensure pending reports exist for all students
    try {
      const gen = await authFetch(`${API_BASE_URL}/generate-pending-reports/`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'X-CSRFToken': getCookie('csrftoken') }
      });
      if (gen.ok) console.log('Generated missing pending reports');
    } catch (e) { console.warn('generate-pending-reports failed', e); }

    await fetchPendingReports();

    // Prefetch requirements for all distinct cohorts to reduce per-row latency
    try {
      const uniq = new Set();
      (originalPendingReports||[]).forEach(r => {
        const key = `${r.course_code}|${r.course}|${String(r.year||'')}|${r.academic_year||''}`;
        if (!uniq.has(key)) uniq.add(key);
      });
      await Promise.all(Array.from(uniq).map(k => {
        const [code,course,year,ay] = k.split('|');
        return getRequirementsMap({ course_code: code, course, year, academic_year: ay });
      }));
    } catch(_){ }

    renderPendingReports(originalPendingReports, allStudentsMap);
  } catch (e) {
    console.error('Init error', e);
    showMessage('Failed to load initial data.', true);
  }
}

async function fetchPendingReports() {
  if (allStudentsMap.size === 0) return;
  try {
    const resp = await authFetch(`${API_BASE_URL}/pending-reports/`);
    const data = await resp.json();
    console.log('API Response Data:', JSON.stringify(data, null, 2));
    
    // Log the first report to see its structure
    if (data && data.length > 0) {
      console.log('First report structure:', Object.keys(data[0]));
      console.log('First report values:', data[0]);
    } else {
      console.log('No reports found in the response');
    }
    
    originalPendingReports = dedupePendingReports(data);
  } catch (error) {
    console.error('Error fetching pending reports:', error);
    showMessage('Error loading pending reports. Please try again.', true);
  }
}

// -------------------------------------------
// Filters
// -------------------------------------------

function populateDepartmentDropdowns(departments) {
  const codeSelect = document.getElementById('courseCode');
  const courseSelect = document.getElementById('courseName');
  const yearSelect = document.getElementById('year');
  const academicYearSelect = document.getElementById('academicYear');
  if (!codeSelect || !courseSelect || !yearSelect) return;

  const uniqueCodes = new Set(departments.map(d => d.course_code).filter(Boolean));
  const uniqueCourses = new Set(departments.map(d => d.course).filter(Boolean));
  const uniqueYears = new Set(departments.map(d => String(d.year)).filter(Boolean));
  const uniqueAcademicYears = new Set(departments.map(d => d.academic_year).filter(Boolean));

  const fill = (sel, values, label) => {
    const current = sel.value;
    sel.innerHTML = `<option value="">${label}</option>`;
    Array.from(values).sort((a, b) => {
      // For academic years, sort in descending order (newest first)
      if (sel === academicYearSelect) {
        return String(b).localeCompare(String(a), undefined, { numeric: true });
      }
      return String(a).localeCompare(String(b), undefined, { numeric: true });
    }).forEach(v => sel.innerHTML += `<option value="${v}">${v}</option>`);
    sel.value = current;
  };

  fill(codeSelect, uniqueCodes, 'Select Course Code');
  fill(courseSelect, uniqueCourses, 'Select Course');
  fill(yearSelect, uniqueYears, 'Select Year');
  if (academicYearSelect) {
    fill(academicYearSelect, uniqueAcademicYears, 'Select Academic Year');
  }
}

function handleFilterChange(changedField = null) {
  const codeSelect = document.getElementById('courseCode');
  const courseSelect = document.getElementById('courseName');
  const yearSelect = document.getElementById('year');
  const academicYearSelect = document.getElementById('academicYear');
  // Clear cache whenever filters change to avoid cross-cohort reuse
  try { studentPendingCache.clear(); } catch (_) {}
  
  const code = codeSelect?.value || '';
  const course = courseSelect?.value || '';
  const year = yearSelect?.value || '';
  const academicYear = academicYearSelect?.value || '';

  // Filter departments based on current selections
  let filteredDepts = allDepartments.filter(d => {
    if (code && d.course_code !== code) return false;
    if (course && d.course !== course) return false;
    if (year && String(d.year) !== year) return false;
    if (academicYear && d.academic_year !== academicYear) return false;
    return true;
  });

  // Update Course Code dropdown
  const availableCodes = [...new Set(
    allDepartments
      .filter(d => (!course || d.course === course) && (!year || String(d.year) === year) && (!academicYear || d.academic_year === academicYear))
      .map(d => d.course_code)
  )];
  updateDropdownOptions(codeSelect, availableCodes, code, 'Select Course Code');

  // Update Course dropdown
  const availableCourses = [...new Set(
    allDepartments
      .filter(d => (!code || d.course_code === code) && (!year || String(d.year) === year) && (!academicYear || d.academic_year === academicYear))
      .map(d => d.course)
  )];
  updateDropdownOptions(courseSelect, availableCourses, course, 'Select Course');

  // Update Academic Year dropdown
  const availableAcademicYears = [...new Set(
    allDepartments
      .filter(d => (!code || d.course_code === code) && (!course || d.course === course) && (!year || String(d.year) === year))
      .map(d => d.academic_year)
      .filter(Boolean)
  )];
  if (academicYearSelect) {
    updateDropdownOptions(academicYearSelect, availableAcademicYears, academicYear, 'Select Academic Year', true);
  }

  // Update Year dropdown
  const availableYears = [...new Set(
    allDepartments
      .filter(d => (!code || d.course_code === code) && (!course || d.course === course) && (!academicYear || d.academic_year === academicYear))
      .map(d => String(d.year))
  )];
  updateDropdownOptions(yearSelect, availableYears, year, 'Select Year');

  // Auto-select if only one option available
  if (availableCodes.length === 1 && !code) codeSelect.value = availableCodes[0];
  if (availableCourses.length === 1 && !course) courseSelect.value = availableCourses[0];
  if (availableAcademicYears.length === 1 && !academicYear && academicYearSelect) {
    academicYearSelect.value = availableAcademicYears[0];
  }
  if (availableYears.length === 1 && !year) yearSelect.value = availableYears[0];

  // Filter reports directly by report fields to avoid Year1/Year2 mixing
  const filteredReports = originalPendingReports.filter(r => {
    const student = allStudentsMap.get(r.student);
    if (!student) return false;
    const dept = student.department || {};
    if (code && dept.course_code !== code) return false;
    if (course && dept.course !== course) return false;
    if (year && String(r.year) !== String(year)) return false;
    if (academicYear) {
      const rAY = normalizeDash(r.academic_year);
      const selAY = normalizeDash(academicYear);
      if (rAY !== selAY) return false;
    }
    return true;
  });

  renderPendingReports(filteredReports, allStudentsMap);
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

function updateDropdown(selectElement, availableValues, selectedValue, defaultLabel) {
  if (!selectElement) return;
  const currentValue = selectElement.value;
  selectElement.innerHTML = `<option value="">${defaultLabel}</option>`;
  Array.from(availableValues).sort().forEach(v => selectElement.innerHTML += `<option value="${v}">${v}</option>`);
  if (availableValues.has(selectedValue)) selectElement.value = selectedValue;
  else if (availableValues.has(currentValue)) selectElement.value = currentValue;
  else selectElement.value = '';
}

function getMatchingStudents(code, course, year, academicYear) {
  return Array.from(allStudentsMap.values()).filter(student => {
    const dept = student.department;
    if (!dept) return false;
    const codeMatches = code ? dept.course_code === code : true;
    const courseMatches = course ? dept.course === course : true;
    const yearMatches = year ? String(student.year) === year : true;
    const academicYearMatches = academicYear ? dept.academic_year === academicYear : true;
    return codeMatches && courseMatches && yearMatches && academicYearMatches;
  });
}

// -------------------------------------------
// Report filtering and rendering
// -------------------------------------------

function filterReports(validStudentIds) {
  const validIdsSet = new Set(validStudentIds.map(id => String(id)));
  const filtered = originalPendingReports.filter(r => validIdsSet.has(String(r.student)));
  renderPendingReports(filtered, allStudentsMap);
}

function renderPendingReports(reports, studentMap) {
  console.log('=== Starting renderPendingReports ===');
  console.log('Total reports:', reports.length);
  console.log('Student map size:', studentMap.size);
  
  const tbody = document.querySelector('#pendingTable tbody');
  if (!tbody) {
    console.error('Table body not found!');
    return;
  }
  
  // Initialize counters for each book type
  const pendingCounts = {
    '2pn': 0,
    '2pr': 0,
    '2po': 0,
    '1pn': 0,
    '1pr': 0,
    '1po': 0,
    'total': 0
  };
  
  console.log('Initialized pendingCounts:', pendingCounts);
  
  // Calculate fulfillment data for the gauge
  let totalFulfilled = 0;
  let totalPending = 0;
  
  console.log('Sample department data (first 2):', allDepartments.slice(0, 2)); // Debug log
  
  // Process each report to count pending books
  reports.forEach((report, index) => {
    const student = studentMap.get(report.student);
    if (student) {
      console.log('Processing report:', report);
      
      // Log the full report for debugging
      console.log('Full report data:', report);
      
      // Define the book types mapping based on the actual data structure
      const bookTypes = [
        { key: 'qty_2PN', short: '2pn' },
        { key: 'qty_2PR', short: '2pr' },
        { key: 'qty_2PO', short: '2po' },
        { key: 'qty_1PN', short: '1pn' },
        { key: 'qty_1PR', short: '1pr' },
        { key: 'qty_1PO', short: '1po' }
      ];
      
      // Process each book type using the new format first
      bookTypes.forEach(book => {
        let count = 0;
        
        // Check the direct key in the report
        if (report[book.key] !== undefined) {
          count = parseInt(report[book.key], 10) || 0;
          console.log(`Found ${count} ${book.key} for ${student.name || student.usn}`);
        }
        
        // Update the pending counts
        console.log(`Processing ${book.short} for ${student.name || student.usn}:`, {
          bookType: book.key,
          count,
          reportKeys: Object.keys(report)
        });
        
        pendingCounts[book.short] = (pendingCounts[book.short] || 0) + count;
        pendingCounts.total += count;
      });
      
      // Calculate fulfilled (total required - pending)
      const dept = (student.department && typeof student.department === 'object')
      ? student.department
      : allDepartments.find(d => d.id === (student.department_id != null ? student.department_id : student.department));
      console.log('Department found:', dept);
      
      if (dept) {
        const totalRequired = (dept.two_hundred_notebook || 0) + 
                            (dept.two_hundred_record || 0) + 
                            (dept.two_hundred_observation || 0) + 
                            (dept.one_hundred_notebook || 0) + 
                            (dept.one_hundred_record || 0) + 
                            (dept.one_hundred_observation || 0);
        
        console.log('Total required by department:', totalRequired);
        
        const pendingTotal = pendingCounts['2pn'] + pendingCounts['2pr'] + pendingCounts['2po'] +
                           pendingCounts['1pn'] + pendingCounts['1pr'] + pendingCounts['1po'];
        
        const fulfilled = Math.max(0, totalRequired - pendingTotal);
        console.log('Fulfilled count:', fulfilled);
        
        totalFulfilled += fulfilled;
        totalPending += pendingTotal;
      }
    }
  });
  
  console.log('\n=== Final Calculation ===');
  console.log('Total Fulfilled:', totalFulfilled);
  console.log('Total Pending:', totalPending);
  console.log('Pending Counts:', pendingCounts);
  
  // Debug log the pending counts before updating UI
  console.log('Pending counts before update:', JSON.stringify(pendingCounts, null, 2));
  
  // Log all elements we're trying to update
  console.log('Elements to be updated:', {
    'total-pending': document.getElementById('total-pending'),
    'count-2pn': document.getElementById('count-2pn'),
    'count-2pr': document.getElementById('count-2pr'),
    'count-2po': document.getElementById('count-2po'),
    'count-1pn': document.getElementById('count-1pn'),
    'count-1pr': document.getElementById('count-1pr'),
    'count-1po': document.getElementById('count-1po')
  });
  
  // Update the UI with the final counts
  updateSummaryCounts(pendingCounts);
  
  // Clear the table body
  tbody.innerHTML = '';

  if (reports.length === 0) {
    tbody.innerHTML = '<tr><td colspan="12">No pending reports found for current filter.</td></tr>';
    const countEl0 = document.getElementById('pendingCount');
    if (countEl0) countEl0.textContent = '0';
    return;
  }
  
  // This function is no longer needed as we calculate totals directly from the reports data
  function calculateSummaryFromTable() {
    // No-op as we now calculate totals directly from the reports data
  }
  
  // Clear the table body
  tbody.innerHTML = '';
  
  // Calculate totals from the reports data directly (legacy buckets only; 'New Items' will be filled later)
  const summaryCounts = {
    '2pn': 0, '2pr': 0, '2po': 0,
    '1pn': 0, '1pr': 0, '1po': 0,
    new: 0,
    total: 0
  };
  
  reports.forEach(report => {
    summaryCounts['2pn'] += report.qty_2PN || 0;
    summaryCounts['2pr'] += report.qty_2PR || 0;
    summaryCounts['2po'] += report.qty_2PO || 0;
    summaryCounts['1pn'] += report.qty_1PN || 0;
    summaryCounts['1pr'] += report.qty_1PR || 0;
    summaryCounts['1po'] += report.qty_1PO || 0;
    
    const totalAllotted = (report.qty_2PN || 0) + (report.qty_2PR || 0) + (report.qty_2PO || 0) + 
                         (report.qty_1PN || 0) + (report.qty_1PR || 0) + (report.qty_1PO || 0);
    summaryCounts.total += totalAllotted;
  });
  
  // Indicate loading while precise counts are computed async
  setSummaryLoading();
  
  // Store the totals for the total row
  window.pendingTotals = summaryCounts;

  if (reports.length === 0) {
    tbody.innerHTML = '<tr><td colspan="12">No pending reports found for current filter.</td></tr>';
    const countEl0 = document.getElementById('pendingCount');
    if (countEl0) countEl0.textContent = 'Total records: 0';
    return;
  }

  const frag = document.createDocumentFragment();
  reports.forEach((report, idx) => {
    const student = studentMap.get(report.student);
    if (!student) return;

    const row = document.createElement('tr');
    // Temporary values use report quantities; will be corrected async
    const totalAllotted = (report.qty_2PN||0)+(report.qty_2PR||0)+(report.qty_2PO||0)+(report.qty_1PN||0)+(report.qty_1PR||0)+(report.qty_1PO||0);
    const status = totalAllotted > 0 ? 'PENDING' : 'COMPLETE';

    row.innerHTML = `
      <td>${idx + 1}</td>
      <td>${student.usn || ''}</td>
      <td>${student.name || ''}</td>
      <td>${student.department?.course_code || ''}</td>
      <td>${student.department?.course || ''}</td>
      <td>${rptYear(report)}</td>
      <td>${rptAcademicYear(report, student)}</td>
      <td>${report.qty_2PN || 0}</td>
      <td>${report.qty_2PR || 0}</td>
      <td>${report.qty_2PO || 0}</td>
      <td>${report.qty_1PN || 0}</td>
      <td>${report.qty_1PR || 0}</td>
      <td>${report.qty_1PO || 0}</td>
      <td class="new-items">0</td>
      <td>${totalAllotted}</td>
      <td><span class="status ${status.toLowerCase()}">${status}</span></td>
    `;
    frag.appendChild(row);
  });
  tbody.appendChild(frag);

  // Update count based on rendered rows (excluding total row)
  const countEl = document.getElementById('pendingCount');
  if (countEl) countEl.textContent = `Total records: ${reports.length}`;

  // Render rows (will use dynamic codes from items list)
  setTableLoading(true);
  updatePendingCells(reports, studentMap)
    .catch(e => console.error('updatePendingCells error', e))
    .finally(() => setTableLoading(false));
}

async function updatePendingCells(reports, studentMap) {
  const table = document.getElementById('pendingTable');
  const theadRow = table?.querySelector('thead tr');
  const tbody = table?.querySelector('tbody');
  if (!theadRow || !tbody) return;

  // Collect student pending maps first and discover any non-legacy codes present
  const discovered = new Set();
  const perStudent = [];

  for (let i = 0; i < reports.length; i++) {
    const report = reports[i];
    const student = studentMap.get(report.student);
    if (!student) continue;
    const usn = student.usn || '';
    const pendingMap = await getPendingMap(usn, report);
    const normPending = {};
    Object.entries(pendingMap || {}).forEach(([k,v])=>{ normPending[normCode(k)] = Number(v||0); });
    // Track non-legacy codes present from pending
    Object.keys(normPending).forEach(k => { if (normPending[k] > 0) discovered.add(k); });

    const reqMap = await getRequirementsMap(report);
    const issuedMap = getIssuedMap(student.usn, report);
    const dynVals = Object.keys(reqMap).map(c => {
      const fromPending = Number(normPending[c] || 0);
      if (fromPending > 0) return fromPending;
      const req = Number(reqMap[c] || 0);
      const issued = Number(issuedMap[c] || 0);
      const pend = Math.max(0, req - issued);
      return pend;
    });

    perStudent.push({ report, student, normPending, dynVals });
  }

  // Build header: legacy columns + dynamic codes (union of items + discovered) + Total + Pending + Status
  const dynFromItems = DISPLAY_CODES.length ? DISPLAY_CODES : [];
  const dynCodes = Array.from(new Set([...dynFromItems, ...discovered])).sort((a,b)=> a.localeCompare(b, undefined, { numeric: true }));

  theadRow.innerHTML = `
    <th>Sl.No</th>
    <th>USN</th>
    <th>Name</th>
    <th>Code</th>
    <th>Course</th>
    <th>Year</th>
    <th>Academic Year</th>
    ${dynCodes.map(c=>`<th>${c}</th>`).join('')}
    <th>Total</th>
    <th>Status</th>
  `;

  // Rebuild body
  tbody.innerHTML = '';
  let totals = { total:0 };
  const dynTotals = Object.fromEntries(dynCodes.map(c=>[c,0]));

  for (let i = 0; i < perStudent.length; i++) {
    const { report, student, normPending } = perStudent[i];
    // For dynamic codes, prefer backend pending; fallback to requirements - issued
    const reqMap = await getRequirementsMap(report);
    const issuedMap = getIssuedMap(student.usn, report);
    const dynVals = dynCodes.map(c => {
      const fromPending = Number(normPending[c] || 0);
      if (fromPending > 0) return fromPending;
      const req = Number((reqMap && reqMap[c]) || 0);
      const issued = Number(issuedMap[c] || 0);
      const pend = Math.max(0, req - issued);
      return pend;
    });
    const totalPending = dynVals.reduce((a,b)=>a+b,0);
    const status = totalPending > 0 ? 'PENDING' : 'COMPLETE';

    const tr = document.createElement('tr');
    tr.innerHTML = `
      <td>${i+1}</td>
      <td>${student.usn || ''}</td>
      <td>${student.name || ''}</td>
      <td>${student.department?.course_code || ''}</td>
      <td>${student.department?.course || ''}</td>
      <td>${rptYear(report)}</td>
      <td>${rptAcademicYear(report, student)}</td>
      ${dynVals.map(v=>`<td>${fmtCell(v)}</td>`).join('')}
      <td>${totalPending}</td>
      <td><span class="status ${status.toLowerCase()}">${status}</span></td>
    `;
    tbody.appendChild(tr);

    totals.total += totalPending;
    dynCodes.forEach((c, i) => { dynTotals[c] += dynVals[i]; });
  }

  // Update the summary section with legacy + dynamic totals
  const summaryCounts = {};
  dynCodes.forEach(c => { summaryCounts[normCode(c).toLowerCase()] = dynTotals[c] || 0; });
  updateSummaryCounts(summaryCounts, [...dynCodes]);

  // Add new total row
  const totalRow = document.createElement('tr');
  totalRow.className = 'total-row';
  totalRow.style.fontWeight = 'bold';
  totalRow.style.backgroundColor = '#523596';
  totalRow.style.color = 'white';
  totalRow.style.fontSize = '14px';
  totalRow.innerHTML = `
    <td style="text-align:center;padding:12px 10px;border-top:2px solid #3d2870;">-</td>
    <td style="text-align:center;padding:12px 10px;border-top:2px solid #3d2870;">-</td>
    <td style="text-align:center;padding:12px 10px;border-top:2px solid #3d2870;">-</td>
    <td style="text-align:center;padding:12px 10px;border-top:2px solid #3d2870;">-</td>
    <td style="text-align:right;padding:12px 10px;border-top:2px solid #3d2870;">TOTAL:</td>
    <td style="text-align:center;padding:12px 10px;border-top:2px solid #3d2870;">-</td>
    <td style="text-align:center;padding:12px 10px;border-top:2px solid #3d2870;">-</td>
    ${dynCodes.map(c => `<td style="padding:12px 8px;border-top:2px solid #3d2870;">${fmtCell(dynTotals[c]||0)}</td>`).join('')}
    <td style="padding:12px 8px;border-top:2px solid #3d2870;">${totals.total}</td>
    <td style="padding:12px 8px;border-top:2px solid #3d2870;text-align:center;">-</td>
  `;
  tbody.appendChild(totalRow);
}

// ... (rest of the code remains the same)
// Add smart scroll button
function addScrollButtons() {
  // Remove existing button if any
  document.querySelectorAll('.smart-scroll-btn').forEach(btn => btn.remove());
  
  // Create single smart button
  const scrollBtn = document.createElement('button');
  scrollBtn.className = 'smart-scroll-btn';
  scrollBtn.innerHTML = '<i class="fas fa-chevron-down"></i>';
  scrollBtn.style.cssText = `
    position: fixed;
    bottom: 25px;
    right: 25px;
    width: 45px;
    height: 45px;
    background: #F59E0B;
    color: white;
    border: none;
    border-radius: 50%;
    cursor: pointer;
    box-shadow: 0 4px 12px rgba(245, 158, 11, 0.4);
    font-size: 18px;
    z-index: 1000;
    transition: all 0.3s;
    display: none;
  `;
  
  // Hover effect
  scrollBtn.addEventListener('mouseenter', () => {
    scrollBtn.style.background = '#D97706';
    scrollBtn.style.transform = 'scale(1.15)';
    scrollBtn.style.boxShadow = '0 6px 16px rgba(245, 158, 11, 0.6)';
  });
  scrollBtn.addEventListener('mouseleave', () => {
    scrollBtn.style.background = '#F59E0B';
    scrollBtn.style.transform = 'scale(1)';
    scrollBtn.style.boxShadow = '0 4px 12px rgba(245, 158, 11, 0.4)';
  });
  
  // Click handler - smart behavior
  scrollBtn.addEventListener('click', () => {
    const scrollTop = window.pageYOffset || document.documentElement.scrollTop;
    const scrollHeight = document.documentElement.scrollHeight;
    const clientHeight = document.documentElement.clientHeight;
    
    // If near bottom, scroll to top; otherwise scroll to bottom
    if (scrollTop + clientHeight >= scrollHeight - 200) {
      window.scrollTo({ top: 0, behavior: 'smooth' });
    } else {
      window.scrollTo({ top: document.body.scrollHeight, behavior: 'smooth' });
    }
  });
  
  // Update button based on scroll position
  window.addEventListener('scroll', () => {
    const scrollTop = window.pageYOffset || document.documentElement.scrollTop;
    const scrollHeight = document.documentElement.scrollHeight;
    const clientHeight = document.documentElement.clientHeight;
    
    // Show button if scrolled down
    if (scrollTop > 300) {
      scrollBtn.style.display = 'block';
    } else {
      scrollBtn.style.display = 'none';
    }
    
    // Change icon based on position
    if (scrollTop + clientHeight >= scrollHeight - 200) {
      scrollBtn.innerHTML = '<i class="fas fa-chevron-up"></i>';
    } else {
      scrollBtn.innerHTML = '<i class="fas fa-chevron-down"></i>';
    }
  });
  
  document.body.appendChild(scrollBtn);
}

// -------------------------------------------
// Actions
// -------------------------------------------
async function generateReport() {
  const selectedCode = document.getElementById('courseCode').value;
  const selectedCourse = document.getElementById('courseName').value;
  const selectedYear = document.getElementById('year').value;
  const selectedAcademicYear = document.getElementById('academicYear')?.value || '';

  try {
    const gen = await authFetch(`${API_BASE_URL}/generate-pending-reports/`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'X-CSRFToken': getCookie('csrftoken') }
    });
    if (gen.ok) await fetchPendingReports();
  } catch (e) { console.warn('generate-pending-reports failed', e); }

  const matching = getMatchingStudents(selectedCode, selectedCourse, selectedYear, selectedAcademicYear);
  const ids = matching.map(s => s.id);
  filterReports(ids);
  showMessage(`Report generated for ${ids.length} students.`, false);
}

async function generateExcel() {
  // Temporarily hide UI
  const filterSection = document.querySelector('.filter-section');
  const pdfBtnContainer = document.querySelector('.pdf-btn-container');
  const messageArea = document.querySelector('.message-area');
  if (filterSection) filterSection.style.display = 'none';
  if (pdfBtnContainer) pdfBtnContainer.style.display = 'none';
  if (messageArea) messageArea.style.display = 'none';

  const table = document.getElementById('pendingTable');
  const wb = XLSX.utils.book_new();

  const selectedCode = document.getElementById('courseCode').value;
  const selectedCourse = document.getElementById('courseName').value;
  const selectedYear = document.getElementById('year').value;
  const selectedAcademicYear = document.getElementById('academicYear')?.value || '';

  // Build header from the live table header (includes dynamic codes)
  const header = Array.from(table.querySelectorAll('thead th')).map(th => th.textContent.trim());

  const ws = XLSX.utils.aoa_to_sheet([
    ['AIMS INSTITUTES'],
    ['INVENTORY MANAGEMENT'],
    ['PENDING BOOKS STATISTICAL REPORT - PROGRAM WISE'],
    [''],
    ['Course Code:', selectedCode || 'All'],
    ['Course Name:', selectedCourse || 'All'],
    ['Academic Year:', selectedAcademicYear || 'All'],
    ['Year:', selectedYear || 'All'],
    [''],
    header,
    ...Array.from(table.querySelectorAll('tbody tr')).map(row => {
      const cells = row.querySelectorAll('td');
      return Array.from(cells).map(cell => cell.textContent.trim());
    }),
    [''], // Empty row before total
  ]);

  XLSX.utils.book_append_sheet(wb, ws, 'Pending Reports');
  XLSX.writeFile(wb, 'Pending_Reports_Program_Wise.xlsx');
  
  // Log the activity
  try {
    const rowCount = table.querySelectorAll('tbody tr').length;
    await authFetch(`${API_BASE_URL}/activity-logs/`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        action: 'report_generated',
        description: `Generated pending reports Excel for ${rowCount} students`
      })
    });
  } catch (err) {
    console.warn('Failed to log activity:', err);
  }

  setTimeout(() => {
    if (filterSection) filterSection.style.display = '';
    if (pdfBtnContainer) pdfBtnContainer.style.display = '';
    if (messageArea) messageArea.style.display = '';
  }, 100);

  showMessage('Excel file generated successfully!', false);
}
