/**
 * Trading Tools — place order and close position with optional confirmation
 */

import { z } from 'zod';
import { getClient, getMode, hasCredentials } from '../client-factory.mjs';

const REQUIRE_CONFIRM = (process.env.OKX_TRADE_CONFIRM || 'false').trim() === 'true';

export function registerTradingTools(server) {

  // ─── okx_place_order ─────────────────────────────────
  server.tool(
    'okx_place_order',
    'Place a market order on OKX. SWAP: sets leverage + optional SL/TP. SPOT: simple buy/sell. Use confirm=true to preview before executing.',
    {
      instrument: z.string().describe('Trading pair, e.g. BTC-USDT'),
      side: z.enum(['buy', 'sell']).describe('buy = long/buy, sell = short/sell'),
      size: z.string().describe('Order size (contracts for SWAP, quantity for SPOT)'),
      instType: z.enum(['SWAP', 'SPOT']).default('SWAP'),
      leverage: z.number().min(1).max(125).optional().describe('Leverage for SWAP (1-125x)'),
      stopLoss: z.number().optional().describe('Stop loss trigger price'),
      takeProfit: z.number().optional().describe('Take profit trigger price'),
      confirm: z.boolean().default(true).describe('true = preview only, false = execute immediately'),
    },
    async ({ instrument, side, size, instType, leverage, stopLoss, takeProfit, confirm }) => {
      if (!hasCredentials()) {
        return { content: [{ type: 'text', text: '❌ OKX API key not configured. Cannot place orders.' }] };
      }

      const c = getClient();
      const isSpot = instType === 'SPOT';
      const inst = isSpot ? instrument : instrument + '-SWAP';

      // Get current price for preview
      const ticker = isSpot ? await c.fetchSpotTicker(instrument) : await c.fetchTicker(instrument);
      const price = parseFloat(ticker.last);

      // Confirmation mode: return preview
      const shouldConfirm = confirm || REQUIRE_CONFIRM;
      if (shouldConfirm) {
        const notional = isSpot ? parseFloat(size) * price : parseFloat(size) * price * 0.01;
        const margin = isSpot ? notional : notional / (leverage || 10);
        return {
          content: [{
            type: 'text',
            text: JSON.stringify({
              status: 'pending_confirmation',
              preview: {
                instrument: inst,
                side,
                size,
                instType,
                currentPrice: '$' + price.toLocaleString(),
                leverage: isSpot ? 'N/A' : (leverage || 10) + 'x',
                estimatedNotional: '$' + notional.toFixed(2),
                estimatedMargin: isSpot ? 'N/A' : '$' + margin.toFixed(2),
                stopLoss: stopLoss ? '$' + stopLoss : 'None',
                takeProfit: takeProfit ? '$' + takeProfit : 'None',
                mode: getMode(),
              },
              message: '请确认是否执行此交易。再次调用 okx_place_order 并设 confirm=false 来执行。',
            }, null, 2),
          }],
        };
      }

      // Execute order
      try {
        if (isSpot) {
          const result = await c.placeSpotOrder({ inst: instrument, side, sz: size });
          return { content: [{ type: 'text', text: JSON.stringify({ status: 'filled', mode: getMode(), ...result }, null, 2) }] };
        }

        // SWAP: set leverage first
        if (leverage) {
          try { await c.setLeverage({ inst, lever: leverage, mgnMode: 'cross' }); } catch (e) { /* non-fatal */ }
        }

        const result = await c.placeOrder({
          inst, side, sz: size, ordType: 'market', tdMode: 'cross',
        });

        // Set SL/TP if provided
        if (stopLoss || takeProfit) {
          const oppSide = side === 'buy' ? 'sell' : 'buy';
          try {
            await c.placeAlgoOrder({
              inst, side: oppSide, sz: size,
              tpTriggerPx: takeProfit ? String(takeProfit) : undefined,
              slTriggerPx: stopLoss ? String(stopLoss) : undefined,
              tdMode: 'cross',
            });
          } catch (e) { /* non-fatal, main order already placed */ }
        }

        return {
          content: [{
            type: 'text',
            text: JSON.stringify({
              status: 'filled',
              mode: getMode(),
              instrument: inst, side, size,
              leverage: leverage || 'default',
              price: '$' + price.toLocaleString(),
              stopLoss: stopLoss || 'None',
              takeProfit: takeProfit || 'None',
              ...result,
            }, null, 2),
          }],
        };
      } catch (e) {
        return { content: [{ type: 'text', text: `❌ Order failed: ${e.message}` }] };
      }
    }
  );

  // ─── okx_close_position ──────────────────────────────
  server.tool(
    'okx_close_position',
    'Close an open position by placing a reduce-only market order in the opposite direction',
    {
      instrument: z.string().describe('Full instrument ID, e.g. BTC-USDT-SWAP'),
      confirm: z.boolean().default(true).describe('true = preview, false = execute'),
    },
    async ({ instrument, confirm }) => {
      if (!hasCredentials()) {
        return { content: [{ type: 'text', text: '❌ OKX API key not configured.' }] };
      }

      const c = getClient();
      const positions = await c.fetchPositions('SWAP');
      const pos = positions.find(p => p.instId === instrument && Math.abs(parseFloat(p.pos || 0)) > 0);

      if (!pos) {
        return { content: [{ type: 'text', text: `No open position found for ${instrument}` }] };
      }

      const posSize = Math.abs(parseFloat(pos.pos));
      const closeSide = parseFloat(pos.pos) > 0 ? 'sell' : 'buy';
      const pnl = parseFloat(pos.upl || 0);

      const shouldConfirm = confirm || REQUIRE_CONFIRM;
      if (shouldConfirm) {
        return {
          content: [{
            type: 'text',
            text: JSON.stringify({
              status: 'pending_confirmation',
              preview: {
                instrument,
                direction: parseFloat(pos.pos) > 0 ? 'LONG' : 'SHORT',
                size: String(posSize),
                avgPrice: pos.avgPx,
                markPrice: pos.markPx,
                unrealizedPnl: '$' + pnl.toFixed(2),
                closeSide,
                mode: getMode(),
              },
              message: '请确认平仓。再次调用 okx_close_position 并设 confirm=false 来执行。',
            }, null, 2),
          }],
        };
      }

      try {
        const result = await c.placeOrder({
          inst: instrument, side: closeSide, sz: String(posSize),
          ordType: 'market', tdMode: 'cross', reduceOnly: true,
        });
        return {
          content: [{
            type: 'text',
            text: JSON.stringify({ status: 'closed', mode: getMode(), instrument, closeSide, size: posSize, estimatedPnl: '$' + pnl.toFixed(2), ...result }, null, 2),
          }],
        };
      } catch (e) {
        return { content: [{ type: 'text', text: `❌ Close failed: ${e.message}` }] };
      }
    }
  );
}
