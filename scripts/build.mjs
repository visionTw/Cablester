import { existsSync } from "node:fs";
import { cp, mkdir, rm, writeFile } from "node:fs/promises";
import { resolve } from "node:path";
import { MEDIA_ASSET_PATH_PATTERN_SOURCE } from "../src/asset-paths.js";

const root = process.cwd();
const dist = resolve(root, "dist");
const client = resolve(dist, "client");
const server = resolve(dist, "server");
const isGodotDerivative = (source) => source.endsWith(".import") || source.includes("/.godot/");
const isPublishedGodotArtifact = (source) => {
  if (source.includes("/artifacts/godot/test/")) return false;
  if (source.endsWith("/artifacts/godot")) return true;
  return source.endsWith(".json") || source.endsWith(".png");
};
const isPublishedWebArtifact = (source) => (
  source.endsWith("/artifacts/web")
  || source.endsWith("/artifacts/web/world-studio-performance.json")
);

await rm(dist, { recursive: true, force: true });
await mkdir(client, { recursive: true });
await mkdir(server, { recursive: true });
await mkdir(resolve(dist, ".openai"), { recursive: true });
await writeFile(
  resolve(dist, ".gdignore"),
  "# Generated Sites output. Keep Godot's project scanner out of copied Web assets.\n",
);

const copyTasks = [
  cp(resolve(root, "_headers"), resolve(client, "_headers")),
  cp(resolve(root, "index.html"), resolve(client, "index.html")),
  cp(resolve(root, "styles.css"), resolve(client, "styles.css")),
  cp(resolve(root, "og.png"), resolve(client, "og.png")),
  cp(resolve(root, "src"), resolve(client, "src"), { recursive: true }),
  cp(resolve(root, "levels"), resolve(client, "levels"), { recursive: true }),
  cp(resolve(root, "worlds", "formal"), resolve(client, "worlds", "formal"), { recursive: true }),
  cp(resolve(root, "worlds", "labs"), resolve(client, "worlds", "labs"), { recursive: true }),
  cp(resolve(root, "worlds", "registries"), resolve(client, "worlds", "registries"), { recursive: true }),
  cp(
    resolve(root, ".openai", "hosting.json"),
    resolve(dist, ".openai", "hosting.json"),
  ),
];
if (existsSync(resolve(root, "assets"))) {
  copyTasks.push(cp(resolve(root, "assets"), resolve(client, "assets"), {
    recursive: true,
    filter: (source) => !isGodotDerivative(source)
  }));
}
if (existsSync(resolve(root, "artifacts", "godot"))) {
  copyTasks.push(cp(resolve(root, "artifacts", "godot"), resolve(client, "artifacts", "godot"), {
    recursive: true,
    filter: isPublishedGodotArtifact
  }));
}
if (existsSync(resolve(root, "artifacts", "web", "world-studio-performance.json"))) {
  copyTasks.push(cp(resolve(root, "artifacts", "web"), resolve(client, "artifacts", "web"), {
    recursive: true,
    filter: isPublishedWebArtifact
  }));
}
await Promise.all(copyTasks);

await writeFile(
  resolve(server, "index.js"),
  `const worker = {
  async fetch(request, env) {
    const url = new URL(request.url);
    if (url.pathname === "/__cablester/world-repository") {
      if (request.method !== "GET") {
        return Response.json({
          mode: "read-only",
          writable: false,
          local: false,
          reason: "线上版本为只读；请在 localhost 开发服务器中保存仓库文件。"
        }, { status: 403, headers: { "cache-control": "no-store" } });
      }
      return Response.json({
        mode: "read-only",
        writable: false,
        local: false,
        worlds: [
          { path: "worlds/formal/first-forest.world.json" },
          { path: "worlds/labs/cablester-3c-labs.world.json" }
        ],
        reason: "线上版本为只读；请在 localhost 开发服务器中保存仓库文件。"
      }, { headers: { "cache-control": "no-store" } });
    }
    if (url.pathname === "/") url.pathname = "/index.html";
    const rawPath = request.url.slice(url.origin.length).split(/[?#]/, 1)[0];
    const requestedAssetDelivery = /^\\/media\\//i.test(rawPath);
    const assetDeliveryMatch = rawPath.match(new RegExp(${JSON.stringify(MEDIA_ASSET_PATH_PATTERN_SOURCE)}));
    if (requestedAssetDelivery && !assetDeliveryMatch) return new Response("Not found", { status: 404 });
    const isAssetDelivery = Boolean(assetDeliveryMatch);
    const assetUrl = new URL(url);
    if (isAssetDelivery) assetUrl.pathname = \`/assets/\${assetDeliveryMatch[1]}\`;
    const response = await env.ASSETS.fetch(new Request(assetUrl, request));
    if (!response.ok) return response;
    if (isAssetDelivery || url.pathname.startsWith("/assets/")) {
      const headers = new Headers(response.headers);
      headers.set("cache-control", "public, max-age=3600, must-revalidate");
      const extension = url.pathname.slice(url.pathname.lastIndexOf(".")).toLowerCase();
      const contentTypes = {
        ".avif": "image/avif",
        ".jpeg": "image/jpeg",
        ".jpg": "image/jpeg",
        ".png": "image/png",
        ".webp": "image/webp"
      };
      if (contentTypes[extension]) headers.set("content-type", contentTypes[extension]);
      return new Response(response.body, { status: response.status, headers });
    }
    if (url.pathname !== "/index.html") return response;
    const headers = new Headers(response.headers);
    headers.set("cache-control", "no-store");
    headers.delete("content-length");
    const html = (await response.text()).replaceAll("__SITE_ORIGIN__", url.origin);
    return new Response(html, { status: response.status, headers });
  },
};

export default worker;
`,
);

await writeFile(
  resolve(server, "wrangler.json"),
  `${JSON.stringify({
    name: "cablester-prototype",
    compatibility_date: "2026-08-09",
    main: "index.js",
    no_bundle: true,
    rules: [{ type: "ESModule", globs: ["**/*.js", "**/*.mjs"] }],
    assets: {
      directory: "../client",
      binding: "ASSETS",
      run_worker_first: ["/", "/index.html", "/media/*", "/__cablester/world-repository"],
    },
    observability: { enabled: true },
  })}\n`,
);

console.log("Cablester Sites build created in dist/.");
