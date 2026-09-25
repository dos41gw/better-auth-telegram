/** @vitest-environment node */
import { describe, expect, it } from "vitest";
import { getMiniAppRateLimits } from "./miniapp-endpoints";
import { cookies, miniAppData, setup, widgetData } from "./test-helpers";

describe("Mini App HTTP endpoints with SQLite", () => {
  it("shares a verified numeric account with Widget and restores the session", async () => {
    const { request, rows } = await setup();
    const first = await request("/telegram/signin", widgetData());
    const response = await request("/telegram/miniapp/signin", miniAppData());
    expect(response.status).toBe(200);
    expect((await response.json()).user.id).toBe((await first.json()).user.id);
    expect(
      (
        await (
          await request("/get-session", undefined, cookies(response))
        ).json()
      ).user.telegramId
    ).toBe("111");
    expect(rows("user")).toHaveLength(1);
    expect(rows("account")).toHaveLength(1);
  });
  it("maps a new user's profile", async () => {
    const { request } = await setup({
      miniApp: {
        enabled: true,
        mapMiniAppDataToUser: () => ({
          name: "Mapped Mini",
          email: "mini@example.com",
        }),
      },
    });
    const response = await request("/telegram/miniapp/signin", miniAppData());
    expect(response.status).toBe(200);
    expect((await response.json()).user.name).toBe("Mapped Mini");
  });
  it.each([{}, null, { initData: 42 }])(
    "rejects missing initData %j",
    async (body) => {
      const { request } = await setup();
      for (const path of ["signin", "validate"])
        expect((await request(`/telegram/miniapp/${path}`, body)).status).toBe(
          400
        );
    }
  );
  it("cannot disable signature verification", async () => {
    await expect(() =>
      setup({ miniApp: { enabled: true, validateInitData: false } })
    ).rejects.toThrow("cannot be disabled");
  });
  it.each(["signature", "future", "duplicate", "expired"])(
    "rejects %s initData",
    async (reason) => {
      const { request, rows } = await setup();
      const body = miniAppData(
        111,
        reason === "future"
          ? { auth_date: String(Math.floor(Date.now() / 1000) + 300) }
          : reason === "expired"
            ? { auth_date: "1" }
            : {}
      );
      if (reason === "signature")
        body.initData = body.initData.replace(/hash=./, "hash=z");
      if (reason === "duplicate") body.initData += "&auth_date=1";
      expect((await request("/telegram/miniapp/signin", body)).status).toBe(
        401
      );
      expect(
        await (await request("/telegram/miniapp/validate", body)).json()
      ).toEqual({ valid: false, data: null });
      expect(rows("session")).toHaveLength(0);
    }
  );
  it.each(["null", '{"id":1.5,"first_name":"A"}', "{}"])(
    "rejects signed malformed user %s",
    async (user) => {
      const { request } = await setup();
      const body = miniAppData(111, { user });
      expect((await request("/telegram/miniapp/signin", body)).status).toBe(
        400
      );
      expect(
        await (await request("/telegram/miniapp/validate", body)).json()
      ).toEqual({ valid: false, data: null });
    }
  );
  it("validates signed initData without creating an account", async () => {
    const { request, rows } = await setup();
    expect(
      (
        await (
          await request("/telegram/miniapp/validate", miniAppData())
        ).json()
      ).valid
    ).toBe(true);
    expect(rows("user")).toHaveLength(0);
  });
  it.each(["global", "miniapp"])(
    "honors %s automatic signup prohibition",
    async (source) => {
      const { request } = await setup({
        autoCreateUser: source !== "global",
        miniApp: { enabled: true, allowAutoSignin: source !== "miniapp" },
      });
      expect(
        (await request("/telegram/miniapp/signin", miniAppData())).status
      ).toBe(403);
    }
  );
  it("fails closed without bot credentials", async () => {
    const { request } = await setup({ botToken: "" });
    for (const path of ["signin", "validate"])
      expect(
        (await request(`/telegram/miniapp/${path}`, miniAppData())).status
      ).toBe(500);
  });
  it("matches only intended rate limit paths", () => {
    for (const [i, path] of [
      "/telegram/miniapp/signin",
      "/telegram/miniapp/validate",
    ].entries()) {
      expect(getMiniAppRateLimits()[i]!.pathMatcher(path)).toBe(true);
      expect(getMiniAppRateLimits()[i]!.pathMatcher("/other")).toBe(false);
    }
  });
});
