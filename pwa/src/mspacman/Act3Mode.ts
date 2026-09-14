import { GameContainer, Graphics } from "slick2d-ts";
import type { IMode } from "./IMode";
import { Main } from "./Main";

export class Act3Mode implements IMode {
    public static readonly PAUSE_BEFORE_CLACK = 45;
    public static readonly PAUSE_AFTER_CLACK = 45;

    public static readonly STATE_CLAPPER = 0;
    public static readonly STATE_CARRYING = 1;
    public static readonly STATE_DROPPING = 2;
    public static readonly STATE_JUNIOR = 3;

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
    private storkX = 0;
    private storkSpriteIndex = 0;
    private storkSpriteIndexIncrementor = 0;
    private juniorBagX = 0;
    private juniorBagY = 0;
    private juniorBagVy = 0;
    private juniorY = 0;
    private juniorVy = 0;

    public init(main: Main, gc: GameContainer): void {
        this.main = main;

        this.state = Act3Mode.STATE_CLAPPER;
        this.timer = 0;
        this.substate = 0;
        this.topClapperIndex = 0;
        this.fadeIndex = 22;
        this.fadeState = Act3Mode.FADE_IN;
        this.storkSpriteIndex = 0;
        this.storkSpriteIndexIncrementor = 0;
        this.juniorBagVy = 0;
        this.juniorY = 500;
        this.juniorVy = -4;
    }

    public update(gc: GameContainer): void {
        switch (this.state) {
            case Act3Mode.STATE_CLAPPER:
                this.updateClapper();
                break;
            case Act3Mode.STATE_CARRYING:
                this.updateCarrying();
                break;
            case Act3Mode.STATE_DROPPING:
                this.updateDropping();
                break;
            case Act3Mode.STATE_JUNIOR:
                this.updateJunior(gc);
                break;
        }
    }

    public render(gc: GameContainer, g: Graphics): void {
        switch (this.state) {
            case Act3Mode.STATE_CLAPPER:
                this.renderClapper(gc, g);
                break;
            case Act3Mode.STATE_CARRYING:
                this.renderCarrying(gc, g);
                break;
            case Act3Mode.STATE_DROPPING:
                this.renderDropping(gc, g);
                break;
            case Act3Mode.STATE_JUNIOR:
                this.renderJunior(gc, g);
                break;
        }
    }

    private initCarrying(): void {
        this.state = Act3Mode.STATE_CARRYING;
        this.storkX = 800;
    }

    private updateCarrying(): void {
        this.moveStork();
        if (this.storkX < 530) {
            this.initDropping();
        }
    }

    private renderCarrying(gc: GameContainer, g: Graphics): void {
        this.renderSprites();
        this.main.juniorBagSprite.draw(this.storkX, 100);
    }

    private initDropping(): void {
        this.state = Act3Mode.STATE_DROPPING;
        this.juniorBagX = this.storkX;
        this.juniorBagY = 100;
    }

    private updateDropping(): void {
        this.moveStork();
        this.juniorBagX -= 1;
        this.juniorBagVy += 0.1;
        this.juniorBagY += this.juniorBagVy;
        if (this.juniorBagY >= 500) {
            if (this.juniorBagX < 32 * 9) {
                this.initJunior();
            } else {
                this.juniorBagY = 500;
                this.juniorBagVy = -this.juniorBagVy * 0.5;
            }
        }
    }

    private renderDropping(gc: GameContainer, g: Graphics): void {
        this.renderSprites();
        this.main.juniorBagSprite.draw(this.juniorBagX, this.juniorBagY);
    }

    private initJunior(): void {
        this.state = Act3Mode.STATE_JUNIOR;
    }

    private updateJunior(gc: GameContainer): void {
        this.moveStork();
        this.juniorVy += 0.1;
        this.juniorY += this.juniorVy;
        if (this.juniorVy > 0 && this.juniorY >= 500) {
            this.juniorY = 500;
            if (this.fadeState === Act3Mode.FADE_NONE && this.storkX <= -41) {
                this.fadeState = Act3Mode.FADE_OUT;
            }
        }
        if (this.fadeState === Act3Mode.FADE_OUT) {
            if (this.fadeIndex < 22) {
                this.fadeIndex++;
            } else {
                this.main.setMode(Main.playingMode, gc);
            }
        }
    }

    private renderJunior(gc: GameContainer, g: Graphics): void {
        this.renderSprites();
        this.main.juniorSprite.draw(this.juniorBagX - 5, this.juniorY);
        this.renderFade(gc, g);
    }

    private updateClapper(): void {
        if (this.fadeState === Act3Mode.FADE_IN) {
            if (--this.fadeIndex === 0) {
                this.fadeState = Act3Mode.FADE_NONE;
            }
            return;
        } else if (!this.main.actMusic[2].playing()) {
            this.main.playMusic(this.main.actMusic[2]);
        }

        this.timer++;
        if (this.substate === 0) {
            if (this.timer === Act3Mode.PAUSE_BEFORE_CLACK) {
                this.substate = 1;
                this.timer = 0;
            }
        } else if (this.substate === 4) {
            if (this.timer === Act3Mode.PAUSE_AFTER_CLACK) {
                this.substate = 0;
                this.timer = 0;
                this.initCarrying();
            }
        } else if (this.timer === 8) {
            this.substate++;
            this.timer = 0;
        }

        this.updateTopClapperIndex();
    }

    private renderClapper(gc: GameContainer, g: Graphics): void {
        this.main.drawString("JUNIOR", 392, 272, Main.WHITE);
        this.main.clapperBottomSprite.draw(312, 275);
        this.main.drawString("3", 352, 288, Main.WHITE);
        this.main.clapperTopSprites[this.topClapperIndex].draw(312, 243);
        this.renderFade(gc, g);
    }

    private renderFade(gc: GameContainer, g: Graphics): void {
        if (this.fadeState !== Act3Mode.FADE_NONE) {
            g.setColor(this.main.fades[this.fadeIndex]);
            g.fillRect(0, 0, 800, 600);
        }
    }

    private moveStork(): void {
        this.storkX -= 1;
        if (++this.storkSpriteIndexIncrementor === 12) {
            this.storkSpriteIndexIncrementor = 0;
            if (++this.storkSpriteIndex === 2) {
                this.storkSpriteIndex = 0;
            }
        }
    }

    private renderSprites(): void {
        this.main.pacmanSprites[Main.RIGHT][1].draw(32 * 6, 500);
        this.main.mspacmanSprites[Main.RIGHT][1].draw(32 * 7, 500);
        this.main.storkHeadSprite.draw(this.storkX, 100);
        this.main.storkWingsSprites[this.storkSpriteIndex].draw(this.storkX + 31, 100);
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
