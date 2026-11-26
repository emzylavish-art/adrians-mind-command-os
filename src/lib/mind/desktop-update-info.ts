import release from "../../../public/desktop-update.json" with { type: "json" };
/** Client-safe release metadata is not an attestation of the installed executable. */
export const CLOUD_ORIGIN = "https://adrians-mind.vercel.app";
export const UPDATE_PATH = "/api/mind/desktop-update";
export const INSTALLER_PATH = "/downloads/AdriansMind-Setup.exe";
export const PUBLIC_FEED = "https://raw.githubusercontent.com/emzylavish-art/adrians-mind-command-os/main/public/desktop-update.json";
export const PUBLIC_INSTALLER = release.download;
export const LOCAL_BUILD = release.build;
export const LOCAL_VERSION = release.version;
export const publishedManifest = release;
export const FULL_PACKAGE = release.fullPackage;
