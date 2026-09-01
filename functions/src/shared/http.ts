import type { Request } from "firebase-functions/v2/https";
import type { Response } from "express";
import {
  HttpError,
  mapErrorToHttp,
  readJsonBody,
  requirePostMethod,
} from "./cors";

export type PostHandler = (body: unknown, req: Request) => Promise<unknown>;

/** Wrap a POST JSON handler with method check and consistent error responses. */
export function handlePostJson(handler: PostHandler) {
  return async (req: Request, res: Response): Promise<void> => {
    try {
      requirePostMethod(req.method);
      const body = readJsonBody(req);
      const result = await handler(body, req);
      res.status(200).json(result);
    } catch (error) {
      const { status, body } = mapErrorToHttp(error);
      res.status(status).json(body);
    }
  };
}

export { HttpError, readJsonBody, requireAdminIdToken } from "./cors";
