/**
 * settings.js — Settings & data management.
 *
 * This screen is the trust surface of a local-first product: the player can
 * see exactly what is stored, export it in a portable format, move it to
 * another device, or destroy it. Nothing here is hidden behind a network call.
 *
 * @module ui/screens/settings
 */

import { h, renderInto, num } from '../dom.js';
import {
  card, sectionHead, badge, toast, modal, confirmDialog, promptDialog, emptyState, timeAgo, tamerEl,
} from '../components.js';
import * as state from '../../core/state.js';
import * as db from '../../core/db.js';
import {
  deriveVaultKey, makeVerifier, newSalt, verifyPassphrase, encryptJson, decryptJson, randomId,
} from '../../core/crypto.js';
import { sfx, setSoundEnabled, setSfxVolume, setMusicVolume, startMusic, stopMusic } from '../../core/sfx.js';
import { navigate } from '../../core/router.js';
import * as sync from '../../sync/syncClient.js';
import { resetOnboarding } from './onboarding.js';
import { TAMER_OPTIONS, DEFAULT_TAMER, randomTamer } from '../tamerAvatar.js';
import { leave } from './battle.js';

/**
 * Render the Settings screen.
 * @param {HTMLElement} root
 */
export function render(root) {
  const view = h('div.view.view--settings', [
    profileCard(),
    preferencesCard(),
    audioCard(),
    syncCard(),
    dataCard(),
    aboutCard(),
  ]);
  renderInto(root, view);
  loadStorageStats();
}

/* ---------------------------------------------------------------- profile */

function profileCard() {
  const s = state.getState();
  startMusic('menu');

  return card('Profile',
    h('div.profile-head', [
      h('div.profile-head__avatar', tamerEl(s.profile.tamer, { size: 88, mood: 'happy' })),
      h('div.profile-head__id', [
        h('div.profile-head__name', s.profile.displayName),
        h('div.profile-head__meta', `Tamer · joined ${new Date(s.profile.createdAt).toLocaleDateString('en-GB')}`),
        h('button.btn.btn--sm', { type: 'button', onclick: () => openAvatarEditor() }, 'Edit appearance'),
      ]),
    ]),
    h('div.kv-list', [
      kvRow('Display name', s.profile.displayName,
        h('button.btn.btn--sm.btn--ghost', {
          type: 'button',
          onclick: async () => {
            const name = await promptDialog({
              title: 'Rename Tamer', message: 'Shown on your Nexus dashboard.',
              value: s.profile.displayName, maxLength: 18,
            });
            if (name) { state.mutate((st) => { st.profile.displayName = name; }); toast('Updated.', 'success'); }
          },
        }, 'Edit')),
      kvRow('Tamer ID', s.profile.id,
        h('button.btn.btn--sm.btn--ghost', {
          type: 'button',
          onclick: async () => {
            try {
              await navigator.clipboard.writeText(s.profile.id);
              toast('Tamer ID copied.', 'success');
            } catch { toast('Copy failed — select the text manually.', 'error'); }
          },
        }, 'Copy')),
      kvRow('Created', new Date(s.profile.createdAt).toLocaleString('en-GB')),
      kvRow('Last saved', timeAgo(state.lastPersisted() || s.updatedAt),
        h('button.btn.btn--sm.btn--ghost', {
          type: 'button',
          onclick: async () => { await state.flush(); toast('Saved to this device.', 'success'); },
        }, 'Save now')),
      kvRow('Vault',
        h('span.pill.pill--ok', 'Encrypted locally (AES-GCM)'),
        h('button.btn.btn--sm.btn--ghost', { type: 'button', onclick: () => changePassphrase() }, 'Change passphrase')),
    ]),
  );
}

/** Re-derive the local vault verifier with a new passphrase. */
async function changePassphrase() {
  const record = await db.kvGet('vault', null);
  if (!record) return toast('No vault found on this device.', 'error');

  const oldPass = await promptDialog({
    title: 'Current passphrase', message: 'Enter your current vault passphrase.',
    placeholder: 'Current passphrase', maxLength: 128, confirmLabel: 'Verify',
  });
  if (oldPass === null) return;
  if (!(await verifyPassphrase(oldPass, record.salt, record.verifier))) {
    sfx.error();
    return toast('Incorrect passphrase.', 'error');
  }

  const newPass = await promptDialog({
    title: 'New passphrase', message: 'At least 8 characters. This encrypts exports and cloud backups.',
    placeholder: 'New passphrase', maxLength: 128, confirmLabel: 'Set passphrase',
  });
  if (!newPass || newPass.length < 8) return toast('Passphrase must be at least 8 characters.', 'error');

  const salt = newSalt();
  const key = await deriveVaultKey(newPass, salt, record.iterations);
  const verifier = await makeVerifier(key);
  await db.kvSet('vault', { ...record, salt, verifier, rotatedAt: new Date().toISOString() });
  sync.forgetVaultKey();
  toast('Vault passphrase updated. Remember it — it cannot be recovered.', 'success');
}

/* ------------------------------------------------------------ preferences */

function preferencesCard() {
  const s = state.getState();

  const toggle = (label, key, onChange) => h('label.toggle', [
    h('span.toggle__label', label),
    h('input', {
      type: 'checkbox',
      checked: !!s.settings[key],
      onchange: (e) => {
        state.updateSettings({ [key]: e.target.checked });
        onChange?.(e.target.checked);
        toast(`${label}: ${e.target.checked ? 'on' : 'off'}`, 'info');
      },
    }),
    h('span.toggle__track'),
  ]);

  return card('Preferences',
    h('div.field', [
      h('span.field__label', 'Theme'),
      h('select.input', {
        onchange: (e) => {
          state.updateSettings({ theme: e.target.value });
          applyTheme(e.target.value);
        },
      }, [
        ['nexus', 'Nexus (default)'], ['ember', 'Ember'], ['abyss', 'Abyss'], ['mono', 'Mono'],
      ].map(([value, label]) => h('option', { value, selected: s.settings.theme === value }, label))),
    ]),
    toggle('Animations', 'motion'),
    toggle('Autosave', 'autosave', () => state.schedulePersist(0)),
  );
}

/** Audio section: master toggles plus separate SFX and music levels. */
function audioCard() {
  const s = state.getState();

  const slider = (label, value, onInput) => h('label.field', [
    h('span.field__label', `${label} · ${Math.round(value * 100)}%`),
    h('input.input.input--range', {
      type: 'range', min: '0', max: '100', value: String(Math.round(value * 100)),
      oninput: (e) => {
        const v = Number(e.target.value) / 100;
        onInput(v);
        const lbl = e.target.previousElementSibling;
        if (lbl) lbl.textContent = `${label} · ${Math.round(v * 100)}%`;
      },
    }),
  ]);

  return card('Audio',
    h('p.muted.muted--sm', 'Every sound in DigiPoke is synthesised live — no audio files, so the app stays tiny and works offline.'),
    h('label.toggle', [
      h('span.toggle__label', 'Sound effects'),
      h('input', {
        type: 'checkbox', checked: !!s.settings.sound,
        onchange: (e) => { state.updateSettings({ sound: e.target.checked }); setSoundEnabled(e.target.checked); if (e.target.checked) sfx.click(); },
      }),
      h('span.toggle__track'),
    ]),
    h('label.toggle', [
      h('span.toggle__label', 'Music'),
      h('input', {
        type: 'checkbox', checked: !!s.settings.music,
        onchange: (e) => {
          state.updateSettings({ music: e.target.checked });
          if (e.target.checked) { setMusicVolume(s.settings.musicVolume ?? 0.35); startMusic('menu'); }
          else stopMusic();
        },
      }),
      h('span.toggle__track'),
    ]),
    slider('Effects volume', s.settings.sfxVolume ?? 0.7, (v) => { setSfxVolume(v); state.updateSettings({ sfxVolume: v }); }),
    slider('Music volume', s.settings.musicVolume ?? 0.35, (v) => { setMusicVolume(v); state.updateSettings({ musicVolume: v }); }),
    h('div.row.row--wrap', [
      h('button.btn.btn--sm.btn--ghost', { type: 'button', onclick: () => { sfx.hit(); toast('That is a super-effective hit.', 'info'); } }, 'Test a hit'),
      h('button.btn.btn--sm.btn--ghost', { type: 'button', onclick: () => sfx.captureSuccess() }, 'Test a capture'),
      h('button.btn.btn--sm.btn--ghost', { type: 'button', onclick: () => sfx.evolve() }, 'Test an evolution'),
      h('button.btn.btn--sm.btn--ghost', {
        type: 'button',
        onclick: () => {
          state.mutate((st) => { st.profile.tutorial = { nexus: false, ranch: false, lab: false, battle: false }; });
          toast('Coach marks will show again.', 'info');
        },
      }, 'Reset tips'),
    ]),
  );
}

/** Live avatar editor, reusing the character-creator option groups. */
function openAvatarEditor() {
  const draft = { ...(state.getState().profile.tamer || DEFAULT_TAMER) };
  const body = h('div.creator__grid');

  function paint() {
    body.replaceChildren(
      h('div.creator__preview', [
        h('div.stage', [
          h('div.stage__ring'),
          h('div.stage__avatar', tamerEl(draft, { size: 200, mood: 'happy' })),
        ]),
      ]),
      h('div.editor-groups', Object.keys(TAMER_OPTIONS).map((key) => h('div.opt-group', [
        h('div.opt-group__label', key.replace(/([A-Z])/g, ' $1').replace(/^./, (c) => c.toUpperCase())),
        h('div.opt-group__options', TAMER_OPTIONS[key].map((opt) => h(
          `button.opt${draft[key] === opt.id ? '.is-active' : ''}${opt.hex ? '.opt--color' : ''}`,
          {
            type: 'button', title: opt.name,
            style: opt.hex ? { '--swatch': opt.hex } : {},
            onclick: () => { draft[key] = opt.id; sfx.select(); paint(); },
          },
          opt.hex ? '' : opt.name,
        ))),
      ]))),
    );
  }
  paint();

  modal({
    title: 'Edit appearance',
    size: 'lg',
    body,
    actions: [
      { label: 'Cancel', kind: 'ghost' },
      { label: '🎲 Surprise me', kind: 'ghost', onClick: () => { Object.assign(draft, randomTamer(Math.random)); sfx.confirm(); paint(); return false; } },
      {
        label: 'Save look', kind: 'primary', onClick: () => {
          state.setTamer({ ...draft });
          sfx.confirm();
          toast('Appearance updated.', 'success');
          navigate('/settings');
        },
      },
    ],
  });
}

/* -------------------------------------------------------------------- sync */

function syncCard() {
  const s = state.getState();
  const account = s.account;

  return card(null,
    sectionHead('Cloud sync (optional)',
      account?.token ? badge('Connected', { kind: 'ok' }) : badge('Local only', { kind: 'muted' })),
    h('p.muted', [
      'Sync is end-to-end encrypted: your save is sealed with AES-GCM before it leaves the device. ',
      'The server stores ciphertext and a scrypt hash of your password — it can never read your data.',
    ]),

    h('label.field', [
      h('span.field__label', 'Server URL'),
      h('input.input', {
        type: 'url',
        value: s.settings.serverUrl || sync.defaultServerUrl(),
        placeholder: sync.defaultServerUrl(),
        onchange: (e) => state.updateSettings({ serverUrl: e.target.value.trim() || null }),
      }),
    ]),

    account?.token
      ? h('div.stack', [
        h('div.kv-list', [
          kvRow('Account', account.email),
          kvRow('Vault revision', String(account.vaultRev ?? 0)),
          kvRow('Last synced', timeAgo(account.lastSyncedAt)),
        ]),
        h('div.row.row--wrap', [
          h('button.btn.btn--primary', { type: 'button', onclick: () => doSync() }, 'Sync now'),
          h('button.btn.btn--ghost', { type: 'button', onclick: () => doRestore() }, 'Restore from cloud'),
          h('button.btn.btn--ghost', { type: 'button', onclick: () => { sync.signOut(); navigate('/settings'); } }, 'Sign out'),
          h('button.btn.btn--danger', {
            type: 'button',
            onclick: async () => {
              const ok = await confirmDialog({
                title: 'Delete cloud vault?',
                message: 'Removes the encrypted backup from the server. Your local save is not affected.',
                confirmLabel: 'Delete remote data', danger: true,
              });
              if (!ok) return;
              await sync.deleteRemoteAccount();
              toast('Remote vault deleted.', 'info');
              navigate('/settings');
            },
          }, 'Delete cloud data'),
        ]),
      ])
      : h('div.row.row--end', h('button.btn.btn--primary', {
        type: 'button',
        onclick: () => openAuthDialog(),
      }, 'Create account / sign in')),
  );
}

/** Register-or-login dialog (one form, server decides). */
async function openAuthDialog() {
  const email = h('input.input', { type: 'email', placeholder: 'you@example.com', maxLength: 160 });
  const password = h('input.input', { type: 'password', placeholder: 'Vault passphrase', maxLength: 128 });
  let error = h('p.form-error');

  modal({
    title: 'Cloud sync',
    size: 'sm',
    body: [
      h('p.modal__text', 'Use your vault passphrase as the account password. If the email is new, an account is created.'),
      h('label.field', [h('span.field__label', 'Email'), email]),
      h('label.field', [h('span.field__label', 'Password'), password]),
      error,
    ],
    actions: [
      { label: 'Cancel', kind: 'ghost' },
      {
        label: 'Connect',
        kind: 'primary',
        onClick: async () => {
          if (!email.value || password.value.length < 8) {
            error.textContent = 'Enter an email and a password of at least 8 characters.';
            return false;
          }
          try {
            await sync.register(email.value.trim(), password.value);
            await sync.push({ passphrase: password.value });
            toast('Account created and save uploaded.', 'success');
          } catch (err) {
            if (err.status === 409) {
              try {
                await sync.login(email.value.trim(), password.value);
                await sync.push({ passphrase: password.value });
                toast('Signed in and save uploaded.', 'success');
              } catch (err2) { error.textContent = err2.message; return false; }
            } else {
              error.textContent = err.message;
              return false;
            }
          }
          state.updateSettings({ syncEnabled: true });
          navigate('/settings');
          return true;
        },
      },
    ],
  });
}

/** Push the local save to the cloud, prompting for the passphrase on demand. */
async function doSync() {
  try {
    const result = await sync.syncNow({ prompt: () => passphrasePrompt('Unlock vault to sync') });
    if (result.action === 'conflict') {
      const takeRemote = await confirmDialog({
        title: 'Newer cloud save found',
        message: 'The server holds a newer version of your save. Replace your local data with it? Choosing Cancel uploads your local save instead and overwrites the cloud copy.',
        confirmLabel: 'Use cloud save', cancelLabel: 'Keep local', danger: false,
      });
      if (takeRemote && result.remote) {
        await state.replaceState(result.remote);
        toast('Restored from cloud.', 'success');
      } else {
        await sync.push({ prompt: () => passphrasePrompt('Unlock vault to upload') });
        toast('Local save uploaded.', 'success');
      }
    } else {
      toast('Sync complete.', 'success');
    }
  } catch (err) {
    sfx.error();
    toast(err.message, 'error');
  }
  navigate('/settings');
}

/** Pull and apply the cloud save. */
async function doRestore() {
  const ok = await confirmDialog({
    title: 'Restore from cloud?',
    message: 'Your local save will be replaced by the encrypted copy on the server. Export a local backup first if you are unsure.',
    confirmLabel: 'Restore', danger: true,
  });
  if (!ok) return;
  try {
    const remote = await sync.pull({ prompt: () => passphrasePrompt('Unlock vault to decrypt') });
    if (!remote) return;
    await state.replaceState(remote);
    sfx.capture();
    toast('Save restored from cloud.', 'success');
    navigate('/');
  } catch (err) {
    sfx.error();
    toast(err.message, 'error');
  }
}

/** Shared passphrase prompt used by the sync flows. */
function passphrasePrompt(title) {
  return promptDialog({
    title,
    message: 'Your vault passphrase encrypts and decrypts the synced save.',
    placeholder: 'Vault passphrase',
    maxLength: 128,
    confirmLabel: 'Unlock',
  });
}

/* -------------------------------------------------------------------- data */

function dataCard() {
  const s = state.getState();
  const usage = h('div.kv-list', [
    kvRow('Storage', h('span#storageStat', 'Measuring…')),
    kvRow('Creatures', String(Object.keys(s.creatures).length)),
    kvRow('Schema version', `v${s.schema}`),
  ]);

  const fileInput = h('input', {
    type: 'file', accept: '.json,.dpvault,application/json', style: { display: 'none' },
    onchange: (e) => importFile(e.target.files?.[0]),
  });

  const backups = h('div.backup-list', h('p.muted', 'Loading backups…'));

  return card(null,
    sectionHead('Data management', h('span.pill', 'Local-first')),
    h('p.muted', 'Your save lives in this browser’s IndexedDB. Export regularly — clearing site data erases it.'),
    usage,
    h('div.row.row--wrap', [
      h('button.btn', { type: 'button', onclick: () => exportPlain() }, 'Export JSON'),
      h('button.btn', { type: 'button', onclick: () => exportEncrypted() }, 'Export encrypted'),
      h('button.btn.btn--primary', { type: 'button', onclick: () => fileInput.click() }, 'Import save'),
      fileInput,
    ]),
    h('h4.detail__sub', 'Automatic backups'),
    backups,
    h('div.row.row--wrap', [
      h('button.btn.btn--danger', {
        type: 'button',
        onclick: async () => {
          const ok = await confirmDialog({
            title: 'Delete ALL local data?',
            message: 'This erases your profile, creatures, settings and backups on this device. It cannot be undone. Export a backup first if you are unsure.',
            confirmLabel: 'Delete everything', danger: true,
          });
          if (!ok) return;
          leave();
          await state.wipe();
          resetOnboarding();
          sync.forgetVaultKey();
          toast('All local data deleted.', 'info');
          navigate('/onboarding');
        },
      }, 'Delete all data'),
    ]),
  );
}

/* -------------------------------------------------------- export / import */

/** Trigger a browser download. */
function download(filename, text, mime = 'application/json') {
  const blob = new Blob([text], { type: mime });
  const url = URL.createObjectURL(blob);
  const a = h('a', { href: url, download: filename });
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 2000);
}

/** Plain (unencrypted) export — portable, but readable by anyone. */
function exportPlain() {
  const payload = state.exportPayload();
  payload.exportedAt = new Date().toISOString();
  payload.exportKind = 'digipoke.plain.v1';
  download(`digipoke-save-${new Date().toISOString().slice(0, 10)}.json`, JSON.stringify(payload, null, 2));
  toast('Save exported as JSON.', 'success');
}

/** Encrypted export — safe to email, drop in cloud storage, etc. */
async function exportEncrypted() {
  const record = await db.kvGet('vault', null);
  if (!record) return toast('No local vault found. Complete onboarding first.', 'error');

  const pass = await promptDialog({
    title: 'Encrypt export',
    message: 'This passphrase is required to import the file. It is not stored in the file.',
    placeholder: 'Passphrase', maxLength: 128, confirmLabel: 'Encrypt',
  });
  if (!pass || pass.length < 8) return toast('Passphrase must be at least 8 characters.', 'error');

  const salt = newSalt();
  const key = await deriveVaultKey(pass, salt, record.iterations);
  const payload = state.exportPayload();
  payload.exportedAt = new Date().toISOString();
  const sealed = await encryptJson(key, payload);

  download(
    `digipoke-vault-${new Date().toISOString().slice(0, 10)}.dpvault`,
    JSON.stringify({ kind: 'digipoke.vault.v1', salt, iterations: record.iterations, ...sealed }, null, 2),
  );
  toast('Encrypted vault exported.', 'success');
}

/**
 * Import a save file (plain JSON or encrypted .dpvault).
 * @param {File} file
 */
async function importFile(file) {
  if (!file) return;
  try {
    const text = await file.text();
    const parsed = JSON.parse(text);

    let payload = parsed;
    if (parsed?.kind === 'digipoke.vault.v1') {
      const pass = await promptDialog({
        title: 'Encrypted vault',
        message: `Enter the passphrase used to encrypt ${file.name}.`,
        placeholder: 'Passphrase', maxLength: 128, confirmLabel: 'Decrypt',
      });
      if (!pass) return;
      const key = await deriveVaultKey(pass, parsed.salt, parsed.iterations ?? 250000);
      payload = await decryptJson(key, parsed);
    }

    if (!payload || !payload.profile || !payload.creatures) {
      throw new Error('That file is not a DigiPoke save.');
    }

    const ok = await confirmDialog({
      title: 'Replace local save?',
      message: `Importing will replace your current game (${Object.keys(state.getState().creatures).length} creatures) with the imported save (${Object.keys(payload.creatures).length} creatures).`,
      confirmLabel: 'Import', danger: true,
    });
    if (!ok) return;

    await state.replaceState(payload);
    sfx.capture();
    toast('Save imported.', 'success');
    navigate('/');
  } catch (err) {
    sfx.error();
    toast(`Import failed: ${err.message}`, 'error');
  }
}

/* ---------------------------------------------------------------- backups */

/** Load storage stats and the backup ring into the rendered card. */
async function loadStorageStats() {
  const el = document.getElementById('storageStat');
  const estimate = await db.storageEstimate();
  if (el) {
    el.textContent = estimate
      ? `${(estimate.usage / 1024 / 1024).toFixed(2)} MB of ${(estimate.quota / 1024 / 1024).toFixed(0)} MB (${(estimate.pct * 100).toFixed(1)}%)`
      : 'Unavailable in this browser';
  }

  const list = document.querySelector('.backup-list');
  if (!list) return;
  const backups = await db.listBackups();
  if (!backups.length) {
    list.replaceChildren(h('p.muted', 'No backups yet — they are created automatically as you play.'));
    return;
  }
  list.replaceChildren(h('div.stack', backups.map((b) => h('div.list-row', {
    type: 'button',
  }, [
    h('span.list-row__name', new Date(b.at).toLocaleString('en-GB')),
    h('span.list-row__meta', `${Object.keys(b.snapshot?.creatures || {}).length} creatures`),
    h('button.btn.btn--sm.btn--ghost', {
      type: 'button',
      onclick: async () => {
        const ok = await confirmDialog({
          title: 'Restore this backup?',
          message: 'Your current save will be replaced by this snapshot.',
          confirmLabel: 'Restore', danger: true,
        });
        if (!ok) return;
        await state.replaceState(b.snapshot);
        toast('Backup restored.', 'success');
        navigate('/');
      },
    }, 'Restore'),
  ]))));
}

/* ------------------------------------------------------------------- about */

function aboutCard() {
  return card('About',
    h('div.kv-list', [
      kvRow('Version', '1.0.0'),
      kvRow('Architecture', 'Local-first PWA · IndexedDB · zero-knowledge sync'),
      kvRow('Engine', 'Deterministic seeded PRNG (mulberry32)'),
    ]),
    h('p.muted.muted--sm', [
      'Engineering documentation ships with the repository under ',
      h('code', 'docs/'),
      ': PRD, system architecture, data model, API spec, security standards and the phased implementation plan.',
    ]),
    h('p.muted.muted--sm', 'DigiPoke works fully offline. Installing it as an app keeps the whole experience available without a network.'),
  );
}

/* ------------------------------------------------------------------ utils */

function kvRow(label, value, action = null) {
  return h('div.kv-row', [
    h('span.kv-row__label', label),
    h('span.kv-row__value', value),
    action ? h('span.kv-row__action', action) : null,
  ]);
}

/** Apply a theme to <html data-theme>. */
export function applyTheme(theme) {
  document.documentElement.dataset.theme = theme || 'nexus';
}

export const meta = { title: 'Settings' };
export { num, randomId, emptyState };
