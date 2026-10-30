/*
 * SHADOW PAIR API
 * Uses the existing SHADOW MD session manager.
 * Pair only WhatsApp accounts you own or are authorized to manage.
 */
'use strict';

const http = require('http');
const crypto = require('crypto');
const { startSession, removeSession, isConnected } = require('../src/session');

const PORT = Number(process.env.PORT || 3000);
const ALLOWED_ORIGIN = (process.env.ALLOWED_ORIGIN || '').replace(/\/$/, '');
const REQUEST_TTL_MS = 3 * 60 * 1000;
const RATE_WINDOW_MS = 60 * 1000;
const RATE_MAX = 5;

const requests = new Map();
const rate = new Map();

function json(res, status, body) {
  res.writeHead(status, {
    'content-type': 'application/json; charset=utf-8',
    'cache-control': 'no-store',
    'x-content-type-options': 'nosniff'
  });
  res.end(JSON.stringify(body));
}
function cors(req, res) {
  const origin = req.headers.origin;
  if (!origin) return true; // permits server-side health checks
  if (!ALLOWED_ORIGIN || origin !== ALLOWED_ORIGIN) return false;
  res.setHeader('access-control-allow-origin', origin);
  res.setHeader('vary', 'Origin');
  res.setHeader('access-control-allow-methods', 'GET, POST, OPTIONS');
  res.setHeader('access-control-allow-headers', 'content-type');
  return true;
}
function rateLimit(req) {
  const ip = String(req.headers['x-forwarded-for'] || req.socket.remoteAddress || 'unknown').split(',')[0].trim();
  const now = Date.now();
  const old = rate.get(ip);
  if (!old || now - old.start > RATE_WINDOW_MS) {
    rate.set(ip, { start: now, count: 1 });
    return false;
  }
  old.count++;
  return old.count > RATE_MAX;
}
function readBody(req) {
  return new Promise((resolve, reject) => {
    let data = '';
    req.on('data', chunk => {
      data += chunk;
      if (data.length > 4096) {
        reject(new Error('Request body too large'));
        req.destroy();
      }
    });
    req.on('end', () => {
      try { resolve(JSON.parse(data || '{}')); }
      catch { reject(new Error('Invalid JSON')); }
    });
    req.on('error', reject);
  });
}
function publicState(item) {
  return {
    status: item.status,
    code: item.code || null,
    message: item.message || null,
    expiresAt: item.expiresAt
  };
}

const server = http.createServer(async (req, res) => {
  if (!cors(req, res)) return json(res, 403, { error: 'Origin not allowed' });
  if (req.method === 'OPTIONS') {
    res.writeHead(204);
    return res.end();
  }
  const url = new URL(req.url, `http://${req.headers.host || 'localhost'}`);

  if (req.method === 'GET' && url.pathname === '/api/health') {
    return json(res, 200, { ok: true, service: 'SHADOW PAIR API' });
  }

  if (req.method === 'POST' && url.pathname === '/api/pair') {
    if (rateLimit(req)) return json(res, 429, { error: 'Too many attempts. Wait one minute and try again.' });
    let body;
    try { body = await readBody(req); }
    catch (e) { return json(res, 400, { error: e.message }); }

    const number = String(body.number || '').replace(/\D/g, '');
    if (number.length < 8 || number.length > 15) {
      return json(res, 400, { error: 'Enter a valid international phone number with country code.' });
    }

    const id = crypto.randomUUID();
    const sessionId = `web-${id.replace(/-/g, '')}`;
    const item = {
      id, sessionId, status: 'starting', code: null,
      message: 'Starting a secure WhatsApp pairing request.',
      expiresAt: Date.now() + REQUEST_TTL_MS
    };
    requests.set(id, item);

    startSession(sessionId, {
      pairingNumber: number,
      onPairingCode: code => {
        item.status = 'code';
        item.code = String(code).match(/.{1,4}/g)?.join('-') || String(code);
        item.message = 'Enter this code in WhatsApp Linked Devices.';
      },
      onPairingError: err => {
        item.status = 'error';
        item.message = 'WhatsApp could not issue a pairing code. Wait before trying again.';
        console.error('[SHADOW PAIR]', err && err.message);
      },
      onPairingFailed: () => {
        item.status = 'expired';
        item.message = 'Pairing was not completed. Start a new request.';
      },
      onConnected: () => {
        item.status = 'connected';
        item.code = null;
        item.message = 'WhatsApp is connected.';
      },
      onLoggedOut: () => {
        item.status = 'disconnected';
        item.message = 'This WhatsApp session was logged out.';
      },
      onDisconnected: () => {
        if (item.status !== 'connected') item.message = 'Connection interrupted; reconnecting.';
      }
    }).catch(err => {
      item.status = 'error';
      item.message = 'Could not start the pairing session.';
      console.error('[SHADOW PAIR]', err && err.message);
    });

    return json(res, 202, { requestId: id, ...publicState(item) });
  }

  const statusMatch = url.pathname.match(/^\/api\/status\/([a-f0-9-]{36})$/i);
  if (req.method === 'GET' && statusMatch) {
    const item = requests.get(statusMatch[1]);
    if (!item) return json(res, 404, { error: 'Request not found or server restarted.' });
    if (Date.now() > item.expiresAt && item.status !== 'connected') {
      item.status = 'expired';
      item.code = null;
    }
    if (item.status === 'connected' && !isConnected(item.sessionId)) {
      // A short disconnect can happen during WhatsApp's post-pairing restart.
      item.message = 'Session established; connection is reconnecting if needed.';
    }
    return json(res, 200, publicState(item));
  }

  if (req.method === 'POST' && url.pathname === '/api/cancel') {
    let body;
    try { body = await readBody(req); }
    catch (e) { return json(res, 400, { error: e.message }); }
    const item = requests.get(String(body.requestId || ''));
    if (!item) return json(res, 404, { error: 'Request not found.' });
    if (item.status === 'connected') {
      return json(res, 409, { error: 'This session is already connected. Manage it from your bot host.' });
    }
    item.status = 'cancelled';
    item.code = null;
    item.message = 'Pairing request cancelled.';
    await removeSession(item.sessionId);
    return json(res, 200, { ok: true });
  }

  return json(res, 404, { error: 'Not found' });
});

server.listen(PORT, '0.0.0.0', () => {
  console.log(`SHADOW PAIR API listening on ${PORT}`);
});

// Remove expired request metadata; do not delete established WhatsApp sessions.
setInterval(() => {
  const now = Date.now();
  for (const [id, item] of requests) {
    if (now > item.expiresAt && item.status !== 'connected') {
      item.status = 'expired';
      item.code = null;
      requests.delete(id);
    }
  }
  for (const [ip, entry] of rate) {
    if (now - entry.start > RATE_WINDOW_MS * 2) rate.delete(ip);
  }
}, 30000).unref();
