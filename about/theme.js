const themeStorageKey = "ms-pac-man-2010-about-theme";
const root = document.documentElement;
const themeToggle = document.getElementById("theme-toggle");
const themeColorMeta = document.querySelector('meta[name="theme-color"]');

function storedTheme() {
    try {
        const value = localStorage.getItem(themeStorageKey);
        return value === "dark" || value === "light" ? value : null;
    } catch {
        return null;
    }
}

function persistTheme(theme) {
    try {
        localStorage.setItem(themeStorageKey, theme);
    } catch {
        // The visual toggle still works when storage is unavailable.
    }
}

function applyTheme(theme, { persist = false } = {}) {
    root.dataset.theme = theme;
    if (themeToggle !== null) {
        themeToggle.checked = theme === "dark";
    }
    if (themeColorMeta !== null) {
        themeColorMeta.setAttribute("content", theme === "dark" ? "#000000" : "#fff9fd");
    }
    if (persist) {
        persistTheme(theme);
    }
}

applyTheme(storedTheme() ?? root.dataset.theme ?? "dark");

themeToggle?.addEventListener("change", () => {
    applyTheme(themeToggle.checked ? "dark" : "light", { persist: true });
});

async function writeClipboard(text) {
    if (navigator.clipboard?.writeText !== undefined) {
        await navigator.clipboard.writeText(text);
        return;
    }

    const textArea = document.createElement("textarea");
    textArea.value = text;
    textArea.setAttribute("readonly", "");
    textArea.style.position = "fixed";
    textArea.style.top = "-1000px";
    document.body.append(textArea);
    textArea.select();
    document.execCommand("copy");
    textArea.remove();
}

function markCopied(button) {
    button.dataset.copied = "true";
    window.setTimeout(() => {
        delete button.dataset.copied;
    }, 1200);
}

document.addEventListener("click", async (event) => {
    const button = event.target instanceof Element ? event.target.closest("button[data-copy-url], button[data-copy-code]") : null;
    if (!(button instanceof HTMLButtonElement)) {
        return;
    }

    const copyUrl = button.dataset.copyUrl;
    const copyCode = button.dataset.copyCode;
    const text =
        copyUrl !== undefined
            ? new URL(copyUrl, window.location.href).href
            : (button.closest(".code-block")?.querySelector("code")?.textContent ?? copyCode ?? "");

    if (text.length === 0) {
        return;
    }

    try {
        await writeClipboard(text);
        markCopied(button);
    } catch {
        // Clipboard permissions vary by browser and context.
    }
});

for (const button of document.querySelectorAll(".play-button")) {
    button.addEventListener("pointerdown", () => button.classList.add("is-pressed"));
    button.addEventListener("pointerup", () => button.classList.remove("is-pressed"));
    button.addEventListener("pointerleave", () => button.classList.remove("is-pressed"));
    button.addEventListener("blur", () => button.classList.remove("is-pressed"));
}
