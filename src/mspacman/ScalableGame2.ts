import { Game, GameContainer, Graphics, Renderer, SlickCallable } from "slick2d-ts";
import { toInt } from "./JavaMath";

export class ScalableGame2 implements Game {
    private normalWidth: number;
    private normalHeight: number;
    private held: Game;
    private maintainAspect: boolean;
    private targetWidth = 0;
    private targetHeight = 0;

    public constructor(held: Game, normalWidth: number, normalHeight: number, maintainAspect = false) {
        this.held = held;
        this.normalWidth = normalWidth;
        this.normalHeight = normalHeight;
        this.maintainAspect = maintainAspect;
    }

    public init(container: GameContainer): void | Promise<void> {
        this.recalculateTarget(container);
        this.applyInputTransform(container);
        return this.held.init(container);
    }

    public update(container: GameContainer, delta: number): void {
        this.held.update(container, delta);
    }

    public render(container: GameContainer, g: Graphics): void {
        let yoffset = 0;
        let xoffset = 0;

        if (this.targetHeight < container.getHeight()) {
            yoffset = toInt((container.getHeight() - this.targetHeight) / 2);
        }
        if (this.targetWidth < container.getWidth()) {
            xoffset = toInt((container.getWidth() - this.targetWidth) / 2);
        }

        const gl = Renderer.get();
        SlickCallable.enterSafeBlock();
        g.setClip(xoffset, yoffset, this.targetWidth, this.targetHeight);
        gl.glTranslatef(xoffset, yoffset, 0);
        gl.glScalef(this.targetWidth / this.normalWidth, this.targetHeight / this.normalHeight, 0);
        gl.glPushMatrix();
        this.held.render(container, g);
        gl.glPopMatrix();
        g.clearClip();
        SlickCallable.leaveSafeBlock();

        this.renderOverlay(container, g);
    }

    protected renderOverlay(container: GameContainer, g: Graphics): void {
    }

    public closeRequested(): boolean {
        return this.held.closeRequested();
    }

    public getTitle(): string {
        return this.held.getTitle();
    }

    public containerSizeChanged(container: GameContainer): void {
        this.recalculateTarget(container);
        this.applyInputTransform(container);
    }

    private recalculateTarget(container: GameContainer): void {
        this.targetWidth = container.getWidth();
        this.targetHeight = container.getHeight();
        if (this.maintainAspect) {
            const normalIsWide = this.normalWidth / this.normalHeight > 1.6 ? true : false;
            const containerIsWide = this.targetWidth / this.targetHeight > 1.6 ? true : false;
            const wScale = this.targetWidth / this.normalWidth;
            const hScale = this.targetHeight / this.normalHeight;

            if (normalIsWide && containerIsWide) {
                const scale = wScale < hScale ? wScale : hScale;
                this.targetWidth = toInt(this.normalWidth * scale);
                this.targetHeight = toInt(this.normalHeight * scale);
            } else if (normalIsWide && !containerIsWide) {
                this.targetWidth = toInt(this.normalWidth * wScale);
                this.targetHeight = toInt(this.normalHeight * wScale);
            } else if (!normalIsWide && containerIsWide) {
                this.targetWidth = toInt(this.normalWidth * hScale);
                this.targetHeight = toInt(this.normalHeight * hScale);
            } else {
                const scale = wScale < hScale ? wScale : hScale;
                this.targetWidth = toInt(this.normalWidth * scale);
                this.targetHeight = toInt(this.normalHeight * scale);
            }
        }
    }

    private applyInputTransform(container: GameContainer): void {
        container.getInput().setScale(this.normalWidth / this.targetWidth, this.normalHeight / this.targetHeight);

        let yoffset = 0;
        let xoffset = 0;

        if (this.targetHeight < container.getHeight()) {
            yoffset = toInt((container.getHeight() - this.targetHeight) / 2);
        }
        if (this.targetWidth < container.getWidth()) {
            xoffset = toInt((container.getWidth() - this.targetWidth) / 2);
        }
        container.getInput().setOffset(-xoffset / (this.targetWidth / this.normalWidth), -yoffset / (this.targetHeight / this.normalHeight));
    }
}
