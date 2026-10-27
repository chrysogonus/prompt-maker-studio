import { useState } from 'react';

import ChangePasswordForm from '@/features/auth/ChangePasswordForm';

import Button from '@/components/ui/Button';

import styles from './SettingsPage.module.css';
import type { useSettings } from './useSettings';

type Props = Pick<
  ReturnType<typeof useSettings>,
  | 'isSigningOutEverywhere'
  | 'signOutError'
  | 'handleSignOutEverywhere'
>;

export function SecuritySettings({
  isSigningOutEverywhere,
  signOutError,
  handleSignOutEverywhere,
}: Props) {
  // Signs this device out too, so ask once before doing it.
  const [confirming, setConfirming] = useState(false);
  return (
    <section className={styles.section} id="s-security" aria-labelledby="h-security">
      <div className={styles.intro}>
        <h2 id="h-security">Password and sessions</h2>
        <p>Changing your password signs out every other device.</p>
      </div>
      <div className={styles.body}>
        <div className={styles.row}>
          <div className={styles.rowLabel}>Password</div>
          <ChangePasswordForm />
        </div>
        <div className={styles.row}>
          <div className={styles.rowLabel}>Sign out everywhere</div>
          <div className={styles.settingAction}>
            {confirming ? (
              <div className={styles.confirmActions}>
                <Button
                  variant="secondary"
                  onClick={handleSignOutEverywhere}
                  disabled={isSigningOutEverywhere}
                  autoFocus
                >
                  {isSigningOutEverywhere ? 'Signing out…' : 'Sign out all devices'}
                </Button>
                <Button variant="ghost" onClick={() => setConfirming(false)} disabled={isSigningOutEverywhere}>
                  Cancel
                </Button>
              </div>
            ) : (
              <Button variant="secondary" onClick={() => setConfirming(true)}>
                Sign out everywhere…
              </Button>
            )}
            <p className={styles.hint}>
              Including devices you no longer have. You will need to sign in again here.
            </p>
          </div>
        </div>
        {signOutError && <div className={styles.error} role="alert">{signOutError}</div>}
      </div>
    </section>
  );
}
