import { Agreement } from "@forest-protocols/sdk";
import {
  BaseExampleServiceProvider,
  ExampleResourceDetails,
} from "./base-provider";
import { DetailedOffer, Resource } from "@/types";

/**
 * The main class that implements provider specific actions.
 * @responsible Provider
 * @implements {BaseExampleServiceProvider}
 */
export class MainProviderImplementation extends BaseExampleServiceProvider {
  async doSomething(
    agreement: Agreement,
    resource: Resource,
    additionalArgument: string
  ): Promise<{ stringResult: string; numberResult: number }> {
    /**
     * TODO: Implement the logic of this protocol-specific action.
     */

    // An example;

    // Some important logic....

    return {
      numberResult: agreement.id,
      stringResult: `${resource.name}-${additionalArgument}`,
    };
  }

  async create(
    agreement: Agreement,
    offer: DetailedOffer
  ): Promise<ExampleResourceDetails> {
    /**
     * TODO: Implement how the resource will be created. 
     */
    // This is one of the network-wide actions. All Protocols and all Providers need to implement this.
    // It gets triggered based on a blockchain event once a User enters a new agreement.
    // If there is no additional action needed for creation, you can
    // just leave this method as empty and return mandatory details:
    /*  return {
      status: DeploymentStatus.Running,
      _examplePrivateDetailWontSentToUser: "string data",
      Example_Detail: 42,
    }; */

    throw new Error("Method not implemented.");
  }

  async getDetails(
    agreement: Agreement,
    offer: DetailedOffer,
    resource: Resource
  ): Promise<ExampleResourceDetails> {
    /**
     * TODO: Implement how the details retrieved from the resource source.
     */
    // This is one of the network-wide actions. All Protocols and all Providers need to implement this.
    // If there is no details, you can just return the existing ones;
    /* return {
      ...resource.details,
      status: resource.deploymentStatus,
    }; */
    throw new Error("Method not implemented.");
  }

  async delete(
    agreement: Agreement,
    offer: DetailedOffer,
    resource: Resource
  ): Promise<void> {
    /**
     * TODO: Implement how the resource will be deleted.
     */
    // This is one of the network-wide actions. All Protocols and all Providers need to implement this.
    // It gets triggered based on a blockchain event once a User cancels an agreement.
    throw new Error("Method not implemented.");
  }
}
