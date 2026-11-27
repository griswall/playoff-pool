# Hurd NFL Playoff Pool

This rebuild preserves the draft board, My Teams, standings, round scores, manual scoring and CSV import from the original family pool. Supabase Auth identifies each participant. The database migration included in the recovery handoff provides the atomic `save_roster` RPC, ownership checks and score authorization. Apply the compatible schema before using a separate staging project.

## Build and run

Use Node 22 or later. From this directory run:

```sh
npm ci
npm test
npm run build
python3 -m http.server 8080 --directory dist
```

Open http://localhost:8080. The existing production configuration permits connections only on `playoff-pool.vercel.app`. For local development or a Vercel preview, set both `VITE_SUPABASE_URL` and `VITE_SUPABASE_ANON_KEY` to your **staging** Supabase project before building. The key must be a publishable key or legacy anonymous browser key. The build reads these variables at build time and embeds the public settings. Configure Auth's site and redirect URLs for the staging origin, including its `/login.html` callback. Keep the project’s existing `.supabase.co` endpoint or adjust the CSP in `vercel.json` for a trusted custom API domain.

Vercel can deploy this directory as the repository root. `vercel.json` runs the build and serves `dist/`. The stable production hostname uses the original project's public configuration from `public-config.json` if the two variables are absent. The browser refuses that production configuration on other hostnames. Use an isolated staging project to test changes. Access control for database operations is enforced by Supabase policies and functions.

Each HTML page loads locally bundled JavaScript and precompiled CSS. Filenames change with their content and can be cached for a year. The original Inter and JetBrains Mono faces are served from this origin on demand, with their SIL Open Font Licenses included in the output. Player photos load lazily from ESPN with an initial shown when an image is unavailable.

## Data behavior

- A save sends ten slot/player pairs in one `save_roster` call. New entries reuse the same request ID when retried within the draft. A save error leaves the draft and name in the page. Reloading the page starts a new draft.
- Draft, scores and standings load when opened. The score view respects the league’s ownership visibility flag. A zero is displayed as 0 and an unentered round as a dash.
- The score editor submits just the cells you changed. Clearing a previously scored field in this editor saves a null. The CSV importer leaves blanks untouched. Use an explicit 0 for a zero-point score. Both accept the database range of -999.99 to 999.99 at up to two decimal places.
- A CSV needs one column for each of WC, DIV, CONF and SB and either Player ID or Player Name. Player ID resolves names shared by multiple catalog rows. Unknown or ambiguous players, mismatched ID/name pairs, malformed numbers and duplicate score cells stop the import at preview. Review the player IDs, names, rounds and values before clicking **Save previewed changes**.
- The legacy leaderboard already aggregates the pool on the server. Existing participants continue to sign in with their existing Supabase credentials. The separate native ChatGPT Sites setup in the recovery handoff covers Sites identity and its transfer boundaries.

## Verification

`npm test` covers CSV quoting, precision, zero/blank handling and duplicate-name resolution. `tests/browser-smoke.mjs` exercises all five built pages with synthetic players and intercepted API responses. It also verifies that a preview targeting the production project is rejected locally. To run the latter, build using the default production public configuration, supply an installed Playwright module with `PLAYWRIGHT_MODULE` and optionally the Chrome executable with `CHROME_PATH`, then run `node tests/browser-smoke.mjs`. The browser test intercepts every request before navigation. It does not sign into a real participant account.
