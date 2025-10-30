// core/static/js/reports.js 

const API_BASE_URL = "/api";
const ISSUE_PAGE_URL = "/issue/";

// Legacy mapping for Department fields (for Allotted on legacy items)
const ITEM_CODE_TO_DEPT_FIELD = {
    '2PN': 'two_hundred_notebook',
    '2PR': 'two_hundred_record',
    '2PO': 'two_hundred_observation',
    '1PN': 'one_hundred_notebook',
    '1PR': 'one_hundred_record',
    '1PO': 'one_hundred_observation',
};
const LEGACY_CODES = Object.keys(ITEM_CODE_TO_DEPT_FIELD);

function fmtCell(value) {
    if (value === null || value === undefined) return '-';
    const str = String(value).trim();
    if (!str || str === '-' || str.toUpperCase() === 'N/A' || str.toUpperCase() === '#N/A') return '-';
    const num = Number(str);
    if (Number.isFinite(num)) return num > 0 ? num : '-';
    return '-';
}

async function authFetch(url, options = {}) {
    const response = await fetch(url, options);
    return response;
}

function renderCohortSummary(cohort){
    const container = document.getElementById('reportContainer') || document.querySelector('main') || document.body;
    if (!container) return;
    let box = document.getElementById('cohortSummary');
    if (!box) {
        box = document.createElement('div');
        box.id = 'cohortSummary';
        box.style.margin = '8px 0 12px 0';
        box.style.fontSize = '12px';
        box.style.color = '#374151';
        container.insertBefore(box, container.firstChild);
    }
    const { course_code, course, academic_year, year } = cohort || {};
    box.textContent = `Cohort: ${course_code || '-'} | ${course || '-'} | AY: ${academic_year || '-'} | Year: ${year || '-'}`;
}

// Helper: Prefer global toast if present; fallback to lightweight inline message
const showMessage = window.showMessage || ((message, isError = false) => {
    const container = document.querySelector('main') || document.body;
    const el = document.createElement('div');
    el.textContent = message;
    el.className = `message-box ${isError ? 'error' : 'success'}`;
    container.insertBefore(el, container.firstChild);
    setTimeout(() => el.remove(), 2000);
});

/**
 * Fetches all necessary student, department, and allotted data.
 */
async function fetchRequiredData(studentUsn) {
    try {
        // Use USN instead of ID since StudentViewSet uses lookup_field = 'usn'
        const studentResponse = await authFetch(`${API_BASE_URL}/students/${studentUsn}/`);
        const student = await studentResponse.json();

        // StudentSerializer returns nested department object, use its id
        const deptId = student && student.department ? student.department.id : null;
        let department = null;
        if (deptId) {
            const deptResponse = await authFetch(`${API_BASE_URL}/departments/${deptId}/`);
            department = await deptResponse.json();
        }
        
        // The pending report gives us the ALLOTTED quantities per item for this student's department/year
        const pendingResponse = await authFetch(`${API_BASE_URL}/pending-reports/?student=${student.id}`);
        const pendingReports = await pendingResponse.json();
        const pendingReport = pendingReports.length > 0 ? pendingReports[0] : null;

        return { student, department, pendingReport };

    } catch (error) {
        console.error("Error fetching student/department data:", error);
        showMessage("Failed to load student details for the receipt.", true);
        return { student: null, department: null, pendingReport: null };
    }
}

/**
 * Main function to load and render the receipt data.
 */
async function loadReceiptData() {
    // 1. Get data from session storage (set by issue.js)
    const storedData = sessionStorage.getItem('lastIssuedReceipt');
    console.log('Stored data from session:', storedData);
    
    if (!storedData) {
        // If no session data, this is not a valid receipt flow.
        showMessage("No recent issue data found. Redirecting to Issue Page.", true);
        setTimeout(() => window.location.href = ISSUE_PAGE_URL, 1500);
        return;
    }
    
    const receiptData = JSON.parse(storedData);
    console.log('Parsed receipt data:', receiptData);
    
    const studentUsn = receiptData.studentUsn;
    // NOTE: This array can contain *newly issued* items (post-issue) OR 
    // *all previously issued* items (pre-issue report). We handle both.
    const recordsToDisplay = receiptData.issueRecords || []; 
    console.log('Records to display:', recordsToDisplay);

    if (!studentUsn) {
        showMessage("No student USN found. Redirecting to Issue Page.", true);
        setTimeout(() => window.location.href = ISSUE_PAGE_URL, 1500);
        return;
    }
    
    // 2. Fetch full student, department, and allotted data
    // Look up student by USN first to get the PK
    let studentId = null;
    try {
        // Fallback: fetch all students and find by USN (works without search backend)
        const studentsResp = await authFetch(`${API_BASE_URL}/students/`);
        const studentsList = await studentsResp.json();
        console.log('All students:', studentsList);
        const match = Array.isArray(studentsList) ? studentsList.find(s => s.usn === studentUsn) : null;
        console.log('Found student match:', match);
        studentId = match ? match.id : null;
    } catch (e) {
        console.error('Failed to resolve student by USN:', e);
    }

    if (!studentId) {
        showMessage("Could not resolve student by USN for receipt.", true);
        return;
    }

    console.log('Using student USN:', studentUsn);
    const { student, department, pendingReport } = await fetchRequiredData(studentUsn);
    
    console.log('Fetched student:', student);
    console.log('Fetched department:', department);
    console.log('Fetched pendingReport:', pendingReport);
    
    if (!student || !department) return; // Errors handled in fetchRequiredData

    // 3. Populate Header Data
    document.getElementById('date').textContent = new Date().toLocaleDateString();
    document.getElementById('usn').textContent = student.usn;
    document.getElementById('studentName').textContent = student.name;
    document.getElementById('programCode').textContent = department.course_code;
    document.getElementById('programName').textContent = department.course;
    document.getElementById('academicYear').textContent = department.academic_year || '-';
    document.getElementById('year').textContent = student.year;
    
    // Populate student email
    const studentEmail = student.email || 'student@example.com'; // Default email if not available
    document.getElementById('studentEmail').textContent = studentEmail;
    
    // remove legacy cohort summary rendering

    // 4. Populate Table (dynamic from /api/items and /api/requirements)
    const tableBody = document.getElementById('reportItemsBody');
    tableBody.innerHTML = '';

    let allIssuedCompleted = true; // Flag for overall remark

    // Group issued by item code from recordsToDisplay
    const issuedTotals = {};
    (recordsToDisplay || []).forEach(r => {
        const code = String(r.item_code || '').toUpperCase();
        const qty = Number(r.qty_issued || 0);
        issuedTotals[code] = (issuedTotals[code] || 0) + qty;
    });

    // Determine cohort for requirements
    const code = department.course_code || '';
    const course = department.course || '';
    const academic_year = department.academic_year || '';
    const year = String(student.year || '') || String((recordsToDisplay[0]?.year) || '') || '';

    // Fetch items and requirements
    let items = [];
    let reqMap = {};
    try {
        const [itemsResp, reqResp] = await Promise.all([
            authFetch(`${API_BASE_URL}/items/`),
            authFetch(`${API_BASE_URL}/requirements/?` + new URLSearchParams({ course_code: code, course, academic_year, year }).toString())
        ]);
        items = await itemsResp.json();
        if (reqResp.ok) {
            const data = await reqResp.json();
            const list = Array.isArray(data.requirements) ? data.requirements : [];
            list.forEach(r => { reqMap[String(r.item_code).toUpperCase()] = Number(r.required_qty || 0); });
        }
    } catch (e) { items = []; reqMap = {}; }

    const rows = (items || []).slice().sort((a,b)=> String(a.item_code).localeCompare(String(b.item_code)));
    if (rows.length === 0) {
        const row = document.createElement('tr');
        row.innerHTML = `<td colspan="6">No items configured.</td>`;
        tableBody.appendChild(row);
    } else {
        let totalRequired = 0;
        let totalIssued = 0;
        let totalPending = 0;

        rows.forEach(it => {
            const itemCode = String(it.item_code || '').toUpperCase();
            const itemName = it.name || itemCode;
            const qtyIssued = issuedTotals[itemCode] || 0;
            const deptField = ITEM_CODE_TO_DEPT_FIELD[itemCode];
            const qtyRequired = deptField ? (department?.[deptField] || 0) : (reqMap[itemCode] || 0);
            const qtyPending = Math.max(0, qtyRequired - qtyIssued);
            let status = '-';
            if (qtyRequired > 0) {
                if (qtyIssued >= qtyRequired) status = 'Completed';
                else if (qtyIssued > 0) status = 'Partial';
                else status = 'Pending';
            }
            if (qtyRequired > 0 && qtyIssued < qtyRequired) allIssuedCompleted = false;

            totalRequired += Number(qtyRequired) || 0;
            totalIssued += Number(qtyIssued) || 0;
            totalPending += Number(qtyPending) || 0;

            const row = document.createElement('tr');
            row.innerHTML = `
                <td>${itemName} (${itemCode})</td>
                <td>${fmtCell(qtyRequired)}</td>
                <td>${fmtCell(qtyIssued)}</td>
                <td>${fmtCell(qtyPending)}</td>
                <td>${status}</td>
                <td>Received in good condition.</td>
            `;
            tableBody.appendChild(row);
        });

        const totalRow = document.createElement('tr');
        totalRow.classList.add('totals-row');
        totalRow.innerHTML = `
            <td><strong>Total</strong></td>
            <td><strong>${fmtCell(totalRequired)}</strong></td>
            <td><strong>${fmtCell(totalIssued)}</strong></td>
            <td><strong>${fmtCell(totalPending)}</strong></td>
            <td></td>
            <td></td>
        `;
        tableBody.appendChild(totalRow);
    }
    
    // 5. Overall Remark
    document.getElementById('overallRemark').textContent = allIssuedCompleted 
        ? "All issued items completed the allotted quota." 
        : "Some items were issued partially or the allotment quota was not applicable/met.";

    // 6. Clear session storage after rendering the receipt (optional but recommended)
    // sessionStorage.removeItem('lastIssuedReceipt'); 
}


// Function to generate and download PDF file (only the form content)
async function generatePdf() {
    try {
        const container = document.getElementById('reportContainer');
        if (!container) {
            showMessage('Report container not found for PDF generation.', true);
            return;
        }

        const studentName = (document.getElementById('studentName')?.textContent || 'Student').replace(/\s+/g,'_');
        const usn = document.getElementById('usn')?.textContent || 'USN';
        const filename = `Receipt_${usn}_${studentName}_${new Date().toISOString().slice(0,10)}.pdf`;

        // 1) Prepare DOM for clean PDF: disable links and add compact class
        const anchors = Array.from(container.querySelectorAll('a'));
        const restore = [];
        anchors.forEach(a => {
            restore.push({ el: a, href: a.getAttribute('href'), style: a.getAttribute('style') });
            a.setAttribute('data-href', a.getAttribute('href') || '');
            a.removeAttribute('href');
            a.style.pointerEvents = 'none';
            a.style.textDecoration = 'none';
            a.style.color = '#111827';
            a.style.cursor = 'default';
        });
        container.classList.add('pdf-mode');
        document.body.classList.add('report-pdf-mode');

        const opt = {
            margin:       [18, 18, 18, 18],
            filename:     filename,
            image:        { type: 'jpeg', quality: 0.98 },
            html2canvas:  { scale: 2, useCORS: true, scrollY: 0, backgroundColor: '#ffffff' },
            pagebreak:    { mode: ['avoid-all'] },
            enableLinks:  false,
            jsPDF:        { unit: 'pt', format: 'a4', orientation: 'portrait' }
        };

        await html2pdf().set(opt).from(container).save();

        // Restore anchors and class
        container.classList.remove('pdf-mode');
        document.body.classList.remove('report-pdf-mode');
        restore.forEach(r => {
            r.el.setAttribute('href', r.href || '#');
            if (r.style != null) r.el.setAttribute('style', r.style); else r.el.removeAttribute('style');
        });
        window.generatedPdfFile = filename;

        if (window.ACTIVITY_LOGS_ENABLED === true) {
            try {
                await authFetch(`${API_BASE_URL}/activity-logs/`, {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify({ action: 'report_generated_pdf', description: `Generated PDF receipt for student ${usn}` })
                });
            } catch (err) { /* non-blocking */ }
        }

        showMessage('PDF generated successfully!', false);
    } catch (e) {
        console.error('PDF generation failed', e);
        showMessage('Failed to generate PDF. See console for details.', true);
    }
}

// Function to open Gmail compose only if a PDF has already been downloaded
async function openGmailWithAttachment(event) {
    event?.preventDefault?.();
    const studentEmail = document.getElementById('studentEmail')?.textContent?.trim();
    const usn = document.getElementById('usn')?.textContent?.trim() || '';
    const studentName = document.getElementById('studentName')?.textContent?.trim() || '';
    if (!studentEmail || studentEmail === '#N/A') {
        showMessage('Student email is not available.', true);
        return;
    }
    if (!window.generatedPdfFile) {
        showMessage('Please download the PDF first.', true);
        return;
    }

    const subject = `Books Issued Receipt - ${studentName} (${usn})`;
    const body = `Dear ${studentName},\n\nAttached is your books issue receipt for USN ${usn}.\nThe attachment is named ${window.generatedPdfFile}.\nPlease keep this copy for your records.\n\nRegards,\nInventory Management System`;

    const gmailUrl = `https://mail.google.com/mail/?view=cm&fs=1&to=${encodeURIComponent(studentEmail)}&su=${encodeURIComponent(subject)}&body=${encodeURIComponent(body)}`;
    window.open(gmailUrl, '_blank');
    showMessage(`Opening Gmail for ${studentEmail}.`, false);
}

// ===========================================
// EVENT LISTENERS & INITIAL SETUP
// ===========================================
document.addEventListener("DOMContentLoaded", function() {
    // Assuming login status is checked on page load
    // checkLoginStatus(); 

    loadReceiptData();

    // Event listener for PDF button
    document.getElementById('generatePdfBtn')?.addEventListener('click', generatePdf);
    
    // Event listener for Go Back button
    document.getElementById('backToIssuePageBtn')?.addEventListener('click', () => {
        window.location.href = ISSUE_PAGE_URL;
    });
    
    // Event listener for student email
    document.getElementById('studentEmail')?.addEventListener('click', openGmailWithAttachment);
});