/**
 * Market Data Tools — 4 tools for price, candles, technical analysis, derivatives data
 */

import { z } from 'zod';
import { createRequire } from 'node:module';
const require = createRequire(import.meta.url);
const { analyze } = require('../../lib/analyze.js');

import { getPublicClient } from '../client-factory.mjs';

export function registerMarketDataTools(server) {

  // ─── okx_get_ticker ──────────────────────────────────
  server.tool(
    'okx_get_ticker',
    'Get current price, 24h change, and volume for any OKX instrument (BTC-USDT, ETH-USDT, SOL-USDT, OKB-USDT)',
    {
      instrument: z.string().default('BTC-USDT').describe('Trading pair, e.g. BTC-USDT, ETH-USDT, SOL-USDT'),
      instType: z.enum(['SWAP', 'SPOT']).default('SWAP').describe('SWAP = perpetual futures, SPOT = spot'),
    },
    async ({ instrument, instType }) => {
      const c = getPublicClient();
      const data = instType === 'SPOT'
        ? await c.fetchSpotTicker(instrument)
        : await c.fetchTicker(instrument);
      const last = parseFloat(data.last);
      const open24h = parseFloat(data.open24h || data.sodUtc0 || 0);
      const change24h = open24h ? ((last - open24h) / open24h * 100).toFixed(2) : 'N/A';
      return {
        content: [{
          type: 'text',
          text: JSON.stringify({
            instrument, instType,
            price: last,
            open24h,
            change24h: change24h + '%',
            high24h: data.high24h,
            low24h: data.low24h,
            vol24h: data.vol24h,
            ts: data.ts,
          }, null, 2),
        }],
      };
    }
  );

  // ─── okx_get_candles ─────────────────────────────────
  server.tool(
    'okx_get_candles',
    'Fetch OHLCV candle data for chart analysis. Returns up to 300 candles.',
    {
      instrument: z.string().default('BTC-USDT'),
      bar: z.enum(['1m','5m','15m','30m','1H','4H','1D']).default('15m').describe('Candle timeframe'),
      limit: z.number().min(10).max(300).default(100).describe('Number of candles'),
      instType: z.enum(['SWAP','SPOT']).default('SWAP'),
    },
    async ({ instrument, bar, limit, instType }) => {
      const c = getPublicClient();
      const candles = instType === 'SPOT'
        ? await c.fetchSpotCandles(instrument, bar, limit)
        : await c.fetchCandles(instrument, bar, limit);
      return {
        content: [{
          type: 'text',
          text: JSON.stringify({
            instrument, bar, instType,
            count: candles.length,
            latest: candles.length ? candles[candles.length - 1] : null,
            candles: candles.slice(-20), // Return last 20 in text (full set is large)
            note: candles.length > 20 ? `Showing last 20 of ${candles.length} candles` : undefined,
          }, null, 2),
        }],
      };
    }
  );

  // ─── okx_technical_analysis ──────────────────────────
  server.tool(
    'okx_technical_analysis',
    'Run full technical analysis: RSI (14), MACD (12,26,9), Bollinger Bands (20,2), Moving Averages (20,50,200). Returns formatted report with bull/bear signal counts.',
    {
      instrument: z.string().default('BTC-USDT'),
      bar: z.enum(['1m','5m','15m','30m','1H','4H','1D']).default('15m').describe('Candle timeframe for analysis'),
      instType: z.enum(['SWAP','SPOT']).default('SWAP'),
    },
    async ({ instrument, bar, instType }) => {
      const c = getPublicClient();
      const candles = instType === 'SPOT'
        ? await c.fetchSpotCandles(instrument, bar, 200)
        : await c.fetchCandles(instrument, bar, 200);
      const result = analyze(candles, instrument, bar);
      if (!result) {
        return { content: [{ type: 'text', text: 'Insufficient candle data for analysis (need >= 30 candles)' }] };
      }
      return {
        content: [{
          type: 'text',
          text: `Technical Analysis: ${instrument} ${bar} (${instType})\n\n` +
            result.raw + '\n\n' +
            `Bull signals: ${result.bull} | Bear signals: ${result.bear}`,
        }],
      };
    }
  );

  // ─── okx_get_market_data ─────────────────────────────
  server.tool(
    'okx_get_market_data',
    'Get derivatives market data: Open Interest, Long/Short Ratio, and Funding Rate for perpetual contracts',
    {
      instrument: z.string().default('BTC-USDT').describe('Base instrument (e.g. BTC-USDT)'),
    },
    async ({ instrument }) => {
      const c = getPublicClient();
      const [oi, lsArr, funding] = await Promise.all([
        c.fetchOpenInterest(instrument).catch(() => null),
        c.fetchLongShortRatio(instrument, '5m').catch(() => []),
        c.fetchFundingRate(instrument).catch(() => null),
      ]);
      const latestLS = Array.isArray(lsArr) && lsArr.length ? lsArr[lsArr.length - 1] : null;
      return {
        content: [{
          type: 'text',
          text: JSON.stringify({
            instrument,
            openInterest: oi,
            longShortRatio: latestLS,
            fundingRate: funding,
          }, null, 2),
        }],
      };
    }
  );
}
