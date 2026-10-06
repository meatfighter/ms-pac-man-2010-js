import { performance } from "node:perf_hooks";
/** First cause plus bounded recent tail; never records bodies, cookies or headers. */
export class Diagnostics {
    constructor(origin, maxBytes = 48000) {
        this.origin = origin;
        this.maxBytes = maxBytes;
        this.events = [];
        this.first = null;
        this.unexpectedFailures = 0;
        this.omitted = 0;
        this.bytes = 0;
        this.pending = new Set();
        this.document = {};
        this.cleaning = false;
    }

    begin(document) {
        this.document = { ...document };
    }

    add(kind, detail = {}) {
        const text = JSON.stringify(detail).replaceAll(this.origin, "<fixture>").slice(0, 4000);
        const row = { ...this.document, at: performance.now(), kind, detail: text };
        if (["http-error", "pageerror", "crash", "disconnected", "failure-probe", "probe-unavailable", "vite-error"].includes(kind)) {
            this.first ??= row;
            if (!this.cleaning && !detail.expectedCleanup) this.unexpectedFailures++;
        }
        this.events.push(row);
        this.bytes += JSON.stringify(row).length * 2;
        while (this.bytes > this.maxBytes && this.events.length) {
            this.bytes -= JSON.stringify(this.events.shift()).length * 2;
            this.omitted++;
        }
    }

    attach(page, browser) {
        const path = (request) => {
            try {
                const u = new URL(request.url());
                return u.origin === this.origin ? u.pathname : "<blocked-external>";
            } catch {
                return "<invalid-url>";
            }
        };
        page.on("request", (request) => {
            if (this.pending.size < 128) this.pending.add(path(request));
            else this.omitted++;
        });
        page.on("requestfinished", (request) => this.pending.delete(path(request)));
        page.on("requestfailed", (request) => {
            this.pending.delete(path(request));
            this.add("requestfailed", { path: path(request), error: request.failure()?.errorText });
        });
        page.on("response", (response) => {
            if (response.status() >= 400) this.add("http-error", { path: path(response.request()), status: response.status() });
        });
        page.on("console", (message) => {
            if (["warning", "error"].includes(message.type()))
                this.add("console", { type: message.type(), text: message.text(), location: message.location() });
        });
        page.on("pageerror", (error) => this.add("pageerror", { message: error.message, stack: error.stack }));
        for (const event of ["crash", "close"]) page.on(event, () => this.add(event, { expectedCleanup: this.cleaning }));
        browser.on("disconnected", () => this.add("disconnected", { expectedCleanup: this.cleaning }));
    }

    snapshot() {
        return {
            protocolVersion: 3,
            first: this.first,
            tail: [...this.events],
            omitted: this.omitted,
            unexpectedFailures: this.unexpectedFailures,
            outstanding: [...this.pending],
            document: this.document
        };
    }
}
