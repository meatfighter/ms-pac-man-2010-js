import { BufferedScalableGame, BufferedScalingMode, type Game } from "slick2d-ts";

export type MsPacManScalingPreference = "smooth" | "crisp" | "pixel-perfect";

export class ScalableGame2 extends BufferedScalableGame {
    public constructor(held: Game, normalWidth: number, normalHeight: number, maintainAspect = false) {
        super(held, normalWidth, normalHeight, {
            maintainAspect,
            scalingMode: BufferedScalingMode.Nearest
        });
    }

    public setScalingPreference(preference: MsPacManScalingPreference): void {
        this.setScalingMode(toBufferedScalingMode(preference));
    }
}

function toBufferedScalingMode(preference: MsPacManScalingPreference): BufferedScalingMode {
    switch (preference) {
        case "smooth":
            return BufferedScalingMode.Linear;
        case "pixel-perfect":
            return BufferedScalingMode.Integer;
        case "crisp":
            return BufferedScalingMode.Nearest;
    }
}
