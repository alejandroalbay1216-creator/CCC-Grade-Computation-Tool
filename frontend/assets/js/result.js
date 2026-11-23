const AUTH_URL = '../backend/public/api/auth.php';
const GRADES_URL = '../backend/public/api/grades.php';

async function getJson(url) {
  const response = await fetch(url, { credentials: 'same-origin', headers: { Accept: 'application/json' } });
  const text = await response.text();
  let result;
  try { result = JSON.parse(text); }
  catch { throw new Error(`The server returned an invalid response (HTTP ${response.status}).`); }
  if (!response.ok) throw new Error(result.error || 'Unable to load grade record.');
  return result;
}

(async function loadResult() {
  const status = document.getElementById('resultStatus');
  try {
    const session = await getJson(AUTH_URL);
    if (!session.authenticated) {
      window.location.replace('login.html');
      return;
    }

    const id = new URLSearchParams(window.location.search).get('id');
    if (!id) throw new Error('A result ID is required.');
    const { data: record } = await getJson(`${GRADES_URL}?id=${encodeURIComponent(id)}`);
    for (const [key, value] of Object.entries({
      studentName: record.student_name,
      studentId: record.student_id,
      prelimGrade: record.prelim_grade,
      midtermGrade: record.midterm_grade,
      finalInput: record.final_grade,
      computedGrade: Number(record.computed_grade).toFixed(2),
      averageGrade: record.equivalent_grade,
      remarks: record.remarks
    })) {
      document.getElementById(key).textContent = value;
    }
    if (record.activity_breakdown) {
      const panel = document.getElementById('resultBreakdownPanel');
      const container = document.getElementById('resultBreakdown');
      const terms = [
        { key: 'prelim', label: 'Prelim', field: 'prelim_grade' },
        { key: 'midterm', label: 'Midterm', field: 'midterm_grade' },
        { key: 'final', label: 'Final', field: 'final_grade' }
      ];
      const categories = [
        { key: 'auxiliary', label: 'Auxiliary', weight: 20 },
        { key: 'minor_activity', label: 'Minor Activity', weight: 40 },
        { key: 'major_activity', label: 'Major Activity', weight: 40 }
      ];
      container.replaceChildren();
      terms.forEach(term => {
        const section = document.createElement('div');
        section.className = 'saved-breakdown-term';
        const heading = document.createElement('strong');
        heading.textContent = `${term.label} (${Number(record[term.field]).toFixed(2)})`;
        const list = document.createElement('ul');
        const termBreakdown = record.activity_breakdown[term.key];
        if (!termBreakdown) {
          const item = document.createElement('li');
          item.textContent = 'Direct term grade used; activity scores were not entered.';
          list.append(item);
        } else {
          categories.forEach(category => {
            const scores = termBreakdown[category.key];
            const average = Number((scores.reduce((total, score) => total + Number(score), 0) / scores.length).toFixed(2));
            const item = document.createElement('li');
            item.textContent = `${category.label} (${category.weight}%): ${scores.join(', ')} — average ${average.toFixed(2)}`;
            list.append(item);
          });
        }
        section.append(heading, list);
        container.append(section);
      });
      panel.hidden = false;
    }
    status.textContent = '';
  } catch (error) {
    status.textContent = error.message;
  }
})();
