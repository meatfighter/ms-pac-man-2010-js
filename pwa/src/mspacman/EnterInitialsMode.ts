import { GameContainer, Graphics, Image } from "slick2d-ts";
import type { IInput } from "./IInput";
import type { IMode } from "./IMode";
import { Main } from "./Main";
import { replaceChar } from "./JavaMath";

export class EnterInitialsMode implements IMode {
    public static readonly FADE_NONE = 0;
    public static readonly FADE_IN = 1;
    public static readonly FADE_OUT = 2;

    private main: Main;
    private fadeIndex = 0;
    private fadeState = 0;
    private whiteEnergizer: Image;
    private dotsOffset = 0;
    private redOffset = 0;
    private editingIndex = 0;
    private initials = "AAA";
    private blinkingInitials = " AA";
    private editVisible = false;
    private blinkTimer = 0;
    private input: IInput;
    private enterPressed = false;
    private submissionFailed = false;
    private newScoreOf = "";

    public init(main: Main, gc: GameContainer): void {
        this.main = main;
        this.input = main.input;
        this.fadeIndex = 22;
        this.fadeState = EnterInitialsMode.FADE_IN;
        this.whiteEnergizer = main.tiles[0][49];
        this.dotsOffset = 0;
        this.redOffset = 0;
        this.editingIndex = 0;
        this.initials = "AAA";
        this.blinkingInitials = " AA";
        this.editVisible = true;
        this.blinkTimer = 0;
        this.newScoreOf = `YOU ACHIEVED A SCORE OF ${main.score}.`;
        this.enterPressed = false;
        this.submissionFailed = false;

        // Upload completion describes an in-flight browser request, not durable game
        // state. A restored initials screen must never wait for a request that died
        // with the previous page/container lifetime. A real submission sets this
        // false again synchronously in accessScoresDatabaseAsync().
        main.uploadComplete = true;
        main.submittedScore = null;

        this.input.clearKeyPressedRecord();
    }

    public update(gc: GameContainer): void {
        if (this.fadeState === EnterInitialsMode.FADE_IN) {
            if (this.fadeIndex > 0) {
                this.fadeIndex--;
            } else {
                this.fadeState = EnterInitialsMode.FADE_NONE;
                this.main.playSound(this.main.clappingSound);
            }
        } else if (this.fadeState === EnterInitialsMode.FADE_OUT) {
            if (this.fadeIndex < 22) {
                this.fadeIndex++;
            } else {
                this.main.setMode(Main.hallOfFameMode, gc);
                return;
            }
        }

        if (++this.blinkTimer === 45) {
            this.blinkTimer = 0;
            this.editVisible = !this.editVisible;
        }

        this.dotsOffset -= 3;
        while (this.dotsOffset < -32) {
            this.dotsOffset += 32;
            this.redOffset++;
        }

        const start = this.input.isConfirmPressed();
        const leftPressed = this.input.isLeftPressed();
        const rightPressed = this.input.isRightPressed();
        const downPressed = this.input.isDownPressed();
        const upPressed = this.input.isUpPressed();
        if (this.enterPressed) {
            if (this.fadeState === EnterInitialsMode.FADE_NONE && this.main.uploadComplete) {
                this.fadeState = EnterInitialsMode.FADE_OUT;
                this.fadeIndex = 0;
            }
        } else if (leftPressed) {
            if (this.editingIndex > 0) {
                this.editingIndex--;
                this.updateStrings();
                this.main.playSound(this.main.ateEnergizerSound);
            }
        } else if (rightPressed || (this.editingIndex !== 2 && start)) {
            if (this.editingIndex < 2) {
                this.editingIndex++;
                this.updateStrings();
                this.main.playSound(this.main.ateEnergizerSound);
            }
        } else if (downPressed) {
            let c = this.initials.charCodeAt(this.editingIndex);
            if (c === 90) {
                c = 32;
            } else if (c === 32) {
                c = 65;
            } else {
                c++;
            }
            this.setChar(String.fromCharCode(c));
        } else if (upPressed) {
            let c = this.initials.charCodeAt(this.editingIndex);
            if (c === 65) {
                c = 32;
            } else if (c === 32) {
                c = 90;
            } else {
                c--;
            }
            this.setChar(String.fromCharCode(c));
        } else if (start) {
            const queued = this.main.accessScoresDatabaseAsync(true, this.main.worldIndex, this.main.score, this.initials);
            this.submissionFailed = !queued;
            if (queued) {
                this.enterPressed = true;
                this.main.playSound(this.main.pressedEnterSound);
            }
        }
    }

    public reconcileStateAfterRestore(): void {
        this.updateStrings();
        this.newScoreOf = `YOU ACHIEVED A SCORE OF ${this.main.score}.`;
    }

    public render(gc: GameContainer, g: Graphics): void {
        if (this.enterPressed) {
            this.main.drawString(this.main.uploadComplete ? "INITIALS ACCEPTED" : "UPLOADING HIGH SCORE...", 292, Main.YELLOW);
        } else {
            this.main.drawString("WELCOME TO THE HALL OF FAME", 48, Main.YELLOW);
            this.main.drawString(this.newScoreOf, 96, Main.WHITE);
            this.main.drawString("USE ARROWS TO ENTER YOUR INITIALS.", 144, Main.WHITE);
            this.main.drawString("PRESS START TO SUBMIT.", 176, Main.WHITE);

            this.main.drawString(this.editVisible ? this.initials : this.blinkingInitials, 304, 268, Main.ORANGE, 4);
            if (this.submissionFailed) {
                this.main.drawString("NOT QUEUED. PRESS START TO RETRY.", 368, Main.YELLOW);
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

        if (this.fadeState !== EnterInitialsMode.FADE_NONE) {
            g.setColor(this.main.fades[this.fadeIndex]);
            g.fillRect(0, 0, 800, 600);
        }
    }

    private setChar(c: string): void {
        this.initials = replaceChar(this.initials, this.editingIndex, c);
        this.updateStrings();
        this.main.playSound(this.main.atePellotSound);
    }

    private updateStrings(): void {
        let value = "";
        for (let i = 0; i < 3; i++) {
            if (i === this.editingIndex) {
                if (this.initials.charAt(i) === " ") {
                    value += "-";
                } else {
                    value += " ";
                }
            } else {
                value += this.initials.charAt(i);
            }
        }
        this.blinkingInitials = value;
    }
}
