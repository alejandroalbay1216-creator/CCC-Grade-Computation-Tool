const AUTH_URL = '../backend/public/api/auth.php';
const LOGIN_ROLE = document.body.dataset.loginRole;
const form = document.getElementById('loginForm');
const statusBox = document.getElementById('loginStatus');
const loginButton = document.getElementById('loginButton');
const registrationForm = document.getElementById('registrationForm');
let csrfToken = '';

if (LOGIN_ROLE === 'student' && new URLSearchParams(window.location.search).get('created') === '1') {
  statusBox.textContent = 'Account created successfully. Sign in with your username and password.';
  statusBox.className = 'success';
  window.history.replaceState(null, '', window.location.pathname);
}

async function readJson(response) {
  const text = await response.text();
  let result;
  try { result = JSON.parse(text); }
  catch { throw new Error(`The server returned an invalid response (HTTP ${response.status}).`); }
  if (!response.ok) throw new Error(result.error || 'Request failed.');
  return result;
}

function filterDisallowedCharacters(input, pattern) {
  const original = input.value;
  const cursorPosition = input.selectionStart;
  const filtered = original.replace(pattern, '');
  if (filtered === original) return;

  input.value = filtered;
  if (cursorPosition !== null) {
    const filteredCursorPosition = original.slice(0, cursorPosition).replace(pattern, '').length;
    input.setSelectionRange(filteredCursorPosition, filteredCursorPosition);
  }
}

if (LOGIN_ROLE !== 'admin' && LOGIN_ROLE !== 'student') {
  statusBox.textContent = 'Invalid login page configuration.';
  statusBox.className = 'error';
  loginButton.disabled = true;
} else {
  loginButton.disabled = true;
  fetch(AUTH_URL, { credentials: 'same-origin', headers: { Accept: 'application/json' } })
    .then(readJson)
    .then(session => {
      if (session.authenticated) {
        window.location.replace('index.html');
        return;
      }
      csrfToken = session.csrf_token;
      loginButton.disabled = false;
    })
    .catch(error => {
      statusBox.textContent = error.message;
      statusBox.className = 'error';
      loginButton.disabled = false;
    });
}

form.addEventListener('submit', async event => {
  event.preventDefault();
  if (!csrfToken) {
    statusBox.textContent = 'Unable to start a secure session. Refresh the page and try again.';
    statusBox.className = 'error';
    return;
  }
  const payload = {
    action: 'login',
    role: LOGIN_ROLE
  };
  if (LOGIN_ROLE === 'student') {
    payload.username = document.getElementById('username').value.trim();
    payload.password = document.getElementById('loginPassword').value;
  } else {
    payload.admin_pin = document.getElementById('adminPin').value;
  }

  loginButton.disabled = true;
  statusBox.textContent = 'Signing in…';
  statusBox.className = '';
  try {
    const response = await fetch(AUTH_URL, {
      method: 'POST',
      credentials: 'same-origin',
      headers: { 'Content-Type': 'application/json', 'X-CSRF-Token': csrfToken },
      body: JSON.stringify(payload)
    });
    await readJson(response);
    window.location.replace('login.html?created=1');
  } catch (error) {
    statusBox.textContent = error.message;
    statusBox.className = 'error';
  } finally {
    loginButton.disabled = false;
  }
});

if (registrationForm) {
  const registrationStatus = document.getElementById('registrationStatus');
  registrationForm.querySelectorAll('[data-name-input]').forEach(input => {
    input.addEventListener('input', () => filterDisallowedCharacters(input, /\p{N}/gu));
  });
  const studentIdInput = document.getElementById('registerStudentID');
  studentIdInput.addEventListener('input', () => filterDisallowedCharacters(studentIdInput, /[^0-9]/g));

  document.getElementById('showRegistration').addEventListener('click', () => {
    document.getElementById('loginSection').hidden = true;
    document.getElementById('registrationSection').hidden = false;
  });
  document.getElementById('backToLogin').addEventListener('click', () => {
    document.getElementById('registrationSection').hidden = true;
    document.getElementById('loginSection').hidden = false;
  });
  document.getElementById('toggleRegisterPassword').addEventListener('click', event => {
    const password = document.getElementById('registerPassword');
    const visible = password.type === 'password';
    password.type = visible ? 'text' : 'password';
    event.currentTarget.textContent = visible ? 'Hide' : 'Show';
    event.currentTarget.setAttribute('aria-label', visible ? 'Hide password' : 'Show password');
    event.currentTarget.setAttribute('aria-pressed', visible ? 'true' : 'false');
  });

  registrationForm.addEventListener('submit', async event => {
    event.preventDefault();
    if (!csrfToken) {
      registrationStatus.textContent = 'Unable to start a secure session. Refresh the page and try again.';
      registrationStatus.className = 'error';
      return;
    }
    const button = document.getElementById('registerButton');
    button.disabled = true;
    registrationStatus.textContent = 'Creating your account…';
    registrationStatus.className = '';
    try {
      const response = await fetch(AUTH_URL, {
        method: 'POST',
        credentials: 'same-origin',
        headers: { 'Content-Type': 'application/json', 'X-CSRF-Token': csrfToken },
        body: JSON.stringify({
          action: 'register',
          username: document.getElementById('registerUsername').value.trim(),
          first_name: document.getElementById('registerFirstName').value.trim(),
          middle_name: document.getElementById('registerMiddleName').value.trim(),
          last_name: document.getElementById('registerLastName').value.trim(),
          student_id: document.getElementById('registerStudentID').value.trim(),
          year_level: document.getElementById('registerYearLevel').value.trim(),
          department: document.getElementById('registerDepartment').value.trim(),
          password: document.getElementById('registerPassword').value
        })
      });
      await readJson(response);
      window.location.replace('index.html');
    } catch (error) {
      registrationStatus.textContent = error.message;
      registrationStatus.className = 'error';
    } finally {
      button.disabled = false;
    }
  });
}
