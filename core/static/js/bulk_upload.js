// core/static/js/bulk_upload.js - FINAL FIX FOR DATA EXTRACTION & FILTERING

// Base URL for your Django backend API
const API_BASE_URL = "http://127.0.0.1:8000/api";

// Helper function to normalize headers for robust comparison
const normalizeHeader = (header) => {
    if (!header) return '';
    // 1. Convert to string and trim whitespace
    // 2. Convert to uppercase
    // 3. Replace all non-alphanumeric characters (spaces, hyphens, tabs) with an underscore
    // 4. Remove leading/trailing underscores
    return String(header).trim().toUpperCase().replace(/[^A-Z0-9]/g, '_').replace(/^_+|_+$/g, '');
};

// Helper function for making authenticated API requests (ADDED)
async function authFetch(url, options = {}) {
    const response = await fetch(url, options);
    if (response.status === 401) {
        // If unauthorized, redirect to the login page
        window.location.href = '/login'; 
        throw new Error('Unauthorized');
    }
    return response;
}

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

// Helper function to display on-page messages
const showMessage = (message, isError = false) => {
    const container = document.querySelector('.bulk-container');
    if (!container) return;

    const messageContainer = document.createElement('div');
    messageContainer.textContent = message;
    messageContainer.className = `message-box ${isError ? 'error' : 'success'}`;

    const existingMessage = container.querySelector('.message-box');
    if (existingMessage) existingMessage.remove();

    container.insertBefore(messageContainer, container.firstChild.nextSibling); // After header
    
    setTimeout(() => messageContainer.remove(), 5000);
};

// Function to check for a session cookie and redirect if not found
function checkLoginStatus() {
    // Note: Django's @login_required handles the initial page load redirect.
}

document.addEventListener("DOMContentLoaded", function () {
    checkLoginStatus();

    // Corrected ID for the file input and button
    const fileInput = document.getElementById("excel-file");
    const importButton = document.getElementById("import-btn");
    const backToStudentsBtn = document.getElementById('backToStudentsBtn');
    const urlParams = new URLSearchParams(window.location.search);
    const fromDepartments = urlParams.get('source') === 'departments';
    const tableBody = document.getElementById("imported-students-body"); // Get this reference
    const instructionsBtn = document.getElementById('instructions-btn');
    const instructionsModal = document.getElementById('instructions-modal');
    const instructionsClose = document.getElementById('instructions-close');
    const downloadTemplateBtn = document.getElementById('download-template-btn');

    if (importButton && fileInput) {
        importButton.addEventListener("click", (event) => {
            event.preventDefault();
            handleBulkUpload(fileInput.files[0]);
        });
    }

    const openInstructions = () => {
        if (!instructionsModal) return;
        instructionsModal.removeAttribute('hidden');
        instructionsModal.removeAttribute('inert');
        instructionsModal.setAttribute('aria-hidden', 'false');
        instructionsClose?.focus();
    };

    const closeInstructions = () => {
        if (!instructionsModal) return;
        instructionsModal.setAttribute('aria-hidden', 'true');
        instructionsModal.setAttribute('hidden', '');
        instructionsModal.setAttribute('inert', '');
        instructionsBtn?.focus();
    };

    instructionsBtn?.addEventListener('click', openInstructions);
    instructionsClose?.addEventListener('click', closeInstructions);
    instructionsModal?.addEventListener('click', (event) => {
        if (event.target === instructionsModal) closeInstructions();
    });
    document.addEventListener('keydown', (event) => {
        if (event.key === 'Escape' && instructionsModal?.getAttribute('aria-hidden') === 'false') {
            closeInstructions();
        }
    });

    downloadTemplateBtn?.addEventListener('click', () => {
        const workbook = XLSX.utils.book_new();

        const departmentSheetData = [
            ['Course code', 'Course', 'Program Type', 'Academic Year', 'Year', 'Intake', 'Existing'],
            ['ACC-06', 'MCA', 'PG', '2024-2026', '1', '60', '0']
        ];
        const departmentSheet = XLSX.utils.aoa_to_sheet(departmentSheetData);
        XLSX.utils.book_append_sheet(workbook, departmentSheet, 'Departments');

        const studentSheetData = [
            ['Course code', 'Course', 'Academic Year', 'Year', 'USN', 'Name', 'E-mail', 'Phone'],
            ['ACC-06', 'MCA', '2024-2026', '1', '1VV24MC001', 'Sushma Gowda', 'sushma@example.com', '9876543210']
        ];
        const studentSheet = XLSX.utils.aoa_to_sheet(studentSheetData);
        XLSX.utils.book_append_sheet(workbook, studentSheet, 'Students');

        XLSX.writeFile(workbook, 'bulk_upload_template.xlsx');
    });

    // 💡 FIX 2a: Only clear preview and reset input when navigating away
    if (backToStudentsBtn) {
        if (fromDepartments) {
            backToStudentsBtn.textContent = 'Go to Departments';
        }
        backToStudentsBtn.addEventListener('click', (e) => {
            e.preventDefault();
            if (tableBody) tableBody.innerHTML = '';
            if (fileInput) fileInput.value = '';
            window.location.href = fromDepartments ? '/departments/' : '/students';
        });
    }
});

async function handleBulkUpload(file) {
    if (!file) {
        showMessage("Please select an Excel or CSV file.", true);
        return;
    }

    showMessage("Reading and processing file...", false);
    const reader = new FileReader();
    reader.onload = async function (e) {
        try {
            const data = new Uint8Array(e.target.result);
            const workbook = XLSX.read(data, { type: 'array' });
            const studentHeaders = [
                "Course code",
                "Course",
                "Academic Year",
                "Year",
                "USN",
                "Name",
                "E-mail",
                "Phone"
            ];
            const normalizedStudentHeaders = studentHeaders.map(h => normalizeHeader(h));
            const departmentHeaders = [
                "Course code",
                "Course",
                "Program Type",
                "Academic Year",
                "Year",
                "Intake",
                "Existing"
            ];
            const normalizedDepartmentHeaders = departmentHeaders.map(h => normalizeHeader(h));

            let allStudents = [];
            let totalSheets = 0, processedSheets = 0, skippedSheets = 0;
            const departmentSheets = [];
            const studentSheets = [];

            for (const sheetName of workbook.SheetNames) {
                totalSheets++;
                const worksheet = workbook.Sheets[sheetName];
                const jsonArray = XLSX.utils.sheet_to_json(worksheet, { header: 1 });
                if (jsonArray.length === 0) { skippedSheets++; continue; }

                const rawFileHeaders = jsonArray[0].map(h => String(h || '').trim());
                const normalizedFileHeaders = rawFileHeaders.map(h => normalizeHeader(h));
                const isDepartmentSheet = normalizedDepartmentHeaders.every(normH => normalizedFileHeaders.includes(normH));
                const isStudentSheet = normalizedStudentHeaders.every(normH => normalizedFileHeaders.includes(normH));

                if (isDepartmentSheet) {
                    const rows = XLSX.utils.sheet_to_json(worksheet, {
                        raw: false,
                        defval: "",
                        header: rawFileHeaders,
                        range: 1
                    });
                    departmentSheets.push({ sheetName, rawFileHeaders, rows });
                    continue;
                }

                if (isStudentSheet) {
                    const rows = XLSX.utils.sheet_to_json(worksheet, {
                        raw: false,
                        defval: "",
                        header: rawFileHeaders,
                        range: 1
                    });
                    studentSheets.push({ sheetName, rawFileHeaders, rows });
                    continue;
                }

                skippedSheets++;
            }

            if (!departmentSheets.length) {
                showMessage("Departments sheet missing. Please include a sheet with Program Type, Intake, and Existing values.", true);
                return;
            }

            if (!studentSheets.length) {
                showMessage("No valid student sheets found.", true);
                return;
            }

            const departmentMap = new Map();
            const makeKey = (code, course, ay, year) => {
                return [code || '', course || '', ay || '', year || ''].map(val => String(val || '').trim().toUpperCase()).join('||');
            };

            departmentSheets.forEach(({ rows, rawFileHeaders, sheetName }) => {
                rows.forEach(row => {
                    const obj = {};
                    rawFileHeaders.forEach(header => {
                        const norm = normalizeHeader(header);
                        const value = String(row[header] ?? '').trim();
                        if (norm === normalizeHeader('Course code')) obj.course_code = value;
                        else if (norm === normalizeHeader('Course')) obj.course = value;
                        else if (norm === normalizeHeader('Program Type')) obj.program_type = value;
                        else if (norm === normalizeHeader('Academic Year')) obj.academic_year = value;
                        else if (norm === normalizeHeader('Year')) obj.year = value;
                        else if (norm === normalizeHeader('Intake')) obj.intake = value;
                        else if (norm === normalizeHeader('Existing')) obj.existing = value;
                    });
                    const key = makeKey(obj.course_code, obj.course, obj.academic_year, obj.year);
                    if (key && !departmentMap.has(key)) {
                        departmentMap.set(key, obj);
                    }
                });
            });

            studentSheets.forEach(({ rows, rawFileHeaders }) => {
                const studentsInSheet = rows.map(rawStudent => {
                    const student = {};
                    rawFileHeaders.forEach(rawHeader => {
                        const normalizedHeader = normalizeHeader(rawHeader);
                        const value = String(rawStudent[rawHeader] || '').trim();
                        if (normalizedHeader === normalizeHeader('Course code')) student.course_code = value;
                        else if (normalizedHeader === normalizeHeader('Course')) student.course = value;
                        else if (normalizedHeader === normalizeHeader('Academic Year')) student.academic_year = value;
                        else if (normalizedHeader === normalizeHeader('Year')) student.year = value;
                        else if (normalizedHeader === normalizeHeader('USN')) student.usn = value;
                        else if (normalizedHeader === normalizeHeader('Name')) student.name = value;
                        else if (normalizedHeader === normalizeHeader('E-mail') || normalizedHeader === normalizeHeader('Email')) student.email = value;
                        else if (normalizedHeader === normalizeHeader('Phone')) student.phone = value;
                    });

                    const key = makeKey(student.course_code, student.course, student.academic_year, student.year);
                    const deptInfo = departmentMap.get(key);
                    if (deptInfo) {
                        student.program_type = deptInfo.program_type || '';
                        student.intake = deptInfo.intake || '';
                        student.existing = deptInfo.existing || '';
                    }
                    return student;
                }).filter(s => s.usn && s.usn.length > 0);

                if (studentsInSheet.length) {
                    allStudents = allStudents.concat(studentsInSheet);
                    processedSheets++;
                }
            });

            if (allStudents.length === 0) {
                showMessage("No valid student records found across sheets.", true);
                return;
            }

            console.log(`Processed ${processedSheets}/${totalSheets} sheets. Skipped ${skippedSheets}. Total students: ${allStudents.length}`);

            // Preview
            renderImportedStudents(allStudents);

            // Upload combined students
            const response = await authFetch(`${API_BASE_URL}/students/bulk_upload/`, {
                method: 'POST',
                headers: { 
                    'Content-Type': 'application/json',
                    'X-CSRFToken': getCookie('csrftoken')
                },
                body: JSON.stringify(allStudents)
            });

            // Read response safely to avoid JSON parse errors on HTML/text
            const rawText = await response.text();
            let result = null;
            try { result = rawText ? JSON.parse(rawText) : {}; } catch (_) { /* non-JSON */ }

            if (response.ok) {
                const created = result?.created ?? null;
                const updated = result?.updated ?? null;
                const createdEnrollments = result?.created_enrollments ?? null;
                const received = result?.received ?? allStudents.length;
                let summary = `Imported rows: ${received}.`;
                if (created !== null && updated !== null) summary += ` Students - Created: ${created}, Updated: ${updated}.`;
                if (createdEnrollments !== null) summary += ` Enrollments - Created: ${createdEnrollments}.`;
                showMessage(summary, false);
                // Stay on this page; user can click "Back to Students" when ready
            } else {
                const serverMsg = (result && (result.detail || result.error || result.message)) || rawText || 'Unknown server error';
                showMessage(`Bulk upload failed. ${serverMsg}`, true);
            }
        } catch (error) {
            console.error("Error during bulk upload:", error);
            if (error.message !== 'Unauthorized') {
                showMessage(`An error occurred: ${error.message}`, true);
            }
        }
    };
    reader.readAsArrayBuffer(file);
}

function renderImportedStudents(students) {
    const tableBody = document.getElementById("imported-students-body");
    if (!tableBody) return;
    
    tableBody.innerHTML = ''; // Clear previous data
    
    students.slice(0, 10).forEach(student => { // Show max 10 for preview
        const row = document.createElement('tr');
        row.innerHTML = `
            <td>${student.course_code || ''}</td>
            <td>${student.course || ''}</td>
            <td>${student.program_type || ''}</td>
            <td>${student.academic_year || ''}</td>
            <td>${student.year || ''}</td>
            <td>${student.intake || ''}</td>
            <td>${student.existing || ''}</td>
            <td>${student.usn || ''}</td>
            <td>${student.name || ''}</td>
            <td>${student.email || ''}</td>
            <td>${student.phone || ''}</td>
        `;
        tableBody.appendChild(row);
    });

    if(students.length > 10) {
        const infoRow = document.createElement('tr');
        infoRow.innerHTML = `<td colspan="8" style="text-align: center;">... and ${students.length - 10} more records.</td>`;
        tableBody.appendChild(infoRow);
    }
}