import { GameContainer, Input } from "slick2d-ts";
import type { IInput } from "./IInput";

export class RobotInput implements IInput {
    private readonly input: Input;
    private readonly data: Uint8Array;
    private index: number;

    public constructor(data: Uint8Array, gc: GameContainer) {
        this.input = gc.getInput();
        this.data = data;
        this.index = 0;
    }

    public reset(): void {
        this.index = 0;
    }

    public isUp(): boolean {
        return this.index < this.data.length ? (this.data[this.index] & 1) !== 0 : false;
    }

    public isDown(): boolean {
        return this.index < this.data.length ? (this.data[this.index] & 2) !== 0 : false;
    }

    public isLeft(): boolean {
        return this.index < this.data.length ? (this.data[this.index] & 4) !== 0 : false;
    }

    public isRight(): boolean {
        return this.index < this.data.length ? (this.data[this.index] & 8) !== 0 : false;
    }

    public isEnter(): boolean {
        return this.input.isKeyPressed(Input.KEY_ENTER);
    }

    public isSpace(): boolean {
        return false;
    }

    public isEscape(): boolean {
        return false;
    }

    public isPause(): boolean {
        return false;
    }

    public clearKeyPressedRecord(): void {
        this.input.clearKeyPressedRecord();
    }

    public update(): boolean {
        return ++this.index < this.data.length;
    }
}
