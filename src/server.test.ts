/** @vitest-environment node */

import { admin, customSession } from "better-auth/plugins";
import { describe, expect, it, vi } from "vitest";
import { cookies, miniAppData, setup, widgetData } from "./test-helpers";

describe("Better Auth security and provisioning contracts", () => {
  it.each(["user", "account", "session"])(
    "honors %s creation veto",
    async (model) => {
      const hook = vi.fn(async () => false as const);
      const { request, rows } = await setup(
        {},
        { databaseHooks: { [model]: { create: { before: hook } } } }
      );
      const response = await request("/telegram/signin", widgetData());
      expect(response.status).toBeGreaterThanOrEqual(400);
      expect(hook).toHaveBeenCalledTimes(1);
      expect(rows("session")).toHaveLength(0);
      if (model !== "session") expect(rows("user")).toHaveLength(0);
    }
  );
  it("executes user, account and session hooks for both HMAC methods", async () => {
    const user = vi.fn();
    const account = vi.fn();
    const session = vi.fn();
    const { request } = await setup(
      {},
      {
        databaseHooks: {
          user: { create: { after: user } },
          account: { create: { after: account } },
          session: { create: { after: session } },
        },
      }
    );
    expect((await request("/telegram/signin", widgetData())).status).toBe(200);
    expect(
      (await request("/telegram/miniapp/signin", miniAppData(222))).status
    ).toBe(200);
    for (const hook of [user, account, session])
      expect(hook).toHaveBeenCalledTimes(2);
  });
  it("applies validateUserInfo to creation, returning sign-in and linking", async () => {
    const calls: string[] = [];
    let deny = false;
    const { request, credentialSession, rows } = await setup(
      {},
      {
        user: {
          validateUserInfo: async ({ source }) => {
            calls.push(`${source.action}:${source.method}`);
            return deny ? { error: "blocked" } : undefined;
          },
        },
      }
    );
    expect((await request("/telegram/signin", widgetData())).status).toBe(200);
    expect(calls).toContain("create-user:telegram-widget");
    const cookie = cookies(await credentialSession());
    deny = true;
    expect((await request("/telegram/signin", widgetData())).status).toBe(403);
    expect(
      (await request("/telegram/link", widgetData(222), cookie)).status
    ).toBe(403);
    expect(
      (await request("/telegram/miniapp/signin", miniAppData(333))).status
    ).toBeGreaterThanOrEqual(400);
    expect(calls).toContain("sign-in:telegram-widget");
    expect(calls).toContain("link-account:telegram-widget");
    expect(calls).toContain("create-user:telegram-miniapp");
    expect(rows("user")).toHaveLength(2);
  });
  it("does not expose returned:false fields", async () => {
    const { request } = await setup(
      {},
      {
        user: {
          additionalFields: {
            privateNote: {
              type: "string",
              defaultValue: "private-user",
              returned: false,
            },
          },
        },
        session: {
          additionalFields: {
            privateNote: {
              type: "string",
              defaultValue: "private-session",
              returned: false,
            },
          },
        },
      }
    );
    const response = await request("/telegram/signin", widgetData());
    expect(response.status).toBe(200);
    const result = await response.json();
    expect(result.user.privateNote).toBeUndefined();
    expect(result.session.privateNote).toBeUndefined();
  });
  it("honors admin bans on returning users", async () => {
    const { request, database, rows } = await setup({}, { plugins: [admin()] });
    expect((await request("/telegram/signin", widgetData())).status).toBe(200);
    database.exec('UPDATE "user" SET "banned" = 1');
    expect((await request("/telegram/signin", widgetData())).status).toBe(403);
    expect(rows("session")).toHaveLength(1);
  });
  it("supports custom session output on get-session", async () => {
    const { request } = await setup(
      {},
      {
        plugins: [
          customSession(async ({ user, session }) => ({
            user,
            session,
            customValue: "present",
          })),
        ],
      }
    );
    const response = await request("/telegram/signin", widgetData());
    expect(
      (
        await (
          await request("/get-session", undefined, cookies(response))
        ).json()
      ).customValue
    ).toBe("present");
  });
  it("stores/restores sessions in secondary storage", async () => {
    const store = new Map<string, string>();
    const { request } = await setup(
      {},
      {
        secondaryStorage: {
          get: async (key) => store.get(key) ?? null,
          getAndDelete: async (key) => {
            const value = store.get(key);
            store.delete(key);
            return value ?? null;
          },
          increment: async (key) => {
            const value = Number(store.get(key) ?? 0) + 1;
            store.set(key, String(value));
            return value;
          },
          set: async (key, value) => {
            store.set(key, value);
          },
          delete: async (key) => {
            store.delete(key);
          },
        },
      }
    );
    const response = await request("/telegram/signin", widgetData());
    expect(response.status).toBe(200);
    expect(store.size).toBeGreaterThan(0);
    expect(
      (
        await (
          await request("/get-session", undefined, cookies(response))
        ).json()
      ).user.telegramId
    ).toBe("111");
  });
  it("never authenticates by denormalized telegramId or a mapped email", async () => {
    const { request, database, rows, credentialSession } = await setup({
      mapTelegramDataToUser: () => ({ email: "existing@example.com" }),
    });
    const owner = await credentialSession();
    expect(owner.status).toBe(200);
    database.prepare('UPDATE "user" SET "telegramId" = ?').run("111");
    const response = await request("/telegram/signin", widgetData());
    expect(response.status).toBeGreaterThanOrEqual(400);
    expect(response.headers.has("set-cookie")).toBe(false);
    expect(rows("account")).toHaveLength(1);
    expect(rows("session")).toHaveLength(1);
  });
  it("database uniqueness prevents duplicate Telegram accounts", async () => {
    const { request, rows } = await setup();
    await Promise.all([
      request("/telegram/signin", widgetData()),
      request("/telegram/miniapp/signin", miniAppData()),
    ]);
    expect(rows("user")).toHaveLength(1);
    expect(rows("account")).toHaveLength(1);
  });
});

it("fails closed when a returning-user validation hook throws", async () => {
  let reject = false;
  const { request, rows } = await setup(
    {},
    {
      user: {
        validateUserInfo: async () => {
          if (reject) throw new Error("denied");
        },
      },
    }
  );
  expect((await request("/telegram/signin", widgetData())).status).toBe(200);
  reject = true;
  expect((await request("/telegram/signin", widgetData())).status).toBe(403);
  expect(rows("session")).toHaveLength(1);
});

it("rolls back a link when the user-update hook vetoes it", async () => {
  const { request, rows, credentialSession } = await setup(
    {},
    { databaseHooks: { user: { update: { before: async () => false } } } }
  );
  const cookie = cookies(await credentialSession());
  expect((await request("/telegram/link", widgetData(), cookie)).status).toBe(
    403
  );
  expect(rows("account")).toHaveLength(1);
  expect(rows("user")[0]?.telegramId).toBeNull();
});
