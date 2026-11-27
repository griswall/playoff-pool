// Pass PLAYWRIGHT_MODULE and CHROME_PATH to use an existing local Playwright installation.
// Every HTTP request is handled below. No production user or API connection is used.
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
const { chromium } = await import(process.env.PLAYWRIGHT_MODULE || 'playwright');
const dir = fileURLToPath(new URL('../dist/', import.meta.url));
const origin = 'https://playoff-pool.vercel.app',
  api = 'https://jlsudfmhsmxmxpdtkrzr.supabase.co';
const csp = JSON.parse(
  await fs.readFile(new URL('../vercel.json', import.meta.url), 'utf8'),
).headers[0].headers.find((h) => h.key === 'Content-Security-Policy').value;
const browser = await chromium.launch({
  headless: true,
  executablePath: process.env.CHROME_PATH || undefined,
});
let context;
try {
  context = await browser.newContext({
    serviceWorkers: 'block',
    viewport: { width: 1440, height: 900 },
  });
  const users = {
    id: '00000000-0000-4000-8000-000000000010',
    aud: 'authenticated',
    email: 'demo@example.invalid',
  };
  const now = Math.floor(Date.now() / 1000);
  const token =
    Buffer.from(JSON.stringify({ alg: 'HS256', typ: 'JWT' })).toString('base64url') +
    '.' +
    Buffer.from(JSON.stringify({ sub: users.id, role: 'authenticated', exp: now + 3600 })).toString(
      'base64url',
    ) +
    '.ZmFrZQ';
  const session = {
    user: users,
    access_token: token,
    token_type: 'bearer',
    refresh_token: 'fixture-only',
    expires_in: 3600,
    expires_at: now + 3600,
  };
  const positions = ['QB', 'RB', 'RB', 'RB', 'WR', 'WR', 'WR', 'TE', 'DST', 'K'];
  const catalog = positions.map((position, i) => ({
    id: i + 1,
    position,
    team: 'Team ' + i,
    salary: 1000000,
    name: i === 0 ? 'QB <test>' : 'Player ' + i,
    image_url: null,
    espn_id: null,
  }));
  const stored = {
    id: 11,
    team_name: 'Entry <one>',
    created_at: '2025-01-01T00:00:00Z',
    team_players: ['QB', 'RB1', 'RB2', 'RB3', 'WR1', 'WR2', 'WR3', 'FLEX', 'DST', 'K'].map(
      (roster_slot, i) => ({ roster_slot, player_id: i + 1, players: catalog[i] }),
    ),
  };
  await context.addInitScript((session) => {
    if (location.hostname === 'playoff-pool.vercel.app')
      localStorage.setItem('sb-jlsudfmhsmxmxpdtkrzr-auth-token', JSON.stringify(session));
  }, session);
  const requests = [],
    unhandled = [],
    errors = [];
  let failOnce = true,
    deleted = false,
    authSignup = false,
    locked = false;
  await context.route('**/*', async (route) => {
    const req = route.request(),
      u = new URL(req.url());
    if (u.origin === origin || u.origin === 'https://preview.invalid') {
      const file = path.resolve(dir, '.' + (u.pathname === '/' ? '/index.html' : u.pathname));
      if (!file.startsWith(dir) || u.pathname === '/favicon.ico') {
        await route.fulfill({ status: 404, body: '' });
        return;
      }
      const ext = path.extname(file);
      await route.fulfill({
        status: 200,
        headers: { 'Content-Security-Policy': csp },
        body: await fs.readFile(file),
        contentType: { '.html': 'text/html', '.js': 'application/javascript', '.css': 'text/css' }[
          ext
        ],
      });
      return;
    }
    if (u.origin !== api) {
      unhandled.push(u.hostname);
      await route.abort();
      return;
    }
    const name = u.pathname.split('/').at(-1),
      method = req.method(),
      body = req.postData() ? JSON.parse(req.postData()) : null;
    requests.push({ name, method, body });
    const json = (v, status = 200) =>
      route.fulfill({
        status,
        contentType: 'application/json',
        headers: { 'Access-Control-Allow-Origin': '*' },
        body: JSON.stringify(v),
      });
    if (name === 'is_admin_user') return json(true);
    if (name === 'app_settings') return json({ entries_locked: locked, show_ownership: false });
    if (name === 'players') return json(catalog);
    if (name === 'player_scores')
      return json([
        { player_id: 1, playoff_round: 'WC', points: 0 },
        { player_id: 1, playoff_round: 'DIV', points: null },
      ]);
    if (name === 'get_standings')
      return json([{ rank: 1, team_name: 'Entry <one>', total_points: 0 }]);
    if (name === 'save_roster') {
      if (failOnce) {
        failOnce = false;
        return json({ code: 'P0001', message: 'Fixture save failed.' }, 400);
      }
      return json(11);
    }
    if (name === 'user_teams') {
      if (method === 'DELETE') {
        deleted = true;
        return json({ id: 11 });
      }
      if (u.searchParams.has('id')) return json(stored);
      return json(deleted ? [] : [stored]);
    }
    if (name === 'bulk_upsert_player_scores') return json(null);
    if (name === 'signup') {
      authSignup = true;
      return json(users);
    }
    if (name === 'recover') return json({});
    unhandled.push(name);
    return route.abort();
  });
  const page = await context.newPage();
  page.on('pageerror', (e) => errors.push(e.message));
  page.setDefaultTimeout(3500);
  await page.goto(origin + '/index.html');
  await page.locator('.player-card').first().waitFor();
  assert.equal(await page.locator('.player-card').count(), 10);
  assert(
    !requests.some((r) =>
      ['get_player_ownership', 'get_standings', 'player_scores'].includes(r.name),
    ),
  );
  await page.locator('[data-player-id="1"]').focus();
  await page.keyboard.press('Enter');
  await page.locator('[data-player-id="1"]').evaluate((button) => button.click());
  assert.equal(await page.locator('#roster-count').textContent(), '1');
  for (let id = 2; id <= 10; id++) await page.locator('[data-player-id="' + id + '"]').click();
  await page.locator('#submit-team-button').click();
  await page.locator('#prompt-modal-input').fill('Fixture entry');
  await page.locator('#prompt-modal-confirm-btn').click();
  await page.getByText('Fixture save failed.').waitFor();
  assert.equal(await page.locator('#roster-count').textContent(), '10');
  await page.locator('#prompt-modal-confirm-btn').click();
  await page.getByRole('heading', { name: 'Team submitted' }).waitFor();
  const attempts = requests.filter((r) => r.name === 'save_roster');
  assert.equal(attempts.length, 2);
  assert.deepEqual(attempts[0].body, attempts[1].body);
  assert.equal(attempts[1].body.p_roster.length, 10);
  assert.equal(attempts[1].body.p_team_id, null);
  await page.locator('#alert-modal-close-btn').click();
  await page.locator('#nav-player-scores').click();
  await page.locator('#player-scores-list tbody tr').first().waitFor();
  assert.deepEqual(
    (
      await page.locator('#player-scores-list tbody tr').first().locator('td').allTextContents()
    ).slice(1, 3),
    ['0', '—'],
  );
  assert(!requests.some((r) => r.name === 'get_player_ownership'));
  await page.locator('#nav-standings').click();
  await page.getByText('Entry <one>').waitFor();
  await page.goto(origin + '/index.html?edit_team_id=11');
  await page.locator('#submit-team-button:enabled').waitFor();
  await page.locator('#submit-team-button').click();
  assert.equal(await page.locator('#prompt-modal-input').inputValue(), 'Entry <one>');
  await page.locator('#prompt-modal-confirm-btn').click();
  await page.waitForURL('**/my-teams.html');
  await page.getByRole('button', { name: 'Entry <one>' }).waitFor();
  assert.equal(requests.filter((r) => r.name === 'save_roster').at(-1).body.p_team_id, 11);
  await page.getByRole('button', { name: 'Delete', exact: true }).click();
  await page.locator('#confirm-modal-confirm-btn').click();
  await page.getByRole('heading', { name: 'No Teams Yet' }).waitFor();
  assert(deleted);
  await page.goto(origin + '/admin.html');
  const input = page.locator('input[data-player-id="1"][data-round="WC"]');
  await input.waitFor();
  await input.fill('2.5');
  await page.locator('#save-scores-btn').click();
  await page.getByText('Saved 1 score changes.').waitFor();
  assert.deepEqual(
    requests.filter((r) => r.name === 'bulk_upsert_player_scores').at(-1).body.scores_to_update,
    [{ player_id_to_update: 1, round_to_update: 'WC', points_to_update: 2.5 }],
  );
  await page.goto(origin + '/admin_importer.html');
  await page.getByText('Choose a CSV to preview.').waitFor();
  await page
    .locator('#file-input')
    .setInputFiles({
      name: 'zero.csv',
      mimeType: 'text/csv',
      buffer: Buffer.from('Player ID,WC,DIV,CONF,SB\n1,0,,,'),
    });
  await page.getByText('1 scores ready for review.').waitFor();
  await page.locator('#upload-btn').click();
  await page.getByText('Saved 1 scores.').waitFor();
  assert.equal(
    requests.filter((r) => r.name === 'bulk_upsert_player_scores').at(-1).body.scores_to_update[0]
      .points_to_update,
    0,
  );
  await page.goto(origin + '/login.html');
  await page.locator('#toggle-to-signup').click();
  await page.locator('#signup-email').fill('fixture@example.invalid');
  await page.locator('#signup-password').fill('test-only-1234');
  await page.locator('#signup-submit-button').click();
  await page.getByText(/Check your email for the confirmation/).waitFor();
  assert(authSignup);
  await page.locator('#forgot').click();
  await page.locator('#reset-email').fill('fixture@example.invalid');
  await page.getByRole('button', { name: 'Send reset link' }).click();
  await page.getByText(/If this address belongs/).waitFor();
  const before = requests.length;
  await page.goto('https://preview.invalid/');
  await page.getByText(/preview needs its own/).waitFor();
  assert.equal(requests.length, before);
  locked = true;
  await page.goto(origin + '/index.html');
  await page.getByText('Entries are locked.').waitFor();
  assert.equal(await page.locator('.player-card:enabled').count(), 0);
  await page.setViewportSize({ width: 390, height: 844 });
  await page.getByRole('button', { name: 'My Team', exact: true }).click();
  await page.getByRole('dialog', { name: 'Your lineup' }).waitFor();
  await page.keyboard.press('Escape');
  assert.equal(await page.locator('#roster-drawer').isVisible(), false);
  await page.getByRole('button', { name: 'League menu' }).click();
  await page.locator('#mobile-logout').waitFor();
  assert(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth));
  assert.deepEqual(unhandled, []);
  assert.deepEqual(errors, []);
  console.log(
    'PASS: keyboard draft, duplicate selection, atomic save retry, edit/delete, literal names, lazy views, score zero/null, changed scores, CSV preview, signup confirmation, reset request, preview isolation and locked entries. All browser requests intercepted.',
  );
} finally {
  await browser.close();
}
