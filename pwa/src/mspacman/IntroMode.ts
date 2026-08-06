import { GameContainer, Graphics, Image, JavaRandom } from "slick2d-ts";
import { Ghost } from "./Ghost";
import type { IMode } from "./IMode";
import { Main } from "./Main";
import { MsPacMan } from "./MsPacMan";

export class IntroMode implements IMode {
    public static readonly FADE_NONE = 0;
    public static readonly FADE_IN = 1;
    public static readonly FADE_OUT = 2;

    private main: Main;
    private whiteEnergizer: Image;
    private dotsOffset = 0;
    private redOffset = 0;
    private fadeIndex = 0;
    private fadeState = 0;
    private mspacmanX = 0;
    private ghostSpriteIndex = 0;
    private ghostSpriteIndexIncrementor = 0;
    private chompSpriteIndex = 0;
    private chompSpriteIndexIncrementor = 0;

    public init(main: Main, gc: GameContainer): void {
        this.main = main;

        main.random = new JavaRandom();
        main.stageIndex = 0;
        main.demoMode = false;
        main.score = 0;
        main.lives = 5;

        this.whiteEnergizer = main.tiles[0][49];
        this.dotsOffset = 0;
        this.fadeIndex = 22;
        this.fadeState = IntroMode.FADE_IN;
        this.mspacmanX = -32;
        this.ghostSpriteIndex = 0;
        this.ghostSpriteIndexIncrementor = 0;
        this.chompSpriteIndex = 0;
        this.chompSpriteIndexIncrementor = 0;
        this.redOffset = 0;
    }

    public update(gc: GameContainer): void {
        this.updateSpriteIndices();

        if (this.fadeState === IntroMode.FADE_IN) {
            if (--this.fadeIndex === 0) {
                this.fadeState = IntroMode.FADE_NONE;
                this.main.introMusic.play();
            }
        } else if (this.fadeState === IntroMode.FADE_OUT) {
            if (this.fadeIndex < 22) {
                this.fadeIndex++;
            } else {
                this.main.setMode(Main.playingMode, gc);
            }
            this.mspacmanX += 2.1388174807197943;
        } else {
            this.mspacmanX += 2.1388174807197943;
            if (this.mspacmanX >= 800) {
                this.fadeState = IntroMode.FADE_OUT;
                this.fadeIndex = 0;
            }
        }

        this.dotsOffset -= 3;
        while (this.dotsOffset < -32) {
            this.dotsOffset += 32;
            this.redOffset++;
        }
    }

    public render(gc: GameContainer, g: Graphics): void {
        let x = this.dotsOffset;
        for (let i = 0; i < 26; i++, x += 32) {
            if (((i + this.redOffset) % 10) === 0) {
                this.main.redEnergizerSprite.draw(x, 172);
                this.main.redEnergizerSprite.draw(x, 412);
            } else {
                this.whiteEnergizer.draw(x, 172);
                this.whiteEnergizer.draw(x, 412);
            }
        }

        this.main.mspacmanSprites[Main.RIGHT][MsPacMan.spritePattern[this.chompSpriteIndex]].draw(this.mspacmanX, 284);
        this.main.ghostSprites[Main.RED][Main.RIGHT][this.ghostSpriteIndex].draw(this.mspacmanX - 32 * 3, 284);
        this.main.ghostSprites[Main.CYAN][Main.RIGHT][this.ghostSpriteIndex].draw(this.mspacmanX - 32 * 4 - 8, 284);
        this.main.ghostSprites[Main.PINK][Main.RIGHT][this.ghostSpriteIndex].draw(this.mspacmanX - 32 * 5 - 16, 284);
        this.main.ghostSprites[Main.ORANGE][Main.RIGHT][this.ghostSpriteIndex].draw(this.mspacmanX - 32 * 6 - 24, 284);

        this.main.drawString("LET THE GAMES BEGIN!", 240, 16 * 5, Main.WHITE);

        this.renderFade(gc, g);
    }

    private renderFade(gc: GameContainer, g: Graphics): void {
        if (this.fadeState !== IntroMode.FADE_NONE) {
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
}
