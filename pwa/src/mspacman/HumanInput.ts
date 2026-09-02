import { GameContainer, Input } from "slick2d-ts";
import type { IInput } from "./IInput";

export class HumanInput implements IInput {
    private static readonly GAMEPAD_BUTTON_CONTROL_OFFSET = 4;
    private static readonly EXTRA_DIRECTION_AXES = [
        { horizontalAxis: 2, verticalAxis: 3 },
        { horizontalAxis: 6, verticalAxis: 7 }
    ] as const;

    private static readonly UP_KEYS = [Input.KEY_UP, Input.KEY_W, Input.KEY_I, Input.KEY_8, Input.KEY_NUMPAD8];

    private static readonly DOWN_KEYS = [Input.KEY_DOWN, Input.KEY_S, Input.KEY_K, Input.KEY_2, Input.KEY_NUMPAD2];

    private static readonly LEFT_KEYS = [Input.KEY_LEFT, Input.KEY_A, Input.KEY_J, Input.KEY_4, Input.KEY_NUMPAD4];

    private static readonly RIGHT_KEYS = [Input.KEY_RIGHT, Input.KEY_D, Input.KEY_L, Input.KEY_6, Input.KEY_NUMPAD6];

    private static readonly CONFIRM_START_KEYS = [
        Input.KEY_ENTER,
        Input.KEY_NUMPADENTER,
        Input.KEY_Q,
        Input.KEY_E,
        Input.KEY_R,
        Input.KEY_T,
        Input.KEY_Y,
        Input.KEY_U,
        Input.KEY_O,
        Input.KEY_F,
        Input.KEY_G,
        Input.KEY_H,
        Input.KEY_Z,
        Input.KEY_X,
        Input.KEY_C,
        Input.KEY_V,
        Input.KEY_B,
        Input.KEY_N,
        Input.KEY_M,
        Input.KEY_0,
        Input.KEY_1,
        Input.KEY_3,
        Input.KEY_5,
        Input.KEY_7,
        Input.KEY_9,
        Input.KEY_NUMPAD0,
        Input.KEY_NUMPAD1,
        Input.KEY_NUMPAD3,
        Input.KEY_NUMPAD5,
        Input.KEY_NUMPAD7,
        Input.KEY_NUMPAD9,
        Input.KEY_MINUS,
        Input.KEY_EQUALS,
        Input.KEY_LBRACKET,
        Input.KEY_RBRACKET,
        Input.KEY_SEMICOLON,
        Input.KEY_APOSTROPHE,
        Input.KEY_GRAVE,
        Input.KEY_BACKSLASH,
        Input.KEY_COMMA,
        Input.KEY_PERIOD,
        Input.KEY_SLASH,
        Input.KEY_MULTIPLY,
        Input.KEY_SUBTRACT,
        Input.KEY_ADD,
        Input.KEY_DECIMAL,
        Input.KEY_NUMPADEQUALS,
        Input.KEY_NUMPADCOMMA,
        Input.KEY_DIVIDE
    ];

    private static readonly MENU_START_KEYS = [
        ...HumanInput.CONFIRM_START_KEYS,
        ...HumanInput.UP_KEYS,
        ...HumanInput.DOWN_KEYS,
        ...HumanInput.LEFT_KEYS,
        ...HumanInput.RIGHT_KEYS,
        Input.KEY_P
    ];

    private readonly input: Input;

    public constructor(gc: GameContainer) {
        this.input = gc.getInput();
        this.input.setAdditionalControllerDirectionAxes(HumanInput.EXTRA_DIRECTION_AXES);
    }

    public reset(): void {
        this.input.setAdditionalControllerDirectionAxes(HumanInput.EXTRA_DIRECTION_AXES);
    }

    public isUp(): boolean {
        return this.isAnyKeyDown(HumanInput.UP_KEYS) || this.input.isControllerUp(Input.ANY_CONTROLLER);
    }

    public isDown(): boolean {
        return this.isAnyKeyDown(HumanInput.DOWN_KEYS) || this.input.isControllerDown(Input.ANY_CONTROLLER);
    }

    public isLeft(): boolean {
        return this.isAnyKeyDown(HumanInput.LEFT_KEYS) || this.input.isControllerLeft(Input.ANY_CONTROLLER);
    }

    public isRight(): boolean {
        return this.isAnyKeyDown(HumanInput.RIGHT_KEYS) || this.input.isControllerRight(Input.ANY_CONTROLLER);
    }

    public isUpPressed(): boolean {
        return this.isAnyKeyPressed(HumanInput.UP_KEYS) || this.isControllerDirectionPressed(2);
    }

    public isDownPressed(): boolean {
        return this.isAnyKeyPressed(HumanInput.DOWN_KEYS) || this.isControllerDirectionPressed(3);
    }

    public isLeftPressed(): boolean {
        return this.isAnyKeyPressed(HumanInput.LEFT_KEYS) || this.isControllerDirectionPressed(0);
    }

    public isRightPressed(): boolean {
        return this.isAnyKeyPressed(HumanInput.RIGHT_KEYS) || this.isControllerDirectionPressed(1);
    }

    public isMenuStartPressed(): boolean {
        return this.isAnyKeyPressed(HumanInput.MENU_START_KEYS) || this.isGamepadButtonStartPressed();
    }

    public isConfirmPressed(): boolean {
        return this.isAnyKeyPressed(HumanInput.CONFIRM_START_KEYS) || this.isGamepadButtonStartPressed();
    }

    public isGameplayStartPressed(): boolean {
        return this.isConfirmPressed();
    }

    public isPausePressed(): boolean {
        return this.input.isKeyPressed(Input.KEY_P);
    }

    public isFullscreenTogglePressed(): boolean {
        return this.input.isKeyPressed(Input.KEY_SPACE);
    }

    public isFullscreenExitPressed(): boolean {
        return this.input.isKeyPressed(Input.KEY_ESCAPE);
    }

    public clearKeyPressedRecord(): void {
        this.input.clearKeyPressedRecord();
        this.input.clearControlPressedRecord();
    }

    public update(): boolean {
        return true;
    }

    private isAnyKeyDown(keys: readonly number[]): boolean {
        for (let i = 0; i < keys.length; i++) {
            if (this.input.isKeyDown(keys[i])) {
                return true;
            }
        }
        return false;
    }

    private isAnyKeyPressed(keys: readonly number[]): boolean {
        let pressed = false;
        for (let i = 0; i < keys.length; i++) {
            pressed = this.input.isKeyPressed(keys[i]) || pressed;
        }
        return pressed;
    }

    private isControllerDirectionPressed(control: number): boolean {
        let pressed = false;
        for (let controller = 0; controller < this.input.getControllerCount(); controller++) {
            pressed = this.input.isControlPressed(control, controller) || pressed;
        }
        return pressed;
    }

    private isGamepadButtonStartPressed(): boolean {
        let pressed = false;
        for (let controller = 0; controller < this.input.getControllerCount(); controller++) {
            const buttonCount = this.input.getButtonCount(controller);
            for (let button = 0; button < buttonCount; button++) {
                const control = HumanInput.GAMEPAD_BUTTON_CONTROL_OFFSET + button;
                pressed = this.input.isControlPressed(control, controller) || pressed;
            }
        }
        return pressed;
    }
}
