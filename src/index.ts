import { loadConfig, validateConfig } from "./config";
import { createServer } from "./server";

const config = loadConfig();
validateConfig(config);

const app = createServer(config);

const server = Bun.serve({
  port: config.port,
  hostname: config.host,
  fetch: app.fetch,
});

console.log(`GitGate service running on http://${config.host}:${config.port}`);
console.log(`Auth method: ${config.auth.method}`);
console.log(`Cache: in-memory LRU (max ${config.github.cache?.max_items ?? 500} items, ${config.github.cache?.max_mb ?? 256} MB)`);
