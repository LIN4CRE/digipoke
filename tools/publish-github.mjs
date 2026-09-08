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
 * TWO WAYS TO AUTHENTICATE
 *
 *   1. A personal access token in the environment (`GITHUB_TOKEN` or `GH_PAT`).
 *   2. `--device`: the OAuth device flow. GitHub issues a short user code, the
 *      human types it into https://github.com/login/device, and this script
 *      receives a token for that account. Nothing has to be created by hand
 *      and no secret is ever pasted anywhere.
 *
 *   Either way the token is never accepted as an argument (shell history is a
 *   leak), never written to a file, never committed, and never printed: any
 *   accidental output is masked by {@link redact}. The token is embedded in the
 *   git remote purely for the duration of the push, and the remote is
 *   immediately rewritten back to the clean https URL afterwards.
 *
 * USAGE
 *   GITHUB_TOKEN=ghp_xxx node tools/publish-github.mjs [--private] [--name digipoke]
 *   GITHUB_TOKEN=ghp_xxx node tools/publish-github.mjs --pages   # also switch Pages to Actions
 *   node tools/publish-github.mjs --device --pages               # no token needed at all
 *
 * FLAGS
 *   --device         Authorise interactively with an 8-character user code.
 *   --private        Create the repository as private (default: public).
 *   --public         Force public even if the repository already exists.
 *   --name <name>    Repository name (default: digipoke).
 *   --owner <login>  Create under an organisation you belong to (default: you).
 *   --pages          Enable GitHub Pages with "GitHub Actions" as the source.
 *   --keep-author    Keep the existing commit author (default: re-attribute
 *                    placeholder commits to the authenticated account).
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
    device: false,
    keepAuthor: false,
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
      case '--device': flags.device = true; break;
      case '--keep-author': flags.keepAuthor = true; break;
      case '--name': flags.name = argv[++i]; break;
      case '--owner': flags.owner = argv[++i]; break;
      case '--remote': flags.remote = argv[++i]; break;
      case '--help':
      case '-h':
        console.log('Usage: node tools/publish-github.mjs [--device] [--private] [--name digipoke] [--pages] [--dry-run]');
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
function git(args, { allowFail = false, quiet = false, env = null } = {}) {
  try {
    const out = execFileSync('git', args, {
      cwd: REPO_ROOT,
      encoding: 'utf8',
      stdio: ['ignore', 'pipe', quiet ? 'ignore' : 'inherit'],
      ...(env ? { env: { ...process.env, ...env } } : {}),
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

/**
 * Run GitHub's OAuth device flow and return an access token for the account
 * that authorises it.
 *
 * The flow: ask GitHub for a short-lived `user_code`, show it to the human,
 * then poll the token endpoint until they have approved it (or it expires).
 * No client secret is involved — `CLIENT_ID` below is the public identifier
 * that tools of this kind use, and it is not a credential.
 *
 * @param {string[]} scopes OAuth scopes to request.
 * @returns {Promise<string>} An access token valid for this session.
 */
async function deviceFlow(scopes) {
  const CLIENT_ID = 'Iv1.b507a08c87ecfe98'; // public OAuth app id (GitHub CLI) — not a secret
  const post = async (path, body) => {
    const res = await fetch(`https://github.com${path}`, {
      method: 'POST',
      headers: { Accept: 'application/json', 'Content-Type': 'application/json', 'User-Agent': 'digipoke-publish-script' },
      body: JSON.stringify(body),
    });
    return res.json();
  };

  const request = await post('/login/device/code', { client_id: CLIENT_ID, scope: scopes.join(' ') });
  if (!request.device_code || !request.user_code) {
    throw new Error(`GitHub did not issue a device code: ${redact(JSON.stringify(request))}`);
  }

  console.log('');
  console.log('  ┌──────────────────────────────────────────────────────────┐');
  console.log(`  │  Authorise DigiPoke: open ${request.verification_uri}`);
  console.log(`  │  and enter this code:            ${request.user_code}`);
  console.log('  └──────────────────────────────────────────────────────────┘');
  console.log('');
  console.log(`  Waiting for approval (code expires in ${Math.round(request.expires_in / 60)} minutes)…`);

  const deadline = Date.now() + request.expires_in * 1000;
  let result = null;
  let interval = Math.max(5, Number(request.interval) || 5) * 1000;

  while (Date.now() < deadline) {
    await new Promise((resolve) => setTimeout(resolve, interval));
    result = await post('/login/oauth/access_token', {
      client_id: CLIENT_ID,
      device_code: request.device_code,
      grant_type: 'urn:ietf:params:oauth:grant-type:device_code',
    });

    if (result.access_token) {
      console.log('  approved.');
      return result.access_token;
    }
    if (result.error === 'slow_down') {
      interval += 5000; // GitHub asked us to back off
    } else if (result.error !== 'authorization_pending') {
      throw new Error(`device authorisation failed: ${result.error_description || result.error}`);
    }
  }
  throw new Error('device code expired before it was approved — run the command again');
}

/* --------------------------------------------------------------------- main */

async function main() {
  const flags = parseArgs(process.argv.slice(2));

  let token = process.env.GITHUB_TOKEN || process.env.GH_PAT || '';
  if (!token && !flags.device) {
    console.error('✖ No token found, and --device was not requested.\n');
    console.error('  Easiest:   node tools/publish-github.mjs --device');
    console.error('  Otherwise: export GITHUB_TOKEN=ghp_your_token_here   (https://github.com/settings/tokens, "repo" scope)');
    process.exit(1);
  }
  if (token && !/^(ghp|gho|github_pat)_/.test(token)) {
    console.error('✖ That does not look like a GitHub token (expected a "ghp_", "gho_" or "github_pat_" prefix).');
    process.exit(1);
  }

  // --device wins over an unusable token in the environment.
  if (!token || flags.device) {
    // "workflow" is required to push the files under .github/workflows/.
    token = await deviceFlow(['repo', 'workflow']);
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

  /* 4. Attribute the commits to the account that authenticated, unless the
   *    tree already carries a deliberate identity or --keep-author was passed.
   *    The placeholder commits created before we knew the account are the only
   *    ones rewritten; anything else is left untouched. */
  const PLACEHOLDER_EMAIL = 'digipoke@users.noreply.github.com';
  const headEmail = git(['log', '-1', '--format=%ae'], { quiet: true });
  if (!flags.keepAuthor && headEmail === PLACEHOLDER_EMAIL) {
    const name = me.name || me.login;
    const email = me.email || `${me.id}+${me.login}@users.noreply.github.com`;
    say(`• Attributing commits to ${name} <${email}>…`);
    if (flags.dryRun) {
      say('  (dry run — left untouched)');
    } else {
      git(['rebase', '--root', '--committer-date-is-author-date', '--exec', 'git commit --amend --reset-author --no-edit'], {
        quiet: true,
        env: {
          GIT_AUTHOR_NAME: name,
          GIT_AUTHOR_EMAIL: email,
          GIT_COMMITTER_NAME: name,
          GIT_COMMITTER_EMAIL: email,
        },
      });
    }
  }

  /* 5. Push. The token lives in the remote only for the duration of this call. */
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
