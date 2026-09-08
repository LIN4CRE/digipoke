#!/usr/bin/env node
/**
 * deploy-pages.mjs — publish the PWA to GitHub Pages from the `gh-pages` branch.
 *
 * WHY THIS EXISTS
 *   `.github/workflows/pages.yml` is the intended deployment path, but GitHub
 *   Actions does not run on every account out of the box. This script is the
 *   zero-infrastructure equivalent: it builds a clean tree containing the
 *   application at its root (plus the single-file build as `single.html`),
 *   commits it to an orphan `gh-pages` branch and pushes it. GitHub Pages then
 *   serves it from https://<owner>.github.io/<repo>/ with no workflow, no
 *   runner and no waiting for CI.
 *
 *   Both paths publish the same thing, so switching later is safe: enable
 *   Actions, let the workflow run once, and it takes over.
 *
 * WHAT GETS PUBLISHED
 *   Every file in apps/web/ — index.html, the module graph, styles, assets and
 *   the service worker — because apps/web IS the application (no build step).
 *   dist/digipoke.html is added as single.html so the no-install build is
 *   downloadable from the site.
 *
 * USAGE
 *   GITHUB_TOKEN=ghp_xxx node tools/deploy-pages.mjs [--branch gh-pages] [--dry-run]
 *
 *   Without a token the script falls back to whatever git credentials are
 *   already configured (SSH agent, credential helper, …). The token is passed
 *   to git through an `http.extraheader`, never through the remote URL, so it
 *   is never written to .git/config.
 *
 * @module tools/deploy-pages
 */

import { execFileSync } from 'node:child_process';
import { cpSync, mkdtempSync, rmSync, existsSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import process from 'node:process';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const BRANCH = process.argv.includes('--branch')
  ? process.argv[process.argv.indexOf('--branch') + 1]
  : 'gh-pages';
const DRY_RUN = process.argv.includes('--dry-run');

const redact = (s) => String(s).replace(/\b(?:ghp|gho|ghu|ghs|ghr|github_pat)_[A-Za-z0-9_]+/g, '***');

/** Resolve `${owner}/${repo}` and the Pages URL from the existing git remote. */
function remoteInfo() {
  const url = execFileSync('git', ['remote', 'get-url', 'origin'], { cwd: ROOT, encoding: 'utf8' }).trim();
  const m = url.match(/github\.com[:/]([^/]+)\/([^/]+?)(?:\.git)?$/);
  if (!m) throw new Error(`cannot work out the GitHub owner/repo from origin: ${url}`);
  return { owner: m[1], repo: m[2], url };
}

/** Run git inside `cwd`, inheriting stderr so failures are visible. */
function git(cwd, args, env = null) {
  return execFileSync('git', args, {
    cwd,
    encoding: 'utf8',
    stdio: ['ignore', 'pipe', 'inherit'],
    ...(env ? { env: { ...process.env, ...env } } : {}),
  }).trim();
}

console.log('• Building the single-file bundle…');
execFileSync(process.execPath, [join(ROOT, 'tools', 'build-single.mjs')], { cwd: ROOT, stdio: 'inherit' });

const single = join(ROOT, 'dist', 'digipoke.html');
if (!existsSync(single)) throw new Error('dist/digipoke.html was not produced — build:single failed');

const { owner, repo, url: remote } = remoteInfo();
const pagesUrl = `https://${owner.toLowerCase()}.github.io/${repo}/`;
console.log(`• Preparing a clean tree for ${owner}/${repo}…`);

const work = mkdtempSync(join(tmpdir(), 'digipoke-pages-'));
cpSync(join(ROOT, 'apps', 'web'), work, { recursive: true, dereference: true });
cpSync(single, join(work, 'single.html'));

git(work, ['init', '-q', '-b', 'main']);
git(work, ['config', 'user.name', git(ROOT, ['log', '-1', '--format=%an']) || 'DigiPoke']);
git(work, ['config', 'user.email', git(ROOT, ['log', '-1', '--format=%ae']) || 'deploy@local']);
git(work, ['add', '-A']);
git(work, ['commit', '-q', '-m', `Deploy: DigiPoke PWA (${new Date().toISOString().slice(0, 10)})`]);

if (DRY_RUN) {
  console.log(`• Dry run — ${git(work, ['rev-parse', '--short', 'HEAD'])} ready for ${remote} ${BRANCH}`);
  rmSync(work, { recursive: true, force: true });
  console.log(`  would be published at ${pagesUrl}`);
  process.exit(0);
}

console.log(`• Pushing to ${BRANCH}…`);
const token = process.env.GITHUB_TOKEN || process.env.GH_PAT || '';
const extra = token
  ? ['-c', `http.extraheader=AUTHORIZATION: basic ${Buffer.from(`${owner}:${token}`).toString('base64')}`]
  : [];
git(work, [...extra, 'push', '-q', '-f', remote, `main:${BRANCH}`]);
rmSync(work, { recursive: true, force: true });

console.log('');
console.log(`✔ Published to ${BRANCH}`);
console.log(`  live at ${pagesUrl} (GitHub rebuilds it within ~30 s)`);
if (!token) console.log('  (pushed with your existing git credentials — no token was used)');
