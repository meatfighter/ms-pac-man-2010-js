import { FastTrig, GameContainer, Graphics } from "slick2d-ts";
import { Ghost } from "./Ghost";
import type { IMode } from "./IMode";
import { Main } from "./Main";
import { MsPacMan } from "./MsPacMan";

export class Act1Mode implements IMode {
    public static readonly BUMP_OFFSET = 40;
    public static readonly PAUSE_BEFORE_CLACK = 45;
    public static readonly PAUSE_AFTER_CLACK = 45;

    public static readonly STATE_CLAPPER = 0;
    public static readonly STATE_STACKED_CHASE = 1;
    public static readonly STATE_HEAD_ON = 2;

    public static readonly FADE_NONE = 0;
    public static readonly FADE_IN = 1;
    public static readonly FADE_OUT = 2;

    private main: Main;
    private state = 0;
    private nextState = 0;
    private substate = 0;
    private topClapperIndex = 0;
    private timer = 0;
    private cyanX = 0;
    private pacmanX = 0;
    private pinkX = 0;
    private mspacmanX = 0;
    private mspacmanY = 0;
    private ghostSpriteIndex = 0;
    private ghostSpriteIndexIncrementor = 0;
    private chompSpriteIndex = 0;
    private chompSpriteIndexIncrementor = 0;
    private bumped = false;
    private showHeart = false;
    private bumpedAlpha = 0;
    private bumpedSpeed = 0;
    private ghostY = 0;
    private ghostYAngle = 0;
    private fadeIndex = 0;
    private fadeState = 0;

    public init(main: Main, gc: GameContainer): void {
        this.main = main;

        this.nextState = Act1Mode.STATE_CLAPPER;
        this.timer = 0;
        this.substate = 0;
        this.topClapperIndex = 0;

        this.cyanX = 0;
        this.pacmanX = 0;
        this.pinkX = 0;
        this.mspacmanX = 0;
        this.ghostSpriteIndex = 0;
        this.ghostSpriteIndexIncrementor = 0;
        this.chompSpriteIndex = 0;
        this.chompSpriteIndexIncrementor = 0;
        this.mspacmanY = 0;
        this.bumped = false;
        this.showHeart = false;
        this.bumpedAlpha = 1;
        this.bumpedSpeed = 2.125;
        this.ghostY = 284;
        this.ghostYAngle = 0;
        this.fadeIndex = 22;
        this.fadeState = Act1Mode.FADE_IN;
    }

    public update(gc: GameContainer): void {
        this.state = this.nextState;

        switch (this.state) {
            case Act1Mode.STATE_CLAPPER:
                this.updateClapper();
                break;
            case Act1Mode.STATE_STACKED_CHASE:
                this.updateStackedChase();
                break;
            case Act1Mode.STATE_HEAD_ON:
                this.updateHeadOn(gc);
                break;
        }
    }

    public render(gc: GameContainer, g: Graphics): void {
        switch (this.state) {
            case Act1Mode.STATE_CLAPPER:
                this.renderClapper(gc, g);
                break;
            case Act1Mode.STATE_STACKED_CHASE:
                this.renderStackedChase(gc, g);
                break;
            case Act1Mode.STATE_HEAD_ON:
                this.renderHeadOn(gc, g);
                break;
        }
    }

    private updateHeadOn(gc: GameContainer): void {
        this.updateSpriteIndices();

        if (this.showHeart) {
            if (this.fadeState === Act1Mode.FADE_OUT) {
                if (this.fadeIndex < 22) {
                    this.fadeIndex++;
                } else {
                    this.main.setMode(Main.playingMode, gc);
                }
            } else if (++this.timer === 91) {
                this.fadeState = Act1Mode.FADE_OUT;
                this.fadeIndex = 0;
            }
        } else {
            if (this.bumped) {
                if (this.bumpedSpeed > 0) {
                    this.cyanX += this.bumpedSpeed;
                    this.pinkX -= this.bumpedSpeed;
                    this.bumpedSpeed -= 0.08;
                    this.bumpedAlpha -= 0.02125;
                    let dy = FastTrig.sin(this.ghostYAngle);
                    this.ghostYAngle += 0.15;
                    dy *= dy;
                    this.ghostY = 284 - dy * 8;
                } else {
                    this.showHeart = true;
                    this.timer = 0;
                }
            } else if (this.mspacmanX >= 368) {
                this.mspacmanX = 368;
                this.pacmanX = 400;
                if (this.cyanX > 400) {
                    this.mspacmanY -= 2;
                    this.cyanX -= 2.125;
                    this.pinkX += 2.125;
                } else {
                    this.bumped = true;
                    this.bumpedAlpha = 1;
                }
            } else {
                this.pacmanX -= 2;
                this.cyanX -= 2.125;

                this.mspacmanX += 2;
                this.pinkX += 2.125;
            }
        }
    }

    private renderHeadOn(gc: GameContainer, g: Graphics): void {
        if (this.showHeart) {
            this.main.pacmanSprites[Main.LEFT][1].draw(this.pacmanX, this.mspacmanY);
            this.main.mspacmanSprites[Main.RIGHT][1].draw(this.mspacmanX, this.mspacmanY);
            this.main.heartSprite.draw(384, this.mspacmanY - 32);
        } else {
            this.main.pacmanSprites[Main.LEFT][MsPacMan.spritePattern[this.chompSpriteIndex]].draw(this.pacmanX, this.mspacmanY);
            this.main.mspacmanSprites[Main.RIGHT][MsPacMan.spritePattern[this.chompSpriteIndex]].draw(this.mspacmanX, this.mspacmanY);

            if (this.bumped) {
                this.main.drawAlpha(this.main.ghostSprites[Main.CYAN][Main.LEFT][this.ghostSpriteIndex], this.cyanX, this.ghostY, this.bumpedAlpha);
                this.main.drawAlpha(this.main.ghostSprites[Main.PINK][Main.RIGHT][this.ghostSpriteIndex], this.pinkX, this.ghostY, this.bumpedAlpha);
            } else {
                this.main.ghostSprites[Main.CYAN][Main.LEFT][this.ghostSpriteIndex].draw(this.cyanX, 284);
                this.main.ghostSprites[Main.PINK][Main.RIGHT][this.ghostSpriteIndex].draw(this.pinkX, 284);
            }
        }

        this.renderFade(gc, g);
    }

    private updateStackedChase(): void {
        this.updateSpriteIndices();

        this.pacmanX += 2;
        this.cyanX += 2.125;

        this.mspacmanX -= 2;
        this.pinkX -= 2.125;

        if (this.cyanX > 800) {
            this.nextState = Act1Mode.STATE_HEAD_ON;
            this.pinkX = -128 - Act1Mode.BUMP_OFFSET;
            this.mspacmanX = -32;
            this.cyanX = 896 + Act1Mode.BUMP_OFFSET;
            this.pacmanX = 800;
            this.mspacmanY = 284;
        }
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

    private renderStackedChase(gc: GameContainer, g: Graphics): void {
        this.main.pacmanSprites[Main.RIGHT][MsPacMan.spritePattern[this.chompSpriteIndex]].draw(this.pacmanX, 134);
        this.main.ghostSprites[Main.CYAN][Main.RIGHT][this.ghostSpriteIndex].draw(this.cyanX, 134);
        this.main.mspacmanSprites[Main.LEFT][MsPacMan.spritePattern[this.chompSpriteIndex]].draw(this.mspacmanX, 344);
        this.main.ghostSprites[Main.PINK][Main.LEFT][this.ghostSpriteIndex].draw(this.pinkX, 344);
    }

    private updateClapper(): void {
        if (this.fadeState === Act1Mode.FADE_IN) {
            if (--this.fadeIndex === 0) {
                this.fadeState = Act1Mode.FADE_NONE;
            }
            return;
        } else if (!this.main.actMusic[0].playing()) {
            this.main.actMusic[0].play();
        }

        this.timer++;
        if (this.substate === 0) {
            if (this.timer === Act1Mode.PAUSE_BEFORE_CLACK) {
                this.substate = 1;
                this.timer = 0;
            }
        } else if (this.substate === 4) {
            if (this.timer === Act1Mode.PAUSE_AFTER_CLACK) {
                this.substate = 0;
                this.timer = 0;
                this.nextState = Act1Mode.STATE_STACKED_CHASE;

                this.cyanX = -128;
                this.pacmanX = -32;
                this.pinkX = 896;
                this.mspacmanX = 800;
            }
        } else if (this.timer === 8) {
            this.substate++;
            this.timer = 0;
        }

        this.updateTopClapperIndex();
    }

    private renderClapper(gc: GameContainer, g: Graphics): void {
        this.main.drawString("THEY MEET", 368, 272, Main.WHITE);
        this.main.clapperBottomSprite.draw(288, 275);
        this.main.drawString("1", 328, 288, Main.WHITE);
        this.main.clapperTopSprites[this.topClapperIndex].draw(288, 243);

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
        if (this.fadeState !== Act1Mode.FADE_NONE) {
            g.setColor(this.main.fades[this.fadeIndex]);
            g.fillRect(0, 0, 800, 600);
        }
    }
}
