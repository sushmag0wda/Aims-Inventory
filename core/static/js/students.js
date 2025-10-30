// core/static/js/students.js 
// Base URL for your Django backend API
console.log("students.js[v10001]: using /api/enrollments/ and mapping each enrollment to a row");
const API_BASE_URL = "http://127.0.0.1:8000/api";

let departmentsData = []; // Stores all departments fetched from the API
let allStudents = [];     // Stores all students fetched from the API
let editingStudentUsn = null;

// ===========================================
// UTILITIES 
// ===========================================

// Helper function for making authenticated API requests
async function authFetch(url, options = {}) {
    const response = await fetch(url, options);
    if (response.status === 401) {
        // If unauthorized, redirect to the login page
        window.location.href = '/login'; 
        throw new Error('Unauthorized');
    }
    return response;
}

// Helper: centered toast message (auto-dismiss + click-to-dismiss)
const showMessage = (message, isError = false) => {
    try {
        // Remove any existing toast
        document.querySelectorAll('.toast-message').forEach(n => n.remove());

        const toast = document.createElement('div');
        toast.className = 'toast-message';
        toast.textContent = message;
        toast.setAttribute('role', 'status');
        toast.style.position = 'fixed';
        toast.style.left = '50%';
        toast.style.top = '50%'; // middle of the page
        toast.style.transform = 'translate(-50%, -50%)';
        toast.style.zIndex = '9999';
        toast.style.maxWidth = '80vw';
        toast.style.padding = '14px 18px';
        toast.style.borderRadius = '10px';
        toast.style.boxShadow = '0 10px 30px rgba(0,0,0,0.25)';
        toast.style.fontWeight = '600';
        toast.style.textAlign = 'center';
        toast.style.color = isError ? '#7f1d1d' : '#052e16';
        toast.style.background = isError ? '#fee2e2' : '#dcfce7';
        toast.style.border = `1px solid ${isError ? '#fecaca' : '#bbf7d0'}`;

        document.body.appendChild(toast);

        const remove = () => { try { toast.remove(); } catch(_){} };
        const timeoutId = setTimeout(remove, 1500); // auto-dismiss after ~1.5s
        toast.addEventListener('click', () => {
            clearTimeout(timeoutId);
            remove();
        });
    } catch (_) {
        // Fallback alert on unexpected DOM errors
        if (isError) console.error(message); else console.log(message);
    }
};

// Function to get CSRF token from cookie
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

// ===========================================
// DATA FETCHING 
// ===========================================

// Function to fetch departments from the API
async function fetchDepartments() {
    try {
        const response = await authFetch(`${API_BASE_URL}/departments/`);
        departmentsData = await response.json(); 
        window.departmentsData = departmentsData; // expose for filters script
        
        // Populate and sync the ADD STUDENT FORM dropdowns
        populateDepartmentDropdowns(departmentsData, "course-code", "course", "year", "academic-year");
        
        // Populate the TABLE FILTER dropdowns
        populateDepartmentDropdowns(departmentsData, "filter-code", "filter-course", "filter-year", "filter-academic-year");

        // Add event listeners for filter changes
        ['filter-code', 'filter-course', 'filter-year', 'filter-academic-year'].forEach(id => {
            const element = document.getElementById(id);
            if (element) {
                element.addEventListener('change', filterStudentTable);
            }
        });

        // Apply filters now that departments are loaded
        if (typeof window.filterStudentTable === 'function') {
            window.filterStudentTable();
        }

    } catch (error) {
        console.error("Error fetching departments:", error);
    }
}

async function fetchStudents() {
    try {
        console.log("Fetching enrollments...");
        const response = await authFetch(`${API_BASE_URL}/enrollments/`);
        if (!response.ok) {
            const errorText = await response.text();
            console.error("Error response:", response.status, errorText);
            showMessage(`Error fetching enrollments. Server responded: ${response.status} - ${errorText.substring(0, 80)}...`, true);
            return;
        }
        const enrollments = await response.json();
        // Map enrollments to the table shape and include enrollment academic_year
        const dashNormalize = (s) => String(s ?? '').replace(/[\u2010-\u2015\u2212]/g, '-');
        const norm = (v) => dashNormalize(String(v ?? '').trim());
        let mapped = (Array.isArray(enrollments) ? enrollments : []).map(e => {
            const deptObj = e.department || {};
            const deptId = Number(e.department_id ?? deptObj.id ?? null);
            const studentObj = e.student || {};
            const studentId = Number(e.student_id ?? studentObj.id ?? null);
            return {
                usn: studentObj.usn || '',
                name: studentObj.name || '',
                email: studentObj.email || '',
                phone: studentObj.phone || '',
                department: deptObj || null,
                department_id: deptId,
                student_id: studentId,
                enrollment_academic_year: norm(e.academic_year || deptObj.academic_year || ''),
                // Ensure table shows the enrollment's year
                year: norm(e.year || (deptObj.year ? String(deptObj.year) : ''))
            };
        });
        // De-duplicate by (usn, academic_year, year) to avoid double rows when duplicate Departments exist
        const seenKeys = new Set();
        allStudents = mapped.filter(r => {
            const key = `${r.usn}|${r.enrollment_academic_year}|${String(r.year)}`;
            if (seenKeys.has(key)) return false;
            seenKeys.add(key);
            return true;
        });
        console.log("Fetched enrollments mapped to rows:", allStudents);
        window.allStudents = allStudents; // expose for other scripts

        // Initial render and count
        if (typeof renderStudentTable === 'function') {
            renderStudentTable(allStudents);
        } else {
            console.error("renderStudentTable function not found!");
        }
        
        const countEl = document.getElementById('studentCount');
        if (countEl) countEl.textContent = String(allStudents.length);
        else console.error("studentCount element not found!");

        // Apply any currently selected filters once data is loaded
        if (typeof window.filterStudentTable === 'function') {
            window.filterStudentTable();
        } else {
            console.error("filterStudentTable function not found!");
        }
    } catch (error) {
        console.error("Error fetching enrollments:", error);
        if (error.message !== 'Unauthorized') {
            showMessage("An unexpected error occurred while fetching enrollments. Please check the console for details.", true);
        }
    }
}

async function handleAddStudent(event) {
    event.preventDefault();
    const form = event.currentTarget;

    // 1. Get the unique department ID 
    const departmentId = getSelectedDepartmentId();

    const usn = document.getElementById("usn").value.trim();
    const name = document.getElementById("name").value.trim();
    const year = document.getElementById("year").value;
    const email = document.getElementById("email").value.trim();
    const phone = document.getElementById("phone").value.trim();

    const emailPattern = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
    const phonePattern = /^[0-9]{10}$/;

    if (!departmentId) {
        showMessage("Please select valid Course Code, Course Name, and Year to define the department.", true);
        return;
    }
    
    if (!usn || !name || !year) {
        showMessage("USN, Name, and Year are required.", true);
        return;
    }

    if (email && !emailPattern.test(email)) {
        showMessage("Enter a valid email address (e.g., user@example.com).", true);
        return;
    }

    if (phone && !phonePattern.test(phone)) {
        showMessage("Enter a valid 10-digit phone number (numbers only).", true);
        return;
    }

    const currentUsn = editingStudentUsn;
    if (!currentUsn && isDuplicateUsn(usn)) {
        showMessage('A student with this USN already exists. Use a unique USN or edit the existing record.', true);
        return;
    }

    const studentData = {
        department_id: departmentId, 
        usn: usn,
        name: name,
        year: year,
        email: email,
        phone: phone
    };
    
    // 3. API Call
    try {
        const isUpdate = Boolean(currentUsn);
    const url = isUpdate ? `${API_BASE_URL}/students/${currentUsn}/` : `${API_BASE_URL}/students/`;
    const method = isUpdate ? 'PUT' : 'POST';

        const response = await authFetch(url, {
            method,
            headers: { 
                'Content-Type': 'application/json',
                'X-CSRFToken': getCookie('csrftoken')
            },
            body: JSON.stringify(studentData)
        });
        
        if (response.ok) {
            // The backend automatically creates the enrollment via get_or_create.
            // Consume the created student payload (if provided) to keep the promise resolved.
            try { await response.json(); } catch (_) { /* ignore */ }

            showMessage(isUpdate ? "Student updated successfully!" : "Student and enrollment added successfully! 🎉", false);
            document.getElementById("addStudentForm").reset();
            editingStudentUsn = null;
            const submitBtn = document.querySelector('.add-student-btn');
            if (submitBtn) {
                submitBtn.innerHTML = '<i class="fas fa-plus"></i> Add Student';
            }
            // Re-fetch enrollments to update the table and re-apply filters
            await fetchStudents(); 
            if (typeof window.filterStudentTable === 'function') {
                window.filterStudentTable();
            }
        } else {
            let details = '';
            try {
                const error = await response.json();
                details = error?.message || error?.detail || JSON.stringify(error);
                if (Array.isArray(error?.non_field_errors) && error.non_field_errors.length) {
                    details = error.non_field_errors.join(', ');
                }
            } catch (_) {
                details = `${response.status} ${response.statusText}`;
            }
            if (response.status === 400 && details.toLowerCase().includes('usn')) {
                showMessage('A student with this USN already exists. Use a unique USN or edit the existing record.', true);
            } else {
                showMessage(`Error adding student: ${details || 'Unknown error'}`, true);
            }
        }
    } catch (error) {
        console.error("Error adding student:", error);
        if (error.message !== 'Unauthorized') {
            showMessage("An unexpected error occurred. Please try again.", true);
        }
    }
}


// ===========================================
// DROPDOWNS & FILTER HELPERS (RESTORED)
// ===========================================

function populateDepartmentDropdowns(departments, codeId, courseId, yearId, academicYearId = null) {
    const codeSelect = document.getElementById(codeId);
    const courseSelect = document.getElementById(courseId);
    const yearSelect = document.getElementById(yearId);
    const academicYearSelect = academicYearId ? document.getElementById(academicYearId) : null;
    
    if (!codeSelect || !courseSelect || !yearSelect) return;

    const uniqueCodes = [];
    const uniqueCourses = [];
    const uniqueYears = [];
    const uniqueAcademicYears = [];
    const deptMap = {};

    // First pass: collect all unique values
    departments.forEach(dept => {
        if (!uniqueCodes.some(item => item.value === dept.course_code)) {
            uniqueCodes.push({
                value: dept.course_code,
                course: dept.course,
                year: String(dept.year),
                academic_year: dept.academic_year || ''
            });
        }
        
        if (!uniqueCourses.some(item => item.value === dept.course)) {
            uniqueCourses.push({
                value: dept.course,
                code: dept.course_code,
                year: String(dept.year),
                academic_year: dept.academic_year || ''
            });
        }

        const yearStr = String(dept.year);
        if (!uniqueYears.some(item => item.value === yearStr)) {
            uniqueYears.push({
                value: yearStr,
                code: dept.course_code,
                course: dept.course,
                academic_year: dept.academic_year || ''
            });
        }

        if (dept.academic_year && !uniqueAcademicYears.includes(dept.academic_year)) {
            uniqueAcademicYears.push(dept.academic_year);
        }

        // Create a map for quick lookup
        const key = `${dept.course_code}|${dept.course}|${dept.year}`;
        deptMap[key] = dept;
    });

    // Store the departments data for later use
    window.departmentsData = departments;

    // Helper function to populate dropdown
    const populateDropdown = (select, items, valueField, displayField = null) => {
        const currentValue = select.value;
        select.innerHTML = '';
        select.innerHTML += `<option value="">Select ${select.id.replace('-', ' ').replace(/(^|\s)\S/g, l => l.toUpperCase())}</option>`;
        
        items.forEach(item => {
            const value = item[valueField] || item;
            const display = displayField ? item[displayField] : value;
            select.innerHTML += `<option value="${value}" data-item='${JSON.stringify(item)}'>${display}</option>`;
        });
        
        if (items.some(item => (item[valueField] || item) === currentValue)) {
            select.value = currentValue;
        }
    };

    // Populate all dropdowns
    populateDropdown(codeSelect, uniqueCodes, 'value', 'value');
    populateDropdown(courseSelect, uniqueCourses, 'value', 'value');
    populateDropdown(yearSelect, uniqueYears, 'value');
    
    if (academicYearSelect) {
        populateDropdown(academicYearSelect, uniqueAcademicYears.sort().reverse());
    }

    // Add event listeners for syncing
    [codeSelect, courseSelect, yearSelect, academicYearSelect].filter(Boolean).forEach(select => {
        select.addEventListener('change', function() {
            syncAddFormDropdowns(this.id);
        });
    });
}

function syncAddFormDropdowns(changedField = null) {
    const codeSelect = document.getElementById("course-code");
    const courseSelect = document.getElementById("course");
    const yearSelect = document.getElementById("year");
    const academicYearSelect = document.getElementById("academic-year");

    if (!codeSelect || !courseSelect || !yearSelect || !academicYearSelect) return;

    // Store current values before any changes
    const currentCode = codeSelect.value;
    const currentCourse = courseSelect.value;
    const currentYear = yearSelect.value;
    const currentAcademicYear = academicYearSelect.value;

    // Get all departments
    const allDepts = window.departmentsData || [];

    // Helper to update a dropdown
    const updateSelect = (select, values, selected, label) => {
        select.innerHTML = `<option value="">${label}</option>`;
        const unique = [...new Set(values.filter(v => v))];
        unique.sort((a, b) => String(a).localeCompare(String(b), undefined, { numeric: true }));
        unique.forEach(v => {
            const opt = document.createElement("option");
            opt.value = v;
            opt.textContent = v;
            if (v === selected) opt.selected = true;
            select.appendChild(opt);
        });
    };

    // Reset dependent dropdowns when parent filters change
    function resetDependentDropdowns() {
        if (changedField === 'course-code' || changedField === 'course') {
            yearSelect.innerHTML = '<option value="">Select Year</option>';
            academicYearSelect.innerHTML = '<option value="">Select Academic Year</option>';
        } else if (changedField === 'year') {
            academicYearSelect.innerHTML = '<option value="">Select Academic Year</option>';
        }
    }

    // Reset dependent dropdowns when parent changes
    resetDependentDropdowns();

    // Filter departments based on current selections
    const filteredDepts = allDepts.filter(d => {
        if (currentCode && d.course_code !== currentCode) return false;
        if (currentCourse && d.course !== currentCourse) return false;
        if (currentYear && String(d.year) !== currentYear) return false;
        if (currentAcademicYear && d.academic_year !== currentAcademicYear) return false;
        return true;
    });

    // 1. Update Course Code dropdown
    const availableCodes = [...new Set(allDepts.map(d => d.course_code))];
    updateSelect(codeSelect, availableCodes, currentCode, "Select Course Code");

    // 2. Update Course dropdown based on selected code
    const availableCourses = [...new Set(
        allDepts
            .filter(d => !currentCode || d.course_code === currentCode)
            .map(d => d.course)
    )];
    updateSelect(courseSelect, availableCourses, currentCourse, "Select Course");

    // 3. First, filter departments based on course code and course
    const deptsFilteredByCourse = allDepts.filter(d => 
        (!currentCode || d.course_code === currentCode) &&
        (!currentCourse || d.course === currentCourse)
    );

    // 4. Get available academic years based on current filters
    const availableAcademicYears = [...new Set(
        deptsFilteredByCourse.map(d => d.academic_year).filter(Boolean)
    )].sort().reverse(); // Sort in descending order (newest first)
    
    updateSelect(academicYearSelect, availableAcademicYears, currentAcademicYear, "Select Academic Year");

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
    if (availableAcademicYears.length === 1 && !currentAcademicYear) {
        academicYearSelect.value = availableAcademicYears[0];
        // Trigger change event to update year dropdown
        const event = new Event('change');
        academicYearSelect.dispatchEvent(event);
    } else if (availableYears.length === 1 && !currentYear) {
        yearSelect.value = availableYears[0];
    }
}

function getSelectedDepartmentId() {
    const courseCode = document.getElementById("course-code")?.value;
    const course = document.getElementById("course")?.value;
    const year = document.getElementById("year")?.value;
    const academicYear = document.getElementById("academic-year")?.value;
    
    if (!courseCode || !course || !year) return null;
    
    // Find department with matching criteria
    const dept = window.departmentsData.find(d => 
        d.course_code === courseCode && 
        d.course === course && 
        String(d.year) === year &&
        (!academicYear || d.academic_year === academicYear)
    );
    
    return dept?.id || null;
}

function filterStudentTable() {
    if (!window.allStudents) {
        console.log("Waiting for data to load...");
        return;
    }
    const dashNormalize = (s) => String(s ?? '').replace(/[\u2010-\u2015\u2212]/g, '-');
    const norm = (v) => dashNormalize(String(v ?? '').trim().toUpperCase());
    const codeFilter = document.getElementById("filter-code")?.value || "";
    const courseFilter = document.getElementById("filter-course")?.value || "";
    const yearFilter = document.getElementById("filter-year")?.value || "";
    const academicYearFilter = document.getElementById("filter-academic-year")?.value || "";
    console.log('Filtering with:', { codeFilter, courseFilter, yearFilter, academicYearFilter });

    const filteredStudents = window.allStudents.filter(s => {
        const d = s.department || {};
        const matchesCode = !codeFilter || norm(d.course_code) === norm(codeFilter);
        const matchesCourse = !courseFilter || norm(d.course) === norm(courseFilter);
        // Academic Year must match the enrollment's AY exactly when filter is set
        const matchesAcademicYear = !academicYearFilter || norm(s.enrollment_academic_year) === norm(academicYearFilter);
        const matchesYear = !yearFilter || norm(s.year) === norm(yearFilter);
        return matchesCode && matchesCourse && matchesAcademicYear && matchesYear;
    });
    console.log('Filtered students count:', filteredStudents.length);
    if (academicYearFilter && filteredStudents.length === 0) {
        const distinctAYs = [...new Set(window.allStudents.map(x => norm(x.enrollment_academic_year)))];
        console.log('Debug AYs present:', distinctAYs);
    }
    renderStudentTable(filteredStudents);
}

function renderStudentTable(students) {
    const tbody = document.getElementById('studentsTableBody');
    if (!tbody) {
        console.error("Could not find students table body!");
        return;
    }
    
    tbody.innerHTML = ''; // Clear existing rows
    
    if (!students || students.length === 0) {
        const row = document.createElement('tr');
        const cell = document.createElement('td');
        cell.colSpan = 8; // Update colspan to match number of columns
        cell.className = 'no-data';
        cell.textContent = 'No students found';
        row.appendChild(cell);
        tbody.appendChild(row);
        return;
    }

    students.forEach(student => {
        const row = document.createElement('tr');
        
        // Create cells in the requested order:
        // USN, Name, Course, Code, Academic Year, Year, Phone, Email
        const cells = [
            student.usn || '',
            student.name || '',
            student.department?.course || student.course || '',
            student.department?.course_code || student.course_code || '',
            // Prefer enrollment_academic_year if present
            student.enrollment_academic_year || student.department?.academic_year || student.academic_year || '',
            student.year || student.department?.year || '',
            student.phone || '',
            student.email || ''
        ];

        // Add cells to the row
        cells.forEach(cellText => {
            const cell = document.createElement('td');
            cell.textContent = cellText;
            row.appendChild(cell);
        });

        // Add action buttons
        const actionsCell = document.createElement('td');
        actionsCell.className = 'actions';
        actionsCell.innerHTML = `
            <div style="display:flex;flex-direction:column;gap:6px;">
                <button class="edit-btn" data-id="${student.usn}">EDIT</button>
                <button class="delete-btn" data-id="${student.usn}">DELETE</button>
            </div>
        `;
        row.appendChild(actionsCell);

        tbody.appendChild(row);
    });
    
    // Update student count
    const countEl = document.getElementById('studentCount');
    if (countEl) countEl.textContent = String(students.length);
}

function isDuplicateUsn(usn, currentUsn = null) {
    const normUsn = (usn || '').trim().toUpperCase();
    const normCurrent = (currentUsn || '').trim().toUpperCase();
    if (normUsn === normCurrent) return false;
    const selectedAY = (document.getElementById('academic-year')?.value || '').trim().toUpperCase();
    const selectedYear = (document.getElementById('year')?.value || '').trim().toUpperCase();
    const students = Array.isArray(window.allStudents) ? window.allStudents : [];
    return students.some(entry => {
        const entryUsn = (entry.usn || '').trim().toUpperCase();
        if (entryUsn !== normUsn) return false;
        const entryAy = (entry.enrollment_academic_year || entry.academic_year || '').trim().toUpperCase();
        const entryYear = (entry.year || '').trim().toUpperCase();
        if (!selectedAY && !selectedYear) return true;
        if (selectedAY && entryAy !== selectedAY) return false;
        if (selectedYear && entryYear !== selectedYear) return false;
        return true;
    });
}

async function editStudent(usn) {
    // Find the student data
    const student = window.allStudents.find(s => s.usn === usn);
    if (!student) {
        showMessage('Student not found', true);
        return;
    }
    
    // Populate the form with student data
    const usnField = document.getElementById('usn');
    const nameField = document.getElementById('name');
    const phoneField = document.getElementById('phone');
    const emailField = document.getElementById('email');
    const courseCodeField = document.getElementById('course-code');
    const courseField = document.getElementById('course');
    const yearField = document.getElementById('year');
    
    if (usnField) usnField.value = student.usn;
    if (nameField) nameField.value = student.name;
    if (phoneField) phoneField.value = student.phone || '';
    if (emailField) emailField.value = student.email || '';
    
    // Set department dropdowns
    if (student.department) {
        if (courseCodeField) courseCodeField.value = student.department.course_code;
        if (courseField) courseField.value = student.department.course;
        if (yearField) yearField.value = student.year;
    }
    
    // Scroll to form
    const formSection = document.querySelector('.add-student-section');
    if (formSection) {
        formSection.scrollIntoView({ behavior: 'smooth' });
    }
    
    // Change button text
    const submitBtn = document.querySelector('.add-student-btn');
    if (submitBtn) {
        submitBtn.innerHTML = '<i class="fas fa-edit"></i> Update Student';
    }

    editingStudentUsn = usn;
}

async function deleteStudent(usn) {
    if (!confirm("Are you sure you want to delete this student? This action cannot be undone.")) return;
    try {
        const response = await authFetch(`${API_BASE_URL}/students/${usn}/`, {
            method: 'DELETE',
            headers: { 'X-CSRFToken': getCookie('csrftoken') }
        });
        if (response.status === 204) {
            showMessage("Student deleted successfully! 🗑️", false);
            await fetchStudents();
            filterStudentTable();
        } else {
            const errorText = await response.text();
            showMessage(`Error deleting student. Server responded: ${response.status} - ${errorText.substring(0, 50)}...`, true);
        }
    } catch (error) {
        if (error.message !== 'Unauthorized') showMessage("An unexpected error occurred during deletion. Please try again.", true);
    }
}

// --- DOM Content Loaded and Main Event Listeners ---
document.addEventListener("DOMContentLoaded", function () {
    fetchStudents();
    fetchDepartments();

    // 1. ADD STUDENT FORM CASCADING LISTENERS
    document.getElementById('course-code')?.addEventListener('change', (e) => syncAddFormDropdowns('code'));
    document.getElementById('course')?.addEventListener('change', (e) => syncAddFormDropdowns('course'));
    document.getElementById('year')?.addEventListener('change', (e) => syncAddFormDropdowns('year'));
    
    const addStudentForm = document.getElementById("addStudentForm");
    if (addStudentForm) {
        addStudentForm.addEventListener("submit", handleAddStudent);
    }

    // 2. STUDENT TABLE FILTER LISTENERS
    // Assumes filter dropdowns exist with IDs filter-code, filter-course, filter-year
    document.getElementById('filter-code')?.addEventListener('change', filterStudentTable);
    document.getElementById('filter-course')?.addEventListener('change', filterStudentTable);
    document.getElementById('filter-year')?.addEventListener('change', filterStudentTable);
    document.getElementById('academic-year')?.addEventListener('change', filterStudentTable); // Added event listener for academic year change

    // 3. BULK UPLOAD BUTTON
    const bulkUploadBtn = document.getElementById("bulk-upload-btn");
    if (bulkUploadBtn) {
        bulkUploadBtn.addEventListener("click", () => {
            window.location.href = '/bulk-upload/'; // This link is now resolved correctly by Django
        });
    }

    // 4. Edit/Delete listeners (Delegated)
    // NOTE: This listener relies on editStudent and deleteStudent being defined globally (which we fixed).
    document.querySelector("#studentsTable")?.addEventListener('click', (event) => {
        const target = event.target;
        if (target.classList.contains('edit-btn')) {
            editStudent(target.dataset.id);
        } else if (target.classList.contains('delete-btn')) {
            deleteStudent(target.dataset.id);
        }
    });
});