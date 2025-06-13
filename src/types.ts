import {
  DeploymentStatus,
  Offer,
  OfferDetails,
  PipeRequest,
  PipeRouteHandlerResponse,
} from "@forest-protocols/sdk";
import { Address } from "viem";

/**
 * The base details that should be gathered by
 * the provider from the actual resource source.
 */
export type ResourceDetails = {
  status: DeploymentStatus;

  /**
   * Name of the resource. If it is undefined,
   * a random name will be assigned to the resource. */
  name?: string;
  [key: string]: any;
};

/**
 * Resource record from the database.
 */
export type Resource = {
  id: number;
  name: string;
  deploymentStatus: DeploymentStatus;
  details: any;
  groupName: string;
  isActive: boolean;
  ownerAddress: Address;
  offerId: number;
  providerId: number;
  providerAddress: Address;
  ptAddress: Address;
};

export type MedQAOfferDetails = Omit<
  OfferDetails,
  "deploymentParams" | "params"
> & {
  deploymentParams?: {
    model?: string;
  };
  params: {
    "Input Limit": {
      value: number;
      unit: string;
    };
    "Output Limit": {
      value: number;
      unit: string;
    };
    Features: string[];
  };
};

export type DetailedOffer = Offer & {
  details?: string | MedQAOfferDetails;
};

export type ProviderPipeRouteHandler = (
  req: PipeRequest & { providerId: number }
) => Promise<PipeRouteHandlerResponse | void> | PipeRouteHandlerResponse | void;
