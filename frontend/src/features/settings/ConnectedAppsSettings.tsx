'use client';

import { useEffect, useState } from 'react';
import Button from '@/components/ui/Button';
import { AuthService } from '@/lib/auth';
import type { ConnectedApp } from '@/types/auth';
import styles from './SettingsPage.module.css';

const CHATGPT_GUIDE = 'https://developers.openai.com/plugins/deploy/connect-chatgpt';
const CLAUDE_GUIDE = 'https://claude.com/docs/connectors/custom/add-unlisted';

/** Use the library from inside ChatGPT or Claude: where to connect it, and what is connected now. */
export function ConnectedAppsSettings() {
  const [apps, setApps] = useState<ConnectedApp[] | null>(null);
  const [error, setError] = useState('');
  const [copied, setCopied] = useState(false);
  const [busy, setBusy] = useState<string | null>(null);
  const [url, setUrl] = useState('');

  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect -- The origin is only known in the browser, after mount.
    setUrl(`${window.location.origin}/api/mcp`);
    AuthService.getConnectedApps().then(setApps).catch(() => setError('Could not load connected apps. Reload to try again.'));
  }, []);

  // ChatGPT and Claude connect from the internet, over HTTPS only.
  const unreachable = !!url && (!url.startsWith('https:') || /^https?:\/\/(localhost|127\.|\[::1\])/.test(url));

  const copy = async () => {
    try { await navigator.clipboard.writeText(url); setCopied(true); } catch { setError('Copying failed. Select the address and copy it.'); }
  };
  const disconnect = async (app: ConnectedApp) => {
    setBusy(app.client_id);
    setError('');
    try {
      await AuthService.disconnectConnectedApp(app.client_id);
      setApps(current => current?.filter(item => item.client_id !== app.client_id) ?? null);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Could not disconnect the app.');
    } finally {
      setBusy(null);
    }
  };

  return (
    <section className={styles.section} id="s-chatgpt" aria-labelledby="h-chatgpt">
      <div className={styles.intro}>
        <h2 id="h-chatgpt">ChatGPT and Claude</h2>
        <p>Use your library inside ChatGPT or Claude.</p>
      </div>
      <div className={styles.body}>
        <p className={styles.text}>
          Connect ChatGPT or Claude to list, open, fill in and save your prompts from a conversation.
          The AI work happens in that app on your own plan, such as a Claude Pro or Max subscription,
          so it needs no API key here. It is separate from the AI connection above.
        </p>
        <ol className={styles.steps}>
          <li>
            Add a custom connector (a remote MCP server). In ChatGPT,{' '}
            <a href={CHATGPT_GUIDE} target="_blank" rel="noreferrer noopener">OpenAI&apos;s guide ↗</a> shows where,
            depending on your plan. In Claude, go to Customize → Connectors → Add custom connector;{' '}
            <a href={CLAUDE_GUIDE} target="_blank" rel="noreferrer noopener">Anthropic&apos;s guide ↗</a> covers
            every plan, including Team and Enterprise, where an Owner adds it.
          </li>
          <li>
            Use this server address with OAuth sign-in:{' '}
            <code className={styles.connectUrl}>{url}</code>{' '}
            <Button variant="secondary" onClick={() => void copy()}>{copied ? 'Copied' : 'Copy address'}</Button>
            {unreachable && <p className={styles.error}>
              ChatGPT and Claude cannot reach this address: it is on this computer or not HTTPS.
              Open the app at its public HTTPS address to connect them.
            </p>}
          </li>
          <li>When the app asks, sign in here and allow access.</li>
        </ol>
        <h3 className={styles.subheading}>Connected apps</h3>
        {apps === null && !error && <p className={styles.hint}>Loading…</p>}
        {apps?.length === 0 && <p className={styles.hint}>No apps are connected yet.</p>}
        {apps && apps.length > 0 && <ul className={styles.appList}>
          {apps.map(app => <li key={app.client_id}>
            <span>{app.name}</span>
            <Button variant="secondary" disabled={busy !== null} onClick={() => void disconnect(app)}>
              {busy === app.client_id ? 'Disconnecting…' : 'Disconnect'}
            </Button>
          </li>)}
        </ul>}
        {error && <p className={styles.error} role="alert">{error}</p>}
      </div>
    </section>
  );
}
