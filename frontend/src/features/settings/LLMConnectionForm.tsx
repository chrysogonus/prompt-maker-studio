/**
 * Settings, AI connection: the user's bring-your-own LLM provider connection.
 *
 * Every AI feature runs against the provider configured here, billed to the
 * user's own account; without one, the operator's server default (if any) is
 * used at the operator's expense. The stored API key is
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
  const label = model.label ?? model.id;
  if (model.input_price_per_1m === null || model.output_price_per_1m === null) {
    return `${label} — pricing unknown`;
  }
  return `${label} — $${formatPrice(model.input_price_per_1m)}/$${formatPrice(model.output_price_per_1m)} per 1M tokens`;
}

export default function LLMConnectionForm() {
  const [connection, setConnection] = useState<LLMConnection | null>(null);
  const [modelCatalogue, setModelCatalogue] = useState<LLMModelPriceInfo[]>([]);
  const [providerHandle, setProviderHandle] = useState('');
  const [baseUrl, setBaseUrl] = useState('');
  const [model, setModel] = useState('');
  const [apiKey, setApiKey] = useState('');
  const [workspaceId, setWorkspaceId] = useState('');
  const [showApiKey, setShowApiKey] = useState(false);
  const [isLoading, setIsLoading] = useState(true);
  const [isSaving, setIsSaving] = useState(false);
  const [isTesting, setIsTesting] = useState(false);
  const [confirmDisconnect, setConfirmDisconnect] = useState(false);
  const [error, setError] = useState('');
  const [status, setStatus] = useState('');
  const [testedSelection, setTestedSelection] = useState('');
  const [testMessage, setTestMessage] = useState('');
  const catalogueRequest = useRef(0);
  // A saved or removed connection makes a test still in flight meaningless.
  const testRequest = useRef(0);

  const applyConnection = useCallback((next: LLMConnection) => {
    catalogueRequest.current += 1;
    testRequest.current += 1;
    setModelCatalogue([]);
    setTestedSelection('');
    setConnection(next);
    setProviderHandle(next.provider ?? '');
    setBaseUrl(next.base_url ?? '');
    setModel(next.model ?? '');
    setWorkspaceId(next.provider === 'anthropic' ? next.workspace_id ?? '' : '');
    setApiKey('');
    setShowApiKey(false);
  }, []);

  const refreshModelCatalogue = useCallback(async (next: LLMConnection) => {
    const requestId = ++catalogueRequest.current;
    if (next.providers.find((p) => p.handle === next.provider)?.models.length) return;
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
        if (next.configured) void refreshModelCatalogue(next);
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

  const unsaved = providerHandle !== (connection?.provider ?? '') || baseUrl !== (connection?.base_url ?? '') || model !== (connection?.model ?? '') || Boolean(apiKey.trim()) || workspaceId !== (connection?.workspace_id ?? '');
  const curatedModels = selected?.models ?? [];
  const isCurated = curatedModels.length > 0;
  const unlistedModel = isCurated && !curatedModels.some((item) => item.id === model);
  const legacyModel = isCurated && connection?.provider === providerHandle && connection.model
    && !curatedModels.some((item) => item.id === connection.model);
  const complete = Boolean(providerHandle && model.trim() && !unlistedModel && !(keyRequired && !apiKey.trim()));
  const compatibility = modelCompatibility(model);
  // Includes the typed key: a passed test must not vouch for credentials edited since.
  const selection = `${providerHandle}|${baseUrl}|${model}|${workspaceId}|${apiKey.trim()}`;
  const selectionTested = testedSelection === selection;

  const handleProviderChange = (handle: string) => {
    catalogueRequest.current += 1;
    setModelCatalogue([]);
    setProviderHandle(handle);
    setWorkspaceId('');
    setStatus('');
    setError('');
    const next = providers.find((p) => p.handle === handle);
    setBaseUrl(next?.default_base_url ?? '');
    // Suggested models are provider-specific, so a carried-over model name
    // would almost always be wrong for the new vendor. Prices differ widely,
    // so the user picks one rather than getting the first (priciest) listed.
    setModel('');
    setApiKey('');
    setShowApiKey(false);
  };

  const formValues = () => ({
    provider: providerHandle,
    base_url: baseUrl.trim() || null,
    model: model.trim(),
    ...(providerHandle === 'anthropic' ? { workspace_id: workspaceId || null } : {}),
    // Blank means "leave the stored key alone" — only send a real value.
    ...(apiKey.trim() ? { api_key: apiKey.trim() } : {}),
  });

  const handleSubmit = async (e: FormEvent) => {
    e.preventDefault();
    if (unlistedModel) return;
    if (providerHandle === 'anthropic' && workspaceId && !/^wrkspc_[A-Za-z0-9]+$/.test(workspaceId)) {
      setError('Enter a valid Anthropic workspace ID starting with wrkspc_.');
      return;
    }
    setError('');
    setStatus('');
    setIsSaving(true);
    try {
      const updated = await AuthService.updateLLMConnection(formValues());
      applyConnection(updated);
      void refreshModelCatalogue(updated);
      setStatus('Connection saved.');
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to save the provider connection.');
    } finally {
      setIsSaving(false);
    }
  };

  const handleTest = async () => {
    const tested = selection;
    const id = ++testRequest.current;
    setError('');
    setStatus('');
    setTestedSelection('');
    setTestMessage('');
    setIsTesting(true);
    try {
      // Unsaved values are tested as entered, without saving them.
      const result = await AuthService.testLLMConnection(unsaved ? formValues() : undefined);
      if (id !== testRequest.current) return;
      if (result.ok) {
        // The values sent, not the current ones: the form may have changed meanwhile.
        setTestedSelection(tested);
        setTestMessage(`Text-generation test passed for ${unsaved ? model : connection?.model ?? connection?.server_default?.model}. ${result.message}`);
        if (connection && !unsaved) void refreshModelCatalogue(connection);
      } else {
        setError(result.message);
      }
    } catch (err) {
      if (id === testRequest.current) setError(err instanceof Error ? err.message : 'Failed to test the connection.');
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
            {!connection?.configured && connection?.server_default
              ? 'The site operator pays for the shared connection. Save your own account to use it instead; your provider then bills you.'
              : connection?.configured && connection.server_default
                ? `Your own account; your provider bills these calls. Without it, this server’s shared connection (${connection.server_default.provider_label}, ${connection.server_default.model}) would be used.`
                : 'Your own account; your provider bills these calls.'}
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
          placeholder={selected ? selected.default_base_url ?? 'http://localhost:11434/v1' : ''}
          aria-label="Base URL"
          spellCheck={false}
        />
      </label>
      {selected && !selected.requires_api_key && (connection?.private_urls_allowed ? (
        <p className={styles.hint}>
          Running this app in Docker? There, <code>localhost</code> is the backend container. Use an
          address it can reach, such as <code>http://host.docker.internal:11434/v1</code>.
        </p>
      ) : (
        <p className={styles.hint}>
          This server does not allow private or local addresses, so a model on your own computer or
          network cannot be reached from here. Use an address that is reachable over the internet.
        </p>
      ))}

      <div className={styles.field}>
        <span className={styles.fieldLabel}>Model</span>
        {isCurated ? (
          <div className={styles.modelPicker}>
            <Select
              value={unlistedModel ? '' : model}
              onChange={(e) => setModel(e.target.value)}
              aria-label="Model"
            >
              <option value="">Choose a current model…</option>
              {curatedModels.map((item) => (
                <option key={item.id} value={item.id}>{modelOptionLabel(item)}</option>
              ))}
            </Select>
            {legacyModel && (
              <p className={styles.hint}>
                Previously configured model: {connection.model}. Choose a current model to update this connection.
              </p>
            )}
          </div>
        ) : modelCatalogue.length > 0 ? (
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
              spellCheck={false}
            />
          </div>
        )}
      </div>

      <p className={styles.hint}>
        {isCurated
          ? selectionTested ? 'Text-generation test passed for this model.' : 'Use Test connection to check access, before or after saving.'
          : compatibility === 'other' ? 'This model name indicates an operation other than text generation. Choose a chat/text model for Import, Refine, Evaluate and Try once.'
          : selectionTested ? 'This provider and model passed a text-generation test. Structured operations still depend on provider support.' : 'Listed models are not checked for compatibility. Use Test connection to check this one.'}
        {!isCurated && ' Model-name grouping is guidance only. Custom models remain available for self-hosted providers.'}
      </p>
      <p className={styles.hint}>Test connection sends a text-generation request using {unsaved
        ? `${selected?.label ?? 'the selected provider'} / ${model.trim() || 'the selected model'}`
        : `${connection?.provider_label ?? connection?.server_default?.provider_label ?? 'the saved provider'} / ${connection?.model ?? connection?.server_default?.model ?? 'saved model'}`}
        {/* A self-hosted model without a key bills nobody. */}
        {unsaved && selected && !selected.requires_api_key ? '.' : ' and may incur provider charges.'}</p>

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

      {providerHandle === 'anthropic' && (
        <label className={styles.field}>
          <span className={styles.fieldLabel}>Anthropic workspace ID (optional)</span>
          <Input
            value={workspaceId}
            onChange={(e) => setWorkspaceId(e.target.value)}
            aria-label="Anthropic workspace ID (optional)"
            placeholder="wrkspc_…"
            maxLength={100}
            spellCheck={false}
          />
          <span className={styles.hint}>Required only for API keys with access to multiple workspaces. Find the workspace ID in the Claude Console workspace settings.</span>
        </label>
      )}

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
      {selectionTested && testMessage && <div className={styles.success} role="status">{testMessage}</div>}

      <div className={styles.actions}>
        <Button type="submit" disabled={isSaving || !complete}>
          {isSaving ? 'Saving…' : 'Save connection'}
        </Button>
        <Button
          type="button"
          variant="secondary"
          onClick={handleTest}
          disabled={isTesting || (unsaved ? !complete : !(connection?.configured || connection?.server_default))}
        >
          {isTesting ? 'Testing…' : 'Test connection'}
        </Button>
        {connection?.provider && !confirmDisconnect && (
          <Button type="button" variant="secondary" onClick={() => setConfirmDisconnect(true)} disabled={isSaving}>
            Disconnect…
          </Button>
        )}
      </div>
      {connection?.provider && confirmDisconnect && (
        <div className={styles.actions}>
          <p className={styles.hint}>
            This erases your saved API key.{' '}
            {connection.server_default
              ? `AI features will use this server’s shared connection (${connection.server_default.provider_label}, ${connection.server_default.model}).`
              : 'AI features stop working until you connect again.'}
          </p>
          <Button type="button" variant="danger" onClick={() => { setConfirmDisconnect(false); void handleDisconnect(); }} disabled={isSaving}>
            Erase key and disconnect
          </Button>
          <Button type="button" variant="secondary" onClick={() => setConfirmDisconnect(false)} disabled={isSaving}>
            Cancel
          </Button>
        </div>
      )}
    </form>
  );
}
