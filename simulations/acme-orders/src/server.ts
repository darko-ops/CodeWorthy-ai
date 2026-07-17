import { createApp } from "./app";
import { config } from "./config";
import { log } from "./lib/logger";

const app = createApp();
app.listen(config.port, () => {
  log.info("server.start", { port: config.port });
});
