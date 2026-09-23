import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import test from 'node:test';

test('profile and organisation-control routes are private and receive membership state', async () => {
  const app = await fs.readFile(new URL('../App.jsx', import.meta.url), 'utf8');
  assert.match(app, /path="\/profile"[\s\S]*?element=\{privateRoute\(/);
  assert.match(app, /path="\/organisation-controls"[\s\S]*?element=\{privateRoute\(/);
  assert.match(app, /<Profile[\s\S]*?memberships=\{memberships\}/);
  assert.match(app, /<OrganisationControls[\s\S]*?memberships=\{memberships\}/);
});

test('account deletion moved to personal profile and is absent from planner settings', async () => {
  const [profile, settings] = await Promise.all([
    fs.readFile(new URL('../pages/Profile.jsx', import.meta.url), 'utf8'),
    fs.readFile(new URL('../pages/Settings.jsx', import.meta.url), 'utf8'),
  ]);
  assert.match(profile, /<DeleteAccountSection/);
  assert.doesNotMatch(settings, /Delete account|DeleteAccountSection|createAccountDeletionController/);
});

test('personal profile provides editable name, confirmed email and password controls', async () => {
  const [profile, app] = await Promise.all([
    fs.readFile(new URL('../pages/Profile.jsx', import.meta.url), 'utf8'),
    fs.readFile(new URL('../App.jsx', import.meta.url), 'utf8'),
  ]);
  assert.match(profile, /handleNameSubmit/);
  assert.match(profile, /handleEmailSubmit/);
  assert.match(profile, /handlePasswordSubmit/);
  assert.match(profile, /autoComplete="current-password"/);
  assert.match(profile, /autoComplete="new-password"/);
  assert.match(app, /updateProfileName=\{handleProfileNameUpdate\}/);
  assert.match(app, /updateEmail=\{handleEmailUpdate\}/);
  assert.match(app, /updatePassword=\{\(details\) => authController\.updatePassword\(details\)\}/);
});

test('navigation shows organisation controls conditionally while preserving planner settings', async () => {
  const header = await fs.readFile(new URL('../components/Header.jsx', import.meta.url), 'utf8');
  assert.match(header, /administeredOrganisations\(memberships\)/);
  assert.match(header, /hasOrganisationControls \? \(/);
  assert.match(header, /Personal profile/);
  assert.match(header, /Organisation controls/);
  assert.match(header, /Planner settings/);
});
