import type { GenericEndpointContext } from "@better-auth/core";
import {
  getCurrentAdapter,
  runWithTransaction,
} from "@better-auth/core/context";
import type { User } from "better-auth";
import {
  APIError,
  createAuthMiddleware,
  getSessionFromCtx,
} from "better-auth/api";
import { setSessionCookie } from "better-auth/cookies";
import { parseSessionOutput, parseUserOutput } from "better-auth/db";
import { ERROR_CODES, PLUGIN_ID } from "./constants";

export type TelegramIdentity = { id: number; username?: string };
export type TelegramProfile = {
  name?: string;
  email?: string;
  image?: string;
  [key: string]: unknown;
};

export function telegramAccountKey(id: number) {
  return {
    providerId: PLUGIN_ID,
    accountId: String(id),
    issuer: "local:oauth:telegram",
  };
}

export async function validateTelegramUser(
  ctx: GenericEndpointContext,
  user: Partial<User>,
  action: "sign-in" | "link-account",
  method: string
) {
  const validate = ctx.context.options.user?.validateUserInfo;
  if (!validate) return;
  let result: Awaited<ReturnType<typeof validate>>;
  try {
    result = await validate({ user, source: { action, method } }, ctx);
  } catch {
    throw new APIError("FORBIDDEN", {
      code: "validation_failed",
      message: "User validation failed",
    });
  }
  if (result?.error)
    throw new APIError("FORBIDDEN", {
      code: result.error,
      message: result.errorDescription || result.error,
    });
}

// Sensitive mutations must not accept a revoked session from the cookie cache.
export const telegramSessionMiddleware = createAuthMiddleware(async (ctx) => {
  ctx.context.session = null;
  const session = await getSessionFromCtx(ctx, { disableCookieCache: true });
  if (!session)
    throw APIError.from("UNAUTHORIZED", ERROR_CODES.NOT_AUTHENTICATED);
  const age = ctx.context.sessionConfig.freshAge;
  if (
    age !== 0 &&
    Date.now() - new Date(session.session.createdAt).getTime() >= age * 1000
  ) {
    throw new APIError("FORBIDDEN", {
      code: "SESSION_NOT_FRESH",
      message: "Session is not fresh",
    });
  }
  return { session };
});

export async function signInTelegram(
  ctx: GenericEndpointContext,
  identity: TelegramIdentity,
  mapped: TelegramProfile,
  allowSignup: boolean,
  method: string
) {
  const internal = ctx.context.internalAdapter;
  const key = telegramAccountKey(identity.id);
  const user = await runWithTransaction(ctx.context.adapter, async () => {
    const account = await internal.findAccountByKey(key);
    if (account) {
      const existing = await internal.findUserById(account.userId);
      if (!existing)
        throw APIError.from("UNAUTHORIZED", ERROR_CODES.INVALID_AUTHENTICATION);
      await validateTelegramUser(ctx, existing, "sign-in", method);
      return existing;
    }
    if (!allowSignup)
      throw APIError.from("FORBIDDEN", ERROR_CODES.USER_CREATION_DISABLED);
    // Older versions trusted this metadata as ownership. Require explicit linking instead.
    const metadataOwner = await (
      await getCurrentAdapter(ctx.context.adapter)
    ).findOne({
      model: "user",
      where: [{ field: "telegramId", value: String(identity.id) }],
    });
    if (metadataOwner)
      throw new APIError("CONFLICT", {
        code: "TELEGRAM_EXPLICIT_LINK_REQUIRED",
        message: "Sign in to the existing account and explicitly link Telegram",
      });
    // Never infer ownership from email or the denormalized user.telegramId field.
    const created = await internal.createUser(
      {
        ...mapped,
        id: undefined,
        name: mapped.name || "Telegram user",
        email: mapped.email || `${identity.id}@telegram.invalid`,
        emailVerified: false,
        telegramId: String(identity.id),
        telegramUsername: identity.username,
      },
      { method }
    );
    if (!created)
      throw APIError.from("FORBIDDEN", ERROR_CODES.USER_CREATION_DISABLED);
    const linked = await internal.createAccount({
      ...key,
      userId: created.id,
      telegramId: String(identity.id),
      telegramUsername: identity.username,
    });
    if (
      !linked ||
      linked.userId !== created.id ||
      linked.accountId !== key.accountId ||
      linked.providerId !== PLUGIN_ID
    ) {
      throw APIError.from("FORBIDDEN", ERROR_CODES.INVALID_AUTHENTICATION);
    }
    return created;
  });
  const session = await internal.createSession(user.id);
  if (!session || session.userId !== user.id)
    throw APIError.from("FORBIDDEN", ERROR_CODES.INVALID_AUTHENTICATION);
  await setSessionCookie(ctx, { session, user });
  return ctx.json({
    user: parseUserOutput(ctx.context.options, user),
    session: parseSessionOutput(ctx.context.options, session),
  });
}
