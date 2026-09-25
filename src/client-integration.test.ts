/** @vitest-environment node */
import { createAuthClient } from "better-auth/client";
import { expect, it } from "vitest";
import { telegramClient } from "./client";
import {
  cookies,
  miniAppData,
  origin,
  setup,
  widgetData,
} from "./test-helpers";

it("refreshes the session signal after custom actions, but not after a failed login", async () => {
  const { auth, credentialSession } = await setup();
  let cookie = cookies(await credentialSession());
  const client = createAuthClient({
    baseURL: origin,
    plugins: [telegramClient()],
    fetchOptions: {
      customFetchImpl: async (input, init) => {
        const request = new Request(input, init);
        request.headers.set("origin", origin);
        request.headers.set("cookie", cookie);
        const response = await auth.handler(request);
        if (response.headers.has("set-cookie")) cookie = cookies(response);
        return response;
      },
    },
  });
  const signal = client.$store.atoms.$sessionSignal!;
  const changed = async (action: () => Promise<unknown>) => {
    const before = signal.get();
    await action();
    expect(signal.get()).not.toBe(before);
  };
  await changed(() => client.linkTelegram(widgetData()));
  await changed(() => client.unlinkTelegram());
  await changed(() => client.signInWithTelegram(widgetData(222)));
  await changed(() => client.signInWithMiniApp(miniAppData(222).initData));
  const before = signal.get();
  await client.signInWithTelegram({ ...widgetData(), hash: "0".repeat(64) });
  expect(signal.get()).toBe(before);
});
