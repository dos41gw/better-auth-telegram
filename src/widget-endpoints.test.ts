/** @vitest-environment node */
import { describe, expect, it, vi } from "vitest";
import { cookies, setup, widgetData } from "./test-helpers";
import { getWidgetRateLimits } from "./widget-endpoints";

describe("Widget HTTP endpoints with SQLite", () => {
  it("creates a complete SQL user, account and session and reuses identity", async () => {
    const { request, rows } = await setup();
    const response = await request("/telegram/signin", widgetData());
    expect(response.status).toBe(200);
    const { user } = await response.json();
    expect(user).toMatchObject({
      name: "Alice",
      email: "111@telegram.invalid",
      emailVerified: false,
      telegramId: "111",
    });
    expect(
      (
        await (
          await request("/get-session", undefined, cookies(response))
        ).json()
      ).user.id
    ).toBe(user.id);
    expect((await request("/telegram/signin", widgetData())).status).toBe(200);
    expect(rows("user")).toHaveLength(1);
    expect(rows("account")).toHaveLength(1);
  });
  it.each([{}, null, { id: -1 }, { id: 1.5 }])(
    "rejects malformed data %j",
    async (body) => {
      const { request, rows } = await setup();
      expect((await request("/telegram/signin", body)).status).toBe(400);
      expect(rows("user")).toHaveLength(0);
    }
  );
  it.each(["signature", "expired", "future"])(
    "rejects %s authentication",
    async (failure) => {
      const { request, rows } = await setup();
      const data = widgetData(111, {
        auth_date:
          Math.floor(Date.now() / 1000) +
          (failure === "expired" ? -90000 : failure === "future" ? 300 : 0),
      });
      if (failure === "signature") data.hash = "0".repeat(64);
      expect((await request("/telegram/signin", data)).status).toBe(401);
      expect(rows("session")).toHaveLength(0);
    }
  );
  it("fails closed without bot credentials", async () => {
    const { request } = await setup({ botToken: "" });
    expect((await request("/telegram/signin", widgetData())).status).toBe(500);
  });
  it("honors signup prohibition", async () => {
    const { request, rows } = await setup({ autoCreateUser: false });
    expect((await request("/telegram/signin", widgetData())).status).toBe(403);
    expect(rows("user")).toHaveLength(0);
  });
  it("maps profiles but protects identity and verification status", async () => {
    const { request } = await setup({
      mapTelegramDataToUser: () => ({
        id: "injected",
        name: "Mapped",
        email: "mapped@example.com",
        emailVerified: true,
        telegramId: "other",
      }),
    });
    const response = await request("/telegram/signin", widgetData());
    expect(response.status).toBe(200);
    const { user } = await response.json();
    expect(user).toMatchObject({
      name: "Mapped",
      emailVerified: false,
      telegramId: "111",
    });
    expect(user.id).not.toBe("injected");
  });
  it.each(["/telegram/link", "/telegram/unlink"])(
    "requires authentication for %s",
    async (path) => {
      const { request } = await setup();
      expect((await request(path, widgetData())).status).toBe(401);
    }
  );
  it.each(["plugin", "core"])(
    "honors %s linking prohibition",
    async (source) => {
      const { request, credentialSession } = await setup(
        { allowUserToLink: source !== "plugin" },
        { account: { accountLinking: { enabled: source !== "core" } } }
      );
      expect(
        (
          await request(
            "/telegram/link",
            widgetData(),
            cookies(await credentialSession())
          )
        ).status
      ).toBe(403);
    }
  );
  it("links/unlinks with hooks, rejects conflicting and multiple links", async () => {
    const created = vi.fn();
    const deleted = vi.fn();
    const updated = vi.fn();
    const { request, rows, credentialSession } = await setup(
      {},
      {
        databaseHooks: {
          account: { create: { after: created }, delete: { after: deleted } },
          user: { update: { after: updated } },
        },
      }
    );
    const cookie = cookies(await credentialSession());
    expect((await request("/telegram/link", widgetData(), cookie)).status).toBe(
      200
    );
    expect(created).toHaveBeenCalledTimes(2);
    expect(updated).toHaveBeenCalled();
    expect((await request("/telegram/link", widgetData(), cookie)).status).toBe(
      409
    );
    expect(
      (await request("/telegram/link", widgetData(222), cookie)).status
    ).toBe(409);
    const other = cookies(await credentialSession("other@example.com"));
    expect((await request("/telegram/link", widgetData(), other)).status).toBe(
      409
    );
    expect((await request("/telegram/unlink", {}, cookie)).status).toBe(200);
    expect(deleted).toHaveBeenCalledTimes(1);
    expect(rows("user")[0]?.telegramId).toBeNull();
    expect((await request("/telegram/unlink", {}, cookie)).status).toBe(404);
  });
  it("requires explicit opt-in to unlink the last account", async () => {
    for (const allowUnlinkingAll of [false, true]) {
      const { request, rows } = await setup(
        {},
        { account: { accountLinking: { allowUnlinkingAll } } }
      );
      const cookie = cookies(await request("/telegram/signin", widgetData()));
      expect((await request("/telegram/unlink", {}, cookie)).status).toBe(
        allowUnlinkingAll ? 200 : 400
      );
      expect(rows("account")).toHaveLength(allowUnlinkingAll ? 0 : 1);
    }
  });
  it.each(["revoked", "stale"])(
    "rejects a %s session even with a valid cookie cache",
    async (reason) => {
      const { request, database } = await setup(
        {},
        { session: { cookieCache: { enabled: true } } }
      );
      const cookie = cookies(await request("/telegram/signin", widgetData()));
      if (reason === "revoked") database.exec('DELETE FROM "session"');
      else
        database
          .prepare('UPDATE "session" SET "createdAt" = ?')
          .run(Date.now() - 2 * 86400 * 1000);
      expect(
        (await request("/telegram/link", widgetData(222), cookie)).status
      ).toBe(reason === "revoked" ? 401 : 403);
    }
  );
  it("does not clear user metadata when a delete hook vetoes unlink", async () => {
    const { request, rows } = await setup(
      {},
      {
        account: { accountLinking: { allowUnlinkingAll: true } },
        databaseHooks: { account: { delete: { before: async () => false } } },
      }
    );
    const cookie = cookies(await request("/telegram/signin", widgetData()));
    expect((await request("/telegram/unlink", {}, cookie)).status).toBe(403);
    expect(rows("account")).toHaveLength(1);
    expect(rows("user")[0]?.telegramId).toBe("111");
  });
  it("enforces origin checks and plugin rate limits", async () => {
    const { request } = await setup(
      {},
      { rateLimit: { enabled: true, storage: "memory" } }
    );
    expect(
      (
        await request("/telegram/signin", widgetData(), undefined, {
          origin: "https://evil.example",
        })
      ).status
    ).toBe(403);
    let status = 0;
    for (let i = 0; i < 11; i++)
      status = (
        await request("/telegram/signin", widgetData(), undefined, {
          "x-forwarded-for": "203.0.113.77",
        })
      ).status;
    expect(status).toBe(429);
  });
  it("matches only the intended rate limit paths", () => {
    const rules = getWidgetRateLimits();
    for (const [i, path] of [
      "/telegram/signin",
      "/telegram/link",
      "/telegram/unlink",
    ].entries()) {
      expect(rules[i]!.pathMatcher(path)).toBe(true);
      expect(rules[i]!.pathMatcher("/other")).toBe(false);
    }
  });
});
