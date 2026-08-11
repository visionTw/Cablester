import { existsSync } from "node:fs";
import { cp, mkdir, rm, writeFile } from "node:fs/promises";
import { resolve } from "node:path";

const root = process.cwd();
const dist = resolve(root, "dist");
const client = resolve(dist, "client");
const server = resolve(dist, "server");

await rm(dist, { recursive: true, force: true });
await mkdir(client, { recursive: true });
await mkdir(server, { recursive: true });
await mkdir(resolve(dist, ".openai"), { recursive: true });

const copyTasks = [
  cp(resolve(root, "index.html"), resolve(client, "index.html")),
  cp(resolve(root, "styles.css"), resolve(client, "styles.css")),
  cp(resolve(root, "og.png"), resolve(client, "og.png")),
  cp(resolve(root, "src"), resolve(client, "src"), { recursive: true }),
  cp(resolve(root, "levels"), resolve(client, "levels"), { recursive: true }),
  cp(
    resolve(root, ".openai", "hosting.json"),
    resolve(dist, ".openai", "hosting.json"),
  ),
];
if (existsSync(resolve(root, "assets"))) {
  copyTasks.push(cp(resolve(root, "assets"), resolve(client, "assets"), { recursive: true }));
}
await Promise.all(copyTasks);

await writeFile(
  resolve(server, "index.js"),
  `const worker = {
  async fetch(request, env) {
    const url = new URL(request.url);
    if (url.pathname === "/") url.pathname = "/index.html";
    const response = await env.ASSETS.fetch(new Request(url, request));
    if (!response.ok) return response;
    if (url.pathname.startsWith("/assets/")) {
      const headers = new Headers(response.headers);
      headers.set("cache-control", "public, max-age=3600, must-revalidate");
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
    assets: { directory: "../client" },
    observability: { enabled: true },
  })}\n`,
);

console.log("Cablester Sites build created in dist/.");
