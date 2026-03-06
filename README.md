#AI Trading Co-Pilot — MCP Server

AI-powered cryptocurrency trading assistant for [OpenClaw](https://openclaw.com) and any MCP-compatible client (Claude Desktop, etc.).

**4-agent analysis system** (macro + technical + risk + portfolio manager) with real-time OKX exchange integration, smart rules engine, and autonomous trading capabilities.

## ⚡ Quick Start (3 minutes)

### 1. Install

```bash
npm install @okx-trade/mcp-server
```

Or clone and install locally:
```bash
cd mcp/
npm install
```

### 2. Configure API Keys

```bash
# OKX Exchange API Key (required for trading & account data)
export OKX_DEMO_API_KEY="your-api-key"
export OKX_DEMO_SECRET_KEY="your-secret-key"
export OKX_DEMO_PASSPHRASE="your-passphrase"

# LLM API Key (required for AI analysis)
export MINIMAX_API_KEY="your-minimax-key"

# Optional settings
export OKX_MODE="demo"            # "demo" (default) or "live"
export OKX_TRADE_CONFIRM="true"   # Require confirmation before trades
```

### 3. Start the MCP Server

```bash
node bin/okx-trade-mcp.mjs
```

Or add to your MCP client config:

**Claude Desktop** (`claude_desktop_config.json`):
```json
{
  "mcpServers": {
    "okx-trade": {
      "command": "node",
      "args": ["/path/to/mcp/bin/okx-trade-mcp.mjs"],
      "env": {
        "OKX_DEMO_API_KEY": "your-key",
        "OKX_DEMO_SECRET_KEY": "your-secret",
        "OKX_DEMO_PASSPHRASE": "your-pass",
        "MINIMAX_API_KEY": "your-minimax-key",
        "OKX_MODE": "demo"
      }
    }
  }
}
```

**OpenClaw**: Install via ClawHub or add manually in Settings → MCP Servers.

### 4. Start Chatting

```
"What's the BTC price?"
"Run a full analysis on BTC"
"Show me ETH technical analysis with 4H candles"
"Open a 10x long BTC position"
```

---

## 🔑 Configuration

### OKX API Key (Required for Trading)

1. Log in to [OKX](https://www.okx.com)
2. Go to **API Management** → Create API Key
3. Permissions needed: **Read + Trade** (do NOT enable Withdraw)
4. **Important**: Do NOT set IP whitelist (MCP runs locally with dynamic IPs)

**Demo mode** (default): Uses OKX demo trading environment — no real money involved.

| Env Variable | Description |
|---|---|
| `OKX_DEMO_API_KEY` | Demo API Key |
| `OKX_DEMO_SECRET_KEY` | Demo Secret Key |
| `OKX_DEMO_PASSPHRASE` | Demo Passphrase |
| `OKX_LIVE_API_KEY` | Live API Key (when OKX_MODE=live) |
| `OKX_LIVE_SECRET_KEY` | Live Secret Key |
| `OKX_LIVE_PASSPHRASE` | Live Passphrase |

### LLM API Key (Required for AI Analysis)

The AI co-pilot uses MiniMax M2.5 for multi-agent analysis.

1. Sign up at [MiniMax Platform](https://www.minimaxi.com)
2. Create an API Key
3. Set `MINIMAX_API_KEY` environment variable

> **Without LLM key**: Market Data, Account, Trading, and Rules tools still work. Only AI Copilot tools require the LLM key.

### Optional Settings

| Env Variable | Default | Description |
|---|---|---|
| `OKX_MODE` | `demo` | `demo` or `live` — must explicitly set `live` for real trading |
| `OKX_TRADE_CONFIRM` | `false` | `true` = always preview before executing trades |
| `DATA_DIR` | `~/.okx-trade-mcp` | Custom data directory for rules, prompts, config |

---

## 🛠 Available Tools (19)

### Market Data (4 tools) — No API key needed

| Tool | Description | Example |
|------|-------------|---------|
| `okx_get_ticker` | Real-time price, 24h change, volume | "What's the BTC price?" |
| `okx_get_candles` | OHLCV candle data (1m~1D, up to 300) | "Show me ETH 4H candles" |
| `okx_technical_analysis` | RSI, MACD, Bollinger Bands, Moving Averages | "Technical analysis for SOL" |
| `okx_get_market_data` | Open Interest, Long/Short Ratio, Funding Rate | "What's the BTC funding rate?" |

### Account (2 tools) — Requires OKX API key

| Tool | Description | Example |
|------|-------------|---------|
| `okx_get_balance` | All currencies with USD equivalent | "What's my balance?" |
| `okx_get_positions` | Open positions + PnL + leverage + margin | "Show my positions" |

### AI Analysis (3 tools) — Requires LLM key

| Tool | Description | Example |
|------|-------------|---------|
| `okx_run_copilot` | Full 4-agent analysis → signal + conviction | "Analyze BTC for me" |
| `okx_run_single_agent` | Run one agent (macro/technical/risk) | "What does the macro agent think about ETH?" |
| `okx_generate_trading_plan` | Detailed plan: entry, SL, TP, risk/reward | "Generate a trading plan" |

### Trading (2 tools) — Requires OKX API key

| Tool | Description | Example |
|------|-------------|---------|
| `okx_place_order` | Market order with leverage + SL/TP | "Open 10x long BTC, SL at 70000" |
| `okx_close_position` | Close an existing position | "Close my ETH position" |

### Rules (3 tools)

| Tool | Description | Example |
|------|-------------|---------|
| `okx_list_rules` | View all hard + soft trading rules | "List my rules" |
| `okx_evaluate_rules` | Check if a trade passes hard rules | "Can I go long BTC now?" |
| `okx_add_rule` | Add rule via natural language | "Block trades when funding > 0.1%" |

### Skills & Config (5 tools)

| Tool | Description | Example |
|------|-------------|---------|
| `okx_list_skills` | View 6 analysis skills and status | "What skills are available?" |
| `okx_configure_skills` | Enable/disable skills per agent | "Enable fibonacci for technical agent" |
| `okx_get_prompts` | View agent system prompts | "Show me the current prompts" |
| `okx_update_prompt` | Customize an agent's prompt | "Make technical agent focus on volume" |
| `okx_set_llm_config` | Configure temperature, max tokens | "Set temperature to 0.3" |

---

## 💬 Usage Examples

### Market Analysis
```
"What's the current BTC price and 24h change?"
"Show me ETH technical analysis with 4H candles"
"What's the current funding rate for BTC?"
"Get the open interest and long/short ratio for SOL"
```

### AI Co-Pilot
```
"Run a full analysis on BTC"
"What does the macro agent think about ETH?"
"Run technical analysis only for SOL"
"Generate a trading plan based on the analysis"
```

### Trading
```
"Open a 10x long BTC position with 10 contracts"
"Place a short ETH order with SL at 4000 and TP at 3500"
"Close my BTC-USDT-SWAP position"
"Show my current positions and P&L"
```

### Rules Management
```
"Add a rule: block all trades when funding rate > 0.1%"
"Add a rule: don't go long when L/S ratio > 2"
"List my trading rules"
"Check if a BTC long trade would pass my rules"
```

### Customization
```
"Show me the current agent prompts"
"Update the technical agent prompt to focus more on volume analysis"
"Enable fibonacci and candlestick-patterns skills for technical agent"
"Disable the fear-greed-index skill"
"Set LLM temperature to 0.3"
```

---

## 🤖 AI Agents

The co-pilot runs 4 AI agents:

| Agent | Role | Focus |
|-------|------|-------|
| 🌐 **Macro Analyst** | Macro environment | Fed policy, DXY, ETF flows, on-chain data |
| 📊 **Technical Analyst** | Chart analysis | RSI, MACD, Bollinger Bands, trend, key levels |
| 🛡️ **Risk Manager** | Risk assessment | Position sizing, leverage, stop-loss, max risk |
| 👔 **Portfolio Manager** | Final decision | Synthesizes all reports → LONG/SHORT/HOLD + conviction |

**Workflow**: Macro + Technical + Risk run in parallel → Portfolio Manager synthesizes → Final signal

---

## ⚙️ Analysis Skills (6)

| Skill | Description | Agents |
|-------|-------------|--------|
| `fibonacci-levels` | Fibonacci retracement from swing H/L | Technical, Manager |
| `candlestick-patterns` | Doji, Engulfing, Hammer detection | Technical, Manager |
| `volume-profile` | Volume distribution + POC | Technical, Risk |
| `orderflow-analysis` | OI changes, L/S ratio trends | Technical, Risk, Manager |
| `volatility-regime` | Classify Low/Normal/High/Extreme | Risk, Manager |
| `fear-greed-index` | Crypto market sentiment (0-100) | Macro, Manager |

All skills are enabled by default. Use `okx_configure_skills` to customize.

---

## 🎨 Canvas Dashboard

For OpenClaw users, two HTML templates are included for visual rendering:

- **`dashboard.html`** — Main trading dashboard (price, positions, signal, chart)
- **`analysis-report.html`** — Full analysis report (agent cards, trading plan, reasoning)

Ask the agent: *"Show me the dashboard"* or *"Render the analysis report"*

---

## 📋 Supported Instruments

| Instrument | SWAP | SPOT |
|------------|------|------|
| BTC-USDT | ✅ | ✅ |
| ETH-USDT | ✅ | ✅ |
| SOL-USDT | ✅ | ✅ |
| OKB-USDT | ✅ | ✅ |

---

## 🔒 Security

- ✅ **All API keys stay local** — stored in environment variables, never transmitted
- ✅ **Zero hardcoded credentials** — npm package contains no secrets
- ✅ **Tool responses never include API keys** — all sensitive data stripped
- ✅ **Default demo mode** — must explicitly opt-in to live trading
- ✅ **Trade confirmation** — optional preview before execution
- ✅ **No third-party data sharing** — only connects to OKX API and LLM provider
- ✅ **Hard rules auto-enforcement** — programmatic blocks cannot be bypassed

---

## 🔧 Testing

### MCP Inspector
```bash
npx @modelcontextprotocol/inspector node bin/okx-trade-mcp.mjs
```

### Claude Desktop
Add to `claude_desktop_config.json` and restart Claude Desktop.

### OpenClaw
Install the plugin from ClawHub or add as custom MCP server.

---

## 📄 License

MIT

---

## 🌐 Links

- [OKX API Documentation](https://www.okx.com/docs-v5/)
- [MCP Protocol Specification](https://modelcontextprotocol.io)
- [OpenClaw Platform](https://openclaw.com)
- [MiniMax API](https://www.minimaxi.com)
