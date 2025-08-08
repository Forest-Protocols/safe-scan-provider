#!/usr/bin/env node
import {
  Agreement,
  DeploymentStatus,
  GetAgreementsOptions,
  IndexerAgreement,
  Offer,
  sleep,
  Status,
  tryParseJSON,
} from "@forest-protocols/sdk";
import { Address } from "viem";
import { DB } from "./database/client";
import { logger } from "./logger";
import { AbstractProvider } from "./abstract/AbstractProvider";
import * as ansis from "ansis";
import {
  adjectives,
  animals,
  colors,
  uniqueNamesGenerator,
} from "unique-names-generator";
import { join } from "path";
import { readdirSync, readFileSync, statSync } from "fs";
import { DetailedOffer } from "./types";
import { indexerAgreementToAgreement } from "./utils/indexer-agreement-to-agreement";
import express from "express";
import { config } from "./config";
import { colorHex, colorNumber, colorWord } from "./color";
import {
  abortController,
  addCleanupHandler,
  cleanupHandlers,
  removeCleanupHandler,
} from "./signal";
import { isTermination } from "./utils/is-termination";
import { ensureError } from "./utils/ensure-error";
import { isAxiosError } from "axios";
import { indexerClient, rpcClient } from "./clients";
import { providers } from "./providers";

// Key for tracking "indexer not healthy" logs
const LOG_TRACK_INDEXER_HEALTH = "indexer-health";

// Configuration key to keep track of latest processed block
const CONFIG_LAST_PROCESSED_BLOCK = "LAST_PROCESSED_BLOCK";

class Program {
  /**
   * @deprecated Use `providers` object from `src/providers.ts` instead
   */
  providers = {
    ...providers,
  };

  /**
   * Keeps track of the error logs via boolean values
   * and string keys to log them only once.
   */
  logTrackings: Record<string, boolean> = {};

  /**
   * Is checker function currently being executed?
   */
  isCheckingAgreementBalances = false;

  lastProcessedBlock = 0n;

  constructor() {}

  initHealthcheck() {
    const app = express();
    app.get("/health", (_, res) => {
      res.send("Running");
    });
    app.listen(config.PORT);
  }

  /**
   * Checks if the Indexer is healthy, if the given error is an
   * Axios error. Prints an error message only once no matter how
   * many times it is called.
   * @returns `true` if the Indexer is unhealthy and false if it is healthy
   */
  async checkIndexerHealthy(err: unknown) {
    const error = ensureError(err);
    if (isAxiosError(error)) {
      const isHealthy = await indexerClient.isHealthy();

      // Log the error message only once
      if (!isHealthy && !this.logTrackings[LOG_TRACK_INDEXER_HEALTH]) {
        this.logTrackings[LOG_TRACK_INDEXER_HEALTH] = true;
        logger.error("Indexer is not healthy, cannot fetch data from it");
      }
      return true;
    }

    return false;
  }

  /**
   * Syncs the detail files from the data/details directory to the database.
   */
  async syncDetailFiles() {
    logger.info("Syncing detail files to the database");
    const basePath = join(process.cwd(), "data", "details");
    const allFiles = readdirSync(basePath, { recursive: true });
    const files = allFiles.filter((file) => {
      const filePath = join(basePath, file.toString());
      const stat = statSync(filePath, { throwIfNoEntry: false });

      // Exclude sub-directories
      return stat?.isFile();
    });

    // Read contents of the files
    const contents = files.map((file) => {
      const filePath = join(basePath, file.toString());
      const content = readFileSync(filePath);
      return content.toString("utf-8");
    });

    // Sync the database
    await DB.syncDetailFiles(contents);
  }

  async init() {
    // Start a healthcheck HTTP server
    this.initHealthcheck();

    // Load detail files into the database
    await this.syncDetailFiles();

    // Initialize providers
    for (const [tag, provider] of Object.entries(this.providers)) {
      provider.logger.info(`Initializing via tag "${colorWord(tag)}" `);
      await provider.init(tag);

      // Fetch detail links of the Protocol
      provider.logger.info(`Checking details of the Protocol`);
      const ptDetailsLink = await provider.protocol.getDetailsLink();

      // Save address of the Protocol to the database
      await DB.upsertProtocol(provider.protocol.address, ptDetailsLink);

      provider.logger.info(
        `Initialized; tag: ${colorWord(tag)}, owner address: ${colorHex(
          provider.actor.ownerAddr
        )}, operates on Protocol: ${colorHex(provider.protocol.address)}`
      );
    }

    // Check balances of the Agreements at startup and then in every given interval

    this.checkAgreementBalances().then(() => {
      const interval = setInterval(
        () => this.checkAgreementBalances(),
        config.AGREEMENT_CHECK_INTERVAL
      );

      addCleanupHandler(() => clearInterval(interval));
    });
  }

  watchResourceStatus(params: {
    provider: AbstractProvider;
    ptAddress: Address;
    detailedOffer: DetailedOffer;

    agreementId: number;
    ownerAddress: Address;
  }) {
    const handler = async () => {
      while (!abortController.signal.aborted) {
        try {
          const resource = await DB.getResource(
            params.agreementId,
            params.ownerAddress,
            params.ptAddress
          );

          if (!resource || !resource.isActive) {
            params.provider.logger.warning(
              `Resource ${colorNumber(
                params.agreementId
              )} is not available anymore, leaving status check`
            );
            return;
          }

          // TODO: Replace with an Indexer call
          const agreement = await params.provider.protocol.getAgreement(
            params.agreementId
          );

          const resourceDetails = await params.provider.getDetails(
            agreement,
            params.detailedOffer,
            resource
          );

          if (resourceDetails.status == DeploymentStatus.Running) {
            logger.info(
              `Resource ${colorNumber(agreement.id)} is in running status`
            );

            // Update the status and gathered details
            await DB.updateResource(agreement.id, params.ptAddress, {
              deploymentStatus: DeploymentStatus.Running,
              details: resourceDetails,
            });
            return;
          }

          await sleep(5_000, abortController.signal);
        } catch (err) {
          const error = ensureError(err);
          if (!isTermination(error)) {
            params.provider.logger.error(
              `Error while try to retrieve details of the Resource ${colorNumber(
                params.agreementId
              )}: ${error.stack}`
            );
          }
        }
      }
    };

    // Run the `handler` function and add it
    // to the cleanup handlers so in case if the process
    // is terminated, the execution will wait until
    // `handler` function is completed. In the other
    // situation; If the `handler` is completed
    // before the process is terminated, then
    // we don't need to cleanup it anymore so remove it from
    // the cleanup handlers.

    // Promise of the execution of `handler` function so we can
    // resolve it in the cleanup handler.
    const promise = handler().then(() => removeCleanupHandler(handler));

    // If meanwhile the process is terminated, the promise will be resolved (waited)
    addCleanupHandler(() => promise);
  }

  async createResource(
    agreement: Agreement,
    offer: Offer,
    ptAddress: Address,
    provider: AbstractProvider,
    providerActor: { id: number; ownerAddr: Address }
  ) {
    try {
      const [offerDetailFile] = await DB.getDetailFiles([offer.detailsLink]);

      if (!offerDetailFile) {
        provider.logger.warning(
          `Details file is not found for Offer ${agreement.offerId} @ ${ptAddress} (Provider ID: ${provider.actor.id})`
        );
      }

      const protocol = await DB.getProtocol(ptAddress);
      const detailedOffer: DetailedOffer = {
        ...offer,

        // TODO: Validate offer details if it is a JSON file
        // If it is a JSON file, parse it. Otherwise return it as a string.
        details: tryParseJSON(offerDetailFile?.content, true),
      };
      const details = await provider.create(agreement, detailedOffer);

      await DB.createResource({
        id: agreement.id,
        deploymentStatus: details.status,

        // If the name is not returned by the provider, just give a random name
        name:
          details.name ||
          uniqueNamesGenerator({
            dictionaries: [adjectives, colors, animals],
            length: 2,
          }),
        offerId: offer.id,
        ownerAddress: agreement.userAddr,
        ptAddressId: protocol.id,
        providerId: providerActor.id,
        details: {
          ...details,

          // We store those fields inside columns, not in the JSON object.
          name: undefined,
          status: undefined,
        },
      });

      if (details.status === DeploymentStatus.Running) {
        provider.logger.info(
          `Resource of Agreement ${colorNumber(
            agreement.id
          )} has been created successfully`
        );
        return;
      }

      // Resource is not in running state, so we need to check its status
      provider.logger.info(
        `Creation request of agreement ${colorNumber(
          agreement.id
        )} resource has been created successfully`
      );

      // Start the watcher
      this.watchResourceStatus({
        agreementId: agreement.id,
        ownerAddress: agreement.userAddr,
        ptAddress,
        provider,
        detailedOffer,
      });
    } catch (err: any) {
      provider.logger.error(`Error while creating the Resource: ${err.stack}`);

      // Save the resource as failed
      const pt = await DB.getProtocol(ptAddress);

      // Save that resource as a failed deployment
      await DB.createResource({
        id: agreement.id,
        deploymentStatus: DeploymentStatus.Failed,
        name: "",
        ptAddressId: pt.id,
        offerId: agreement.offerId,
        providerId: providerActor.id,
        ownerAddress: agreement.userAddr,
        details: {},
      });
    }
  }

  async deleteResource(
    agreement: Agreement,
    offer: Offer,
    ptAddress: Address,
    provider: AbstractProvider
  ) {
    try {
      const resource = await DB.getResource(
        agreement.id,
        agreement.userAddr,
        ptAddress
      );
      if (resource) {
        const [offerDetailFile] = await DB.getDetailFiles([offer.detailsLink]);

        if (!offerDetailFile) {
          provider.logger.warning(
            `Details file is not found for Offer ${agreement.offerId}@${ptAddress}`
          );
        }

        await provider.delete(
          agreement,
          {
            ...offer,
            details: tryParseJSON(offerDetailFile?.content, true),
          },
          resource
        );
        provider.logger.info(
          `Resource of Agreement ${colorNumber(
            agreement.id
          )} has been deleted successfully`
        );
      } else {
        provider.logger.warning(
          `Resource of agreement ${colorNumber(
            agreement.id
          )} is not found or not active`
        );
      }
    } catch (err: any) {
      provider.logger.error(`Error while deleting the resource: ${err.stack}`);
    }

    await DB.deleteResource(agreement.id, ptAddress);
  }

  /**
   * Gets all the Agreements that are belong
   * to the given Provider and its Virtual Providers.
   */
  async getAgreementsOfProvider(provider: AbstractProvider, status: Status) {
    const getAgreementOptions: GetAgreementsOptions = {
      protocolAddress: provider.protocol.address.toLowerCase() as Address,
      autoPaginate: true,
      status,
    };

    const providerAgreements = await indexerClient
      .getAgreements({
        // Use common options
        ...getAgreementOptions,

        // Only fetch the Agreements of the Provider
        providerAddress: provider.actor.ownerAddr.toLowerCase() as Address,
      })
      .then((res) => res.data);

    // Get Agreements for the Virtual Providers (if there is any in the Provider)
    const vProviderAgreements: IndexerAgreement[] = [];

    for (const vprov of provider.virtualProviders) {
      const agreements = await indexerClient
        .getAgreements({
          // Use common options
          ...getAgreementOptions,

          // Only fetch the Agreements of the Virtual Provider
          providerAddress: vprov.actor.ownerAddr.toLowerCase() as Address,
        })
        .then((res) => res.data);

      // Store all the found Agreements into the array
      vProviderAgreements.push(...agreements);
    }

    // Change the flag because now we know that the Indexer is healthy
    this.markIndexerAsHealthy();

    // Return all the Agreements that are fetched
    return [...providerAgreements, ...vProviderAgreements];
  }

  async processAgreementCreationEvent(params: {
    agreementId: number;
    offerId: number;
    userAddress: Address;
    provider: AbstractProvider;
  }) {
    params.provider.logger.debug(
      `Processing Agreement creation event for Agreement ${colorNumber(
        params.agreementId
      )} with Offer ${colorNumber(params.offerId)} @ ${colorHex(
        params.provider.protocol.address
      )} User Address: ${colorHex(params.userAddress)}`
    );

    const resource = await DB.getResource(
      params.agreementId,
      params.userAddress,
      params.provider.protocol.address
    );

    // If the resource is presented in the database, that means we've
    // already processed this event so we can skip it
    if (resource) {
      return;
    }

    const agreement = await indexerClient
      .getAgreements({
        id: params.agreementId,
        protocolAddress:
          params.provider.protocol.address.toLowerCase() as Address,
        status: Status.Active,
      })
      .then((res) => res.data[0]);

    // If there is no active Agreement for the given ID and Protocol, that means
    // the Agreement is already closed before we process the event.
    if (!agreement) {
      return;
    }

    params.provider.logger.info(
      `${ansis.green.bold("Creating")} Resource of Agreement ${colorNumber(
        agreement.id
      )} by Provider ${colorHex(agreement.providerAddress)}`
    );

    // TODO: Because of the AbstractProvider uses blockchain data types (e.g "Agreement", "Offer") in its "create" method, we need to fetch the data from the blockchain to keep the backward compatibility
    const offer = await params.provider.protocol.getOffer(agreement.offerId);

    // This object points to the Provider that is responsible from the Agreement.
    // It might be the Provider itself or one of the Virtual Providers that are
    // registered in it.
    const providerActor: { id: number; ownerAddr: Address } = {
      // Fill out with dummy values
      id: -1,
      ownerAddr: "0x",
    };

    // If the Agreement is coming from the Provider itself, then use its Actor info
    if (
      agreement.providerAddress.toLowerCase() ===
      params.provider.actor.ownerAddr.toLowerCase()
    ) {
      providerActor.id = params.provider.actor.id;
      providerActor.ownerAddr = params.provider.actor.ownerAddr;
    } else {
      // Otherwise search from its Virtual Providers
      const vprovActor = params.provider.virtualProviders.findByAddress(
        agreement.providerAddress
      );

      // If the Virtual Provider is not available (e.g vPROV hasn't
      // been registered in the Gateway Provider), throw an error
      // since there is nothing that we can do.
      if (!vprovActor) {
        throw new Error(
          `The Agreement ${agreement.id} @ ${colorHex(
            params.provider.protocol.address
          )} is being processed by Provider ${colorHex(
            params.provider.actor.ownerAddr
          )} (ID: ${params.provider.actor.id}, tag: ${
            params.provider.tag
          }) but the Agreement is not belong to that Provider or any of its Virtual Providers`
        );
      }

      // vPROV is found so use its Actor info
      providerActor.id = vprovActor.actor.id;
      providerActor.ownerAddr = vprovActor.actor.ownerAddr;
    }

    await this.createResource(
      indexerAgreementToAgreement(agreement, offer.id),
      offer,
      params.provider.protocol.address,
      params.provider,
      providerActor
    );
  }

  async processAgreementCloseEvent(params: {
    agreementId: number;
    provider: AbstractProvider;
  }) {
    params.provider.logger.debug(
      `Processing Agreement close event for Agreement ${colorNumber(
        params.agreementId
      )} @ ${colorHex(params.provider.protocol.address)}`
    );

    const agreement = await indexerClient
      .getAgreements({
        id: params.agreementId,
        protocolAddress:
          params.provider.protocol.address.toLowerCase() as Address,
        status: Status.NotActive,
      })
      .then((res) => res.data[0]);

    // Small or zero possibility since Agreement close event only emitted after
    // the creation one and in that case the Agreement must be indexed by
    // the Indexer, but check it for sake of the type safety.
    if (!agreement) {
      throw new Error(
        `Agreement ${params.agreementId} @ ${params.provider.protocol.address} is not found`
      );
    }

    const resource = await DB.getResource(
      params.agreementId,
      agreement.userAddress,
      params.provider.protocol.address
    );

    // If the resource is not found in the database that means the Agreement
    // is deleted before we create the resource so we can simply continue.
    if (!resource) {
      return;
    }

    // If the resource is marked as inactive, that means we've
    // already processed this event so we can skip it
    if (resource.isActive === false) {
      return;
    }

    // TODO: Because of the AbstractProvider uses blockchain data types (e.g "Agreement", "Offer") we need to fetch the data from the blockchain to keep the backward compatibility
    const offer = await params.provider.protocol.getOffer(agreement.offerId);

    await this.deleteResource(
      indexerAgreementToAgreement(agreement, offer.id),
      offer,
      params.provider.protocol.address,
      params.provider
    );
  }

  async getEventsOfProtocol(
    protocolAddress: Address,
    eventName: "AgreementCreated" | "AgreementClosed"
  ) {
    logger.debug(
      `Getting ${eventName} events from ${colorHex(
        protocolAddress
      )} between ${colorNumber(this.lastProcessedBlock + 1n)} and ${colorNumber(
        this.lastProcessedBlock + config.BLOCK_PROCESS_RANGE
      )}`
    );

    const events = await indexerClient
      .getEvents({
        autoPaginate: true,
        fromBlock: this.lastProcessedBlock + 1n, // Skip the last processed block by adding 1
        toBlock: this.lastProcessedBlock + config.BLOCK_PROCESS_RANGE,
        limit: 1000,
        processed: true,
        eventName, // NOTE: Exact SC event name
        contractAddress: protocolAddress.toLowerCase() as Address,
      })
      .then((res) => res.data);

    // TODO: Once the `/events` endpoint from the Indexer supports ordering, remove the following;
    // Sort ascending by block number
    events.sort((a, b) => {
      const aNumber = BigInt(a.blockNumber);
      const bNumber = BigInt(b.blockNumber);

      if (aNumber > bNumber) {
        return 1;
      } else if (aNumber < bNumber) {
        return -1;
      }

      return 0;
    });

    return events;
  }

  /**
   * Marks the Indexer error log track as false. Check the example situation below:
   * If Indexer becomes unhealthy at some point, the daemon logs an error message.
   * But it logs that error message only once to save space from the logs
   * (we don't want to see the same error messages for 1000~ lines)
   * The daemon keep track of whether it already logged that error message
   * with `logTrackings` variable. This function marks value that tracks the error
   * message as false so the error message can be logged again.
   */
  async markIndexerAsHealthy() {
    if (this.logTrackings[LOG_TRACK_INDEXER_HEALTH]) {
      logger.info(`Indexer is healthy`);
    }

    this.logTrackings[LOG_TRACK_INDEXER_HEALTH] = false;
  }

  async main() {
    await this.init();

    logger.info("Daemon is started");

    const errorHandler = async (err: unknown, provider: AbstractProvider) => {
      const error = ensureError(err);
      const indexerError = await this.checkIndexerHealthy(error);

      if (!indexerError && !isTermination(error)) {
        provider.logger.error(`Error: ${error.stack}`);
      }
    };

    this.lastProcessedBlock = BigInt(
      (await DB.getConfig(CONFIG_LAST_PROCESSED_BLOCK)) ||
        (await rpcClient.getBlockNumber())
    );
    while (!abortController.signal.aborted) {
      let highestProcessedBlock = 0n;

      for (const [, provider] of Object.entries(this.providers)) {
        // Get all the Agreement related events
        const agreementEnterEvents = await this.getEventsOfProtocol(
          provider.protocol.address.toLowerCase() as Address,
          "AgreementCreated"
        )
          .then((e) => {
            this.markIndexerAsHealthy();
            return e;
          })
          .catch((err) => {
            errorHandler(err, provider);
            return [];
          });

        const agreementCloseEvents = await this.getEventsOfProtocol(
          provider.protocol.address.toLowerCase() as Address,
          "AgreementClosed"
        )
          .then((e) => {
            this.markIndexerAsHealthy();
            return e;
          })
          .catch((err) => {
            errorHandler(err, provider);
            return [];
          });

        for (const event of agreementEnterEvents) {
          await this.processAgreementCreationEvent({
            agreementId: event.args.id,
            offerId: event.args.offerId,
            userAddress: event.args.userAddr,
            provider,
          })
            .then(() => this.markIndexerAsHealthy())
            .catch((err) => errorHandler(err, provider));

          // Keep track of the highest processed block
          const eventBlock = BigInt(event.blockNumber);
          if (eventBlock > highestProcessedBlock) {
            highestProcessedBlock = eventBlock;
          }
        }
        for (const event of agreementCloseEvents) {
          await this.processAgreementCloseEvent({
            agreementId: event.args.id,
            provider,
          })
            .then(() => this.markIndexerAsHealthy())
            .catch((err) => errorHandler(err, provider));

          // Keep track of the highest processed block
          const eventBlock = BigInt(event.blockNumber);
          if (eventBlock > highestProcessedBlock) {
            highestProcessedBlock = eventBlock;
          }
        }
      }

      // If there is no event found in the block range, move to the next range
      // because now we know that in that block range there is nothing that we can process
      if (highestProcessedBlock < this.lastProcessedBlock) {
        highestProcessedBlock =
          this.lastProcessedBlock + config.BLOCK_PROCESS_RANGE;
      }

      // Update the highest processed block since we've
      // already processed all of them for all the Providers
      this.lastProcessedBlock = highestProcessedBlock;
      await DB.setConfig(
        CONFIG_LAST_PROCESSED_BLOCK,
        this.lastProcessedBlock.toString()
      );

      await sleep(
        config.AGREEMENT_CHECK_INTERVAL,
        abortController.signal
      ).catch(() => {}); // Termination signal is received
    }

    logger.info("Waiting for cleanup...");

    // Execute cleanup functions and wait for them to finish
    await Promise.all(cleanupHandlers.map((fn) => fn()));
  }

  async checkAgreementBalances() {
    // Check if there is another execution of this function
    if (this.isCheckingAgreementBalances) {
      return;
    }
    this.isCheckingAgreementBalances = true;

    // Check all Agreements of the Providers
    for (const [, provider] of Object.entries(this.providers)) {
      try {
        // Gets all the active Agreements of the Provider
        // including its Virtual Providers
        const agreements = await this.getAgreementsOfProvider(
          provider,
          Status.Active
        );

        // Filter the Agreements that don't have enough balance
        const agreementsToBeClosed = agreements.filter(
          (agreement) => BigInt(agreement.balance) <= 0n
        );

        for (const agreement of agreementsToBeClosed) {
          provider.logger.warning(
            `Agreement ${colorNumber(agreement.id)}@${colorHex(
              agreement.protocolAddress
            )} ran out of balance, closing...`
          );

          await provider.protocol.closeAgreement(agreement.id).catch((err) => {
            const error = ensureError(err);
            provider.logger.error(
              `Error while closing Agreement ${colorNumber(
                agreement.id
              )}@${colorHex(agreement.protocolAddress)}: ${error.stack}`
            );
          });
        }
      } catch (err) {
        const error = ensureError(err);
        const indexerError = await this.checkIndexerHealthy(error);

        if (!indexerError && !isTermination(error)) {
          provider.logger.error(
            `Error while checking balances of the Agreements of Provider ${colorHex(
              provider.actor.ownerAddr
            )} @ ${colorHex(provider.protocol.address)}: ${error.stack}`
          );
        }
      }
    }

    // Mark the function execution as finished
    this.isCheckingAgreementBalances = false;
  }
}

const program = new Program();
program
  .main()
  .then(() => {
    logger.warning("See ya...");
    process.exit(process.exitCode || 0);
  })
  .catch((err) => {
    const error = ensureError(err);
    logger.error(`Something went wrong: ${error.message}`);
    if (config.NODE_ENV === "dev") {
      logger.error(`Stack: ${error.stack}`);
    }
    process.exit(1);
  });

// eslint-disable-next-line @typescript-eslint/no-unused-vars
interface BigInt {
  /** Convert to BigInt to string form in JSON.stringify */
  toJSON: () => string;
}
(BigInt.prototype as any).toJSON = function () {
  return this.toString();
};
