import type { GameContainer, Graphics } from "slick2d-ts";
import type { Main } from "./Main";

export interface IMode {
    init(main: Main, gc: GameContainer): void;
    update(gc: GameContainer): void;
    render(gc: GameContainer, g: Graphics): void;
}
