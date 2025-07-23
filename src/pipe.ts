import {
  HTTPPipe,
  PipeError,
  PipeMethod,
  PipeMethodType,
  PipeRequest,
  PipeResponseCodes,
  PipeRouteHandler,
  validateBodyOrParams,
  XMTPv3Pipe,
} from "@forest-protocols/sdk";
import { AbstractProvider } from "./abstract/AbstractProvider";
import { ProviderPipeRouteHandler } from "./types";
import { logger } from "./logger";
import { colorHex, colorWord } from "./color";
import { z } from "zod";

/**
 * Operator pipes in this daemon
 */
export const pipes: {
  [operatorAddr: string]: {
    // NOTE: XMTP Pipe will be removed in the future
    xmtp: XMTPv3Pipe;
    http: HTTPPipe;
  };
} = {};

/**
 * Routes defined by providers
 * TODO: We don't need this route handling per Provider ID. We can simply change the path to include the provider ID such as `/providers/1/<path>`.
 * Ah, why I haven't thought of this before?! - mdk
 */
export const providerRoutes: {
  [providerId: string]: {
    [path: string]: {
      [method: string]: ProviderPipeRouteHandler;
    };
  };
} = {};

/**
 * Setups a Pipe route in the Operator's Pipe of the given Provider.
 * The requests that are sent to this route must include the
 * `providerId` field either in the body or params.
 */
export function pipeProviderRoute(
  provider: AbstractProvider,
  method: PipeMethodType,
  path: `/${string}`,
  handler: ProviderPipeRouteHandler
) {
  if (!providerRoutes[provider.actorInfo.id]) {
    providerRoutes[provider.actorInfo.id] = {};
  }

  if (!providerRoutes[provider.actorInfo.id][path]) {
    providerRoutes[provider.actorInfo.id][path] = {};
  }

  providerRoutes[provider.actorInfo.id][path][method] = handler;

  pipeOperatorRoute(
    provider.actorInfo.operatorAddr,
    method,
    path,
    async (req) => {
      let providerId: number | undefined;

      // Lookup body and params for `providerId`
      const schema = z.object({
        providerId: z.number().optional(),
      });

      if (req.body !== undefined) {
        const body = validateBodyOrParams(req.body, schema);
        providerId = body.providerId;
      } else if (req.params !== undefined) {
        const params = validateBodyOrParams(req.params, schema);
        providerId = params.providerId;
      }

      if (providerId === undefined) {
        throw new PipeError(PipeResponseCodes.BAD_REQUEST, {
          message: `Missing "providerId"`,
        });
      }

      // Search the corresponding handler for the given provider, path and method
      const providerRouteHandler =
        providerRoutes[providerId!]?.[path]?.[method];

      // Throw error if there is no handler defined in this pipe for the given provider
      if (!providerRouteHandler) {
        throw new PipeError(PipeResponseCodes.NOT_FOUND, {
          message: `${method} ${req.path} not found`,
        });
      }

      return await providerRouteHandler({
        ...req,
        providerId: providerId!,
      });
    }
  );
}

/**
 * Setups a Pipe route in the given Operator's Pipe.
 */
export function pipeOperatorRoute(
  operatorAddress: string,
  method: PipeMethodType,
  path: string,
  handler: PipeRouteHandler,
  pipe?: "xmtp" | "http"
) {
  if (!pipes[operatorAddress]) {
    throw new Error(`There is no initialized Pipe for ${operatorAddress}`);
  }

  const handlerWrapper = async (req: PipeRequest) => {
    logger.info(
      `Got Pipe request with id ${colorWord(req.id)} from ${colorHex(
        req.requester
      )} on ${method} ${path}`
    );
    try {
      const result = await handler(req);
      logger.info(
        `Pipe request with id ${colorWord(req.id)} from ${colorHex(
          req.requester
        )} on ${method} ${path} was successful`
      );
      return result;
    } catch (error) {
      logger.error(
        `Pipe request with id ${colorWord(req.id)} from ${colorHex(
          req.requester
        )} on ${method} ${path} failed: ${error}`
      );
      throw error;
    }
  };

  if (pipe === undefined || pipe === "xmtp") {
    pipes[operatorAddress].xmtp.route(
      method as PipeMethod,
      path,
      handlerWrapper
    );
  }

  if (pipe === undefined || pipe === "http") {
    pipes[operatorAddress].http.route(method, path, handlerWrapper);
  }
}
