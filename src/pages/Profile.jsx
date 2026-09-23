import { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import DeleteAccountSection from '../components/DeleteAccountSection';
import { schoolMemberships } from '../utils/organisationMemberships';
import { MAX_PASSWORD_LENGTH, validateRecoveryPasswords } from '../utils/supabaseRecovery';
import './Settings.css';
import './Profile.css';

function roleLabel(roles) {
  return roles.length ? roles.join(', ') : 'Member';
}

export default function Profile({
  user,
  memberships,
  membershipsLoading,
  membershipsError,
  updateProfileName,
  updateEmail,
  updatePassword,
  clearAuthenticatedUser,
  getAccountDeletionSession,
  signOutAfterAccountDeletion,
}) {
  const schools = schoolMemberships(memberships);
  const [firstName, setFirstName] = useState(user.firstName || '');
  const [lastName, setLastName] = useState(user.lastName || '');
  const [email, setEmail] = useState(user.email || '');
  const [nameStatus, setNameStatus] = useState({ state: 'idle', message: '' });
  const [emailStatus, setEmailStatus] = useState({ state: 'idle', message: '' });
  const [passwordStatus, setPasswordStatus] = useState({ state: 'idle', message: '' });
  const [currentPassword, setCurrentPassword] = useState('');
  const [newPassword, setNewPassword] = useState('');
  const [confirmPassword, setConfirmPassword] = useState('');

  useEffect(() => {
    setFirstName(user.firstName || '');
    setLastName(user.lastName || '');
    setEmail(user.email || '');
  }, [user.firstName, user.lastName, user.email]);

  async function handleNameSubmit(event) {
    event.preventDefault();
    setNameStatus({ state: 'saving', message: '' });
    try {
      await updateProfileName({ firstName, lastName });
      setNameStatus({ state: 'success', message: 'Your name has been updated.' });
    } catch (error) {
      setNameStatus({ state: 'error', message: error.message });
    }
  }

  async function handleEmailSubmit(event) {
    event.preventDefault();
    setEmailStatus({ state: 'saving', message: '' });
    try {
      const result = await updateEmail(email);
      setEmailStatus({
        state: 'success',
        message: result.confirmationPending
          ? 'Check your inbox to confirm the new email address. Your current email remains active until confirmation.'
          : 'Your email address has been updated.',
      });
    } catch (error) {
      setEmailStatus({ state: 'error', message: error.message });
    }
  }

  async function handlePasswordSubmit(event) {
    event.preventDefault();
    const validation = validateRecoveryPasswords(newPassword, confirmPassword);
    if (validation) {
      setPasswordStatus({ state: 'error', message: validation });
      return;
    }
    setPasswordStatus({ state: 'saving', message: '' });
    try {
      await updatePassword({ currentPassword, newPassword });
      setCurrentPassword('');
      setNewPassword('');
      setConfirmPassword('');
      setPasswordStatus({ state: 'success', message: 'Your password has been updated.' });
    } catch (error) {
      setPasswordStatus({ state: 'error', message: error.message });
    }
  }

  function formMessage(status) {
    if (!status.message) return null;
    return (
      <p className={`profile-form-message profile-form-message--${status.state}`} role={status.state === 'error' ? 'alert' : 'status'}>
        {status.message}
      </p>
    );
  }

  return (
    <main className="settings-page">
      <div className="container settings-inner settings-inner--wide">
        <p className="settings-breadcrumb">
          <Link to="/">Home</Link>
          <span aria-hidden> / </span>
          Personal profile
        </p>
        <h1 className="settings-title">Personal profile</h1>
        <p className="settings-lead">
          View your personal details, school memberships and account controls.
        </p>

        <section className="profile-card" aria-labelledby="personal-details-title">
          <div>
            <p className="profile-kicker">Account</p>
            <h2 id="personal-details-title" className="settings-section-title">Personal details</h2>
          </div>
          <form className="profile-form" onSubmit={handleNameSubmit}>
            <div className="profile-field-grid">
              <label className="settings-field">
                <span>First name</span>
                <input type="text" value={firstName} onChange={(event) => setFirstName(event.target.value)} maxLength={100} required />
              </label>
              <label className="settings-field">
                <span>Last name</span>
                <input type="text" value={lastName} onChange={(event) => setLastName(event.target.value)} maxLength={100} required />
              </label>
            </div>
            <div className="settings-actions">
              <button className="settings-save" type="submit" disabled={nameStatus.state === 'saving'}>
                {nameStatus.state === 'saving' ? 'Saving…' : 'Save name'}
              </button>
            </div>
            {formMessage(nameStatus)}
          </form>
        </section>

        <section className="profile-card" aria-labelledby="email-title">
          <div>
            <p className="profile-kicker">Sign in</p>
            <h2 id="email-title" className="settings-section-title">Email address</h2>
            <p className="settings-hint">We will ask you to confirm a new address before it replaces {user.email}.</p>
          </div>
          <form className="profile-form" onSubmit={handleEmailSubmit}>
            <label className="settings-field profile-field--wide">
              <span>Email</span>
              <input type="email" value={email} onChange={(event) => setEmail(event.target.value)} autoComplete="email" maxLength={254} required />
            </label>
            <div className="settings-actions">
              <button className="settings-save" type="submit" disabled={emailStatus.state === 'saving' || email.trim().toLowerCase() === user.email}>
                {emailStatus.state === 'saving' ? 'Sending…' : 'Change email'}
              </button>
            </div>
            {formMessage(emailStatus)}
          </form>
        </section>

        <section className="profile-card" aria-labelledby="password-title">
          <div>
            <p className="profile-kicker">Security</p>
            <h2 id="password-title" className="settings-section-title">Change password</h2>
            <p className="settings-hint">Enter your current password before choosing a new one.</p>
          </div>
          <form className="profile-form" onSubmit={handlePasswordSubmit}>
            <label className="settings-field profile-field--wide">
              <span>Current password</span>
              <input type="password" value={currentPassword} onChange={(event) => setCurrentPassword(event.target.value)} autoComplete="current-password" maxLength={MAX_PASSWORD_LENGTH} required />
            </label>
            <div className="profile-field-grid">
              <label className="settings-field">
                <span>New password</span>
                <input type="password" value={newPassword} onChange={(event) => setNewPassword(event.target.value)} autoComplete="new-password" minLength={8} maxLength={MAX_PASSWORD_LENGTH} required />
              </label>
              <label className="settings-field">
                <span>Confirm new password</span>
                <input type="password" value={confirmPassword} onChange={(event) => setConfirmPassword(event.target.value)} autoComplete="new-password" minLength={8} maxLength={MAX_PASSWORD_LENGTH} required />
              </label>
            </div>
            <div className="settings-actions">
              <button className="settings-save" type="submit" disabled={passwordStatus.state === 'saving'}>
                {passwordStatus.state === 'saving' ? 'Saving…' : 'Change password'}
              </button>
            </div>
            {formMessage(passwordStatus)}
          </form>
        </section>

        <section className="profile-card profile-card--memberships" aria-labelledby="membership-title">
          <div>
            <p className="profile-kicker">Access</p>
            <h2 id="membership-title" className="settings-section-title">Organisation memberships</h2>
            <p className="settings-hint">Schools you belong to and the access assigned to you in each one.</p>
          </div>

          {membershipsLoading ? <p role="status">Loading your organisations…</p> : null}
          {membershipsError ? <p className="profile-error" role="alert">{membershipsError}</p> : null}
          {!membershipsLoading && !membershipsError && schools.length === 0 ? (
            <p className="profile-empty">You are not currently linked to a school organisation.</p>
          ) : null}
          {!membershipsLoading && !membershipsError && schools.length ? (
            <ul className="profile-membership-list">
              {schools.map((membership) => (
                <li key={membership.membershipId} className="profile-membership">
                  <span className="profile-membership-name">{membership.name}</span>
                  <span className="profile-role-badge">{roleLabel(membership.roles)}</span>
                </li>
              ))}
            </ul>
          ) : null}
        </section>

        <DeleteAccountSection
          clearAuthenticatedUser={clearAuthenticatedUser}
          getAccountDeletionSession={getAccountDeletionSession}
          signOutAfterAccountDeletion={signOutAfterAccountDeletion}
        />
      </div>
    </main>
  );
}
