/**
 * Shared OKX Client Factory
 * Creates OkxClient from environment variables — ZERO hardcoded credentials
 */

import { createRequire } from 'node:module';
const require = createRequire(import.meta.url);
const { OkxClient, getCredentials, createTempClient } = require('../lib/okx-client.js');

let _client = null;
let _mode = (process.env.OKX_MODE || 'demo').trim();

/**
 * Get OKX API client (lazy singleton)
 * Reads credentials from environment variables only
 */
export function getClient() {
  if (_client) return _client;
  const creds = getCredentials(_mode);
  if (!creds || !creds.apiKey) {
    throw new Error(
      _mode === 'live'
        ? 'OKX Live API 凭证未配置。请设置 OKX_LIVE_API_KEY, OKX_LIVE_SECRET_KEY, OKX_LIVE_PASSPHRASE 环境变量。'
        : 'OKX Demo API 凭证未配置。请设置 OKX_DEMO_API_KEY, OKX_DEMO_SECRET_KEY, OKX_DEMO_PASSPHRASE 环境变量。'
    );
  }
  _client = new OkxClient(creds);
  return _client;
}

/**
 * Get OKX client for public endpoints (no auth needed)
 * Falls back to a minimal client if no credentials are configured
 */
export function getPublicClient() {
  try {
    return getClient();
  } catch {
    // Create a minimal client for public endpoints (ticker, candles, etc.)
    return new OkxClient({ apiKey: '', secretKey: '', passphrase: '', demo: _mode === 'demo' });
  }
}

/** Get current mode */
export function getMode() { return _mode; }

/** Check if credentials are configured */
export function hasCredentials() {
  try {
    const creds = getCredentials(_mode);
    return !!(creds && creds.apiKey);
  } catch { return false; }
}

/** Check if LLM key is configured */
export function hasLLMKey() {
  return !!(process.env.MINIMAX_API_KEY || '').trim();
}
