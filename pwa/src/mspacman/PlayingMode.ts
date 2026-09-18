import { Color, GameContainer, Graphics, Image } from "slick2d-ts";
import { CyanGhost } from "./CyanGhost";
import { FruitTarget } from "./FruitTarget";
import { Ghost } from "./Ghost";
import type { IInput } from "./IInput";
import { Main } from "./Main";
import { MsPacMan } from "./MsPacMan";
import { OrangeGhost } from "./OrangeGhost";
import { PinkGhost } from "./PinkGhost";
import { RedGhost } from "./RedGhost";
import type { Stage } from "./Stage";
import { intDiv, make2D, toFloat, toInt } from "./JavaMath";
import type { IMode } from "./IMode";

export class PlayingMode implements IMode {
    public static readonly FADE_NONE = 0;
    public static readonly FADE_IN = 1;
    public static readonly FADE_OUT = 2;

    public static readonly FADE_REASON_KILLED = 0;
    public static readonly FADE_REASON_ADVANCE = 1;
    public static readonly FADE_REASON_GAME_OVER = 2;

    public static readonly TYPE_EMPTY = 0;
    public static readonly TYPE_PELLOT = 1;
    public static readonly TYPE_ENERGIZER = 2;
    public static readonly TYPE_WALL = 3;

    public main: Main;
    public pelletCountFraction = 0;
    public pelletCount = 0;
    public pelletsRemaining = 0;
    public regionMap: number[][];
    public tileMap = make2D(31, 28);
    public typeMap = make2D(31, 28);
    public homeTree: number[][];
    public leftExitMaps: number[][][];
    public rightExitMaps: number[][][];
    public tiles: Image[];
    public input: IInput;
    public fruitTarget: FruitTarget;
    public mspacman: MsPacMan;
    public ghosts: Ghost[] = new Array<Ghost>(4);
    public regionCounts: number[];
    public exitIndex = 1;
    public exitDelay = 0;
    public chaseMode = false;
    public chaseModeToggleDelay = 0;
    public ghostsBlue = false;
    public ghostsBlueOffset = 0;
    public ghostsBlueTimer = 0;
    public showGhostPoints = false;
    public showGhostPointsTimer = 0;
    public ghostPointsIndex = -1;
    public eatenGhost: Ghost | null = null;
    public energizerLocations = make2D(4, 2);
    public energizersVisible = false;
    public energizersVisibleTimer = 0;
    public finished = false;
    public finishedTimer = 0;
    public finishedWhite = false;
    public finishedBlinkTimer = 0;
    public fruitTargetPresent = false;
    public fruitTargetTimer = 0;
    public fruitTargetEntries: number[][];
    public redEnergizerPresent = false;
    public greenEnergizerPresent = false;
    public energizerTimer = 0;
    public playerKilledFlag = false;
    public musicFadeOutTimer = 0;
    public playerSpiraling = false;
    public spiralTimer = 0;
    public readyTimer = 0;
    public stageMessage = "";
    public fruitOdds = 0;
    public redPelletOdds = 0;
    public exitDelayTarget = 0;
    public fadeIndex = 0;
    public fadeState = 0;
    public fadeReason = 0;
    public gameOver = false;
    public gameOverTimer = 0;

    public init(main: Main, gc: GameContainer): void {
        const mainChanged = this.main !== main;
        this.main = main;

        if (main.demoMode) {
            main.random.setSeed(0xcafebabe);
            this.input = main.robotInputs[main.demoIndex];
            this.input.reset();
            main.stageIndex = main.demoIndex;
            main.worldIndex = main.demoIndex;
            main.lives = 5;
            if (++main.demoIndex === 4) {
                main.demoIndex = 0;
            }
        } else {
            this.input = main.input;
        }

        this.tiles = main.tiles[main.stageIndex];
        const stage: Stage = main.stages[main.worldIndex][main.stageIndex];
        this.stageMessage = `STAGE ${main.stageIndex + 1} OF 8`;

        this.pelletsRemaining = this.pelletCount = stage.pelletCount;
        this.pelletCountFraction = toFloat(1 / this.pelletCount);

        if (!this.regionCounts || this.regionCounts.length !== stage.regionCount) {
            this.regionCounts = new Array<number>(stage.regionCount);
        }
        for (let i = 0; i < stage.regionCount; i++) {
            this.regionCounts[i] = 0;
        }
        this.leftExitMaps = stage.leftExitMaps;
        this.rightExitMaps = stage.rightExitMaps;

        const fruitTargetEntriesList: number[][] = [];

        this.regionMap = stage.regionMap;
        let energizerLocationsIndex = 0;
        for (let i = 0; i < 31; i++) {
            const stageTileMapRow = stage.tileMap[i];
            const tileMapRow = this.tileMap[i];
            const typeMapRow = this.typeMap[i];
            const regionMapRow = this.regionMap[i];
            for (let j = 0; j < 28; j++) {
                const tile = stageTileMapRow[j];
                tileMapRow[j] = tile;
                switch (tile) {
                    case 47:
                        typeMapRow[j] = PlayingMode.TYPE_EMPTY;
                        if ((i === 0 || i === 31 || j === 0 || j === 27) && regionMapRow[j] > 0) {
                            fruitTargetEntriesList.push([j, i]);
                        }
                        break;
                    case 48:
                        typeMapRow[j] = PlayingMode.TYPE_PELLOT;
                        break;
                    case 49:
                        typeMapRow[j] = PlayingMode.TYPE_ENERGIZER;
                        this.energizerLocations[energizerLocationsIndex][0] = j;
                        this.energizerLocations[energizerLocationsIndex][1] = i;
                        energizerLocationsIndex++;
                        break;
                    default:
                        typeMapRow[j] = PlayingMode.TYPE_WALL;
                        break;
                }
            }
        }

        this.fruitTargetEntries = fruitTargetEntriesList;

        this.homeTree = stage.homeTree;

        if (!this.mspacman || mainChanged) {
            this.mspacman = new MsPacMan(this);
            this.ghosts[Main.RED] = new RedGhost(this);
            this.ghosts[Main.PINK] = new PinkGhost(this);
            this.ghosts[Main.CYAN] = new CyanGhost(this);
            this.ghosts[Main.ORANGE] = new OrangeGhost(this);
            this.fruitTarget = new FruitTarget(this);
        }

        this.reset();
    }

    public reset(): void {
        this.exitIndex = 1;
        this.exitDelay = 0;
        this.chaseMode = false;
        this.chaseModeToggleDelay = 0;
        this.ghostsBlue = false;
        this.ghostsBlueOffset = 0;
        this.ghostsBlueTimer = 0;
        this.showGhostPoints = false;
        this.showGhostPointsTimer = 0;
        this.ghostPointsIndex = -1;
        this.eatenGhost = null;
        this.energizersVisible = false;
        this.energizersVisibleTimer = 0;
        this.finished = false;
        this.finishedTimer = 0;
        this.finishedWhite = false;
        this.finishedBlinkTimer = 0;
        this.fruitTargetPresent = false;
        this.fruitTargetTimer = 0;
        this.redEnergizerPresent = false;
        this.greenEnergizerPresent = false;
        this.energizerTimer = 0;
        this.playerKilledFlag = false;
        this.musicFadeOutTimer = 0;
        this.playerSpiraling = false;
        this.spiralTimer = 0;
        this.readyTimer = 91;
        this.fruitOdds = toFloat(0.5 - (0.25 * this.main.stageIndex) / 7);
        this.redPelletOdds = toFloat(this.fruitOdds / 2);
        this.exitDelayTarget = toInt(91 * toFloat(3 - (2.75 * this.main.stageIndex) / 7));
        this.fadeIndex = 0;
        this.fadeState = PlayingMode.FADE_IN;
        this.fadeReason = PlayingMode.FADE_REASON_KILLED;
        this.gameOver = false;
        this.gameOverTimer = 0;

        for (let i = this.regionCounts.length - 1; i >= 0; i--) {
            this.regionCounts[i] = 0;
        }

        this.mspacman.reset();
        this.ghosts[Main.RED].reset();
        this.ghosts[Main.PINK].reset();
        this.ghosts[Main.CYAN].reset();
        this.ghosts[Main.ORANGE].reset();
        this.fruitTarget.reset();

        this.incrementRegionCount(this.ghosts[Main.RED]);
        this.incrementRegionCount(this.ghosts[Main.PINK]);
        this.incrementRegionCount(this.ghosts[Main.CYAN]);
        this.incrementRegionCount(this.ghosts[Main.ORANGE]);

        this.main.loopMusic(this.main.stageMusic[this.main.stageIndex & 3]);
    }

    public playerKilled(): void {
        this.playerKilledFlag = true;
        this.musicFadeOutTimer = 0;
        this.playerSpiraling = false;
        this.spiralTimer = 0;
        this.main.stopAllSoundEffects();
        this.main.fadeMusic();
    }

    public ghostEaten(ghost: Ghost): void {
        this.eatenGhost = ghost;
        this.showGhostPoints = true;
        this.showGhostPointsTimer = 91;
        this.eatenGhost.eyeBalls = true;
        this.ghostPointsIndex++;
        switch (this.ghostPointsIndex) {
            case 0:
                this.addPoints(200);
                break;
            case 1:
                this.addPoints(400);
                break;
            case 2:
                this.addPoints(800);
                break;
            case 3:
                this.addPoints(1600);
                break;
        }
        this.main.playSound(this.main.ateGhostSound);
    }

    public atePellot(): void {
        this.addPoints(10);
        if (--this.pelletsRemaining === 0) {
            this.main.stopAllSounds();
            this.main.playSound(this.main.clappingSound);
            this.finished = true;
            this.finishedTimer = 0;
        }
    }

    public ateEnergizer(time?: number): void {
        if (time !== undefined) {
            this.addPoints(50);
            if (this.ghostsBlue) {
                this.ghostsBlueTimer += time;
            } else {
                this.ghostPointsIndex = -1;
                this.main.playSound(this.main.ateEnergizerSound);
                this.main.playSound(this.main.blueGhostsSound);
                this.ghostsBlue = true;
                this.ghostsBlueTimer = time;
                this.ghostsBlueOffset = 0;
                for (let i = 0; i < 4; i++) {
                    if (!this.ghosts[i].eyeBalls) {
                        this.ghosts[i].reverseDirection();
                        this.ghosts[i].blue = true;
                    }
                }
            }
            return;
        }

        this.addPoints(50);
        this.ghostPointsIndex = -1;
        this.main.playSound(this.main.ateEnergizerSound);
        this.main.playSound(this.main.blueGhostsSound);
        this.ghostsBlue = true;
        this.ghostsBlueTimer = toInt(91 * (2 + 4 * (1.0 - this.main.stageIndex / 7.0)));
        if (this.ghostsBlueTimer < 5) {
            this.ghostsBlueTimer = 5;
        }
        this.ghostsBlueOffset = 0;
        for (let i = 0; i < 4; i++) {
            if (!this.ghosts[i].eyeBalls) {
                this.ghosts[i].reverseDirection();
                this.ghosts[i].blue = true;
            }
        }
    }

    public addPoints(points: number): void {
        const score = this.main.score;
        this.main.score += points;
        if (this.main.lives < 6 && intDiv(score, 10000) !== intDiv(this.main.score, 10000)) {
            this.main.playSound(this.main.extraLifeSound);
            this.main.lives++;
        }
    }

    public getRegionCount(x: number, y: number): number {
        const ty = this.tileY(y);
        const tx = this.tileX(x);
        const r = this.regionMap[ty][tx];
        if (r > 0) {
            return this.regionCounts[r];
        }
        return 0;
    }

    public incrementRegionCount(ghost: Ghost): void {
        const ty = this.tileY(ghost.y);
        const tx = this.tileX(ghost.x);
        const r = this.regionMap[ty][tx];
        if (r > 0) {
            this.regionCounts[r]++;
        }
    }

    public decrementRegionCount(ghost: Ghost): void {
        const ty = this.tileY(ghost.y);
        const tx = this.tileX(ghost.x);
        const r = this.regionMap[ty][tx];
        if (r > 0) {
            if (this.regionCounts[r] > 0) {
                this.regionCounts[r]--;
            }
        }
    }

    public update(gc: GameContainer): void {
        if (this.main.demoMode) {
            if (this.main.input.isConfirmPressed()) {
                this.main.stopAllSoundEffects();
                this.main.demoMode = false;
                this.main.playSound(this.main.pressedEnterSound);
                this.main.setMode(Main.selectWorldMode, gc);
                return;
            }
        }

        if (this.gameOver) {
            if (this.gameOverTimer < 5 * 91) {
                this.gameOverTimer++;
            } else {
                this.gameOver = false;
                this.gameOverTimer = 0;
                this.fadeIndex = 0;
                this.fadeState = PlayingMode.FADE_OUT;
                this.fadeReason = PlayingMode.FADE_REASON_GAME_OVER;
            }
            return;
        } else if (this.fadeState === PlayingMode.FADE_IN) {
            if (this.fadeIndex > 0) {
                this.fadeIndex--;
            } else {
                this.fadeState = PlayingMode.FADE_NONE;
            }
            return;
        } else if (this.fadeState === PlayingMode.FADE_OUT) {
            if (this.fadeIndex < 22) {
                this.fadeIndex++;
            } else {
                switch (this.fadeReason) {
                    case PlayingMode.FADE_REASON_KILLED:
                        if (this.main.demoMode) {
                            this.main.stopAllSoundEffects();
                            this.main.demoMode = false;
                            this.main.setMode(Main.hallOfFameMode, gc);
                        } else {
                            this.main.lives--;
                            this.reset();
                        }
                        break;
                    case PlayingMode.FADE_REASON_ADVANCE:
                        this.main.advanceStage(gc);
                        break;
                    case PlayingMode.FADE_REASON_GAME_OVER:
                        if (this.main.isHighScore()) {
                            this.main.setMode(Main.enterInitialsMode, gc);
                        } else {
                            this.main.setMode(Main.attractMode, gc);
                        }
                        break;
                }
            }
            return;
        }

        if (this.readyTimer > 0) {
            this.readyTimer--;
            return;
        }

        if (this.finished) {
            if (++this.finishedBlinkTimer === 23) {
                this.finishedBlinkTimer = 0;
                this.finishedWhite = !this.finishedWhite;
            }
            if (++this.finishedTimer === 600) {
                this.fadeIndex = 22;
                this.fadeState = PlayingMode.FADE_OUT;
                this.fadeReason = PlayingMode.FADE_REASON_ADVANCE;
            }
            return;
        }

        if (this.playerKilledFlag) {
            if (this.musicFadeOutTimer < 91) {
                this.musicFadeOutTimer++;
                if (this.musicFadeOutTimer === 91) {
                    this.main.playSound(this.main.diedSound);
                    this.playerSpiraling = true;
                    this.spiralTimer = 0;
                }
            } else if (this.spiralTimer < 91 * 2) {
                this.spiralTimer++;
            } else {
                if (this.main.lives > 0) {
                    this.fadeState = PlayingMode.FADE_OUT;
                    this.fadeIndex = 0;
                    this.fadeReason = PlayingMode.FADE_REASON_KILLED;
                } else {
                    this.gameOver = true;
                    this.gameOverTimer = 0;
                    this.main.playMusic(this.main.gameOverMusic);
                }
            }
            return;
        }

        if (++this.energizersVisibleTimer === 23) {
            this.energizersVisibleTimer = 0;
            this.energizersVisible = !this.energizersVisible;
        }

        if (this.exitIndex !== 4) {
            if (++this.exitDelay === this.exitDelayTarget) {
                this.exitDelay = 0;
                this.ghosts[this.exitIndex++].exitingHome = true;
            }
        }

        if (this.showGhostPoints) {
            if (--this.showGhostPointsTimer === 0) {
                this.showGhostPoints = false;
                this.eatenGhost = null;
            }
        } else if (this.ghostsBlue) {
            if (
                this.ghostsBlueTimer <= 22 ||
                (this.ghostsBlueTimer >= 45 && this.ghostsBlueTimer <= 67) ||
                (this.ghostsBlueTimer >= 91 && this.ghostsBlueTimer <= 113) ||
                (this.ghostsBlueTimer >= 135 && this.ghostsBlueTimer <= 157)
            ) {
                this.ghostsBlueOffset = 2;
            } else {
                this.ghostsBlueOffset = 0;
            }
            if (--this.ghostsBlueTimer === 0) {
                this.ghostPointsIndex = -1;
                this.ghostsBlue = false;
                this.main.stopSound(this.main.blueGhostsSound);
                for (let i = 0; i < 4; i++) {
                    this.ghosts[i].blue = false;
                }
            }
        } else {
            this.chaseModeToggleDelay++;
            if (this.chaseMode) {
                if (this.chaseModeToggleDelay >= 20 * 91) {
                    this.chaseModeToggleDelay = 0;
                    this.chaseMode = false;
                    for (let i = 0; i < 4; i++) {
                        if (!this.ghosts[i].eyeBalls) {
                            this.ghosts[i].reverseDirection();
                        }
                    }
                }
            } else {
                if (this.chaseModeToggleDelay >= 7 * 91) {
                    this.chaseModeToggleDelay = 0;
                    this.chaseMode = true;
                }
            }
        }

        this.mspacman.update(gc);

        this.ghosts[Main.RED].update(gc);
        this.ghosts[Main.PINK].update(gc);
        this.ghosts[Main.CYAN].update(gc);
        this.ghosts[Main.ORANGE].update(gc);

        if (this.redEnergizerPresent) {
            if (++this.energizerTimer === 7 * 91) {
                this.redEnergizerPresent = false;
            }
            if (this.distance(this.mspacman.x, this.mspacman.y, 16 * 13 + 8, 16 * 23) < 400) {
                this.redEnergizerPresent = false;
                this.ateEnergizer(2 * 91);
            }
        } else if (this.greenEnergizerPresent) {
            if (++this.energizerTimer === 7 * 91) {
                this.greenEnergizerPresent = false;
            }
            if (this.distance(this.mspacman.x, this.mspacman.y, 16 * 13 + 8, 16 * 23) < 400) {
                this.greenEnergizerPresent = false;
                this.mspacman.boostSpeed();
                this.main.playSound(this.main.ateEnergizerSound);
            }
        } else if (this.fruitTargetPresent) {
            this.fruitTarget.update(gc);
        } else if (++this.fruitTargetTimer === 10 * 91) {
            const v = this.main.random.nextFloat();
            if (v > this.fruitOdds) {
                this.createFruit();
            } else if (v > this.redPelletOdds) {
                this.createRedEnergizer();
            } else {
                this.createGreenEnergizer();
            }
            this.fruitTargetTimer = 0;
            this.main.playSound(this.main.fruitAppearedSound);
        }
    }

    public distanceToMsPacMan(x: number, y: number): number {
        return this.distance(this.mspacman.x, this.mspacman.y, x, y);
    }

    public distance(x1: number, y1: number, x2: number, y2: number): number {
        const x = x1 - x2;
        const y = y1 - y2;
        return x * x + y * y;
    }

    public fruitTargetExited(): void {
        this.fruitTargetTimer = 0;
        this.fruitTargetPresent = false;
    }

    public render(gc: GameContainer, g: Graphics): void {
        if (this.finishedWhite) {
            for (let i = 0; i < 31; i++) {
                for (let j = 0; j < 28; j++) {
                    this.main.whiteTiles[this.tileMap[i][j]].draw(176 + (j << 4), 48 + (i << 4));
                }
            }
        } else {
            for (let i = 0; i < 31; i++) {
                for (let j = 0; j < 28; j++) {
                    this.tiles[this.tileMap[i][j]].draw(176 + (j << 4), 48 + (i << 4));
                }
            }
        }
        if (this.energizersVisible) {
            for (let i = 0; i < 4; i++) {
                const energizerLocation = this.energizerLocations[i];
                this.tiles[47].draw(176 + (energizerLocation[0] << 4), 48 + (energizerLocation[1] << 4));
            }
        }

        if (this.fruitTargetPresent) {
            if (!this.playerSpiraling) {
                this.fruitTarget.render(gc, g);
            }
        } else if (this.redEnergizerPresent) {
            if (this.energizersVisible) {
                this.main.redEnergizerSprite.draw(176 + 16 * 13 + 8, 48 + 16 * 23);
            }
        } else if (this.greenEnergizerPresent) {
            if (this.energizersVisible) {
                this.main.greenEnergizerSprite.draw(176 + 16 * 13 + 8, 48 + 16 * 23);
            }
        }
        if (this.playerSpiraling) {
            const mspacmanSprite = this.main.mspacmanSprites[Main.RIGHT][1];
            this.main.drawRotatedScaled(
                mspacmanSprite,
                168 + this.mspacman.x,
                40 + this.mspacman.y,
                this.spiralTimer * 9.89010989010989,
                1 - this.spiralTimer * 0.005494505494505494
            );
        } else {
            this.mspacman.render(gc, g);
            this.ghosts[Main.RED].render(gc, g);
            this.ghosts[Main.PINK].render(gc, g);
            this.ghosts[Main.CYAN].render(gc, g);
            this.ghosts[Main.ORANGE].render(gc, g);
        }

        g.setColor(Color.black);
        g.fillRect(112, 0, 576, 48);
        g.fillRect(112, 544, 576, 48);
        g.fillRect(112, 48, 64, 496);
        g.fillRect(624, 48, 64, 496);

        this.main.drawNumber(this.main.score, 10, 176, 16, Main.WHITE);
        this.main.drawString(this.stageMessage, 400, 16, Main.WHITE);

        const mspacmanSprite = this.main.mspacmanSprites[Main.RIGHT][1];
        let livesCount = this.main.lives - 1;
        if (livesCount > 6) {
            livesCount = 6;
        }
        for (let i = livesCount; i >= 0; i--) {
            mspacmanSprite.draw(176 + (i << 5), 552);
        }
        let fruitCount = this.main.stageIndex + 1;
        if (fruitCount > 7) {
            fruitCount = 7;
        }
        for (let i = 0; i < fruitCount; i++) {
            this.main.fruitSprites[i].draw(592 - (i << 5), 552);
        }

        if (this.main.demoMode || this.gameOver) {
            this.main.drawString("GAME OVER", 20 * 16, Main.YELLOW);
        } else if (this.readyTimer > 0) {
            this.main.drawString("READY!", 20 * 16, Main.YELLOW);
        }

        this.renderFade(gc, g);
    }

    private createRedEnergizer(): void {
        this.redEnergizerPresent = true;
        this.energizerTimer = 0;
    }

    private createGreenEnergizer(): void {
        this.greenEnergizerPresent = true;
        this.energizerTimer = 0;
    }

    private createFruit(): void {
        if (this.main.stageIndex === 7) {
            this.fruitTarget.fruitIndex = this.main.random.nextInt(7);
        } else {
            this.fruitTarget.fruitIndex = this.main.stageIndex;
        }
        this.fruitTargetPresent = true;
        const entry = this.fruitTargetEntries[this.main.random.nextInt(this.fruitTargetEntries.length)];
        if (entry[0] === 0) {
            this.fruitTarget.x = -32;
            this.fruitTarget.y = entry[1] << 4;
        } else if (entry[0] === 27) {
            this.fruitTarget.x = 448;
            this.fruitTarget.y = entry[1] << 4;
        } else if (entry[1] === 0) {
            this.fruitTarget.x = entry[0] << 4;
            this.fruitTarget.y = -32;
        } else if (entry[1] === 31) {
            this.fruitTarget.x = entry[0] << 4;
            this.fruitTarget.y = 496;
        }
    }

    private renderFade(gc: GameContainer, g: Graphics): void {
        if (this.fadeState !== PlayingMode.FADE_NONE) {
            g.setColor(this.main.fades[this.fadeIndex]);
            g.fillRect(0, 0, 800, 600);
        }
    }

    private tileX(x: number): number {
        let tx = x >> 4;
        if (tx < 0) {
            tx += 28;
        } else if (tx >= 28) {
            tx -= 28;
        }
        return tx;
    }

    private tileY(y: number): number {
        let ty = y >> 4;
        if (ty < 0) {
            ty += 31;
        } else if (ty >= 31) {
            ty -= 31;
        }
        return ty;
    }
}
