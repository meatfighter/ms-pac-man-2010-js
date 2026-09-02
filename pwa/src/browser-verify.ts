import { AppGameContainer, BasicGame, Display, Image, ResourceLoader, type GameContainer, type Graphics } from "slick2d-ts";
import { ScalableGame2 } from "./mspacman/ScalableGame2.js";

const result = document.querySelector<HTMLElement>("#result");
const host = document.querySelector<HTMLElement>("#game-host");
if (result === null || host === null) {
    throw new Error("Browser verification fixture is missing required elements.");
}

function assert(condition: unknown, message: string): asserts condition {
    if (!condition) {
        throw new Error(message);
    }
}

class MsPacManSmokeGame extends BasicGame {
    public rendered = false;

    public constructor(private readonly spriteSheet: Image) {
        super("Ms. Pac-Man 2010 browser verification");
    }

    public init(_gc: GameContainer): void {}

    public update(_gc: GameContainer, _delta: number): void {}

    public render(_gc: GameContainer, g: Graphics): void {
        g.drawImage(this.spriteSheet, 0, 0);
        this.rendered = true;
    }
}

async function waitForRender(game: MsPacManSmokeGame): Promise<void> {
    const deadline = performance.now() + 5000;
    while (!game.rendered && performance.now() < deadline) {
        await new Promise<void>((resolve) => requestAnimationFrame(() => resolve()));
    }
    assert(game.rendered, "Buffered Ms. Pac-Man fixture did not render a browser frame.");
}

async function verify(): Promise<void> {
    ResourceLoader.clearCache();
    ResourceLoader.removeAllResourceLocations();
    ResourceLoader.addResourceLocation(new URL("./", window.location.href));
    ResourceLoader.setCacheBust(null);
    await ResourceLoader.preloadResources(["images/pack_1.png"], { concurrency: 2 });

    const spriteSheet = new Image("images/pack_1.png");
    await ResourceLoader.waitForAll();
    assert(spriteSheet.getWidth() > 0 && spriteSheet.getHeight() > 0, "Ms. Pac-Man sprite sheet did not decode.");

    Display.setParent(host);
    const game = new MsPacManSmokeGame(spriteSheet);
    const buffered = new ScalableGame2(game, 800, 600, true);
    const container = new AppGameContainer(buffered, 1000, 750, false);
    container.setLoopSuspended(false);
    container.setHighDpiEnabled(true);
    container.setMaxDevicePixelRatio(2);
    try {
        await container.start();
        await waitForRender(game);
        assert(buffered.getPresentationInfo().physicalWidth > 0, "Buffered presentation did not acquire a physical width.");
        buffered.setScalingPreference("smooth");
        buffered.setScalingPreference("pixel-perfect");
        buffered.setScalingPreference("crisp");
    } finally {
        container.destroy();
        spriteSheet.destroy();
        Display.setParent(null);
    }
}

void verify().then(
    () => {
        result.dataset.status = "passed";
        result.textContent = "Ms. Pac-Man 2010 browser verification passed.";
    },
    (error: unknown) => {
        console.error(error);
        result.dataset.status = "failed";
        result.textContent = error instanceof Error ? (error.stack ?? error.message) : String(error);
    }
);
