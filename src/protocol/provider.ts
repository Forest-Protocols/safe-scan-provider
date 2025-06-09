import { Agreement, DeploymentStatus } from "@forest-protocols/sdk";
import { BaseMedQAServiceProvider, MedQADetails } from "./base-provider";
import { DetailedOffer, Resource } from "@/types";
import { ChatCompletion, ChatCompletionMessageParam } from "openai/resources";
import { ChatMessage } from "gpt-tokenizer/esm/GptEncoding";
import { encodeChat } from "gpt-tokenizer";

/**
 * Provider implementation for Generic LLM
 */
export class MedQAServiceProvider extends BaseMedQAServiceProvider {
  async calculateInputTokens(params: {
    agreement: Agreement;
    offer: DetailedOffer;
    resource: Resource;
    chatMessages: ChatMessage[];
  }): Promise<number> {
    /**
     * TODO: Implement how to calculate the input tokens
     */

    // Example implementation:
    const tokens = encodeChat(
      params.chatMessages,
      (params.offer.details.deploymentParams?.model as any) || "gpt-4o"
    );
    return tokens.length;
  }

  async calculateOutputTokens(params: {
    agreement: Agreement;
    offer: DetailedOffer;
    resource: Resource;
    response: ChatCompletion;
  }): Promise<number> {
    /**
     * TODO: Implement how to calculate the output tokens
     */

    // Example implementation:
    const tokens = encodeChat(
      params.response.choices.map((c) => ({
        content: c.message.content!,
        role: c.message.role,
      })),
      params.response.model as any
    );
    return tokens.length;
  }

  async checkUsage(params: {
    agreement: Agreement;
    offer: DetailedOffer;
    resource: Resource;
  }): Promise<boolean> {
    /**
     * TODO: Implement how to decide whether the usage is exceeded the limits
     */

    // Example implementation:
    const details: MedQADetails = params.resource.details;
    return (
      details.Input < details.Input_Limit &&
      details.Output < details.Output_Limit
    );
  }

  async completions(params: {
    agreement: Agreement;
    offer: DetailedOffer;
    resource: Resource;
    messages: Array<ChatCompletionMessageParam>;
  }): Promise<ChatCompletion> {
    /**
     * TODO: Implement how the completions requests will be sent to the LLM
     */
    throw new Error("Method not implemented.");
  }

  async create(
    agreement: Agreement,
    offer: DetailedOffer
  ): Promise<MedQADetails> {
    /**
     * TODO: Implement how the resource will be created.
     */

    return {
      Input: 0,
      Input_Limit: offer.details.params.Input.value,

      Output: 0,
      Output_Limit: offer.details.params.Output.value,

      status: DeploymentStatus.Running,
    };
  }

  async getDetails(
    agreement: Agreement,
    offer: DetailedOffer,
    resource: Resource
  ): Promise<MedQADetails> {
    /**
     * TODO: Implement retrieval of the details from the actual Resource source.
     */

    // If there is no extra action to retrieve the details, the default values can be returned.
    return {
      ...resource.details,
      status: resource.deploymentStatus,
    };
  }

  async delete(
    agreement: Agreement,
    offer: DetailedOffer,
    resource: Resource
  ): Promise<void> {
    /**
     * TODO: Implement how the Resource will be deleted.
     */
  }
}
