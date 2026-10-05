import { FastTrig, GameContainer, Graphics, Image } from "slick2d-ts";
import { Ghost } from "./Ghost";
import type { IMode } from "./IMode";
import { Main } from "./Main";
import { MsPacMan } from "./MsPacMan";
import { make2D, toInt } from "./JavaMath";

export class EndingMode implements IMode {
    public static readonly PAUSE_STRING = 8;
    public static readonly PAUSE_BETWEEN_STRINGS = 2 * 91;
    public static readonly PAUSE_BEFORE_CLACK = 45;
    public static readonly PAUSE_AFTER_CLACK = 45;

    public static readonly STATE_TEXT = 0;
    public static readonly STATE_ENEMIES = 1;
    public static readonly STATE_CREDITS = 2;
    public static readonly STATE_PRESENTED = 3;

    public static readonly FADE_NONE = 0;
    public static readonly FADE_IN = 1;
    public static readonly FADE_OUT = 2;

    public static readonly dialog = [
        "YOU WIN!",
        "AS THE AWARD CEREMONY BEGINS,",
        "THE CROWD CAN BE HEARD WHISPERING...",
        "\"WHERE IS THE CHAMPION...'",
        "\"WHERE IS MS. PAC-MAN...'",
        "WHERE IS MS. PAC-MAN AS HER ADMIRERS",
        "CHANT HER NAME...",
        "SHE IS ALREADY SEEKING THE NEXT CHALLENGE.",
        "CEREMONY MEANS NOTHING TO HER.",
        "THE GAME IS ALL.",
        "SHADOW / \"BLINKY'\n\n\nENEMY PROGRAMMER\n\n  MICHAEL BIRKEN",
        "SPEEDY / \"PINKY'\n\n\nENEMY PROGRAMMER\n\n  MICHAEL BIRKEN",
        "BASHFUL / \"INKY'\n\n\nENEMY PROGRAMMER\n\n  MICHAEL BIRKEN",
        "POKEY / \"SUE'\n\n\nENEMY PROGRAMMER\n\n  MICHAEL BIRKEN",
        "  PRESENTED BY\n\nMEATFIGHTER.COM"
    ];

    private static readonly dialogX = EndingMode.createDialogX();

    public static readonly credits = [
        "CREATIVE STAFF",
        "",
        "",
        "GAME DESIGNER",
        "  MICHAEL BIRKEN",
        "",
        "PROGRAMMER",
        "  MICHAEL BIRKEN",
        "",
        "CHARACTER DESIGNER",
        "  MICHAEL BIRKEN",
        "",
        "STORY",
        "  MICHAEL BIRKEN",
        "",
        "SYSTEM DESIGNER",
        "  MICHAEL BIRKEN",
        "",
        "VISUAL DESIGNER",
        "  MICHAEL BIRKEN",
        "",
        "VRAM DESIGNER",
        "  MICHAEL BIRKEN",
        "",
        "OBJECT DESIGNER",
        "  MICHAEL BIRKEN",
        "",
        "TOTAL DIRECTOR",
        "  MICHAEL BIRKEN",
        "",
        "TECHNICAL ADVISOR",
        "  MICHAEL BIRKEN",
        "",
        "CODE GUY",
        "  MICHAEL BIRKEN",
        "",
        "",
        "INSPIRED BY THE BRILLIANT WORKS OF",
        "  NAMCO",
        "  MIDWAY",
        "  GENERAL COMPUTER CORPORATION",
        "  NINTENDO",
        "  CAPCOM",
        "",
        "",
        "MUSIC AND SOUNDS BORROWED FROM PAC-MANIA",
        "  JUNKO OZAWA",
        "  YURI.",
        "  Y.TOMURO",
        "",
        "",
        "MUSIC BORROWED FROM PUNCH-OUT!!",
        "  K.YAMAMOTO",
        "  Y.KANEOKA",
        "  A.NAKATUKA",
        "",
        "",
        "VERY SPECIAL THANKS",
        "  TORU IWATANI FOR INVENTING PAC-MAN",
        "",
        "",
        "",
        "",
        "",
        "",
        "  AND YOU!! THANKS FOR PLAYING!"
    ];

    private main: Main;
    private state = 0;
    private fadeIndex = 0;
    private fadeState = 0;
    private dialogIndex = 0;
    private stringIndex = 0;
    private stringDone = false;
    private stringTimer = 0;
    private whiteEnergizer: Image;
    private dotsOffset = 0;
    private redOffset = 0;
    private fadeIndex2 = 0;
    private fadeState2 = 0;
    private ghostSpriteIndex = 0;
    private ghostSpriteIndexIncrementor = 0;
    private chompSpriteIndex = 0;
    private chompSpriteIndexIncrementor = 0;
    private delay = 0;
    private creditsY = 0;
    private mspacmanX = 0;
    private juniorReturning = false;
    private juniorX = 0;
    private juniorFruits = false;
    private fruitData = make2D(7, 2);

    public init(main: Main, gc: GameContainer): void {
        this.main = main;

        this.whiteEnergizer = main.tiles[0][49];
        this.dotsOffset = 0;
        this.fadeIndex = 22;
        this.fadeState = EndingMode.FADE_IN;
        this.dialogIndex = 0;
        this.stringIndex = 0;
        this.stringDone = false;
        this.stringTimer = 0;
        this.redOffset = 0;
        this.fadeIndex2 = 0;
        this.fadeState2 = 0;
        this.ghostSpriteIndex = 0;
        this.ghostSpriteIndexIncrementor = 0;
        this.chompSpriteIndex = 0;
        this.chompSpriteIndexIncrementor = 0;
        this.creditsY = 0;
        this.mspacmanX = 0;
        this.juniorReturning = false;
        this.juniorX = 0;
        this.juniorFruits = false;

        let angle = 0;
        for (let i = 0; i < this.fruitData.length; i++, angle += 2.1) {
            this.fruitData[i][0] = -16 - 16 * FastTrig.sin(angle);
            this.fruitData[i][1] = 0;
        }

        this.initText();

        this.main.loopMusic(this.main.trainingMusic);
    }

    public update(gc: GameContainer): void {
        switch (this.state) {
            case EndingMode.STATE_TEXT:
                this.updateText();
                break;
            case EndingMode.STATE_ENEMIES:
                this.updateEnemies();
                break;
            case EndingMode.STATE_CREDITS:
                this.updateCredits();
                break;
            case EndingMode.STATE_PRESENTED:
                this.updatePresented(gc);
                break;
        }
    }

    public render(gc: GameContainer, g: Graphics): void {
        switch (this.state) {
            case EndingMode.STATE_TEXT:
                this.renderText(gc, g);
                break;
            case EndingMode.STATE_ENEMIES:
                this.renderEnemies(gc, g);
                break;
            case EndingMode.STATE_CREDITS:
                this.renderCredits(gc, g);
                break;
            case EndingMode.STATE_PRESENTED:
                this.renderPresented(gc, g);
                break;
        }
    }

    private initPresented(): void {
        this.state = EndingMode.STATE_PRESENTED;
        this.fadeIndex = 0;
        this.fadeState = EndingMode.FADE_NONE;
        this.initString(14);
        this.mspacmanX = -64;
        this.juniorReturning = false;
        this.juniorFruits = false;
        this.delay = 0;
    }

    private updatePresented(gc: GameContainer): void {
        if (this.delay > 0) {
            this.delay--;
        } else if (this.fadeState === EndingMode.FADE_OUT) {
            if (this.fadeIndex < 22) {
                this.fadeIndex++;
            } else {
                if (this.main.isHighScore()) {
                    this.main.setMode(Main.enterInitialsMode, gc);
                } else {
                    this.main.setMode(Main.attractMode, gc);
                }
            }
        } else if (this.stringDone) {
            this.updateSpriteIndices();

            this.mspacmanX += 1;
            if (this.juniorFruits) {
                this.juniorX += 1;
                if (this.juniorX > 1120) {
                    this.main.fadeMusic();
                    this.delay = 91;
                    this.fadeState = EndingMode.FADE_OUT;
                    this.fadeIndex = 0;
                }
                for (let i = 0; i < 7; i++) {
                    const fruit = this.fruitData[i];
                    fruit[0] += fruit[1];
                    fruit[1] += 0.1;
                    if (fruit[0] >= 0) {
                        fruit[0] = 0;
                        fruit[1] = -2;
                    }
                }
            } else if (this.juniorReturning) {
                this.juniorX -= 3;
                if (this.mspacmanX > 872) {
                    this.juniorFruits = true;
                    this.juniorX = -32;
                }
            } else if (this.mspacmanX > 450) {
                this.juniorReturning = true;
                this.juniorX = this.mspacmanX - 80;
            }
        } else {
            this.updateString();
        }
    }

    private renderPresented(gc: GameContainer, g: Graphics): void {
        this.renderStringDefault();
        if (this.stringDone) {
            if (this.juniorFruits) {
                this.main.juniorRightSprite.draw(this.juniorX, 400);
                for (let i = 0; i < 7; i++) {
                    this.main.fruitSprites[i].draw(this.juniorX - 40 * (i + 1), this.fruitData[i][0] + 408);
                }
            } else {
                this.main.mspacmanSprites[Main.RIGHT][MsPacMan.spritePattern[this.chompSpriteIndex]].draw(this.mspacmanX, 400);
                this.main.pacmanSprites[Main.RIGHT][MsPacMan.spritePattern[this.chompSpriteIndex]].draw(this.mspacmanX - 40, 400);
                if (this.juniorReturning) {
                    this.main.juniorSprite.draw(this.juniorX, 400);
                } else {
                    this.main.juniorRightSprite.draw(this.mspacmanX - 80, 400);
                }
            }
        }

        this.renderFade(gc, g);
    }

    private initCredits(): void {
        this.state = EndingMode.STATE_CREDITS;
        this.creditsY = 600;
    }

    private updateCredits(): void {
        this.creditsY -= 0.5;
        if (this.creditsY + EndingMode.credits.length * 28 < 0) {
            this.initPresented();
        }
    }

    private renderCredits(gc: GameContainer, g: Graphics): void {
        for (let i = 0, y = 0; i < EndingMode.credits.length; i++, y += 28) {
            const s = EndingMode.credits[i];
            if (s.length > 0) {
                this.main.drawString(s, 32, y + toInt(this.creditsY), s.charCodeAt(0) === 32 ? Main.WHITE : Main.YELLOW);
            }
        }
    }

    private initString(dialogIndex: number): void {
        this.dialogIndex = dialogIndex;
        this.stringIndex = 0;
        this.stringTimer = 0;
        this.stringDone = false;
    }

    private updateString(): void {
        if (++this.stringTimer === EndingMode.PAUSE_STRING) {
            this.stringTimer = 0;
            const s = EndingMode.dialog[this.dialogIndex];
            if (this.stringIndex < s.length) {
                this.stringIndex++;
            } else {
                this.stringDone = true;
            }
        }
    }

    private renderStringDefault(): void {
        this.renderString(264);
    }

    private renderString(y: number): void {
        const X = EndingMode.dialogX[this.dialogIndex];
        let x = X;
        const s = EndingMode.dialog[this.dialogIndex];
        let color = Main.WHITE;
        switch (this.dialogIndex) {
            case 10:
                color = Main.RED;
                break;
            case 11:
                color = Main.PINK;
                break;
            case 12:
                color = Main.CYAN;
                break;
            case 13:
                color = Main.ORANGE;
                break;
        }
        let symbols: Array<Image | null> = this.main.symbols[color];

        for (let i = 0; i < this.stringIndex; i++, x += 16) {
            const c = s.charCodeAt(i);
            if (c === 10) {
                symbols = this.main.symbols[Main.WHITE];
                x = X - 16;
                y += 16;
            } else if (c !== 32) {
                symbols[c]?.draw(x, y);
            }
        }
    }

    private initEnemies(): void {
        this.state = EndingMode.STATE_ENEMIES;
        this.fadeIndex = 22;
        this.fadeState = EndingMode.FADE_IN;
        this.fadeIndex2 = 22;
        this.fadeState2 = EndingMode.FADE_IN;
        this.initString(10);
    }

    private updateEnemies(): void {
        this.updateSpriteIndices();

        this.dotsOffset -= 3;
        while (this.dotsOffset < -32) {
            this.dotsOffset += 32;
            this.redOffset++;
        }

        if (this.fadeState === EndingMode.FADE_IN) {
            if (--this.fadeIndex === 0) {
                this.fadeState = EndingMode.FADE_NONE;
            }
        } else if (this.fadeState === EndingMode.FADE_OUT) {
            if (this.fadeIndex < 22) {
                this.fadeIndex++;
            } else {
                this.initCredits();
            }
        } else if (this.fadeState2 === EndingMode.FADE_IN) {
            if (--this.fadeIndex2 === 0) {
                this.fadeState2 = EndingMode.FADE_NONE;
                this.delay = 45;
            }
        } else if (this.fadeState2 === EndingMode.FADE_OUT) {
            if (this.fadeIndex2 < 22) {
                this.fadeIndex2++;
            } else {
                if (this.dialogIndex === 13) {
                    this.fadeIndex = 0;
                    this.fadeState = EndingMode.FADE_OUT;
                } else {
                    this.fadeIndex2 = 22;
                    this.fadeState2 = EndingMode.FADE_IN;
                    this.initString(this.dialogIndex + 1);
                }
            }
        } else if (this.delay > 0) {
            this.delay--;
            if (this.delay === 0 && this.stringDone) {
                this.fadeState2 = EndingMode.FADE_OUT;
                this.fadeIndex2 = 0;
            }
        } else if (this.stringDone) {
            this.delay = 91 * 2;
        } else {
            this.updateString();
        }
    }

    private renderEnemies(gc: GameContainer, g: Graphics): void {
        let enemy = Main.RED;
        switch (this.dialogIndex) {
            case 11:
                enemy = Main.PINK;
                break;
            case 12:
                enemy = Main.CYAN;
                break;
            case 13:
                enemy = Main.ORANGE;
                break;
        }

        this.main.drawScaled(this.main.ghostSprites[enemy][Main.RIGHT][this.ghostSpriteIndex], 200, 280, 4);
        this.renderString(240);

        this.renderFade2(gc, g);

        let x = this.dotsOffset;
        for (let i = 0; i < 26; i++, x += 32) {
            if ((i + this.redOffset) % 10 === 0) {
                this.main.redEnergizerSprite.draw(x, 172);
                this.main.redEnergizerSprite.draw(x, 412);
            } else {
                this.whiteEnergizer.draw(x, 172);
                this.whiteEnergizer.draw(x, 412);
            }
        }

        this.renderFade(gc, g);
    }

    private initText(): void {
        this.state = EndingMode.STATE_TEXT;
        this.initString(0);
    }

    private updateText(): void {
        if (this.fadeState === EndingMode.FADE_IN) {
            if (--this.fadeIndex === 0) {
                this.fadeState = EndingMode.FADE_NONE;
            }
        } else if (this.fadeState === EndingMode.FADE_OUT) {
            if (this.fadeIndex < 22) {
                this.fadeIndex++;
            } else {
                this.initEnemies();
            }
        } else if (this.stringDone) {
            if (++this.stringTimer === EndingMode.PAUSE_BETWEEN_STRINGS) {
                if (this.dialogIndex !== 9) {
                    this.initString(this.dialogIndex + 1);
                } else {
                    this.fadeState = EndingMode.FADE_OUT;
                    this.fadeIndex = 0;
                }
            }
        } else {
            this.updateString();
        }
    }

    private renderText(gc: GameContainer, g: Graphics): void {
        this.main.drawScaled(this.main.mspacmanSprites[Main.RIGHT][1], 400, 32 * 15, 4);
        this.renderStringDefault();
        this.renderFade(gc, g);
    }

    private renderFade2(gc: GameContainer, g: Graphics): void {
        if (this.fadeState2 !== EndingMode.FADE_NONE) {
            g.setColor(this.main.fades[this.fadeIndex2]);
            g.fillRect(0, 172, 800, 240);
        }
    }

    private renderFade(gc: GameContainer, g: Graphics): void {
        if (this.fadeState !== EndingMode.FADE_NONE) {
            g.setColor(this.main.fades[this.fadeIndex]);
            g.fillRect(0, 0, 800, 600);
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

    private static createDialogX(): number[] {
        const dialogX = new Array<number>(EndingMode.dialog.length).fill(0);
        for (let i = 0; i < 10; i++) {
            dialogX[i] = (800 - EndingMode.dialog[i].length * 16) / 2;
        }
        dialogX[10] = 340;
        dialogX[11] = 340;
        dialogX[12] = 340;
        dialogX[13] = 340;
        dialogX[14] = 280;
        return dialogX;
    }
}
