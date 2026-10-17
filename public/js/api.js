// Small helper for calling our backend from the browser.
export async function api(path, { method = 'GET', body } = {}) {
  const res = await fetch('/api' + path, {
    method,
    credentials: 'same-origin',
    headers: {
      'X-Requested-With': 'fetch',
      ...(body ? { 'Content-Type': 'application/json' } : {}),
    },
    body: body ? JSON.stringify(body) : undefined,
  });
  let data = {};
  try { data = await res.json(); } catch { /* empty response */ }
  if (!res.ok) {
    const err = new Error(data.error || 'Something went wrong. Please try again.');
    err.status = res.status;
    err.fields = data.fields || {};
    throw err;
  }
  return data;
}

// Show server-side field errors under each input.
export function showErrors(form, message, fields = {}) {
  const alert = form.querySelector('.alert');
  if (alert) { alert.textContent = message || ''; alert.hidden = !message; }
  form.querySelectorAll('.field').forEach((f) => {
    const input = f.querySelector('input,select');
    const err = f.querySelector('.err');
    const msg = input && fields[input.name];
    if (input) input.setAttribute('aria-invalid', msg ? 'true' : 'false');
    if (err) err.textContent = msg || '';
  });
  const first = form.querySelector('[aria-invalid="true"]');
  if (first) first.focus();
}

export function busy(button, isBusy, label) {
  if (isBusy) { button.dataset.label = button.textContent; button.textContent = label; }
  else if (button.dataset.label) button.textContent = button.dataset.label;
  button.disabled = isBusy;
}

// Password show/hide toggles
export function wirePasswordToggles(root = document) {
  root.querySelectorAll('.pw button').forEach((btn) => {
    btn.addEventListener('click', () => {
      const input = btn.parentElement.querySelector('input');
      const show = input.type === 'password';
      input.type = show ? 'text' : 'password';
      btn.textContent = show ? 'Hide' : 'Show';
      btn.setAttribute('aria-pressed', String(show));
    });
  });
}

// Only allow redirects to our own pages (prevents open-redirect tricks).
export function safeNext(fallback = '/app') {
  const next = new URLSearchParams(location.search).get('next');
  return next && next.startsWith('/') && !next.startsWith('//') ? next : fallback;
}
