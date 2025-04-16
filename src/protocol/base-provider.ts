import {
  addressSchema,
  Agreement,
  PipeMethod,
  PipeResponseCode,
  validateBodyOrParams,
} from "@forest-protocols/sdk";
import { AbstractProvider } from "@/abstract/AbstractProvider";
import { Resource, ResourceDetails } from "@/types";
import { z } from "zod";
import { Address } from "viem";

/**
 * Defines the structure of details stored for each created Resource.
 * Contains both public and private information about the resource.
 * @responsible Protocol Owner
 * @property Example_Detail - A numeric value representing [describe purpose]
 * @property _examplePrivateDetailWontSentToUser - Internal data not exposed to users
 */
export type ExampleResourceDetails = ResourceDetails & {
  Example_Detail: number;

  /* This field won't be sent when the User requested it */
  _examplePrivateDetailWontSentToUser: string;
};

/**
 * Abstract base class defining required actions for this Protocol implementation.
 * All Protocol providers must extend this class and implement its abstract methods.
 * @responsible Protocol Owner
 * @abstract
 * @template ExampleResourceDetails - Type defining resource details structure
 */
export abstract class BaseExampleServiceProvider extends AbstractProvider<ExampleResourceDetails> {
  // These are network-wide actions defined in `AbstractProvider` from which this class inherits. They have to be implemented by all of the Providers.
  /**
   * abstract create(agreement: Agreement, offer: DetailedOffer): Promise<T>;
   *
   * abstract getDetails(
   *  agreement: Agreement,
   *  offer: DetailedOffer,
   *  resource: Resource
   * ): Promise<T>;
   *
   * abstract delete(
   *  agreement: Agreement,
   *  offer: DetailedOffer,
   *  resource: Resource
   * ): Promise<void>;
   */

  /**
   * An example function that represents protocol-specific action. This
   * function has to be implemented by all of the Providers who want to
   * participate in this Protocol.
   *
   * The definition is up to the Protocol Owner. So if some of the
   * arguments are not needed, they can be deleted. E.g. `agreement` or
   * `resource` can be deleted if they are unnecessary for this particular implementation.
   * @param agreement On-chain agreement data.
   * @param resource Resource information stored in the database.
   * @param additionalArgument Extra argument that related to the functionality (if needed).
   * @returns Promise containing string and number results
   * @throws {Error} When the operation fails
   */
  abstract doSomething(
    agreement: Agreement,
    resource: Resource,
    additionalArgument: string
  ): Promise<{ stringResult: string; numberResult: number }>;

  async init(providerTag: string) {
    // Base class' `init` function must be called.
    await super.init(providerTag);

    /**
     * If your service has some functionalities/interactions (like "doSomething" method)
     * you can define "Pipe" routes to map the incoming requests from end users to the
     * corresponding methods.
     *
     * Pipe is a simple abstraction layer that allows Actors to communicate with each other in a
     * HTTP-like request-response style.
     *
     * Take a look at the example below:
     */

    /** Calls "doSomething" method. */
    this.route(PipeMethod.GET, "/do-something", async (req) => {
      /**
       * Validate the params/body of the request. If they are not valid,
       * request will reply back to the user with a validation error message
       * and a 'bad request' code automatically.
       */
      const body = validateBodyOrParams(
        req.body,
        z.object({
          /** ID of the resource. */
          id: z.number(),

          /** Protocol address in which the resource was created. */
          pt: addressSchema, // A pre-defined Zod schema for smart contract addresses.

          /** Additional argument for the method. */
          argument: z.string(),
        })
      );

      /**
       * Retrieve the resource from the database.
       *
       * IMPORTANT NOTE:
       * We need to authorize the user (to be sure that he is the actual owner
       * of the resource) before processing the request. To do this, we can
       * use `this.getResource`. This method tries to find the resource data
       * in the database based on the requester and throws relevant errors if it cannot be found.
       * If the requester is not the owner of the resource, it won't be found either.
       *
       * Even if you are not using the Resource data, you need to call the `this.getResource`
       * method in the endpoints that serve Users based on a Resource purchase.
       * This is because this method checks whether the requesting User is authorized
       * to use the Resource, whether the relevant Agreement is still active and has sufficient
       * funds. Otherwise we are responding to requests that do not meet these conditions,
       * which is not desirable.
       */
      const { agreement, resource } = await this.getResource(
        body.id,
        body.pt as Address,
        req.requester
      );

      // Call the actual method logic and retrieve the results.
      const result = await this.doSomething(agreement, resource, body.argument);

      // Return the response with the results.
      return {
        code: PipeResponseCode.OK,
        body: result,
      };
    });
  }
}
