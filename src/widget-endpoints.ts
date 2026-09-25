import { runWithTransaction } from "@better-auth/core/context";
import {
  APIError,
  createAuthEndpoint,
  formCsrfMiddleware,
} from "better-auth/api";
import { setSessionCookie } from "better-auth/cookies";
import {
  signInTelegram,
  telegramAccountKey,
  telegramSessionMiddleware,
  validateTelegramUser,
} from "./authentication";
import { ERROR_CODES, PLUGIN_ID, SUCCESS_MESSAGES } from "./constants";
import type { TelegramPluginConfig } from "./plugin-config";
import type { TelegramAccountRecord, TelegramAuthData } from "./types";
import { validateTelegramAuthData, verifyTelegramAuth } from "./verify";

/**
 * Creates the Login Widget endpoints: signIn, link, unlink.
 */
export function createWidgetEndpoints(config: TelegramPluginConfig) {
  return {
    signInWithTelegram: createAuthEndpoint(
      "/telegram/signin",
      {
        method: "POST",
        use: [formCsrfMiddleware],
      },
      async (ctx) => {
        if (!config.botToken) {
          throw APIError.from(
            "INTERNAL_SERVER_ERROR",
            ERROR_CODES.BOT_TOKEN_REQUIRED
          );
        }

        const body = await ctx.body;

        // Validate auth data structure
        if (!validateTelegramAuthData(body)) {
          throw APIError.from("BAD_REQUEST", ERROR_CODES.INVALID_AUTH_DATA);
        }

        const telegramData = body as TelegramAuthData;

        // Verify authentication
        const isValid = await verifyTelegramAuth(
          telegramData,
          config.botToken,
          config.maxAuthAge
        );

        if (!isValid) {
          throw APIError.from(
            "UNAUTHORIZED",
            ERROR_CODES.INVALID_AUTHENTICATION
          );
        }

        // Map Telegram data to user
        const defaultUserData = {
          name: telegramData.last_name
            ? `${telegramData.first_name} ${telegramData.last_name}`
            : telegramData.first_name,
          image: telegramData.photo_url,
          email: undefined, // Telegram doesn't provide email
        };

        const userData = config.mapTelegramDataToUser
          ? config.mapTelegramDataToUser(telegramData)
          : defaultUserData;

        return signInTelegram(
          ctx,
          telegramData,
          userData,
          config.autoCreateUser,
          "telegram-widget"
        );
      }
    ),

    linkTelegram: createAuthEndpoint(
      "/telegram/link",
      {
        method: "POST",
        use: [telegramSessionMiddleware],
      },
      async (ctx) => {
        if (
          !config.allowUserToLink ||
          ctx.context.options.account?.accountLinking?.enabled === false
        ) {
          throw APIError.from("FORBIDDEN", ERROR_CODES.LINKING_DISABLED);
        }

        const body = await ctx.body;
        const session = ctx.context.session;

        if (!session?.user?.id) {
          throw APIError.from("UNAUTHORIZED", ERROR_CODES.NOT_AUTHENTICATED);
        }

        if (!config.botToken) {
          throw APIError.from(
            "INTERNAL_SERVER_ERROR",
            ERROR_CODES.BOT_TOKEN_REQUIRED
          );
        }

        // Validate auth data
        if (!validateTelegramAuthData(body)) {
          throw APIError.from("BAD_REQUEST", ERROR_CODES.INVALID_AUTH_DATA);
        }

        const telegramData = body as TelegramAuthData;

        // Verify authentication
        const isValid = await verifyTelegramAuth(
          telegramData,
          config.botToken,
          config.maxAuthAge
        );

        if (!isValid) {
          throw APIError.from(
            "UNAUTHORIZED",
            ERROR_CODES.INVALID_AUTHENTICATION
          );
        }

        // Check if Telegram account is already linked to another user
        const existingAccount = await ctx.context.adapter.findOne({
          model: "account",
          where: [
            {
              field: "providerId",
              value: PLUGIN_ID,
            },
            {
              field: "accountId",
              value: telegramData.id.toString(),
            },
          ],
        });

        if (
          existingAccount &&
          (existingAccount as TelegramAccountRecord).userId !== session.user.id
        ) {
          throw APIError.from(
            "CONFLICT",
            ERROR_CODES.TELEGRAM_ALREADY_LINKED_OTHER
          );
        }

        if (existingAccount) {
          throw APIError.from(
            "CONFLICT",
            ERROR_CODES.TELEGRAM_ALREADY_LINKED_SELF
          );
        }

        const accounts = await ctx.context.internalAdapter.findAccounts(
          session.user.id
        );
        if (accounts.some((account) => account.providerId === PLUGIN_ID)) {
          throw APIError.from(
            "CONFLICT",
            ERROR_CODES.TELEGRAM_ALREADY_LINKED_SELF
          );
        }
        await validateTelegramUser(
          ctx,
          session.user,
          "link-account",
          "telegram-widget"
        );
        const user = await runWithTransaction(ctx.context.adapter, async () => {
          const account = await ctx.context.internalAdapter.createAccount({
            ...telegramAccountKey(telegramData.id),
            userId: session.user.id,
            telegramId: String(telegramData.id),
            telegramUsername: telegramData.username,
          });
          if (
            !account ||
            account.userId !== session.user.id ||
            account.accountId !== String(telegramData.id)
          ) {
            throw APIError.from(
              "FORBIDDEN",
              ERROR_CODES.INVALID_AUTHENTICATION
            );
          }
          const updated = await ctx.context.internalAdapter.updateUser(
            session.user.id,
            {
              telegramId: String(telegramData.id),
              telegramUsername: telegramData.username,
            }
          );
          if (!updated)
            throw APIError.from(
              "FORBIDDEN",
              ERROR_CODES.INVALID_AUTHENTICATION
            );
          return updated;
        });
        await setSessionCookie(ctx, { session: session.session, user });

        return ctx.json({
          success: true,
          message: SUCCESS_MESSAGES.TELEGRAM_LINKED,
        });
      }
    ),

    unlinkTelegram: createAuthEndpoint(
      "/telegram/unlink",
      {
        method: "POST",
        use: [telegramSessionMiddleware],
      },
      async (ctx) => {
        const session = ctx.context.session;

        if (!session?.user?.id) {
          throw APIError.from("UNAUTHORIZED", ERROR_CODES.NOT_AUTHENTICATED);
        }

        // Find and delete Telegram account
        const account = await ctx.context.adapter.findOne({
          model: "account",
          where: [
            {
              field: "userId",
              value: session.user.id,
            },
            {
              field: "providerId",
              value: PLUGIN_ID,
            },
          ],
        });

        if (!account) {
          throw APIError.from("NOT_FOUND", ERROR_CODES.NOT_LINKED);
        }

        const accounts = await ctx.context.internalAdapter.findAccounts(
          session.user.id
        );
        if (
          accounts.length <= 1 &&
          !ctx.context.options.account?.accountLinking?.allowUnlinkingAll
        ) {
          throw new APIError("BAD_REQUEST", {
            code: "FAILED_TO_UNLINK_LAST_ACCOUNT",
            message: "Cannot unlink the last account",
          });
        }
        const user = await runWithTransaction(ctx.context.adapter, async () => {
          await ctx.context.internalAdapter.deleteAccount(
            (account as TelegramAccountRecord).id
          );
          const remaining = await ctx.context.internalAdapter.findAccounts(
            session.user.id
          );
          if (
            remaining.some(
              (item) => item.id === (account as TelegramAccountRecord).id
            )
          ) {
            throw APIError.from(
              "FORBIDDEN",
              ERROR_CODES.INVALID_AUTHENTICATION
            );
          }
          const updated = await ctx.context.internalAdapter.updateUser(
            session.user.id,
            {
              telegramId: null,
              telegramUsername: null,
            }
          );
          if (!updated)
            throw APIError.from(
              "FORBIDDEN",
              ERROR_CODES.INVALID_AUTHENTICATION
            );
          return updated;
        });
        await setSessionCookie(ctx, { session: session.session, user });

        return ctx.json({
          success: true,
          message: SUCCESS_MESSAGES.TELEGRAM_UNLINKED,
        });
      }
    ),
  };
}

/**
 * Rate limit rules for Login Widget endpoints.
 */
export function getWidgetRateLimits() {
  return [
    {
      pathMatcher: (path: string) => path === "/telegram/signin",
      window: 60,
      max: 10,
    },
    {
      pathMatcher: (path: string) => path === "/telegram/link",
      window: 60,
      max: 5,
    },
    {
      pathMatcher: (path: string) => path === "/telegram/unlink",
      window: 60,
      max: 5,
    },
  ];
}
