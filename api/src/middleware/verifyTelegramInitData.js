import crypto from "node:crypto";

function parseInitData(raw) {
  const params = new URLSearchParams(raw || "");
  const hash = params.get("hash");
  const authDate = params.get("auth_date");

  if (!hash || !authDate) {
    return { ok: false, error: "Missing hash/auth_date" };
  }

  const pairs = [];
  for (const [key, value] of params.entries()) {
    if (key === "hash") continue;
    pairs.push(`${key}=${value}`);
  }
  pairs.sort();

  return {
    ok: true,
    hash,
    authDate: Number(authDate),
    dataCheckString: pairs.join("\n"),
    params,
  };
}

export function verifyTelegramInitData(rawInitData, botToken, maxAgeSec = 24 * 60 * 60) {
  const parsed = parseInitData(rawInitData);
  if (!parsed.ok) return { valid: false, reason: parsed.error };

  const now = Math.floor(Date.now() / 1000);
  if (!Number.isFinite(parsed.authDate) || now - parsed.authDate > maxAgeSec) {
    return { valid: false, reason: "init-data expired" };
  }

  if (!botToken) {
    return { valid: false, reason: "TELEGRAM_BOT_TOKEN is missing" };
  }

  const secret = crypto.createHmac("sha256", "WebAppData").update(botToken).digest();
  const expectedHash = crypto.createHmac("sha256", secret).update(parsed.dataCheckString).digest("hex");

  const expected = Buffer.from(expectedHash, "hex");
  const actual = Buffer.from(parsed.hash, "hex");
  if (expected.length !== actual.length || !crypto.timingSafeEqual(expected, actual)) {
    return { valid: false, reason: "invalid signature" };
  }

  const userJson = parsed.params.get("user");
  let user = null;
  if (userJson) {
    try {
      user = JSON.parse(userJson);
    } catch {
      user = null;
    }
  }

  return { valid: true, user, authDate: parsed.authDate };
}

export function requireTelegramInitData({ botToken }) {
  return (req, res, next) => {
    const auth = req.header("authorization") || "";
    const authInitData = auth.replace(/^(Bearer|tma)\s+/i, "").trim();
    const initData =
      req.header("x-telegram-init-data") ||
      req.body?.initData ||
      req.body?.init_data ||
      (authInitData || undefined);
    const result = verifyTelegramInitData(initData, botToken);

    if (!result.valid) {
      return res.status(401).json({ error: "Unauthorized", reason: result.reason });
    }

    req.telegram = {
      user: result.user,
      authDate: result.authDate,
      initData,
    };
    next();
  };
}
