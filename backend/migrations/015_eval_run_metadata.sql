-- Migration 015: Add eval run metadata and reproducibility fields
--
-- Apply with:
--   sqlite3 /app/data/prompts.db < migrations/015_eval_run_metadata.sql
--
-- Adds reproducibility and cost/latency metadata columns to eval_runs,
-- and snapshots per-case criteria/variables and judge_model details
-- to eval_run_results.

ALTER TABLE eval_runs ADD COLUMN model VARCHAR(100) NOT NULL DEFAULT '';
ALTER TABLE eval_runs ADD COLUMN total_latency_ms INTEGER NOT NULL DEFAULT 0;
ALTER TABLE eval_runs ADD COLUMN total_prompt_tokens INTEGER NOT NULL DEFAULT 0;
ALTER TABLE eval_runs ADD COLUMN total_completion_tokens INTEGER NOT NULL DEFAULT 0;
ALTER TABLE eval_runs ADD COLUMN total_cost_usd REAL NOT NULL DEFAULT 0;

ALTER TABLE eval_run_results ADD COLUMN criteria TEXT;
ALTER TABLE eval_run_results ADD COLUMN variables JSON;
ALTER TABLE eval_run_results ADD COLUMN judge_model VARCHAR(100);
