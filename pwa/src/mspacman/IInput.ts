export interface IInput {
    reset(): void;
    isUp(): boolean;
    isDown(): boolean;
    isLeft(): boolean;
    isRight(): boolean;
    isUpPressed(): boolean;
    isDownPressed(): boolean;
    isLeftPressed(): boolean;
    isRightPressed(): boolean;
    isMenuStartPressed(): boolean;
    isConfirmPressed(): boolean;
    isGameplayStartPressed(): boolean;
    isPausePressed(): boolean;
    isFullscreenTogglePressed(): boolean;
    isFullscreenExitPressed(): boolean;
    clearKeyPressedRecord(): void;
    update(): boolean;
}
