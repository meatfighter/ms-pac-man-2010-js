import type { GameContainer, Graphics, Image } from "slick2d-ts";
import type { Main } from "./Main";
import type { PlayingMode } from "./PlayingMode";

const TYPE_WALL = 3;

export abstract class Thing {
    public x = 0;
    public y = 0;
    public speed = 0;
    public speedRemainder = 0;
    public direction = 0;
    public playingMode: PlayingMode;
    public main: Main;

    public constructor(playingMode: PlayingMode) {
        this.playingMode = playingMode;
        this.main = playingMode.main;
    }

    public canMoveLeft(): boolean {
        return (this.y & 15) === 0 && this.getType(this.x - 1, this.y) !== TYPE_WALL;
    }

    public canMoveRight(): boolean {
        return (this.y & 15) === 0 && this.getType(this.x + 16, this.y) !== TYPE_WALL;
    }

    public canMoveUp(): boolean {
        return (this.x & 15) === 0 && this.getType(this.x, this.y - 1) !== TYPE_WALL;
    }

    public canMoveDown(): boolean {
        return (this.x & 15) === 0 && this.getType(this.x, this.y + 16) !== TYPE_WALL;
    }

    public getMsPacManDistance(): number {
        const dx = this.x - this.playingMode.mspacman.x;
        const dy = this.y - this.playingMode.mspacman.y;
        return dx * dx + dy * dy;
    }

    public getHomeDirection(x: number, y: number): number {
        const ty = this.tileY(y);
        const tx = this.tileX(x);
        return this.playingMode.homeTree[ty][tx];
    }

    public getTile(x: number, y: number): number {
        const ty = this.tileY(y);
        const tx = this.tileX(x);
        return this.playingMode.tileMap[ty][tx];
    }

    public setTile(x: number, y: number, tile: number): void {
        const ty = this.tileY(y);
        const tx = this.tileX(x);
        this.playingMode.tileMap[ty][tx] = tile;
    }

    public getType(x: number, y: number): number {
        const ty = this.tileY(y);
        const tx = this.tileX(x);
        return this.playingMode.typeMap[ty][tx];
    }

    public setType(x: number, y: number, type: number): void {
        const ty = this.tileY(y);
        const tx = this.tileX(x);
        this.playingMode.typeMap[ty][tx] = type;
    }

    public draw(image: Image, x?: number, y?: number): void {
        image.draw(168 + (x ?? this.x), 40 + (y ?? this.y));
    }

    public abstract update(gc: GameContainer): void;

    public abstract render(gc: GameContainer, g: Graphics): void;

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
