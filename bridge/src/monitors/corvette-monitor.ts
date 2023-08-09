import { createServer } from "http";
import axios from "axios";
import { Monitor } from ".";
import type { ContractDescription } from "../types/contract-description";
import type { TransactionLocation } from "../types/transaction-location";

const CORVETTE_EVENT_API_URL = "http://localhost:8000/";
const CORVETTE_LISTEN_PORT = 4000;

function delay(ms: number): Promise<void> {
    return new Promise((resolve) => {
        setTimeout(() => {
            resolve();
        }, ms);
    });
}

export interface CorvetteEventResponse {
    timestamp: string;
    blockIndex: number;
    logIndex: number;
    blockHash: string;
    transactionHash: string;
    sourceAddress: string;
    abiHash: string;
    abiSignature: string;
    args: {
        named: Record<string, unknown>;
        ordered: unknown[];
    };
}

export class CorvetteEventMonitor extends Monitor<CorvetteEventResponse> {
    private readonly webhookReceiver;

    private eventDataQueue: Set<CorvetteEventResponse> = new Set();

    constructor(
        private readonly contractDescription: ContractDescription,
        private readonly latestTransactionLocation: TransactionLocation | null
    ) {
        super();

        this.webhookReceiver = this.createWebhookReceiver(CORVETTE_LISTEN_PORT);
    }

    async *loop(): AsyncIterableIterator<{
        blockHash: string;
        events: CorvetteEventResponse[];
    }> {
        if (this.latestTransactionLocation !== null) {
            const { data } = await axios
                .post<CorvetteEventResponse[]>(CORVETTE_EVENT_API_URL, {
                    blockFrom: this.latestTransactionLocation.blockHash,
                })
                .catch((err) => {
                    console.error(err);
                    return { data: [] };
                });
            data.forEach((event) => this.eventDataQueue.add(event));
        }

        while (true) {
            try {
                const eventDataMap = new Map<string, CorvetteEventResponse[]>();

                for (const eventData of this.eventDataQueue) {
                    const { blockHash } = eventData;
                    const blockEventData = eventDataMap.get(blockHash);

                    if (!blockEventData)
                        eventDataMap.set(blockHash, [eventData]);
                    else blockEventData.push(eventData);

                    this.eventDataQueue.delete(eventData);
                }

                for (const [blockHash, events] of eventDataMap) {
                    yield { blockHash, events };
                }

                await delay(2000);
            } catch (error) {
                console.error(
                    "Ignore and continue loop without breaking though unexpected error occurred:",
                    error
                );
            }
        }
    }

    private createWebhookReceiver(port: number) {
        const server = createServer(async (request, response) => {
            let body = "";
            for await (const chunk of request) {
                body += chunk.toString();
            }

            const eventData: CorvetteEventResponse = JSON.parse(body);

            if (
                this.contractDescription.address.toLowerCase() ===
                eventData.sourceAddress.toLowerCase()
            ) {
                this.eventDataQueue.add(eventData);
            }

            response.end();
        }).listen(port);

        return server;
    }
}
