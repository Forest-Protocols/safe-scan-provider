import { Agreement, IndexerAgreement } from "@forest-protocols/sdk";

/**
 * Converts the given IndexerAgreement object into a Agreement
 * object that comes blockchain data. This approach allow to pass
 * an Agreement that is fetched from the Indexer to a function that
 * expects blockchain Agreement object type
 * @param agreement
 * @param offerId
 * @returns
 */
export function indexerAgreementToAgreement(
  agreement: IndexerAgreement,
  offerId: number
) {
  return {
    id: agreement.id,
    balance: BigInt(agreement.balance),
    endTs: agreement.endTs
      ? BigInt(new Date(agreement.endTs).getTime() / 1000)
      : 0n,
    offerId,
    provClaimedAmount: BigInt(agreement.provClaimedAmount),
    provClaimedTs: BigInt(new Date(agreement.provClaimedTs).getTime() / 1000),
    startTs: BigInt(new Date(agreement.startTs).getTime() / 1000),
    status: agreement.status,
    userAddr: agreement.userAddress,
  } as Agreement;
}
