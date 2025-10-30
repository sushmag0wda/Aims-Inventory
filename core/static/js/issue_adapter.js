// core/static/js/issue_adapter.js
// Adapter to enable direct USN entry with a datalist and auto-pick unique dept options
(function(){
  document.addEventListener('DOMContentLoaded', function(){
    const STORAGE_KEY = 'issuePageState_v1';
    const readState = () => {
      try { return JSON.parse(sessionStorage.getItem(STORAGE_KEY) || '{}'); } catch(_) { return {}; }
    };
    const writeState = (state) => {
      try { sessionStorage.setItem(STORAGE_KEY, JSON.stringify(state || {})); } catch(_) {}
    };
    const captureState = () => {
      const state = readState();
      state.courseCode = document.getElementById('course-code')?.value || '';
      state.course = document.getElementById('course')?.value || '';
      state.academicYear = document.getElementById('academic-year')?.value || '';
      state.year = document.getElementById('year')?.value || '';
      state.usn = document.getElementById('usn')?.value || '';
      state.studentName = document.getElementById('studentName')?.value || '';
      writeState(state);
    };
    const applyState = () => {
      const state = readState();
      const codeSel = document.getElementById('course-code');
      const courseSel = document.getElementById('course');
      const academicYearSel = document.getElementById('academic-year');
      const yearSel = document.getElementById('year');
      const usnInput = document.getElementById('usn');
      const nameSel = document.getElementById('studentName');

      const setFromStateOrStudent = () => {
        // If saved values exist, use them; otherwise, derive from saved USN
        let code = state.courseCode || '';
        let course = state.course || '';
        let academicYear = state.academicYear || '';
        let year = state.year || '';
        if ((!code || !course) && state.usn && Array.isArray(window.allStudents)) {
          const s = window.allStudents.find(x => String(x.usn || '').toUpperCase() === String(state.usn || '').toUpperCase());
          if (s && s.department) {
            code = code || s.department.course_code || '';
            course = course || s.department.course || '';
            academicYear = academicYear || s.department.academic_year || '';
            // Respect user preference: Year only filled if previously saved; otherwise leave as-is
            if (!year) {
              // keep year unchanged if we already have a selected value in the DOM
              year = yearSel?.value || '';
            }
          }
        }

        if (codeSel && code) codeSel.value = code;
        if (courseSel && course) courseSel.value = course;
        if (academicYearSel && academicYear) academicYearSel.value = academicYear;
        if (yearSel && year) yearSel.value = year;
        if (typeof window.syncDepartmentDropdowns === 'function') window.syncDepartmentDropdowns();
        if (usnInput && state.usn) usnInput.value = state.usn;
        if (nameSel && state.studentName) nameSel.value = state.studentName;
        if (state.usn && typeof window.handleStudentSelection === 'function') {
          window.handleStudentSelection({ target: document.getElementById('usn') });
        }
      };

      // Wait until dropdowns are populated (options > 1) so setting value works
      let attempts = 0;
      const waitForOptions = () => {
        attempts++;
        const ready = !!codeSel && !!courseSel &&
          (codeSel.options && codeSel.options.length > 1) &&
          (courseSel.options && courseSel.options.length > 1);
        if (ready || attempts > 20) {
          setFromStateOrStudent();
        } else {
          setTimeout(waitForOptions, 100);
        }
      };
      waitForOptions();
    };
    // 1) Wrap populateStudentDropdowns to populate USN select or datalist (both supported)
    try {
      const originalPopulate = window.populateStudentDropdowns;
      window.populateStudentDropdowns = function(students){
        try {
          const usnInput = document.getElementById('usn');
          const nameSelect = document.getElementById('studentName');
          const isSelect = usnInput && usnInput.tagName === 'SELECT';
          const usnList = document.getElementById('usnList'); // if datalist exists
          if (isSelect) {
            // Populate select options
            usnInput.innerHTML = '<option value="">Select USN</option>';
          } else if (usnList) {
            // Populate datalist options
            usnList.innerHTML = '';
          }
          if (nameSelect) nameSelect.innerHTML = '<option value="">Select Name</option>';

          if (Array.isArray(students)) {
            students.forEach(s => {
              const usn = s.usn || '';
              const nm = s.name || '';
              if (isSelect) {
                const opt = document.createElement('option');
                opt.value = usn;
                opt.textContent = usn;
                usnInput.appendChild(opt);
              } else if (usnList) {
                const opt = document.createElement('option');
                opt.value = usn;
                usnList.appendChild(opt);
              }
              if (nameSelect) {
                const opt2 = document.createElement('option');
                opt2.value = usn;
                opt2.textContent = nm;
                nameSelect.appendChild(opt2);
              }
            });
          }
        } catch (e) {}
        // Do not call originalPopulate; we fully handle both cases
      };
    } catch(_) {}

    // 2) USN interactions: support both <select> and <input list>
    try {
      const usnInput = document.getElementById('usn');
      if (usnInput) {
        if (usnInput.tagName === 'SELECT') {
          usnInput.addEventListener('change', (e) => {
            if (typeof window.handleStudentSelection === 'function') {
              window.handleStudentSelection(e);
            }
            captureState();
          });
        } else {
          // Input with datalist
          const isKnownUsn = (val) => {
            const list = document.getElementById('usnList');
            let known = false;
            if (list) {
              const opts = Array.from(list.options || []);
              known = opts.some(o => String(o.value).toUpperCase() === val);
            }
            if (!known && Array.isArray(window.allStudents)) {
              known = window.allStudents.some(s => String(s.usn || '').toUpperCase() === val);
            }
            return known;
          };
          const notifyInvalid = () => {
            const msg = window.showMessage || ((m)=>alert(m));
            msg('Invalid USN');
          };
          let lastInvalidValue = '';

          usnInput.addEventListener('input', () => {
            const pos = usnInput.selectionStart;
            usnInput.value = (usnInput.value || '').toUpperCase();
            try { usnInput.setSelectionRange(pos, pos); } catch(_) {}
            try {
              const val = usnInput.value.trim().toUpperCase();
              if (!val) return;
              const isKnown = isKnownUsn(val);
              if (isKnown && typeof window.handleStudentSelection === 'function') {
                window.handleStudentSelection({ target: usnInput });
                captureState();
                lastInvalidValue = '';
              } else {
                // Immediate invalid feedback after minimal length to avoid noisy typing
                if (val.length >= 4 && val !== lastInvalidValue) {
                  notifyInvalid();
                  lastInvalidValue = val;
                }
              }
            } catch(_) {}
          });
          usnInput.addEventListener('keydown', (e) => {
            if (e.key === 'Enter') {
              e.preventDefault();
              const val = (usnInput.value || '').trim().toUpperCase();
              if (!val || !isKnownUsn(val)) { notifyInvalid(); return; }
              if (typeof window.handleStudentSelection === 'function') {
                window.handleStudentSelection({ target: usnInput });
              }
            }
          });
          usnInput.addEventListener('blur', () => {
            const val = (usnInput.value || '').trim().toUpperCase();
            if (!val) return;
            if (!isKnownUsn(val)) {
              notifyInvalid();
              lastInvalidValue = val;
            }
          });
          usnInput.addEventListener('change', (e) => {
            const val = (usnInput.value || '').trim().toUpperCase();
            if (!val || !isKnownUsn(val)) { notifyInvalid(); usnInput.value=''; captureState(); return; }
            if (typeof window.handleStudentSelection === 'function') {
              window.handleStudentSelection(e);
            }
            captureState();
          });
        }
      }
    } catch(_) {}

    // 3) Post-process department sync to auto-pick unique options from current option lists
    try {
      const originalSync = window.syncDepartmentDropdowns;
      window.syncDepartmentDropdowns = function(){
        if (typeof originalSync === 'function') originalSync();
        let changed = false;
        const codeSelect = document.getElementById('course-code');
        const courseSelect = document.getElementById('course');
        const yearSelect = document.getElementById('year');
        const autoPick = (sel) => {
          if (!sel) return false;
          if (sel.value) return false;
          const nonEmpty = Array.from(sel.options || []).filter(o => o.value && o.value.trim() !== '');
          if (nonEmpty.length === 1) {
            sel.value = nonEmpty[0].value;
            return true;
          }
          return false;
        };
        changed = autoPick(codeSelect) || changed;
        changed = autoPick(courseSelect) || changed;
        // Do not auto-pick Year; user must choose it explicitly
        if (changed && typeof originalSync === 'function') {
          // Re-run once to refresh dependent lists and table
          originalSync();
        }
        captureState();
      };
    } catch(_) {}

    // 4) Mutual auto-selection on change: if you choose Code and Course is empty -> pick first available Course (and vice versa)
    try {
      const codeSelect = document.getElementById('course-code');
      const courseSelect = document.getElementById('course');
      const yearSelect = document.getElementById('year');
      const pickFirstNonEmpty = (sel) => {
        if (!sel) return false;
        if (sel.value) return false;
        const nonEmpty = Array.from(sel.options || []).map(o => o.value).filter(v => v && v.trim() !== '');
        if (nonEmpty.length > 0) { sel.value = nonEmpty[0]; return true; }
        return false;
      };

      codeSelect?.addEventListener('change', () => {
        // Let original sync run first
        if (typeof window.syncDepartmentDropdowns === 'function') window.syncDepartmentDropdowns();
        // If Course empty, pick first available
        const changed = pickFirstNonEmpty(courseSelect);
        // Do not auto-pick Year
        if (changed && typeof window.syncDepartmentDropdowns === 'function') window.syncDepartmentDropdowns();
        captureState();
      });

      courseSelect?.addEventListener('change', () => {
        if (typeof window.syncDepartmentDropdowns === 'function') window.syncDepartmentDropdowns();
        const changed = pickFirstNonEmpty(codeSelect);
        // Do not auto-pick Year
        if (changed && typeof window.syncDepartmentDropdowns === 'function') window.syncDepartmentDropdowns();
        captureState();
      });
    } catch(_) {}

    // Persist on studentName and other filter selections as well
    try {
      document.getElementById('studentName')?.addEventListener('change', captureState);
      document.getElementById('year')?.addEventListener('change', captureState);
      document.getElementById('academic-year')?.addEventListener('change', captureState);
    } catch(_) {}

    // Restore state after initial data loads
    // Use two passes: immediate, then after a short delay to ensure lists are populated
    try {
      applyState();
      setTimeout(applyState, 400);
    } catch(_) {}
  });
})();
