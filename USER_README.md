# User interaction with an Agreement with Forest CLI Tool

### Within my case as LLM, I will be using the https://openrouter.ai to get API keys and the model that I expect to get the response. Therefore, you have to register and get the API key and the model that you want to use for the service.

### Open Router API Key and API Endpoint:

```txt
API_KEY=""
API_ENDPOINT="https://openrouter.ai/api/v1"
```

1. [Enter an agreement](#1-enter-an-agreement-for-specific-offer-within-the-pc),

#### Enter an agreement for specific offer within the PC:

```txt
Public key: <adress>
Private key: <private key>
PC Address: <PC that you want to enter offer with>
Offer ID: <offer id>
```

# Important:

To register the agreement within the system the backend provider should be spinned up and listen to blockchain to register resource and agrement that user is going to enter based on the
PC address and offer id.

1. Check your balance with the following command:

```sh
forest wallet balance <your public evm address>
```

Return value will be like the example below:

```txt
0.01 ETH
2.8 USDC
1000 FOREST
```

### Note:

Make sure that you have enough Optimism Sepolia ETH to cover transaction costs, you need also USDC testnet tokens to
pay 2 month prepayment for the service.

2. You have to prepare your private key to enter an agreement and copy/paste your command within the new opened terminal.
3. Run the command to find the offer you want to enter an agreement with. You can do it with the following command:

```sh
forest get offers <product category address>
```

Return value will be like the example below:

```txt
ID @ Product Category: 0 @ 0xf833d786374AEbC580eC389BE21A4CC340B543CD
Provider: 0x354cc7AC43c4681976bd926271524f6E28db2c96
Status: Active
Fee Per Second: 0.000001 USDC
Fee Per Month: 2.6352 USDC
Total Stock: 100
Active Agreements: 0
CID: bagaaiera3by5b3mykt7n2q2e4yvglgoh33ssoat5qczvgo75ii5yrxamo2aq
```

4. Run the command to enter an agreement with the offer you want. You can do it with the following command:

```sh
forest agreement enter \
  --account <private key file path OR private key itself of the Provider account> \
  { pcAddress } \
  { offer id } \
  { initial deposit if not passed, default value is defined }
```

## Congratulations! You have entered an agreement with the Provider for the specific offer within the Product Category.

Right now we want to test if user can send a request to user this service and we are having a pipe method within the Forest CLI tool:

```sh
forest pipe <provider address> \
POST \
"/chat/completions" \
--body '{"providerId": 13,"id": 7,
"model": "deepseek/deepseek-r1-distill-llama-70b:free", "messages" : [{"role": "user","content": "Say hello world" } ], "pc": "0xf833d786374AEbC580eC389BE21A4CC340B543CD" }' \
--account <account private key as plain text or file path>
```
