import test from "node:test";
import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { createServer } from "node:net";
import { existsSync } from "node:fs";
import { cp, mkdir, mkdtemp, readFile, rm, symlink, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { request } from "node:http";
import { serializeWorldPackage } from "../src/world-hash.js";

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

function httpRequest(port, path, { method = "GET", headers = {}, body = "" } = {}) {
  return new Promise((resolve, reject) => {
    const outgoing = request({ host: "127.0.0.1", port, path, method, headers }, (response) => {
      const chunks = [];
      response.on("data", (chunk) => chunks.push(chunk));
      response.once("end", () => resolve({
        status: response.statusCode,
        headers: response.headers,
        body: Buffer.concat(chunks).toString("utf8")
      }));
    });
    outgoing.once("error", reject);
    outgoing.end(body);
  });
}

function waitUntilReady(child) {
  return new Promise((resolve, reject) => {
    const timeout = setTimeout(() => reject(new Error("World repository server did not become ready")), 5000);
    const finish = (callback, value) => {
      clearTimeout(timeout);
      child.stdout.off("data", onData);
      child.off("exit", onExit);
      callback(value);
    };
    const onData = (chunk) => {
      if (String(chunk).includes("Cablester prototype:")) finish(resolve);
    };
    const onExit = (code) => finish(reject, new Error(`World repository server exited early: ${code}`));
    child.stdout.on("data", onData);
    child.once("exit", onExit);
    child.once("error", (error) => finish(reject, error));
  });
}

test("localhost repository endpoint is worlds-only, atomic and conflict-aware", async () => {
  const sandbox = await mkdtemp(join(tmpdir(), "cablester-world-repository-"));
  const port = await availablePort();
  const repositoryCapability = "test-only-repository-capability-32-bytes";
  const repositoryHeaders = { "x-cablester-repository-capability": repositoryCapability };
  const externalFormalRoot = join(sandbox, "private-formal-worlds");
  await mkdir(join(sandbox, "scripts"), { recursive: true });
  await mkdir(join(sandbox, "worlds", "labs"), { recursive: true });
  await mkdir(externalFormalRoot, { recursive: true });
  await writeFile(join(sandbox, "index.html"), "<!doctype html>\n");
  await writeFile(join(sandbox, "scripts", "serve.mjs"), await readFile(join(root, "scripts", "serve.mjs")));
  await cp(join(root, "src"), join(sandbox, "src"), { recursive: true });
  await writeFile(join(sandbox, "package.json"), '{"type":"module"}\n');

  const child = spawn(process.execPath, ["scripts/serve.mjs", "--formal-world-root", externalFormalRoot], {
    cwd: sandbox,
    env: {
      ...process.env,
      CABLESTER_PORT: String(port),
      CABLESTER_REPOSITORY_CAPABILITY: repositoryCapability
    },
    stdio: ["ignore", "pipe", "pipe"]
  });
  try {
    await waitUntilReady(child);
    assert.equal((await httpRequest(port, "/__cablester/world-repository")).status, 403);
    assert.equal((await httpRequest(port, "/__cablester/world-repository", {
      headers: { "x-cablester-repository-capability": "wrong-capability" }
    })).status, 403);
    const capability = await httpRequest(port, "/__cablester/world-repository", { headers: repositoryHeaders });
    assert.equal(capability.status, 200);
    assert.equal(JSON.parse(capability.body).mode, "read-write");
    assert.equal(JSON.parse(capability.body).formalRootMode, "external-private");

    const contents = await readFile(join(root, "worlds", "fixtures", "v3-golden.world.json"), "utf8");
    const unauthorizedSave = await httpRequest(port, "/__cablester/world-repository", {
      method: "PUT",
      headers: { "content-type": "application/json", "x-cablester-world-path": "worlds/labs/unauthorized.world.json" },
      body: contents
    });
    assert.equal(unauthorizedSave.status, 403);
    const saved = await httpRequest(port, "/__cablester/world-repository", {
      method: "PUT",
      headers: { ...repositoryHeaders, "content-type": "application/json", "x-cablester-world-path": "worlds/labs/server-test.world.json" },
      body: contents
    });
    assert.equal(saved.status, 201);
    assert.equal(JSON.parse(saved.body).atomic, true);
    assert.equal(await readFile(join(sandbox, "worlds/labs/server-test.world.json"), "utf8"), contents);
    assert.ok(saved.headers.etag);

    const loaded = await httpRequest(port, "/worlds/labs/server-test.world.json");
    assert.equal(loaded.status, 200);
    assert.equal(loaded.headers.etag, saved.headers.etag);

    const preconditionRequired = await httpRequest(port, "/__cablester/world-repository", {
      method: "PUT",
      headers: { ...repositoryHeaders, "content-type": "application/json", "x-cablester-world-path": "worlds/labs/server-test.world.json" },
      body: contents
    });
    assert.equal(preconditionRequired.status, 428);

    const conflict = await httpRequest(port, "/__cablester/world-repository", {
      method: "PUT",
      headers: {
        ...repositoryHeaders,
        "content-type": "application/json",
        "x-cablester-world-path": "worlds/labs/server-test.world.json",
        "if-match": '"sha256:stale"'
      },
      body: contents
    });
    assert.equal(conflict.status, 412);

    const resaved = await httpRequest(port, "/__cablester/world-repository", {
      method: "PUT",
      headers: {
        ...repositoryHeaders,
        "content-type": "application/json",
        "x-cablester-world-path": "worlds/labs/server-test.world.json",
        "if-match": loaded.headers.etag
      },
      body: contents
    });
    assert.equal(resaved.status, 200);

    const formalWorld = JSON.parse(await readFile(join(root, "worlds", "labs", "cablester-composite-showcase.world.json"), "utf8"));
    formalWorld.manifest.namespace = "formal";
    formalWorld.manifest.contentHash = "";
    const formalContents = await serializeWorldPackage(formalWorld);
    const externalSave = await httpRequest(port, "/__cablester/world-repository", {
      method: "PUT",
      headers: { ...repositoryHeaders, "content-type": "application/json", "x-cablester-world-path": "worlds/formal/private-test.world.json" },
      body: formalContents
    });
    assert.equal(externalSave.status, 201);
    assert.equal(await readFile(join(externalFormalRoot, "private-test.world.json"), "utf8"), formalContents);
    assert.equal(existsSync(join(sandbox, "worlds", "formal", "private-test.world.json")), false);
    const externalLoad = await httpRequest(port, "/worlds/formal/private-test.world.json");
    assert.equal(externalLoad.status, 200);
    assert.equal(externalLoad.body, formalContents);
    const outsideWorld = join(sandbox, "outside-private.world.json");
    await writeFile(outsideWorld, formalContents);
    await symlink(outsideWorld, join(externalFormalRoot, "symlink-leak.world.json"));
    assert.equal((await httpRequest(port, "/worlds/formal/symlink-leak.world.json")).status, 404);
    const refreshedCapability = JSON.parse((await httpRequest(port, "/__cablester/world-repository", { headers: repositoryHeaders })).body);
    assert.ok(refreshedCapability.worlds.some((entry) => entry.path === "worlds/formal/private-test.world.json"));
    assert.equal(refreshedCapability.worlds.some((entry) => entry.path === "worlds/formal/symlink-leak.world.json"), false);

    for (const path of ["../project.godot", "worlds/fixtures/x.world.json", "godot/x.world.json"]) {
      const rejected = await httpRequest(port, "/__cablester/world-repository", {
        method: "PUT",
        headers: { ...repositoryHeaders, "content-type": "application/json", "x-cablester-world-path": path },
        body: contents
      });
      assert.equal(rejected.status, 400, path);
    }

    const noNewline = await httpRequest(port, "/__cablester/world-repository", {
      method: "PUT",
      headers: { ...repositoryHeaders, "content-type": "application/json", "x-cablester-world-path": "worlds/labs/no-newline.world.json" },
      body: "{}"
    });
    assert.equal(noNewline.status, 400);

    const invalidCanonical = await httpRequest(port, "/__cablester/world-repository", {
      method: "PUT",
      headers: { ...repositoryHeaders, "content-type": "application/json", "x-cablester-world-path": "worlds/labs/invalid.world.json" },
      body: "{}\n"
    });
    assert.equal(invalidCanonical.status, 422);

    const nonDeterministic = await httpRequest(port, "/__cablester/world-repository", {
      method: "PUT",
      headers: { ...repositoryHeaders, "content-type": "application/json", "x-cablester-world-path": "worlds/labs/non-deterministic.world.json" },
      body: `${JSON.stringify(JSON.parse(contents))}\n`
    });
    assert.equal(nonDeterministic.status, 422);

    const namespaceMismatchBody = JSON.parse(contents);
    namespaceMismatchBody.manifest.namespace = "formal";
    namespaceMismatchBody.manifest.contentHash = "";
    const namespaceMismatch = await httpRequest(port, "/__cablester/world-repository", {
      method: "PUT",
      headers: { ...repositoryHeaders, "content-type": "application/json", "x-cablester-world-path": "worlds/labs/formal.world.json" },
      body: `${JSON.stringify(namespaceMismatchBody, null, 2)}\n`
    });
    assert.equal(namespaceMismatch.status, 422);

    assert.equal((await httpRequest(port, "/scripts/serve.mjs")).status, 404);
    assert.equal((await httpRequest(port, "/.openai/hosting.json")).status, 404);
    assert.equal((await httpRequest(port, "/", { headers: { host: "attacker.example" } })).status, 403);

    const hostileOrigin = await httpRequest(port, "/__cablester/world-repository", {
      method: "PUT",
      headers: {
        ...repositoryHeaders,
        origin: "https://attacker.example",
        "content-type": "application/json",
        "x-cablester-world-path": "worlds/labs/hostile.world.json"
      },
      body: contents
    });
    assert.equal(hostileOrigin.status, 403);
  } finally {
    if (child.exitCode === null) {
      child.kill("SIGINT");
      await new Promise((resolve) => child.once("exit", resolve));
    }
    await rm(sandbox, { recursive: true, force: true });
  }
});
