import { AbstractProvider } from "./abstract/AbstractProvider";
import { MedQAServiceProvider } from "./protocol/provider";

export const providers: Record<string, AbstractProvider> = {
  main: new MedQAServiceProvider(),
};
