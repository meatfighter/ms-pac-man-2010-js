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

    public isUpPressed(): boolean {
        return false;
    }

    public isDownPressed(): boolean {
        return false;
    }

    public isLeftPressed(): boolean {
        return false;
    }

    public isRightPressed(): boolean {
        return false;
    }

    public isMenuStartPressed(): boolean {
        return this.input.isKeyPressed(Input.KEY_ENTER) || this.input.isKeyPressed(Input.KEY_NUMPADENTER);
    }

    public isConfirmPressed(): boolean {
        return this.input.isKeyPressed(Input.KEY_ENTER) || this.input.isKeyPressed(Input.KEY_NUMPADENTER);
    }

    public isGameplayStartPressed(): boolean {
        return this.isConfirmPressed();
    }

    public isPausePressed(): boolean {
        return this.input.isKeyPressed(Input.KEY_P);
    }

    public clearKeyPressedRecord(): void {
        this.input.clearKeyPressedRecord();
        this.input.clearControlPressedRecord();
    }

    public getState(): { index: number } {
        return { index: this.index };
    }

    public setState(state: { readonly index: number }): void {
        this.index = Math.max(0, Math.min(this.data.length, Math.trunc(state.index)));
    }

    public update(): boolean {
        return ++this.index < this.data.length;
    }
}
