import { SoundStore } from "slick2d-ts";
import {
    AppGameContainer,
    BasicGame,
    BinaryReader,
    Color,
    Display,
    DisplayMode,
    GameContainer,
    Graphics,
    Image,
    JavaRandom,
    Music,
    PackedSpriteSheet,
    Renderer,
    ResourceLoader,
    Sound,
    Sys
} from "slick2d-ts";
import { Act1Mode } from "./Act1Mode";
import { Act2Mode } from "./Act2Mode";
import { Act3Mode } from "./Act3Mode";
import { Act4Mode } from "./Act4Mode";
import { Act5Mode } from "./Act5Mode";
import { Act6Mode } from "./Act6Mode";
import { Act7Mode } from "./Act7Mode";
import { AppletGameContainer2 } from "./AppletGameContainer2";
import { AttractMode } from "./AttractMode";
import { EndingMode } from "./EndingMode";
import { EnterInitialsMode } from "./EnterInitialsMode";
import { HallOfFameMode } from "./HallOfFameMode";
import { HighScore } from "./HighScore";
import { ROWS_PER_WORLD, type RemoteHighScore, isAllowedInitials, isPlausibleScore, isWorld, normalizeHighScoreInitials } from "./HighScoreProtocol";
import { HighScoreService } from "./HighScoreService";
import { HumanInput } from "./HumanInput";
import type { IInput } from "./IInput";
import type { IMode } from "./IMode";
import { IntroMode } from "./IntroMode";
import type { ModeId, SubmittedScoreSnapshot } from "./persistence/GameStateSnapshot";
import { RobotInput } from "./RobotInput";
import { SelectWorldMode } from "./SelectWorldMode";
import { Stage } from "./Stage";
import { charCode, intDiv, make3D } from "./JavaMath";
import { PlayingMode } from "./PlayingMode";

const DEMO_LENGTHS = [4390, 4381, 7539, 3676];
const GHOST_SPRITE_NAMES = ["red", "pink", "cyan", "orange"];

function imageGrid<T>(rows: number, columns: number): T[][] {
    const result = new Array<T[]>(rows);
    for (let i = 0; i < rows; i++) {
        result[i] = new Array<T>(columns);
    }
    return result;
}

function imageCube<T>(a: number, b: number, c: number): T[][][] {
    const result = new Array<T[][]>(a);
    for (let i = 0; i < a; i++) {
        result[i] = imageGrid<T>(b, c);
    }
    return result;
}

export type WindowedDisplayModeProvider = () => {
    width: number;
    height: number;
};

export type PauseStateChangeHandler = (paused: boolean) => void;

export class Main extends BasicGame {
    public static readonly UP = 0;
    public static readonly DOWN = 1;
    public static readonly LEFT = 2;
    public static readonly RIGHT = 3;

    public static readonly RED = 0;
    public static readonly PINK = 1;
    public static readonly CYAN = 2;
    public static readonly ORANGE = 3;
    public static readonly WHITE = 4;
    public static readonly YELLOW = 5;

    public static readonly attractMode: IMode = new AttractMode();
    public static readonly selectWorldMode: IMode = new SelectWorldMode();
    public static readonly introMode: IMode = new IntroMode();
    public static readonly playingMode: IMode = new PlayingMode();
    public static readonly act1Mode: IMode = new Act1Mode();
    public static readonly act2Mode: IMode = new Act2Mode();
    public static readonly act3Mode: IMode = new Act3Mode();
    public static readonly act4Mode: IMode = new Act4Mode();
    public static readonly act5Mode: IMode = new Act5Mode();
    public static readonly act6Mode: IMode = new Act6Mode();
    public static readonly act7Mode: IMode = new Act7Mode();
    public static readonly endingMode: IMode = new EndingMode();
    public static readonly hallOfFameMode: IMode = new HallOfFameMode();
    public static readonly enterInitialsMode: IMode = new EnterInitialsMode();

    public fades: Color[] = new Array<Color>(23);
    public random = new JavaRandom();
    public maxWidth = 0;
    public maxHeight = 0;
    public maxColorDepth = 0;
    public nativeDisplayMode: DisplayMode;
    public appGameContainer: AppGameContainer;
    public appletGameContainer: AppletGameContainer2;
    public nextFrameTime = 0;
    public mode: IMode;
    public worldIndex = 0;
    public stageIndex = 0;
    public input: IInput;
    public currentMusic: Music | null = null;
    public nativeCursor: unknown;
    public score = 0;
    public lives = 0;
    public paused = false;
    public highScores = imageGrid<HighScore>(4, 5);
    public musicVolume = 1;
    public musicVolumeFadeStep = 1 / 91;
    public fadeMusicFlag = false;
    public uploadComplete = false;
    public scoresDownloadComplete = true;
    public submittedScore: SubmittedScoreSnapshot | null = null;
    public robotInputs: RobotInput[] = new Array<RobotInput>(4);
    public demoIndex = 0;
    public demoMode = false;
    public browserSuspended = false;
    private startupLoadingComplete = false;
    public loadingCompleteHandler: ((gc: GameContainer) => boolean) | null = null;
    public windowedDisplayModeProvider: WindowedDisplayModeProvider | null = null;
    public pauseStateChangeHandler: PauseStateChangeHandler | null = null;
    private leaderboardRevision = 0;
    private browserLifetimeGeneration = 0;

    public symbols = imageGrid<Image | null>(6, 256);
    public ghostSprites = imageCube<Image>(4, 4, 2);
    public mspacmanSprites = imageGrid<Image>(4, 3);
    public pacmanSprites = imageGrid<Image>(4, 3);
    public tiles = imageGrid<Image>(8, 50);
    public stages = imageGrid<Stage>(4, 8);
    public blueGhostSprites = new Array<Image>(4);
    public ghostPointsSprites = new Array<Image>(4);
    public eyeBallsSprites = new Array<Image>(4);
    public whiteTiles = new Array<Image>(50);
    public fruitSprites = new Array<Image>(7);
    public fruitPointsSprites = new Array<Image>(7);
    public redEnergizerSprite: Image;
    public greenEnergizerSprite: Image;
    public heartSprite: Image;
    public clapperBottomSprite: Image;
    public clapperTopSprites = new Array<Image>(3);
    public juniorSprite: Image;
    public juniorRightSprite: Image;
    public juniorBagSprite: Image;
    public storkHeadSprite: Image;
    public storkWingsSprites = new Array<Image>(2);

    public actMusic = new Array<Music>(3);
    public stageMusic = new Array<Music>(4);
    public trainingMusic: Music;
    public introMusic: Music;
    public levelSelectMusic: Music;
    public highScoreMusic: Music;
    public gameOverMusic: Music;
    public atePellotSound: Sound;
    public ateEnergizerSound: Sound;
    public ateGhostSound: Sound;
    public ateFruitSound: Sound;
    public fruitAppearedSound: Sound;
    public blueGhostsSound: Sound;
    public clappingSound: Sound;
    public extraLifeSound: Sound;
    public diedSound: Sound;
    public pressedEnterSound: Sound;
    public speaking = imageGrid<Sound>(2, 10);

    public constructor() {
        super("Ms. Pac-Man 2010");
    }

    public init(gc: GameContainer): void {
        this.startupLoadingComplete = false;
        this.leaderboardRevision = 0;
        this.submittedScore = null;
        this.findNativeDisplayMode();
        this.initializeHighScores();
        this.initializeFadeColors();
        this.loadGraphics();
        this.loadSoundEffects();
        this.loadStages();
        this.loadDemos(gc);

        this.input = new HumanInput(gc);

        this.completeStartupLoading(gc);
    }

    public update(gc: GameContainer, delta: number): void {
        if (this.browserSuspended) {
            this.resetNextFrameTime();
            return;
        }

        if (this.fadeMusicFlag) {
            this.musicVolume -= this.musicVolumeFadeStep;
            if (this.musicVolume <= 0) {
                this.musicVolume = 0;
                this.fadeMusicFlag = false;
            }
            if (this.currentMusic !== null) {
                this.currentMusic.setVolume(this.musicVolume);
            }
        }
        if (this.paused) {
            if (this.isGameplayPauseTogglePressed()) {
                this.setPaused(false);
                gc.setMusicOn(true);
                this.resumeCurrentMusicAfterPause(gc);
            }
            this.resetNextFrameTime();
            return;
        } else if (this.isGameplayPauseTogglePressed()) {
            this.setPaused(true);
            this.stopAllSoundEffects();
            gc.setMusicOn(false);
        }
        let count = 0;
        while (this.nextFrameTime < Sys.getTime()) {
            this.fullScreenToggleCheck(gc);
            this.mode.update(gc);
            this.nextFrameTime += intDiv(Sys.getTimerResolution(), 91);
            if (++count === 8) {
                this.resetNextFrameTime();
                break;
            }
        }
    }

    public render(gc: GameContainer, g: Graphics): void {
        this.mode.render(gc, g);
        if (this.paused) {
            g.setColor(this.fades[11]);
            g.fillRect(0, 0, 800, 600);
            g.setColor(Color.black);
            g.fillRect(344, 284, 112, 32);
            this.drawString("PAUSED", 292, Main.YELLOW);
        }
    }

    public advanceStage(gc: GameContainer): void {
        switch (++this.stageIndex) {
            case 1:
                this.setMode(Main.act1Mode, gc);
                break;
            case 2:
                this.setMode(Main.act2Mode, gc);
                break;
            case 3:
                this.setMode(Main.act3Mode, gc);
                break;
            case 4:
                this.setMode(Main.act4Mode, gc);
                break;
            case 5:
                this.setMode(Main.act5Mode, gc);
                break;
            case 6:
                this.setMode(Main.act6Mode, gc);
                break;
            case 7:
                this.setMode(Main.act7Mode, gc);
                break;
            case 8:
                this.setMode(Main.endingMode, gc);
                break;
        }
    }

    public setMode(mode: IMode, gc: GameContainer): void {
        this.mode = mode;
        mode.init(this, gc);
        mode.update(gc);
        this.input.clearKeyPressedRecord();
        this.resetNextFrameTime();
    }

    public initModeForRestore(mode: IMode, gc: GameContainer): void {
        this.mode = mode;
        mode.init(this, gc);
        this.input.clearKeyPressedRecord();
        this.resetNextFrameTime();
    }

    public isLoadingScreenActive(): boolean {
        return !this.startupLoadingComplete;
    }

    public getCurrentModeIdForState(): ModeId {
        return this.getModeIdForState(this.mode);
    }

    public getModeForStateRestore(id: ModeId): IMode {
        switch (id) {
            case "act1":
                return Main.act1Mode;
            case "act2":
                return Main.act2Mode;
            case "act3":
                return Main.act3Mode;
            case "act4":
                return Main.act4Mode;
            case "act5":
                return Main.act5Mode;
            case "act6":
                return Main.act6Mode;
            case "act7":
                return Main.act7Mode;
            case "attract":
                return Main.attractMode;
            case "ending":
                return Main.endingMode;
            case "enterInitials":
                return Main.enterInitialsMode;
            case "hallOfFame":
                return Main.hallOfFameMode;
            case "intro":
                return Main.introMode;
            case "playing":
                return Main.playingMode;
            case "selectWorld":
                return Main.selectWorldMode;
        }
    }

    public getPlayingModeForState(): PlayingMode {
        return Main.playingMode as PlayingMode;
    }

    public drawNumber(value: number, digits: number, x: number, y: number, color: number): void {
        const s = this.symbols[color];
        if (value < 0) {
            value = 0;
        }
        x += (digits - 1) << 4;
        if (value === 0) {
            s[48]?.draw(x, y);
            return;
        }
        for (let i = 0; i < digits && value !== 0; i++, x -= 16, value = intDiv(value, 10)) {
            s[48 + (value % 10)]?.draw(x, y);
        }
    }

    public drawString(s: string, y: number, color: number): void;
    public drawString(string: string, x: number, y: number, color: number): void;
    public drawString(string: string, x: number, y: number, color: number, scale: number): void;
    public drawString(string: string, a: number, b: number, c?: number, d?: number): void {
        if (c === undefined) {
            this.drawStringAt(string, 400 - (string.length << 3), a, b);
            return;
        }
        if (d !== undefined) {
            this.drawStringScaled(string, a, b, c, d);
            return;
        }
        this.drawStringAt(string, a, b, c);
    }

    public drawAlpha(image: Image, x: number, y: number, alpha: number): void {
        image.setAlpha(alpha);
        image.draw(x, y);
        image.setAlpha(1);
    }

    public playSound(sound: Sound): void {
        sound.play();
    }

    public stopSound(sound: Sound): void {
        sound.stop();
    }

    public stopAllSoundEffects(): void {
        SoundStore.get().stopSoundEffects();
    }

    public stopAllSounds(): void {
        this.stopMusic();
        this.stopAllSoundEffects();
    }

    public invalidateBrowserLifetime(): void {
        this.browserLifetimeGeneration++;
    }

    public captureBrowserLifetimeGeneration(): number {
        return this.browserLifetimeGeneration;
    }

    public isBrowserLifetimeGenerationCurrent(generation: number): boolean {
        return generation === this.browserLifetimeGeneration;
    }

    /** Menu suspension is independent of the game's own pause and audio choices. */
    public setBrowserSuspended(suspended: boolean): void {
        this.browserSuspended = suspended;
        this.input?.clearKeyPressedRecord();
        this.resetNextFrameTime();
    }

    private resumeCurrentMusicAfterPause(gc: GameContainer | null | undefined): void {
        if (this.paused || gc === null || gc === undefined || !gc.isMusicOn()) {
            return;
        }
        this.currentMusic?.resume();
    }

    public drawRotatedScaled(image: Image, x: number, y: number, angle: number, scale: number): void {
        const gl = Renderer.get();
        gl.glPushMatrix();
        gl.glTranslatef(x + image.getWidth() * 0.5, y + image.getHeight() * 0.5, 0);
        gl.glRotatef(angle, 0, 0, 1);
        gl.glScalef(scale, scale, 1);
        image.draw(-image.getWidth() * 0.5, -image.getHeight() * 0.5);
        gl.glPopMatrix();
    }

    public drawScaled(image: Image, x: number, y: number, scale: number): void {
        const gl = Renderer.get();
        gl.glPushMatrix();
        gl.glTranslatef(x + image.getWidth() * 0.5, y + image.getHeight() * 0.5, 0);
        gl.glScalef(scale, scale, 1);
        image.draw(-image.getWidth() * 0.5, -image.getHeight() * 0.5);
        gl.glPopMatrix();
    }

    public fadeMusic(): void {
        if (this.currentMusic !== null) {
            this.fadeMusicFlag = true;
            this.musicVolume = 1;
        }
    }

    public stopMusic(): void {
        this.fadeMusicFlag = false;
        this.musicVolume = 1;
        if (this.currentMusic !== null) {
            this.currentMusic.stop();
        }
    }

    public playMusic(music: Music): void {
        this.stopMusic();
        this.fadeMusicFlag = false;
        this.musicVolume = 1;
        this.currentMusic = music;
        music.setVolume(1);
        if (!this.demoMode) {
            music.play();
        }
        music.setVolume(1);
    }

    public loopMusic(music: Music): void {
        this.stopMusic();
        this.fadeMusicFlag = false;
        this.musicVolume = 1;
        this.currentMusic = music;
        music.setVolume(1);
        if (!this.demoMode) {
            music.loop();
        }
        music.setVolume(1);
    }

    public resetNextFrameTime(): void {
        this.nextFrameTime = Sys.getTime();
    }

    public isStateSaveReady(): boolean {
        if (!this.startupLoadingComplete || this.mode === undefined) {
            return false;
        }
        for (let i = 0; i < this.actMusic.length; i++) {
            if (!this.actMusic[i]) {
                return false;
            }
        }
        for (let i = 0; i < this.stageMusic.length; i++) {
            if (!this.stageMusic[i]) {
                return false;
            }
        }
        return Boolean(this.trainingMusic && this.introMusic && this.levelSelectMusic && this.highScoreMusic && this.gameOverMusic);
    }

    public intersects(ax1: number, ay1: number, ax2: number, ay2: number, bx1: number, by1: number, bx2: number, by2: number): boolean {
        return ax2 >= bx1 && ax1 <= bx2 && ay2 >= by1 && ay1 <= by2;
    }

    public isHighScore(): boolean {
        return this.score > 0 && this.highScores[this.worldIndex][4].score < this.score;
    }

    public downloadScores(): void {
        this.scoresDownloadComplete = false;
        const revision = this.leaderboardRevision;
        const lifetime = this.captureBrowserLifetimeGeneration();
        void HighScoreService.downloadScores()
            .then((scores) => {
                if (!this.isBrowserLifetimeGenerationCurrent(lifetime)) {
                    return;
                }
                if (scores !== null) {
                    this.applyRemoteScoresIfCurrent(scores, revision);
                }
            })
            .finally(() => {
                if (this.isBrowserLifetimeGenerationCurrent(lifetime)) {
                    this.scoresDownloadComplete = true;
                }
            });
    }

    public accessScoresDatabaseAsync(update: boolean, world: number, score: number, initials: string): void {
        this.uploadComplete = false;
        const normalizedInitials = this.normalizeHighScoreInitials(initials);
        const submittedScore = this.accessScoresDatabase(update, world, score, normalizedInitials);
        if (submittedScore === null) {
            this.uploadComplete = true;
            return;
        }

        const revision = this.leaderboardRevision;
        const lifetime = this.captureBrowserLifetimeGeneration();
        void HighScoreService.submitScore(submittedScore.world, submittedScore.score, submittedScore.initials)
            .then((scores) => {
                if (!this.isBrowserLifetimeGenerationCurrent(lifetime)) {
                    return;
                }
                if (scores !== null) {
                    this.applyRemoteScoresIfCurrent(scores, revision);
                }
            })
            .finally(() => {
                if (this.isBrowserLifetimeGenerationCurrent(lifetime)) {
                    this.uploadComplete = true;
                }
            });
    }

    public accessScoresDatabase(update: boolean, world: number, score: number, initials: string): SubmittedScoreSnapshot | null {
        const normalizedInitials = this.normalizeHighScoreInitials(initials);
        if (!update || !isWorld(world) || !isPlausibleScore(score) || !isAllowedInitials(normalizedInitials)) {
            return null;
        }
        const rows = this.highScores[world];
        const submittedScore = {
            initials: normalizedInitials,
            score,
            world
        };
        if (rows.some((row) => row.score === score && row.initials === normalizedInitials)) {
            this.leaderboardRevision++;
            this.submittedScore = submittedScore;
            return submittedScore;
        }

        const before = this.serializeHighScoreRows(rows);
        const candidate = new HighScore();
        candidate.score = score;
        candidate.initials = normalizedInitials;
        rows.push(candidate);
        rows.sort((a, b) => b.score - a.score);
        rows.length = ROWS_PER_WORLD;

        const after = this.serializeHighScoreRows(rows);
        if (after !== before) {
            this.leaderboardRevision++;
        }

        if (!rows.some((row) => row.score === score && row.initials === normalizedInitials)) {
            this.submittedScore = null;
            return null;
        }

        this.submittedScore = submittedScore;
        return submittedScore;
    }

    public override closeRequested(): boolean {
        this.invalidateBrowserLifetime();
        this.stopAllSounds();
        return super.closeRequested();
    }

    private initializeFadeColors(): void {
        for (let i = 0; i < this.fades.length; i++) {
            this.fades[i] = new Color(0, 0, 0, intDiv(255 * i, this.fades.length - 1));
        }
    }

    private completeStartupLoading(gc: GameContainer): void {
        this.levelSelectMusic = new Music("music/level_select.ogg");
        this.gameOverMusic = new Music("music/game_over.ogg");
        this.highScoreMusic = new Music("music/high_score.ogg");
        this.introMusic = new Music("music/intro.ogg");
        this.trainingMusic = new Music("music/training.ogg");
        this.stageMusic[3] = new Music("music/stage_4.ogg");
        this.stageMusic[2] = new Music("music/stage_3.ogg");
        this.stageMusic[1] = new Music("music/stage_2.ogg");
        this.stageMusic[0] = new Music("music/stage_1.ogg");
        this.actMusic[2] = new Music("music/act_3.ogg");
        this.actMusic[1] = new Music("music/act_2.ogg");
        this.actMusic[0] = new Music("music/act_1.ogg");

        const handler = this.loadingCompleteHandler;
        this.loadingCompleteHandler = null;
        const loadingHandled = handler !== null && handler(gc);
        this.startupLoadingComplete = true;
        if (!loadingHandled) {
            this.setMode(Main.attractMode, gc);
        } else {
            this.resetNextFrameTime();
        }
        this.downloadScores();
    }

    private fullScreenToggleCheck(gc: GameContainer): void {
        const isEscape = this.input.isFullscreenExitPressed();
        if (this.input.isFullscreenTogglePressed() || isEscape) {
            if (gc.isFullscreen()) {
                this.showMouseCursor();
                if (this.appGameContainer) {
                    const displayMode = this.getWindowedDisplayMode();
                    void this.appGameContainer.setDisplayMode(displayMode.width, displayMode.height, false);
                }
            } else if (!isEscape) {
                this.hideMouseCursor();
                if (this.appGameContainer) {
                    void this.appGameContainer.setDisplayMode(this.maxWidth, this.maxHeight, true);
                }
            }
            this.resetNextFrameTime();
        }
    }

    private isGameplayPauseTogglePressed(): boolean {
        if (this.mode !== Main.playingMode || this.demoMode) {
            return false;
        }
        const explicitPause = this.input.isPausePressed();
        const startPause = this.input.isGameplayStartPressed();
        return explicitPause || startPause;
    }

    private setPaused(paused: boolean): void {
        if (this.paused === paused) {
            return;
        }
        this.paused = paused;
        this.pauseStateChangeHandler?.(paused);
    }

    private applyRemoteScoresIfCurrent(scores: readonly RemoteHighScore[], revision: number): void {
        if (revision !== this.leaderboardRevision) {
            return;
        }
        this.applyRemoteScores(scores);
        this.submittedScore = null;
        this.leaderboardRevision++;
    }

    private applyRemoteScores(scores: readonly RemoteHighScore[]): void {
        for (let world = 0; world < this.highScores.length; world++) {
            for (let row = 0; row < ROWS_PER_WORLD; row++) {
                this.highScores[world][row] = new HighScore();
            }
        }

        const indexes = new Array<number>(this.highScores.length).fill(0);
        for (const score of scores) {
            if (!isWorld(score.world)) {
                continue;
            }
            const row = indexes[score.world]++;
            if (row >= ROWS_PER_WORLD) {
                continue;
            }
            const highScore = new HighScore();
            highScore.score = score.score;
            highScore.initials = score.initials;
            this.highScores[score.world][row] = highScore;
        }
    }

    private serializeHighScoreRows(rows: readonly HighScore[]): string {
        return rows.map((row) => `${row.score}|${row.initials}`).join("\n");
    }

    private normalizeHighScoreInitials(initials: string): string {
        return normalizeHighScoreInitials(initials);
    }

    private getWindowedDisplayMode(): { width: number; height: number } {
        if (this.windowedDisplayModeProvider !== null) {
            try {
                const displayMode = this.windowedDisplayModeProvider();
                if (Number.isFinite(displayMode.width) && Number.isFinite(displayMode.height)) {
                    return {
                        width: Math.max(1, Math.trunc(displayMode.width)),
                        height: Math.max(1, Math.trunc(displayMode.height))
                    };
                }
            } catch {}
        }

        return {
            width: 800,
            height: 600
        };
    }

    private getModeIdForState(mode: IMode): ModeId {
        if (mode === Main.act1Mode) {
            return "act1";
        }
        if (mode === Main.act2Mode) {
            return "act2";
        }
        if (mode === Main.act3Mode) {
            return "act3";
        }
        if (mode === Main.act4Mode) {
            return "act4";
        }
        if (mode === Main.act5Mode) {
            return "act5";
        }
        if (mode === Main.act6Mode) {
            return "act6";
        }
        if (mode === Main.act7Mode) {
            return "act7";
        }
        if (mode === Main.attractMode) {
            return "attract";
        }
        if (mode === Main.endingMode) {
            return "ending";
        }
        if (mode === Main.enterInitialsMode) {
            return "enterInitials";
        }
        if (mode === Main.hallOfFameMode) {
            return "hallOfFame";
        }
        if (mode === Main.introMode) {
            return "intro";
        }
        if (mode === Main.playingMode) {
            return "playing";
        }
        if (mode === Main.selectWorldMode) {
            return "selectWorld";
        }
        throw new Error("Unsupported mode.");
    }

    private showMouseCursor(): void {}

    private hideMouseCursor(): void {}

    private findNativeDisplayMode(): void {
        for (const displayMode of Display.getAvailableDisplayModes()) {
            if (
                displayMode.getWidth() > this.maxWidth ||
                displayMode.getHeight() > this.maxHeight ||
                (displayMode.getWidth() === this.maxWidth && displayMode.getHeight() === this.maxHeight && displayMode.getBitsPerPixel() > this.maxColorDepth)
            ) {
                this.maxWidth = displayMode.getWidth();
                this.maxHeight = displayMode.getHeight();
                this.maxColorDepth = displayMode.getBitsPerPixel();
                this.nativeDisplayMode = displayMode;
            }
        }
        if (this.maxWidth <= 0 || this.maxHeight <= 0) {
            this.maxWidth = 800;
            this.maxHeight = 600;
            this.nativeDisplayMode = new DisplayMode(800, 600);
        }
    }

    private loadStages(): void {
        for (let a = 0; a < 4; a++) {
            for (let b = 0; b < 8; b++) {
                this.loadStage(a, b);
            }
        }
    }

    private loadDemos(gc: GameContainer): void {
        for (let i = 0; i < 4; i++) {
            this.loadDemo(gc, i);
        }
    }

    private loadDemo(gc: GameContainer, a: number): void {
        const fileName = `demos/demo_${a}_${a}.dat`;
        const bytes = ResourceLoader.getResourceAsStream(fileName);
        if (!bytes) {
            throw new Error(`Missing demo resource: ${fileName}`);
        }
        const reader = new BinaryReader(bytes);
        const data = new Uint8Array(DEMO_LENGTHS[a]);
        reader.readFully(data);
        this.robotInputs[a] = new RobotInput(data, gc);
    }

    private loadStage(a: number, b: number): void {
        const stage = (this.stages[a][b] = new Stage());
        const fileName = `stages/stage_${a}_${b}.dat`;
        const bytes = ResourceLoader.getResourceAsStream(fileName);
        if (!bytes) {
            throw new Error(`Missing stage resource: ${fileName}`);
        }
        const dis = new BinaryReader(bytes);
        stage.pelletCount = dis.readInt();
        stage.regionCount = dis.readInt();
        for (let i = 0; i < 31; i++) {
            for (let j = 0; j < 28; j++) {
                stage.tileMap[i][j] = this.readByte(dis, fileName);
            }
        }
        for (let i = 0; i < 31; i++) {
            for (let j = 0; j < 28; j++) {
                stage.regionMap[i][j] = this.readByte(dis, fileName);
            }
        }
        for (let i = 0; i < 31; i++) {
            for (let j = 0; j < 28; j++) {
                stage.homeTree[i][j] = this.readByte(dis, fileName);
            }
        }

        const leftExitMapCount = dis.readInt();
        stage.leftExitMaps = make3D(leftExitMapCount, 31, 28);
        for (let i = 0; i < leftExitMapCount; i++) {
            const size = dis.readInt();
            for (let j = 0; j < size; j++) {
                const x = dis.readInt();
                const y = dis.readInt();
                const direction = dis.readInt();
                stage.leftExitMaps[i][y][x] = direction;
            }
        }

        const rightExitMapCount = dis.readInt();
        stage.rightExitMaps = make3D(rightExitMapCount, 31, 28);
        for (let i = 0; i < rightExitMapCount; i++) {
            const size = dis.readInt();
            for (let j = 0; j < size; j++) {
                const x = dis.readInt();
                const y = dis.readInt();
                const direction = dis.readInt();
                stage.rightExitMaps[i][y][x] = direction;
            }
        }
    }

    private readByte(reader: BinaryReader, ref: string): number {
        const value = reader.read();
        if (value < 0) {
            throw new Error(`Unexpected EOF while reading ${ref}`);
        }
        return value;
    }

    private loadSoundEffects(): void {
        this.fruitAppearedSound = new Sound("soundfx/fruit_appeared.ogg");
        this.ateFruitSound = new Sound("soundfx/ate_fruit.ogg");
        this.atePellotSound = new Sound("soundfx/ate_pellot.ogg");
        this.ateEnergizerSound = new Sound("soundfx/ate_energizer.ogg");
        this.blueGhostsSound = new Sound("soundfx/blue_ghosts.ogg");
        this.ateGhostSound = new Sound("soundfx/ate_ghost.ogg");
        this.clappingSound = new Sound("soundfx/clapping.ogg");
        this.extraLifeSound = new Sound("soundfx/extra_life.ogg");
        this.diedSound = new Sound("soundfx/died.ogg");
        this.pressedEnterSound = new Sound("soundfx/pressed_enter.ogg");

        for (let i = 0; i < 2; i++) {
            for (let j = 0; j < 10; j++) {
                this.speaking[i][j] = new Sound(`soundfx/speaking_${i + 1}_${j}.ogg`);
            }
        }
    }

    private loadGraphics(): void {
        const pack1 = new PackedSpriteSheet("images/pack_1.def", Image.FILTER_NEAREST);
        const pack2 = new PackedSpriteSheet("images/pack_2.def", Image.FILTER_NEAREST);

        for (let i = 0; i < 8; i++) {
            for (let j = 0; j < 47; j++) {
                this.tiles[i][j] = pack2.getSprite(`stage_${i}_${j}`);
            }
            this.tiles[i][47] = pack2.getSprite("empty");
            if (((i & 1) === 0 || i === 5 || i === 3) && i !== 4) {
                this.tiles[i][48] = pack2.getSprite("white_pellot");
                this.tiles[i][49] = pack2.getSprite("white_energizer");
            } else {
                this.tiles[i][48] = pack2.getSprite("yellow_pellot");
                this.tiles[i][49] = pack2.getSprite("yellow_energizer");
            }
        }

        for (let j = 0; j < 46; j++) {
            this.whiteTiles[j] = pack2.getSprite(`white_${j}`);
        }
        this.whiteTiles[46] = pack2.getSprite("stage_7_46");
        this.whiteTiles[47] = pack2.getSprite("empty");
        this.whiteTiles[48] = pack2.getSprite("white_pellot");
        this.whiteTiles[49] = pack2.getSprite("white_energizer");

        this.loadCharacterSprites(pack1);
        this.loadGhostSprites(pack1);
        this.loadOtherSprites(pack1, pack2);

        this.loadSymbols(Main.RED, "red", pack2);
        this.loadSymbols(Main.PINK, "pink", pack2);
        this.loadSymbols(Main.CYAN, "cyan", pack2);
        this.loadSymbols(Main.ORANGE, "orange", pack2);
        this.loadSymbols(Main.WHITE, "white", pack2);
        this.loadSymbols(Main.YELLOW, "yellow", pack2);
    }

    private loadCharacterSprites(pack1: PackedSpriteSheet): void {
        this.mspacmanSprites[Main.UP][0] = pack1.getSprite("ms_pac_man_up_1");
        this.mspacmanSprites[Main.UP][1] = pack1.getSprite("ms_pac_man_up_2");
        this.mspacmanSprites[Main.UP][2] = pack1.getSprite("ms_pac_man_up_3");
        this.mspacmanSprites[Main.DOWN][0] = pack1.getSprite("ms_pac_man_down_1");
        this.mspacmanSprites[Main.DOWN][1] = pack1.getSprite("ms_pac_man_down_2");
        this.mspacmanSprites[Main.DOWN][2] = pack1.getSprite("ms_pac_man_down_3");
        this.mspacmanSprites[Main.LEFT][0] = pack1.getSprite("ms_pac_man_left_1");
        this.mspacmanSprites[Main.LEFT][1] = pack1.getSprite("ms_pac_man_left_2");
        this.mspacmanSprites[Main.LEFT][2] = pack1.getSprite("ms_pac_man_left_3");
        this.mspacmanSprites[Main.RIGHT][0] = pack1.getSprite("ms_pac_man_right_1");
        this.mspacmanSprites[Main.RIGHT][1] = pack1.getSprite("ms_pac_man_right_2");
        this.mspacmanSprites[Main.RIGHT][2] = pack1.getSprite("ms_pac_man_right_3");

        this.pacmanSprites[Main.UP][0] = pack1.getSprite("pac_man_up_1");
        this.pacmanSprites[Main.UP][1] = pack1.getSprite("pac_man_up_2");
        this.pacmanSprites[Main.UP][2] = pack1.getSprite("pac_man_closed");
        this.pacmanSprites[Main.DOWN][0] = pack1.getSprite("pac_man_down_1");
        this.pacmanSprites[Main.DOWN][1] = pack1.getSprite("pac_man_down_2");
        this.pacmanSprites[Main.DOWN][2] = pack1.getSprite("pac_man_closed");
        this.pacmanSprites[Main.LEFT][0] = pack1.getSprite("pac_man_left_1");
        this.pacmanSprites[Main.LEFT][1] = pack1.getSprite("pac_man_left_2");
        this.pacmanSprites[Main.LEFT][2] = pack1.getSprite("pac_man_closed");
        this.pacmanSprites[Main.RIGHT][0] = pack1.getSprite("pac_man_right_1");
        this.pacmanSprites[Main.RIGHT][1] = pack1.getSprite("pac_man_right_2");
        this.pacmanSprites[Main.RIGHT][2] = pack1.getSprite("pac_man_closed");
    }

    private loadGhostSprites(pack1: PackedSpriteSheet): void {
        for (let ghost = 0; ghost < GHOST_SPRITE_NAMES.length; ghost++) {
            const name = GHOST_SPRITE_NAMES[ghost];
            this.ghostSprites[ghost][Main.UP][0] = pack1.getSprite(`${name}_ghost_up_1`);
            this.ghostSprites[ghost][Main.UP][1] = pack1.getSprite(`${name}_ghost_up_2`);
            this.ghostSprites[ghost][Main.DOWN][0] = pack1.getSprite(`${name}_ghost_down_1`);
            this.ghostSprites[ghost][Main.DOWN][1] = pack1.getSprite(`${name}_ghost_down_2`);
            this.ghostSprites[ghost][Main.LEFT][0] = pack1.getSprite(`${name}_ghost_left_1`);
            this.ghostSprites[ghost][Main.LEFT][1] = pack1.getSprite(`${name}_ghost_left_2`);
            this.ghostSprites[ghost][Main.RIGHT][0] = pack1.getSprite(`${name}_ghost_right_1`);
            this.ghostSprites[ghost][Main.RIGHT][1] = pack1.getSprite(`${name}_ghost_right_2`);
        }
    }

    private loadOtherSprites(pack1: PackedSpriteSheet, pack2: PackedSpriteSheet): void {
        this.blueGhostSprites[0] = pack1.getSprite("blue_ghost_1");
        this.blueGhostSprites[1] = pack1.getSprite("blue_ghost_2");
        this.blueGhostSprites[2] = pack1.getSprite("white_ghost_1");
        this.blueGhostSprites[3] = pack1.getSprite("white_ghost_1");

        this.ghostPointsSprites[0] = pack1.getSprite("points_200");
        this.ghostPointsSprites[1] = pack1.getSprite("points_400");
        this.ghostPointsSprites[2] = pack1.getSprite("points_800");
        this.ghostPointsSprites[3] = pack1.getSprite("points_1600");

        this.eyeBallsSprites[Main.UP] = pack1.getSprite("eyes_up_1");
        this.eyeBallsSprites[Main.DOWN] = pack1.getSprite("eyes_down_1");
        this.eyeBallsSprites[Main.LEFT] = pack1.getSprite("eyes_left_1");
        this.eyeBallsSprites[Main.RIGHT] = pack1.getSprite("eyes_right_1");

        this.fruitSprites[0] = pack1.getSprite("cherries");
        this.fruitSprites[1] = pack1.getSprite("strawberry");
        this.fruitSprites[2] = pack1.getSprite("orange");
        this.fruitSprites[3] = pack1.getSprite("pretzel");
        this.fruitSprites[4] = pack1.getSprite("apple");
        this.fruitSprites[5] = pack1.getSprite("pear");
        this.fruitSprites[6] = pack1.getSprite("banana");

        this.fruitPointsSprites[0] = pack1.getSprite("diagonal_100");
        this.fruitPointsSprites[1] = pack1.getSprite("diagonal_200");
        this.fruitPointsSprites[2] = pack1.getSprite("diagonal_500");
        this.fruitPointsSprites[3] = pack1.getSprite("diagonal_700");
        this.fruitPointsSprites[4] = pack1.getSprite("diagonal_1000");
        this.fruitPointsSprites[5] = pack1.getSprite("diagonal_2000");
        this.fruitPointsSprites[6] = pack1.getSprite("diagonal_5000");

        this.redEnergizerSprite = pack2.getSprite("red_energizer");
        this.greenEnergizerSprite = pack2.getSprite("green_energizer");
        this.heartSprite = pack1.getSprite("heart");
        this.clapperBottomSprite = pack1.getSprite("clapper_bottom");
        this.clapperTopSprites[0] = pack1.getSprite("clapper_top_1");
        this.clapperTopSprites[1] = pack1.getSprite("clapper_top_2");
        this.clapperTopSprites[2] = pack1.getSprite("clapper_top_3");

        this.juniorSprite = pack1.getSprite("junior");
        this.juniorRightSprite = this.juniorSprite.getFlippedCopy(true, false);
        this.juniorBagSprite = pack1.getSprite("junior_bag");
        this.storkHeadSprite = pack1.getSprite("stork_head");
        this.storkWingsSprites[0] = pack1.getSprite("stork_wings_1");
        this.storkWingsSprites[1] = pack1.getSprite("stork_wings_2");
    }

    private loadSymbols(color: number, prefix: string, pack2: PackedSpriteSheet): void {
        const glyphs = this.symbols[color];
        for (let c = 97; c <= 122; c++) {
            glyphs[65 + (c - 97)] = glyphs[c] = pack2.getSprite(`${prefix}_symbol_${String.fromCharCode(c)}`);
        }
        for (let c = 48; c <= 57; c++) {
            glyphs[c] = pack2.getSprite(`${prefix}_symbol_${String.fromCharCode(c)}`);
        }
        glyphs[":".charCodeAt(0)] = pack2.getSprite(`${prefix}_symbol_colon`);
        glyphs[",".charCodeAt(0)] = pack2.getSprite(`${prefix}_symbol_comma`);
        glyphs["@".charCodeAt(0)] = pack2.getSprite(`${prefix}_symbol_copyright`);
        glyphs["!".charCodeAt(0)] = pack2.getSprite(`${prefix}_symbol_exclamation`);
        glyphs["/".charCodeAt(0)] = pack2.getSprite(`${prefix}_symbol_forward_slash`);
        glyphs["-".charCodeAt(0)] = pack2.getSprite(`${prefix}_symbol_hyphen`);
        glyphs['"'.charCodeAt(0)] = pack2.getSprite(`${prefix}_symbol_left_quote`);
        glyphs[".".charCodeAt(0)] = pack2.getSprite(`${prefix}_symbol_period`);
        glyphs["'".charCodeAt(0)] = pack2.getSprite(`${prefix}_symbol_right_quote`);
    }

    private initializeHighScores(): void {
        for (let i = 0; i < 4; i++) {
            for (let j = 0; j < 5; j++) {
                this.highScores[i][j] = new HighScore();
            }
        }
    }

    private drawStringScaled(string: string, x: number, y: number, color: number, scale: number): void {
        const gl = Renderer.get();
        gl.glPushMatrix();
        gl.glTranslatef(x, y, 0);
        gl.glScalef(scale, scale, 1);
        const s = this.symbols[color];
        for (let i = 0; i < string.length; i++) {
            const image = s[charCode(string, i)];
            if (image !== null && image !== undefined) {
                image.draw(i << 4, 0);
            }
        }
        gl.glPopMatrix();
    }

    private drawStringAt(string: string, x: number, y: number, color: number): void {
        if (y < -16 || y > 600) {
            return;
        }
        const s = this.symbols[color];
        for (let i = 0; i < string.length; i++, x += 16) {
            const image = s[charCode(string, i)];
            if (image !== null && image !== undefined) {
                image.draw(x, y);
            }
        }
    }
}
