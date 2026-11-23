const API_URL = '../backend/public/api/grades.php';
const AUTH_URL = '../backend/public/api/auth.php';
const ACCOUNTS_URL = '../backend/public/api/accounts.php';
const CALCULATIONS_URL = '../backend/public/api/calculations.php';
const PRESENCE_URL = '../backend/public/api/presence.php';
const form = document.getElementById('gradeForm');
const statusBox = document.getElementById('status');
let sessionState = null;
let studentAccountsData = [];
let studentGradeRecords = [];
let allStudentCalculationsData = [];
let studentStatusFilter = 'all';
let selectedStudentUserId = null;
const gradeTerms = [
  { key: 'prelim', label: 'Prelim', weight: 30, gradeField: 'prelim_grade' },
  { key: 'midterm', label: 'Midterm', weight: 30, gradeField: 'midterm_grade' },
  { key: 'final', label: 'Final', weight: 40, gradeField: 'final_grade' }
];
const activityCategories = [
  { key: 'auxiliary', label: 'Auxiliary', weight: 20 },
  { key: 'minor_activity', label: 'Minor Activity', weight: 40 },
  { key: 'major_activity', label: 'Major Activity', weight: 40 }
];
let nextActivityInputId = 0;

async function requestJson(url, options = {}) {
  const headers = { Accept: 'application/json', ...(options.headers || {}) };
  if (options.body) headers['Content-Type'] = 'application/json';
  if (sessionState && options.method && options.method !== 'GET') headers['X-CSRF-Token'] = sessionState.csrfToken;
  const response = await fetch(url, { ...options, headers, credentials: 'same-origin' });
  const text = await response.text();
  let result;
  try { result = JSON.parse(text); }
  catch { throw new Error(`The server returned an invalid response (HTTP ${response.status}).`); }
  if (response.status === 401 && url !== AUTH_URL) window.location.replace('login.html');
  if (!response.ok) throw new Error(result.error || 'Request failed.');
  return result;
}

function startStudentPresence() {
  const activeWindowMs = 30000;
  let lastActivityAt = Date.now();
  let lastAttemptAt = 0;
  let requestPending = false;
  let errorLogged = false;

  const sendHeartbeat = async () => {
    const now = Date.now();
    if (document.hidden || !document.hasFocus() || now - lastActivityAt > activeWindowMs
        || requestPending || now - lastAttemptAt < 10000) return;

    lastAttemptAt = now;
    requestPending = true;
    try {
      await requestJson(PRESENCE_URL, { method: 'POST' });
      errorLogged = false;
    } catch (error) {
      if (!errorLogged) console.error('Unable to update student online status:', error);
      errorLogged = true;
    } finally {
      requestPending = false;
    }
  };

  const markActivity = () => {
    lastActivityAt = Date.now();
    void sendHeartbeat();
  };

  ['pointerdown', 'pointermove', 'keydown', 'scroll', 'touchstart'].forEach(eventName => {
    document.addEventListener(eventName, markActivity, { passive: true });
  });
  window.addEventListener('focus', markActivity);
  document.addEventListener('visibilitychange', () => {
    if (!document.hidden) markActivity();
  });

  void sendHeartbeat();
  window.setInterval(() => void sendHeartbeat(), 10000);
}

function renderResult(record) {
  document.getElementById('studentname').textContent = record.student_name;
  document.getElementById('studentid').textContent = record.student_id;
  document.getElementById('finalGrade').textContent = Number(record.computed_grade).toFixed(2);
  document.getElementById('averageGrade').textContent = record.equivalent_grade;
  document.getElementById('remarks').textContent = record.remarks;
  document.getElementById('studentGradeMessage').hidden = true;
  const breakdownPanel = document.getElementById('gradeBreakdownPanel');
  const breakdown = document.getElementById('gradeBreakdown');
  breakdown.replaceChildren();
  breakdownPanel.hidden = !record.activity_breakdown;
  if (record.activity_breakdown) {
    breakdown.append(createBreakdownDetails(record.activity_breakdown, record, 'View saved scores'));
  }
  const qr = document.getElementById('qrcode');
  qr.replaceChildren();
  const resultUrl = new URL(`result.html?id=${encodeURIComponent(record.id)}`, window.location.href).href;
  if (window.QRCode) {
    new QRCode(qr, { text: resultUrl, width: 180, height: 180 });
  } else {
    const link = document.createElement('a');
    link.href = resultUrl;
    link.textContent = 'QR code unavailable. Open the saved result.';
    qr.append(link);
  }
}

function addCell(row, value) {
  const cell = row.insertCell();
  cell.textContent = value == null ? '' : value;
  return cell;
}

function showTableMessage(body, message, columns) {
  body.replaceChildren();
  const row = body.insertRow();
  const cell = row.insertCell();
  cell.colSpan = columns;
  cell.textContent = message;
}

function createActivityScoreItem(category, index, value = '') {
  const item = document.createElement('div');
  item.className = 'activity-score-item';
  const label = document.createElement('label');
  label.htmlFor = `activityScore${++nextActivityInputId}`;
  label.append(document.createTextNode(`${category.label} score ${index}`));
  const input = document.createElement('input');
  input.id = label.htmlFor;
  input.type = 'number';
  input.min = '0';
  input.max = '100';
  input.step = '0.01';
  input.inputMode = 'decimal';
  input.required = true;
  input.dataset.activityScore = 'true';
  input.value = value;
  label.append(input);
  const remove = document.createElement('button');
  remove.type = 'button';
  remove.className = 'secondary small remove-activity-score';
  remove.textContent = 'Remove';
  remove.setAttribute('aria-label', `Remove ${category.label} score ${index}`);
  item.append(label, remove);
  return item;
}

function refreshActivityScoreItems(list, category) {
  const items = Array.from(list.children);
  items.forEach((item, index) => {
    const label = item.querySelector('label');
    label.firstChild.textContent = `${category.label} score ${index + 1}`;
    const remove = item.querySelector('.remove-activity-score');
    remove.hidden = items.length === 1;
    remove.setAttribute('aria-label', `Remove ${category.label} score ${index + 1}`);
  });
}

function updateActivityTermGrades(container) {
  const formElement = container.closest('form');
  gradeTerms.forEach(term => {
    const termFieldset = container.querySelector(`[data-grade-term="${term.key}"]`);
    const mode = termFieldset.querySelector('[data-grade-mode]').value;
    const directPanel = termFieldset.querySelector('[data-direct-grade-panel]');
    const directInput = termFieldset.querySelector('[data-direct-grade]');
    const categoriesGrid = termFieldset.querySelector('.activity-categories-grid');
    const gradeInput = formElement.querySelector(`[name="${term.gradeField}"]`);
    const output = termFieldset.querySelector('[data-term-preview]');
    const directMode = mode === 'direct';
    directPanel.hidden = !directMode;
    directInput.required = directMode;
    directInput.disabled = !directMode;
    categoriesGrid.hidden = directMode;
    termFieldset.querySelectorAll('[data-activity-score]').forEach(input => {
      input.required = !directMode;
    });

    if (directMode) {
      const directGrade = Number(directInput.value);
      if (directInput.value.trim() !== '' && Number.isFinite(directGrade) && directGrade >= 0 && directGrade <= 100) {
        const roundedGrade = Number(directGrade.toFixed(2));
        output.textContent = `${term.label} grade: ${roundedGrade.toFixed(2)} / 100 (direct)`;
        gradeInput.value = roundedGrade.toFixed(2);
      } else {
        output.textContent = `${term.label} grade: enter a grade from 0 to 100`;
        gradeInput.value = '';
      }
      return;
    }

    let termScore = 0;
    let complete = true;
    activityCategories.forEach(category => {
      const list = container.querySelector(`[data-grade-term="${term.key}"] [data-activity-category="${category.key}"] .activity-score-list`);
      const scores = Array.from(list.querySelectorAll('[data-activity-score]')).map(input => {
        if (input.value.trim() === '') return NaN;
        return Number(input.value);
      });
      if (!scores.length || scores.some(score => !Number.isFinite(score) || score < 0 || score > 100)) {
        complete = false;
        return;
      }
      const average = Number((scores.reduce((total, score) => total + score, 0) / scores.length).toFixed(2));
      termScore += average * (category.weight / 100);
    });

    if (complete) {
      const roundedGrade = Number(termScore.toFixed(2));
      output.textContent = `${term.label} grade: ${roundedGrade.toFixed(2)} / 100`;
      gradeInput.value = roundedGrade.toFixed(2);
      directInput.value = roundedGrade.toFixed(2);
    } else {
      output.textContent = `${term.label} grade: enter a score for every category`;
      gradeInput.value = '';
    }
  });
}

function initializeActivityInputs(container) {
  container.replaceChildren();
  gradeTerms.forEach(term => {
    const termFieldset = document.createElement('fieldset');
    termFieldset.className = 'grade-term';
    termFieldset.dataset.gradeTerm = term.key;
    const legend = document.createElement('legend');
    legend.textContent = `${term.label} (${term.weight}% of final grade)`;
    const modeField = document.createElement('div');
    modeField.className = 'field term-grade-mode';
    const modeLabel = document.createElement('label');
    modeLabel.htmlFor = `gradeMode${term.key}${nextActivityInputId + 1}`;
    modeLabel.textContent = 'How do you want to enter this term?';
    const modeSelect = document.createElement('select');
    modeSelect.id = modeLabel.htmlFor;
    modeSelect.dataset.gradeMode = 'true';
    modeSelect.add(new Option('Enter the term grade directly', 'direct'));
    modeSelect.add(new Option('Calculate from activity scores', 'activities'));
    modeField.append(modeLabel, modeSelect);

    const directPanel = document.createElement('div');
    directPanel.className = 'field term-direct-grade';
    directPanel.dataset.directGradePanel = 'true';
    const directLabel = document.createElement('label');
    directLabel.htmlFor = `directGrade${term.key}${nextActivityInputId + 1}`;
    directLabel.textContent = `${term.label} Grade (0–100)`;
    const directInput = document.createElement('input');
    directInput.id = directLabel.htmlFor;
    directInput.type = 'number';
    directInput.min = '0';
    directInput.max = '100';
    directInput.step = '0.01';
    directInput.inputMode = 'decimal';
    directInput.required = true;
    directInput.dataset.directGrade = 'true';
    directPanel.append(directLabel, directInput);

    const categoriesGrid = document.createElement('div');
    categoriesGrid.className = 'activity-categories-grid';

    activityCategories.forEach(category => {
      const categoryPanel = document.createElement('div');
      categoryPanel.className = 'activity-category';
      categoryPanel.dataset.activityCategory = category.key;
      const heading = document.createElement('h3');
      heading.textContent = `${category.label} (${category.weight}%)`;
      const scoreList = document.createElement('div');
      scoreList.className = 'activity-score-list';
      scoreList.append(createActivityScoreItem(category, 1));
      const addButton = document.createElement('button');
      addButton.type = 'button';
      addButton.className = 'secondary small add-activity-score';
      addButton.dataset.addScore = 'true';
      addButton.textContent = `Add ${category.label} Score`;
      categoryPanel.append(heading, scoreList, addButton);
      categoriesGrid.append(categoryPanel);
    });

    const preview = document.createElement('p');
    preview.className = 'term-grade-preview';
    preview.dataset.termPreview = 'true';
    termFieldset.append(legend, modeField, directPanel, categoriesGrid, preview);
    container.append(termFieldset);
  });

  container.addEventListener('click', event => {
    const addButton = event.target.closest('[data-add-score]');
    if (addButton) {
      const categoryPanel = addButton.closest('[data-activity-category]');
      const category = activityCategories.find(item => item.key === categoryPanel.dataset.activityCategory);
      const list = categoryPanel.querySelector('.activity-score-list');
      list.append(createActivityScoreItem(category, list.children.length + 1));
      refreshActivityScoreItems(list, category);
      updateActivityTermGrades(container);
      return;
    }

    const removeButton = event.target.closest('.remove-activity-score');
    if (!removeButton) return;
    const categoryPanel = removeButton.closest('[data-activity-category]');
    const category = activityCategories.find(item => item.key === categoryPanel.dataset.activityCategory);
    const list = categoryPanel.querySelector('.activity-score-list');
    if (list.children.length <= 1) return;
    removeButton.closest('.activity-score-item').remove();
    refreshActivityScoreItems(list, category);
    updateActivityTermGrades(container);
  });
  container.addEventListener('input', event => {
    if (event.target.matches('[data-activity-score], [data-direct-grade]')) updateActivityTermGrades(container);
  });
  container.addEventListener('change', event => {
    if (event.target.matches('[data-grade-mode]')) updateActivityTermGrades(container);
  });
  updateActivityTermGrades(container);
}

function setActivityBreakdown(container, breakdown, termGrades = null) {
  gradeTerms.forEach(term => {
    const termFieldset = container.querySelector(`[data-grade-term="${term.key}"]`);
    const termBreakdown = breakdown && breakdown[term.key];
    const usesActivities = activityCategories.every(category => {
      const scores = termBreakdown && termBreakdown[category.key];
      return Array.isArray(scores) && scores.length > 0;
    });
    termFieldset.querySelector('[data-grade-mode]').value = usesActivities ? 'activities' : 'direct';
    const directInput = termFieldset.querySelector('[data-direct-grade]');
    directInput.value = termGrades && termGrades[term.gradeField] != null ? termGrades[term.gradeField] : '';

    activityCategories.forEach(category => {
      const list = termFieldset.querySelector(`[data-activity-category="${category.key}"] .activity-score-list`);
      const scores = usesActivities && termBreakdown[category.key];
      list.replaceChildren();
      if (Array.isArray(scores) && scores.length) {
        scores.forEach((score, index) => list.append(createActivityScoreItem(category, index + 1, score)));
      } else {
        list.append(createActivityScoreItem(category, 1));
      }
      refreshActivityScoreItems(list, category);
    });
  });
  updateActivityTermGrades(container);
}

function collectActivityBreakdown(container) {
  const breakdown = {};
  gradeTerms.forEach(term => {
    const termFieldset = container.querySelector(`[data-grade-term="${term.key}"]`);
    if (termFieldset.querySelector('[data-grade-mode]').value === 'direct') {
      const directInput = termFieldset.querySelector('[data-direct-grade]');
      const grade = Number(directInput.value);
      if (directInput.value.trim() === '' || !Number.isFinite(grade) || grade < 0 || grade > 100) {
        throw new Error(`Enter a valid ${term.label} grade from 0 to 100.`);
      }
      breakdown[term.key] = null;
      return;
    }

    breakdown[term.key] = {};
    activityCategories.forEach(category => {
      const list = container.querySelector(`[data-grade-term="${term.key}"] [data-activity-category="${category.key}"] .activity-score-list`);
      const inputs = Array.from(list.querySelectorAll('[data-activity-score]'));
      const scores = inputs.map(input => Number(input.value));
      if (!inputs.length || inputs.some(input => input.value.trim() === '')
          || scores.some(score => !Number.isFinite(score) || score < 0 || score > 100)) {
        throw new Error(`Enter valid ${category.label} scores for ${term.label}.`);
      }
      breakdown[term.key][category.key] = scores;
    });
  });
  return breakdown;
}

function createBreakdownDetails(breakdown, termGrades, summaryText = 'View') {
  if (!breakdown) {
    const message = document.createElement('span');
    message.textContent = 'No activity breakdown saved';
    return message;
  }
  const details = document.createElement('details');
  const summary = document.createElement('summary');
  summary.textContent = summaryText;
  details.append(summary);
  gradeTerms.forEach(term => {
    const section = document.createElement('div');
    section.className = 'saved-breakdown-term';
    const heading = document.createElement('strong');
    const termGrade = termGrades && termGrades[term.gradeField] != null
      ? ` — ${Number(termGrades[term.gradeField]).toFixed(2)}`
      : '';
    heading.textContent = `${term.label}${termGrade}`;
    const list = document.createElement('ul');
    const termBreakdown = breakdown[term.key];
    if (!termBreakdown) {
      const item = document.createElement('li');
      item.textContent = 'Direct term grade used; activity scores were not entered.';
      list.append(item);
    } else {
      activityCategories.forEach(category => {
        const scores = termBreakdown[category.key];
        if (!Array.isArray(scores) || !scores.length) return;
        const average = Number((scores.reduce((total, score) => total + Number(score), 0) / scores.length).toFixed(2));
        const item = document.createElement('li');
        item.textContent = `${category.label} (${category.weight}%): ${scores.join(', ')} — average ${average.toFixed(2)}`;
        list.append(item);
      });
    }
    section.append(heading, list);
    details.append(section);
  });
  return details;
}

initializeActivityInputs(document.getElementById('gradeActivityInputs'));
initializeActivityInputs(document.getElementById('calculationActivityInputs'));

async function loadAllStudentCalculations() {
  const body = document.getElementById('allStudentCalculationsBody');
  try {
    const { data } = await requestJson(CALCULATIONS_URL);
    allStudentCalculationsData = data;
    renderStudentDetail();
    body.replaceChildren();
    if (!data.length) {
      showTableMessage(body, 'No student calculations have been saved yet.', 11);
      return;
    }
    data.forEach(calculation => {
      const row = body.insertRow();
      [
        calculation.student_name,
        calculation.login_id,
        calculation.calculation_name,
        calculation.prelim_grade,
        calculation.midterm_grade,
        calculation.final_grade,
        Number(calculation.computed_grade).toFixed(2),
        calculation.equivalent_grade,
        calculation.remarks
      ].forEach(value => addCell(row, value));
      addCell(row, '').append(createBreakdownDetails(calculation.activity_breakdown, calculation));
      addCell(row, calculation.created_at);
    });
  } catch (error) {
    allStudentCalculationsData = [];
    renderStudentDetail();
    showTableMessage(body, error.message, 11);
  }
}

async function loadRecords() {
  const body = document.getElementById('recordsBody');
  try {
    const { data } = await requestJson(API_URL);
    if (sessionState.user.role === 'student') {
      if (data.length) renderResult(data[0]);
      else document.getElementById('studentGradeMessage').hidden = false;
      return;
    }

    studentGradeRecords = data;
    renderStudentDetail();
    body.replaceChildren();
    if (!data.length) {
      showTableMessage(body, 'No saved records yet.', 10);
      return;
    }
    data.forEach(record => {
      const row = body.insertRow();
      [
        record.student_name,
        record.student_id,
        record.prelim_grade,
        record.midterm_grade,
        record.final_grade,
        Number(record.computed_grade).toFixed(2),
        record.equivalent_grade,
        record.remarks
      ].forEach(value => addCell(row, value));
      addCell(row, '').append(createBreakdownDetails(record.activity_breakdown, record));
      const actions = addCell(row, '');
      const edit = document.createElement('button');
      edit.textContent = 'Edit';
      edit.type = 'button';
      edit.className = 'small';
      edit.addEventListener('click', () => editRecord(record));
      const remove = document.createElement('button');
      remove.textContent = 'Delete';
      remove.type = 'button';
      remove.className = 'small danger';
      remove.addEventListener('click', () => deleteRecord(record.id));
      actions.append(edit, remove);
    });
  } catch (error) {
    if (sessionState.user.role === 'student') {
      document.getElementById('studentGradeMessage').textContent = error.message;
      document.getElementById('studentGradeMessage').hidden = false;
    } else {
      studentGradeRecords = [];
      renderStudentDetail();
      showTableMessage(body, error.message, 10);
    }
  }
}

function editRecord(record) {
  document.getElementById('recordId').value = record.id;
  document.getElementById('StudentName').value = record.student_name;
  document.getElementById('StudentID').value = record.student_id;
  setActivityBreakdown(document.getElementById('gradeActivityInputs'), record.activity_breakdown, record);
  statusBox.textContent = record.activity_breakdown
    ? 'Activity scores loaded for editing.'
    : 'This older grade has no activity breakdown. Enter scores for all categories to update it.';
  statusBox.className = '';
  document.getElementById('saveButton').textContent = 'Update Grade';
  document.getElementById('cancelEdit').hidden = false;
  form.scrollIntoView({ behavior: 'smooth' });
}

function resetForm() {
  form.reset();
  document.getElementById('recordId').value = '';
  setActivityBreakdown(document.getElementById('gradeActivityInputs'), null);
  document.getElementById('saveButton').textContent = 'Save Grade';
  document.getElementById('cancelEdit').hidden = true;
}

function getFilteredStudentAccounts() {
  const query = document.getElementById('studentSearch').value.trim().toLowerCase();
  return studentAccountsData.filter(account => {
    const matchesStatus = studentStatusFilter === 'all' || account.account_status === studentStatusFilter;
    const name = [account.first_name, account.middle_name, account.last_name].filter(Boolean).join(' ');
    const searchable = [
      name,
      account.username,
      account.student_id,
      account.year_level,
      account.department
    ].filter(Boolean).join(' ').toLowerCase();
    return matchesStatus && (!query || searchable.includes(query));
  });
}

function renderStudentAccounts() {
  const body = document.getElementById('accountsBody');
  const accounts = getFilteredStudentAccounts();
  body.replaceChildren();
  if (!accounts.length) {
    const query = document.getElementById('studentSearch').value.trim();
    const message = query
      ? 'No student accounts match your search and status filter.'
      : studentStatusFilter === 'all'
        ? 'No student accounts yet.'
        : `No ${studentStatusFilter.toLowerCase()} student accounts.`;
    showTableMessage(body, message, 10);
    return;
  }

  accounts.forEach(account => {
    const row = body.insertRow();
    if (String(account.user_id) === selectedStudentUserId) row.className = 'selected-student-row';
    addCell(row, account.user_id);
    addCell(row, account.username);
    addCell(row, account.first_name);
    addCell(row, account.middle_name);
    addCell(row, account.last_name);
    addCell(row, account.student_id);
    addCell(row, account.year_level);
    addCell(row, account.department);
    addCell(row, account.created_at);
    const status = addCell(row, '');
    const state = document.createElement('span');
    state.className = `presence-state ${account.account_status === 'Online' ? 'online' : 'offline'}`;
    const dot = document.createElement('span');
    dot.className = 'presence-dot';
    dot.setAttribute('aria-hidden', 'true');
    const label = document.createElement('span');
    label.textContent = account.account_status;
    state.append(dot, label);
    status.append(state);
  });
}

function renderStudentDirectoryResults() {
  const results = document.getElementById('studentDirectoryResults');
  const message = document.getElementById('studentDirectoryMessage');
  message.className = 'directory-message';
  const onlineCount = studentAccountsData.filter(account => account.account_status === 'Online').length;
  document.getElementById('allStudentCount').textContent = studentAccountsData.length;
  document.getElementById('onlineStudentCount').textContent = onlineCount;
  document.getElementById('offlineStudentCount').textContent = studentAccountsData.length - onlineCount;

  document.querySelectorAll('[data-status-filter]').forEach(button => {
    const selected = button.dataset.statusFilter === studentStatusFilter;
    button.classList.toggle('active', selected);
    button.setAttribute('aria-pressed', String(selected));
  });

  const accounts = getFilteredStudentAccounts();
  if (selectedStudentUserId && !accounts.some(account => String(account.user_id) === selectedStudentUserId)) {
    selectedStudentUserId = null;
  }
  const visibleAccounts = accounts.slice(0, 50);
  results.replaceChildren();
  visibleAccounts.forEach(account => {
    const item = document.createElement('li');
    const button = document.createElement('button');
    button.type = 'button';
    button.className = 'student-directory-result';
    button.setAttribute('aria-pressed', String(String(account.user_id) === selectedStudentUserId));
    const name = document.createElement('span');
    name.className = 'student-directory-name';
    name.textContent = [account.first_name, account.middle_name, account.last_name].filter(Boolean).join(' ') || account.username;
    const identity = document.createElement('span');
    identity.className = 'student-directory-identity';
    identity.textContent = `${account.username} · ${account.student_id}`;
    const state = document.createElement('span');
    state.className = `presence-state ${account.account_status === 'Online' ? 'online' : 'offline'}`;
    const dot = document.createElement('span');
    dot.className = 'presence-dot';
    dot.setAttribute('aria-hidden', 'true');
    const label = document.createElement('span');
    label.textContent = account.account_status;
    state.append(dot, label);
    button.append(name, identity, state);
    button.addEventListener('click', () => {
      selectedStudentUserId = String(account.user_id);
      renderStudentDirectoryResults();
      renderStudentAccounts();
      renderStudentDetail();
    });
    item.append(button);
    results.append(item);
  });

  if (!accounts.length) {
    message.textContent = document.getElementById('studentSearch').value.trim()
      ? 'No students match your search and status filter.'
      : studentStatusFilter === 'all'
        ? 'No student accounts yet.'
        : `No ${studentStatusFilter.toLowerCase()} students right now.`;
  } else if (accounts.length > visibleAccounts.length) {
    message.textContent = `Showing ${visibleAccounts.length} of ${accounts.length} matches. Refine your search to see other students.`;
  } else {
    message.textContent = `${accounts.length} student${accounts.length === 1 ? '' : 's'} found. Select one to view details.`;
  }
}

function renderStudentDetail() {
  const detail = document.getElementById('studentDetail');
  const account = studentAccountsData.find(item => String(item.user_id) === selectedStudentUserId);
  if (!account) {
    detail.hidden = true;
    return;
  }

  detail.hidden = false;
  document.getElementById('studentDetailName').textContent =
    [account.first_name, account.middle_name, account.last_name].filter(Boolean).join(' ') || account.username;
  const fields = document.getElementById('studentDetailFields');
  fields.replaceChildren();
  const addDetail = (label, value) => {
    const row = document.createElement('div');
    const term = document.createElement('dt');
    term.textContent = label;
    const description = document.createElement('dd');
    description.textContent = value == null || value === '' ? '—' : value;
    row.append(term, description);
    fields.append(row);
  };
  addDetail('Username', account.username);
  addDetail('Student ID', account.student_id);
  addDetail('Year Level', account.year_level);
  addDetail('Department', account.department);
  addDetail('Account Created', account.created_at);
  addDetail('Status', account.account_status);

  const grade = studentGradeRecords.find(record => String(record.student_id) === String(account.student_id));
  if (grade) {
    addDetail('Prelim Grade', grade.prelim_grade);
    addDetail('Midterm Grade', grade.midterm_grade);
    addDetail('Final Grade', grade.final_grade);
    addDetail('Computed Grade', Number(grade.computed_grade).toFixed(2));
    addDetail('Remarks', grade.remarks);
  } else {
    addDetail('Official Grade Record', 'No linked record');
  }
  const calculationCount = allStudentCalculationsData.filter(
    calculation => calculation.login_id === account.username
  ).length;
  addDetail('Saved Private Calculations', calculationCount);
}

async function loadStudentAccounts() {
  const body = document.getElementById('accountsBody');
  try {
    const { data } = await requestJson(ACCOUNTS_URL);
    studentAccountsData = data;
    renderStudentDirectoryResults();
    renderStudentAccounts();
    renderStudentDetail();
  } catch (error) {
    showTableMessage(body, error.message, 10);
    const message = document.getElementById('studentDirectoryMessage');
    message.textContent = `Unable to refresh student status: ${error.message}`;
    message.className = 'directory-message error';
  }
}

document.getElementById('studentSearch').addEventListener('input', () => {
  renderStudentDirectoryResults();
  renderStudentAccounts();
  renderStudentDetail();
});

document.querySelectorAll('[data-status-filter]').forEach(button => {
  button.addEventListener('click', () => {
    studentStatusFilter = button.dataset.statusFilter;
    renderStudentDirectoryResults();
    renderStudentAccounts();
    renderStudentDetail();
  });
});

async function loadStudentCalculations() {
  const body = document.getElementById('studentCalculationsBody');
  const status = document.getElementById('calculationStatus');
  try {
    const { data } = await requestJson(CALCULATIONS_URL);
    body.replaceChildren();
    if (!data.length) {
      showTableMessage(body, 'You have not saved any calculations yet.', 10);
      return;
    }
    data.forEach(calculation => {
      const row = body.insertRow();
      [
        calculation.calculation_name,
        calculation.prelim_grade,
        calculation.midterm_grade,
        calculation.final_grade,
        Number(calculation.computed_grade).toFixed(2),
        calculation.equivalent_grade,
        calculation.remarks
      ].forEach(value => addCell(row, value));
      addCell(row, '').append(createBreakdownDetails(calculation.activity_breakdown, calculation));
      addCell(row, calculation.created_at);
      const actions = addCell(row, '');
      const remove = document.createElement('button');
      remove.type = 'button';
      remove.className = 'small danger';
      remove.textContent = 'Delete';
      remove.addEventListener('click', () => deleteStudentCalculation(calculation.id));
      actions.append(remove);
    });
  } catch (error) {
    status.textContent = error.message;
    status.className = 'error';
  }
}

async function deleteStudentCalculation(id) {
  const status = document.getElementById('calculationStatus');
  try {
    await requestJson(`${CALCULATIONS_URL}?id=${encodeURIComponent(id)}`, { method: 'DELETE' });
    status.textContent = 'Calculation deleted.';
    status.className = 'success';
    await loadStudentCalculations();
  } catch (error) {
    status.textContent = error.message;
    status.className = 'error';
  }
}

async function deleteRecord(id) {
  if (!window.confirm('Delete this grade record?')) return;
  try {
    await requestJson(`${API_URL}?id=${encodeURIComponent(id)}`, { method: 'DELETE' });
    statusBox.textContent = 'Record deleted.';
    statusBox.className = 'success';
    await loadRecords();
  } catch (error) {
    statusBox.textContent = error.message;
    statusBox.className = 'error';
  }
}

document.getElementById('cancelEdit').addEventListener('click', resetForm);
form.addEventListener('submit', async event => {
  event.preventDefault();
  const id = document.getElementById('recordId').value;
  const payload = Object.fromEntries(new FormData(form).entries());
  delete payload.recordId;
  payload.student_name = document.getElementById('StudentName').value.trim();
  payload.student_id = document.getElementById('StudentID').value.trim();
  const saveButton = document.getElementById('saveButton');
  saveButton.disabled = true;
  statusBox.textContent = id ? 'Updating grade…' : 'Saving grade…';
  statusBox.className = '';
  try {
    for (const key of ['prelim_grade', 'midterm_grade', 'final_grade']) payload[key] = Number(payload[key]);
    payload.activity_breakdown = collectActivityBreakdown(document.getElementById('gradeActivityInputs'));
    const result = await requestJson(id ? `${API_URL}?id=${encodeURIComponent(id)}` : API_URL, {
      method: id ? 'PUT' : 'POST',
      body: JSON.stringify(payload)
    });
    renderResult(result.data);
    statusBox.textContent = result.message;
    statusBox.className = 'success';
    resetForm();
    await loadRecords();
    await loadStudentAccounts();
  } catch (error) {
    statusBox.textContent = error.message;
    statusBox.className = 'error';
  } finally {
    saveButton.disabled = false;
  }
});

document.getElementById('studentAccountForm').addEventListener('submit', async event => {
  event.preventDefault();
  const status = document.getElementById('accountStatus');
  const studentId = document.getElementById('accountStudentID').value.trim();
  const submitButton = event.target.querySelector('button[type="submit"]');
  submitButton.disabled = true;
  document.getElementById('registrationApprovalPanel').hidden = true;
  try {
    const result = await requestJson(ACCOUNTS_URL, { method: 'POST', body: JSON.stringify({ student_id: studentId }) });
    status.textContent = result.message;
    status.className = 'success';
    document.getElementById('registrationApprovalMessage').textContent = `Registration enabled for ${result.data.student_name} (${result.data.student_id}).`;
    document.getElementById('registrationApprovalExpiry').textContent = `Expires: ${result.data.expires_at}`;
    document.getElementById('registrationApprovalPanel').hidden = false;
    document.getElementById('accountStudentID').value = '';
    await loadStudentAccounts();
  } catch (error) {
    status.textContent = error.message;
    status.className = 'error';
  } finally {
    submitButton.disabled = false;
  }
});

document.getElementById('studentCalculationForm').addEventListener('submit', async event => {
  event.preventDefault();
  const status = document.getElementById('calculationStatus');
  const button = document.getElementById('saveCalculationButton');
  const payload = Object.fromEntries(new FormData(event.target).entries());
  button.disabled = true;
  status.textContent = 'Saving your calculation…';
  status.className = '';
  try {
    for (const key of ['prelim_grade', 'midterm_grade', 'final_grade']) payload[key] = Number(payload[key]);
    payload.activity_breakdown = collectActivityBreakdown(document.getElementById('calculationActivityInputs'));
    await requestJson(CALCULATIONS_URL, { method: 'POST', body: JSON.stringify(payload) });
    event.target.reset();
    setActivityBreakdown(document.getElementById('calculationActivityInputs'), null);
    status.textContent = 'Your calculation was saved.';
    status.className = 'success';
    await loadStudentCalculations();
  } catch (error) {
    status.textContent = error.message;
    status.className = 'error';
  } finally {
    button.disabled = false;
  }
});

document.getElementById('passwordForm').addEventListener('submit', async event => {
  event.preventDefault();
  const status = document.getElementById('passwordStatus');
  try {
    const result = await requestJson(AUTH_URL, {
      method: 'POST',
      body: JSON.stringify({
        action: 'change_password',
        current_password: document.getElementById('currentPassword').value,
        new_password: document.getElementById('newPassword').value
      })
    });
    sessionState.csrfToken = result.csrf_token;
    status.textContent = result.message;
    status.className = 'success';
    event.target.reset();
  } catch (error) {
    status.textContent = error.message;
    status.className = 'error';
  }
});

document.getElementById('logoutButton').addEventListener('click', async () => {
  try {
    await requestJson(AUTH_URL, { method: 'POST', body: JSON.stringify({ action: 'logout' }) });
    window.location.replace('login.html');
  } catch (error) {
    statusBox.textContent = error.message;
    statusBox.className = 'error';
  }
});

(async function initialize() {
  try {
    const session = await requestJson(AUTH_URL);
    if (!session.authenticated) {
      window.location.replace('login.html');
      return;
    }
    sessionState = { user: session.user, csrfToken: session.csrf_token };
    document.getElementById('sessionBar').hidden = false;
    document.getElementById('currentUser').textContent = `${session.user.display_name} · ${session.user.role}`;
    document.getElementById('passwordSection').hidden = false;

    if (session.user.role === 'admin') {
      document.getElementById('gradeResult').hidden = false;
      document.getElementById('currentCredentialLabel').textContent = 'Current Admin PIN';
      document.getElementById('newCredentialLabel').textContent = 'New Admin PIN (16–72 characters)';
      document.getElementById('newPassword').minLength = 16;
      document.querySelector('#passwordForm button[type="submit"]').textContent = 'Change Admin PIN';
      document.getElementById('pageIntro').textContent = 'Administrator dashboard: manage grades and review student accounts and calculations.';
      document.getElementById('gradeEntry').hidden = false;
      document.getElementById('recordsSection').hidden = false;
      document.getElementById('accountsSection').hidden = false;
      await Promise.all([loadRecords(), loadStudentAccounts()]);
      document.getElementById('allStudentCalculationsSection').hidden = false;
      await loadAllStudentCalculations();
      window.setInterval(() => {
        if (!document.hidden) {
          loadRecords();
          loadAllStudentCalculations();
        }
      }, 10000);
      window.setInterval(() => {
        if (!document.hidden) loadStudentAccounts();
      }, 5000);
    } else {
      document.getElementById('pageIntro').textContent = `Welcome, ${session.user.student_name}.`;
      document.getElementById('studentCalculationsSection').hidden = false;
      startStudentPresence();
      const tasks = [loadStudentCalculations()];
      if (session.user.student_id) {
        document.getElementById('gradeResult').hidden = false;
        document.getElementById('resultTitle').textContent = 'My Official Grade Record';
        document.getElementById('studentPrivacyNote').hidden = false;
        document.getElementById('studentGradeMessage').textContent = 'No official grade record is available for your account yet.';
        tasks.push(loadRecords());
      }
      await Promise.all(tasks);
    }
  } catch (error) {
    document.getElementById('pageIntro').textContent = error.message;
    document.getElementById('pageIntro').className = 'intro error';
  }
})();
