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
        const enterPressed = this.input.isKeyPressed(Input.KEY_ENTER);
        const numpadEnterPressed = this.input.isKeyPressed(Input.KEY_NUMPADENTER);
        return enterPressed || numpadEnterPressed;
    }

    public isConfirmPressed(): boolean {
        const enterPressed = this.input.isKeyPressed(Input.KEY_ENTER);
        const numpadEnterPressed = this.input.isKeyPressed(Input.KEY_NUMPADENTER);
        return enterPressed || numpadEnterPressed;
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
        if (!Number.isSafeInteger(state.index) || state.index < 0) {
            throw new RangeError("Invalid saved robot-input cursor.");
        }
        // Exhausted input remains neutral; retain the producer cursor exactly.
        this.index = state.index;
    }

    public update(): boolean {
        return ++this.index < this.data.length;
    }
}
