import {
  addressSchema,
  Agreement,
  MaybePromise,
  PipeError,
  PipeMethod,
  PipeResponseCode,
  tryParseJSON,
  validateBodyOrParams,
} from "@forest-protocols/sdk";
import { AbstractProvider } from "@/abstract/AbstractProvider";
import {
  DetailedOffer,
  MedQAOfferDetails,
  Resource,
  ResourceDetails,
} from "@/types";

import { z } from "zod";
import { Address } from "viem";
import { ChatCompletion, ChatCompletionMessageParam } from "openai/resources";
import { DB } from "@/database/client";
import { ChatMessage } from "gpt-tokenizer/esm/GptEncoding";

export type MedQADetails = ResourceDetails & {
  Input: number;
  Output: number;
  Input_Limit: number;
  Output_Limit: number;
};

export abstract class BaseMedQAServiceProvider extends AbstractProvider<MedQADetails> {
  /**
   * Calculates the input tokens and returns it. The return value is saved
   * to the Resource details in order to track usage.
   * @param model The model that is going to be used.
   * @param chatMessages The messages that will be sent to the LLM.
   */
  abstract calculateInputTokens(params: {
    agreement: Agreement;
    offer: DetailedOffer;
    resource: Resource;
    chatMessages: ChatMessage[];
  }): MaybePromise<number>;

  /**
   * Calculates the output tokens and returns it. The return value is saved
   * to the Resource details in order to track usage.
   * @param chatMessages The messages that will be sent to the LLM.
   */
  abstract calculateOutputTokens(params: {
    agreement: Agreement;
    offer: DetailedOffer;
    resource: Resource;
    response: ChatCompletion;
  }): MaybePromise<number>;

  /**
   * Checks the usage of the Resource. Based on the
   * return value the requests will be allowed or rejected.
   */
  abstract checkUsage(params: {
    agreement: Agreement;
    offer: DetailedOffer;
    resource: Resource;
  }): MaybePromise<boolean>;

  /**
   * Prompts the given messages to the model and returns the response.
   * @param model Model to be used.
   * @param messages The messages that will be sent to the LLM.
   */
  abstract completions(params: {
    agreement: Agreement;
    offer: DetailedOffer;
    resource: Resource;
    messages: Array<ChatCompletionMessageParam>;
  }): MaybePromise<ChatCompletion>;

  async init(providerTag: string) {
    // Base class' `init` function must be called.
    await super.init(providerTag);

    this.route(PipeMethod.POST, "/chat/completions", async (req) => {
      const bodyParams = z.object({
        id: z.number(),
        messages: z.array(
          z.object({
            content: z.string(),
            role: z.enum(["system", "user", "assistant"]),
          })
        ),
        pt: addressSchema,
      });

      // Validate the body params
      const body = validateBodyOrParams(req.body, bodyParams);

      // Retrieve the Resource from the database and check Agreement status (`getResource` does everything)
      const { resource, agreement } = await this.getResource(
        body.id,
        body.pt as Address,
        req.requester
      );

      // Fetch the Offer that used to create the Resource
      const rawOffer = await this.protocol.getOffer(agreement.offerId);

      // Fetch the details of the Offer from the database
      const [offerDetails] = await DB.getDetailFiles([rawOffer.detailsLink]);

      // If the details is not found that means we cannot go further because the Provider
      // is misconfigured and doesn't have access to the details file of the Offer that
      // registered on-chain.
      if (!offerDetails) {
        throw new PipeError(PipeResponseCode.INTERNAL_SERVER_ERROR, {
          message: "Offer details not found",
        });
      }

      const parsedDetails: MedQAOfferDetails | undefined = tryParseJSON(
        offerDetails.content
      );

      // If we couldn't parse the details that means the Offer was misconfigured.
      // That means we don't know which model is going to be used as well.
      if (!parsedDetails) {
        throw new PipeError(PipeResponseCode.INTERNAL_SERVER_ERROR, {
          message: "Invalid Offer details",
        });
      }

      // Offer data that combined with the details and on-chain information
      const offer: DetailedOffer = {
        ...rawOffer,
        details: parsedDetails,
      };

      const isAllowed = await this.checkUsage({
        agreement,
        offer,
        resource,
      });

      if (!isAllowed) {
        throw new PipeError(PipeResponseCode.BAD_REQUEST, {
          message: "The usage exceeded the limits",
        });
      }

      // Calculate the input tokens and send the messages to the LLM
      // then calculate output tokens as well to account the usage.
      const inputTokens = await this.calculateInputTokens({
        agreement,
        resource,
        offer,
        chatMessages: body.messages,
      });
      const llmResponse = await this.completions({
        agreement,
        resource,
        offer,
        messages: body.messages,
      });
      const outputTokens = await this.calculateOutputTokens({
        agreement,
        offer,
        resource,
        response: llmResponse,
      });

      // Update the Resource record to include new usage
      await DB.updateResource(resource.id, resource.ptAddress, {
        details: {
          ...resource.details,
          Input: resource.details.Input + inputTokens,
          Output: resource.details.Output + outputTokens,
        } as MedQADetails,
      });

      return {
        code: PipeResponseCode.OK,
        body: {
          completions: llmResponse,
        },
      };
    });
  }
}
