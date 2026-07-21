import { buildApp } from "./app.js";

const { app, config } = await buildApp();

try {
  await app.listen({
    host: config.server.host,
    port: config.server.port
  });
} catch (error) {
  app.log.error(error);
  process.exit(1);
}
