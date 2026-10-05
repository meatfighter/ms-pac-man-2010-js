import { GameContainer, Graphics, Image } from "slick2d-ts";
import type { IMode } from "./IMode";
import { Main } from "./Main";

export class Act5Mode implements IMode {
    public static readonly PAUSE_STRING = 8;
    public static readonly PAUSE_BETWEEN_STRINGS = 2 * 91;
    public static readonly PAUSE_BEFORE_CLACK = 45;
    public static readonly PAUSE_AFTER_CLACK = 45;

    public static readonly STATE_CLAPPER = 0;
    public static readonly STATE_TALKING = 1;

    public static readonly FADE_NONE = 0;
    public static readonly FADE_IN = 1;
    public static readonly FADE_OUT = 2;

    public static readonly dialog = [
        "\"THOSE STAGES ARE DIFFICULT!'",
        "\"HANG IN THERE.\n\n\nEATING PELLETS SLOWS YOU DOWN.\n\nWHEN BEING CHASED, HEAD FOR OPEN TERRITORY.\n\n\nALSO, TUNNELS SLOW GHOSTS DOWN.'",
        "\"THANKS FOR THE TIPS.'"
    ];

    private main: Main;
    private state = 0;
    private substate = 0;
    private topClapperIndex = 0;
    private timer = 0;
    private fadeIndex = 0;
    private fadeState = 0;
    private dialogIndex = 0;
    private stringIndex = 0;
    private stringDone = false;
    private stringTimer = 0;
    private tone = 0;
    private mspacmanIndex = 0;
    private pacmanIndex = 0;

    public init(main: Main, gc: GameContainer): void {
        this.main = main;

        this.state = Act5Mode.STATE_CLAPPER;
        this.timer = 0;
        this.substate = 0;
        this.topClapperIndex = 0;
        this.fadeIndex = 22;
        this.fadeState = Act5Mode.FADE_IN;
        this.dialogIndex = 0;
        this.stringIndex = 0;
        this.stringDone = false;
        this.stringTimer = 0;
        this.tone = 0;
        this.mspacmanIndex = 1;
        this.pacmanIndex = 1;
    }

    public update(gc: GameContainer): void {
        switch (this.state) {
            case Act5Mode.STATE_CLAPPER:
                this.updateClapper();
                break;
            case Act5Mode.STATE_TALKING:
                this.updateTalking(gc);
                break;
        }
    }

    public render(gc: GameContainer, g: Graphics): void {
        switch (this.state) {
            case Act5Mode.STATE_CLAPPER:
                this.renderClapper(gc, g);
                break;
            case Act5Mode.STATE_TALKING:
                this.renderTalking(gc, g);
                break;
        }
    }

    private initString(dialogIndex: number, tone: number): void {
        this.tone = tone;
        this.dialogIndex = dialogIndex;
        this.stringIndex = 0;
        this.stringTimer = 0;
        this.stringDone = false;
    }

    private updateString(): void {
        if (++this.stringTimer === Act5Mode.PAUSE_STRING) {
            this.stringTimer = 0;
            const s = Act5Mode.dialog[this.dialogIndex];
            if (this.stringIndex < s.length) {
                const c = s.charCodeAt(this.stringIndex);
                if (c !== 32 && c !== 10) {
                    this.main.speaking[this.tone][this.main.random.nextInt(10)].play();
                    if (this.dialogIndex === 1) {
                        this.mspacmanIndex = 1;
                        this.pacmanIndex = this.main.random.nextInt(3);
                    } else {
                        this.pacmanIndex = 1;
                        this.mspacmanIndex = this.main.random.nextInt(3);
                    }
                } else {
                    this.mspacmanIndex = 1;
                    this.pacmanIndex = 1;
                }
                this.stringIndex++;
            } else {
                this.stringDone = true;
                this.mspacmanIndex = 1;
                this.pacmanIndex = 1;
            }
        }
    }

    private renderString(x: number, y: number): void {
        const X = x;
        const s = Act5Mode.dialog[this.dialogIndex];
        const symbols: Array<Image | null> = this.main.symbols[Main.WHITE];

        for (let i = 0; i < this.stringIndex; i++, x += 16) {
            const c = s.charCodeAt(i);
            if (c === 10) {
                x = X;
                y += 16;
            } else if (c !== 32) {
                symbols[c]?.draw(x, y);
            }
        }
    }

    private initTalking(): void {
        this.state = Act5Mode.STATE_TALKING;
        this.initString(0, 0);
    }

    private updateTalking(gc: GameContainer): void {
        if (this.fadeState === Act5Mode.FADE_OUT) {
            if (this.fadeIndex < 22) {
                this.fadeIndex++;
            } else {
                this.main.setMode(Main.playingMode, gc);
            }
        } else if (this.stringDone) {
            if (++this.stringTimer === Act5Mode.PAUSE_BETWEEN_STRINGS) {
                if (this.dialogIndex < 2) {
                    this.initString(this.dialogIndex + 1, this.tone === 0 ? 1 : 0);
                } else {
                    this.fadeState = Act5Mode.FADE_OUT;
                    this.fadeIndex = 0;
                }
            }
        } else {
            this.updateString();
        }
    }

    private renderTalking(gc: GameContainer, g: Graphics): void {
        this.main.drawScaled(this.main.mspacmanSprites[Main.RIGHT][this.mspacmanIndex], 32 * 10, 32 * 15, 4);
        if (this.pacmanIndex === 2) {
            this.main.drawScaled(this.main.pacmanSprites[Main.LEFT][this.pacmanIndex], 32 * 15 + 8, 32 * 15, 4);
        } else {
            this.main.drawScaled(this.main.pacmanSprites[Main.LEFT][this.pacmanIndex], 32 * 15, 32 * 15, 4);
        }

        switch (this.dialogIndex) {
            case 0:
                this.renderString(168, 64);
                break;
            case 1:
                this.renderString(64, 64);
                break;
            case 2:
                this.renderString(224, 64);
                break;
        }

        this.renderFade(gc, g);
    }

    private updateClapper(): void {
        if (this.fadeState === Act5Mode.FADE_IN) {
            if (--this.fadeIndex === 0) {
                this.fadeState = Act5Mode.FADE_NONE;
            }
            return;
        }

        this.timer++;
        if (this.substate === 0) {
            if (this.timer === Act5Mode.PAUSE_BEFORE_CLACK) {
                this.substate = 1;
                this.timer = 0;
            }
        } else if (this.substate === 4) {
            if (this.timer === Act5Mode.PAUSE_AFTER_CLACK) {
                this.substate = 0;
                this.timer = 0;
                this.initTalking();
            }
        } else if (this.timer === 8) {
            this.substate++;
            this.timer = 0;
        }

        this.updateTopClapperIndex();
    }

    private renderClapper(gc: GameContainer, g: Graphics): void {
        this.main.drawString("COACHING", 376, 272, Main.WHITE);
        this.main.clapperBottomSprite.draw(296, 275);
        this.main.drawString("5", 336, 288, Main.WHITE);
        this.main.clapperTopSprites[this.topClapperIndex].draw(296, 243);
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
        if (this.fadeState !== Act5Mode.FADE_NONE) {
            g.setColor(this.main.fades[this.fadeIndex]);
            g.fillRect(0, 0, 800, 600);
        }
    }
}
