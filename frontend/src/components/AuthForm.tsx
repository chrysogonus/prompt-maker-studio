/**
 * Login/Register/Forgot-password component
 */

'use client';

import { useRef, useState } from 'react';
import { AuthService } from '@/lib/auth';
import { APP_NAME } from '@/lib/branding';
import Wordmark from './ui/Wordmark';
import styles from './AuthForm.module.css';

interface AuthFormProps {
  onSuccess: () => void;
}

type View = 'login' | 'register' | 'forgot-password';

type FieldName = 'username' | 'password' | 'email';

type FieldErrors = Partial<Record<FieldName, string>>;

/** Focus order, so the first *visible* offending field is the one focused. */
const FIELD_ORDER: FieldName[] = ['username', 'password', 'email'];

const EMAIL_PATTERN = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

export default function AuthForm({ onSuccess }: AuthFormProps) {
  const [view, setView] = useState<View>('login');
  const [username, setUsername] = useState('');
  const [password, setPassword] = useState('');
  const [email, setEmail] = useState('');
  const [error, setError] = useState('');
  const [fieldErrors, setFieldErrors] = useState<FieldErrors>({});
  const [successMessage, setSuccessMessage] = useState('');
  const [isLoading, setIsLoading] = useState(false);
  const [showPassword, setShowPassword] = useState(false);
  const [sessionNotice] = useState(() => AuthService.getSessionExpiry?.()?.reason ?? '');

  const inputRefs = {
    username: useRef<HTMLInputElement>(null),
    password: useRef<HTMLInputElement>(null),
    email: useRef<HTMLInputElement>(null),
  };

  const switchView = (next: View) => {
    setView(next);
    setError('');
    setFieldErrors({});
    setSuccessMessage('');
    setShowPassword(false);
  };

  /** Drop one field's error as the user edits it, leaving the others standing. */
  const clearFieldError = (field: FieldName) => {
    setError('');
    setFieldErrors((prev) => {
      if (!(field in prev)) return prev;
      const next = { ...prev };
      delete next[field];
      return next;
    });
  };

  // The forms are noValidate so every invalid submit gets the same styled,
  // screen-reader-announced inline message — native browser tooltips are
  // inconsistent with the rest of the form and silently accept
  // whitespace-only input.
  //
  // Every field is checked on every submit rather than returning at the first
  // failure: a short username, a weak password and a malformed email used to
  // cost three round trips to discover.
  const validate = (): FieldErrors => {
    if (view === 'forgot-password') {
      return EMAIL_PATTERN.test(email.trim()) ? {} : { email: 'Enter a valid email address.' };
    }

    const errors: FieldErrors = {};
    if (!username.trim()) {
      errors.username = 'Enter your username.';
    } else if (view === 'register' && username.trim().length < 3) {
      errors.username = 'Username must be at least 3 characters.';
    }

    if (!password.trim()) {
      errors.password = 'Enter your password.';
    } else if (view === 'register' && password.length < 8) {
      errors.password = 'Password must be at least 8 characters.';
    }

    if (view === 'register' && !EMAIL_PATTERN.test(email.trim())) {
      errors.email = 'Enter a valid email address.';
    }
    return errors;
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setSuccessMessage('');
    const validationErrors = validate();
    setFieldErrors(validationErrors);
    const firstInvalid = FIELD_ORDER.find((field) => validationErrors[field]);
    if (firstInvalid) {
      setError('');
      inputRefs[firstInvalid].current?.focus();
      return;
    }
    setError('');
    setIsLoading(true);

    try {
      if (view === 'login') {
        await AuthService.login({ username: username.trim(), password });
        AuthService.clearSessionExpiry?.();
        onSuccess();
      } else if (view === 'register') {
        await AuthService.register({ username: username.trim(), password, email: email.trim() });
        // Auto-login after registration
        await AuthService.login({ username: username.trim(), password });
        AuthService.clearSessionExpiry?.();
        onSuccess();
      } else {
        // forgot-password
        await AuthService.forgotPassword({ email });
        setSuccessMessage(
          'If that email is registered, a reset link has been sent. Check your inbox.',
        );
      }
    } catch (err) {
      const errorMessage = err instanceof Error ? err.message : 'Authentication failed';
      setError(errorMessage);
    } finally {
      setIsLoading(false);
    }
  };

  // One live region announces everything that went wrong at once. The per-field
  // messages below are wired to their inputs with aria-describedby, so tabbing
  // back to an offending field repeats why it is at fault.
  //
  // Validation messages are announced but not drawn: each already appears under
  // its own field, so showing the joined set again in a summary box duplicated
  // every message on screen. A submission error (bad credentials, network) has
  // no field of its own, so that one stays visible.
  const announcedError =
    error || FIELD_ORDER.map((field) => fieldErrors[field]).filter(Boolean).join(' ');
  const errorSummary = announcedError && (
    <div className={error ? styles.error : styles.visuallyHidden} role="alert">
      {announcedError}
    </div>
  );

  const cardContent = view === 'forgot-password' ? (
    <>
      <div className={styles.brand}>
        <h2 className={styles.title}>Reset your password</h2>
        <p className={styles.subtitle}>
          Enter your email address and we&apos;ll send you a reset link.
        </p>
      </div>

      {successMessage ? (
        <div className={styles.successMessage}>{successMessage}</div>
      ) : (
        <form onSubmit={handleSubmit} className={styles.form} noValidate>
          <div className={styles.field}>
            <label htmlFor="email" className={styles.label}>
              Email address
            </label>
            <input
              id="email"
              ref={inputRefs.email}
              type="email"
              value={email}
              onChange={(e) => {
                setEmail(e.target.value);
                clearFieldError('email');
              }}
              className={styles.input}
              placeholder="you@example.com"
              required
              autoComplete="email"
              aria-invalid={!!fieldErrors.email}
              aria-describedby={fieldErrors.email ? 'email-error' : undefined}
            />
            {fieldErrors.email && (
              <p id="email-error" className={styles.fieldError}>
                {fieldErrors.email}
              </p>
            )}
          </div>

          {errorSummary}

          <button type="submit" className={styles.submitButton} disabled={isLoading}>
            <span>{isLoading ? 'Sending…' : 'Send reset link'}</span>
            <span
              className={isLoading ? styles.buttonSpinner : styles.buttonArrow}
              aria-hidden="true"
            >
              {isLoading ? '' : '→'}
            </span>
          </button>
        </form>
      )}

      <div className={styles.cardFooter}>
        <button onClick={() => switchView('login')} className={styles.toggleButton} type="button">
          Back to sign in
        </button>
      </div>
    </>
  ) : (
    <>
      <div className={styles.brand}>
        <h2 className={styles.title}>
          {view === 'login' ? 'Welcome back' : 'Create your account'}
        </h2>
        <p className={styles.subtitle}>
          {view === 'login'
            ? `Sign in to your ${APP_NAME} account`
            : `Get started with ${APP_NAME}`}
        </p>
      </div>

      <form onSubmit={handleSubmit} className={styles.form} noValidate>
        {view === 'login' && sessionNotice && (
          <div className={styles.sessionNotice} role="status">{sessionNotice}</div>
        )}
        <div className={styles.field}>
          <label htmlFor="username" className={styles.label}>
            Username
          </label>
          <input
            id="username"
            ref={inputRefs.username}
            type="text"
            value={username}
            onChange={(e) => {
              setUsername(e.target.value);
              clearFieldError('username');
            }}
            className={styles.input}
            placeholder="Enter your username"
            required
            minLength={3}
            autoComplete="username"
            aria-invalid={!!fieldErrors.username}
            aria-describedby={fieldErrors.username ? 'username-error' : undefined}
          />
          {fieldErrors.username && (
            <p id="username-error" className={styles.fieldError}>
              {fieldErrors.username}
            </p>
          )}
        </div>

        <div className={styles.field}>
          <label htmlFor="password" className={styles.label}>
            Password
          </label>
          <div className={styles.passwordWrap}>
            <input
              id="password"
              ref={inputRefs.password}
              type={showPassword ? 'text' : 'password'}
              value={password}
              onChange={(e) => {
                setPassword(e.target.value);
                clearFieldError('password');
              }}
              className={styles.input}
              placeholder="Enter your password"
              required
              minLength={view === 'login' ? 1 : 8}
              autoComplete={view === 'login' ? 'current-password' : 'new-password'}
              aria-invalid={!!fieldErrors.password}
              aria-describedby={fieldErrors.password ? 'password-error' : undefined}
            />
            <button
              type="button"
              className={styles.revealButton}
              onClick={() => setShowPassword((prev) => !prev)}
              aria-label={showPassword ? 'Hide password' : 'Show password'}
              aria-pressed={showPassword}
            >
              {showPassword ? 'Hide' : 'Show'}
            </button>
          </div>
          {fieldErrors.password && (
            <p id="password-error" className={styles.fieldError}>
              {fieldErrors.password}
            </p>
          )}
        </div>

        {view === 'register' && (
          <div className={styles.field}>
            <label htmlFor="reg-email" className={styles.label}>
              Email address
            </label>
            <input
              id="reg-email"
              ref={inputRefs.email}
              type="email"
              value={email}
              onChange={(e) => {
                setEmail(e.target.value);
                clearFieldError('email');
              }}
              className={styles.input}
              placeholder="you@example.com"
              required
              maxLength={254}
              autoComplete="email"
              aria-invalid={!!fieldErrors.email}
              aria-describedby={fieldErrors.email ? 'reg-email-error' : undefined}
            />
            {fieldErrors.email && (
              <p id="reg-email-error" className={styles.fieldError}>
                {fieldErrors.email}
              </p>
            )}
          </div>
        )}

        {errorSummary}

        <button type="submit" className={styles.submitButton} disabled={isLoading}>
          <span>
            {isLoading ? 'Please wait…' : view === 'login' ? 'Sign in' : 'Create account'}
          </span>
          <span
            className={isLoading ? styles.buttonSpinner : styles.buttonArrow}
            aria-hidden="true"
          >
            {isLoading ? '' : '→'}
          </span>
        </button>
      </form>

      {/* Both secondary paths share one row so the card ends on a single
          balanced line instead of two stacked, centred blocks. */}
      <div className={styles.cardFooter}>
        {view === 'login' && (
          <button
            onClick={() => switchView('forgot-password')}
            className={styles.toggleButton}
            type="button"
          >
            Forgot password?
          </button>
        )}
        <span className={styles.footerPrompt}>
          {view === 'login' ? 'New here? ' : 'Already have an account? '}
          <button
            onClick={() => switchView(view === 'login' ? 'register' : 'login')}
            className={styles.toggleButton}
            type="button"
          >
            {view === 'login' ? 'Create account' : 'Sign in'}
          </button>
        </span>
      </div>
    </>
  );

  return (
    <div className={styles.container}>
      <div className={styles.glow} aria-hidden="true" />

      <main className={styles.authShell}>
        <section className={styles.visualPanel} aria-labelledby="auth-product-title">
          <Wordmark icon="tile" className={styles.wordmark} />

          <div className={styles.intro}>
            <p className={styles.eyebrow}>A focused prompt workspace</p>
            <h1 id="auth-product-title" className={styles.heroTitle}>
              Turn rough ideas into prompts you can trust.
            </h1>
            <p className={styles.heroCopy}>
              Structure, test, and reuse prompts from one focused workspace.
            </p>
          </div>

          {/* A sample of what the product produces, shown as-is. It deliberately
              does not animate a before/after transformation — the page has one
              entrance and no ambient motion. */}
          <div className={styles.promptCard} aria-hidden="true">
            <div className={styles.cardChrome}>
              <span className={styles.chromeDot} />
              <span>Structured prompt</span>
            </div>
            <div className={styles.promptRow}>
              <span className={styles.promptTag}>&lt;GOAL&gt;</span>
              <span>Write a launch brief</span>
            </div>
            <div className={styles.promptRow}>
              <span className={styles.promptTag}>&lt;AUDIENCE&gt;</span>
              <span>Developer teams</span>
            </div>
            <div className={styles.promptRow}>
              <span className={styles.promptTag}>&lt;CONSTRAINTS&gt;</span>
              <span>Clear · concise · actionable</span>
            </div>
            <div className={styles.readyStatus}>
              <span className={styles.readyDot} />
              Structured prompt · ready
            </div>
          </div>
        </section>

        <div className={styles.card}>
          <div key={view} className={styles.cardContent}>
            {cardContent}
          </div>
        </div>
      </main>
    </div>
  );
}
