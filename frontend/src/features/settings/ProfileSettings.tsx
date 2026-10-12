import Button from '@/components/ui/Button';
import Input from '@/components/ui/Input';

import styles from './SettingsPage.module.css';
import type { useSettings } from './useSettings';

type Props = Pick<
  ReturnType<typeof useSettings>,
  | 'currentUser'
  | 'user'
  | 'showUsernameEdit'
  | 'setShowUsernameEdit'
  | 'newUsernameValue'
  | 'setNewUsernameValue'
  | 'usernameError'
  | 'setUsernameError'
  | 'showEmailEdit'
  | 'setShowEmailEdit'
  | 'newEmailValue'
  | 'setNewEmailValue'
  | 'emailError'
  | 'setEmailError'
  | 'handleUsernameChange'
  | 'handleEmailChange'
>;

export function ProfileSettings({
  currentUser,
  user,
  showUsernameEdit,
  setShowUsernameEdit,
  newUsernameValue,
  setNewUsernameValue,
  usernameError,
  setUsernameError,
  showEmailEdit,
  setShowEmailEdit,
  newEmailValue,
  setNewEmailValue,
  emailError,
  setEmailError,
  handleUsernameChange,
  handleEmailChange,
}: Props) {
  return (
    <section className={styles.section} id="s-profile" aria-labelledby="h-profile">
      <div className={styles.intro}>
        <h2 id="h-profile">Profile</h2>
        <p>Used to sign in and to recover your account.</p>
      </div>
      <div className={styles.body}>
        <div className={styles.row}>
          <div>
            <div className={styles.rowLabel}>Username</div>
            <div className={styles.rowValue}>{currentUser}</div>
          </div>
          {!showUsernameEdit && (
            <Button
              variant="secondary"
              onClick={() => {
                setNewUsernameValue(currentUser ?? '');
                setShowUsernameEdit(true);
                setUsernameError('');
              }}
            >
              Edit username
            </Button>
          )}
        </div>
        {showUsernameEdit && (
          <form onSubmit={handleUsernameChange} className={styles.inlineForm} noValidate>
            <Input
              value={newUsernameValue}
              onChange={(e) => setNewUsernameValue(e.target.value)}
              aria-label="New username"
              minLength={3}
              maxLength={50}
              required
              autoFocus
            />
            <Button type="submit" variant="primary">
              Save
            </Button>
            <Button type="button" variant="ghost" onClick={() => setShowUsernameEdit(false)}>
              Cancel
            </Button>
            <p className={styles.hint}>Changing your username signs you out.</p>
          </form>
        )}
        {usernameError && <div className={styles.error} role="alert">{usernameError}</div>}

        <div className={styles.row}>
          <div>
            <div className={styles.rowLabel}>Email</div>
            <div className={styles.rowValue}>{user?.email || 'No email on file'}</div>
          </div>
          {!showEmailEdit && (
            <Button
              variant="secondary"
              onClick={() => {
                setNewEmailValue(user?.email ?? '');
                setShowEmailEdit(true);
                setEmailError('');
              }}
            >
              Edit email
            </Button>
          )}
        </div>
        {showEmailEdit && (
          <form onSubmit={handleEmailChange} className={styles.inlineForm} noValidate>
            <Input
              type="email"
              value={newEmailValue}
              onChange={(e) => setNewEmailValue(e.target.value)}
              aria-label="New email"
              placeholder="you@example.com"
              required
              autoFocus
            />
            <Button type="submit" variant="primary">
              Save
            </Button>
            <Button type="button" variant="ghost" onClick={() => setShowEmailEdit(false)}>
              Cancel
            </Button>
          </form>
        )}
        {emailError && <div className={styles.error} role="alert">{emailError}</div>}
      </div>
    </section>
  );
}
