#!/usr/bin/env node
import {
  Agreement,
  DeploymentStatus,
  Indexer,
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
import { MainProviderImplementation } from "./protocol/provider";
import {
  adjectives,
  animals,
  colors,
  uniqueNamesGenerator,
} from "unique-names-generator";
import { join } from "path";
import { readdirSync, readFileSync, statSync } from "fs";
import { DetailedOffer } from "./types";
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

const CONFIG_LAST_PROCESSED_NEW_AGREEMENT_DATE =
  "LAST_PROCESSED_NEW_AGREEMENT_DATE";
const CONFIG_LAST_PROCESSED_CLOSED_AGREEMENT_DATE =
  "LAST_PROCESSED_CLOSED_AGREEMENT_DATE";

function indexerAgreementToAgreement(
  agreement: IndexerAgreement,
  offerId: number
) {
  return {
    id: agreement.id,
    balance: BigInt(agreement.balance),
    endTs: agreement.endTs
      ? BigInt(new Date(agreement.endTs).getTime() / 1000)
      : 0n,
    offerId,
    provClaimedAmount: BigInt(agreement.provClaimedAmount),
    provClaimedTs: BigInt(new Date(agreement.provClaimedTs).getTime() / 1000),
    startTs: BigInt(new Date(agreement.startTs).getTime() / 1000),
    status: agreement.status,
    userAddr: agreement.userAddress,
  };
}

class Program {
  providers = {
    main: new MainProviderImplementation(),
  };

  indexer = new Indexer({
    baseURL: config.INDEXER_ENDPOINT,
  });

  noNewAgreementLog: Record<string, boolean> = {};
  noClosedAgreementLog: Record<string, boolean> = {};
  indexerIsNotHealthyLog = false;

  constructor() {}

  initHealthcheck() {
    const app = express();
    app.get("/health", (_, res) => {
      res.send("Running");
    });
    app.listen(config.PORT);
  }

  /**
   * Checks if the Indexer is healthy if the given error is an Axios error.
   * Logs an error message only once if it is not healthy.
   * Returns `true` if the error was an Axios error and the Indexer is unhealthy.
   * Returns `false` if the error was not an Axios error or the Indexer is healthy.
   */
  async checkIndexerHealthy(err: unknown) {
    const error = ensureError(err);
    if (isAxiosError(error)) {
      const isHealthy = await this.indexer.isHealthy();

      if (!isHealthy && !this.indexerIsNotHealthyLog) {
        this.indexerIsNotHealthyLog = true;
        logger.error("Indexer is not healthy, cannot fetch data from it");
      }
      return true;
    }

    return false;
  }

  async loadDetailFiles() {
    logger.info("Detail files are loading to the database");
    const basePath = join(process.cwd(), "data/details");
    const files = readdirSync(basePath, { recursive: true }).filter((file) =>
      // Exclude sub-directories
      statSync(join(basePath, file.toString()), {
        throwIfNoEntry: false,
      })?.isFile()
    );
    const contents = files.map((file) =>
      readFileSync(join(basePath, file.toString())).toString("utf-8")
    );
    await DB.saveDetailFiles(contents);
  }

  async init() {
    // Start a healthcheck HTTP server
    this.initHealthcheck();

    // Load detail files into the database
    await this.loadDetailFiles();

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
          provider.actorInfo.ownerAddr
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

  async processAgreementCreated(
    agreement: Agreement,
    offer: Offer,
    ptAddress: Address,
    provider: AbstractProvider
  ) {
    try {
      const [offerDetailFile] = await DB.getDetailFiles([offer.detailsLink]);

      if (!offerDetailFile) {
        provider.logger.warning(
          `Details file is not found for Offer ${agreement.offerId}@${ptAddress} (Provider ID: ${provider.actorInfo.id})`
        );
      }

      const protocol = await DB.getProtocol(ptAddress);
      const detailedOffer: DetailedOffer = {
        ...offer,

        // TODO: Validate schema
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
        providerId: provider.actorInfo.id,
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
        providerId: provider.actorInfo.id,
        ownerAddress: agreement.userAddr,
        details: {},
      });
    }
  }

  async processAgreementClosed(
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

  async checkNewAgreements(provider: AbstractProvider) {
    try {
      const lastProcessedNewAgreementDate = await DB.getConfig(
        CONFIG_LAST_PROCESSED_NEW_AGREEMENT_DATE
      );
      const allAgreements = await this.indexer
        .getAgreements({
          providerAddress:
            provider.actorInfo.ownerAddr.toLowerCase() as Address,
          protocolAddress: provider.protocol.address.toLowerCase() as Address,
          startTs: lastProcessedNewAgreementDate,
          status: Status.Active,
          autoPaginate: true,
          limit: 100,
        })
        .then((res) => res.data);

      this.indexerIsNotHealthyLog = false;

      // Check if those Agreements are already in the database
      const existingAgreements = await DB.getResources(
        allAgreements.map((agreement) => agreement.id)
      );

      // Find non-existing Agreements
      const nonExistingAgreements = allAgreements.filter(
        (agreement) => !existingAgreements.find((a) => a.id == agreement.id)
      );

      if (nonExistingAgreements.length == 0) {
        // If this log message is already logged, don't log it again
        if (!this.noNewAgreementLog[provider.actorInfo.ownerAddr]) {
          provider.logger.info(
            `No new Agreements found for ${colorHex(
              provider.actorInfo.ownerAddr
            )}`
          );
          this.noNewAgreementLog[provider.actorInfo.ownerAddr] = true;
        }
        return;
      }

      provider.logger.info(
        `${ansis.yellow.bold("Found")} ${
          nonExistingAgreements.length
        } new Agreements for ${colorHex(provider.actorInfo.ownerAddr)}`
      );

      for (const agreement of nonExistingAgreements) {
        provider.logger.info(
          `${ansis.green.bold("Creating")} Agreement ${colorNumber(
            agreement.id
          )} by ${colorHex(provider.actorInfo.ownerAddr)}`
        );
        const offer = await provider.protocol.getOffer(agreement.offerId);

        await this.processAgreementCreated(
          indexerAgreementToAgreement(agreement, offer.id),
          offer,
          provider.protocol.address,
          provider
        );

        // Save the last processed new agreement date so
        // in the next iteration we can continue from it.
        await DB.setConfig(
          CONFIG_LAST_PROCESSED_NEW_AGREEMENT_DATE,
          agreement.startTs.toString()
        );

        this.noNewAgreementLog[provider.actorInfo.ownerAddr] = false;
      }
    } catch (err) {
      const error = ensureError(err);
      const indexerError = await this.checkIndexerHealthy(error);

      if (!indexerError && !isTermination(error)) {
        provider.logger.error(
          `Error while fetching the Agreements: ${error.stack}`
        );
      }
    }
  }

  async checkClosedAgreements(provider: AbstractProvider) {
    try {
      const lastProcessedClosedAgreementDate = await DB.getConfig(
        CONFIG_LAST_PROCESSED_CLOSED_AGREEMENT_DATE
      );
      const allAgreements = await this.indexer
        .getAgreements({
          providerAddress:
            provider.actorInfo.ownerAddr.toLowerCase() as Address,
          protocolAddress: provider.protocol.address.toLowerCase() as Address,
          startTs: lastProcessedClosedAgreementDate,
          status: Status.NotActive,
          autoPaginate: true,
          limit: 100,
        })
        .then((res) => res.data);

      this.indexerIsNotHealthyLog = false;

      // Get the existing Agreements from the database
      const existingAgreements = await DB.getResources(
        allAgreements.map((agreement) => agreement.id)
      );

      // Find non-closed ones
      const nonClosedResources = existingAgreements.filter(
        (resource) => resource.isActive
      );

      if (nonClosedResources.length == 0) {
        // If this log message is already logged, don't log it again
        if (!this.noClosedAgreementLog[provider.actorInfo.ownerAddr]) {
          provider.logger.info(
            `No Agreements found to be closed by ${colorHex(
              provider.actorInfo.ownerAddr
            )}`
          );
          this.noClosedAgreementLog[provider.actorInfo.ownerAddr] = true;
        }
        return;
      }

      provider.logger.info(
        `${ansis.yellow.bold("Found")} ${
          nonClosedResources.length
        } Agreements to be closed by ${colorHex(provider.actorInfo.ownerAddr)}`
      );

      for (const resource of nonClosedResources) {
        provider.logger.info(
          `${ansis.red.bold("Closing")} Agreement ${colorNumber(
            resource.id
          )} by ${colorHex(provider.actorInfo.ownerAddr)}`
        );
        const agreement = allAgreements.find(
          (agreement) => agreement.id == resource.id
        )!;
        const offer = await provider.protocol.getOffer(agreement.offerId);

        await this.processAgreementClosed(
          indexerAgreementToAgreement(agreement, offer.id),
          offer,
          provider.protocol.address,
          provider
        );

        // Save the last processed closed agreement date so
        // in the next iteration we can continue from it.
        await DB.setConfig(
          CONFIG_LAST_PROCESSED_CLOSED_AGREEMENT_DATE,
          agreement.startTs
        );

        this.noClosedAgreementLog[provider.actorInfo.ownerAddr] = false;
      }
    } catch (err) {
      const error = ensureError(err);
      const indexerError = await this.checkIndexerHealthy(error);

      if (!indexerError && !isTermination(error)) {
        provider.logger.error(
          `Error while fetching the Agreements: ${error.stack}`
        );
      }
    }
  }

  async main() {
    await this.init();

    logger.info("Daemon is started");

    while (!abortController.signal.aborted) {
      for (const [, provider] of Object.entries(this.providers)) {
        try {
          await this.checkNewAgreements(provider);
          await this.checkClosedAgreements(provider);
        } catch (err) {
          const error = ensureError(err);
          provider.logger.error(`Error: ${error.stack}`);
        }
      }

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
    // Check all Agreements of the Providers
    for (const [, provider] of Object.entries(this.providers)) {
      try {
        const activeAgreements: IndexerAgreement[] = await this.indexer
          .getAgreements({
            providerAddress:
              provider.actorInfo.ownerAddr.toLowerCase() as Address,
            protocolAddress: provider.protocol.address.toLowerCase() as Address,
            status: Status.Active,
            limit: 100,
            autoPaginate: true,
          })
          .then((res) => res.data);

        this.indexerIsNotHealthyLog = false;

        // Filter the Agreements that don't have enough balance
        const agreementsToBeClosed = activeAgreements.filter(
          (agreement) => BigInt(agreement.balance) <= 0n
        );

        for (const agreement of agreementsToBeClosed) {
          provider.logger.warning(
            `Agreement ${colorNumber(agreement.id)}@${colorHex(
              agreement.protocolAddress
            )} ran out of balance, closing...`
          );
          try {
            await provider.protocol.closeAgreement(agreement.id);
          } catch (err) {
            const error = ensureError(err);
            provider.logger.error(
              `Error while closing Agreement ${colorNumber(
                agreement.id
              )}@${colorHex(agreement.protocolAddress)}: ${error.stack}`
            );
          }
        }
      } catch (err) {
        const error = ensureError(err);
        const indexerError = await this.checkIndexerHealthy(error);

        if (!indexerError && !isTermination(error)) {
          provider.logger.error(
            `Error while checking balances of the Agreements@${colorHex(
              provider.protocol.address
            )}: ${error.stack}`
          );
        }
      }
    }
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
