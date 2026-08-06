import type { GameContainer } from "slick2d-ts";
import { Ghost } from "./Ghost";
import { Main } from "./Main";
import { MsPacMan } from "./MsPacMan";
import type { PlayingMode } from "./PlayingMode";

export class PinkGhost extends Ghost {
    public constructor(playingMode: PlayingMode) {
        super(playingMode, Main.PINK);
    }

    public override reset(): void {
        super.reset();
        this.x = 13 * 16 + 8;
        this.y = 14 * 16;
        this.direction = Main.DOWN;
        this.inHome = true;
    }

    public updateGhost(gc: GameContainer): void {
        if (this.playingMode.chaseMode) {
            this.targetX = this.playingMode.mspacman.x;
            this.targetY = this.playingMode.mspacman.y;
            const mspacman: MsPacMan = this.playingMode.mspacman;
            switch (mspacman.direction) {
                case Main.UP:
                    this.targetY -= 4 * 16;
                    break;
                case Main.DOWN:
                    this.targetY += 4 * 16;
                    break;
                case Main.LEFT:
                    this.targetX -= 4 * 16;
                    break;
                case Main.RIGHT:
                    this.targetX += 4 * 16;
                    break;
            }
        } else {
            this.targetX = 16 * -1;
            this.targetY = 16 * -1;
        }
    }
}
