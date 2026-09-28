import { bootstrap } from '@ms-fabric/workload-client';
import './i18n';

function printFormattedAADErrorMessage(hashMessage: string): void {
    const hashString = hashMessage.slice(1);

    // Decode URL encoding and parse key-value pairs
    const searchParams = new URLSearchParams(hashString);
    const formattedMessage: Record<string, string> = {};

    searchParams.forEach((value, key) => {
        formattedMessage[key] = decodeURIComponent(value);
    });

    // Print formatted message
    document.documentElement.innerHTML = "There was a problem with the consent, open browser debug console for more details";
    for (const key in formattedMessage) {
        if (Object.prototype.hasOwnProperty.call(formattedMessage, key)) {
            console.error(`${key}: ${formattedMessage[key]}`);
        }
    }
}

/** 
 * This is used for authentication API as a redirect URI.
 * Delete this code if you do not plan on using authentication API.
 * You can change the redirectUriPath to whatever suits you.
 */
const redirectUriPath = '/close';
const url = new URL(window.location.href);
if (url.pathname?.startsWith(redirectUriPath)) {
    // Handle errors, Please refer to https://learn.microsoft.com/en-us/entra/identity-platform/reference-error-codes
    if (url?.hash?.includes("error")) {
        // Always render the error details instead of closing immediately.
        // This keeps the consent window visible so users can see the real AADSTS failure.
        printFormattedAADErrorMessage(url?.hash);
    } else {
        // close the window in case there are no errors
        window.close();
    }
    // IMPORTANT: Stop execution here - don't continue to bootstrap
    // The window.close() may not work immediately, so we prevent further execution
    throw new Error('Redirect URI handler - stopping execution after close attempt');
}

bootstrap({
    initializeWorker: (params) => {
        return import('./index.worker').then(({ initialize }) => {
            return initialize(params);
        });
    },
    initializeUI: (params) => {
        return import('./index.ui').then(({ initialize }) => {
            return initialize(params);            
        });
    },
});
