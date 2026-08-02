/**
 * Java counterpart: AppletGameContainer2.
 *
 * The original class embeds Slick/LWJGL in a Java Applet. Browser PWA runtime
 * intentionally uses the outer TypeScript shell plus AppGameContainer instead.
 * This mapped file exists so the Java class ledger remains complete.
 */
export class AppletGameContainer2 {
    public getContainer(): never {
        throw new Error("AppletGameContainer2 is intentionally unavailable in the browser PWA port.");
    }
}
