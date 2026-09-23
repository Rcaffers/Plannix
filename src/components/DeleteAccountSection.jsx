import { useEffect, useMemo, useRef, useState } from 'react';
import { createAccountDeletionController } from '../utils/accountDeletion';
import { useTimetableLayout } from '../context/TimetableLayoutContext';
import { useAcademicYear } from '../context/AcademicYearContext';

export default function DeleteAccountSection({
  clearAuthenticatedUser,
  getAccountDeletionSession,
  signOutAfterAccountDeletion,
}) {
  const { clearUserLayout } = useTimetableLayout();
  const { clearUserAcademicYear } = useAcademicYear();
  const [isDeletingAccount, setIsDeletingAccount] = useState(false);
  const [accountError, setAccountError] = useState('');
  const [accountErrorReference, setAccountErrorReference] = useState('');
  const [isDeleteDialogOpen, setIsDeleteDialogOpen] = useState(false);
  const [deletePassword, setDeletePassword] = useState('');
  const deletePasswordRef = useRef('');

  const deletionController = useMemo(() => createAccountDeletionController({
    getSession: getAccountDeletionSession,
    clearSensitiveState: () => {
      deletePasswordRef.current = '';
      setDeletePassword('');
    },
    clearAuthenticatedUser,
    clearUserCaches: () => {
      clearUserLayout();
      clearUserAcademicYear();
    },
    signOut: signOutAfterAccountDeletion,
    replaceLocation: (path) => window.location.replace(path),
  }), [
    clearAuthenticatedUser,
    clearUserAcademicYear,
    clearUserLayout,
    getAccountDeletionSession,
    signOutAfterAccountDeletion,
  ]);

  useEffect(() => () => {
    deletePasswordRef.current = '';
  }, []);

  function clearDeletionForm() {
    deletePasswordRef.current = '';
    setDeletePassword('');
  }

  function closeDeleteDialog() {
    if (isDeletingAccount) return;
    clearDeletionForm();
    setAccountError('');
    setAccountErrorReference('');
    setIsDeleteDialogOpen(false);
  }

  async function handleDeleteAccount(event) {
    event.preventDefault();
    if (isDeletingAccount) return;
    setAccountError('');
    setAccountErrorReference('');
    setIsDeletingAccount(true);
    try {
      await deletionController.submit(deletePasswordRef.current);
      setIsDeleteDialogOpen(false);
    } catch (error) {
      setAccountError(error.message || 'Could not delete your account. Please try again.');
      setAccountErrorReference(error.requestId || '');
    } finally {
      clearDeletionForm();
      setIsDeletingAccount(false);
    }
  }

  return (
    <>
      <section className="settings-timetable-form settings-danger-zone">
        <h2 className="settings-section-title">Delete account</h2>
        <p className="settings-hint">
          Permanently remove your personal planner and account. Your school organisations and their shared data remain.
        </p>
        <div className="settings-actions">
          <button
            type="button"
            className="settings-reset settings-reset--danger"
            onClick={() => {
              if (window.__plannixConfirmSessionDiscard?.() === false) return;
              if (window.__plannixConfirmClassDiscard?.() === false) return;
              if (window.__plannixConfirmLayoutDiscard?.() === false) return;
              setAccountError('');
              setAccountErrorReference('');
              setIsDeleteDialogOpen(true);
            }}
            disabled={isDeletingAccount}
          >
            Delete account
          </button>
        </div>
      </section>

      {isDeleteDialogOpen ? (
        <div className="settings-dialog-backdrop">
          <section
            className="settings-delete-dialog"
            role="dialog"
            aria-modal="true"
            aria-labelledby="delete-account-title"
            aria-describedby="delete-account-description"
          >
            <h2 id="delete-account-title" className="settings-section-title">
              Permanently delete account?
            </h2>
            <p id="delete-account-description" className="settings-hint">
              This permanently removes your personal organisation, personal timetable, classes, and account. It removes
              your memberships from schools but does not delete their shared data. This cannot be undone.
            </p>
            <form onSubmit={handleDeleteAccount} className="settings-delete-form">
              <div className="settings-field">
                <label htmlFor="delete-account-password">Current password</label>
                <input
                  id="delete-account-password"
                  type="password"
                  autoComplete="current-password"
                  minLength={8}
                  maxLength={128}
                  required
                  value={deletePassword}
                  disabled={isDeletingAccount}
                  onChange={(event) => {
                    deletePasswordRef.current = event.target.value;
                    setDeletePassword(event.target.value);
                  }}
                />
              </div>
              {accountError ? (
                <div className="settings-delete-error" role="alert">
                  <p>{accountError}</p>
                  {accountErrorReference ? <p>Reference: {accountErrorReference}</p> : null}
                </div>
              ) : null}
              <div className="settings-actions">
                <button
                  type="button"
                  className="settings-reset"
                  onClick={closeDeleteDialog}
                  disabled={isDeletingAccount}
                >
                  Cancel
                </button>
                <button
                  type="submit"
                  className="settings-reset settings-reset--danger"
                  disabled={isDeletingAccount || deletePassword.length < 8 || deletePassword.length > 128}
                >
                  {isDeletingAccount ? 'Deleting account…' : 'Permanently delete account'}
                </button>
              </div>
            </form>
          </section>
        </div>
      ) : null}
    </>
  );
}
