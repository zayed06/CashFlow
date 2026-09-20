const $ = id => document.getElementById(id);
const api = async (path, options = {}) => {
  const response = await fetch('/api/auth/' + path, { headers: { 'Content-Type': 'application/json' }, ...options });
  const data = await response.json();
  if (!response.ok) throw new Error(data.message || 'Request failed');
  return data;
};

function setMode(mode) {
  const login = mode === 'login';
  $('loginTab').classList.toggle('active', login);
  $('signupTab').classList.toggle('active', !login);
  $('loginView').hidden = !login;
  $('signupView').hidden = login;
  $('authMessage').textContent = '';
  history.replaceState({}, '', login ? '/login' : '/signup');
}

$('loginTab').onclick = () => setMode('login');
$('signupTab').onclick = () => setMode('signup');

$('loginForm').onsubmit = async e => {
  e.preventDefault();
  try {
    await api('login', { method: 'POST', body: JSON.stringify({ email: $('loginEmail').value, password: $('loginPassword').value }) });
    location.href = '/';
  } catch (error) { $('authMessage').textContent = error.message; }
};

$('signupForm').onsubmit = async e => {
  e.preventDefault();
  if ($('signupPassword').value !== $('signupConfirm').value) { $('authMessage').textContent = 'Passwords do not match.'; return; }
  try {
    await api('signup', { method: 'POST', body: JSON.stringify({ name: $('signupName').value, email: $('signupEmail').value, password: $('signupPassword').value }) });
    location.href = '/';
  } catch (error) { $('authMessage').textContent = error.message; }
};

fetch('/api/auth/me').then(r => { if (r.ok) location.href = '/'; });
setMode(location.pathname === '/signup' ? 'signup' : 'login');

window.handleCredentialResponse = async (response) => {
  try {
    const { credential } = response;
    await api('google', {
      method: 'POST',
      body: JSON.stringify({ credential })
    });
    location.href = '/';
  } catch (error) {
    $('authMessage').textContent = error.message || 'Google authentication failed';
  }
};
