import crypto from "node:crypto";

function b64url(input) {
  return Buffer.from(input).toString("base64url");
}

function parseDuration(expSec) {
  return Number.isFinite(expSec) ? expSec : 900;
}

export function signStreamToken(payload, secret, ttlSec = 900) {
  const header = { alg: "HS256", typ: "JWT" };
  const now = Math.floor(Date.now() / 1000);
  const body = { ...payload, iat: now, exp: now + parseDuration(ttlSec) };

  const encodedHeader = b64url(JSON.stringify(header));
  const encodedBody = b64url(JSON.stringify(body));
  const content = `${encodedHeader}.${encodedBody}`;
  const sig = crypto.createHmac("sha256", secret).update(content).digest("base64url");

  return `${content}.${sig}`;
}

export function verifyStreamToken(token, secret) {
  try {
    const [encodedHeader, encodedBody, signature] = token.split(".");
    if (!encodedHeader || !encodedBody || !signature) {
      return { valid: false, reason: "malformed token" };
    }

    const content = `${encodedHeader}.${encodedBody}`;
    const expected = crypto.createHmac("sha256", secret).update(content).digest("base64url");
    const actualBuf = Buffer.from(signature);
    const expectedBuf = Buffer.from(expected);
    if (actualBuf.length !== expectedBuf.length || !crypto.timingSafeEqual(actualBuf, expectedBuf)) {
      return { valid: false, reason: "invalid signature" };
    }

    const payload = JSON.parse(Buffer.from(encodedBody, "base64url").toString("utf8"));
    const now = Math.floor(Date.now() / 1000);
    if (!payload.exp || now > payload.exp) {
      return { valid: false, reason: "token expired" };
    }

    return { valid: true, payload };
  } catch (error) {
    return { valid: false, reason: error?.message || "token parse error" };
  }
}
