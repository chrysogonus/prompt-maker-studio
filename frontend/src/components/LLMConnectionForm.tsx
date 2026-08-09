/**
 * Settings → API access: the user's bring-your-own LLM provider connection.
 *
 * Every AI feature runs against the provider configured here, billed to the
 * user's own account — there is no operator-wide key. The stored API key is
 * never returned by the backend, so an existing key shows only as a masked
 * hint and the field stays blank; submitting it blank keeps the stored key.
 */

'use client';

import { useCallback, useEffect, useMemo, useRef, useState, FormEvent } from 'react';
import { AuthService } from '@/lib/auth';
import { LLMConnection, LLMModelPriceInfo, LLMProviderOption } from '@/types/auth';
import Button from './ui/Button';
import { HideIcon, RevealIcon } from './ui/icon';
import Input from './ui/Input';
import Select from './ui/Select';
import styles from './LLMConnectionForm.module.css';

function formatPrice(price: number): string {
  return price.toLocaleString('en-US', {
    minimumFractionDigits: 2,
    maximumFractionDigits: price < 0.01 ? 6 : 2,
  });
}

function modelOptionLabel(model: LLMModelPriceInfo): string {
  if (model.input_price_per_1m === null || model.output_price_per_1m === null) {
    return `${model.id} — pricing unknown`;
  }
  return `${model.id} — $${formatPrice(model.input_price_per_1m)}/$${formatPrice(model.output_price_per_1m)} per 1M tokens`;
}

export default function LLMConnectionForm() {
  const [connection, setConnection] = useState<LLMConnection | null>(null);
  const [modelCatalogue, setModelCatalogue] = useState<LLMModelPriceInfo[]>([]);
  const [providerHandle, setProviderHandle] = useState('');
  const [baseUrl, setBaseUrl] = useState('');
  const [model, setModel] = useState('');
  const [apiKey, setApiKey] = useState('');
  const [showApiKey, setShowApiKey] = useState(false);
  const [isLoading, setIsLoading] = useState(true);
  const [isSaving, setIsSaving] = useState(false);
  const [isTesting, setIsTesting] = useState(false);
  const [error, setError] = useState('');
  const [status, setStatus] = useState('');
  const catalogueRequest = useRef(0);

  const applyConnection = useCallback((next: LLMConnection) => {
    catalogueRequest.current += 1;
    setModelCatalogue([]);
    setConnection(next);
    setProviderHandle(next.provider ?? '');
    setBaseUrl(next.base_url ?? '');
    setModel(next.model ?? '');
    setApiKey('');
    setShowApiKey(false);
  }, []);

  const refreshModelCatalogue = useCallback(async () => {
    const requestId = ++catalogueRequest.current;
    try {
      const models = await AuthService.getLLMModels();
      if (catalogueRequest.current === requestId) setModelCatalogue(models);
    } catch {
      // A catalogue is optional: retain the existing free-text fallback when a
      // provider does not expose /models or LiteLLM/provider access is down.
      if (catalogueRequest.current === requestId) setModelCatalogue([]);
    }
  }, []);

  useEffect(() => {
    AuthService.getLLMConnection()
      .then((next) => {
        applyConnection(next);
        if (next.configured) void refreshModelCatalogue();
      })
      .catch((err) =>
        setError(err instanceof Error ? err.message : 'Failed to load the provider connection.'),
      )
      .finally(() => setIsLoading(false));
  }, [applyConnection, refreshModelCatalogue]);

  const providers: LLMProviderOption[] = useMemo(
    () => connection?.providers ?? [],
    [connection],
  );
  const selected = useMemo(
    () => providers.find((p) => p.handle === providerHandle),
    [providers, providerHandle],
  );

  // Switching vendors always needs a fresh key: the backend refuses to present
  // one provider's credential to another, so say so before the user submits.
  const providerChanged = Boolean(connection?.provider) && providerHandle !== connection?.provider;
  const keyRequired = Boolean(
    selected?.requires_api_key && (providerChanged || !connection?.has_api_key),
  );

  const handleProviderChange = (handle: string) => {
    catalogueRequest.current += 1;
    setModelCatalogue([]);
    setProviderHandle(handle);
    setStatus('');
    setError('');
    const next = providers.find((p) => p.handle === handle);
    setBaseUrl(next?.default_base_url ?? '');
    // Suggested models are provider-specific, so a carried-over model name
    // would almost always be wrong for the new vendor.
    setModel(next?.suggested_models[0] ?? '');
    setApiKey('');
    setShowApiKey(false);
  };

  const handleSubmit = async (e: FormEvent) => {
    e.preventDefault();
    setError('');
    setStatus('');
    setIsSaving(true);
    try {
      const updated = await AuthService.updateLLMConnection({
        provider: providerHandle,
        base_url: baseUrl.trim() || null,
        model: model.trim(),
        // Blank means "leave the stored key alone" — only send a real value.
        ...(apiKey.trim() ? { api_key: apiKey.trim() } : {}),
      });
      applyConnection(updated);
      void refreshModelCatalogue();
      setStatus('Connection saved.');
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to save the provider connection.');
    } finally {
      setIsSaving(false);
    }
  };

  const handleTest = async () => {
    setError('');
    setStatus('');
    setIsTesting(true);
    try {
      const result = await AuthService.testLLMConnection();
      if (result.ok) {
        setStatus(result.message);
        void refreshModelCatalogue();
      } else {
        setError(result.message);
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to test the connection.');
    } finally {
      setIsTesting(false);
    }
  };

  const handleDisconnect = async () => {
    setError('');
    setStatus('');
    setIsSaving(true);
    try {
      applyConnection(await AuthService.deleteLLMConnection());
      setStatus('Disconnected. Your API key has been erased.');
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to disconnect.');
    } finally {
      setIsSaving(false);
    }
  };

  if (isLoading) {
    return <div className={styles.hint}>Loading connection…</div>;
  }

  return (
    <form onSubmit={handleSubmit} className={styles.form} noValidate>
      <div className={styles.headerRow}>
        <div>
          <div className={styles.label}>AI provider</div>
          <div className={styles.hint}>
            Bring your own account. AI import, Refine, the Playground, and evaluations all run
            against this endpoint and are billed to you.
          </div>
        </div>
        <span
          className={connection?.configured ? styles.statusConnected : styles.statusUnavailable}
        >
          {connection?.configured
            ? `Connected · ${connection.provider_label}`
            : 'Not connected'}
        </span>
      </div>

      <label className={styles.field}>
        <span className={styles.fieldLabel}>Provider</span>
        <Select
          value={providerHandle}
          onChange={(e) => handleProviderChange(e.target.value)}
          aria-label="Provider"
        >
          <option value="">Select a provider…</option>
          {providers.map((p) => (
            <option key={p.handle} value={p.handle}>
              {p.label}
            </option>
          ))}
        </Select>
      </label>

      <label className={styles.field}>
        <span className={styles.fieldLabel}>Base URL</span>
        <Input
          value={baseUrl}
          onChange={(e) => setBaseUrl(e.target.value)}
          placeholder={selected?.default_base_url ?? 'http://localhost:11434/v1'}
          aria-label="Base URL"
          spellCheck={false}
        />
      </label>

      <div className={styles.field}>
        <span className={styles.fieldLabel}>Model</span>
        {modelCatalogue.length > 0 ? (
          <div className={styles.modelPicker}>
            <Select
              value={modelCatalogue.some((item) => item.id === model) ? model : ''}
              onChange={(e) => setModel(e.target.value)}
              aria-label="Available models"
            >
              <option value="">Choose a listed model or type one below…</option>
              {modelCatalogue.map((item) => (
                <option key={item.id} value={item.id}>
                  {modelOptionLabel(item)}
                </option>
              ))}
            </Select>
            <Input
              value={model}
              onChange={(e) => setModel(e.target.value)}
              placeholder="Or enter any model name"
              aria-label="Model"
              spellCheck={false}
            />
          </div>
        ) : (
          <div>
            <Input
              value={model}
              onChange={(e) => setModel(e.target.value)}
              placeholder="Model name your provider serves"
              aria-label="Model"
              list={selected?.suggested_models.length ? 'llm-model-suggestions' : undefined}
              spellCheck={false}
            />
            {selected && selected.suggested_models.length > 0 && (
              <datalist id="llm-model-suggestions">
                {selected.suggested_models.map((m) => (
                  <option key={m} value={m} />
                ))}
              </datalist>
            )}
          </div>
        )}
      </div>

      <div className={styles.field}>
        <label className={styles.fieldLabel} htmlFor="llm-api-key">
          API key{selected && !selected.requires_api_key ? ' (optional)' : ''}
        </label>
        <span className={styles.inputWithAction}>
          <Input
            id="llm-api-key"
            type={showApiKey ? 'text' : 'password'}
            value={apiKey}
            onChange={(e) => setApiKey(e.target.value)}
            placeholder={
              connection?.has_api_key && !providerChanged
                ? `Stored (${connection.api_key_hint}) — leave blank to keep`
                : 'Paste your API key'
            }
            className={styles.apiKeyInput}
            aria-label="API key"
            autoComplete="off"
            spellCheck={false}
          />
          <button
            type="button"
            className={styles.apiKeyAction}
            aria-label={showApiKey ? 'Hide API key' : 'Reveal API key'}
            title={showApiKey ? 'Hide API key' : 'Reveal API key'}
            onClick={() => setShowApiKey((visible) => !visible)}
          >
            {showApiKey ? (
              <HideIcon size={16} tone="inherit" />
            ) : (
              <RevealIcon size={16} tone="inherit" />
            )}
          </button>
        </span>
      </div>

      {keyRequired && (
        <div className={styles.hint}>
          {providerChanged
            ? 'Switching providers requires a new API key.'
            : `${selected?.label} requires an API key.`}
        </div>
      )}

      {selected?.docs_url && (
        <div className={styles.hint}>
          <a href={selected.docs_url} target="_blank" rel="noreferrer noopener">
            {selected.label} API documentation ↗
          </a>
        </div>
      )}

      {error && (
        <div className={styles.error} role="alert">
          {error}
        </div>
      )}
      {status && <div className={styles.success}>{status}</div>}

      <div className={styles.actions}>
        <Button type="submit" disabled={isSaving || !providerHandle || !model.trim()}>
          {isSaving ? 'Saving…' : 'Save connection'}
        </Button>
        <Button
          type="button"
          variant="secondary"
          onClick={handleTest}
          disabled={isTesting || !connection?.configured}
        >
          {isTesting ? 'Testing…' : 'Test connection'}
        </Button>
        {connection?.provider && (
          <Button
            type="button"
            variant="secondary"
            onClick={handleDisconnect}
            disabled={isSaving}
          >
            Disconnect
          </Button>
        )}
      </div>
    </form>
  );
}
