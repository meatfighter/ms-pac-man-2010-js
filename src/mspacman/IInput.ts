export interface IInput {
    reset(): void;
    isUp(): boolean;
    isDown(): boolean;
    isLeft(): boolean;
    isRight(): boolean;
    isEnter(): boolean;
    isSpace(): boolean;
    isEscape(): boolean;
    isPause(): boolean;
    clearKeyPressedRecord(): void;
    update(): boolean;
}
