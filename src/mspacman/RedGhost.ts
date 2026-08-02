import type { GameContainer } from "slick2d-ts";
import { Ghost } from "./Ghost";
import { Main } from "./Main";
import type { PlayingMode } from "./PlayingMode";

export class RedGhost extends Ghost {
    public constructor(playingMode: PlayingMode) {
        super(playingMode, Main.RED);
    }

    public override reset(): void {
        super.reset();
        this.x = 13 * 16 + 8;
        this.y = 11 * 16;
        this.direction = Main.LEFT;
        this.inHome = false;
    }

    public updateGhost(gc: GameContainer): void {
        if (this.playingMode.chaseMode) {
            this.targetX = this.playingMode.mspacman.x;
            this.targetY = this.playingMode.mspacman.y;
        } else {
            this.targetX = 16 * 28;
            this.targetY = 16 * -1;
        }
    }
}
