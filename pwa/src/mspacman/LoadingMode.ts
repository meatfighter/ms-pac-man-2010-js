import { Color, GameContainer, Graphics, Music } from "slick2d-ts";
import type { IMode } from "./IMode";
import { Main } from "./Main";

export class LoadingMode implements IMode {
    private main: Main;
    private loadIndex = 0;
    private scoresRequested = false;

    public init(main: Main, gc: GameContainer): void {
        this.main = main;
        this.loadIndex = 14;
        this.scoresRequested = false;
    }

    public update(gc: GameContainer): void {
        if (!this.runStep(gc, true)) {
            return;
        }
        this.loadIndex--;
        this.main.resetNextFrameTime();
    }

    public completeImmediately(gc: GameContainer): void {
        while (this.main.isLoadingScreenActive() && this.loadIndex >= 0) {
            if (!this.runStep(gc, false)) {
                return;
            }
            this.loadIndex--;
        }
        this.main.resetNextFrameTime();
    }

    public render(gc: GameContainer, g: Graphics): void {
        g.setColor(Color.white);
        g.drawRect(328, 276, 144, 48);
        g.setColor(Color.blue);
        g.fillRect(329, 277, 143 * (1 - this.loadIndex / 14), 47);
        this.main.drawString("LOADING", 344, 292, Main.RED);
    }

    private runStep(gc: GameContainer, waitForScores: boolean): boolean {
        switch (this.loadIndex) {
            case 0:
                if (!this.main.handleLoadingComplete(gc)) {
                    this.main.setMode(Main.attractMode, gc);
                }
                break;
            case 1:
                this.main.actMusic[0] = new Music("music/act_1.ogg");
                break;
            case 2:
                this.main.actMusic[1] = new Music("music/act_2.ogg");
                break;
            case 3:
                this.main.actMusic[2] = new Music("music/act_3.ogg");
                break;
            case 4:
                this.main.stageMusic[0] = new Music("music/stage_1.ogg");
                break;
            case 5:
                this.main.stageMusic[1] = new Music("music/stage_2.ogg");
                break;
            case 6:
                this.main.stageMusic[2] = new Music("music/stage_3.ogg");
                break;
            case 7:
                this.main.stageMusic[3] = new Music("music/stage_4.ogg");
                break;
            case 8:
                this.main.trainingMusic = new Music("music/training.ogg");
                break;
            case 9:
                this.main.introMusic = new Music("music/intro.ogg");
                break;
            case 10:
                this.main.highScoreMusic = new Music("music/high_score.ogg");
                break;
            case 11:
                this.main.gameOverMusic = new Music("music/game_over.ogg");
                break;
            case 12:
                this.main.levelSelectMusic = new Music("music/level_select.ogg");
                break;
            case 13:
                if (!this.scoresRequested) {
                    this.scoresRequested = true;
                    this.main.downloadScores();
                }
                if (waitForScores && !this.main.scoresDownloadComplete) {
                    this.main.resetNextFrameTime();
                    return false;
                }
                break;
            case 14:
                break;
        }
        return true;
    }
}
