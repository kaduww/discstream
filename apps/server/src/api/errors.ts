import type { FastifyInstance } from "fastify";
import type { DiscStreamError } from "@discstream/contracts";
import { makeError } from "@discstream/contracts";

export function registerErrorHandler(app: FastifyInstance) {
  app.setErrorHandler((error, _request, reply) => {
    const discStreamError = toDiscStreamError(error);
    const statusCode = statusCodeFor(discStreamError.code);
    reply.status(statusCode).send({ error: discStreamError });
  });
}

function toDiscStreamError(error: unknown): DiscStreamError {
  if (isDiscStreamError(error)) {
    return error;
  }

  return makeError("VALIDATION_ERROR", error instanceof Error ? error.message : "An unexpected error occurred.", {
    recoverable: true
  });
}

function isDiscStreamError(error: unknown): error is DiscStreamError {
  return Boolean(
    error &&
      typeof error === "object" &&
      "code" in error &&
      "message" in error &&
      "recoverable" in error
  );
}

function statusCodeFor(code: DiscStreamError["code"]): number {
  switch (code) {
    case "NO_OPTICAL_DRIVE":
    case "MEDIA_NOT_READABLE":
    case "LOCAL_MEDIA_ROOT_UNAVAILABLE":
      return 404;
    case "MEDIA_PATH_NOT_ALLOWED":
    case "PERMISSION_DENIED":
      return 403;
    case "DRIVE_BUSY":
      return 409;
    case "UNSUPPORTED_OPERATION":
    case "UNSUPPORTED_PLATFORM":
    case "UNSUPPORTED_MEDIA_FORMAT":
    case "STREAM_PROFILE_UNAVAILABLE":
      return 422;
    case "VALIDATION_ERROR":
      return 400;
    default:
      return 500;
  }
}
