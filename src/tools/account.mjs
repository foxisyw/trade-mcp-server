/**
 * Account Tools — balance and positions
 */

import { z } from 'zod';
import { getClient, getMode, hasCredentials } from '../client-factory.mjs';

export function registerAccountTools(server) {

  // ─── okx_get_balance ─────────────────────────────────
  server.tool(
    'okx_get_balance',
    'Get account balance — all currencies with USD equivalent. Requires OKX API key configured.',
    {},
    async () => {
      if (!hasCredentials()) {
        return { content: [{ type: 'text', text: '❌ OKX API key not configured. Set OKX_DEMO_API_KEY, OKX_DEMO_SECRET_KEY, OKX_DEMO_PASSPHRASE environment variables.' }] };
      }
      const c = getClient();
      const balances = await c.fetchBalance();
      const totalUsd = balances.reduce((s, b) => s + parseFloat(b.eqUsd || 0), 0);
      return {
        content: [{
          type: 'text',
          text: JSON.stringify({
            mode: getMode(),
            totalEquityUSD: '$' + totalUsd.toFixed(2),
            currencies: balances.map(b => ({
              currency: b.ccy,
              equity: b.eq,
              equityUSD: '$' + parseFloat(b.eqUsd || 0).toFixed(2),
              available: b.availBal,
            })),
          }, null, 2),
        }],
      };
    }
  );

  // ─── okx_get_positions ───────────────────────────────
  server.tool(
    'okx_get_positions',
    'Get all open positions with P&L, leverage, margin ratio. Requires OKX API key.',
    {
      instType: z.enum(['SWAP', 'SPOT']).default('SWAP').describe('Position type'),
    },
    async ({ instType }) => {
      if (!hasCredentials()) {
        return { content: [{ type: 'text', text: '❌ OKX API key not configured. Set OKX_DEMO_API_KEY, OKX_DEMO_SECRET_KEY, OKX_DEMO_PASSPHRASE environment variables.' }] };
      }
      const c = getClient();
      const positions = await c.fetchPositions(instType);
      const active = positions.filter(p => Math.abs(parseFloat(p.pos || 0)) > 0);
      if (!active.length) {
        return { content: [{ type: 'text', text: `No open ${instType} positions. (mode: ${getMode()})` }] };
      }
      return {
        content: [{
          type: 'text',
          text: JSON.stringify({
            mode: getMode(),
            count: active.length,
            positions: active.map(p => ({
              instrument: p.instId,
              direction: parseFloat(p.pos) > 0 ? 'LONG' : 'SHORT',
              size: p.pos,
              avgPrice: p.avgPx,
              markPrice: p.markPx,
              unrealizedPnl: '$' + parseFloat(p.upl || 0).toFixed(2),
              leverage: p.lever + 'x',
              marginRatio: p.mgnRatio,
              notionalUsd: '$' + parseFloat(p.notionalUsd || 0).toFixed(2),
            })),
          }, null, 2),
        }],
      };
    }
  );
}
