//#region src/client.ts
/**
* Telegram Login Widget script URL
*/
const TELEGRAM_WIDGET_SCRIPT = "https://telegram.org/js/telegram-widget.js?22";
/**
* Helper to load Telegram Widget script
*/
function loadTelegramWidgetScript() {
	return new Promise((resolve, reject) => {
		if (window.Telegram?.Login) {
			resolve();
			return;
		}
		const script = document.createElement("script");
		script.src = TELEGRAM_WIDGET_SCRIPT;
		script.async = true;
		script.onload = () => resolve();
		script.onerror = () => reject(/* @__PURE__ */ new Error("Failed to load Telegram widget script"));
		document.head.appendChild(script);
	});
}
function requireBotUsername(botUsername) {
	if (!botUsername) throw new Error("Telegram plugin: botUsername is required");
	return botUsername;
}
function getMiniAppInitData() {
	const sdkInitData = window.Telegram?.WebApp?.initData;
	if (sdkInitData) return sdkInitData;
	try {
		const hash = window.location.hash;
		if (!hash) return;
		return new URLSearchParams(hash.slice(1)).get("tgWebAppData") || void 0;
	} catch {
		return;
	}
}
/**
* Client plugin for Telegram authentication
*/
const telegramClient = () => {
	return {
		id: "telegram",
		$InferServerPlugin: {},
		atomListeners: [{
			matcher: (path) => [
				"/telegram/signin",
				"/telegram/miniapp/signin",
				"/telegram/link",
				"/telegram/unlink"
			].includes(path),
			signal: "$sessionSignal"
		}],
		getActions: (baseFetch, $store) => {
			const $fetch = async (path, options) => {
				const result = await baseFetch(path, options);
				if (result && !result.error && ([
					"/telegram/signin",
					"/telegram/miniapp/signin",
					"/telegram/link",
					"/telegram/unlink"
				].includes(String(path)) || path === "/sign-in/social" && options?.body?.idToken)) $store?.notify("$sessionSignal");
				return result;
			};
			return {
				/**
				* Sign in with Telegram
				* @param authData - Authentication data from Telegram Login Widget
				* @param fetchOptions - Optional fetch options (e.g., custom headers, cache control)
				*/
				signInWithTelegram: async (authData, fetchOptions) => {
					return await $fetch("/telegram/signin", {
						method: "POST",
						body: authData,
						...fetchOptions
					});
				},
				/**
				* Link current user account with Telegram
				* @param authData - Authentication data from Telegram Login Widget
				* @param fetchOptions - Optional fetch options (e.g., custom headers, cache control)
				*/
				linkTelegram: async (authData, fetchOptions) => {
					return await $fetch("/telegram/link", {
						method: "POST",
						body: authData,
						...fetchOptions
					});
				},
				/**
				* Unlink Telegram account from current user
				* @param fetchOptions - Optional fetch options (e.g., custom headers, cache control)
				*/
				unlinkTelegram: async (fetchOptions) => {
					return await $fetch("/telegram/unlink", {
						method: "POST",
						...fetchOptions
					});
				},
				/**
				* Get Telegram bot configuration
				* @param fetchOptions - Optional fetch options (e.g., custom headers, cache control)
				*/
				getTelegramConfig: async (fetchOptions) => {
					return await $fetch("/telegram/config", {
						method: "GET",
						...fetchOptions
					});
				},
				/**
				* Initialize Telegram Login Widget
				* This function creates a Telegram login button and handles the authentication flow
				*
				* @param containerId - ID of the container element where the widget will be rendered
				* @param options - Widget configuration options
				* @param onAuth - Callback function called when user successfully authenticates
				*
				* @example
				* ```ts
				* await initTelegramWidget("telegram-login-container", {
				*   size: "large",
				*   showUserPhoto: true
				* }, async (authData) => {
				*   const result = await signInWithTelegram(authData);
				*   console.log("Signed in:", result);
				* });
				* ```
				*/
				initTelegramWidget: async (containerId, options = {}, onAuth) => {
					await loadTelegramWidgetScript();
					const configResponse = await $fetch("/telegram/config", { method: "GET" });
					if (!configResponse.data) throw new Error("Failed to get Telegram config");
					const config = configResponse.data;
					const botUsername = requireBotUsername(config.botUsername);
					const { size = "large", showUserPhoto = true, cornerRadius = 20, requestAccess = false, lang } = options;
					const container = document.getElementById(containerId);
					if (!container) throw new Error(`Container with id "${containerId}" not found`);
					container.innerHTML = "";
					const callbackName = `telegramCallback_${Date.now()}`;
					window[callbackName] = (authData) => {
						onAuth(authData);
						delete window[callbackName];
					};
					const script = document.createElement("script");
					script.src = TELEGRAM_WIDGET_SCRIPT;
					script.async = true;
					script.setAttribute("data-telegram-login", botUsername);
					script.setAttribute("data-size", size);
					script.setAttribute("data-userpic", showUserPhoto.toString());
					script.setAttribute("data-radius", cornerRadius.toString());
					script.setAttribute("data-onauth", `${callbackName}(user)`);
					if (requestAccess) script.setAttribute("data-request-access", "write");
					if (lang) script.setAttribute("data-lang", lang);
					container.appendChild(script);
				},
				/**
				* Alternative method: Use Telegram Login with redirect
				*
				* @param redirectUrl - URL to redirect after successful authentication
				* @param options - Widget configuration options
				*
				* @example
				* ```ts
				* await initTelegramWidgetRedirect(
				*   "/auth/telegram/callback",
				*   { size: "medium" }
				* );
				* ```
				*/
				initTelegramWidgetRedirect: async (containerId, redirectUrl, options = {}) => {
					await loadTelegramWidgetScript();
					const configResponse = await $fetch("/telegram/config", { method: "GET" });
					if (!configResponse.data) throw new Error("Failed to get Telegram config");
					const config = configResponse.data;
					const botUsername = requireBotUsername(config.botUsername);
					const { size = "large", showUserPhoto = true, cornerRadius = 20, requestAccess = false, lang } = options;
					const container = document.getElementById(containerId);
					if (!container) throw new Error(`Container with id "${containerId}" not found`);
					container.innerHTML = "";
					const script = document.createElement("script");
					script.src = TELEGRAM_WIDGET_SCRIPT;
					script.async = true;
					script.setAttribute("data-telegram-login", botUsername);
					script.setAttribute("data-size", size);
					script.setAttribute("data-userpic", showUserPhoto.toString());
					script.setAttribute("data-radius", cornerRadius.toString());
					script.setAttribute("data-auth-url", redirectUrl);
					if (requestAccess) script.setAttribute("data-request-access", "write");
					if (lang) script.setAttribute("data-lang", lang);
					container.appendChild(script);
				},
				/**
				* Sign in with Telegram Mini App
				* @param initData - Raw initData string from Telegram.WebApp.initData
				*
				* @example
				* ```ts
				* // Inside a Telegram Mini App
				* const initData = window.Telegram.WebApp.initData;
				* const result = await signInWithMiniApp(initData);
				* console.log("Signed in:", result);
				* ```
				*/
				signInWithMiniApp: async (initData, fetchOptions) => {
					return await $fetch("/telegram/miniapp/signin", {
						method: "POST",
						body: { initData },
						...fetchOptions
					});
				},
				/**
				* Validate Telegram Mini App initData
				* @param initData - Raw initData string from Telegram.WebApp.initData
				* @returns Object with valid status and parsed data if valid
				*
				* @example
				* ```ts
				* const initData = window.Telegram.WebApp.initData;
				* const result = await validateMiniApp(initData);
				* if (result.data?.valid) {
				*   console.log("User:", result.data.data?.user);
				* }
				* ```
				*/
				validateMiniApp: async (initData, fetchOptions) => {
					return await $fetch("/telegram/miniapp/validate", {
						method: "POST",
						body: { initData },
						...fetchOptions
					});
				},
				/**
				* Auto sign-in from Telegram Mini App
				* Automatically retrieves initData from Telegram.WebApp and signs in
				* Only works when running inside a Telegram Mini App
				*
				* @example
				* ```ts
				* // Auto-signin when Mini App launches
				* try {
				*   const result = await autoSignInFromMiniApp();
				*   console.log("Auto signed in:", result);
				* } catch (error) {
				*   console.error("Not running in Mini App or auth failed");
				* }
				* ```
				*/
				autoSignInFromMiniApp: async (fetchOptions) => {
					if (typeof window === "undefined") throw new Error("This method can only be called in browser");
					const initData = getMiniAppInitData();
					if (!initData) throw new Error("Not running in Telegram Mini App or initData not available");
					return await $fetch("/telegram/miniapp/signin", {
						method: "POST",
						body: { initData },
						...fetchOptions
					});
				},
				/**
				* Sign in with Telegram OIDC (OpenID Connect)
				* Initiates the standard OAuth 2.0 Authorization Code flow with PKCE
				* via oauth.telegram.org. Requires `oidc.enabled: true` on the server.
				*
				* @param options - Callback URLs for redirect after authentication
				* @param fetchOptions - Optional fetch options
				*
				* @example
				* ```ts
				* await authClient.signInWithTelegramOIDC({
				*   callbackURL: "/dashboard",
				* });
				* ```
				*/
				signInWithTelegramOIDC: async (options, fetchOptions) => {
					return await $fetch("/sign-in/social", {
						method: "POST",
						body: {
							...options,
							provider: "telegram-oidc",
							callbackURL: options?.callbackURL,
							errorCallbackURL: options?.errorCallbackURL
						},
						...fetchOptions
					});
				}
			};
		}
	};
};
//#endregion
export { telegramClient as default, telegramClient };

//# sourceMappingURL=client.js.map