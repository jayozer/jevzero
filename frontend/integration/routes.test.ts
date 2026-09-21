import assert from "node:assert/strict";
import { test } from "node:test";
import { createServer, request as httpRequest } from "node:http";
import { spawn } from "node:child_process";
import { once } from "node:events";

test(
  "local bootstrap, credential saving, CSRF and proxy boundaries",
  { timeout: 60000 },
  async () => {
    const token = "test-backend-token-".repeat(3),
      calls: string[] = [];
    const upstream = createServer(async (req, res) => {
      assert.equal(req.headers.authorization, `Bearer ${token}`);
      calls.push(req.url || "");
      let text = "";
      for await (const chunk of req) text += chunk;
      res.setHeader("Content-Type", "application/json");
      if (req.url === "/connect") {
        res.end(
          JSON.stringify({
            url: "https://accounts.google.com/o/oauth2/auth?state=synthetic-state",
            state: "synthetic-state",
          }),
        );
        return;
      }
      if (req.url === "/state") {
        res.end(
          JSON.stringify({
            mode: "gmail",
            messages: [],
            account: "synthetic@example.com",
          }),
        );
        return;
      }
      if (req.url === "/credentials") {
        assert.equal(JSON.parse(text).typesafe_key, "synthetic-key");
        res.end(JSON.stringify({ typesafe: true, google: false }));
        return;
      }
      if (req.url === "/commands/review") {
        res.statusCode = 202;
        res.end(JSON.stringify({ id: "a".repeat(32), status: "queued" }));
        return;
      }
      res.statusCode = 404;
      res.end("{}");
    });
    upstream.listen(0, "127.0.0.1");
    await once(upstream, "listening");
    const port = (upstream.address() as { port: number }).port,
      origin = "http://127.0.0.1:3011";
    const child = spawn(
      process.execPath,
      [
        "node_modules/next/dist/bin/next",
        "dev",
        "--webpack",
        "--hostname",
        "127.0.0.1",
        "--port",
        "3011",
      ],
      {
        env: {
          ...process.env,
          NODE_ENV: "development",
          WATCHPACK_POLLING: "true",
          JEVZERO_LOCAL_MODE: "1",
          JEVZERO_BACKEND_URL: `http://127.0.0.1:${port}`,
          JEVZERO_BACKEND_TOKEN: token,
          JEVZERO_SESSION_SECRET: "signing-test-only-".repeat(3),
          JEVZERO_APP_ORIGIN: origin,
        },
        stdio: ["ignore", "pipe", "pipe"],
      },
    );
    let output = "";
    child.stdout.on("data", (x) => (output += x));
    child.stderr.on("data", (x) => (output += x));
    try {
      let ready = false;
      for (let i = 0; i < 100; i++) {
        try {
          const r = await fetch(origin + "/api/session");
          if (r.ok) {
            ready = true;
            break;
          }
        } catch {}
        await new Promise((r) => setTimeout(r, 200));
      }
      assert.ok(ready, output.slice(-3000));
      const post = (
        path: string,
        body: unknown,
        cookie = "",
        requestOrigin = origin,
      ) =>
        fetch(origin + path, {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
            origin: requestOrigin,
            cookie,
          },
          body: JSON.stringify(body),
          redirect: "manual",
        });
      assert.equal((await fetch(origin + "/api/backend/state")).status, 401);
      assert.equal(
        (
          await fetch(origin + "/api/session", {
            headers: { origin: "https://attacker.example" },
          })
        ).status,
        403,
      );
      const rebindingStatus = await new Promise<number>((resolve) => {
        const req = httpRequest(
          origin + "/api/session",
          { headers: { host: "rebinding.example:3011" } },
          (res) => {
            res.resume();
            resolve(res.statusCode!);
          },
        );
        req.end();
      });
      assert.equal(rebindingStatus, 403);
      assert.equal(
        (
          await fetch(origin + "/api/session", {
            headers: { "sec-fetch-site": "cross-site" },
          })
        ).status,
        403,
      );
      assert.equal(
        (await post("/api/session", { password: "anything" })).status,
        405,
      );
      const bootstrap = await fetch(origin + "/api/session");
      assert.equal(bootstrap.status, 200);
      const setCookie = bootstrap.headers.get("set-cookie")!;
      assert.match(setCookie, /HttpOnly/i);
      assert.match(setCookie, /SameSite=lax/i);
      const cookie = setCookie.split(";")[0];
      assert.ok(!cookie.includes(token));
      const state = await fetch(origin + "/api/backend/state", {
        headers: { cookie },
      });
      assert.equal(state.status, 200);
      assert.equal((await state.json()).account, "synthetic@example.com");
      assert.equal(
        (await fetch(origin + "/api/backend/auth", { headers: { cookie } }))
          .status,
        404,
      );
      assert.equal(
        (await post("/api/backend/commands/mode", {}, cookie)).status,
        404,
      );
      assert.equal(
        (
          await post(
            "/api/backend/commands/review",
            {},
            cookie,
            "https://attacker.example",
          )
        ).status,
        403,
      );
      const saved = await post(
        "/api/backend/credentials",
        { typesafe_key: "synthetic-key" },
        cookie,
      );
      assert.deepEqual(await saved.json(), { typesafe: true, google: false });
      assert.equal(
        (
          await post(
            "/api/backend/commands/review",
            { id: "synthetic" },
            cookie,
          )
        ).status,
        202,
      );
      const oauth = await post("/api/backend/connect", {}, cookie);
      assert.equal(oauth.status, 200);
      assert.match(
        oauth.headers.get("set-cookie")!,
        /jevzero-oauth=synthetic-state/,
      );
      const before = calls.length;
      assert.equal(
        (
          await post(
            "/api/backend/credentials",
            { typesafe_key: "x".repeat(17000) },
            cookie,
          )
        ).status,
        502,
      );
      assert.equal(calls.length, before);
      assert.equal(calls.filter((x) => x === "/commands/review").length, 1);
    } finally {
      if (child.exitCode === null) {
        child.kill("SIGTERM");
        await once(child, "exit");
      }
      await new Promise<void>((resolve) => upstream.close(() => resolve()));
    }
  },
);
