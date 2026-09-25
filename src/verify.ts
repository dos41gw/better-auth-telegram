import { DEFAULT_MAX_AUTH_AGE } from "./constants";
import type { TelegramAuthData, TelegramMiniAppData } from "./types";

const encoder = new TextEncoder();

/**
 * Computes HMAC-SHA256 of data using the given key
 */
async function hmacSha256(key: Uint8Array, data: string): Promise<ArrayBuffer> {
  const cryptoKey = await globalThis.crypto.subtle.importKey(
    "raw",
    key as BufferSource,
    { name: "HMAC", hash: "SHA-256" },
    false,
    ["sign"]
  );
  return globalThis.crypto.subtle.sign(
    "HMAC",
    cryptoKey,
    encoder.encode(data) as BufferSource
  );
}

/**
 * Computes SHA-256 hash of a string
 */
async function sha256(data: string): Promise<ArrayBuffer> {
  return await globalThis.crypto.subtle.digest(
    "SHA-256",
    encoder.encode(data) as BufferSource
  );
}

const hashPattern = /^[a-f0-9]{64}$/i;
const integerPattern = /^\d+$/;

function validTime(value: number, maxAge: number): boolean {
  const now = Math.floor(Date.now() / 1000);
  return (
    Number.isSafeInteger(value) &&
    value > 0 &&
    Number.isFinite(maxAge) &&
    maxAge > 0 &&
    value <= now + 30 &&
    now - value <= maxAge
  );
}

async function verifyHmac(key: Uint8Array, data: string, hash: string) {
  if (!hashPattern.test(hash)) return false;
  const cryptoKey = await crypto.subtle.importKey(
    "raw",
    key as BufferSource,
    { name: "HMAC", hash: "SHA-256" },
    false,
    ["verify"]
  );
  const signature = Uint8Array.from(hash.match(/.{2}/g)!, (byte) =>
    Number.parseInt(byte, 16)
  );
  return crypto.subtle.verify(
    "HMAC",
    cryptoKey,
    signature,
    encoder.encode(data)
  );
}

/**
 * Verifies the authenticity of Telegram authentication data
 * @param data - Authentication data from Telegram Login Widget
 * @param botToken - Bot token from @BotFather
 * @param maxAge - Maximum age of auth in seconds (default: 24 hours)
 * @returns Promise that resolves to true if data is valid, false otherwise
 */
export async function verifyTelegramAuth(
  data: TelegramAuthData,
  botToken: string,
  maxAge = DEFAULT_MAX_AUTH_AGE
): Promise<boolean> {
  if (!validateTelegramAuthData(data) || !botToken) return false;
  // Extract hash from data
  const { hash, ...dataWithoutHash } = data;

  // Check auth_date is not too old
  const authDate = dataWithoutHash.auth_date;

  if (!validTime(authDate, maxAge)) {
    return false;
  }

  // Create data-check-string
  const dataCheckString = Object.keys(dataWithoutHash)
    .sort()
    .map((key) => {
      const value = dataWithoutHash[key as keyof typeof dataWithoutHash];
      return `${key}=${value}`;
    })
    .join("\n");

  // Create secret key: SHA256(bot_token)
  const secretKey = new Uint8Array(await sha256(botToken));

  return verifyHmac(secretKey, dataCheckString, hash);
}

/**
 * Validates that required fields are present in Telegram auth data
 */
export function validateTelegramAuthData(data: any): data is TelegramAuthData {
  return (
    typeof data === "object" &&
    data !== null &&
    Number.isSafeInteger(data.id) &&
    data.id > 0 &&
    typeof data.first_name === "string" &&
    [data.last_name, data.username, data.photo_url].every(
      (value) => value === undefined || typeof value === "string"
    ) &&
    Number.isSafeInteger(data.auth_date) &&
    data.auth_date > 0 &&
    typeof data.hash === "string"
  );
}

/**
 * Parse initData string from Telegram Mini App
 * @param initData - URL-encoded initData string from Telegram.WebApp.initData
 * @returns Parsed Mini App data object
 */
export function parseMiniAppInitData(initData: string): TelegramMiniAppData {
  const params = new URLSearchParams(initData);
  const data: Partial<TelegramMiniAppData> & Record<string, unknown> =
    Object.create(null);

  for (const [key, value] of params.entries()) {
    if (["__proto__", "prototype", "constructor"].includes(key)) continue;
    if (key === "user" || key === "receiver" || key === "chat") {
      // Parse JSON objects
      try {
        data[key] = JSON.parse(value);
      } catch {}
    } else if (key === "auth_date" || key === "can_send_after") {
      // Parse numbers
      data[key] = Number(value);
    } else {
      // Keep as string
      data[key] = value;
    }
  }

  return data as TelegramMiniAppData;
}

/**
 * Verifies the authenticity of Telegram Mini App initData
 * @param initData - Raw initData string from Telegram.WebApp.initData
 * @param botToken - Bot token from @BotFather
 * @param maxAge - Maximum age of auth in seconds (default: 24 hours)
 * @returns Promise that resolves to true if data is valid, false otherwise
 */
export async function verifyMiniAppInitData(
  initData: string,
  botToken: string,
  maxAge = DEFAULT_MAX_AUTH_AGE
): Promise<boolean> {
  if (typeof initData !== "string" || initData.length > 16384 || !botToken)
    return false;
  const params = new URLSearchParams(initData);
  const keys = [...params.keys()];
  if (new Set(keys).size !== keys.length) return false;
  const hash = params.get("hash");

  if (!hash) {
    return false;
  }

  // Remove hash from params
  params.delete("hash");

  // Check auth_date
  const authDate = params.get("auth_date");
  if (!authDate || !integerPattern.test(authDate)) {
    return false;
  }

  const authDateNum = Number(authDate);

  if (!validTime(authDateNum, maxAge)) {
    return false;
  }

  // Create data-check-string (sorted alphabetically)
  const dataCheckString = Array.from(params.entries())
    .sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0))
    .map(([key, value]) => `${key}=${value}`)
    .join("\n");

  // Create secret key: HMAC-SHA256(key="WebAppData", data=botToken)
  const secretKey = new Uint8Array(
    await hmacSha256(encoder.encode("WebAppData"), botToken)
  );

  return verifyHmac(secretKey, dataCheckString, hash);
}

/**
 * Validates that required fields are present in Mini App data
 */
export function validateMiniAppData(data: any): data is TelegramMiniAppData {
  return (
    typeof data === "object" &&
    data !== null &&
    Number.isSafeInteger(data.auth_date) &&
    data.auth_date > 0 &&
    typeof data.hash === "string" &&
    (data.user === undefined ||
      (typeof data.user === "object" &&
        data.user !== null &&
        Number.isSafeInteger(data.user.id) &&
        data.user.id > 0 &&
        typeof data.user.first_name === "string" &&
        [data.user.last_name, data.user.username, data.user.photo_url].every(
          (value) => value === undefined || typeof value === "string"
        )))
  );
}
