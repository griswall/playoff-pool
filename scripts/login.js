import { db, byId as $, result, onError, report } from './common.js';
const forms = ['login-form', 'signup-form', 'reset-request', 'reset-complete'];
const signedInCallback = new URLSearchParams(location.hash.slice(1)).has('access_token');
let recovery =
  location.hash.startsWith('#') &&
  new URLSearchParams(location.hash.slice(1)).get('type') === 'recovery';
function show(id, focus = true) {
  $('page-status').hidden = true;
  for (const name of forms) {
    $(name).classList.remove('hidden');
    $(name).hidden = name !== id;
  }
  if (focus) $(id).querySelector('input')?.focus();
}
function handle(id, callback) {
  $(id).addEventListener('submit', (e) => {
    e.preventDefault();
    const button = $(id).querySelector('button:not([type="button"])');
    if (button.disabled) return;
    button.disabled = true;
    $('page-status').hidden = true;
    Promise.resolve()
      .then(callback)
      .catch(report)
      .finally(() => {
        button.disabled = false;
      });
  });
}
function start() {
  const api = db();
  // A subscription here runs after Supabase resolves its redirect session.
  api.auth.onAuthStateChange((event) => {
    if (event === 'PASSWORD_RECOVERY') {
      recovery = true;
      show('reset-complete');
    }
  });
  show(recovery ? 'reset-complete' : 'login-form', false);
  if (signedInCallback && !recovery)
    api.auth
      .getSession()
      .then(result)
      .then(({ session }) => {
        if (session) location.replace('index.html');
      })
      .catch(report);
  $('toggle-to-signup').onclick = () => show('signup-form');
  $('toggle-to-login').onclick = () => show('login-form');
  $('forgot').onclick = () => {
    $('reset-email').value = $('login-email').value;
    show('reset-request');
  };
  $('back').onclick = () => show('login-form');
  const redirectTo = new URL('login.html', location.href).href;
  handle('login-form', async () => {
    result(
      await api.auth.signInWithPassword({
        email: $('login-email').value.trim(),
        password: $('login-password').value,
      }),
    );
    location.replace('index.html');
  });
  handle('signup-form', async () => {
    const data = result(
      await api.auth.signUp({
        email: $('signup-email').value.trim(),
        password: $('signup-password').value,
        options: { emailRedirectTo: redirectTo },
      }),
    );
    if (data.session) {
      location.replace('index.html');
      return;
    }
    $('login-email').value = $('signup-email').value.trim();
    $('signup-form').reset();
    show('login-form');
    report('Check your email for the confirmation link, then sign in.');
  });
  handle('reset-request', async () => {
    result(await api.auth.resetPasswordForEmail($('reset-email').value.trim(), { redirectTo }));
    report('If this address belongs to an account, check your email for a reset link.');
  });
  handle('reset-complete', async () => {
    if (!recovery) throw new Error('Open your password recovery link to continue.');
    result(await api.auth.updateUser({ password: $('new-password').value }));
    location.replace('index.html');
  });
}
onError(start)();
