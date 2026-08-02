import type { GameContainer } from "slick2d-ts";
import { Ghost } from "./Ghost";
import { Main } from "./Main";
import { MsPacMan } from "./MsPacMan";
import type { PlayingMode } from "./PlayingMode";

export class CyanGhost extends Ghost {
    public constructor(playingMode: PlayingMode) {
        super(playingMode, Main.CYAN);
    }

    public override reset(): void {
        super.reset();
        this.x = 11 * 16 + 8;
        this.y = 14 * 16;
        this.direction = Main.UP;
        this.inHome = true;
    }

    public updateGhost(gc: GameContainer): void {
        if (this.playingMode.chaseMode) {
            this.targetX = this.playingMode.mspacman.x;
            this.targetY = this.playingMode.mspacman.y;
            const mspacman: MsPacMan = this.playingMode.mspacman;
            switch (mspacman.direction) {
                case Main.UP:
                    this.targetY -= 2 * 16;
                    break;
                case Main.DOWN:
                    this.targetY += 2 * 16;
                    break;
                case Main.LEFT:
                    this.targetX -= 2 * 16;
                    break;
                case Main.RIGHT:
                    this.targetX += 2 * 16;
                    break;
            }
            const ghost = this.playingMode.ghosts[0];
            this.targetX += this.targetX - ghost.x;
            this.targetY += this.targetY - ghost.y;
        } else {
            this.targetX = 16 * 28;
            this.targetY = 16 * 31;
        }
    }
}
