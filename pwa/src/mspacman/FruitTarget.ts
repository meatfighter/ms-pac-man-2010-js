import { FastTrig, GameContainer, Graphics } from "slick2d-ts";
import { Main } from "./Main";
import type { PlayingMode } from "./PlayingMode";
import { Thing } from "./Thing";
import { toFloat, toInt } from "./JavaMath";

export class FruitTarget extends Thing {
    public exitPath: number[][] | null = null;
    public fruitIndex = 0;
    public yOffset = 0;
    public yOffsetAngle = 0;
    public goingAroundHome = false;
    public clockwise = false;
    public aroundHomeIndex = 0;
    public exiting = false;
    public eatenTimer = 0;
    public eaten = false;

    public constructor(playingMode: PlayingMode) {
        super(playingMode);
        this.speed = 0.5;
    }

    public reset(): void {
        this.exitPath = null;
        this.eaten = false;
        this.eatenTimer = 0;
        this.fruitIndex = 0;
        this.yOffset = 0;
        this.yOffsetAngle = 0;
        this.speedRemainder = 0;
        this.goingAroundHome = false;
        this.clockwise = false;
        this.aroundHomeIndex = 0;
        this.exiting = false;
    }

    public update(gc: GameContainer): void {
        const sin = toFloat(FastTrig.sin(this.yOffsetAngle));
        this.yOffset = 3 + toInt(-sin * sin * 6);
        this.yOffsetAngle = toFloat(this.yOffsetAngle + 0.1);

        this.speedRemainder = toFloat(this.speedRemainder + this.speed);

        while (this.speedRemainder >= 1) {
            this.speedRemainder = toFloat(this.speedRemainder - 1);

            if (!this.eaten && this.getMsPacManDistance() < 400) {
                this.main.playSound(this.main.ateFruitSound);
                this.eaten = true;
                switch (this.fruitIndex) {
                    case 0:
                        this.playingMode.addPoints(100);
                        break;
                    case 1:
                        this.playingMode.addPoints(200);
                        break;
                    case 2:
                        this.playingMode.addPoints(500);
                        break;
                    case 3:
                        this.playingMode.addPoints(700);
                        break;
                    case 4:
                        this.playingMode.addPoints(1000);
                        break;
                    case 5:
                        this.playingMode.addPoints(2000);
                        break;
                    case 6:
                        this.playingMode.addPoints(5000);
                        break;
                }
            }

            if (this.eaten) {
                if (++this.eatenTimer >= 91) {
                    this.reset();
                    this.playingMode.fruitTargetExited();
                }
                return;
            }

            if (this.exiting) {
                if (this.x <= -32 || this.x >= 448 || this.y <= -32 || this.y >= 496) {
                    this.reset();
                    this.playingMode.fruitTargetExited();
                    return;
                }

                if ((this.x & 15) === 0 && (this.y & 15) === 0) {
                    switch (this.getExitDirection(this.x, this.y)) {
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
            } else if (this.x < 0) {
                this.x++;
            } else if (this.x > 416) {
                this.x--;
            } else if (this.y < 0) {
                this.y++;
            } else if (this.y > 464) {
                this.y--;
            } else if (this.goingAroundHome) {
                this.updateAroundHome();
            } else {
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
                    this.goingAroundHome = true;
                    this.aroundHomeIndex = 0;
                    this.clockwise = this.direction === Main.RIGHT;
                }
            }
        }
    }

    public getExitDirection(x: number, y: number): number {
        let tx = x >> 4;
        let ty = y >> 4;
        if (tx < 0) {
            tx += 28;
        } else if (tx >= 28) {
            tx -= 28;
        }
        if (ty < 0) {
            ty += 31;
        } else if (ty >= 31) {
            ty -= 31;
        }
        return this.exitPath![ty][tx];
    }

    public render(gc: GameContainer, g: Graphics): void {
        if (this.eaten) {
            this.draw(this.main.fruitPointsSprites[this.fruitIndex], this.x, this.y);
        } else {
            this.draw(this.main.fruitSprites[this.fruitIndex], this.x, this.y + this.yOffset);
        }
    }

    private updateAroundHome(): void {
        if (this.clockwise) {
            switch (this.aroundHomeIndex) {
                case 0:
                    if (this.x < 18 * 16) {
                        this.x++;
                    } else {
                        this.aroundHomeIndex = 1;
                    }
                    break;
                case 1:
                    if (this.y < 17 * 16) {
                        this.y++;
                    } else {
                        this.aroundHomeIndex = 2;
                    }
                    break;
                case 2:
                    if (this.x > 9 * 16) {
                        this.x--;
                    } else {
                        this.aroundHomeIndex = 3;
                    }
                    break;
                case 3:
                    if (this.y > 11 * 16) {
                        this.y--;
                    } else {
                        this.aroundHomeIndex = 4;
                    }
                    break;
                case 4:
                    if (this.x < 13 * 16 + 8) {
                        this.x++;
                    } else {
                        this.exitPath = this.playingMode.rightExitMaps[this.main.random.nextInt(this.playingMode.rightExitMaps.length)];
                        this.exiting = true;
                    }
                    break;
            }
        } else {
            switch (this.aroundHomeIndex) {
                case 0:
                    if (this.x > 9 * 16) {
                        this.x--;
                    } else {
                        this.aroundHomeIndex = 1;
                    }
                    break;
                case 1:
                    if (this.y < 17 * 16) {
                        this.y++;
                    } else {
                        this.aroundHomeIndex = 2;
                    }
                    break;
                case 2:
                    if (this.x < 18 * 16) {
                        this.x++;
                    } else {
                        this.aroundHomeIndex = 3;
                    }
                    break;
                case 3:
                    if (this.y > 11 * 16) {
                        this.y--;
                    } else {
                        this.aroundHomeIndex = 4;
                    }
                    break;
                case 4:
                    if (this.x > 13 * 16 + 8) {
                        this.x--;
                    } else {
                        this.exitPath = this.playingMode.leftExitMaps[this.main.random.nextInt(this.playingMode.leftExitMaps.length)];
                        this.exiting = true;
                    }
                    break;
            }
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
