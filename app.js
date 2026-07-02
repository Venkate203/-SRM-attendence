/* ============================================================
   SRM COLLEGE OF PHARMACY - ATTENDANCE PWA
   Offline-first, localStorage + IndexedDB, mobile-first
   Author: SRM College of Pharmacy
============================================================ */
(() => {
'use strict';

/* -------------------- CONSTANTS -------------------- */
const LS_KEY = 'srm_att_v1';
const AUTH_KEY = 'srm_auth_v1';
const SESSION_KEY = 'srm_session_v1';

const PROGRAMS = [
  'Pharm.D',
  'M.Pharm',
  'Pharm.D Post Baccalaureate'
];

const YEARS_BY_PROGRAM = {
  'Pharm.D': [
    'First Year Pharm.D',
    'Second Year Pharm.D',
    'Third Year Pharm.D',
    'Fourth Year Pharm.D',
    'Fifth Year Pharm.D',
    'Sixth Year Pharm.D Internship'
  ],
  'M.Pharm': ['M.Pharm First Year', 'M.Pharm Second Year'],
  'Pharm.D Post Baccalaureate': [
    'Pharm.D Post Baccalaureate First Year',
    'Pharm.D Post Baccalaureate Second Year',
    'Pharm.D Post Baccalaureate Third Year'
  ]
};

const DAYS = ['Monday','Tuesday','Wednesday','Thursday','Friday','Saturday','Sunday'];

const DEFAULT_DEPARTMENTS = [
  'General Medicine','Cardiology','Dermatology','Ophthalmology','Neurology',
  'Psychiatry','Orthopaedics','Nephrology','Oncology','Pediatrics',
  'Respiratory Medicine','Gastroenterology','Urology','Emergency Medicine',
  'ICU','Surgical Ward'
];

/* -------------------- STATE -------------------- */
const state = {
  students: [],
  attendance: [],
  departments: [...DEFAULT_DEPARTMENTS],
  currentSession: {},      // { program, year, department, day, date, marks: { studentId: 'present'|'absent' } }
  darkMode: false,
  currentPage: 'attendance',
  installEvent: null
};

/* -------------------- UTILS -------------------- */
const $ = (id) => document.getElementById(id);
const escapeHTML = (str) => {
  if (str == null) return '';
  return String(str).replace(/[&<>"']/g, (m) => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[m]));
};
const genId = () => Date.now().toString(36) + Math.random().toString(36).slice(2, 8);
const todayISO = () => new Date().toISOString().slice(0,10);
const dayFromDate = (iso) => {
  if (!iso) return '';
  const d = new Date(iso + 'T00:00:00');
  return DAYS[(d.getDay() + 6) % 7];
};
const toast = (msg, type = '') => {
  const el = $('toast');
  el.textContent = msg;
  el.className = 'toast show ' + type;
  clearTimeout(toast._t);
  toast._t = setTimeout(() => { el.className = 'toast'; }, 2400);
};

// Simple hash for password (client-side; NOT cryptographic but sufficient for local PWA)
const simpleHash = async (str) => {
  const enc = new TextEncoder().encode(str + '::srm-salt-2026');
  const buf = await crypto.subtle.digest('SHA-256', enc);
  return Array.from(new Uint8Array(buf)).map(b => b.toString(16).padStart(2,'0')).join('');
};

/* -------------------- STORAGE -------------------- */
function saveState() {
  try {
    const data = {
      students: state.students,
      attendance: state.attendance,
      departments: state.departments,
      darkMode: state.darkMode
    };
    localStorage.setItem(LS_KEY, JSON.stringify(data));
  } catch (e) {
    console.error('Save failed', e);
    toast('Storage full or unavailable', 'error');
  }
}
function loadState() {
  try {
    const raw = localStorage.getItem(LS_KEY);
    if (!raw) return;
    const data = JSON.parse(raw);
    state.students = data.students || [];
    state.attendance = data.attendance || [];
    state.departments = data.departments && data.departments.length ? data.departments : [...DEFAULT_DEPARTMENTS];
    state.darkMode = !!data.darkMode;
  } catch (e) { console.warn('Load failed', e); }
}

/* -------------------- AUTH -------------------- */
async function initAuth() {
  const authRaw = localStorage.getItem(AUTH_KEY);
  if (!authRaw) {
    const hash = await simpleHash('srm@2026');
    localStorage.setItem(AUTH_KEY, JSON.stringify({ username: 'admin', hash }));
  }
}
async function tryLogin(username, password) {
  const raw = localStorage.getItem(AUTH_KEY);
  if (!raw) return false;
  const stored = JSON.parse(raw);
  if (username.trim().toLowerCase() !== stored.username.toLowerCase()) return false;
  const hash = await simpleHash(password);
  return hash === stored.hash;
}
async function changePassword(oldPass, newPass) {
  const raw = localStorage.getItem(AUTH_KEY);
  const stored = JSON.parse(raw);
  const oldHash = await simpleHash(oldPass);
  if (oldHash !== stored.hash) return false;
  stored.hash = await simpleHash(newPass);
  localStorage.setItem(AUTH_KEY, JSON.stringify(stored));
  return true;
}
function isLoggedIn() { return sessionStorage.getItem(SESSION_KEY) === '1'; }
function setLoggedIn(v) {
  if (v) sessionStorage.setItem(SESSION_KEY, '1');
  else sessionStorage.removeItem(SESSION_KEY);
}

/* -------------------- SELECT POPULATION -------------------- */
function fillSelect(el, options, { includeAll = true, allLabel = 'All' } = {}) {
  const current = el.value;
  el.innerHTML = '';
  if (includeAll) {
    const o = document.createElement('option');
    o.value = ''; o.textContent = allLabel;
    el.appendChild(o);
  }
  options.forEach((opt) => {
    const o = document.createElement('option');
    o.value = opt; o.textContent = opt;
    el.appendChild(o);
  });
  if ([...el.options].some(o => o.value === current)) el.value = current;
}

function populateFilters() {
  fillSelect($('fProgram'), PROGRAMS, { includeAll: false });
  fillSelect($('sProgram'), PROGRAMS);
  const currentProgram = $('fProgram').value || PROGRAMS[0];
  $('fProgram').value = currentProgram;
  fillSelect($('fYear'), YEARS_BY_PROGRAM[currentProgram] || [], { includeAll: false });
  const allYears = Object.values(YEARS_BY_PROGRAM).flat();
  fillSelect($('sYear'), allYears);
  fillSelect($('fDepartment'), state.departments, { includeAll: false });
  fillSelect($('sDepartment'), state.departments);
  fillSelect($('fDay'), DAYS, { includeAll: false });

  if (!$('fDate').value) $('fDate').value = todayISO();
  const day = dayFromDate($('fDate').value);
  if (day) $('fDay').value = day;
}

/* -------------------- ATTENDANCE PAGE -------------------- */
function currentFilters() {
  return {
    program: $('fProgram').value,
    year: $('fYear').value,
    department: $('fDepartment').value,
    day: $('fDay').value,
    date: $('fDate').value,
    search: $('fSearch').value.trim().toLowerCase()
  };
}
function filteredStudents() {
  const f = currentFilters();
  return state.students.filter(s =>
    (!f.program || s.program === f.program) &&
    (!f.year || s.year === f.year) &&
    (!f.department || s.department === f.department || !s.department) &&
    (!f.day || s.day === f.day || !s.day) &&
    (!f.search ||
      s.studentName.toLowerCase().includes(f.search) ||
      s.registerNumber.toLowerCase().includes(f.search))
  );
}
function ensureSessionMarks() {
  const f = currentFilters();
  const key = `${f.program}|${f.year}|${f.department}|${f.day}|${f.date}`;
  if (state.currentSession.key !== key) {
    state.currentSession = { ...f, key, marks: {} };
    // Prefill from existing saved session (same key)
    const existing = state.attendance.find(a => a.key === key);
    if (existing) state.currentSession.marks = { ...existing.marks };
  }
}
function renderAttendance() {
  ensureSessionMarks();
  const list = filteredStudents();
  const container = $('studentList');
  container.innerHTML = '';
  if (list.length === 0) {
    container.innerHTML = `<div class="student-card" style="justify-content:center;color:var(--text-muted);text-align:center;">
      No students found for these filters.<br/><small>Add students in the Students tab or adjust filters.</small></div>`;
    updateSummary();
    return;
  }
  const frag = document.createDocumentFragment();
  list.forEach((s) => {
    const marked = state.currentSession.marks[s.id];
    const isPresent = marked === 'present';
    const card = document.createElement('div');
    card.className = 'student-card';
    card.innerHTML = `
      <div class="student-info">
        <div class="student-name">${escapeHTML(s.studentName)}</div>
        <div class="student-reg">${escapeHTML(s.registerNumber)}</div>
      </div>
      <div class="toggle-wrap">
        <span class="toggle-state ${isPresent ? 'present' : 'absent'}" data-state>${isPresent ? 'Present' : 'Absent'}</span>
        <label class="switch">
          <input type="checkbox" data-toggle data-id="${escapeHTML(s.id)}" ${isPresent ? 'checked' : ''} />
          <span class="slider"></span>
        </label>
      </div>`;
    frag.appendChild(card);
  });
  container.appendChild(frag);
  updateSummary();
}
function updateSummary() {
  const list = filteredStudents();
  const total = list.length;
  const present = list.filter(s => state.currentSession.marks[s.id] === 'present').length;
  const absent = total - present;
  const pct = total ? ((present / total) * 100).toFixed(1) : '0.0';
  $('sumPresent').textContent = present;
  $('sumAbsent').textContent = absent;
  $('sumPct').textContent = pct + '%';
}
function markAll(status) {
  const list = filteredStudents();
  list.forEach(s => { state.currentSession.marks[s.id] = status; });
  renderAttendance();
}
function saveAttendance() {
  ensureSessionMarks();
  const f = state.currentSession;
  if (!f.program || !f.year || !f.department || !f.day || !f.date) {
    return toast('Please complete all filters', 'error');
  }
  const list = filteredStudents();
  if (list.length === 0) return toast('No students to save', 'error');
  // Ensure every visible student has a mark (default absent)
  list.forEach(s => { if (!f.marks[s.id]) f.marks[s.id] = 'absent'; });
  const total = list.length;
  const present = list.filter(s => f.marks[s.id] === 'present').length;
  const session = {
    id: genId(),
    key: f.key,
    program: f.program, year: f.year, department: f.department,
    day: f.day, date: f.date,
    marks: { ...f.marks },
    studentIds: list.map(s => s.id),
    total, present, absent: total - present,
    pct: total ? +((present / total) * 100).toFixed(2) : 0,
    savedAt: new Date().toISOString()
  };
  // Replace prior same-key session
  state.attendance = state.attendance.filter(a => a.key !== f.key);
  state.attendance.unshift(session);
  saveState();
  toast('Attendance saved', 'success');
  renderHistory();
  renderReportsStats();
}

/* -------------------- STUDENTS PAGE -------------------- */
function renderStudents() {
  const search = $('sSearch').value.trim().toLowerCase();
  const prog = $('sProgram').value;
  const yr = $('sYear').value;
  const dept = $('sDepartment').value;
  const list = state.students.filter(s =>
    (!prog || s.program === prog) &&
    (!yr || s.year === yr) &&
    (!dept || s.department === dept) &&
    (!search || s.studentName.toLowerCase().includes(search) || s.registerNumber.toLowerCase().includes(search))
  );
  const container = $('studentsList');
  container.innerHTML = '';
  if (list.length === 0) {
    container.innerHTML = `<div class="student-card" style="justify-content:center;color:var(--text-muted);text-align:center;">
      No students yet.<br/><small>Tap "+ Add" or "Import" to add students.</small></div>`;
    return;
  }
  const frag = document.createDocumentFragment();
  list.forEach(s => {
    const card = document.createElement('div');
    card.className = 'student-card';
    card.innerHTML = `
      <div class="student-info">
        <div class="student-name">${escapeHTML(s.studentName)}</div>
        <div class="student-reg">${escapeHTML(s.registerNumber)}</div>
        <div class="student-meta">${escapeHTML(s.program)} · ${escapeHTML(s.year)}</div>
        <div class="student-meta">${escapeHTML(s.department || '—')} · ${escapeHTML(s.day || '—')}</div>
      </div>
      <div class="student-actions">
        <button class="mini-btn" data-edit="${escapeHTML(s.id)}">Edit</button>
        <button class="mini-btn danger" data-del="${escapeHTML(s.id)}">Del</button>
      </div>`;
    frag.appendChild(card);
  });
  container.appendChild(frag);
}

function studentFormModal(existing = null) {
  const s = existing || { id: '', registerNumber: '', studentName: '', program: PROGRAMS[0], year: YEARS_BY_PROGRAM[PROGRAMS[0]][0], department: state.departments[0] || '', day: DAYS[0] };
  const yearOpts = YEARS_BY_PROGRAM[s.program] || Object.values(YEARS_BY_PROGRAM).flat();
  openModal(`
    <h3>${existing ? 'Edit' : 'Add'} Student</h3>
    <label>Register Number</label>
    <input id="mRegNo" value="${escapeHTML(s.registerNumber)}" required />
    <label style="margin-top:10px;">Student Name</label>
    <input id="mName" value="${escapeHTML(s.studentName)}" required />
    <label style="margin-top:10px;">Program</label>
    <select id="mProgram">${PROGRAMS.map(p => `<option ${p===s.program?'selected':''}>${escapeHTML(p)}</option>`).join('')}</select>
    <label style="margin-top:10px;">Year</label>
    <select id="mYear">${yearOpts.map(y => `<option ${y===s.year?'selected':''}>${escapeHTML(y)}</option>`).join('')}</select>
    <label style="margin-top:10px;">Department</label>
    <select id="mDept"><option value="">—</option>${state.departments.map(d => `<option ${d===s.department?'selected':''}>${escapeHTML(d)}</option>`).join('')}</select>
    <label style="margin-top:10px;">Day</label>
    <select id="mDay"><option value="">—</option>${DAYS.map(d => `<option ${d===s.day?'selected':''}>${escapeHTML(d)}</option>`).join('')}</select>
    <div class="modal-actions">
      <button class="btn-secondary" data-close>Cancel</button>
      <button class="btn-primary" id="mSave">${existing ? 'Update' : 'Add'}</button>
    </div>
  `);
  $('mProgram').addEventListener('change', (e) => {
    const opts = YEARS_BY_PROGRAM[e.target.value] || [];
    $('mYear').innerHTML = opts.map(y => `<option>${escapeHTML(y)}</option>`).join('');
  });
  $('mSave').addEventListener('click', () => {
    const regNo = $('mRegNo').value.trim();
    const name = $('mName').value.trim();
    if (!regNo || !name) return toast('Register No and Name required', 'error');
    const dup = state.students.find(x => x.registerNumber.toLowerCase() === regNo.toLowerCase() && x.id !== s.id);
    if (dup) return toast('Register Number already exists', 'error');
    const obj = {
      id: existing ? s.id : genId(),
      registerNumber: regNo,
      studentName: name,
      program: $('mProgram').value,
      year: $('mYear').value,
      department: $('mDept').value,
      day: $('mDay').value
    };
    if (existing) {
      const i = state.students.findIndex(x => x.id === s.id);
      state.students[i] = obj;
    } else {
      state.students.push(obj);
    }
    saveState();
    closeModal();
    renderStudents(); renderAttendance(); renderReportsStats();
    toast(existing ? 'Student updated' : 'Student added', 'success');
  });
}
function deleteStudent(id) {
  confirmModal('Delete this student? This will not remove past attendance history.', () => {
    state.students = state.students.filter(s => s.id !== id);
    saveState();
    renderStudents(); renderAttendance(); renderReportsStats();
    toast('Student deleted');
  });
}

/* -------------------- BULK IMPORT/EXPORT -------------------- */
function handleImport(file) {
  const reader = new FileReader();
  reader.onload = (e) => {
    try {
      let rows = [];
      if (file.name.toLowerCase().endsWith('.csv')) {
        rows = parseCSV(e.target.result);
      } else {
        const wb = XLSX.read(e.target.result, { type: 'binary' });
        const sheet = wb.Sheets[wb.SheetNames[0]];
        rows = XLSX.utils.sheet_to_json(sheet, { defval: '' });
      }
      importRows(rows);
    } catch (err) {
      console.error(err); toast('Import failed: ' + err.message, 'error');
    }
  };
  if (file.name.toLowerCase().endsWith('.csv')) reader.readAsText(file);
  else reader.readAsBinaryString(file);
}
function parseCSV(text) {
  const lines = text.replace(/\r/g,'').split('\n').filter(l => l.trim());
  if (lines.length < 2) return [];
  const headers = splitCSVLine(lines[0]).map(h => h.trim());
  return lines.slice(1).map(l => {
    const cells = splitCSVLine(l);
    const o = {};
    headers.forEach((h, i) => { o[h] = (cells[i] || '').trim(); });
    return o;
  });
}
function splitCSVLine(line) {
  const out = []; let cur = ''; let inQ = false;
  for (let i = 0; i < line.length; i++) {
    const c = line[i];
    if (c === '"') { if (inQ && line[i+1] === '"') { cur += '"'; i++; } else inQ = !inQ; }
    else if (c === ',' && !inQ) { out.push(cur); cur = ''; }
    else cur += c;
  }
  out.push(cur); return out;
}
function normalizeKey(k) { return String(k).toLowerCase().replace(/[\s_-]/g, ''); }
function importRows(rows) {
  const KEYMAP = {
    registernumber: 'registerNumber', regno: 'registerNumber', register: 'registerNumber',
    studentname: 'studentName', name: 'studentName',
    program: 'program', year: 'year', department: 'department', day: 'day'
  };
  let added = 0, skipped = 0;
  rows.forEach(row => {
    const obj = {};
    Object.keys(row).forEach(k => {
      const nk = KEYMAP[normalizeKey(k)];
      if (nk) obj[nk] = String(row[k]).trim();
    });
    if (!obj.registerNumber || !obj.studentName) { skipped++; return; }
    if (state.students.some(s => s.registerNumber.toLowerCase() === obj.registerNumber.toLowerCase())) { skipped++; return; }
    // Auto-add unknown departments
    if (obj.department && !state.departments.includes(obj.department)) state.departments.push(obj.department);
    state.students.push({
      id: genId(),
      registerNumber: obj.registerNumber,
      studentName: obj.studentName,
      program: obj.program || PROGRAMS[0],
      year: obj.year || (YEARS_BY_PROGRAM[obj.program || PROGRAMS[0]] || [''])[0],
      department: obj.department || '',
      day: obj.day || ''
    });
    added++;
  });
  saveState(); populateFilters(); renderStudents(); renderAttendance(); renderReportsStats();
  toast(`Imported ${added}, skipped ${skipped}`, added ? 'success' : 'error');
}
function exportStudentsXlsx() {
  if (!state.students.length) return toast('No students to export', 'error');
  const rows = state.students.map(s => ({
    'Register Number': s.registerNumber, 'Student Name': s.studentName,
    'Program': s.program, 'Year': s.year, 'Department': s.department, 'Day': s.day
  }));
  const ws = XLSX.utils.json_to_sheet(rows);
  const wb = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(wb, ws, 'Students');
  XLSX.writeFile(wb, `SRM_Students_${todayISO()}.xlsx`);
}

/* -------------------- HISTORY -------------------- */
function renderHistory() {
  const container = $('historyList');
  container.innerHTML = '';
  if (state.attendance.length === 0) {
    container.innerHTML = `<div class="history-card" style="text-align:center;color:var(--text-muted);">
      No sessions yet.<br/><small>Save attendance to create your first session.</small></div>`;
    return;
  }
  const sorted = [...state.attendance].sort((a,b) => (b.date + b.savedAt).localeCompare(a.date + a.savedAt));
  const frag = document.createDocumentFragment();
  sorted.forEach(a => {
    const card = document.createElement('div');
    card.className = 'history-card';
    card.dataset.id = a.id;
    card.innerHTML = `
      <div class="history-title">${escapeHTML(a.department)} · ${escapeHTML(a.year)}</div>
      <div class="history-meta">${escapeHTML(a.date)} · ${escapeHTML(a.day)} · ${escapeHTML(a.program)}</div>
      <div class="history-stats">
        <span class="present">Present ${a.present}</span>
        <span class="absent">Absent ${a.absent}</span>
        <span class="pct">${a.pct.toFixed(1)}%</span>
      </div>`;
    card.addEventListener('click', () => openSessionDetails(a.id));
    frag.appendChild(card);
  });
  container.appendChild(frag);
}
function openSessionDetails(id) {
  const s = state.attendance.find(x => x.id === id);
  if (!s) return;
  const students = s.studentIds
    .map(sid => state.students.find(x => x.id === sid))
    .filter(Boolean);
  const rowsHtml = students.map(st => {
    const status = s.marks[st.id] === 'present' ? 'Present' : 'Absent';
    const cls = s.marks[st.id] === 'present' ? 'present' : 'absent';
    return `<tr><td>${escapeHTML(st.studentName)}</td><td>${escapeHTML(st.registerNumber)}</td><td class="${cls}">${status}</td></tr>`;
  }).join('');
  openModal(`
    <h3>Session Details</h3>
    <div class="history-meta">${escapeHTML(s.date)} · ${escapeHTML(s.day)} · ${escapeHTML(s.department)}</div>
    <div class="history-meta">${escapeHTML(s.program)} · ${escapeHTML(s.year)}</div>
    <div class="history-stats" style="margin:10px 0;">
      <span class="present">Present ${s.present}</span>
      <span class="absent">Absent ${s.absent}</span>
      <span class="pct">${s.pct.toFixed(1)}%</span>
    </div>
    <div style="overflow-x:auto;max-height:45vh;overflow-y:auto;">
      <table style="width:100%;border-collapse:collapse;font-size:13px;">
        <thead><tr><th style="text-align:left;padding:6px;">Name</th><th style="text-align:left;padding:6px;">Reg No</th><th style="text-align:left;padding:6px;">Status</th></tr></thead>
        <tbody>${rowsHtml || '<tr><td colspan="3" style="text-align:center;color:var(--text-muted);padding:12px;">No students</td></tr>'}</tbody>
      </table>
    </div>
    <div class="modal-actions" style="flex-wrap:wrap;">
      <button class="btn-secondary" data-close>Close</button>
      <button class="btn-secondary" id="sPdf">PDF</button>
      <button class="btn-secondary" id="sXlsx">Excel</button>
      <button class="btn-secondary" id="sPrint">Print</button>
      <button class="btn-secondary danger" id="sDelete" style="color:var(--danger);">Delete</button>
    </div>
  `);
  $('sPdf').addEventListener('click', () => exportSessionPdf(s));
  $('sXlsx').addEventListener('click', () => exportSessionXlsx(s));
  $('sPrint').addEventListener('click', () => printSession(s));
  $('sDelete').addEventListener('click', () => {
    confirmModal('Delete this session?', () => {
      state.attendance = state.attendance.filter(x => x.id !== id);
      saveState(); closeModal(); renderHistory(); renderReportsStats();
      toast('Session deleted');
    });
  });
}

/* -------------------- EXPORTS -------------------- */
function currentSessionExportData() {
  const list = filteredStudents();
  const marks = state.currentSession.marks || {};
  return {
    program: state.currentSession.program, year: state.currentSession.year,
    department: state.currentSession.department, day: state.currentSession.day,
    date: state.currentSession.date,
    students: list, marks
  };
}
function exportCurrentPdf() {
  const d = currentSessionExportData();
  if (!d.students.length) return toast('Nothing to export', 'error');
  buildPdf(d);
}
function exportSessionPdf(s) {
  const students = s.studentIds.map(id => state.students.find(x => x.id === id)).filter(Boolean);
  buildPdf({ ...s, students, marks: s.marks });
}
function buildPdf(d) {
  const { jsPDF } = window.jspdf;
  const doc = new jsPDF({ unit: 'pt', format: 'a4' });
  const present = d.students.filter(s => d.marks[s.id] === 'present').length;
  const pct = d.students.length ? ((present / d.students.length) * 100).toFixed(1) : '0.0';
  doc.setFontSize(16); doc.setFont(undefined, 'bold');
  doc.text('SRM College of Pharmacy', 40, 40);
  doc.setFontSize(11); doc.setFont(undefined, 'normal');
  doc.text('Attendance Report', 40, 58);
  doc.setFontSize(10);
  const meta = [
    `Program: ${d.program || '—'}`, `Year: ${d.year || '—'}`,
    `Department: ${d.department || '—'}`, `Day: ${d.day || '—'}`,
    `Date: ${d.date || '—'}`,
    `Present: ${present} / ${d.students.length}  (${pct}%)`
  ];
  meta.forEach((m, i) => doc.text(m, 40, 80 + i * 14));
  doc.autoTable({
    startY: 175,
    head: [['#', 'Register No', 'Student Name', 'Status']],
    body: d.students.map((s, i) => [
      i + 1, s.registerNumber, s.studentName,
      d.marks[s.id] === 'present' ? 'Present' : 'Absent'
    ]),
    styles: { fontSize: 9, cellPadding: 4 },
    headStyles: { fillColor: [13, 148, 136], textColor: 255 },
    alternateRowStyles: { fillColor: [246, 248, 250] }
  });
  const y = (doc.lastAutoTable?.finalY || 200) + 40;
  doc.text('Faculty Signature: ____________________________', 40, y);
  doc.text('Date: ____________________', 40, y + 20);
  doc.save(`SRM_Attendance_${d.date || todayISO()}_${(d.department||'').replace(/\s+/g,'_')}.pdf`);
}
function exportCurrentXlsx() {
  const d = currentSessionExportData();
  if (!d.students.length) return toast('Nothing to export', 'error');
  buildXlsx(d);
}
function exportSessionXlsx(s) {
  const students = s.studentIds.map(id => state.students.find(x => x.id === id)).filter(Boolean);
  buildXlsx({ ...s, students, marks: s.marks });
}
function buildXlsx(d) {
  const rows = d.students.map((s, i) => ({
    'S.No': i + 1, 'Register Number': s.registerNumber, 'Student Name': s.studentName,
    'Program': d.program, 'Year': d.year, 'Department': d.department, 'Day': d.day, 'Date': d.date,
    'Status': d.marks[s.id] === 'present' ? 'Present' : 'Absent'
  }));
  const ws = XLSX.utils.json_to_sheet(rows);
  const wb = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(wb, ws, 'Attendance');
  XLSX.writeFile(wb, `SRM_Attendance_${d.date || todayISO()}.xlsx`);
}
function printCurrent() { window.print(); }
function printSession(s) {
  const students = s.studentIds.map(id => state.students.find(x => x.id === id)).filter(Boolean);
  const html = `
    <html><head><title>SRM Attendance</title>
    <style>
      body{font-family:Arial;padding:24px;color:#000;}
      h1{margin:0;font-size:18px;}
      .meta{margin:8px 0 16px;font-size:13px;}
      table{width:100%;border-collapse:collapse;font-size:12px;}
      th,td{border:1px solid #999;padding:6px;text-align:left;}
      th{background:#0d9488;color:#fff;}
    </style></head><body>
    <h1>SRM College of Pharmacy — Attendance Report</h1>
    <div class="meta">
      Program: ${escapeHTML(s.program)} · Year: ${escapeHTML(s.year)}<br/>
      Department: ${escapeHTML(s.department)} · Day: ${escapeHTML(s.day)} · Date: ${escapeHTML(s.date)}<br/>
      Present: ${s.present} / ${s.total} (${s.pct.toFixed(1)}%)
    </div>
    <table><thead><tr><th>#</th><th>Register No</th><th>Name</th><th>Status</th></tr></thead><tbody>
      ${students.map((st, i) => `<tr><td>${i+1}</td><td>${escapeHTML(st.registerNumber)}</td><td>${escapeHTML(st.studentName)}</td><td>${s.marks[st.id]==='present'?'Present':'Absent'}</td></tr>`).join('')}
    </tbody></table>
    <p style="margin-top:32px;">Faculty Signature: ____________________________</p>
    </body></html>`;
  const w = window.open('', '_blank');
  w.document.write(html); w.document.close();
  w.onload = () => { w.print(); };
}

/* -------------------- REPORTS -------------------- */
function renderReportsStats() {
  $('stTotalStudents').textContent = state.students.length;
  $('stTotalSessions').textContent = state.attendance.length;
  const avg = state.attendance.length
    ? (state.attendance.reduce((a, s) => a + s.pct, 0) / state.attendance.length).toFixed(1) + '%'
    : '0%';
  $('stAvgAttend').textContent = avg;
  $('stTotalDepts').textContent = state.departments.length;
}
function runReport(type) {
  const out = $('reportOutput');
  const today = todayISO();
  let title = '', rows = [];
  const filterSessions = (fn) => state.attendance.filter(fn);
  const summarize = (list, groupKey) => {
    const g = {};
    list.forEach(s => {
      const k = s[groupKey] || '—';
      if (!g[k]) g[k] = { total: 0, present: 0, sessions: 0 };
      g[k].total += s.total; g[k].present += s.present; g[k].sessions += 1;
    });
    return Object.entries(g).map(([k, v]) => ({
      group: k, sessions: v.sessions, total: v.total, present: v.present,
      pct: v.total ? ((v.present / v.total) * 100).toFixed(1) + '%' : '0%'
    }));
  };
  const now = new Date(today + 'T00:00:00');
  switch (type) {
    case 'daily': {
      title = `Daily Report — ${today}`;
      rows = filterSessions(s => s.date === today).map(s => ({
        Date: s.date, Program: s.program, Year: s.year, Department: s.department,
        Present: s.present, Absent: s.absent, '%': s.pct.toFixed(1) + '%'
      }));
      break;
    }
    case 'weekly': {
      const start = new Date(now); start.setDate(now.getDate() - 6);
      const startISO = start.toISOString().slice(0,10);
      title = `Weekly Report — ${startISO} to ${today}`;
      rows = filterSessions(s => s.date >= startISO && s.date <= today).map(s => ({
        Date: s.date, Program: s.program, Department: s.department,
        Present: s.present, Absent: s.absent, '%': s.pct.toFixed(1) + '%'
      }));
      break;
    }
    case 'monthly': {
      const m = today.slice(0,7);
      title = `Monthly Report — ${m}`;
      rows = filterSessions(s => s.date.startsWith(m)).map(s => ({
        Date: s.date, Program: s.program, Department: s.department,
        Present: s.present, Absent: s.absent, '%': s.pct.toFixed(1) + '%'
      }));
      break;
    }
    case 'department':
      title = 'Department-wise Report';
      rows = summarize(state.attendance, 'department').map(r => ({
        Department: r.group, Sessions: r.sessions, Present: r.present, Total: r.total, '%': r.pct
      }));
      break;
    case 'program':
      title = 'Program-wise Report';
      rows = summarize(state.attendance, 'program').map(r => ({
        Program: r.group, Sessions: r.sessions, Present: r.present, Total: r.total, '%': r.pct
      }));
      break;
    case 'year':
      title = 'Year-wise Report';
      rows = summarize(state.attendance, 'year').map(r => ({
        Year: r.group, Sessions: r.sessions, Present: r.present, Total: r.total, '%': r.pct
      }));
      break;
    case 'student': {
      title = 'Student Attendance Report';
      const stats = {};
      state.attendance.forEach(sess => {
        sess.studentIds.forEach(sid => {
          if (!stats[sid]) stats[sid] = { present: 0, total: 0 };
          stats[sid].total += 1;
          if (sess.marks[sid] === 'present') stats[sid].present += 1;
        });
      });
      rows = state.students.map(s => {
        const st = stats[s.id] || { present: 0, total: 0 };
        return {
          'Reg No': s.registerNumber, Name: s.studentName, Program: s.program, Year: s.year,
          Present: st.present, Total: st.total,
          '%': st.total ? ((st.present / st.total) * 100).toFixed(1) + '%' : '—'
        };
      });
      break;
    }
  }
  if (!rows.length) { out.innerHTML = `<h4>${escapeHTML(title)}</h4><p style="color:var(--text-muted);">No data available.</p>`; return; }
  const cols = Object.keys(rows[0]);
  out.innerHTML = `
    <h4 style="margin:0 0 10px;">${escapeHTML(title)}</h4>
    <div style="overflow-x:auto;">
      <table>
        <thead><tr>${cols.map(c => `<th>${escapeHTML(c)}</th>`).join('')}</tr></thead>
        <tbody>${rows.map(r => `<tr>${cols.map(c => `<td>${escapeHTML(r[c])}</td>`).join('')}</tr>`).join('')}</tbody>
      </table>
    </div>
    <div style="display:flex;gap:8px;margin-top:12px;">
      <button class="btn-secondary" id="rXlsx">Export Excel</button>
      <button class="btn-secondary" id="rPdf">Export PDF</button>
    </div>`;
  $('rXlsx').addEventListener('click', () => {
    const ws = XLSX.utils.json_to_sheet(rows);
    const wb = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(wb, ws, 'Report');
    XLSX.writeFile(wb, `SRM_${type}_${todayISO()}.xlsx`);
  });
  $('rPdf').addEventListener('click', () => {
    const { jsPDF } = window.jspdf;
    const doc = new jsPDF({ unit: 'pt', format: 'a4' });
    doc.setFontSize(14); doc.text(title, 40, 40);
    doc.autoTable({
      startY: 60, head: [cols], body: rows.map(r => cols.map(c => r[c])),
      styles: { fontSize: 8 }, headStyles: { fillColor: [13,148,136], textColor: 255 }
    });
    doc.save(`SRM_${type}_${todayISO()}.pdf`);
  });
}

/* -------------------- SETTINGS -------------------- */
function renderDepartments() {
  const el = $('deptList');
  el.innerHTML = state.departments.map(d => `
    <span class="dept-chip">${escapeHTML(d)}<button data-del-dept="${escapeHTML(d)}" aria-label="Remove ${escapeHTML(d)}">×</button></span>
  `).join('');
}
function backup() {
  const data = {
    students: state.students, attendance: state.attendance,
    departments: state.departments, exportedAt: new Date().toISOString(),
    version: 1
  };
  const blob = new Blob([JSON.stringify(data, null, 2)], { type: 'application/json' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url; a.download = `SRM_Backup_${todayISO()}.json`; a.click();
  URL.revokeObjectURL(url);
  toast('Backup exported', 'success');
}
function restore(file) {
  const reader = new FileReader();
  reader.onload = (e) => {
    try {
      const data = JSON.parse(e.target.result);
      if (!Array.isArray(data.students) || !Array.isArray(data.attendance)) throw new Error('Invalid backup file');
      confirmModal('This will replace all current data. Continue?', () => {
        state.students = data.students; state.attendance = data.attendance;
        state.departments = data.departments && data.departments.length ? data.departments : [...DEFAULT_DEPARTMENTS];
        saveState(); populateFilters(); renderStudents(); renderAttendance(); renderHistory(); renderReportsStats(); renderDepartments();
        toast('Backup restored', 'success');
      });
    } catch (err) { toast('Invalid backup file', 'error'); }
  };
  reader.readAsText(file);
}
function usage() {
  try {
    const bytes = new Blob([localStorage.getItem(LS_KEY) || '']).size;
    const kb = (bytes / 1024).toFixed(2);
    toast(`Storage used: ${kb} KB · ${state.students.length} students · ${state.attendance.length} sessions`, 'success');
  } catch { toast('Cannot read usage', 'error'); }
}

/* -------------------- MODAL / CONFIRM -------------------- */
function openModal(html) { $('modalCard').innerHTML = html; $('modalRoot').classList.remove('hidden'); }
function closeModal() { $('modalRoot').classList.add('hidden'); $('modalCard').innerHTML = ''; }
function confirmModal(message, onConfirm) {
  openModal(`
    <h3>Confirm</h3>
    <p style="color:var(--text-muted);margin:6px 0 16px;">${escapeHTML(message)}</p>
    <div class="modal-actions">
      <button class="btn-secondary" data-close>Cancel</button>
      <button class="btn-primary" id="cOk" style="background:var(--danger);">Confirm</button>
    </div>`);
  $('cOk').addEventListener('click', () => { closeModal(); onConfirm(); });
}

/* -------------------- NAVIGATION -------------------- */
function switchPage(page) {
  state.currentPage = page;
  document.querySelectorAll('.page').forEach(p => p.classList.toggle('active', p.id === 'page-' + page));
  document.querySelectorAll('.nav-item').forEach(n => {
    const active = n.dataset.page === page;
    n.classList.toggle('active', active);
    n.setAttribute('aria-selected', active);
  });
  $('fabSave').style.display = page === 'attendance' ? 'inline-flex' : 'none';
  if (page === 'students') renderStudents();
  if (page === 'history') renderHistory();
  if (page === 'reports') renderReportsStats();
  if (page === 'settings') renderDepartments();
}

/* -------------------- INIT & LISTENERS -------------------- */
function bindEvents() {
  // Login
  $('loginForm').addEventListener('submit', async (e) => {
    e.preventDefault();
    const u = $('loginUser').value.trim(), p = $('loginPass').value;
    const ok = await tryLogin(u, p);
    if (ok) { setLoggedIn(true); $('loginError').textContent = ''; showApp(); }
    else $('loginError').textContent = 'Invalid username or password';
  });
  $('logoutBtn').addEventListener('click', () => confirmModal('Log out?', () => { setLoggedIn(false); location.reload(); }));

  // Bottom nav
  document.querySelectorAll('.nav-item').forEach(n => n.addEventListener('click', () => switchPage(n.dataset.page)));

  // Attendance filters
  ['fProgram','fYear','fDepartment','fDay','fDate','fSearch'].forEach(id => {
    $(id).addEventListener(id === 'fSearch' ? 'input' : 'change', () => {
      if (id === 'fProgram') {
        fillSelect($('fYear'), YEARS_BY_PROGRAM[$('fProgram').value] || [], { includeAll: false });
      }
      if (id === 'fDate') {
        const d = dayFromDate($('fDate').value);
        if (d) $('fDay').value = d;
      }
      renderAttendance();
    });
  });

  // Toggle
  $('studentList').addEventListener('change', (e) => {
    const t = e.target.closest('[data-toggle]');
    if (!t) return;
    const id = t.dataset.id;
    ensureSessionMarks();
    state.currentSession.marks[id] = t.checked ? 'present' : 'absent';
    const stateEl = t.closest('.toggle-wrap').querySelector('[data-state]');
    stateEl.textContent = t.checked ? 'Present' : 'Absent';
    stateEl.className = 'toggle-state ' + (t.checked ? 'present' : 'absent');
    updateSummary();
  });

  // Quick actions
  $('btnAllPresent').addEventListener('click', () => markAll('present'));
  $('btnAllAbsent').addEventListener('click', () => markAll('absent'));
  $('btnSaveTop').addEventListener('click', saveAttendance);
  $('fabSave').addEventListener('click', saveAttendance);
  $('btnExportPdf').addEventListener('click', exportCurrentPdf);
  $('btnExportXlsx').addEventListener('click', exportCurrentXlsx);
  $('btnPrint').addEventListener('click', printCurrent);

  // Students page
  ['sSearch','sProgram','sYear','sDepartment'].forEach(id => {
    $(id).addEventListener(id === 'sSearch' ? 'input' : 'change', renderStudents);
  });
  $('btnAddStudent').addEventListener('click', () => studentFormModal());
  $('btnImportStudents').addEventListener('click', () => $('importFile').click());
  $('btnExportStudents').addEventListener('click', exportStudentsXlsx);
  $('importFile').addEventListener('change', (e) => {
    const f = e.target.files[0]; if (f) handleImport(f); e.target.value = '';
  });
  $('studentsList').addEventListener('click', (e) => {
    const ed = e.target.closest('[data-edit]');
    const dl = e.target.closest('[data-del]');
    if (ed) { const s = state.students.find(x => x.id === ed.dataset.edit); if (s) studentFormModal(s); }
    if (dl) deleteStudent(dl.dataset.del);
  });

  // Reports
  document.querySelectorAll('.report-btn').forEach(b => b.addEventListener('click', () => runReport(b.dataset.report)));

  // Settings
  $('darkToggle').addEventListener('change', (e) => {
    state.darkMode = e.target.checked;
    document.body.classList.toggle('dark', state.darkMode);
    saveState();
  });
  $('addDeptBtn').addEventListener('click', () => {
    const v = $('newDept').value.trim(); if (!v) return;
    if (state.departments.includes(v)) return toast('Department exists', 'error');
    state.departments.push(v); saveState(); populateFilters(); renderDepartments();
    $('newDept').value = ''; toast('Department added', 'success');
  });
  $('deptList').addEventListener('click', (e) => {
    const btn = e.target.closest('[data-del-dept]'); if (!btn) return;
    const d = btn.dataset.delDept;
    confirmModal(`Remove department "${d}"?`, () => {
      state.departments = state.departments.filter(x => x !== d);
      saveState(); populateFilters(); renderDepartments(); toast('Removed');
    });
  });
  $('backupBtn').addEventListener('click', backup);
  $('restoreBtn').addEventListener('click', () => $('restoreFile').click());
  $('restoreFile').addEventListener('change', (e) => { const f = e.target.files[0]; if (f) restore(f); e.target.value = ''; });
  $('usageBtn').addEventListener('click', usage);
  $('resetAttendanceBtn').addEventListener('click', () => confirmModal('Delete ALL attendance sessions? Students remain.', () => {
    state.attendance = []; saveState(); renderHistory(); renderReportsStats(); toast('Attendance reset');
  }));
  $('clearAllBtn').addEventListener('click', () => confirmModal('Delete ALL data (students + attendance + departments)?', () => {
    state.students = []; state.attendance = []; state.departments = [...DEFAULT_DEPARTMENTS];
    saveState(); populateFilters(); renderStudents(); renderAttendance(); renderHistory(); renderReportsStats(); renderDepartments();
    toast('All data cleared');
  }));
  $('changePwdBtn').addEventListener('click', () => {
    openModal(`
      <h3>Change Password</h3>
      <label>Current Password</label><input id="pOld" type="password" />
      <label style="margin-top:10px;">New Password</label><input id="pNew" type="password" />
      <label style="margin-top:10px;">Confirm New</label><input id="pConf" type="password" />
      <div class="modal-actions"><button class="btn-secondary" data-close>Cancel</button><button class="btn-primary" id="pSave">Save</button></div>
    `);
    $('pSave').addEventListener('click', async () => {
      const oldP = $('pOld').value, newP = $('pNew').value, conf = $('pConf').value;
      if (!oldP || !newP) return toast('Fill both fields', 'error');
      if (newP.length < 4) return toast('Password too short', 'error');
      if (newP !== conf) return toast('Passwords do not match', 'error');
      const ok = await changePassword(oldP, newP);
      if (ok) { closeModal(); toast('Password changed', 'success'); }
      else toast('Current password incorrect', 'error');
    });
  });

  // Modal close
  $('modalRoot').addEventListener('click', (e) => { if (e.target.closest('[data-close]') || e.target.classList.contains('modal-backdrop')) closeModal(); });
  document.addEventListener('keydown', (e) => { if (e.key === 'Escape') closeModal(); });

  // PWA install
  window.addEventListener('beforeinstallprompt', (e) => {
    e.preventDefault(); state.installEvent = e;
    const btn = $('installBtn'); btn.hidden = false;
    btn.onclick = async () => {
      if (state.installEvent) { state.installEvent.prompt(); await state.installEvent.userChoice; state.installEvent = null; btn.hidden = true; }
    };
  });
}

function showApp() {
  $('loginScreen').classList.add('hidden');
  $('app').classList.remove('hidden');
  populateFilters(); renderAttendance(); renderStudents(); renderHistory(); renderReportsStats(); renderDepartments();
  document.body.classList.toggle('dark', state.darkMode);
  $('darkToggle').checked = state.darkMode;
}

async function init() {
  loadState();
  await initAuth();
  bindEvents();
  if (isLoggedIn()) showApp();
  // Register SW
  if ('serviceWorker' in navigator) {
    window.addEventListener('load', () => {
      navigator.serviceWorker.register('service-worker.js').catch(err => console.warn('SW failed', err));
    });
  }
}
document.addEventListener('DOMContentLoaded', init);
})();
