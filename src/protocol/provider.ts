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

    /**
     * This is one of the protocol-wide actions. All Providers that are registered
     * in this Protocol need to implement this. It gets triggered based on the
     * Protocol definition. You (Provider) need to implement it according
     * to its definition and based on your providing way.
     */

    // Find the meaning of the life...
    const result =
      0b101010 - (crypto.getRandomValues(new Uint8Array(1))[0] & 1);

    return {
      numberResult: result,
      stringResult: `According to ${resource.name}, the meaning of the life is ${result}`,
    };
  }

  async create(
    agreement: Agreement,
    offer: DetailedOffer
  ): Promise<ExampleResourceDetails> {
    /**
     * TODO: Implement how the Resource will be created.
     */

    /**
     * This is one of the network-wide actions. All Protocols and all Providers
     * need to implement this. It gets triggered based on a blockchain event
     * once a User enters a new Agreement. The base daemon code calls this function
     * and creates a corresponding Resource entry in the database. You (Provider) only
     * need to implement the actual creation process of the Resource in your infra.
     *
     * If there is no additional action needed for the creation, you can leave this
     * method as empty and return base details like shown below:
     */

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
     * TODO: Implement retrieval of the details from the actual Resource source.
     */

    /**
     * This is one of the network-wide actions. All Protocols and all Providers
     * need to implement this. It gets triggered periodically if the `create()`
     * method returned a status other than `DeploymentStatus.Running` until the
     * deployment status that is returned from this function is `Running`.
     *
     * If there is no logic to retrieve details from the Resource, you can
     * simply return the existing details like shown below:
     */

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
     * TODO: Implement how the Resource will be deleted.
     */

    /**
     * This is one of the network-wide actions. All Protocols and all Providers
     * need to implement this. It gets triggered based on a blockchain event
     * once a User cancels an agreement. The base daemon code calls this function
     * and deletes a corresponding Resource entry in the database. You (Provider) only
     * need to implement the actual deletion process of the Resource in your infra.
     *
     * If there is no additional action needed for deletion, you can leave this
     * method as empty.
     */
    throw new Error("Method not implemented.");
  }
}
