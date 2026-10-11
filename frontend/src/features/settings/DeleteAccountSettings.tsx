import Button from '@/components/ui/Button';
import Input from '@/components/ui/Input';

import styles from './SettingsPage.module.css';
import type { useSettings } from './useSettings';

type Props = Pick<
  ReturnType<typeof useSettings>,
  | 'showDeleteConfirm'
  | 'setShowDeleteConfirm'
  | 'isDeleting'
  | 'deletePassword'
  | 'setDeletePassword'
  | 'deleteError'
  | 'handleDeleteAccount'
  | 'closeDeleteConfirm'
>;

export function DeleteAccountSettings({
  showDeleteConfirm,
  setShowDeleteConfirm,
  isDeleting,
  deletePassword,
  setDeletePassword,
  deleteError,
  handleDeleteAccount,
  closeDeleteConfirm,
}: Props) {
  return (
    <section className={styles.section} id="s-danger" aria-labelledby="h-danger">
      <div className={styles.intro}>
        <h2 id="h-danger" className={styles.danger}>
          Delete account
        </h2>
      </div>
      <div className={styles.body}>
        <p className={styles.text}>
          Permanently deletes your account and all your prompts. This can&apos;t be undone.
        </p>
        {!showDeleteConfirm ? (
          <div>
            <Button variant="danger" onClick={() => setShowDeleteConfirm(true)}>
              Delete account…
            </Button>
          </div>
        ) : (
          <div className={styles.confirm}>
            <p>Enter your password to delete your account and every prompt in it.</p>
            <Input
              type="password"
              value={deletePassword}
              onChange={(e) => setDeletePassword(e.target.value)}
              placeholder="Your password"
              aria-label="Confirm your password"
              aria-invalid={!!deleteError}
              autoComplete="current-password"
              disabled={isDeleting}
            />
            <div className={styles.confirmActions}>
              <Button
                variant="danger"
                onClick={handleDeleteAccount}
                disabled={isDeleting || deletePassword.length === 0}
              >
                {isDeleting ? 'Deleting…' : 'Delete my account'}
              </Button>
              <Button variant="secondary" onClick={closeDeleteConfirm} disabled={isDeleting}>
                Cancel
              </Button>
            </div>
            {deleteError && (
              <div className={styles.error} role="alert">
                {deleteError}
              </div>
            )}
          </div>
        )}
      </div>
    </section>
  );
}
