export async function disableFullscreenPreference(page) {
    const fullscreenSwitch = page.locator("#fullscreen-switch-button").first();
    await fullscreenSwitch.waitFor({ state: "visible" });
    if (await fullscreenSwitch.isEnabled()) {
        const pressed = await fullscreenSwitch.getAttribute("aria-pressed");
        if (pressed === "true") {
            await fullscreenSwitch.click();
        }
    }
}
