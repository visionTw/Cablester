import test from "node:test";
import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { createServer } from "node:net";
import { request } from "node:http";
import { fileURLToPath } from "node:url";

const root = fileURLToPath(new URL("..", import.meta.url));

async function availablePort() {
  const probe = createServer();
  await new Promise((resolve, reject) => {
    probe.once("error", reject);
    probe.listen(0, "127.0.0.1", resolve);
  });
  const { port } = probe.address();
  await new Promise((resolve) => probe.close(resolve));
  return port;
}

function requestPath(port, path, method = "GET") {
  return new Promise((resolve, reject) => {
    const outgoing = request({ host: "127.0.0.1", port, path, method }, (response) => {
      response.resume();
      response.once("end", () => resolve({ status: response.statusCode, headers: response.headers }));
    });
    outgoing.once("error", reject);
    outgoing.end();
  });
}

function waitUntilReady(child) {
  return new Promise((resolve, reject) => {
    const timeout = setTimeout(() => reject(new Error("Local asset server did not become ready")), 5000);
    const finish = (callback, value) => {
      clearTimeout(timeout);
      child.stdout.off("data", onData);
      child.off("exit", onExit);
      callback(value);
    };
    const onData = (chunk) => {
      if (String(chunk).includes("Cablester prototype:")) finish(resolve);
    };
    const onExit = (code) => finish(reject, new Error(`Local asset server exited early: ${code}`));
    child.stdout.on("data", onData);
    child.once("exit", onExit);
    child.once("error", (error) => finish(reject, error));
  });
}

test("local media delivery sets image headers and rejects non-canonical raw paths", async () => {
  const port = await availablePort();
  const child = spawn(process.execPath, ["scripts/serve.mjs"], {
    cwd: root,
    env: { ...process.env, CABLESTER_PORT: String(port) },
    stdio: ["ignore", "pipe", "pipe"]
  });
  try {
    await waitUntilReady(child);
    const valid = await requestPath(port, "/media/game/terrain/moss-root-platform.webp", "HEAD");
    assert.equal(valid.status, 200);
    assert.equal(valid.headers["content-type"], "image/webp");
    assert.equal(valid.headers["cache-control"], "public, max-age=3600, must-revalidate");

    for (const path of [
      "/media/game%2Fterrain%2Fmoss-root-platform.webp",
      "/media/%2e%2e/index.html",
      "/MEDIA/../index.html",
      "/media/game/terrain/moss-root-platform.WEBP",
      "/media/%ZZ.webp"
    ]) {
      const response = await requestPath(port, path);
      assert.equal(response.status, 404, path);
    }
  } finally {
    if (child.exitCode === null) {
      child.kill("SIGINT");
      await new Promise((resolve) => child.once("exit", resolve));
    }
  }
});
