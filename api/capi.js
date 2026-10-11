// Meta Conversions API relay — receives browser beacons and forwards to Graph API
// (copied from joinknct.com api/capi.js 2026-10-11; only the site-specific constants differ)
// with server-side signals (IP / User-Agent / fbp / fbc / hashed IP geo + external_id) for better match quality.
// Requires env var META_CAPI_TOKEN (Vercel → Settings → Environment Variables).
// Browser pixel sends the same event_id, so Meta dedupes the two channels.
//
// Hardening (2026-09-19 security audit):
//  - only requests originating from this site (Origin / Referer) are relayed
//  - event_name is restricted to the events index.html actually emits
//  - event_source_url is sent without ?query / #hash (this page carries the booking time and name there)
//  - custom_data is reduced to known keys with bounded string values
//  - event_source_url is only accepted when it points at this site
//  - test_event_code is not accepted from the client
//  - upstream error text is never echoed to the caller

const crypto = require('crypto');

const PIXEL_ID = '1665016335272219';
const GRAPH = 'https://graph.facebook.com/v21.0';
const SITE_URL = 'https://knct-lp.vercel.app/';

const ALLOWED_EVENTS = new Set(['PageView', 'Schedule']);
const CUSTOM_KEYS = ['video_id', 'area', 'content_name', 'content_category'];
const MAX_ID_LEN = 64;
const MAX_STR_LEN = 100;
const MAX_URL_LEN = 2048;

// This project's Vercel production / preview hosts (knct-lp.vercel.app, knct-lp-*-knctuniversity.vercel.app, knct-l*-knctuniversity.vercel.app)
const VERCEL_RE = /^https:\/\/(knct-lp|knct-l[a-z0-9-]*-knctuniversity)\.vercel\.app$/i;

function isAllowedOrigin(origin) {
  return VERCEL_RE.test(origin);
}

function originOfReferer(referer) {
  try { return new URL(referer).origin; } catch (e) { return ''; }
}

function shortString(v, max) {
  return typeof v === 'string' && v.length > 0 && v.length <= max ? v : undefined;
}

function pickCustomData(raw) {
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return undefined;
  const out = {};
  for (const k of CUSTOM_KEYS) {
    const v = shortString(raw[k], MAX_STR_LEN);
    if (v !== undefined) out[k] = v;
  }
  return Object.keys(out).length ? out : undefined;
}

function pickSourceUrl(raw) {
  if (typeof raw !== 'string' || raw.length > MAX_URL_LEN) return SITE_URL;
  try {
    const u = new URL(raw);
    if (!isAllowedOrigin(u.origin)) return SITE_URL;
    u.search = '';
    u.hash = '';
    return u.href;
  } catch (e) { return SITE_URL; }
}

// JIS X 0401 prefecture codes (Vercel's x-vercel-ip-country-region for JP) -> romanized names
const JP_PREFS = [
  'hokkaido', 'aomori', 'iwate', 'miyagi', 'akita', 'yamagata', 'fukushima', 'ibaraki',
  'tochigi', 'gunma', 'saitama', 'chiba', 'tokyo', 'kanagawa', 'niigata', 'toyama',
  'ishikawa', 'fukui', 'yamanashi', 'nagano', 'gifu', 'shizuoka', 'aichi', 'mie',
  'shiga', 'kyoto', 'osaka', 'hyogo', 'nara', 'wakayama', 'tottori', 'shimane',
  'okayama', 'hiroshima', 'yamaguchi', 'tokushima', 'kagawa', 'ehime', 'kochi', 'fukuoka',
  'saga', 'nagasaki', 'kumamoto', 'oita', 'miyazaki', 'kagoshima', 'okinawa',
];

// Meta normalization: lowercase, no spaces / punctuation
function normalize(v) { return v.toLowerCase().replace(/[^\p{L}\p{N}]/gu, ''); }

function headerValue(req, name) {
  const raw = String(req.headers[name] || '');
  try { return decodeURIComponent(raw).slice(0, MAX_STR_LEN); } catch (e) { return raw.slice(0, MAX_STR_LEN); }
}

function sha256(v) { return crypto.createHash('sha256').update(v).digest('hex'); }

// Hashed user_data keys Meta needs for attribution. The LP collects no email / phone
// (visitors go on to LINE), so send the approximate location Vercel derives from the IP,
// plus the _fbp browser ID as external_id.
function matchKeys(req, fbp) {
  const country = normalize(headerValue(req, 'x-vercel-ip-country'));
  const region = normalize(headerValue(req, 'x-vercel-ip-country-region'));
  const plain = {
    ct: normalize(headerValue(req, 'x-vercel-ip-city')),
    st: country === 'jp' ? (JP_PREFS[Number(region) - 1] || '') : region,
    zp: normalize(headerValue(req, 'x-vercel-ip-postal-code')),
    country: country,
    external_id: fbp || '',
  };
  const out = {};
  for (const k of Object.keys(plain)) if (plain[k]) out[k] = sha256(plain[k]);
  return out;
}

module.exports = async (req, res) => {
  if (req.method !== 'POST') { res.status(405).json({ error: 'POST only' }); return; }

  // Same-site gate: browsers always send Origin on POST; Referer is the fallback.
  const origin = String(req.headers.origin || '') || originOfReferer(String(req.headers.referer || ''));
  if (!isAllowedOrigin(origin)) { res.status(403).json({ error: 'forbidden' }); return; }

  const token = process.env.META_CAPI_TOKEN;
  if (!token) { res.status(200).json({ skipped: 'META_CAPI_TOKEN not set' }); return; }

  let body = req.body;
  if (typeof body === 'string') { try { body = JSON.parse(body); } catch (e) { body = null; } }
  if (!body || typeof body !== 'object') { res.status(400).json({ error: 'invalid body' }); return; }

  const eventName = typeof body.event_name === 'string' && ALLOWED_EVENTS.has(body.event_name) ? body.event_name : null;
  const eventId = shortString(body.event_id, MAX_ID_LEN);
  if (!eventName || !eventId) { res.status(400).json({ error: 'invalid event' }); return; }

  const ip = String(req.headers['x-forwarded-for'] || '').split(',')[0].trim();
  const fbp = shortString(body.fbp, MAX_STR_LEN);
  const payload = {
    data: [{
      event_name: eventName,
      event_time: Math.floor(Date.now() / 1000),
      event_id: eventId,
      action_source: 'website',
      event_source_url: pickSourceUrl(body.event_source_url),
      user_data: {
        client_ip_address: ip || undefined,
        client_user_agent: shortString(req.headers['user-agent'], 512),
        fbp: fbp,
        fbc: shortString(body.fbc, 512),
        ...matchKeys(req, fbp),
      },
      custom_data: pickCustomData(body.custom_data),
    }],
  };

  try {
    const r = await fetch(`${GRAPH}/${PIXEL_ID}/events?access_token=${encodeURIComponent(token)}`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload),
    });
    if (!r.ok) {
      // Log server-side for the owner; never expose Meta's error text to the caller.
      const j = await r.json().catch(() => ({}));
      console.error('capi relay upstream error', r.status, j && j.error && j.error.message);
      res.status(502).json({ error: 'relay failed' }); return;
    }
    res.status(200).json({ ok: true });
  } catch (e) {
    console.error('capi relay failed', e && e.message);
    res.status(502).json({ error: 'relay failed' });
  }
};
