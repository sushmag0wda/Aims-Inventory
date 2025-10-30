// core/static/js/students_filters.js
// Auto-synced student filters: Course Code ↔ Course ↔ Academic Year ↔ Year
// Works with departmentsData and students.js globals

(function () {
  // ========== Helper: Get CSRF token ==========
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

  // ========== Helper: Normalize strings ==========
  const norm = (v) => String(v || '').trim().toUpperCase();

  // ========== Helper: Fetch departments safely ==========
  function getDepartments() {
    try {
      if (Array.isArray(window.departmentsData)) return window.departmentsData;
    } catch (_) {}
    try {
      if (Array.isArray(departmentsData)) return departmentsData;
    } catch (_) {}
    return [];
  }

  // ========== Main Filter Sync Function ==========
  function syncFilterDropdowns() {
    const codeSelect = document.getElementById('filter-code');
    const courseSelect = document.getElementById('filter-course');
    const yearSelect = document.getElementById('filter-year');
    const academicYearSelect = document.getElementById('filter-academic-year');

    if (!codeSelect || !courseSelect || !yearSelect || !academicYearSelect) return;

    let code = codeSelect.value;
    let course = courseSelect.value;
    let year = yearSelect.value;
    let academicYear = academicYearSelect.value;

    const allDepts = getDepartments();

    // Helper to populate dropdowns
    function updateSelect(select, values, selected, label) {
      select.innerHTML = `<option value="">${label}</option>`;
      const unique = [...new Set(values.filter(v => v))];
      unique.sort((a, b) => String(a).localeCompare(String(b), undefined, { numeric: true }));
      unique.forEach(v => {
        const opt = document.createElement("option");
        opt.value = v;
        opt.textContent = v;
        select.appendChild(opt);
      });
      if (unique.includes(selected)) select.value = selected;
    }

    // Reset dependent dropdowns when parent filters change
    function resetDropdowns() {
      academicYearSelect.innerHTML = `<option value="">All Academic Years</option>`;
      yearSelect.innerHTML = `<option value="">All Years</option>`;
    }

    // ---- 1️⃣ Handle Course Code change ----
    if (codeSelect.dataset.lastValue !== code) {
      codeSelect.dataset.lastValue = code;
      resetDropdowns();
    }

    // ---- 2️⃣ Handle Course change ----
    if (courseSelect.dataset.lastValue !== course) {
      courseSelect.dataset.lastValue = course;
      resetDropdowns();
    }

    // ---- 3️⃣ Filter and update Course based on Course Code ----
    const codeFiltered = allDepts.filter(d =>
      !code || String(d.course_code) === String(code)
    );
    updateSelect(courseSelect, codeFiltered.map(d => d.course), course, "All Courses");

    // Auto-select Course if only one
    const possibleCourses = [...new Set(codeFiltered.map(d => d.course))];
    if (code && possibleCourses.length === 1) {
      course = possibleCourses[0];
      courseSelect.value = course;
    }

    // ---- 4️⃣ Filter Academic Years based on Course Code + Course ----
    const courseFiltered = allDepts.filter(d =>
      (!code || String(d.course_code) === String(code)) &&
      (!course || String(d.course) === String(course))
    );
    updateSelect(academicYearSelect, courseFiltered.map(d => d.academic_year), academicYear, "All Academic Years");

    // Auto-select Academic Year if only one
    const possibleAYs = [...new Set(courseFiltered.map(d => d.academic_year))];
    if (code && course && possibleAYs.length === 1) {
      academicYear = possibleAYs[0];
      academicYearSelect.value = academicYear;
    }

    // ---- 5️⃣ Filter Years based on Course Code + Course + Academic Year ----
    const yearFiltered = allDepts.filter(d =>
      (!code || String(d.course_code) === String(code)) &&
      (!course || String(d.course) === String(course)) &&
      (!academicYear || String(d.academic_year) === String(academicYear))
    );
    updateSelect(yearSelect, yearFiltered.map(d => String(d.year)), year, "All Years");

    // Auto-select Year if only one
    const possibleYears = [...new Set(yearFiltered.map(d => String(d.year)))];
    if (code && course && academicYear && possibleYears.length === 1) {
      year = possibleYears[0];
      yearSelect.value = year;
    }

    // ---- 6️⃣ Refresh Student Table ----
    if (typeof window.filterStudentTable === "function") {
      window.filterStudentTable();
    }
  }

  // ========== Initialize and attach listeners ==========
  document.addEventListener("DOMContentLoaded", function () {
    // Wait for departmentsData to load
    const retry = setInterval(() => {
      const depts = getDepartments();
      if (depts && depts.length > 0) {
        clearInterval(retry);
        syncFilterDropdowns();

        // Auto-update when any dropdown changes
        ['filter-code', 'filter-course', 'filter-year', 'filter-academic-year'].forEach(id => {
          const el = document.getElementById(id);
          if (el) el.addEventListener('change', syncFilterDropdowns);
        });
      }
    }, 300);

    // Stop trying after 5 seconds
    setTimeout(() => clearInterval(retry), 5000);
  });

  // ========== Optional: Delete All Students ==========
  const deleteAllBtn = document.getElementById('deleteAllStudentsBtn');
  if (deleteAllBtn) {
    deleteAllBtn.addEventListener('click', async () => {
      if (!confirm('Delete ALL students? This cannot be undone.')) return;
      deleteAllBtn.disabled = true;
      deleteAllBtn.textContent = 'Deleting...';
      try {
        const students = Array.isArray(window.allStudents) ? window.allStudents : [];
        if (students.length === 0) {
          alert('No students loaded. Please refresh and try again.');
        } else {
          for (const s of students) {
            if (!s || !s.usn) continue;
            await fetch(`/api/students/${encodeURIComponent(s.usn)}/`, {
              method: 'DELETE',
              headers: { 'X-CSRFToken': getCookie('csrftoken') }
            });
          }
          if (typeof window.fetchStudents === 'function') {
            await window.fetchStudents();
          }
          if (typeof window.filterStudentTable === 'function') window.filterStudentTable();
          alert('All students deleted.');
        }
      } catch (e) {
        console.error('Bulk delete failed', e);
        alert('Bulk delete failed. Check console for details.');
      } finally {
        deleteAllBtn.disabled = false;
        deleteAllBtn.textContent = 'Delete All Students';
      }
    });
  }
})();
