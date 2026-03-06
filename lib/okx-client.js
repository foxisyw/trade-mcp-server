/**
 * OKX REST API Client
 * 直接调用 OKX REST API，替代 okx CLI 依赖
 *
 * 凭证优先级：
 *   1. 环境变量 OKX_DEMO_* / OKX_LIVE_*
 *   2. ~/.okx/config.toml
 */

const crypto = require('crypto');
const https  = require('https');
const fs     = require('fs');
const path   = require('path');
const os     = require('os');

// ─── TOML 凭证读取（最小实现，仅解析 profiles.live / profiles.demo 段）─────
function _parseTomlProfile(text, profileKey) {
  // 提取段落 [profiles.live] 或 [profiles.demo]
  const escaped = profileKey.replace('.', '\\.');
  const re = new RegExp(`\\[${escaped}\\]([\\s\\S]*?)(?=\\[|$)`);
  const m  = text.match(re);
  if (!m) return null;

  const result = {};
  for (const line of m[1].split('\n')) {
    const kv = line.match(/^\s*(\w+)\s*=\s*"([^"]+)"/);
    if (kv) result[kv[1]] = kv[2];
    // 处理 demo = true（无引号）
    const bool = line.match(/^\s*(\w+)\s*=\s*(true|false)/);
    if (bool) result[bool[1]] = bool[2] === 'true';
  }
  return Object.keys(result).length ? result : null;
}

function _loadConfigToml() {
  try {
    const file = path.join(os.homedir(), '.okx', 'config.toml');
    if (fs.existsSync(file)) return fs.readFileSync(file, 'utf8');
  } catch (_) {}
  return null;
}

/**
 * 根据 mode ('demo'|'live') 解析凭证
 * @returns {{ apiKey, secretKey, passphrase, demo: boolean } | null}
 */
function getCredentials(mode) {
  const isDemo = mode !== 'live';

  // ── 优先读环境变量 ──────────────────────────────────────
  if (isDemo) {
    const k = process.env.OKX_DEMO_API_KEY;
    const s = process.env.OKX_DEMO_SECRET_KEY;
    const p = process.env.OKX_DEMO_PASSPHRASE;
    if (k && s && p) return { apiKey: k, secretKey: s, passphrase: p, demo: true };
  } else {
    const k = process.env.OKX_LIVE_API_KEY;
    const s = process.env.OKX_LIVE_SECRET_KEY;
    const p = process.env.OKX_LIVE_PASSPHRASE;
    if (k && s && p) return { apiKey: k, secretKey: s, passphrase: p, demo: false };
  }

  // ── 通用环境变量回退（不带 DEMO_/LIVE_ 前缀）──────────
  {
    const k = process.env.OKX_API_KEY;
    const s = process.env.OKX_SECRET_KEY;
    const p = process.env.OKX_PASSPHRASE;
    if (k && s && p) return { apiKey: k, secretKey: s, passphrase: p, demo: isDemo };
  }

  // ── 回退到 config.toml ────────────────────────────────
  const toml = _loadConfigToml();
  if (!toml) return null;

  const profile  = isDemo ? 'profiles.demo' : 'profiles.live';
  const fallback = isDemo ? 'profiles.live' : 'profiles.demo';
  const data     = _parseTomlProfile(toml, profile) || _parseTomlProfile(toml, fallback);
  if (!data) return null;

  return {
    apiKey:    data.api_key    || '',
    secretKey: data.secret_key || '',
    passphrase: data.passphrase || '',
    demo:      !!data.demo,
  };
}

// ─── 工具函数 ─────────────────────────────────────────────
/** 将 BTC-USDT 自动补全为 BTC-USDT-SWAP */
function toSwapId(inst) {
  if (!inst) return 'BTC-USDT-SWAP';
  if (inst.endsWith('-SWAP') || inst.endsWith('-FUTURES') || inst.endsWith('-OPTION')) return inst;
  return inst + '-SWAP';
}

// ─── OKX 客户端类 ─────────────────────────────────────────
class OkxClient {
  /**
   * @param {{ apiKey: string, secretKey: string, passphrase: string, demo?: boolean }} creds
   */
  constructor({ apiKey, secretKey, passphrase, demo = false }) {
    this.apiKey     = (apiKey || '').trim();
    this.secretKey  = (secretKey || '').trim();
    this.passphrase = (passphrase || '').trim();
    this.demo       = demo;
  }

  // ── HMAC-SHA256 签名 ─────────────────────────────────
  _sign(timestamp, method, path, body = '') {
    const msg = timestamp + method.toUpperCase() + path + body;
    return crypto.createHmac('sha256', this.secretKey).update(msg).digest('base64');
  }

  _buildHeaders(method, path, body = '') {
    const ts   = new Date().toISOString();
    const sign = this._sign(ts, method, path, body);
    const h = {
      'OK-ACCESS-KEY':       this.apiKey,
      'OK-ACCESS-SIGN':      sign,
      'OK-ACCESS-TIMESTAMP': ts,
      'OK-ACCESS-PASSPHRASE': this.passphrase,
      'Content-Type':        'application/json',
    };
    if (this.demo) h['x-simulated-trading'] = '1';
    return h;
  }

  // ── 底层 HTTP 请求 ────────────────────────────────────
  _request(method, apiPath, params = {}, body = null) {
    let fullPath = apiPath;
    if (method === 'GET' && params && Object.keys(params).length) {
      fullPath += '?' + new URLSearchParams(
        Object.fromEntries(Object.entries(params).map(([k, v]) => [k, String(v)]))
      ).toString();
    }
    const bodyStr  = body ? JSON.stringify(body) : '';
    const headers  = this._buildHeaders(method, fullPath, bodyStr);

    return new Promise((resolve, reject) => {
      const options = {
        hostname: 'www.okx.com',
        path:     fullPath,
        method,
        headers,
        timeout:  15000,
      };
      const req = https.request(options, (res) => {
        let data = '';
        res.on('data', chunk => data += chunk);
        res.on('end', () => {
          try {
            const json = JSON.parse(data);
            if (json.code !== '0') {
              const d = json.data?.[0];
              const detail = d?.sMsg ? ` → ${d.sCode}: ${d.sMsg}` : '';
              reject(new Error(`OKX ${json.code}: ${json.msg}${detail} (path=${fullPath})`));
            } else {
              resolve(json.data);
            }
          } catch {
            reject(new Error('JSON parse error: ' + data.slice(0, 200)));
          }
        });
      });
      req.on('error', reject);
      req.on('timeout', () => { req.destroy(); reject(new Error('request timeout')); });
      if (bodyStr) req.write(bodyStr);
      req.end();
    });
  }

  // ── 公开行情（不需要签名）─────────────────────────────
  _publicRequest(apiPath, params = {}) {
    let fullPath = apiPath;
    if (params && Object.keys(params).length) {
      fullPath += '?' + new URLSearchParams(
        Object.fromEntries(Object.entries(params).map(([k, v]) => [k, String(v)]))
      ).toString();
    }

    return new Promise((resolve, reject) => {
      const headers = { 'Content-Type': 'application/json' };
      if (this.demo) headers['x-simulated-trading'] = '1';
      const options = {
        hostname: 'www.okx.com',
        path:     fullPath,
        method:   'GET',
        headers,
        timeout:  15000,
      };
      const req = https.request(options, (res) => {
        let data = '';
        res.on('data', chunk => data += chunk);
        res.on('end', () => {
          try {
            const json = JSON.parse(data);
            if (json.code !== '0') {
              reject(new Error(`OKX ${json.code}: ${json.msg}`));
            } else {
              resolve(json.data);
            }
          } catch {
            reject(new Error('JSON parse error: ' + data.slice(0, 200)));
          }
        });
      });
      req.on('error', reject);
      req.on('timeout', () => { req.destroy(); reject(new Error('request timeout')); });
      req.end();
    });
  }

  // ── 市场行情（SWAP） ─────────────────────────────────
  async fetchTicker(inst = 'BTC-USDT') {
    const instId = toSwapId(inst);
    const data   = await this._publicRequest('/api/v5/market/ticker', { instId });
    return data?.[0] ?? null;
  }

  /**
   * 拉取 SWAP K 线（最新数据在前，oldest-first 返回）
   * @returns {Array<{ts, o, h, l, c, vol}>}
   */
  async fetchCandles(inst = 'BTC-USDT', bar = '15m', limit = 300) {
    const instId = toSwapId(inst);
    const clampedLimit = Math.min(limit, 300);
    const data = await this._publicRequest('/api/v5/market/candles', {
      instId,
      bar,
      limit: clampedLimit,
    });
    return (data ?? [])
      .filter(c => c[8] === '1')
      .map(c => ({
        ts:  parseInt(c[0]),
        o:   parseFloat(c[1]),
        h:   parseFloat(c[2]),
        l:   parseFloat(c[3]),
        c:   parseFloat(c[4]),
        vol: parseFloat(c[5]),
      }))
      .reverse();
  }

  // ── 市场行情（SPOT） ─────────────────────────────────
  async fetchSpotTicker(inst = 'BTC-USDT') {
    const data = await this._publicRequest('/api/v5/market/ticker', { instId: inst });
    return data?.[0] ?? null;
  }

  async fetchSpotCandles(inst = 'BTC-USDT', bar = '15m', limit = 300) {
    const clampedLimit = Math.min(limit, 300);
    const data = await this._publicRequest('/api/v5/market/candles', {
      instId: inst,
      bar,
      limit: clampedLimit,
    });
    return (data ?? [])
      .filter(c => c[8] === '1')
      .map(c => ({
        ts:  parseInt(c[0]),
        o:   parseFloat(c[1]),
        h:   parseFloat(c[2]),
        l:   parseFloat(c[3]),
        c:   parseFloat(c[4]),
        vol: parseFloat(c[5]),
      }))
      .reverse();
  }

  // ── 合约市场数据（公开，无需签名）─────────────────────

  /** 当前持仓量快照 */
  async fetchOpenInterest(inst = 'BTC-USDT') {
    const instId = toSwapId(inst);
    const data = await this._publicRequest('/api/v5/public/open-interest', {
      instType: 'SWAP', instId,
    });
    const d = data?.[0];
    return d ? {
      oi:    parseFloat(d.oi),
      oiCcy: parseFloat(d.oiCcy),
      ts:    parseInt(d.ts),
    } : { oi: 0, oiCcy: 0, ts: Date.now() };
  }

  /** 持仓量 + 交易量历史（用于图表） */
  async fetchOpenInterestHistory(inst = 'BTC-USDT', period = '5m') {
    const ccy = inst.split('-')[0];
    const data = await this._publicRequest('/api/v5/rubik/stat/contracts/open-interest-volume', {
      ccy, period,
    });
    return (data ?? []).map(d => ({
      ts:    parseInt(d[0]),
      oi:    parseFloat(d[1]),
      oiVol: parseFloat(d[2]),
    })).reverse();
  }

  /** 多空持仓人数比 */
  async fetchLongShortRatio(inst = 'BTC-USDT', period = '5m') {
    const ccy = inst.split('-')[0];
    const data = await this._publicRequest('/api/v5/rubik/stat/contracts/long-short-account-ratio', {
      ccy, period,
    });
    return (data ?? []).map(d => ({
      ts:         parseInt(d[0]),
      longRatio:  parseFloat(d[1]),
      shortRatio: parseFloat(d[2]),
      lsRatio:    parseFloat(d[1]) / (parseFloat(d[2]) || 1),
    })).reverse();
  }

  /** 当前资金费率 */
  async fetchFundingRate(inst = 'BTC-USDT') {
    const instId = toSwapId(inst);
    const data = await this._publicRequest('/api/v5/public/funding-rate', { instId });
    const d = data?.[0];
    return d ? {
      fundingRate:     parseFloat(d.fundingRate),
      nextFundingRate: parseFloat(d.nextFundingRate || '0'),
      fundingTime:     parseInt(d.fundingTime),
    } : { fundingRate: 0, nextFundingRate: 0, fundingTime: 0 };
  }

  /** 资金费率历史（用于图表） */
  async fetchFundingRateHistory(inst = 'BTC-USDT', limit = 100) {
    const instId = toSwapId(inst);
    const data = await this._publicRequest('/api/v5/public/funding-rate-history', {
      instId, limit,
    });
    return (data ?? []).map(d => ({
      ts:           parseInt(d.fundingTime),
      fundingRate:  parseFloat(d.fundingRate),
      realizedRate: parseFloat(d.realizedRate),
    })).reverse();
  }

  // ── 账户数据（需签名）────────────────────────────────
  async fetchBalance() {
    const data    = await this._request('GET', '/api/v5/account/balance', { ccy: 'USDT' });
    const details = Array.isArray(data?.[0]?.details)
      ? data[0].details
      : (Array.isArray(data) ? data : []);
    return details.map(d => ({
      ccy:      d.ccy,
      eq:       parseFloat(d.eq),
      eqUsd:    parseFloat(d.eqUsd),
      availBal: parseFloat(d.availBal),
    }));
  }

  async fetchPositions(instType = 'SWAP') {
    const data = await this._request('GET', '/api/v5/account/positions', { instType });
    return (data ?? []).map(p => {
      // 双向持仓模式(posSide=short)时 pos 是正数，统一转成负数，让下游 pos>0=多 pos<0=空
      let posVal = parseFloat(p.pos);
      if (p.posSide === 'short' && posVal > 0) posVal = -posVal;
      return {
      instId:      p.instId,
      pos:         posVal,
      avgPx:       parseFloat(p.avgPx),
      markPx:      parseFloat(p.markPx),
      upl:         parseFloat(p.upl),
      uplRatio:    parseFloat(p.uplRatio),
      lever:       p.lever,
      mgnMode:     p.mgnMode,
      mgnRatio:    parseFloat(p.mgnRatio),
      notionalUsd: parseFloat(p.notionalUsd),
      liqPx:       p.liqPx,
      posSide:     p.posSide,
      };
    });
  }

  async fetchOrdersHistory() {
    const data = await this._request('GET', '/api/v5/trade/orders-history-archive', {
      instType: 'SWAP',
      limit:    100,
    });
    return (data ?? []).map(o => ({
      ordId:      o.ordId,
      instId:     o.instId,
      side:       o.side,
      reduceOnly: o.reduceOnly === 'true',
      ordType:    o.ordType,
      sz:         parseFloat(o.sz),
      avgPx:      parseFloat(o.avgPx) || 0,
      fillSz:     parseFloat(o.accFillSz) || 0,
      pnl:        parseFloat(o.pnl) || 0,
      fee:        parseFloat(o.fee) || 0,
      state:      o.state,
      lever:      o.lever,
      cTime:      parseInt(o.cTime),
      fillTime:   parseInt(o.fillTime),
    }));
  }

  // ── 交易操作 ─────────────────────────────────────────
  async setLeverage({ inst, lever, mgnMode = 'cross' }) {
    const instId = toSwapId(inst);
    const data = await this._request('POST', '/api/v5/account/set-leverage', null, {
      instId,
      lever:   String(lever),
      mgnMode,
    });
    return data?.[0] ?? null;
  }

  async placeOrder({ inst, side, sz, ordType = 'market', tdMode = 'cross', posSide, reduceOnly }) {
    const instId = toSwapId(inst);
    const tryPlace = async (mode, ps) => {
      const body = { instId, side, sz: String(sz), ordType, tdMode: mode, posSide: ps };
      if (reduceOnly) body.reduceOnly = 'true';
      console.log('[placeOrder] attempt:', JSON.stringify(body));
      return this._request('POST', '/api/v5/trade/order', null, body);
    };

    // Try combinations: (tdMode, posSide) with fallbacks
    const tdModes = [tdMode, tdMode === 'cross' ? 'isolated' : 'cross'];
    const posSides = posSide ? [posSide] : ['net', side === 'buy' ? 'long' : 'short'];

    let lastErr;
    for (const tm of tdModes) {
      for (const ps of posSides) {
        try {
          const data = await tryPlace(tm, ps);
          return data?.[0] ?? null;
        } catch (e) {
          lastErr = e;
          // Only retry on parameter errors (51000 series)
          if (!/51(000|009|010)/.test(e.message)) throw e;
          console.warn(`[placeOrder] tdMode=${tm} posSide=${ps} failed:`, e.message);
        }
      }
    }
    throw lastErr;
  }

  async placeAlgoOrder({ inst, side, sz, tpTriggerPx, slTriggerPx, tdMode = 'cross', posSide = 'net' }) {
    const instId = toSwapId(inst);
    const buildBody = (tm, ps) => {
      const b = { instId, side, sz: String(sz), ordType: 'oco', tdMode: tm, posSide: ps, reduceOnly: 'true' };
      if (tpTriggerPx) { b.tpTriggerPx = String(tpTriggerPx); b.tpOrdPx = '-1'; }
      if (slTriggerPx) { b.slTriggerPx = String(slTriggerPx); b.slOrdPx = '-1'; }
      return b;
    };
    // Try with fallbacks for tdMode and posSide
    const tdModes = [tdMode, tdMode === 'cross' ? 'isolated' : 'cross'];
    const posSides = [posSide, posSide === 'net' ? (side === 'buy' ? 'short' : 'long') : 'net'];
    let lastErr;
    for (const tm of tdModes) {
      for (const ps of posSides) {
        try {
          const body = buildBody(tm, ps);
          console.log('[placeAlgoOrder] attempt:', JSON.stringify(body));
          const data = await this._request('POST', '/api/v5/trade/order-algo', null, body);
          return data?.[0] ?? null;
        } catch (e) {
          lastErr = e;
          if (!/51(000|009|010)/.test(e.message)) throw e;
          console.warn(`[placeAlgoOrder] tm=${tm} ps=${ps} failed:`, e.message);
        }
      }
    }
    throw lastErr;
  }

  // ── 现货交易 ─────────────────────────────────────────
  async placeSpotOrder({ inst, side, sz, ordType = 'market' }) {
    const tgtCcy = side === 'buy' ? 'base_ccy' : 'quote_ccy';
    // Try 'cash' first (Simple mode), then 'cross' (Multi-currency margin mode)
    for (const tdMode of ['cash', 'cross']) {
      const body = { instId: inst, side, sz: String(sz), ordType, tdMode, tgtCcy };
      console.log('[placeSpotOrder] attempt:', JSON.stringify(body));
      try {
        const data = await this._request('POST', '/api/v5/trade/order', null, body);
        return data?.[0] ?? null;
      } catch (e) {
        if (tdMode === 'cash' && /51000/.test(e.message) && e.message.includes('tdMode')) {
          console.warn('[placeSpotOrder] cash failed, trying cross:', e.message);
          continue;
        }
        throw e;
      }
    }
  }
}

/**
 * Create a temporary OkxClient from user-provided credentials (no env vars).
 */
function createTempClient({ apiKey, secretKey, passphrase, demo = false }) {
  if (!apiKey || !secretKey || !passphrase) {
    throw new Error('Incomplete API credentials');
  }
  return new OkxClient({ apiKey, secretKey, passphrase, demo });
}

module.exports = { OkxClient, getCredentials, toSwapId, createTempClient };
