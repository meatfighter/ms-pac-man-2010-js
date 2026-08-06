import { GameContainer, Graphics } from "slick2d-ts";
import type { IMode } from "./IMode";
import { Main } from "./Main";
import { MsPacMan } from "./MsPacMan";

export class Act2Mode implements IMode {
    public static readonly PAUSE_BEFORE_CLACK = 45;
    public static readonly PAUSE_AFTER_CLACK = 45;

    public static readonly STATE_CLAPPER = 0;
    public static readonly STATE_TOP_RIGHT = 1;
    public static readonly STATE_BOTTOM_LEFT = 2;
    public static readonly STATE_MIDDLE_RIGHT = 3;
    public static readonly STATE_TOP_LEFT = 4;
    public static readonly STATE_BOTTOM_RIGHT = 5;

    public static readonly FADE_NONE = 0;
    public static readonly FADE_IN = 1;
    public static readonly FADE_OUT = 2;

    private main: Main;
    private state = 0;
    private substate = 0;
    private topClapperIndex = 0;
    private timer = 0;
    private fadeIndex = 0;
    private fadeState = 0;
    private mspacmanX = 0;
    private pacmanX = 0;
    private chompSpriteIndex = 0;
    private chompSpriteIndexIncrementor = 0;

    public init(main: Main, gc: GameContainer): void {
        this.main = main;

        this.state = Act2Mode.STATE_CLAPPER;
        this.timer = 0;
        this.substate = 0;
        this.topClapperIndex = 0;
        this.fadeIndex = 22;
        this.fadeState = Act2Mode.FADE_IN;
        this.chompSpriteIndex = 0;
        this.chompSpriteIndexIncrementor = 0;
    }

    public update(gc: GameContainer): void {
        switch (this.state) {
            case Act2Mode.STATE_CLAPPER:
                this.updateClapper();
                break;
            case Act2Mode.STATE_TOP_RIGHT:
                this.updateTopRight();
                break;
            case Act2Mode.STATE_BOTTOM_LEFT:
                this.updateBottomLeft();
                break;
            case Act2Mode.STATE_MIDDLE_RIGHT:
                this.updateMiddleRight();
                break;
            case Act2Mode.STATE_TOP_LEFT:
                this.updateTopLeft();
                break;
            case Act2Mode.STATE_BOTTOM_RIGHT:
                this.updateBottomRight(gc);
                break;
        }
    }

    public render(gc: GameContainer, g: Graphics): void {
        switch (this.state) {
            case Act2Mode.STATE_CLAPPER:
                this.renderClapper(gc, g);
                break;
            case Act2Mode.STATE_TOP_RIGHT:
                this.renderTopRight();
                break;
            case Act2Mode.STATE_BOTTOM_LEFT:
                this.renderBottomLeft();
                break;
            case Act2Mode.STATE_MIDDLE_RIGHT:
                this.renderMiddleRight();
                break;
            case Act2Mode.STATE_TOP_LEFT:
                this.renderTopLeft();
                break;
            case Act2Mode.STATE_BOTTOM_RIGHT:
                this.renderBottomRight();
                break;
        }
    }

    private initTopRight(): void {
        this.state = Act2Mode.STATE_TOP_RIGHT;
        this.mspacmanX = -32 - 10 * 91;
        this.pacmanX = this.mspacmanX - 32 * 5;
    }

    private updateTopRight(): void {
        this.updateSpriteIndices();
        this.pacmanX += 3;
        this.mspacmanX += 3;
        if (this.pacmanX > 800 + 4 * 91) {
            this.initBottomLeft();
        }
    }

    private renderTopRight(): void {
        this.main.pacmanSprites[Main.RIGHT][MsPacMan.spritePattern[this.chompSpriteIndex]].draw(this.pacmanX, 184);
        this.main.mspacmanSprites[Main.RIGHT][MsPacMan.spritePattern[this.chompSpriteIndex]].draw(this.mspacmanX, 184);
    }

    private initBottomLeft(): void {
        this.state = Act2Mode.STATE_BOTTOM_LEFT;
        this.pacmanX = 800;
        this.mspacmanX = this.pacmanX + 32 * 5;
    }

    private updateBottomLeft(): void {
        this.updateSpriteIndices();
        this.pacmanX -= 3;
        this.mspacmanX -= 3;
        if (this.mspacmanX < -32 - 3 * 91) {
            this.initMiddleRight();
        }
    }

    private renderBottomLeft(): void {
        this.main.pacmanSprites[Main.LEFT][MsPacMan.spritePattern[this.chompSpriteIndex]].draw(this.pacmanX, 384);
        this.main.mspacmanSprites[Main.LEFT][MsPacMan.spritePattern[this.chompSpriteIndex]].draw(this.mspacmanX, 384);
    }

    private initMiddleRight(): void {
        this.state = Act2Mode.STATE_MIDDLE_RIGHT;
        this.mspacmanX = -32;
        this.pacmanX = this.mspacmanX - 32 * 5;
    }

    private updateMiddleRight(): void {
        this.updateSpriteIndices();
        this.pacmanX += 3;
        this.mspacmanX += 3;
        if (this.pacmanX > 800 + 3 * 91) {
            this.initTopLeft();
        }
    }

    private renderMiddleRight(): void {
        this.main.pacmanSprites[Main.RIGHT][MsPacMan.spritePattern[this.chompSpriteIndex]].draw(this.pacmanX, 284);
        this.main.mspacmanSprites[Main.RIGHT][MsPacMan.spritePattern[this.chompSpriteIndex]].draw(this.mspacmanX, 284);
    }

    private initTopLeft(): void {
        this.state = Act2Mode.STATE_TOP_LEFT;
        this.pacmanX = 800;
        this.mspacmanX = this.pacmanX + 32 * 5;
    }

    private updateTopLeft(): void {
        this.updateSpriteIndices();
        this.pacmanX -= 10;
        this.mspacmanX -= 10;
        if (this.mspacmanX < -32) {
            this.initBottomRight();
        }
    }

    private renderTopLeft(): void {
        this.main.pacmanSprites[Main.LEFT][MsPacMan.spritePattern[this.chompSpriteIndex]].draw(this.pacmanX, 184);
        this.main.mspacmanSprites[Main.LEFT][MsPacMan.spritePattern[this.chompSpriteIndex]].draw(this.mspacmanX, 184);
    }

    private initBottomRight(): void {
        this.state = Act2Mode.STATE_BOTTOM_RIGHT;
        this.mspacmanX = -32;
        this.pacmanX = this.mspacmanX - 32 * 5;
    }

    private updateBottomRight(gc: GameContainer): void {
        this.updateSpriteIndices();
        this.pacmanX += 10;
        this.mspacmanX += 10;
        if (this.pacmanX > 800 && !this.main.actMusic[1].playing()) {
            this.main.setMode(Main.playingMode, gc);
        }
    }

    private renderBottomRight(): void {
        this.main.pacmanSprites[Main.RIGHT][MsPacMan.spritePattern[this.chompSpriteIndex]].draw(this.pacmanX, 384);
        this.main.mspacmanSprites[Main.RIGHT][MsPacMan.spritePattern[this.chompSpriteIndex]].draw(this.mspacmanX, 384);
    }

    private updateClapper(): void {
        if (this.fadeState === Act2Mode.FADE_IN) {
            if (--this.fadeIndex === 0) {
                this.fadeState = Act2Mode.FADE_NONE;
            }
            return;
        } else if (!this.main.actMusic[1].playing()) {
            this.main.actMusic[1].play();
        }

        this.timer++;
        if (this.substate === 0) {
            if (this.timer === Act2Mode.PAUSE_BEFORE_CLACK) {
                this.substate = 1;
                this.timer = 0;
            }
        } else if (this.substate === 4) {
            if (this.timer === Act2Mode.PAUSE_AFTER_CLACK) {
                this.substate = 0;
                this.timer = 0;
                this.initTopRight();
            }
        } else if (this.timer === 8) {
            this.substate++;
            this.timer = 0;
        }

        this.updateTopClapperIndex();
    }

    private renderClapper(gc: GameContainer, g: Graphics): void {
        this.main.drawString("THE CHASE", 368, 272, Main.WHITE);
        this.main.clapperBottomSprite.draw(288, 275);
        this.main.drawString("2", 328, 288, Main.WHITE);
        this.main.clapperTopSprites[this.topClapperIndex].draw(288, 243);
        this.renderFade(gc, g);
    }

    private updateSpriteIndices(): void {
        if (++this.chompSpriteIndexIncrementor === MsPacMan.CHOMP_SPEED) {
            this.chompSpriteIndexIncrementor = 0;
            if (++this.chompSpriteIndex === 4) {
                this.chompSpriteIndex = 0;
            }
        }
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
        if (this.fadeState !== Act2Mode.FADE_NONE) {
            g.setColor(this.main.fades[this.fadeIndex]);
            g.fillRect(0, 0, 800, 600);
        }
    }
}
