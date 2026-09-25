import {
  APIError,
  createAuthEndpoint,
  formCsrfMiddleware,
} from "better-auth/api";
import { signInTelegram } from "./authentication";
import { ERROR_CODES } from "./constants";
import type { TelegramPluginConfig } from "./plugin-config";
import {
  parseMiniAppInitData,
  validateMiniAppData,
  verifyMiniAppInitData,
} from "./verify";

/**
 * Creates the Mini App endpoints: signIn, validate.
 */
export function createMiniAppEndpoints(config: TelegramPluginConfig) {
  return {
    signInWithMiniApp: createAuthEndpoint(
      "/telegram/miniapp/signin",
      {
        method: "POST",
        use: [formCsrfMiddleware],
      },
      async (ctx) => {
        const body = await ctx.body;
        const initData = body?.initData;

        if (!initData || typeof initData !== "string") {
          throw APIError.from("BAD_REQUEST", ERROR_CODES.INIT_DATA_REQUIRED);
        }

        if (!config.botToken) {
          throw APIError.from(
            "INTERNAL_SERVER_ERROR",
            ERROR_CODES.BOT_TOKEN_REQUIRED
          );
        }

        // Verify initData
        if (
          !(await verifyMiniAppInitData(
            initData,
            config.botToken,
            config.maxAuthAge
          ))
        ) {
          throw APIError.from(
            "UNAUTHORIZED",
            ERROR_CODES.INVALID_MINI_APP_INIT_DATA
          );
        }

        // Parse initData
        const data = parseMiniAppInitData(initData);

        // Validate structure
        if (!validateMiniAppData(data)) {
          throw APIError.from(
            "BAD_REQUEST",
            ERROR_CODES.INVALID_MINI_APP_DATA_STRUCTURE
          );
        }

        if (!data.user) {
          throw APIError.from("BAD_REQUEST", ERROR_CODES.NO_USER_IN_INIT_DATA);
        }

        const miniAppUser = data.user;

        // Map Mini App user data to user object
        const defaultUserData = {
          name: miniAppUser.last_name
            ? `${miniAppUser.first_name} ${miniAppUser.last_name}`
            : miniAppUser.first_name,
          image: miniAppUser.photo_url,
          email: undefined, // Telegram doesn't provide email
        };

        const userData = config.mapMiniAppDataToUser
          ? config.mapMiniAppDataToUser(miniAppUser)
          : defaultUserData;

        return signInTelegram(
          ctx,
          miniAppUser,
          userData,
          config.autoCreateUser && config.miniAppAllowAutoSignin,
          "telegram-miniapp"
        );
      }
    ),

    validateMiniApp: createAuthEndpoint(
      "/telegram/miniapp/validate",
      {
        method: "POST",
      },
      async (ctx) => {
        const body = await ctx.body;
        const initData = body?.initData;

        if (!initData || typeof initData !== "string") {
          throw APIError.from("BAD_REQUEST", ERROR_CODES.INIT_DATA_REQUIRED);
        }

        if (!config.botToken) {
          throw APIError.from(
            "INTERNAL_SERVER_ERROR",
            ERROR_CODES.BOT_TOKEN_REQUIRED
          );
        }

        const isValid = await verifyMiniAppInitData(
          initData,
          config.botToken,
          config.maxAuthAge
        );

        if (!isValid) {
          return ctx.json({
            valid: false,
            data: null,
          });
        }

        const data = parseMiniAppInitData(initData);

        return ctx.json({
          valid: validateMiniAppData(data),
          data: validateMiniAppData(data) ? data : null,
        });
      }
    ),
  };
}

/**
 * Rate limit rules for Mini App endpoints.
 */
export function getMiniAppRateLimits() {
  return [
    {
      pathMatcher: (path: string) => path === "/telegram/miniapp/signin",
      window: 60,
      max: 10,
    },
    {
      pathMatcher: (path: string) => path === "/telegram/miniapp/validate",
      window: 60,
      max: 20,
    },
  ];
}
