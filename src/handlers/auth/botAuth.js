const crypto = require('node:crypto');
const BOT_SECRET = process.env.BOT_SECRET || '';

function safeTimingEqual(a, b) {
  const ba = Buffer.from(a || '');
  const bb = Buffer.from(b || '');
  if (ba.length !== bb.length) return false;
  return crypto.timingSafeEqual(ba, bb);
}

exports.handler = async (event) => {
  try {
    const headers = Object.fromEntries(
      Object.entries(event.headers || {}).map(([k, v]) => [k.toLowerCase(), v])
    );
    const sig = headers['x-bot-signature'];
    const ts = headers['x-bot-timestamp'];
    if (!sig || !ts) return { isAuthorized: false };

    const now = Math.floor(Date.now() / 1000);
    const tsNum = Number(ts);
    if (!Number.isFinite(tsNum) || Math.abs(now - tsNum) > 300) {
      return { isAuthorized: false };
    }

    const secret = BOT_SECRET;
    if (!secret) return { isAuthorized: false };

    const body = event.body || '';
    const payload = `${ts}.${body}`;
    const h = crypto.createHmac('sha256', secret).update(payload).digest('hex');
    const expected = `sha256=${h}`;

    const ok = safeTimingEqual(sig, expected);
    return { isAuthorized: !!ok };
  } catch (e) {
    console.error('BotAuth error', e);
    return { isAuthorized: false };
  }
};
