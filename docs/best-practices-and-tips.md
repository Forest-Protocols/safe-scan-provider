# Best practices and tips

This document contains best practice recommendations for Providers and Protocol Owners to follow and some tips to assist them in the implementation process.

## Throw errors

> This section is for **Providers**

For the network-wide actions such as `create()`, `delete()` or `getDetails()`, the errors that are thrown will be caught by the base daemon logic and log proper messages in the output to identify the issue. But be careful, that doesn't mean that the function calls will be retried. It only prevents the daemon from crashing. If you need a retry mechanism, you need to implement it by yourself. Because the daemon expects that those functions will be executed without any issues.

For the protocol-specific actions, since they will be called from the Pipe route handlers, all the errors will be caught by the route handler and return a proper response to the User. If you want to change the error message that User will get in the response, you can throw `PipeError` type. Because if the error type is `PipeError`, route handlers uses the response code and body from the error instance. For demonstration purpose:

**Base Provider**

```typescript
// ....
abstract doSomething(): Promise<number>;

async init() {
    this.route(PipeMethod.GET, "/do-something", async (req) => {
        // ....
        const result = await this.doSomething();
        // ....
    })
}
// ....
```

**Provider Implementation**

```typescript
// ....
async doSomething(): Promise<number> {
    const result = Math.floor(Math.random() * 100);

    if (result >= 50) {
        throw new PipeError(PipeResponseCode.INTERNAL_SERVER_ERROR,
                            { message: "The result found equal or greater than 50" });
    }

    return result
}
// ....
```

So if the `result` is equal or greater than 50, the User will get a proper error message and response code.

## Agreement balances

> This section is for **Providers**

The base daemon periodically checks the balances of all active Agreements made with the Provider in the Protocol. If any Agreement has insufficient balance, it will be force-closed. Providers can configure the check interval using the `AGREEMENT_CHECK_INTERVAL` environment variable. It’s recommended to set a short interval -such as 15 or 30 minutes- to ensure you don’t continue servicing Agreements that lack sufficient balance.
