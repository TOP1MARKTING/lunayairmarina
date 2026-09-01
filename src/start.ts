import { createStart, createCsrfMiddleware, createMiddleware } from "@tanstack/react-start";

import { renderErrorPage } from "./lib/error-page";
import { isTrustedOrigin } from "./lib/trustedOrigins";

const errorMiddleware = createMiddleware().server(async ({ next }) => {
  try {
    return await next();
  } catch (error) {
    if (error != null && typeof error === "object" && "statusCode" in error) {
      throw error;
    }
    console.error(error);
    return new Response(renderErrorPage(), {
      status: 500,
      headers: { "content-type": "text/html; charset=utf-8" },
    });
  }
});

function isTrustedServerFnOrigin(origin: string): boolean {
  return isTrustedOrigin(origin);
}

// Start installs this automatically when src/start.ts is absent; defining the
// file opts out, so re-add it explicitly to keep server functions protected
// from cross-site requests while allowing the static cPanel origin.
const csrfMiddleware = createCsrfMiddleware({
  filter: (ctx) => ctx.handlerType === "serverFn",
  origin: (origin) => isTrustedServerFnOrigin(origin),
  secFetchSite: (value, ctx) => {
    if (value === "same-origin" || value === "same-site") return true;
    if (value === "cross-site") {
      const origin = ctx.request.headers.get("Origin")?.trim();
      return Boolean(origin && isTrustedServerFnOrigin(origin));
    }
    return false;
  },
});

export const startInstance = createStart(() => ({
  requestMiddleware: [errorMiddleware, csrfMiddleware],
}));
