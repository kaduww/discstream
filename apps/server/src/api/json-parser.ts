import type { FastifyInstance } from "fastify";

export function registerJsonBodyParser(app: FastifyInstance): void {
  app.removeContentTypeParser("application/json");
  app.addContentTypeParser("application/json", { parseAs: "string" }, (_request, body, done) => {
    const text = (typeof body === "string" ? body : body.toString("utf8")).trim();
    if (!text) {
      done(null, undefined);
      return;
    }

    try {
      done(null, JSON.parse(text) as unknown);
    } catch (error) {
      done(error instanceof Error ? error : new Error("JSON body could not be parsed."));
    }
  });
}
