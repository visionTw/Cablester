import { cp, mkdir, rm, writeFile } from "node:fs/promises";
import { resolve } from "node:path";

const root = process.cwd();
const dist = resolve(root, "dist");
const client = resolve(dist, "client");
const server = resolve(dist, "server");

await rm(dist, { recursive: true, force: true });
await mkdir(client, { recursive: true });
await mkdir(server, { recursive: true });

await Promise.all([
  cp(resolve(root, "index.html"), resolve(client, "index.html")),
  cp(resolve(root, "styles.css"), resolve(client, "styles.css")),
  cp(resolve(root, "src"), resolve(client, "src"), { recursive: true }),
]);

await writeFile(
  resolve(server, "index.js"),
  `const worker = {
  async fetch(request, env) {
    const url = new URL(request.url);
    if (url.pathname === "/") url.pathname = "/index.html";
    return env.ASSETS.fetch(new Request(url, request));
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

console.log("Cablester web build created in dist/.");
