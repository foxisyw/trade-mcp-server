---
name: OKX AI Trading Co-Pilot
description: AI-powered cryptocurrency trading assistant with 4-agent analysis, real-time OKX exchange integration, and autonomous trading capabilities.
version: 1.0.0
author: OKX Trade Dashboard
tags:
  - crypto
  - trading
  - okx
  - ai-analysis
  - market-data
icon: 🤖
---

# OKX AI Trading Co-Pilot

An intelligent cryptocurrency trading assistant that provides:

- **Real-time Market Data**: Price, volume, candles, derivatives data from OKX Exchange
- **4-Agent AI Analysis**: Macro analyst, Technical analyst, Risk manager, Portfolio manager working together
- **Automated Trading**: Place orders, set stop-loss/take-profit, manage positions
- **Smart Rules Engine**: Hard rules (auto-enforce) + Soft rules (AI-guided)
- **6 Analysis Skills**: Fibonacci, Candlestick patterns, Volume profile, Order flow, Volatility regime, Fear & Greed Index

## Quick Start

```
"What's the BTC price?"
"Run a full analysis on ETH"
"Open a 10x long BTC position with SL at 70000"
"Add a rule: block all trades when funding rate > 0.1%"
```

## Tools (19)

### Market Data (no API key needed)
- `okx_get_ticker` — Real-time price + 24h stats
- `okx_get_candles` — OHLCV candle data
- `okx_technical_analysis` — Full technical indicators report
- `okx_get_market_data` — OI, L/S ratio, funding rate

### Account (requires OKX API key)
- `okx_get_balance` — Account balances
- `okx_get_positions` — Open positions + PnL

### AI Analysis (requires LLM key)
- `okx_run_copilot` — Full 4-agent analysis
- `okx_run_single_agent` — Run one specific agent
- `okx_generate_trading_plan` — Generate trading plan from analysis

### Trading (requires OKX API key)
- `okx_place_order` — Market order with leverage + SL/TP
- `okx_close_position` — Close existing position

### Rules
- `okx_list_rules` — View all trading rules
- `okx_evaluate_rules` — Check if trade passes rules
- `okx_add_rule` — Add rule via natural language

### Configuration
- `okx_list_skills` — View analysis skills
- `okx_configure_skills` — Enable/disable skills per agent
- `okx_get_prompts` — View agent prompts
- `okx_update_prompt` — Customize agent prompts
- `okx_set_llm_config` — Configure LLM settings

## Configuration

Set these environment variables:

```bash
# Required for trading
OKX_DEMO_API_KEY=your_key
OKX_DEMO_SECRET_KEY=your_secret
OKX_DEMO_PASSPHRASE=your_passphrase

# Required for AI analysis
MINIMAX_API_KEY=your_minimax_key

# Optional
OKX_MODE=demo          # demo (default) or live
OKX_TRADE_CONFIRM=true # require confirmation before trades
```
