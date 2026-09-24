import type { GameContainer, Graphics } from "slick2d-ts";
import type { IInput } from "./IInput";
import { Main } from "./Main";
import type { PlayingMode } from "./PlayingMode";
import { Thing } from "./Thing";
import { toFloat } from "./JavaMath";

const TYPE_EMPTY = 0;
const TYPE_PELLOT = 1;
const TYPE_ENERGIZER = 2;

export class MsPacMan extends Thing {
    public static readonly spritePattern = [0, 1, 2, 1];
    public static readonly CHOMP_SPEED = 6;

    public input: IInput;
    public spriteIndex = 0;
    public spriteIndexIncrementor = 0;

    public pellotDampensSpeed = false;
    public pellotDampensSpeedCount = 0;
    public corneringEnhancesSpeed = false;
    public corneringEnhancesSpeedCount = 0;
    public speedBoost = false;
    public speedBoostTimer = 0;

    public constructor(playingMode: PlayingMode) {
        super(playingMode);
    }

    public reset(): void {
        this.input = this.playingMode.input;

        this.x = 16 * 13 + 8;
        this.y = 16 * 23;

        this.speed = toFloat(1.25 + (0.5 * this.main.stageIndex) / 7);
        this.speedRemainder = 0;
        this.direction = Main.LEFT;

        this.spriteIndex = 0;
        this.spriteIndexIncrementor = 0;
        this.pellotDampensSpeed = false;
        this.pellotDampensSpeedCount = 0;
        this.corneringEnhancesSpeed = false;
        this.corneringEnhancesSpeedCount = 0;
        this.speedBoost = false;
        this.speedBoostTimer = 0;
    }

    public update(gc: GameContainer): void {
        if (this.playingMode.showGhostPoints) {
            return;
        }

        let speed = this.speed;
        let speedPercentChange = 1;

        if (this.pellotDampensSpeed) {
            speedPercentChange -= 0.1;
            if (--this.pellotDampensSpeedCount === 0) {
                this.pellotDampensSpeed = false;
            }
        }
        if (this.corneringEnhancesSpeed) {
            speedPercentChange += 0.1;
            if (--this.corneringEnhancesSpeedCount === 0) {
                this.corneringEnhancesSpeed = false;
            }
        }
        if (this.playingMode.ghostsBlue) {
            speedPercentChange += 0.1;
        }
        if (this.speedBoost) {
            if (++this.speedBoostTimer === 91 * 7) {
                this.speedBoostTimer = 0;
                this.speedBoost = false;
            }
            speedPercentChange += 0.6;
        }
        if (speedPercentChange !== 1) {
            speed = toFloat(speed * speedPercentChange);
        }

        this.speedRemainder = toFloat(this.speedRemainder + speed);

        while (this.speedRemainder >= 1) {
            this.speedRemainder = toFloat(this.speedRemainder - 1);

            const type = this.getType(this.x + 8, this.y + 8);
            if (type === TYPE_PELLOT || type === TYPE_ENERGIZER) {
                this.setType(this.x + 8, this.y + 8, TYPE_EMPTY);
                this.setTile(this.x + 8, this.y + 8, 47);
                this.playingMode.atePellot(type === TYPE_ENERGIZER);
                if (this.playingMode.finished) {
                    // Cancel remaining whole-pixel work, retaining a valid snapshot fraction.
                    this.speedRemainder = toFloat(this.speedRemainder % 1);
                    return;
                }
                if (type === TYPE_PELLOT) {
                    this.main.playSound(this.main.atePellotSound);
                    this.pellotDampensSpeed = true;
                    this.pellotDampensSpeedCount = 10;
                }
            }

            const isUp = this.input.isUp();
            const isDown = this.input.isDown();
            const isLeft = this.input.isLeft();
            const isRight = this.input.isRight();
            this.input.update();

            let targetDirection = this.direction;
            if (isUp) {
                targetDirection = Main.UP;
            } else if (isDown) {
                targetDirection = Main.DOWN;
            } else if (isLeft) {
                targetDirection = Main.LEFT;
            } else if (isRight) {
                targetDirection = Main.RIGHT;
            }

            if (this.direction !== targetDirection) {
                switch (targetDirection) {
                    case Main.UP:
                        if (this.canMoveUp()) {
                            this.direction = Main.UP;
                            this.corneringEnhancesSpeedNow();
                        }
                        break;
                    case Main.DOWN:
                        if (this.canMoveDown()) {
                            this.direction = Main.DOWN;
                            this.corneringEnhancesSpeedNow();
                        }
                        break;
                    case Main.LEFT:
                        if (this.canMoveLeft()) {
                            this.direction = Main.LEFT;
                            this.corneringEnhancesSpeedNow();
                        }
                        break;
                    case Main.RIGHT:
                        if (this.canMoveRight()) {
                            this.direction = Main.RIGHT;
                            this.corneringEnhancesSpeedNow();
                        }
                        break;
                }
            }

            switch (this.direction) {
                case Main.UP:
                    if (this.canMoveUp()) {
                        this.y--;
                        this.updateSpriteIndexEating();
                    } else {
                        this.updateSpriteIndexWalled();
                    }
                    break;
                case Main.DOWN:
                    if (this.canMoveDown()) {
                        this.y++;
                        this.updateSpriteIndexEating();
                    } else {
                        this.updateSpriteIndexWalled();
                    }
                    break;
                case Main.LEFT:
                    if (this.canMoveLeft()) {
                        this.x--;
                        this.updateSpriteIndexEating();
                    } else {
                        this.updateSpriteIndexWalled();
                    }
                    break;
                case Main.RIGHT:
                    if (this.canMoveRight()) {
                        this.x++;
                        this.updateSpriteIndexEating();
                    } else {
                        this.updateSpriteIndexWalled();
                    }
                    break;
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
        }
    }

    public boostSpeed(): void {
        this.speedBoost = true;
        this.speedBoostTimer = 0;
    }

    public render(gc: GameContainer, g: Graphics): void {
        if (this.playingMode.showGhostPoints) {
            return;
        }

        const image = this.main.mspacmanSprites[this.direction][MsPacMan.spritePattern[this.spriteIndex]];
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

    private corneringEnhancesSpeedNow(): void {
        this.corneringEnhancesSpeed = true;
        this.corneringEnhancesSpeedCount = 10;
    }

    private updateSpriteIndexWalled(): void {
        if (this.spriteIndex === 1 || this.spriteIndex === 3) {
            return;
        }
        this.updateSpriteIndexEating();
    }

    private updateSpriteIndexEating(): void {
        if (++this.spriteIndexIncrementor === MsPacMan.CHOMP_SPEED) {
            this.spriteIndexIncrementor = 0;
            if (++this.spriteIndex === 4) {
                this.spriteIndex = 0;
            }
        }
    }
}
