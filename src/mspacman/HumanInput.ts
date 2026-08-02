import { GameContainer, Input } from "slick2d-ts";
import type { IInput } from "./IInput";

export class HumanInput implements IInput {
    private readonly input: Input;

    public constructor(gc: GameContainer) {
        this.input = gc.getInput();
    }

    public reset(): void {
    }

    public isUp(): boolean {
        return this.input.isKeyDown(Input.KEY_UP) || this.input.isKeyDown(Input.KEY_W)
            || this.input.isKeyDown(Input.KEY_I) || this.input.isKeyDown(Input.KEY_8);
    }

    public isDown(): boolean {
        return this.input.isKeyDown(Input.KEY_DOWN) || this.input.isKeyDown(Input.KEY_S)
            || this.input.isKeyDown(Input.KEY_K) || this.input.isKeyDown(Input.KEY_2);
    }

    public isLeft(): boolean {
        return this.input.isKeyDown(Input.KEY_LEFT) || this.input.isKeyDown(Input.KEY_A)
            || this.input.isKeyDown(Input.KEY_J) || this.input.isKeyDown(Input.KEY_4);
    }

    public isRight(): boolean {
        return this.input.isKeyDown(Input.KEY_RIGHT) || this.input.isKeyDown(Input.KEY_D)
            || this.input.isKeyDown(Input.KEY_L) || this.input.isKeyDown(Input.KEY_6);
    }

    public isEnter(): boolean {
        return this.input.isKeyPressed(Input.KEY_ENTER);
    }

    public isSpace(): boolean {
        return this.input.isKeyPressed(Input.KEY_SPACE);
    }

    public isEscape(): boolean {
        return this.input.isKeyPressed(Input.KEY_ESCAPE);
    }

    public isPause(): boolean {
        return this.input.isKeyPressed(Input.KEY_P);
    }

    public clearKeyPressedRecord(): void {
        this.input.clearKeyPressedRecord();
    }

    public update(): boolean {
        return true;
    }
}
