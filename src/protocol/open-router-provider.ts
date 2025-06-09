import {
  Agreement,
  DeploymentStatus,
  PipeError,
  PipeResponseCode,
} from "@forest-protocols/sdk";
import { BaseMedQAServiceProvider, MedQADetails } from "./base-provider";
import OpenAI from "openai";
import { config } from "@/config";
import { ChatCompletion, ChatCompletionMessageParam } from "openai/resources";
import { DetailedOffer, Resource } from "@/types";
import { ChatMessage } from "gpt-tokenizer/esm/GptEncoding";
import { encodeChat } from "gpt-tokenizer";

/**
 * openrouter.ai implementation
 */
export class OpenRouterProvider extends BaseMedQAServiceProvider {
  client: OpenAI;
  model?: string;

  constructor(model?: string) {
    super();
    this.client = new OpenAI({
      baseURL: "https://openrouter.ai/api/v1",
      apiKey: config.API_KEY,
    });
    this.model = model;
  }

  async calculateInputTokens(params: {
    agreement: Agreement;
    offer: DetailedOffer;
    resource: Resource;
    chatMessages: ChatMessage[];
  }): Promise<number> {
    // TODO: Implement better way to calculate tokens based on the model. Use GPT-4o's method temporarily
    const tokens = encodeChat(params.chatMessages, "gpt-4o");
    return tokens.length;
  }

  async calculateOutputTokens(params: {
    agreement: Agreement;
    offer: DetailedOffer;
    resource: Resource;
    response: ChatCompletion;
  }): Promise<number> {
    // TODO: Implement better way to calculate tokens based on the model. Use GPT-4o's method temporarily
    const tokens = encodeChat(
      params.response.choices.map((c) => ({
        content: c.message.content!,
        role: c.message.role,
      })),
      "gpt-4o"
    );
    return tokens.length;
  }

  async checkUsage(params: {
    agreement: Agreement;
    offer: DetailedOffer;
    resource: Resource;
  }): Promise<boolean> {
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
    if (!this.model && !params.offer.details.deploymentParams?.model) {
      throw new PipeError(PipeResponseCode.INTERNAL_SERVER_ERROR, {
        message: "Model is not defined",
      });
    }

    // If the model is hardcoded as the constructor parameter then use it.
    // Otherwise try to find out from the Offer details.
    const completion = await this.client.chat.completions.create({
      // One of them will be available because of the `if` statement above
      model: this.model! || params.offer.details.deploymentParams?.model!,
      messages: params.messages,
    });
    return completion;
  }

  async create(
    agreement: Agreement,
    offer: DetailedOffer
  ): Promise<MedQADetails> {
    return {
      Input: 0,
      Input_Limit: offer.details.params["Input Limit"].value,

      Output: 0,
      Output_Limit: offer.details.params["Output Limit"].value,

      status: DeploymentStatus.Running,
    };
  }

  async getDetails(
    agreement: Agreement,
    offer: DetailedOffer,
    resource: Resource
  ): Promise<MedQADetails> {
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
     * Nothing to do
     */
  }
}
