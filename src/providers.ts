import { AbstractProvider } from "./abstract/AbstractProvider";
import { OpenRouterProvider } from "./protocol/open-router-provider";

export const providers: Record<string, AbstractProvider> = {
  main: new OpenRouterProvider("anthropic/claude-3.7-sonnet"),
};
