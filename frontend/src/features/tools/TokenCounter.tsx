'use client';

import { useEffect, useState } from 'react';
import Button from '@/components/ui/Button';
import { ApiClient, type PublicModelPrice } from '@/lib/api';
import { openInApp } from '@/lib/openInApp';
import styles from '@/components/public/Tools.module.css';

// ponytail: ~4 characters per token is a common English average; exact counts need each provider's tokenizer.
const CHARS_PER_TOKEN = 4;
const RUNS = 1000;

export function estimateTokens(text: string): number {
  return text ? Math.ceil(text.length / CHARS_PER_TOKEN) : 0;
}

function usd(value: number): string {
  if (value === 0) return '$0';
  return value < 0.01 ? `$${value.toFixed(4)}` : `$${value.toFixed(2)}`;
}

function day(iso: string): string {
  return new Date(iso).toLocaleDateString('en-GB', { day: 'numeric', month: 'long', year: 'numeric', timeZone: 'UTC' });
}

/** "as of 17 October 2026", or a range when prices come from different sources. */
export function pricesAsOf(rows: PublicModelPrice[]): string {
  const dates = [...new Set(rows.map((row) => row.prices_as_of).filter((value): value is string => !!value))].sort();
  if (dates.length === 0) return '(estimated)';
  return dates.length === 1 ? `as of ${day(dates[0])}` : `checked between ${day(dates[0])} and ${day(dates[dates.length - 1])}`;
}

export default function TokenCounter() {
  const [text, setText] = useState('');
  const [prices, setPrices] = useState<PublicModelPrice[] | null>(null);
  const [priceError, setPriceError] = useState('');
  useEffect(() => {
    let active = true;
    ApiClient.getPublicModelPrices()
      .then((rows) => { if (active) setPrices(rows); })
      .catch(() => { if (active) setPriceError('Model prices could not be loaded. The counts above still work.'); });
    return () => { active = false; };
  }, []);
  const tokens = estimateTokens(text);
  const words = text.trim() ? text.trim().split(/\s+/).length : 0;
  return (
    <>
      <label className={styles.field}>
        Your prompt
        <textarea className={styles.textarea} value={text} onChange={(event) => setText(event.target.value)}
          placeholder="Paste a prompt to count it." maxLength={500_000} />
      </label>
      <dl className={styles.stats} aria-live="polite">
        <div><dt>Characters</dt><dd>{text.length.toLocaleString('en')}</dd></div>
        <div><dt>Words</dt><dd>{words.toLocaleString('en')}</dd></div>
        <div><dt>Estimated tokens</dt><dd>≈ {tokens.toLocaleString('en')}</dd></div>
      </dl>
      {text.trim() && (
        <div className={styles.actions}>
          <Button onClick={() => openInApp({ fields: [{ name: 'Task', content: text }] })}>Save to my library</Button>
        </div>
      )}
      {priceError ? <p className={styles.status}>{priceError}</p> : prices && (
        // Focusable: it scrolls sideways on narrow screens.
        <div className={styles.tableWrap} role="region" aria-label="Cost by model" tabIndex={0}>
          <table className={styles.table}>
            <caption className={styles.status}>Estimated input cost of this prompt, at list prices {pricesAsOf(prices)}</caption>
            <thead>
              <tr><th scope="col">Model</th><th scope="col">Input per 1M tokens</th><th scope="col">This prompt</th><th scope="col">{RUNS.toLocaleString('en')} runs</th></tr>
            </thead>
            <tbody>
              {prices.map((row) => {
                const rate = row.input_price_per_1m;
                const once = rate === null ? null : (tokens / 1_000_000) * rate;
                return (
                  <tr key={`${row.provider}:${row.id}`}>
                    <td>{row.provider_label} · {row.label ?? row.id}</td>
                    <td>{rate === null ? '—' : usd(rate)}</td>
                    <td>{once === null ? '—' : usd(once)}</td>
                    <td>{once === null ? '—' : usd(once * RUNS)}</td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      )}
    </>
  );
}
