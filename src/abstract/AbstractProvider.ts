import { rpcClient } from "@/clients";
import { colorHex } from "@/color";
import { config } from "@/config";
import { DB } from "@/database/client";
import { PipeErrorNotFound } from "@/errors/pipe/PipeErrorNotFound";
import { logger } from "@/logger";
import { pipeOperatorRoute, pipes, pipeProviderRoute } from "@/pipe";
import { cleanupHandlers } from "@/signal";
import {
  DetailedOffer,
  ProviderPipeRouteHandler,
  Resource,
  ResourceDetails,
} from "@/types";
import {
  PipeRouteHandler,
  Provider,
  ProviderDetails,
  validateBodyOrParams,
  XMTPv3Pipe,
  Agreement,
  Protocol,
  Registry,
  tryParseJSON,
  ProviderDetailsSchema,
  HTTPPipe,
  AddressSchema,
  PipeResponseCodes,
  PipeMethods,
  PipeMethodType,
} from "@forest-protocols/sdk";
import { yellow } from "ansis";
import { readFileSync, statSync } from "fs";
import { join } from "path";
import { Account, Address, nonceManager } from "viem";
import { privateKeyToAccount } from "viem/accounts";
import { z } from "zod";

/**
 * Abstract Provider that Protocol Owners has to extend from.
 * @responsible Admin
 */
export abstract class AbstractProvider<
  T extends ResourceDetails = ResourceDetails
> {
  registry!: Registry;

  protocol!: Protocol;

  account!: Account;

  actorInfo!: Provider;

  details!: ProviderDetails;

  logger = logger.child({ context: this.constructor.name });

  /**
   * Initializes the Provider.
   */
  async init(providerTag: string): Promise<void> {
    const providerConfig = config.providers[providerTag];

    if (!providerConfig) {
      this.logger.error(
        `Provider config not found for Provider tag "${providerTag}". Please check your environment variables`
      );
      process.exit(1);
    }

    // Setup Provider account
    this.account = privateKeyToAccount(
      providerConfig.providerWalletPrivateKey as Address,
      { nonceManager }
    );

    // Initialize clients
    this.registry = new Registry({
      client: rpcClient,
      account: this.account,
      address: config.REGISTRY_ADDRESS,
    });

    this.logger.info("Checking in Network Actor registration");
    const provider = await this.registry.getActor(this.account.address);
    if (!provider) {
      this.logger.error(
        `Provider "${this.account.address}" is not registered in the Network. Please register it and try again.`
      );
      process.exit(1);
    }
    this.actorInfo = provider;

    await DB.upsertProvider(
      this.actorInfo.id,
      this.actorInfo.detailsLink,
      this.actorInfo.ownerAddr
    );

    // `DB.upsertProvider` already checked the existence of the details file
    // so we can directly destruct the return array.
    const [provDetailFile] = await DB.getDetailFiles([provider.detailsLink]);

    // Validate the details file structure
    this.validateProviderDetails(provDetailFile.content);

    let ptAddress = providerConfig.protocolAddress;
    if (ptAddress === undefined) {
      const registeredPts = await this.registry.getRegisteredPTsOfProvider(
        this.actorInfo.id
      );

      if (registeredPts.length == 0) {
        throw new Error(
          `Not found any registered Protocol for Provider tag "${providerTag}". Please register within a Protocol and try again`
        );
      }

      ptAddress = registeredPts[0];
      this.logger.warning(
        `First registered Protocol address (${yellow.bold(
          ptAddress
        )}) is using as Protocol address`
      );
    } else {
      this.logger.info(`Using Protocol address ${yellow.bold(ptAddress)}`);
    }

    this.protocol = new Protocol({
      address: ptAddress,
      client: rpcClient,
      account: this.account,
      registryContractAddress: config.REGISTRY_ADDRESS,
    });

    // Initialize the Pipes for this Operator address if it is not initialized yet.
    if (!pipes[this.actorInfo.operatorAddr]) {
      pipes[this.actorInfo.operatorAddr] = {
        xmtp: new XMTPv3Pipe(providerConfig.operatorWalletPrivateKey, {
          dbPath: join(
            process.cwd(),
            "data",
            `db-${this.actorInfo.operatorAddr}.db`
          ),

          // Doesn't matter what it is as long as it is something that we can use in the next client initialization
          encryptionKey: this.actorInfo.operatorAddr,
        }),
        http: new HTTPPipe(providerConfig.operatorWalletPrivateKey, {
          port: providerConfig.operatorPipePort,
        }),
      };

      // Initialize the Pipes
      await pipes[this.actorInfo.operatorAddr].xmtp.init(config.NODE_ENV);
      await pipes[this.actorInfo.operatorAddr].http.init();

      // Add a handler to close the Pipe when the program is terminated
      cleanupHandlers.push(async () => {
        this.logger.info(
          `Closing Pipes of operator ${colorHex(this.actorInfo.operatorAddr)}`
        );
        await Promise.all([
          pipes[this.actorInfo.operatorAddr].xmtp
            .close()
            .then(() => {
              this.logger.info(
                `XMTP pipe of operator ${colorHex(
                  this.actorInfo.operatorAddr
                )} closed`
              );
            })
            .catch((err) => {
              this.logger.error(
                `Error closing XMTP pipe of operator ${colorHex(
                  this.actorInfo.operatorAddr
                )}: ${err}`
              );
            }),
          pipes[this.actorInfo.operatorAddr].http
            .close()
            .then(() => {
              this.logger.info(
                `HTTP pipe of operator ${colorHex(
                  this.actorInfo.operatorAddr
                )} closed`
              );
            })
            .catch((err) => {
              this.logger.error(
                `Error closing HTTP pipe of operator ${colorHex(
                  this.actorInfo.operatorAddr
                )}: ${err}`
              );
            }),
        ]);
      });

      this.logger.info(
        `Initialized XMTP Pipe for operator ${yellow.bold(
          this.actorInfo.operatorAddr
        )}`
      );

      this.logger.info(
        `Initialized HTTP Pipe for operator ${yellow.bold(
          this.actorInfo.operatorAddr
        )} on 0.0.0.0:${providerConfig.operatorPipePort}`
      );

      // Setup operator specific endpoints
      this.operatorRoute(PipeMethods.GET, "/spec", async () => {
        try {
          const possibleSpecFiles = [
            "spec.yaml",
            "spec.json",
            "oas.json",
            "oas.yaml",
          ];
          for (const specFile of possibleSpecFiles) {
            const path = join(process.cwd(), "data", specFile);
            const stat = statSync(path, { throwIfNoEntry: false });

            if (stat && stat.isFile()) {
              const content = readFileSync(path, {
                encoding: "utf-8",
              }).toString();
              return {
                code: PipeResponseCodes.OK,
                body: content,
              };
            }
          }
        } catch (err: any) {
          this.logger.error(`Couldn't load OpenAPI spec file: ${err.message}`);
          throw new PipeErrorNotFound(`OpenAPI spec file`);
        }

        throw new PipeErrorNotFound(`OpenAPI spec file`);
      });

      /**
       * Retrieves detail file(s)
       */
      this.operatorRoute(PipeMethods.GET, "/details", async (req) => {
        // If there is a query param, use it. Otherwise, use the body.
        let source: any[] = req.body;

        if (req.params?.cids?.length > 0) {
          source = req.params!.cids;
        }

        const cids = validateBodyOrParams(source, z.array(z.string()).min(1));
        const files = await DB.getDetailFiles(cids);

        if (files.length == 0) {
          throw new PipeErrorNotFound("Detail files");
        }

        return {
          code: PipeResponseCodes.OK,
          body: files.map((file) => file.content),
        };
      });

      /**
       * Retrieve details (e.g credentials) of resource(s).
       */
      this.operatorRoute(PipeMethods.GET, "/resources", async (req) => {
        const params = validateBodyOrParams(
          req.body || req.params,
          z.object({
            /** ID of the resource. */
            id: z.coerce.number().optional(),

            /** Protocol address that the resource created in. */
            pt: AddressSchema.optional(), // A pre-defined Zod schema for smart contract addresses.
          })
        );

        // If not both of them are given, send all resources of the requester
        if (params.id === undefined || params.pt === undefined) {
          return {
            code: PipeResponseCodes.OK,
            body: await DB.getAllResourcesOfUser(req.requester as Address),
          };
        }

        // Since the Pipe implementations have wallet address verification, we don't need to worry about
        // if this request really sent by the owner of the resource. In case of the sender is
        // different from the owner of the resource, the resource won't be able to found in the Provider's
        // database because resources are stored in the database as:
        //  resource id <-> owner address <-> protocol address
        // pairs. `.getResource` handles all these checks.
        const resource = await DB.getResource(
          params.id,
          req.requester,
          params.pt as Address
        );

        if (!resource) {
          throw new PipeErrorNotFound(`Resource ${params.id}`);
        }

        // Filter fields that starts with underscore.
        const details: any = {};
        for (const [name, value] of Object.entries(resource.details)) {
          if (name.startsWith("_")) {
            continue;
          }

          details[name] = value;
        }

        resource.details = details; // Use filtered details

        return {
          code: PipeResponseCodes.OK,
          body: resource,
        };
      });
    }

    // Re-initialize the logger with the new context that includes the Provider tag
    this.logger = logger.child({
      context: `${this.constructor.name}(${providerTag})`,
    });
  }

  /**
   * Parses and validates the given details file content as Provider details.
   * @param content
   */
  private validateProviderDetails(content: string) {
    const detailsObject = tryParseJSON(content);
    if (!detailsObject) {
      this.logger.error(`Provider details file is not a JSON file`);
      process.exit(1);
    }

    const detailsValidation = ProviderDetailsSchema.safeParse(detailsObject);
    if (!detailsValidation.success) {
      this.logger.error(
        `Provider details file is not in the expected format: ${detailsValidation.error.message}`
      );
      process.exit(1);
    }
    this.details = detailsValidation.data;
  }

  /**
   * Gets a resource that stored in the database and the corresponding agreement from blockchain
   * @param id ID of the resource/agreement
   * @param ptAddress Protocol address
   * @param requester Requester of this resource
   */
  protected async getResource(
    id: number,
    ptAddress: Address,
    requester: string
  ) {
    const resource = await DB.getResource(id, requester, ptAddress);

    if (
      !resource || // Resource does not exist
      !resource.isActive || // Agreement of the resource is closed
      resource.providerId != this.actorInfo.id // Resource doesn't belong to this provider
    ) {
      throw new PipeErrorNotFound("Resource");
    }

    const agreement = await this.protocol.getAgreement(resource.id); // Retrieve the agreement details from chain

    return {
      resource,
      agreement,
      protocol: this.protocol,
    };
  }

  /**
   * Setups a route handler function in the operator Pipe for this provider.
   * Note: Requests that made to this route has to include either `body.providerId` or `params.providerId` field that points to the provider's ID.
   */
  protected route(
    method: PipeMethodType,
    path: `/${string}`,
    handler: ProviderPipeRouteHandler
  ) {
    pipeProviderRoute(this, method, path, handler);
  }

  /**
   * Setups a route handler for the provider's operator.
   */
  protected operatorRoute(
    method: PipeMethodType,
    path: `/${string}`,
    handler: PipeRouteHandler
  ) {
    pipeOperatorRoute(this.actorInfo.operatorAddr, method, path, handler);
  }

  /**
   * Creates the actual resource based. Called based on the blockchain agreement creation event.
   * @param agreement On-chain Agreement data
   * @param offer On-chain Offer data and details (if exists)
   */
  abstract create(agreement: Agreement, offer: DetailedOffer): Promise<T>;

  /**
   * Fetches/retrieves the details about the resource from the resource itself
   * @param agreement On-chain Agreement data
   * @param offer On-chain Offer data and details (if exists)
   * @param resource Current details stored in the database
   */
  abstract getDetails(
    agreement: Agreement,
    offer: DetailedOffer,
    resource: Resource
  ): Promise<T>;

  /**
   * Deletes the actual resource based. Called based on the blockchain agreement closing event.
   * @param agreement On-chain Agreement data
   * @param offer On-chain Offer data and details (if exists)
   * @param resource Current details stored in the database
   */
  abstract delete(
    agreement: Agreement,
    offer: DetailedOffer,
    resource: Resource
  ): Promise<void>;
}
