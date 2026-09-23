import { Link } from 'react-router-dom';
import { administeredOrganisations } from '../utils/organisationMemberships';
import './Settings.css';
import './Profile.css';

export default function OrganisationControls({ memberships, membershipsLoading, membershipsError }) {
  const organisations = administeredOrganisations(memberships);

  return (
    <main className="settings-page">
      <div className="container settings-inner settings-inner--wide">
        <p className="settings-breadcrumb">
          <Link to="/">Home</Link>
          <span aria-hidden> / </span>
          Organisation controls
        </p>
        <h1 className="settings-title">Organisation controls</h1>
        <p className="settings-lead">
          Manage the school organisations where you have Organisation Admin access.
        </p>

        {membershipsLoading ? <p role="status">Checking your organisation access…</p> : null}
        {membershipsError ? <p className="profile-error" role="alert">{membershipsError}</p> : null}
        {!membershipsLoading && !membershipsError && organisations.length === 0 ? (
          <section className="profile-card">
            <h2 className="settings-section-title">No administrator access</h2>
            <p className="settings-hint">You do not administer a school organisation.</p>
            <Link className="profile-inline-link" to="/profile">Return to your personal profile</Link>
          </section>
        ) : null}
        {!membershipsLoading && !membershipsError && organisations.length ? (
          <div className="profile-organisation-grid">
            {organisations.map((organisation) => (
              <section key={organisation.membershipId} className="profile-card">
                <div>
                  <p className="profile-kicker">Organisation Admin</p>
                  <h2 className="settings-section-title">{organisation.name}</h2>
                </div>
                <p className="settings-hint">
                  Organisation details, member management and the deletion Danger Zone will be added here in the next
                  secured implementation slice.
                </p>
              </section>
            ))}
          </div>
        ) : null}
      </div>
    </main>
  );
}
