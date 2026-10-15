/**
 * Settings, AI connection: the user's bring-your-own LLM provider connection.
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
import Button from '@/components/ui/Button';
import { HideIcon, RevealIcon } from '@/components/ui/icon';
import Input from '@/components/ui/Input';
import Select from '@/components/ui/Select';
import styles from './LLMConnectionForm.module.css';
import { modelCompatibility } from '@/lib/modelCompatibility';

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
  const [testedSelection, setTestedSelection] = useState('');
  const catalogueRequest = useRef(0);

  const applyConnection = useCallback((next: LLMConnection) => {
    catalogueRequest.current += 1;
    setModelCatalogue([]);
    setTestedSelection('');
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

  const unsaved = providerHandle !== (connection?.provider ?? '') || baseUrl !== (connection?.base_url ?? '') || model !== (connection?.model ?? '') || Boolean(apiKey.trim());
  const compatibility = modelCompatibility(model);
  const selectionTested = testedSelection === `${providerHandle}|${baseUrl}|${model}`;

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
    setTestedSelection('');
    setIsTesting(true);
    try {
      const result = await AuthService.testLLMConnection();
      if (result.ok) {
        setTestedSelection(`${connection?.provider ?? ''}|${connection?.base_url ?? ''}|${connection?.model ?? ''}`);
        setStatus(`Text-generation test passed for ${connection?.model ?? connection?.server_default?.model}. ${result.message}`);
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
        <div className={styles.label}>AI provider</div>
        <div className={styles.connectionState}>
          <span
            className={
              connection?.configured || connection?.server_default
                ? styles.statusConnected
                : styles.statusUnavailable
            }
          >
            {connection?.configured
              ? `Configured for ${connection.provider_label}`
              : connection?.server_default
                ? `Using this server’s default connection (${connection.server_default.provider_label}, ${connection.server_default.model})`
                : 'Not connected'}
          </span>
          <p className={styles.hint}>
            Your own OpenAI-compatible account. Calls are billed by your provider.
          </p>
        </div>
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
              {(['text', 'unknown', 'other'] as const).map((group) => (
                <optgroup key={group} label={group === 'text' ? 'Text-generation candidates' : group === 'unknown' ? 'Unknown compatibility — test before use' : 'Other operations — unavailable here'}>
                  {modelCatalogue.filter((item) => modelCompatibility(item.id) === group).map((item) => (
                    <option key={item.id} value={item.id} disabled={group === 'other'}>{modelOptionLabel(item)}</option>
                  ))}
                </optgroup>
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

      <p className={styles.hint}>
        {compatibility === 'other' ? 'This model name indicates an operation other than text generation. Choose a chat/text model for Import, Refine, Evaluate and Try once.'
          : selectionTested ? 'The saved provider and selected model passed a text-generation test. Structured operations still depend on provider support.' : 'Model discovery and saved credentials do not verify compatibility. Model compatibility has not been tested for this selection; use Test connection after saving.'}
        {' '}Model-name grouping is guidance only. Custom models remain available for self-hosted providers.
      </p>
      {unsaved && <p className={styles.hint}>Save changes before testing. Test connection uses the saved provider and model.</p>}
      <p className={styles.hint}>Test connection sends a text-generation request using {connection?.provider_label ?? connection?.server_default?.provider_label ?? 'the saved provider'} / {connection?.model ?? connection?.server_default?.model ?? 'saved model'} and may incur provider charges.</p>

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
      {status && <div className={styles.success} role="status">{status}</div>}

      <div className={styles.actions}>
        <Button type="submit" disabled={isSaving || !providerHandle || !model.trim()}>
          {isSaving ? 'Saving…' : 'Save connection'}
        </Button>
        <Button
          type="button"
          variant="secondary"
          onClick={handleTest}
          disabled={isTesting || unsaved || !(connection?.configured || connection?.server_default)}
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
