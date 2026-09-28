import type { RemoteHighScore } from "./HighScoreProtocol.js";
import type { HighScoreRequestContext } from "./HighScoreService.js";

/** Application-owned I/O; a Main owns only its bounded wait for a result. */
export interface HighScoreClient {
    enqueueScore(candidate: RemoteHighScore): boolean;
    requestScores(context?: HighScoreRequestContext): Promise<RemoteHighScore[] | null>;
}
