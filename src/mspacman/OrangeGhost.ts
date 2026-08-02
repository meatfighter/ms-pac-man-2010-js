import type { GameContainer } from "slick2d-ts";
import { Ghost } from "./Ghost";
import { Main } from "./Main";
import type { PlayingMode } from "./PlayingMode";

export class OrangeGhost extends Ghost {
    public constructor(playingMode: PlayingMode) {
        super(playingMode, Main.ORANGE);
    }

    public override reset(): void {
        super.reset();
        this.x = 15 * 16 + 8;
        this.y = 14 * 16;
        this.direction = Main.UP;
        this.inHome = true;
    }

    public updateGhost(gc: GameContainer): void {
        if (this.playingMode.chaseMode) {
            this.targetX = this.playingMode.mspacman.x;
            this.targetY = this.playingMode.mspacman.y;
            if (this.getDist(this.x, this.y) < 16384) {
                this.targetX = 16 * -1;
                this.targetY = 16 * 31;
            }
        } else {
            this.targetX = 16 * -1;
            this.targetY = 16 * 31;
        }
    }
}
