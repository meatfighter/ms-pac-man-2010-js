import { FastTrig, GameContainer, Graphics } from "slick2d-ts";
import type { IMode } from "./IMode";
import { Main } from "./Main";
import { MsPacMan } from "./MsPacMan";

export class Act4Mode implements IMode {
    public static readonly PAUSE_CENTERED = 4 * 91;
    public static readonly PAUSE_BEFORE_CLACK = 45;
    public static readonly PAUSE_AFTER_CLACK = 45;

    public static readonly STATE_CLAPPER = 0;
    public static readonly STATE_TRAINING = 1;

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
    private chompSpriteIndex = 0;
    private chompSpriteIndexIncrementor = 0;
    private storkSpriteIndex = 0;
    private storkSpriteIndexIncrementor = 0;
    private pellotOffset = 0;
    private storkX = 0;
    private storkY = 0;
    private storkYAngle = 0;

    public init(main: Main, gc: GameContainer): void {
        this.main = main;

        this.state = Act4Mode.STATE_CLAPPER;
        this.timer = 0;
        this.substate = 0;
        this.topClapperIndex = 0;
        this.fadeIndex = 22;
        this.fadeState = Act4Mode.FADE_IN;
        this.chompSpriteIndex = 0;
        this.chompSpriteIndexIncrementor = 0;
        this.storkSpriteIndex = 0;
        this.storkSpriteIndexIncrementor = 0;
        this.pellotOffset = 0;
        this.mspacmanX = 0;
        this.storkX = 0;
        this.storkY = 0;
        this.storkYAngle = 0;
    }

    public update(gc: GameContainer): void {
        switch (this.state) {
            case Act4Mode.STATE_CLAPPER:
                this.updateClapper();
                break;
            case Act4Mode.STATE_TRAINING:
                this.updateTraining(gc);
                break;
        }
    }

    public render(gc: GameContainer, g: Graphics): void {
        switch (this.state) {
            case Act4Mode.STATE_CLAPPER:
                this.renderClapper(gc, g);
                break;
            case Act4Mode.STATE_TRAINING:
                this.renderTraining(gc, g);
                break;
        }
    }

    private initTraining(): void {
        this.state = Act4Mode.STATE_TRAINING;
        this.mspacmanX = 800 + 32 * 7;
        this.storkX = this.mspacmanX - 32 * 7;
        this.pellotOffset = 0;
        this.timer = 0;
    }

    private updateTraining(gc: GameContainer): void {
        this.updateSpriteIndices();
        if (this.mspacmanX > 384) {
            this.mspacmanX -= 0.25;
        } else {
            this.mspacmanX = 384;
            this.timer++;
            if (this.fadeState === Act4Mode.FADE_OUT) {
                if (this.fadeIndex < 22) {
                    this.fadeIndex++;
                } else {
                    this.main.setMode(Main.playingMode, gc);
                    return;
                }
            }
            if (this.timer === Act4Mode.PAUSE_CENTERED) {
                this.main.fadeMusic();
            } else if (this.timer === Act4Mode.PAUSE_CENTERED + 68) {
                this.fadeState = Act4Mode.FADE_OUT;
                this.fadeIndex = 0;
            }
        }
        this.pellotOffset += 2;
        if (this.pellotOffset > 16) {
            this.pellotOffset -= 16;
        }

        this.storkX = this.mspacmanX - 32 * 7;
        this.storkY = 384 - 32 * 4 + 16 * FastTrig.sin(this.storkYAngle);
        this.storkYAngle += 0.01;
    }

    private renderTraining(gc: GameContainer, g: Graphics): void {
        for (let x = -16; x < 816; x += 16) {
            const X = x + this.pellotOffset;
            if (X > this.mspacmanX + 16) {
                break;
            }
            this.main.tiles[0][48].draw(X, 392);
        }
        this.main.mspacmanSprites[Main.LEFT][MsPacMan.spritePattern[this.chompSpriteIndex]].draw(this.mspacmanX, 384);

        this.main.pacmanSprites[Main.LEFT][1].draw(this.storkX + 28, this.storkY - 18);
        this.main.storkHeadSprite.draw(this.storkX, this.storkY);
        this.main.storkWingsSprites[this.storkSpriteIndex].draw(this.storkX + 32, this.storkY);

        this.renderFade(gc, g);
    }

    private updateClapper(): void {
        if (this.fadeState === Act4Mode.FADE_IN) {
            if (--this.fadeIndex === 0) {
                this.fadeState = Act4Mode.FADE_NONE;
            }
            return;
        } else if (!this.main.trainingMusic.playing()) {
            this.main.loopMusic(this.main.trainingMusic);
        }

        this.timer++;
        if (this.substate === 0) {
            if (this.timer === Act4Mode.PAUSE_BEFORE_CLACK) {
                this.substate = 1;
                this.timer = 0;
            }
        } else if (this.substate === 4) {
            if (this.timer === Act4Mode.PAUSE_AFTER_CLACK) {
                this.substate = 0;
                this.timer = 0;
                this.initTraining();
            }
        } else if (this.timer === 8) {
            this.substate++;
            this.timer = 0;
        }

        this.updateTopClapperIndex();
    }

    private renderClapper(gc: GameContainer, g: Graphics): void {
        this.main.drawString("TRAINING", 376, 272, Main.WHITE);
        this.main.clapperBottomSprite.draw(296, 275);
        this.main.drawString("4", 336, 288, Main.WHITE);
        this.main.clapperTopSprites[this.topClapperIndex].draw(296, 243);
        this.renderFade(gc, g);
    }

    private renderFade(gc: GameContainer, g: Graphics): void {
        if (this.fadeState !== Act4Mode.FADE_NONE) {
            g.setColor(this.main.fades[this.fadeIndex]);
            g.fillRect(0, 0, 800, 600);
        }
    }

    private updateSpriteIndices(): void {
        if (++this.chompSpriteIndexIncrementor === MsPacMan.CHOMP_SPEED) {
            this.chompSpriteIndexIncrementor = 0;
            if (++this.chompSpriteIndex === 4) {
                this.chompSpriteIndex = 0;
            }
        }
        if (++this.storkSpriteIndexIncrementor === 12) {
            this.storkSpriteIndexIncrementor = 0;
            if (++this.storkSpriteIndex === 2) {
                this.storkSpriteIndex = 0;
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
}
