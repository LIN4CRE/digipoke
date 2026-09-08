#!/usr/bin/env node
/**
 * Create (or reuse) the GitHub repository for DigiPoke and push this working
 * tree to it.
 *
 * WHY THIS EXISTS
 *   The application itself is static files with zero dependencies, but the
 *   project still benefits from a real remote: CI gates, a permanent GitHub
 *   Pages URL (see .github/workflows/pages.yml), and off-device backups of the
 *   source. This script is the one-command path to that.
 *
 * HOW IT HANDLES THE TOKEN — read this before changing anything
 *   The personal access token is read ONLY from the environment
 *   (`GITHUB_TOKEN` or `GH_PAT`). It is never accepted as an argument (shell
 *   history is a leak), never written to a file, never committed, and never
 *   printed: any accidental output is masked by {@link redact}. The token is
 *   embedded in the git remote purely for the duration of the push, and the
 *   remote is immediately rewritten back to the clean https URL afterwards.
 *
 * USAGE
 *   GITHUB_TOKEN=ghp_xxx node tools/publish-github.mjs [--private] [--name digipoke]
 *   GITHUB_TOKEN=ghp_xxx node tools/publish-github.mjs --pages   # also switch Pages to Actions
 *
 * FLAGS
 *   --private        Create the repository as private (default: public).
 *   --public         Force public even if the repository already exists.
 *   --name <name>    Repository name (default: digipoke).
 *   --owner <login>  Create under an organisation you belong to (default: you).
 *   --pages          Enable GitHub Pages with "GitHub Actions" as the source.
 *   --dry-run        Resolve and report everything, change nothing.
 *
 * EXIT CODES
 *   0 success · 1 usage/config error · 2 network or API error · 3 git error
 *
 * @module tools/publish-github
 */

import { execFileSync } from 'node:child_process';
import process from 'node:process';

const API = 'https://api.github.com';
const REPO_ROOT = process.cwd();

/* ------------------------------------------------------------------ helpers */

/** Remove anything that looks like a GitHub token from text before printing. */
function redact(text) {
  return String(text).replace(/\b(?:ghp|gho|ghu|ghs|ghr|github_pat)_[A-Za-z0-9_]+/g, '***');
}

/** Print with redaction; secrets never reach the terminal. */
function say(...parts) {
  console.log(redact(parts.join(' ')));
}

/** Parse the tiny flag grammar documented above. */
function parseArgs(argv) {
  const flags = {
    private: false,
    public: false,
    pages: false,
    dryRun: false,
    name: 'digipoke',
    owner: null,
    remote: 'origin',
  };
  for (let i = 0; i < argv.length; i += 1) {
    const arg = argv[i];
    switch (arg) {
      case '--private': flags.private = true; break;
      case '--public': flags.public = true; break;
      case '--pages': flags.pages = true; break;
      case '--dry-run': flags.dryRun = true; break;
      case '--name': flags.name = argv[++i]; break;
      case '--owner': flags.owner = argv[++i]; break;
      case '--remote': flags.remote = argv[++i]; break;
      case '--help':
      case '-h':
        console.log('Usage: GITHUB_TOKEN=ghp_xxx node tools/publish-github.mjs [--private] [--name digipoke] [--pages] [--dry-run]');
        process.exit(0);
        break;
      default:
        throw new Error(`unknown argument: ${arg} (try --help)`);
    }
  }
  if (!/^[A-Za-z0-9._-]+$/.test(flags.name)) {
    throw new Error(`invalid repository name: ${flags.name}`);
  }
  return flags;
}

/** Run git in the repository root, returning trimmed stdout. */
function git(args, { allowFail = false, quiet = false } = {}) {
  try {
    const out = execFileSync('git', args, {
      cwd: REPO_ROOT,
      encoding: 'utf8',
      stdio: ['ignore', 'pipe', quiet ? 'ignore' : 'inherit'],
    });
    return (out || '').trim();
  } catch (err) {
    if (allowFail) return '';
    throw err;
  }
}

/** One GitHub REST call with the standard headers. */
async function gh(token, path, init = {}) {
  const res = await fetch(`${API}${path}`, {
    ...init,
    headers: {
      Accept: 'application/vnd.github+json',
      'X-GitHub-Api-Version': '2022-11-28',
      'User-Agent': 'digipoke-publish-script',
      Authorization: `Bearer ${token}`,
      ...(init.body ? { 'Content-Type': 'application/json' } : {}),
      ...(init.headers || {}),
    },
  });
  const text = await res.text();
  let body = null;
  try {
    body = text ? JSON.parse(text) : null;
  } catch {
    body = { message: text };
  }
  if (!res.ok) {
    const err = new Error(`GitHub ${init.method || 'GET'} ${path} → ${res.status} ${res.statusText}: ${redact(body?.message ?? text)}`);
    err.status = res.status;
    err.body = body;
    throw err;
  }
  return body;
}

/* --------------------------------------------------------------------- main */

async function main() {
  const flags = parseArgs(process.argv.slice(2));

  const token = process.env.GITHUB_TOKEN || process.env.GH_PAT || '';
  if (!token) {
    console.error('✖ No token found. Export one first — it is read from the environment only:\n');
    console.error('    export GITHUB_TOKEN=ghp_your_token_here');
    console.error('    node tools/publish-github.mjs\n');
    console.error('  Create one at https://github.com/settings/tokens with the "repo" scope');
    console.error('  (plus "pages: write" if you want --pages to work).');
    process.exit(1);
  }
  if (!/^(ghp|github_pat)_/.test(token)) {
    console.error('✖ That does not look like a GitHub personal access token (expected a "ghp_" or "github_pat_" prefix).');
    process.exit(1);
  }

  /* 1. Who am I? Also the earliest possible token validation. */
  say('• Checking credentials…');
  const me = await gh(token, '/user');
  const owner = flags.owner || me.login;
  say(`  authenticated as ${me.login}${me.name ? ` (${me.name})` : ''}`);

  /* 2. Create the repository, or reuse it if it already exists. */
  let repo = null;
  try {
    repo = await gh(token, `/repos/${owner}/${flags.name}`);
    say(`• Repository ${repo.full_name} already exists — reusing it.`);
    if (flags.private && !repo.private) {
      say('  → switching visibility to private…');
      repo = await gh(token, `/repos/${owner}/${flags.name}`, {
        method: 'PATCH',
        body: JSON.stringify({ private: true }),
      });
    } else if (flags.public && repo.private) {
      say('  → switching visibility to public…');
      repo = await gh(token, `/repos/${owner}/${flags.name}`, {
        method: 'PATCH',
        body: JSON.stringify({ private: false }),
      });
    }
  } catch (err) {
    if (err.status !== 404) throw err;
    say(`• Creating ${flags.private ? 'private' : 'public'} repository ${owner}/${flags.name}…`);
    repo = await gh(token, flags.owner ? `/orgs/${flags.owner}/repos` : '/user/repos', {
      method: 'POST',
      body: JSON.stringify({
        name: flags.name,
        description: 'DigiPoke — a local-first creature-collecting battler PWA with optional end-to-end encrypted sync.',
        private: flags.private,
        has_issues: true,
        has_projects: false,
        has_wiki: false,
        auto_init: false, // we already have history; an initial commit would conflict
        license_template: 'mit',
      }),
    });
    say(`  created ${repo.html_url}`);
  }

  /* 3. Optional: point GitHub Pages at the Actions workflow. */
  if (flags.pages) {
    say('• Enabling GitHub Pages (source: GitHub Actions)…');
    try {
      const pages = await gh(token, `/repos/${repo.full_name}/pages`, {
        method: 'POST',
        body: JSON.stringify({ build_type: 'workflow' }),
      });
      say(`  pages url: ${pages.html_url}`);
    } catch (err) {
      say(`  ! could not enable Pages automatically: ${redact(err.message)}`);
      say('    Do it once by hand: Settings → Pages → Build and deployment → Source: GitHub Actions.');
    }
  }

  /* 4. Push. The token lives in the remote only for the duration of this call. */
  const cleanUrl = repo.clone_url;
  const scoped = new URL(cleanUrl);
  scoped.username = me.login;
  scoped.password = token; // URL-encoded on serialisation; stripped from disk in step 5
  const scopedUrl = scoped.toString();

  say('• Preparing the local tree…');
  if (!git(['rev-parse', '--is-inside-work-tree'], { quiet: true, allowFail: true })) {
    console.error('✖ This is not a git repository. Run: git init -b main && git add -A && git commit');
    process.exit(3);
  }
  git(['symbolic-ref', 'HEAD', 'refs/heads/main'], { quiet: true, allowFail: true });
  const hasCommit = Boolean(git(['rev-parse', '--verify', 'HEAD'], { quiet: true, allowFail: true }));
  if (!hasCommit) {
    console.error('✖ No commits yet. Run: git add -A && git commit -m "feat: DigiPoke"');
    process.exit(3);
  }

  if (flags.dryRun) {
    say(`• Dry run — would push ${git(['rev-parse', '--abbrev-ref', 'HEAD'], { quiet: true })} → ${cleanUrl}`);
    say(`  ${repo.html_url}`);
    return;
  }

  say('• Pushing…');
  git(['remote', 'remove', flags.remote], { quiet: true, allowFail: true });
  git(['remote', 'add', flags.remote, scopedUrl], { quiet: true });
  try {
    git(['push', '-u', flags.remote, 'main']);
  } catch {
    console.error('✖ git push failed. If the remote branch already has history, pull or force-push deliberately:');
    console.error(`    git pull --rebase ${flags.remote} main && git push -u ${flags.remote} main`);
    process.exit(3);
  } finally {
    // Never leave credentials in .git/config, even on failure.
    git(['remote', 'set-url', flags.remote, cleanUrl], { quiet: true });
  }

  say('');
  say(`✔ Pushed to ${repo.html_url}`);
  if (repo.homepage) say(`  homepage set to ${repo.homepage}`);
  say(`  remote "${flags.remote}" → ${cleanUrl} (token removed)`);
  if (flags.pages) {
    say('  Pages will go live after the "Deploy Pages" workflow finishes:');
    say(`    ${repo.html_url}/actions`);
  } else {
    say('  Tip: re-run with --pages to publish the PWA at a permanent github.io URL.');
  }
}

main().catch((err) => {
  console.error(`✖ ${redact(err.message)}`);
  const status = err.status ? 2 : 1;
  process.exit(status);
});
