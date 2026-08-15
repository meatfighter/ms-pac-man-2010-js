import { Game, GameContainer, Graphics, Renderer, SlickCallable } from "slick2d-ts";
import { toInt } from "./JavaMath";

export class ScalableGame2 implements Game {
    private normalWidth: number;
    private normalHeight: number;
    private held: Game;
    private maintainAspect: boolean;
    private targetWidth = 0;
    private targetHeight = 0;
    private xoffset = 0;
    private yoffset = 0;
    private xscale = 1;
    private yscale = 1;
    private containerWidth = 0;
    private containerHeight = 0;

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
        if (container.getWidth() !== this.containerWidth || container.getHeight() !== this.containerHeight) {
            this.containerSizeChanged(container);
        }

        const gl = Renderer.get();
        SlickCallable.enterSafeBlock();
        g.setClip(this.xoffset, this.yoffset, this.targetWidth, this.targetHeight);
        gl.glTranslatef(this.xoffset, this.yoffset, 0);
        gl.glScalef(this.xscale, this.yscale, 0);
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
        this.containerWidth = container.getWidth();
        this.containerHeight = container.getHeight();
        this.targetWidth = this.containerWidth;
        this.targetHeight = this.containerHeight;
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
        this.xoffset = 0;
        this.yoffset = 0;
        if (this.targetHeight < this.containerHeight) {
            this.yoffset = toInt((this.containerHeight - this.targetHeight) / 2);
        }
        if (this.targetWidth < this.containerWidth) {
            this.xoffset = toInt((this.containerWidth - this.targetWidth) / 2);
        }
        this.xscale = this.targetWidth / this.normalWidth;
        this.yscale = this.targetHeight / this.normalHeight;
    }

    private applyInputTransform(container: GameContainer): void {
        container.getInput().setScale(this.normalWidth / this.targetWidth, this.normalHeight / this.targetHeight);
        container.getInput().setOffset(-this.xoffset / this.xscale, -this.yoffset / this.yscale);
    }
}
