import type { GameContainer, Graphics, Image } from "slick2d-ts";
import { INT_MAX, toFloat } from "./JavaMath";
import { Main } from "./Main";
import type { PlayingMode } from "./PlayingMode";
import { Thing } from "./Thing";

const TYPE_WALL = 3;

export abstract class Ghost extends Thing {
    public static readonly FLUTTER_SPEED = 15;
    public static readonly REVERSE_DIRECTION = [1, 0, 3, 2];

    public blue = false;
    public eyeBalls = false;
    public ghostIndex: number;
    public spriteIndex = 0;
    public spriteIndexIncrementor = 0;
    public sprites: Image[][];
    public targetX = 0;
    public targetY = 0;

    public inHome = false;
    public exitingHome = false;
    public enteringHome = false;

    public constructor(playingMode: PlayingMode, ghostIndex: number) {
        super(playingMode);
        this.ghostIndex = ghostIndex;
        this.sprites = playingMode.main.ghostSprites[ghostIndex];
    }

    public getDist(x: number, y: number): number {
        const dx = x - this.targetX;
        const dy = y - this.targetY;
        return dx * dx + dy * dy;
    }

    public update(gc: GameContainer): void {
        if (this.playingMode.showGhostPoints && (!this.eyeBalls || this.playingMode.eatenGhost === this)) {
            return;
        }

        let speed = this.speed;

        if (this.inHome || this.blue || this.x > 424 || this.x < 8 || this.y > 472 || this.y < 8) {
            speed = 0.5;
        } else if (this.ghostIndex === Main.RED) {
            speed = toFloat(speed * toFloat(1.0 + 0.2 * toFloat(1.0 - this.playingMode.pelletsRemaining * this.playingMode.pelletCountFraction)));
            const maxSpeed = toFloat(1.01 * this.playingMode.mspacman.speed);
            if (speed > maxSpeed) {
                speed = maxSpeed;
            }
        }

        if (this.eyeBalls) {
            if (this.enteringHome) {
                speed = 0.5;
            } else {
                speed = 1.5;
            }
        }

        if (++this.spriteIndexIncrementor === Ghost.FLUTTER_SPEED) {
            this.spriteIndexIncrementor = 0;
            if (++this.spriteIndex === 2) {
                this.spriteIndex = 0;
            }
        }

        this.speedRemainder = toFloat(this.speedRemainder + speed);

        while (this.speedRemainder >= 1) {
            this.speedRemainder = toFloat(this.speedRemainder - 1);

            this.playingMode.decrementRegionCount(this);

            this.updateGhost(gc);

            if (this.inHome) {
                this.moveInHome();
            } else if (this.eyeBalls) {
                if (this.enteringHome) {
                    this.enterHome();
                } else {
                    this.moveEyeBalls();
                }
            } else if (this.blue) {
                this.moveRandomly();
            } else {
                this.chase();
            }

            if (this.x >= 448) {
                this.x -= 448;
            } else if (this.x <= -32) {
                this.x += 448;
            }
            if (this.y >= 496) {
                this.y -= 496;
            } else if (this.y <= -32) {
                this.y += 496;
            }

            this.playingMode.incrementRegionCount(this);
            if (this.playingMode.playerKilledFlag) {
                // Wrapping and region bookkeeping for the killing step are now complete.
                this.speedRemainder = toFloat(this.speedRemainder % 1);
                return;
            }
        }
    }

    public reverseDirection(): void {
        this.direction = Ghost.REVERSE_DIRECTION[this.direction];
    }

    public enterHome(): void {
        if (this.y < 14 * 16) {
            this.y++;
            this.direction = Main.DOWN;
        } else if (this.ghostIndex === Main.CYAN && this.x > 11 * 16 + 8) {
            this.x--;
            this.direction = Main.LEFT;
        } else if (this.ghostIndex === Main.ORANGE && this.x < 15 * 16 + 8) {
            this.x++;
            this.direction = Main.RIGHT;
        } else {
            this.eyeBalls = false;
            this.inHome = true;
            this.blue = false;
            this.exitingHome = true;
            this.enteringHome = false;
        }
    }

    public moveEyeBalls(): void {
        if ((this.x & 15) === 0 && (this.y & 15) === 0) {
            switch (this.getHomeDirection(this.x, this.y)) {
                case 5:
                case 1:
                    this.direction = Main.RIGHT;
                    break;
                case 2:
                    this.direction = Main.LEFT;
                    break;
                case 3:
                    this.direction = Main.DOWN;
                    break;
                case 4:
                    this.direction = Main.UP;
                    break;
            }
        }

        this.moveOnePixel();

        if (this.x === 13 * 16 + 8 && this.y === 11 * 16) {
            this.enteringHome = true;
        }
    }

    public moveInHome(): void {
        if (this.exitingHome) {
            if (this.x !== 13 * 16 + 8) {
                if (this.y < 14 * 16) {
                    this.y++;
                    this.direction = Main.UP;
                } else if (this.y > 14 * 16) {
                    this.y--;
                    this.direction = Main.DOWN;
                } else if (this.x < 13 * 16 + 8) {
                    this.x++;
                    this.direction = Main.RIGHT;
                } else if (this.x > 13 * 16 + 8) {
                    this.x--;
                    this.direction = Main.LEFT;
                }
            } else if (this.y > 11 * 16) {
                this.y--;
                this.direction = Main.UP;
            } else {
                this.inHome = false;
                this.speed = 1;
            }
        } else {
            switch (this.direction) {
                case Main.UP:
                    if (this.getType(this.x, this.y - 9) === TYPE_WALL) {
                        this.direction = Main.DOWN;
                    }
                    break;
                case Main.DOWN:
                    if (this.getType(this.x, this.y + 24) === TYPE_WALL) {
                        this.direction = Main.UP;
                    }
                    break;
            }

            switch (this.direction) {
                case Main.UP:
                    this.y--;
                    break;
                case Main.DOWN:
                    this.y++;
                    break;
            }
        }
    }

    public moveRandomly(): void {
        if (this.getMsPacManDistance() < 400) {
            this.playingMode.ghostEaten(this);
            return;
        }

        const reverseDirection = Ghost.REVERSE_DIRECTION[this.direction];

        let minDist = INT_MAX;
        let minDirection = this.direction;

        for (let i = 0; i < 4; i++) {
            if (i !== reverseDirection) {
                switch (i) {
                    case Main.UP:
                        if (this.canMoveUp()) {
                            let dist = this.main.random.nextInt(7919);
                            if (this.playingMode.getRegionCount(this.x, this.y - 1) !== 0) {
                                dist += 10000000;
                            }
                            if (dist < minDist) {
                                minDist = dist;
                                minDirection = Main.UP;
                            }
                        }
                        break;
                    case Main.DOWN:
                        if (this.canMoveDown()) {
                            let dist = this.main.random.nextInt(7919);
                            if (this.playingMode.getRegionCount(this.x, this.y + 16) !== 0) {
                                dist += 10000000;
                            }
                            if (dist < minDist) {
                                minDist = dist;
                                minDirection = Main.DOWN;
                            }
                        }
                        break;
                    case Main.LEFT:
                        if (this.canMoveLeft()) {
                            let dist = this.main.random.nextInt(7919);
                            if (this.playingMode.getRegionCount(this.x - 1, this.y) !== 0) {
                                dist += 10000000;
                            }
                            if (dist < minDist) {
                                minDist = dist;
                                minDirection = Main.LEFT;
                            }
                        }
                        break;
                    case Main.RIGHT:
                        if (this.canMoveRight()) {
                            let dist = this.main.random.nextInt(7919);
                            if (this.playingMode.getRegionCount(this.x + 16, this.y) !== 0) {
                                dist += 10000000;
                            }
                            if (dist < minDist) {
                                minDist = dist;
                                minDirection = Main.RIGHT;
                            }
                        }
                        break;
                }
            }
        }

        this.direction = minDirection;
        this.moveOnePixel();
    }

    public chase(): void {
        const reverseDirection = Ghost.REVERSE_DIRECTION[this.direction];

        let minDist = INT_MAX;
        let minDirection = this.direction;

        for (let i = 0; i < 4; i++) {
            if (i !== reverseDirection) {
                switch (i) {
                    case Main.UP:
                        if (this.canMoveUp()) {
                            let dist = this.getDist(this.x, this.y - 1);
                            if (this.playingMode.getRegionCount(this.x, this.y - 1) !== 0) {
                                dist += 10000000;
                            }
                            if (dist < minDist) {
                                minDist = dist;
                                minDirection = Main.UP;
                            }
                        }
                        break;
                    case Main.DOWN:
                        if (this.canMoveDown()) {
                            let dist = this.getDist(this.x, this.y + 1);
                            if (this.playingMode.getRegionCount(this.x, this.y + 16) !== 0) {
                                dist += 10000000;
                            }
                            if (dist < minDist) {
                                minDist = dist;
                                minDirection = Main.DOWN;
                            }
                        }
                        break;
                    case Main.LEFT:
                        if (this.canMoveLeft()) {
                            let dist = this.getDist(this.x - 1, this.y);
                            if (this.playingMode.getRegionCount(this.x - 1, this.y) !== 0) {
                                dist += 10000000;
                            }
                            if (dist < minDist) {
                                minDist = dist;
                                minDirection = Main.LEFT;
                            }
                        }
                        break;
                    case Main.RIGHT:
                        if (this.canMoveRight()) {
                            let dist = this.getDist(this.x + 1, this.y);
                            if (this.playingMode.getRegionCount(this.x + 16, this.y) !== 0) {
                                dist += 10000000;
                            }
                            if (dist < minDist) {
                                minDist = dist;
                                minDirection = Main.RIGHT;
                            }
                        }
                        break;
                }
            }
        }

        this.direction = minDirection;
        this.moveOnePixel();

        if (this.playingMode.distanceToMsPacMan(this.x, this.y) < 400) {
            this.playingMode.playerKilled();
        }
    }

    public intersects(ghost: Ghost): boolean {
        return this.main.intersects(this.x, this.y, this.x + 31, this.y + 31, ghost.x, ghost.y, ghost.x + 31, ghost.y + 31);
    }

    public render(gc: GameContainer, g: Graphics): void {
        if (this.playingMode.showGhostPoints && this.playingMode.eatenGhost === this) {
            this.draw(this.main.ghostPointsSprites[this.playingMode.ghostPointsIndex]);
            return;
        }

        if (this.eyeBalls) {
            this.drawWrapped(this.main.eyeBallsSprites[this.direction]);
        } else if (this.blue) {
            const index = this.spriteIndex + this.playingMode.ghostsBlueOffset;
            this.drawWrapped(this.main.blueGhostSprites[index]);
        } else {
            this.drawWrapped(this.sprites[this.direction][this.spriteIndex]);
        }
    }

    public abstract updateGhost(gc: GameContainer): void;

    public reset(): void {
        this.blue = false;
        this.eyeBalls = false;
        this.spriteIndex = 0;
        this.spriteIndexIncrementor = 0;
        this.targetX = 0;
        this.targetY = 0;
        this.inHome = false;
        this.exitingHome = false;
        this.enteringHome = false;
        this.speed = toFloat(1 + (0.3 * this.main.stageIndex) / 7);
        this.speedRemainder = 0;
    }

    protected drawWrapped(image: Image): void {
        this.draw(image);
        if (this.x > 424) {
            this.draw(image, this.x - 448, this.y);
        } else if (this.x < 8) {
            this.draw(image, this.x + 448, this.y);
        }
        if (this.y > 472) {
            this.draw(image, this.x, this.y - 496);
        } else if (this.y < 8) {
            this.draw(image, this.x, this.y + 496);
        }
    }

    private moveOnePixel(): void {
        switch (this.direction) {
            case Main.UP:
                this.y--;
                break;
            case Main.DOWN:
                this.y++;
                break;
            case Main.LEFT:
                this.x--;
                break;
            case Main.RIGHT:
                this.x++;
                break;
        }
    }
}
