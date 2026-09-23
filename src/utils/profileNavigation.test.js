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

test('name and email default to independent read-only displays with explicit edit actions', async () => {
  const profile = await fs.readFile(new URL('../pages/Profile.jsx', import.meta.url), 'utf8');
  for (const field of ['Name', 'Email']) {
    assert.match(profile, new RegExp(`\\[isEditing${field}, setIsEditing${field}\\] = useState\\(false\\)`));
    assert.match(profile, new RegExp(`isEditing${field} \\? \\([\\s\\S]*?onSubmit=\\{handle${field}Submit\\}[\\s\\S]*?\\) : \\([\\s\\S]*?profile-detail-value[\\s\\S]*?setIsEditing${field}\\(true\\)[\\s\\S]*?Edit ${field.toLowerCase()}`));
    assert.match(profile, new RegExp(`onClick=\\{cancel${field}Edit\\}`));
    assert.match(profile, new RegExp(`await update${field === 'Name' ? 'ProfileName' : 'Email'}\\([\\s\\S]*?setIsEditing${field}\\(false\\)`));
    assert.match(profile, new RegExp(`\\)\\}\\s*\\{formMessage\\(${field.toLowerCase()}Status\\)\\}`));
  }
  assert.match(profile, /profile-detail-value">\{\[user.firstName, user.lastName\]/);
  assert.match(profile, /profile-detail-value">\{user.email\}/);
  assert.match(profile, /Your current email remains active until confirmation/);
});

test('cancel restores current user values and clears messages independently', async () => {
  const profile = await fs.readFile(new URL('../pages/Profile.jsx', import.meta.url), 'utf8');
  const nameCancel = profile.match(/function cancelNameEdit\(\) \{([\s\S]*?)\n  \}/)[1];
  const emailCancel = profile.match(/function cancelEmailEdit\(\) \{([\s\S]*?)\n  \}/)[1];
  assert.match(nameCancel, /setFirstName\(user.firstName \|\| ''\)/);
  assert.match(nameCancel, /setLastName\(user.lastName \|\| ''\)/);
  assert.match(nameCancel, /setNameStatus\(\{ state: 'idle', message: '' \}\)/);
  assert.match(nameCancel, /setIsEditingName\(false\)/);
  assert.doesNotMatch(nameCancel, /setEmail/);
  assert.match(emailCancel, /setEmail\(user.email \|\| ''\)/);
  assert.match(emailCancel, /setEmailStatus\(\{ state: 'idle', message: '' \}\)/);
  assert.match(emailCancel, /setIsEditingEmail\(false\)/);
  assert.doesNotMatch(emailCancel, /setFirstName|setLastName|setNameStatus/);
});

test('name and email submissions guard saving and unchanged email', async () => {
  const profile = await fs.readFile(new URL('../pages/Profile.jsx', import.meta.url), 'utf8');
  assert.match(profile, /if \(nameStatus.state === 'saving'\) return/);
  assert.match(profile, /if \(emailStatus.state === 'saving' \|\| emailUnchanged\) return/);
  assert.match(profile, /emailUnchanged = email.trim\(\).toLowerCase\(\) === \(user.email \|\| ''\).trim\(\).toLowerCase\(\)/);
  assert.match(profile, /disabled=\{emailStatus.state === 'saving' \|\| emailUnchanged\}/);
});

test('password fields use a bounded vertical layout and retain autocomplete and validation', async () => {
  const [profile, css] = await Promise.all([
    fs.readFile(new URL('../pages/Profile.jsx', import.meta.url), 'utf8'),
    fs.readFile(new URL('../pages/Profile.css', import.meta.url), 'utf8'),
  ]);
  const passwordForm = profile.match(/<form className="profile-form profile-password-form"[\s\S]*?<\/form>/)[0];
  assert.doesNotMatch(passwordForm, /profile-field-grid/);
  assert.match(passwordForm, /Current password[\s\S]*New password[\s\S]*Confirm new password/);
  assert.equal((passwordForm.match(/autoComplete="current-password"/g) || []).length, 1);
  assert.equal((passwordForm.match(/autoComplete="new-password"/g) || []).length, 2);
  assert.equal((passwordForm.match(/minLength=\{8\}/g) || []).length, 2);
  assert.equal((passwordForm.match(/maxLength=\{MAX_PASSWORD_LENGTH\} required/g) || []).length, 3);
  assert.match(profile, /validateRecoveryPasswords\(newPassword, confirmPassword\)/);
  assert.match(profile, /updatePassword\(\{ currentPassword, newPassword \}\)/);
  assert.match(css, /\.profile-form \{\s*display: grid;\s*gap: 16px;/);
  assert.match(css, /\.profile-password-form \{\s*width: 100%;\s*max-width: 440px;/);
});
