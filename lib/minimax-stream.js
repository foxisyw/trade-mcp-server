/**
 * MiniMax M2.5-highspeed Streaming Client
 * Uses reasoning_split for chain-of-thought separation
 */

const https = require('https');

const MINIMAX_API_URL  = 'https://api.minimax.io/v1/chat/completions';
const MINIMAX_MODEL    = 'MiniMax-M2.5-highspeed';
const MINIMAX_API_KEY  = process.env.MINIMAX_API_KEY || '';

/**
 * Stream a completion from MiniMax with reasoning separation
 *
 * @param {Object} opts
 * @param {string} opts.systemPrompt
 * @param {string} opts.userMessage
 * @param {Function} opts.onReasoning  - (accumulatedText) => void
 * @param {Function} opts.onContent    - (accumulatedText) => void
 * @param {string}  [opts.apiKey]
 * @param {number}  [opts.maxTokens=2048]
 * @param {number}  [opts.temperature=0.5]
 * @param {number}  [opts.timeoutMs=120000]
 * @returns {Promise<{content: string, reasoning: string}>}
 */
function streamCompletion(opts) {
  const apiKey   = (opts.apiKey || MINIMAX_API_KEY).trim();
  const maxTok   = opts.maxTokens   || 2048;
  const temp     = opts.temperature || 0.5;
  const timeout  = opts.timeoutMs   || 120000;

  const body = JSON.stringify({
    model:           MINIMAX_MODEL,
    messages: [
      { role: 'system', content: opts.systemPrompt },
      { role: 'user',   content: opts.userMessage },
    ],
    max_tokens:      maxTok,
    temperature:     temp,
    stream:          true,
    reasoning_split: true,
  });

  const url = new URL(MINIMAX_API_URL);

  return new Promise((resolve, reject) => {
    const req = https.request({
      hostname: url.hostname,
      path:     url.pathname,
      method:   'POST',
      headers: {
        'Content-Type':  'application/json',
        'Authorization': `Bearer ${apiKey}`,
        'Content-Length': Buffer.byteLength(body),
      },
      timeout,
    }, (res) => {
      if (res.statusCode !== 200) {
        let errBody = '';
        res.on('data', c => errBody += c);
        res.on('end', () => reject(new Error(`MiniMax HTTP ${res.statusCode}: ${errBody.slice(0, 300)}`)));
        return;
      }

      let buffer       = '';
      let fullReasoning = '';
      let fullContent   = '';

      res.setEncoding('utf8');

      res.on('data', (chunk) => {
        buffer += chunk;
        const lines = buffer.split('\n');
        buffer = lines.pop() || '';  // keep incomplete line

        for (const line of lines) {
          const trimmed = line.trim();
          if (!trimmed || !trimmed.startsWith('data: ')) continue;
          const payload = trimmed.slice(6).trim();
          if (payload === '[DONE]') continue;

          try {
            const parsed = JSON.parse(payload);
            const delta  = parsed.choices?.[0]?.delta;
            if (!delta) continue;

            // Reasoning chunks (accumulated by API)
            if (delta.reasoning_details) {
              for (const detail of delta.reasoning_details) {
                if (detail.text) {
                  fullReasoning = detail.text;  // API sends accumulated text
                  if (opts.onReasoning) opts.onReasoning(fullReasoning);
                }
              }
            }

            // Content chunks (incremental)
            if (delta.content) {
              fullContent += delta.content;
              if (opts.onContent) opts.onContent(fullContent);
            }
          } catch (_) { /* skip unparseable chunks */ }
        }
      });

      res.on('end', () => {
        resolve({ content: fullContent, reasoning: fullReasoning });
      });

      res.on('error', reject);
    });

    req.on('error', reject);
    req.on('timeout', () => { req.destroy(); reject(new Error('MiniMax request timeout')); });
    req.write(body);
    req.end();
  });
}

module.exports = { streamCompletion, MINIMAX_MODEL, MINIMAX_API_KEY };
