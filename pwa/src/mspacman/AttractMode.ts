import { GameContainer, Graphics, Image } from "slick2d-ts";
import { Ghost } from "./Ghost";
import type { IInput } from "./IInput";
import type { IMode } from "./IMode";
import { Main } from "./Main";

export class AttractMode implements IMode {
    public static readonly Z0 = -800;

    public static readonly FADE_NONE = 0;
    public static readonly FADE_IN = 1;
    public static readonly FADE_OUT = 2;

    public static readonly STATE_FLYING_TITLE = 0;
    public static readonly STATE_2010 = 1;
    public static readonly STATE_BARS = 2;
    public static readonly STATE_STARING = 3;

    private main: Main;
    private whiteEnergizer: Image;
    private dotsOffset = 0;
    private redOffset = 0;
    private fadeIndex = 0;
    private fadeState = 0;
    private state = 0;
    private titleZ = 0;
    private titleY = 0;
    private titleVy = 0;
    private y2010 = 0;
    private barsY = 0;
    private pressEnterDelay = 0;
    private pressEnterVisible = false;
    private ghostSpriteIndex = 0;
    private ghostSpriteIndexIncrementor = 0;
    private ghostsVisible = 0;
    private ghostX = 0;
    private input: IInput;
    private enterPressed = false;
    private ticks = 0;
    private countDown = 0;

    public init(main: Main, gc: GameContainer): void {
        this.main = main;
        this.input = main.input;

        this.whiteEnergizer = main.tiles[0][49];
        this.fadeIndex = 0;
        this.fadeState = AttractMode.FADE_NONE;
        this.state = AttractMode.STATE_FLYING_TITLE;
        this.titleZ = 0;
        this.titleY = 0;
        this.titleVy = 0;
        this.y2010 = 0;
        this.barsY = 0;
        this.pressEnterVisible = false;
        this.pressEnterDelay = 0;
        this.ghostSpriteIndex = 0;
        this.ghostSpriteIndexIncrementor = 0;
        this.ghostsVisible = 0;
        this.enterPressed = false;
        this.ticks = 0;
        this.countDown = 0;
        this.dotsOffset = 0;
        this.redOffset = 0;

        main.lives = 5;
        main.score = 0;
        main.worldIndex = 0;
        main.stageIndex = 0;
        main.demoMode = false;

        this.initFlyingTitle();

        this.input.clearKeyPressedRecord();

        this.main.playMusic(this.main.highScoreMusic);
    }

    public update(gc: GameContainer): void {
        if (this.countDown > 0) {
            if (--this.countDown === 0) {
                this.fadeState = AttractMode.FADE_OUT;
                this.fadeIndex = 0;
            }
        } else if (this.fadeState === AttractMode.FADE_OUT) {
            if (this.fadeIndex < 22) {
                this.fadeIndex++;
            } else {
                if (this.enterPressed) {
                    this.main.setMode(Main.selectWorldMode, gc);
                } else {
                    this.main.demoMode = true;
                    this.main.setMode(Main.playingMode, gc);
                }
            }
        } else if (this.ticks++ === 3386) {
            this.fadeState = AttractMode.FADE_OUT;
            this.fadeIndex = 0;
        } else if (this.input.isMenuStartPressed()) {
            this.main.demoMode = false;
            this.countDown = 60;
            this.enterPressed = true;
            this.main.stopMusic();
            this.main.playSound(this.main.pressedEnterSound);
        }

        if (!this.enterPressed) {
            switch (this.state) {
                case AttractMode.STATE_FLYING_TITLE:
                    this.updateFlyingTitle();
                    break;
                case AttractMode.STATE_2010:
                    this.update2010();
                    break;
                case AttractMode.STATE_BARS:
                    this.updateBars();
                    break;
                case AttractMode.STATE_STARING:
                    this.updateStaring();
                    break;
            }
        }
    }

    public render(gc: GameContainer, g: Graphics): void {
        switch (this.state) {
            case AttractMode.STATE_FLYING_TITLE:
                this.renderFlyingTitle(gc, g);
                break;
            case AttractMode.STATE_2010:
                this.render2010(gc, g);
                break;
            case AttractMode.STATE_BARS:
                this.renderBars(gc, g);
                break;
            case AttractMode.STATE_STARING:
                this.renderStaring(gc, g);
                break;
        }

        this.renderFade(gc, g);
    }

    private initStaring(): void {
        this.state = AttractMode.STATE_STARING;
        this.pressEnterVisible = false;
        this.pressEnterDelay = 0;
        this.ghostX = 800;
        this.ghostsVisible = 0;
    }

    private updateStaring(): void {
        this.updateDots();
        this.updateSpriteIndices();

        if (this.pressEnterDelay === 0) {
            this.pressEnterDelay = 35;
            this.pressEnterVisible = !this.pressEnterVisible;
        } else {
            this.pressEnterDelay--;
        }

        if (this.ghostsVisible < 4) {
            if (this.ghostX > 328) {
                this.ghostX -= 2;
            } else {
                this.ghostsVisible++;
                this.ghostX = 800;
            }
        }
    }

    private renderStaring(gc: GameContainer, g: Graphics): void {
        this.renderBars(gc, g);

        if (this.pressEnterVisible) {
            this.main.drawString("PRESS START", 456, Main.WHITE);
        }
        this.main.drawString("STARRING", 246, Main.WHITE);
        this.main.drawString("@ 2010, 2026 MEATFIGHTER.COM", 536, Main.WHITE);
        this.main.drawString("SPACE BAR - TOGGLE FULL-SCREEN MODE", 488, Main.WHITE);

        for (let i = 0; i < this.ghostsVisible; i++) {
            const y = 300 + (i << 5);
            this.main.ghostSprites[i][Main.RIGHT][this.ghostSpriteIndex].draw(328, y - 8);
            switch (i) {
                case 0:
                    this.main.drawString("BLINKY", 376, y, Main.RED);
                    break;
                case 1:
                    this.main.drawString(" PINKY", 376, y, Main.PINK);
                    break;
                case 2:
                    this.main.drawString("  INKY", 376, y, Main.CYAN);
                    break;
                case 3:
                    this.main.drawString("   SUE", 376, y, Main.ORANGE);
                    break;
            }
        }

        if (this.ghostsVisible < 4) {
            const y = 300 + (this.ghostsVisible << 5);
            this.main.ghostSprites[this.ghostsVisible][Main.LEFT][this.ghostSpriteIndex].draw(this.ghostX, y - 8);
        }
    }

    private initBars(): void {
        this.state = AttractMode.STATE_BARS;
        this.barsY = -16;
    }

    private updateBars(): void {
        this.updateDots();

        if (this.barsY < 32) {
            this.barsY += 1;
        } else {
            this.barsY = 32;
            this.initStaring();
        }
    }

    private updateDots(): void {
        this.dotsOffset -= 3;
        while (this.dotsOffset < -32) {
            this.dotsOffset += 32;
            this.redOffset++;
        }
    }

    private renderBars(gc: GameContainer, g: Graphics): void {
        this.main.drawString("MS.PAC-MAN", 160, 106, Main.ORANGE, 3);
        this.main.drawString("2010", 336, 160, Main.ORANGE, 2);

        let x = this.dotsOffset;
        const y = 600 - this.barsY;
        for (let i = 0; i < 26; i++, x += 32) {
            if ((i + this.redOffset) % 10 === 0) {
                this.main.redEnergizerSprite.draw(x, this.barsY);
                this.main.redEnergizerSprite.draw(x, y);
            } else {
                this.whiteEnergizer.draw(x, this.barsY);
                this.whiteEnergizer.draw(x, y);
            }
        }
    }

    private init2010(): void {
        this.state = AttractMode.STATE_2010;
        this.y2010 = 600;
    }

    private update2010(): void {
        if (this.y2010 > 160) {
            this.y2010 -= 5;
        } else {
            this.y2010 = 160;
            this.initBars();
        }
    }

    private render2010(gc: GameContainer, g: Graphics): void {
        this.main.drawString("MS.PAC-MAN", 160, 106, Main.ORANGE, 3);
        this.main.drawString("2010", 336, this.y2010, Main.ORANGE, 2);
    }

    private initFlyingTitle(): void {
        this.state = AttractMode.STATE_FLYING_TITLE;
        this.titleY = 91.450073;
        this.titleVy = -9.45;
        this.titleZ = -664;
    }

    private updateFlyingTitle(): void {
        if (this.titleZ < 0) {
            this.titleZ += 8;
            this.titleY += this.titleVy;
            this.titleVy += 0.15;
        } else {
            this.init2010();
        }
    }

    private renderFlyingTitle(gc: GameContainer, g: Graphics): void {
        this.drawString("MS.PAC-MAN", 0, this.titleY, this.titleZ, Main.ORANGE, 3);
    }

    private drawString(s: string, x: number, y: number, z: number, color: number, scale: number): void {
        if (z <= AttractMode.Z0) {
            return;
        }
        const k = AttractMode.Z0 / (AttractMode.Z0 - z);
        x -= scale * (s.length << 3);
        y -= 8 * scale;
        this.main.drawString(s, 400 + k * x, 300 + k * y, color, k * scale);
    }

    private updateSpriteIndices(): void {
        if (++this.ghostSpriteIndexIncrementor === Ghost.FLUTTER_SPEED) {
            this.ghostSpriteIndexIncrementor = 0;
            if (++this.ghostSpriteIndex === 2) {
                this.ghostSpriteIndex = 0;
            }
        }
    }

    private renderFade(gc: GameContainer, g: Graphics): void {
        if (this.fadeState !== AttractMode.FADE_NONE) {
            g.setColor(this.main.fades[this.fadeIndex]);
            g.fillRect(0, 0, 800, 600);
        }
    }
}
