const twilio = require('twilio');

/**
 * Outbound SMS sender for shift coverage.
 *
 * Every OTHER Twilio interaction in this codebase (routes/sms.js) is a TwiML
 * reply on the inbound webhook, which needs no credentials at all. This is the
 * first code path that actually authenticates to Twilio's REST API, which is
 * why TWILIO_ACCOUNT_SID being an API Key SID (starts "SK") instead of an
 * Account SID (starts "AC") was invisible until now - see the warning in
 * server.js and isConfigured() below.
 */

let client = null;
function getClient() {
  if (!client) {
    client = twilio(process.env.TWILIO_ACCOUNT_SID, process.env.TWILIO_AUTH_TOKEN);
  }
  return client;
}

// Employee.phone is stored raw (e.g. "5555550100" or "555-555-0100"), never
// in E.164. Best-effort North American normalization; anything that doesn't
// look like a 10 or 11-digit NANP number is passed through with a leading
// "+" and left for Twilio to reject (captured by the caller as a send error,
// never thrown here).
function toE164(phone) {
  const digits = String(phone || '').replace(/\D/g, '');
  if (digits.length === 10) return `+1${digits}`;
  if (digits.length === 11 && digits.startsWith('1')) return `+${digits}`;
  return `+${digits}`;
}

// Last 10 digits, for indexed exact-match lookups (mirrors the inbound
// webhook's own normalization in routes/sms.js).
function last10(phone) {
  return String(phone || '').replace(/\D/g, '').slice(-10);
}

async function realSend({ to, body }) {
  const msg = await getClient().messages.create({
    to: toE164(to),
    from: process.env.TWILIO_PHONE_NUMBER,
    body
  });
  return { sid: msg.sid };
}

// Swappable implementation - coverageService calls exports.send(), and tests
// replace it with a function that captures messages instead of sending them,
// the same dependency-injection pattern scripts/test-sms-conversation.js uses
// to avoid the database.
let impl = realSend;

exports.send = (message) => impl(message);

exports._setImplementation = (fn) => {
  impl = fn;
};

exports._reset = () => {
  impl = realSend;
};

exports.isConfigured = () => Boolean(
  process.env.TWILIO_ACCOUNT_SID &&
  process.env.TWILIO_ACCOUNT_SID.startsWith('AC') &&
  process.env.TWILIO_AUTH_TOKEN &&
  process.env.TWILIO_PHONE_NUMBER
);

exports.toE164 = toE164;
exports.last10 = last10;
