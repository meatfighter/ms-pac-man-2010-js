/// <reference types="vite/client" />

declare const __APP_VERSION__: string;
declare const __BUILD_STAMP__: string;
declare const __CACHE_BUST__: string;
declare const __HIGH_SCORE_API_URL__: string;
declare const __HIGH_SCORE_HMAC_KEY_HEX__: string;

interface Window {
    __msPacManBooted?: boolean;
    __msPacManResourcesPrepared?: boolean;
    __msPacManBootFailed?: boolean;
}
