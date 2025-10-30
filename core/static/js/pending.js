// core/static/js/pending2.js
const API_BASE_URL = "/api";

let allStudentsMap = new Map();
let allDepartments = [];
let originalPendingReports = [];
const studentPendingCache = new Map(); // usn -> { pending: {...}, issued: [...] }

// -------------------------------------------
// Utilities
// -------------------------------------------
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
// Init
// -------------------------------------------

document.addEventListener('DOMContentLoaded', () => {
  initializePendingPage();

  document.getElementById('courseCode')?.addEventListener('change', () => handleFilterChange('code'));
  document.getElementById('courseName')?.addEventListener('change', () => handleFilterChange('course'));
  document.getElementById('academicYear')?.addEventListener('change', () => handleFilterChange('academicYear'));
  document.getElementById('year')?.addEventListener('change', () => handleFilterChange('year'));

  document.getElementById('generateReportButton')?.addEventListener('click', generateReport);
  document.getElementById('generatePdf')?.addEventListener('click', generateExcel);
});

// Helper to normalize unicode dashes in AY
const normalizeDash = (s) => String(s || '').replace(/[\u2010-\u2015\u2212]/g, '-');

async function initializePendingPage() {
  try {
    const [studentsResponse, deptResponse] = await Promise.all([
      authFetch(`${API_BASE_URL}/students/`),
      authFetch(`${API_BASE_URL}/departments/`)
    ]);

    const students = await studentsResponse.json();
    allDepartments = await deptResponse.json();
    allStudentsMap = new Map(students.map(s => [s.id, s]));

    populateDepartmentDropdowns(allDepartments);

    // Ensure pending reports exist for all students
    try {
      const gen = await authFetch(`${API_BASE_URL}/generate-pending-reports/`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'X-CSRFToken': getCookie('csrftoken') }
      });
      if (gen.ok) console.log('Generated missing pending reports');
    } catch (e) { console.warn('generate-pending-reports failed', e); }

    await fetchPendingReports();
    renderPendingReports(originalPendingReports, allStudentsMap);
  } catch (e) {
    console.error('Init error', e);
    showMessage('Failed to load initial data.', true);
  }
}

async function fetchPendingReports() {
  if (allStudentsMap.size === 0) return;
  const resp = await authFetch(`${API_BASE_URL}/pending-reports/`);
  originalPendingReports = await resp.json();
}

// -------------------------------------------
// Filters
// -------------------------------------------

function populateDepartmentDropdowns(departments) {
  const codeSelect = document.getElementById('courseCode');
  const courseSelect = document.getElementById('courseName');
  const yearSelect = document.getElementById('year');
  if (!codeSelect || !courseSelect || !yearSelect) return;

  const uniqueCodes = new Set(departments.map(d => d.course_code).filter(Boolean));
  const uniqueCourses = new Set(departments.map(d => d.course).filter(Boolean));
  // IMPORTANT: Years must come from Departments so newly added years show even without students
  const uniqueYears = new Set(departments.map(d => String(d.year)).filter(Boolean));

  const fill = (sel, values, label) => {
    const current = sel.value;
    sel.innerHTML = `<option value="">${label}</option>`;
    Array.from(values).sort().forEach(v => sel.innerHTML += `<option value="${v}">${v}</option>`);
    sel.value = current;
  };

  fill(codeSelect, uniqueCodes, 'Select Course Code');
  fill(courseSelect, uniqueCourses, 'Select Course');
  fill(yearSelect, uniqueYears, 'Select Year');
}

function handleFilterChange(changedField = null) {
  const codeSelect = document.getElementById('courseCode');
  const courseSelect = document.getElementById('courseName');
  const academicYearSelect = document.getElementById('academicYear');
  const yearSelect = document.getElementById('year');
  
  if (!codeSelect || !courseSelect || !yearSelect) return;

  // Store current values before any changes
  const currentCode = codeSelect.value;
  const currentCourse = courseSelect.value;
  const currentYear = yearSelect.value;
  const currentAcademicYear = academicYearSelect?.value || '';

  console.log(`[Pending] Filter change: ${changedField}, Code: ${currentCode}, Course: ${currentCourse}`);

  // Get all departments
  const allDepts = allDepartments || [];

  // Helper to update a dropdown
  const updateSelect = (select, values, selected, label) => {
    if (!select) return;
    select.innerHTML = `<option value="">${label}</option>`;
    const unique = [...new Set(values.filter(v => v))];
    unique.sort((a, b) => String(a).localeCompare(String(b), undefined, { numeric: true }));
    unique.forEach(v => {
      const opt = document.createElement("option");
      opt.value = v;
      opt.textContent = v;
      select.appendChild(opt);
    });
    // Set the value AFTER all options are added
    if (selected && unique.includes(selected)) {
      select.value = selected;
    }
  };

  // Filter departments based on current selections
  const filteredDepts = allDepts.filter(d => {
    if (currentCode && d.course_code !== currentCode) return false;
    if (currentCourse && d.course !== currentCourse) return false;
    if (currentYear && String(d.year) !== currentYear) return false;
    if (currentAcademicYear && d.academic_year !== currentAcademicYear) return false;
    return true;
  });

  // 1. Update Course Code dropdown - ALWAYS show ALL codes (not filtered)
  const allAvailableCodes = [...new Set(allDepts.map(d => d.course_code))];
  updateSelect(codeSelect, allAvailableCodes, currentCode, "Select Course Code");

  // 2. Update Course dropdown based on CURRENT selected code
  let coursesToShow;
  if (currentCode) {
    // Filter courses by the selected code
    coursesToShow = [...new Set(
      allDepts
        .filter(d => d.course_code === currentCode)
        .map(d => d.course)
    )];
    console.log(`[Pending] Courses for code ${currentCode}:`, coursesToShow);
  } else {
    // No code selected - show all courses
    coursesToShow = [...new Set(allDepts.map(d => d.course))];
    console.log(`[Pending] No code selected, showing all courses`);
  }
  
  // Auto-select if only one course available for this code
  if (currentCode && coursesToShow.length === 1) {
    console.log(`[Pending] Auto-selecting course: ${coursesToShow[0]}`);
    updateSelect(courseSelect, coursesToShow, coursesToShow[0], "Select Course");
  } else {
    // Multiple courses or no code - preserve current selection if valid
    const courseToSelect = coursesToShow.includes(currentCourse) ? currentCourse : '';
    console.log(`[Pending] Preserving course: ${courseToSelect}`);
    updateSelect(courseSelect, coursesToShow, courseToSelect, "Select Course");
  }
  
  // Re-read the values AFTER auto-selection
  const finalCode = codeSelect.value;
  const finalCourse = courseSelect.value;
  
  console.log(`[Pending] After update - Code: ${finalCode}, Course: ${finalCourse}`);

  // 3. First, filter departments based on course code and course (use FINAL values)
  const deptsFilteredByCourse = allDepts.filter(d => 
    (!finalCode || d.course_code === finalCode) &&
    (!finalCourse || d.course === finalCourse)
  );

  // 4. Get available academic years based on current filters
  const availableAcademicYears = [...new Set(
    deptsFilteredByCourse.map(d => d.academic_year).filter(Boolean)
  )].sort().reverse(); // Sort in descending order (newest first)
  
  if (academicYearSelect) {
    updateSelect(academicYearSelect, availableAcademicYears, currentAcademicYear, "Select Academic Year");
  }

  // 5. Get available years based on all current selections including academic year
  const deptsFilteredByAcademicYear = deptsFilteredByCourse.filter(d => 
    !currentAcademicYear || d.academic_year === currentAcademicYear
  );

  const availableYears = [...new Set(
    deptsFilteredByAcademicYear.map(d => String(d.year))
  )].sort();
  
  updateSelect(yearSelect, availableYears, currentYear, "Select Year");

  // Auto-select if only one option is available
  if (availableCodes.length === 1 && !currentCode) codeSelect.value = availableCodes[0];
  if (availableCourses.length === 1 && !currentCourse) courseSelect.value = availableCourses[0];
  
  // Only auto-select year and academic year if they're not already set
  if (availableAcademicYears.length === 1 && !currentAcademicYear && academicYearSelect) {
    academicYearSelect.value = availableAcademicYears[0];
    // Trigger change event to update year dropdown
    const event = new Event('change');
    academicYearSelect.dispatchEvent(event);
  } else if (availableYears.length === 1 && !currentYear) {
    yearSelect.value = availableYears[0];
  }

  // Filter reports directly by report fields (prevents Year1/Year2 mixing)
  const finalYear = yearSelect.value;
  const finalAcademicYear = academicYearSelect?.value || '';
  console.log(`[Pending] Final filter values - Code: ${finalCode}, Course: ${finalCourse}, Year: ${finalYear}, AY: ${finalAcademicYear}`);

  const filteredReports = originalPendingReports.filter(r => {
    const rAY = normalizeDash(r.academic_year);
    const selAY = normalizeDash(finalAcademicYear);
    const student = allStudentsMap.get(r.student);
    if (!student) return false;
    const dept = student.department || {};
    if (finalCode && dept.course_code !== finalCode) return false;
    if (finalCourse && dept.course !== finalCourse) return false;
    if (finalYear && String(r.year) !== String(finalYear)) return false;
    if (finalAcademicYear && rAY !== selAY) return false;
    return true;
  });

  renderPendingReports(filteredReports, allStudentsMap);
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

// Removed duplicate getMatchingStudents implementation to avoid shadowing and wrong filters

// -------------------------------------------
// Report filtering and rendering
// -------------------------------------------

function filterReports(validStudentIds) {
  // Deprecated path; keep for compatibility but use student filter only.
  const validIdsSet = new Set(validStudentIds.map(id => String(id)));
  const filtered = originalPendingReports.filter(r => validIdsSet.has(String(r.student)));
  renderPendingReports(filtered, allStudentsMap);
}

function renderPendingReports(reports, studentMap) {
  const tbody = document.querySelector('#pendingTable tbody');
  if (!tbody) return;
  tbody.innerHTML = '';

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
      <td>${report.year || ''}</td>
      <td>${report.qty_2PN || 0}</td>
      <td>${report.qty_2PR || 0}</td>
      <td>${report.qty_2PO || 0}</td>
      <td>${report.qty_1PN || 0}</td>
      <td>${report.qty_1PR || 0}</td>
      <td>${report.qty_1PO || 0}</td>
      <td>${totalAllotted}</td>
      <td>${totalAllotted}</td>
      <td><span class="status ${status.toLowerCase()}">${status}</span></td>
    `;
    frag.appendChild(row);
  });
  tbody.appendChild(frag);

  // Update count based on rendered rows (excluding total row)
  const countEl = document.getElementById('pendingCount');
  if (countEl) countEl.textContent = `Total records: ${reports.length}`;

  // Add initial total row with report data
  addTotalRow();

  // Now correct the pending quantities per student
  updatePendingCells(reports, studentMap).catch(e => console.error('updatePendingCells error', e));
}

function addTotalRow() {
  const tbody = document.querySelector('#pendingTable tbody');
  if (!tbody) return;
  
  const rows = tbody.querySelectorAll('tr:not(.total-row)');
  if (rows.length === 0) return;
  
  // Calculate totals
  let total2PN = 0, total2PR = 0, total2PO = 0;
  let total1PN = 0, total1PR = 0, total1PO = 0;
  let grandTotal = 0;
  
  rows.forEach(row => {
    const cells = row.querySelectorAll('td');
    if (cells.length >= 13) {
      total2PN += parseInt(cells[6].textContent) || 0;
      total2PR += parseInt(cells[7].textContent) || 0;
      total2PO += parseInt(cells[8].textContent) || 0;
      total1PN += parseInt(cells[9].textContent) || 0;
      total1PR += parseInt(cells[10].textContent) || 0;
      total1PO += parseInt(cells[11].textContent) || 0;
      grandTotal += parseInt(cells[12].textContent) || 0;
    }
  });
  
  // Remove existing total row if any
  const existingTotal = tbody.querySelector('.total-row');
  if (existingTotal) existingTotal.remove();
  
  // Add new total row
  const totalRow = document.createElement('tr');
  totalRow.className = 'total-row';
  totalRow.style.fontWeight = 'bold';
  totalRow.style.backgroundColor = '#f3f4f6';
  totalRow.innerHTML = `
    <td colspan="6" style="text-align:right;padding-right:10px;">TOTAL:</td>
    <td>${total2PN}</td>
    <td>${total2PR}</td>
    <td>${total2PO}</td>
    <td>${total1PN}</td>
    <td>${total1PR}</td>
    <td>${total1PO}</td>
    <td>${grandTotal}</td>
    <td>${grandTotal}</td>
    <td></td>
  `;
  tbody.appendChild(totalRow);
}

async function updatePendingCells(reports, studentMap) {
  const tbody = document.querySelector('#pendingTable tbody');
  if (!tbody) return;
  const rows = tbody.querySelectorAll('tr:not(.total-row)');

  for (let i = 0; i < reports.length; i++) {
    const report = reports[i];
    const student = studentMap.get(report.student);
    if (!student) continue;
    const usn = student.usn || '';

    let pendingMap = {};
    try {
      if (studentPendingCache.has(usn)) {
        pendingMap = studentPendingCache.get(usn).pending || {};
      } else {
        const resp = await authFetch(`${API_BASE_URL}/student-records/${encodeURIComponent(usn)}/`);
        if (resp.ok) {
          const data = await resp.json();
          pendingMap = data.pending || {};
          studentPendingCache.set(usn, { pending: pendingMap, issued: data.issued || [] });
        }
      }
    } catch (e) {
      console.warn('Failed to fetch student-records for', usn, e);
      continue;
    }

    const p2pn = Number(pendingMap['2PN'] || 0);
    const p2pr = Number(pendingMap['2PR'] || 0);
    const p2po = Number(pendingMap['2PO'] || 0);
    const p1pn = Number(pendingMap['1PN'] || 0);
    const p1pr = Number(pendingMap['1PR'] || 0);
    const p1po = Number(pendingMap['1PO'] || 0);
    const totalPending = p2pn + p2pr + p2po + p1pn + p1pr + p1po;
    const status = totalPending > 0 ? 'PENDING' : 'COMPLETE';

    const row = rows[i];
    if (!row) continue;
    const cells = row.querySelectorAll('td');
    if (cells.length < 15) continue;

    // Columns: 0:Sl,1:USN,2:Name,3:Code,4:Course,5:Year,6..11 qtys, 12:Total,13:Pending,14:Status
    cells[6].textContent = p2pn;
    cells[7].textContent = p2pr;
    cells[8].textContent = p2po;
    cells[9].textContent = p1pn;
    cells[10].textContent = p1pr;
    cells[11].textContent = p1po;
    cells[12].textContent = totalPending;    // Total
    cells[13].textContent = totalPending; // Pending Qty
    cells[14].innerHTML = `<span class="status ${status.toLowerCase()}">${status}</span>`;
  }
  
  // Add total row after updating all cells
  addTotalRow();
}

// -------------------------------------------
// Actions
// -------------------------------------------
async function generateReport() {
  const selectedCode = document.getElementById('courseCode').value;
  const selectedCourse = document.getElementById('courseName').value;
  const selectedYear = document.getElementById('year').value;

  try {
    const gen = await authFetch(`${API_BASE_URL}/generate-pending-reports/`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'X-CSRFToken': getCookie('csrftoken') }
    });
    if (gen.ok) await fetchPendingReports();
  } catch (e) { console.warn('generate-pending-reports failed', e); }

  const matching = getMatchingStudents(selectedCode, selectedCourse, selectedYear);
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

  const ws = XLSX.utils.aoa_to_sheet([
    ['AIMS INSTITUTES'],
    ['INVENTORY MANAGEMENT'],
    ['PENDING BOOKS STATISTICAL REPORT - PROGRAM WISE'],
    [''],
    ['Course Code:', selectedCode || 'All'],
    ['Course Name:', selectedCourse || 'All'],
    ['Year:', selectedYear || 'All'],
    [''],
    ['Sl.No', 'USN', 'Name', 'Code', 'Course', 'Year', '2PN', '2PR', '2PO', '1PN', '1PR', '1PO', 'Total', 'Pending Quantity', 'Status'],
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
