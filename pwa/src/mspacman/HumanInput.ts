import { GameContainer, Input } from "slick2d-ts";
import type { IInput } from "./IInput";

export class HumanInput implements IInput {
    private static readonly CONTROLLER_INDEX_LIMIT = 16;
    private static readonly GAMEPAD_BUTTON_INDEX_LIMIT = 100;
    private static readonly GAMEPAD_BUTTON_CONTROL_OFFSET = 4;
    private static readonly GAMEPAD_AXIS_LIMIT = 16;
    private static readonly AXIS_THRESHOLD = 0.5;
    private static readonly AXIS_RECENTER_THRESHOLD = 0.05;
    private static readonly EXTRA_HORIZONTAL_AXES = [2, 6];
    private static readonly EXTRA_VERTICAL_AXES = [3, 7];

    private static readonly UP_KEYS = [
        Input.KEY_UP,
        Input.KEY_W,
        Input.KEY_I,
        Input.KEY_8,
        Input.KEY_NUMPAD8
    ];

    private static readonly DOWN_KEYS = [
        Input.KEY_DOWN,
        Input.KEY_S,
        Input.KEY_K,
        Input.KEY_2,
        Input.KEY_NUMPAD2
    ];

    private static readonly LEFT_KEYS = [
        Input.KEY_LEFT,
        Input.KEY_A,
        Input.KEY_J,
        Input.KEY_4,
        Input.KEY_NUMPAD4
    ];

    private static readonly RIGHT_KEYS = [
        Input.KEY_RIGHT,
        Input.KEY_D,
        Input.KEY_L,
        Input.KEY_6,
        Input.KEY_NUMPAD6
    ];

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
    private extraAxisUpDown = false;
    private extraAxisDownDown = false;
    private extraAxisLeftDown = false;
    private extraAxisRightDown = false;
    private readonly extraAxisBaselines = new Array<number>(
        HumanInput.CONTROLLER_INDEX_LIMIT * HumanInput.GAMEPAD_AXIS_LIMIT
    ).fill(Number.NaN);

    public constructor(gc: GameContainer) {
        this.input = gc.getInput();
    }

    public reset(): void {
        this.syncExtraAxisDirectionState();
    }

    public isUp(): boolean {
        return this.isAnyKeyDown(HumanInput.UP_KEYS)
            || this.input.isControllerUp(Input.ANY_CONTROLLER)
            || this.isExtraAxisUpDown();
    }

    public isDown(): boolean {
        return this.isAnyKeyDown(HumanInput.DOWN_KEYS)
            || this.input.isControllerDown(Input.ANY_CONTROLLER)
            || this.isExtraAxisDownDown();
    }

    public isLeft(): boolean {
        return this.isAnyKeyDown(HumanInput.LEFT_KEYS)
            || this.input.isControllerLeft(Input.ANY_CONTROLLER)
            || this.isExtraAxisLeftDown();
    }

    public isRight(): boolean {
        return this.isAnyKeyDown(HumanInput.RIGHT_KEYS)
            || this.input.isControllerRight(Input.ANY_CONTROLLER)
            || this.isExtraAxisRightDown();
    }

    public isUpPressed(): boolean {
        const keyboard = this.isAnyKeyPressed(HumanInput.UP_KEYS);
        const controller = this.isControllerDirectionPressed(2);
        const extraAxis = this.isExtraAxisUpPressed();
        return keyboard || controller || extraAxis;
    }

    public isDownPressed(): boolean {
        const keyboard = this.isAnyKeyPressed(HumanInput.DOWN_KEYS);
        const controller = this.isControllerDirectionPressed(3);
        const extraAxis = this.isExtraAxisDownPressed();
        return keyboard || controller || extraAxis;
    }

    public isLeftPressed(): boolean {
        const keyboard = this.isAnyKeyPressed(HumanInput.LEFT_KEYS);
        const controller = this.isControllerDirectionPressed(0);
        const extraAxis = this.isExtraAxisLeftPressed();
        return keyboard || controller || extraAxis;
    }

    public isRightPressed(): boolean {
        const keyboard = this.isAnyKeyPressed(HumanInput.RIGHT_KEYS);
        const controller = this.isControllerDirectionPressed(1);
        const extraAxis = this.isExtraAxisRightPressed();
        return keyboard || controller || extraAxis;
    }

    public isMenuStartPressed(): boolean {
        const keyboard = this.isAnyKeyPressed(HumanInput.MENU_START_KEYS);
        const controller = this.isGamepadButtonStartPressed();
        return keyboard || controller;
    }

    public isConfirmPressed(): boolean {
        const keyboard = this.isAnyKeyPressed(HumanInput.CONFIRM_START_KEYS);
        const controller = this.isGamepadButtonStartPressed();
        return keyboard || controller;
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
        this.syncExtraAxisDirectionState();
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
        for (let controller = 0; controller < HumanInput.CONTROLLER_INDEX_LIMIT; controller++) {
            pressed = this.input.isControlPressed(control, controller) || pressed;
        }
        return pressed;
    }

    private isGamepadButtonStartPressed(): boolean {
        let pressed = false;
        for (let controller = 0; controller < HumanInput.CONTROLLER_INDEX_LIMIT; controller++) {
            for (let button = 0; button < HumanInput.GAMEPAD_BUTTON_INDEX_LIMIT; button++) {
                const control = HumanInput.GAMEPAD_BUTTON_CONTROL_OFFSET + button;
                pressed = this.input.isControlPressed(control, controller) || pressed;
            }
        }
        return pressed;
    }

    private isExtraAxisUpDown(): boolean {
        return this.isAnyAxisLessThan(HumanInput.EXTRA_VERTICAL_AXES, -HumanInput.AXIS_THRESHOLD);
    }

    private isExtraAxisDownDown(): boolean {
        return this.isAnyAxisGreaterThan(HumanInput.EXTRA_VERTICAL_AXES, HumanInput.AXIS_THRESHOLD);
    }

    private isExtraAxisLeftDown(): boolean {
        return this.isAnyAxisLessThan(HumanInput.EXTRA_HORIZONTAL_AXES, -HumanInput.AXIS_THRESHOLD);
    }

    private isExtraAxisRightDown(): boolean {
        return this.isAnyAxisGreaterThan(HumanInput.EXTRA_HORIZONTAL_AXES, HumanInput.AXIS_THRESHOLD);
    }

    private isExtraAxisUpPressed(): boolean {
        const down = this.isExtraAxisUpDown();
        const pressed = down && !this.extraAxisUpDown;
        this.extraAxisUpDown = down;
        return pressed;
    }

    private isExtraAxisDownPressed(): boolean {
        const down = this.isExtraAxisDownDown();
        const pressed = down && !this.extraAxisDownDown;
        this.extraAxisDownDown = down;
        return pressed;
    }

    private isExtraAxisLeftPressed(): boolean {
        const down = this.isExtraAxisLeftDown();
        const pressed = down && !this.extraAxisLeftDown;
        this.extraAxisLeftDown = down;
        return pressed;
    }

    private isExtraAxisRightPressed(): boolean {
        const down = this.isExtraAxisRightDown();
        const pressed = down && !this.extraAxisRightDown;
        this.extraAxisRightDown = down;
        return pressed;
    }

    private isAnyAxisLessThan(axes: readonly number[], threshold: number): boolean {
        for (let controller = 0; controller < HumanInput.CONTROLLER_INDEX_LIMIT; controller++) {
            for (let i = 0; i < axes.length; i++) {
                if (this.readExtraAxisValue(controller, axes[i]) < threshold) {
                    return true;
                }
            }
        }
        return false;
    }

    private isAnyAxisGreaterThan(axes: readonly number[], threshold: number): boolean {
        for (let controller = 0; controller < HumanInput.CONTROLLER_INDEX_LIMIT; controller++) {
            for (let i = 0; i < axes.length; i++) {
                if (this.readExtraAxisValue(controller, axes[i]) > threshold) {
                    return true;
                }
            }
        }
        return false;
    }

    private readExtraAxisValue(controller: number, axis: number): number {
        if (this.input.getAxisCount(controller) <= axis) {
            return 0;
        }
        const value = this.input.getAxisValue(controller, axis);
        const baselineIndex = controller * HumanInput.GAMEPAD_AXIS_LIMIT + axis;
        let baseline = this.extraAxisBaselines[baselineIndex];
        if (Number.isNaN(baseline)) {
            baseline = value;
            this.extraAxisBaselines[baselineIndex] = baseline;
        }
        if (Math.abs(value) <= HumanInput.AXIS_RECENTER_THRESHOLD) {
            baseline = 0;
            this.extraAxisBaselines[baselineIndex] = baseline;
        }
        return value - baseline;
    }

    private syncExtraAxisDirectionState(): void {
        this.extraAxisUpDown = this.isExtraAxisUpDown();
        this.extraAxisDownDown = this.isExtraAxisDownDown();
        this.extraAxisLeftDown = this.isExtraAxisLeftDown();
        this.extraAxisRightDown = this.isExtraAxisRightDown();
    }
}
