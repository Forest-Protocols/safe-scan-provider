import { PipeError, PipeResponseCodes } from "@forest-protocols/sdk";

export class PipeErrorUnauthorized extends PipeError {
  constructor() {
    super(PipeResponseCodes.NOT_AUTHORIZED, {
      message: `Unauthorized`,
    });
    this.name = this.constructor.name;
    Error.captureStackTrace(this, this.constructor);
  }
}
