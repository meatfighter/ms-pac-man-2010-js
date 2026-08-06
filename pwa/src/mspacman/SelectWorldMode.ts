import { FastTrig, GameContainer, Graphics, Image } from "slick2d-ts";
import { Ghost } from "./Ghost";
import type { IInput } from "./IInput";
import type { IMode } from "./IMode";
import { Main } from "./Main";

export class SelectWorldMode implements IMode {
    public static readonly RED_INTERVAL = 5;
    public static readonly LIGHTS = SelectWorldMode.RED_INTERVAL * 10;
    public static readonly ANGLE_INC = 2.0 * Math.PI / SelectWorldMode.LIGHTS;
    public static readonly SELECTION_STEPS = 22;
    public static readonly SELECT_INC = Math.PI / (2 * SelectWorldMode.SELECTION_STEPS);

    public static readonly FADE_NONE = 0;
    public static readonly FADE_IN = 1;
    public static readonly FADE_OUT = 2;

    private main: Main;
    private fadeIndex = 0;
    private fadeState = 0;
    private input: IInput;
    private ghostSpriteIndex = 0;
    private ghostSpriteIndexIncrementor = 0;
    private whiteEnergizer: Image;
    private angleOffset = 0;
    private selection = 0;
    private selectY = 0;
    private selecting = false;
    private selectOffset = 0;
    private selectAngle = 0;
    private selectMag = 0;
    private selectIndex = 0;
    private countDown = 0;

    public init(main: Main, gc: GameContainer): void {
        this.main = main;
        this.input = main.input;

        this.whiteEnergizer = main.tiles[0][49];
        this.fadeIndex = 22;
        this.fadeState = SelectWorldMode.FADE_IN;
        this.ghostSpriteIndex = 0;
        this.ghostSpriteIndexIncrementor = 0;
        this.angleOffset = 0;
        this.selection = 0;
        this.selectY = 143;
        this.selecting = false;
        this.selectOffset = 0;
        this.selectAngle = 0;
        this.selectMag = 0;
        this.selectIndex = 0;
        this.countDown = 0;

        this.input.clearKeyPressedRecord();

        this.main.loopMusic(this.main.levelSelectMusic);
    }

    public update(gc: GameContainer): void {
        this.angleOffset += 0.01;

        if (++this.ghostSpriteIndexIncrementor === Ghost.FLUTTER_SPEED) {
            this.ghostSpriteIndexIncrementor = 0;
            if (++this.ghostSpriteIndex === 2) {
                this.ghostSpriteIndex = 0;
            }
        }

        if (this.fadeState === SelectWorldMode.FADE_IN) {
            if (--this.fadeIndex === 0) {
                this.fadeState = SelectWorldMode.FADE_NONE;
            }
        } else if (this.fadeState === SelectWorldMode.FADE_OUT) {
            if (this.fadeIndex < 22) {
                this.fadeIndex++;
            } else {
                this.main.stopAllSounds();
                this.main.worldIndex = this.selection;
                this.main.setMode(Main.introMode, gc);
            }
        } else {
            if (this.countDown > 0) {
                if (--this.countDown === 0) {
                    this.fadeState = SelectWorldMode.FADE_OUT;
                    this.fadeIndex = 0;
                }
            } else if (this.selecting) {
                if (this.selectIndex < SelectWorldMode.SELECTION_STEPS) {
                    this.selectIndex++;
                    this.selectAngle += SelectWorldMode.SELECT_INC;
                    this.selectY = this.selectOffset + this.selectMag * FastTrig.sin(this.selectAngle);
                } else {
                    this.selectIndex = 0;
                    this.selecting = false;
                }
            } else {
                this.selectY = 143 + (this.selection << 7);
                if (this.selection > 0 && this.input.isUp()) {
                    this.selection--;
                    this.beginSelecting(-128);
                } else if (this.selection < 3 && this.input.isDown()) {
                    this.selection++;
                    this.beginSelecting(128);
                } else if (this.input.isConfirmPressed()) {
                    this.main.playSound(this.main.pressedEnterSound);
                    this.countDown = 60;
                }
            }
        }
    }

    public render(gc: GameContainer, g: Graphics): void {
        this.main.drawString("SELECT GAME WORLD", 264, 32, Main.YELLOW);
        this.main.drawString("BLINKYS WORLD", 296, 143, Main.RED);
        this.main.drawString("PINKYS WORLD", 296, 271, Main.PINK);
        this.main.drawString("INKYS WORLD", 296, 399, Main.CYAN);
        this.main.drawString("SUES WORLD", 296, 527, Main.ORANGE);

        if (!this.selecting) {
            switch (this.selection) {
                case 0:
                    this.main.ghostSprites[Main.RED][Main.RIGHT][this.ghostSpriteIndex].draw(240, 135);
                    break;
                case 1:
                    this.main.ghostSprites[Main.PINK][Main.RIGHT][this.ghostSpriteIndex].draw(240, 263);
                    break;
                case 2:
                    this.main.ghostSprites[Main.CYAN][Main.RIGHT][this.ghostSpriteIndex].draw(240, 391);
                    break;
                case 3:
                    this.main.ghostSprites[Main.ORANGE][Main.RIGHT][this.ghostSpriteIndex].draw(240, 519);
                    break;
            }
        }

        let angle = this.angleOffset;
        for (let i = 0, j = 0; i < SelectWorldMode.LIGHTS; i++, angle += SelectWorldMode.ANGLE_INC) {
            const x = 392 + 300 * FastTrig.cos(angle);
            const y = this.selectY + 32 * FastTrig.sin(angle);
            if (++j === SelectWorldMode.RED_INTERVAL) {
                j = 0;
                this.main.redEnergizerSprite.draw(x, y);
            } else {
                this.whiteEnergizer.draw(x, y);
            }
        }

        this.renderFade(gc, g);
    }

    private beginSelecting(mag: number): void {
        this.selecting = true;
        this.selectOffset = this.selectY;
        this.selectAngle = 0;
        this.selectMag = mag;
        this.selectIndex = 0;
    }

    private renderFade(gc: GameContainer, g: Graphics): void {
        if (this.fadeState !== SelectWorldMode.FADE_NONE) {
            g.setColor(this.main.fades[this.fadeIndex]);
            g.fillRect(0, 0, 800, 600);
        }
    }
}
