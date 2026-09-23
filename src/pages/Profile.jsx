import { Link } from 'react-router-dom';
import DeleteAccountSection from '../components/DeleteAccountSection';
import { schoolMemberships } from '../utils/organisationMemberships';
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
  clearAuthenticatedUser,
  getAccountDeletionSession,
  signOutAfterAccountDeletion,
}) {
  const schools = schoolMemberships(memberships);

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
          <dl className="profile-details">
            <div>
              <dt>Name</dt>
              <dd>{user.name || 'Not available'}</dd>
            </div>
            <div>
              <dt>Email</dt>
              <dd>{user.email || 'Not available'}</dd>
            </div>
          </dl>
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
