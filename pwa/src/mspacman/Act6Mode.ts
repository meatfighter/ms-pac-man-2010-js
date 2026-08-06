import { GameContainer, Graphics } from "slick2d-ts";
import { Ghost } from "./Ghost";
import type { IMode } from "./IMode";
import { Main } from "./Main";
import { MsPacMan } from "./MsPacMan";

export class Act6Mode implements IMode {
    public static readonly BUMP_OFFSET = 40;
    public static readonly PAUSE_BEFORE_CLACK = 45;
    public static readonly PAUSE_AFTER_CLACK = 45;

    public static readonly STATE_CLAPPER = 0;
    public static readonly STATE_RIGHT = 1;
    public static readonly STATE_LEFT = 2;

    public static readonly FADE_NONE = 0;
    public static readonly FADE_IN = 1;
    public static readonly FADE_OUT = 2;

    private main: Main;
    private state = 0;
    private substate = 0;
    private topClapperIndex = 0;
    private timer = 0;
    private ghostSpriteIndex = 0;
    private ghostSpriteIndexIncrementor = 0;
    private chompSpriteIndex = 0;
    private chompSpriteIndexIncrementor = 0;
    private fadeIndex = 0;
    private fadeState = 0;
    private mspacmanX = 0;
    private ghostX = 0;

    public init(main: Main, gc: GameContainer): void {
        this.main = main;

        this.state = Act6Mode.STATE_CLAPPER;
        this.timer = 0;
        this.substate = 0;
        this.topClapperIndex = 0;

        this.ghostSpriteIndex = 0;
        this.ghostSpriteIndexIncrementor = 0;
        this.chompSpriteIndex = 0;
        this.chompSpriteIndexIncrementor = 0;
        this.fadeIndex = 22;
        this.fadeState = Act6Mode.FADE_IN;
    }

    public update(gc: GameContainer): void {
        switch (this.state) {
            case Act6Mode.STATE_CLAPPER:
                this.updateClapper();
                break;
            case Act6Mode.STATE_RIGHT:
                this.updateRight();
                break;
            case Act6Mode.STATE_LEFT:
                this.updateLeft(gc);
                break;
        }
    }

    public render(gc: GameContainer, g: Graphics): void {
        switch (this.state) {
            case Act6Mode.STATE_CLAPPER:
                this.renderClapper(gc, g);
                break;
            case Act6Mode.STATE_RIGHT:
                this.renderRight(gc, g);
                break;
            case Act6Mode.STATE_LEFT:
                this.renderLeft(gc, g);
                break;
        }
    }

    private initRight(): void {
        this.state = Act6Mode.STATE_RIGHT;

        this.ghostX = -(32 * 4 + 8 * 4);
        this.mspacmanX = this.ghostX - 32 * 7;
    }

    private updateRight(): void {
        this.updateSpriteIndices();
        this.ghostX += 3;
        this.mspacmanX += 3.5;
        if (this.mspacmanX > 850) {
            this.initLeft();
        }
    }

    private renderRight(gc: GameContainer, g: Graphics): void {
        this.main.mspacmanSprites[Main.RIGHT][MsPacMan.spritePattern[this.chompSpriteIndex]].draw(this.mspacmanX, 284);
        this.main.blueGhostSprites[this.ghostSpriteIndex].draw(this.ghostX, 284);
        this.main.blueGhostSprites[this.ghostSpriteIndex].draw(this.ghostX + 32 + 8, 284);
        this.main.blueGhostSprites[this.ghostSpriteIndex].draw(this.ghostX + 32 * 2 + 8 * 2, 284);
        this.main.blueGhostSprites[this.ghostSpriteIndex].draw(this.ghostX + 32 * 3 + 8 * 3, 284);
    }

    private initLeft(): void {
        this.state = Act6Mode.STATE_LEFT;
        this.mspacmanX = 800;
        this.ghostX = this.mspacmanX + 32 * 10;
    }

    private updateLeft(gc: GameContainer): void {
        this.updateSpriteIndices();
        this.mspacmanX -= 3;
        this.ghostX -= 3.5;
        if (this.ghostX < -256 * 4) {
            this.main.setMode(Main.playingMode, gc);
        }
    }

    private renderLeft(gc: GameContainer, g: Graphics): void {
        this.main.mspacmanSprites[Main.LEFT][MsPacMan.spritePattern[this.chompSpriteIndex]].draw(this.mspacmanX, 284);
        this.main.drawScaled(this.main.ghostSprites[Main.RED][Main.LEFT][this.ghostSpriteIndex], this.ghostX, 204, 8);
        this.main.drawScaled(this.main.ghostSprites[Main.CYAN][Main.LEFT][this.ghostSpriteIndex], this.ghostX + 256, 204, 8);
        this.main.drawScaled(this.main.ghostSprites[Main.PINK][Main.LEFT][this.ghostSpriteIndex], this.ghostX + 256 * 2, 204, 8);
        this.main.drawScaled(this.main.ghostSprites[Main.ORANGE][Main.LEFT][this.ghostSpriteIndex], this.ghostX + 256 * 3, 204, 8);
    }

    private updateSpriteIndices(): void {
        if (++this.ghostSpriteIndexIncrementor === Ghost.FLUTTER_SPEED) {
            this.ghostSpriteIndexIncrementor = 0;
            if (++this.ghostSpriteIndex === 2) {
                this.ghostSpriteIndex = 0;
            }
        }

        if (++this.chompSpriteIndexIncrementor === MsPacMan.CHOMP_SPEED) {
            this.chompSpriteIndexIncrementor = 0;
            if (++this.chompSpriteIndex === 4) {
                this.chompSpriteIndex = 0;
            }
        }
    }

    private updateClapper(): void {
        if (this.fadeState === Act6Mode.FADE_IN) {
            if (--this.fadeIndex === 0) {
                this.fadeState = Act6Mode.FADE_NONE;
            }
            return;
        } else if (!this.main.actMusic[0].playing()) {
            this.main.actMusic[0].play();
        }

        this.timer++;
        if (this.substate === 0) {
            if (this.timer === Act6Mode.PAUSE_BEFORE_CLACK) {
                this.substate = 1;
                this.timer = 0;
            }
        } else if (this.substate === 4) {
            if (this.timer === Act6Mode.PAUSE_AFTER_CLACK) {
                this.substate = 0;
                this.timer = 0;
                this.initRight();
            }
        } else if (this.timer === 8) {
            this.substate++;
            this.timer = 0;
        }

        this.updateTopClapperIndex();
    }

    private renderClapper(gc: GameContainer, g: Graphics): void {
        this.main.drawString("REVENGE", 384, 272, Main.WHITE);
        this.main.clapperBottomSprite.draw(304, 275);
        this.main.drawString("6", 344, 288, Main.WHITE);
        this.main.clapperTopSprites[this.topClapperIndex].draw(304, 243);
        this.renderFade(gc, g);
    }

    private updateTopClapperIndex(): void {
        switch (this.substate) {
            case 0:
            case 4:
                this.topClapperIndex = 0;
                break;
            case 1:
            case 3:
                this.topClapperIndex = 1;
                break;
            case 2:
                this.topClapperIndex = 2;
                break;
        }
    }

    private renderFade(gc: GameContainer, g: Graphics): void {
        if (this.fadeState !== Act6Mode.FADE_NONE) {
            g.setColor(this.main.fades[this.fadeIndex]);
            g.fillRect(0, 0, 800, 600);
        }
    }
}
