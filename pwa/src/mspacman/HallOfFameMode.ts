import { GameContainer, Graphics, Image } from "slick2d-ts";
import type { HighScore } from "./HighScore";
import type { IInput } from "./IInput";
import type { IMode } from "./IMode";
import { Main } from "./Main";

export class HallOfFameMode implements IMode {
    public static readonly FADE_NONE = 0;
    public static readonly FADE_IN = 1;
    public static readonly FADE_OUT = 2;

    private main: Main;
    private highScores: HighScore[][];
    private pressEnterDelay = 0;
    private pressEnterVisible = false;
    private whiteEnergizer: Image;
    private dotsOffset = 0;
    private redOffset = 0;
    private enterPressed = false;
    private fadeIndex = 0;
    private fadeState = 0;
    private ticks = 0;
    private countDown = 0;
    private input: IInput;

    public init(main: Main, gc: GameContainer): void {
        this.main = main;
        this.input = main.input;
        this.highScores = main.highScores;
        this.whiteEnergizer = main.tiles[0][49];

        this.pressEnterDelay = 0;
        this.pressEnterVisible = false;
        this.dotsOffset = 0;
        this.redOffset = 0;
        this.enterPressed = false;
        this.fadeIndex = 22;
        this.fadeState = HallOfFameMode.FADE_IN;
        this.ticks = 0;
        this.countDown = 0;
    }

    public update(gc: GameContainer): void {
        if (this.countDown > 0) {
            if (--this.countDown === 0) {
                this.fadeState = HallOfFameMode.FADE_OUT;
                this.fadeIndex = 0;
            }
        } else if (this.fadeState === HallOfFameMode.FADE_OUT) {
            if (this.fadeIndex < 22) {
                this.fadeIndex++;
            } else {
                if (this.enterPressed) {
                    this.main.setMode(Main.selectWorldMode, gc);
                } else {
                    this.main.setMode(Main.attractMode, gc);
                }
                return;
            }
        } else if (this.ticks++ === 91 * 10) {
            this.fadeState = HallOfFameMode.FADE_OUT;
            this.fadeIndex = 0;
        } else if (this.input.isMenuStartPressed()) {
            this.countDown = 60;
            this.enterPressed = true;
            this.main.demoMode = false;
            this.main.playSound(this.main.pressedEnterSound);
        } else if (this.fadeState === HallOfFameMode.FADE_IN) {
            if (this.fadeIndex !== 0) {
                this.fadeIndex--;
            } else {
                this.fadeState = HallOfFameMode.FADE_NONE;
            }
        }

        if (this.pressEnterDelay === 0) {
            this.pressEnterDelay = 35;
            this.pressEnterVisible = !this.pressEnterVisible;
        } else {
            this.pressEnterDelay--;
        }

        this.dotsOffset -= 3;
        while (this.dotsOffset < -32) {
            this.dotsOffset += 32;
            this.redOffset++;
        }
    }

    public render(gc: GameContainer, g: Graphics): void {
        this.main.drawString("HALL OF FAME", 16, Main.YELLOW);
        this.main.drawString("WORLD", 16 * 6, 16 * 4, Main.YELLOW);
        this.main.drawString("RANK", 16 * 16, 16 * 4, Main.YELLOW);
        this.main.drawString("SCORE", 16 * 29, 16 * 4, Main.YELLOW);
        this.main.drawString("INITIALS", 16 * 36, 16 * 4, Main.YELLOW);

        this.renderWorldLabels();

        for (let i = 0, offset = 6; i < 4; i++, offset += 6) {
            for (let j = 0; j < 5; j++) {
                const y = 18 * (offset + j);
                const highScore = this.highScores[i][j];
                this.main.drawNumber(highScore.score, 10, 16 * 24, y, Main.WHITE);
                this.main.drawString(highScore.initials, 16 * 36, y, Main.WHITE);
            }
        }

        let y = this.dotsOffset;
        for (let i = 0; i < 20; i++, y += 32) {
            if ((i + this.redOffset) % 10 === 0) {
                this.main.redEnergizerSprite.draw(16, y);
                this.main.redEnergizerSprite.draw(800 - 16 - 16, y);
            } else {
                this.whiteEnergizer.draw(16, y);
                this.whiteEnergizer.draw(800 - 16 - 16, y);
            }
        }

        if (this.pressEnterVisible) {
            this.main.drawString("PRESS START", 560, Main.WHITE);
        }

        if (this.fadeState !== HallOfFameMode.FADE_NONE) {
            g.setColor(this.main.fades[this.fadeIndex]);
            g.fillRect(0, 0, 800, 600);
        }
    }

    private renderWorldLabels(): void {
        this.main.drawString("BLINKYS", 16 * 6, 18 * 6, Main.RED);
        this.main.drawString("PINKYS", 16 * 6, 18 * 12, Main.PINK);
        this.main.drawString("INKYS", 16 * 6, 18 * 18, Main.CYAN);
        this.main.drawString("SUES", 16 * 6, 18 * 24, Main.ORANGE);
        for (let i = 0; i < 4; i++) {
            for (let j = 0; j < 5; j++) {
                this.main.drawString(String(j + 1), 16 * 19, 18 * (6 + i * 6 + j), Main.WHITE);
            }
        }
    }
}
