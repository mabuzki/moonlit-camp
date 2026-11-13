import { invoke, isTauri } from "@tauri-apps/api/core";
import { getCurrentWindow } from "@tauri-apps/api/window";
import { getVersion } from "@tauri-apps/api/app";
import { initLocale, t, type MessageKey } from "./i18n";
import "./about.css";

const native = isTauri();
const status = document.querySelector<HTMLElement>("#status")!;
let statusKey: MessageKey | undefined;
function report(error: unknown, key: MessageKey = "actionFailed") {
  console.error(error);
  statusKey = key;
  status.textContent = t(key);
}
void initLocale(() => {
  document.title = t("aboutTitle");
  document.querySelector("header img")!.setAttribute("alt", t("pixelCampfire"));
  for (const element of document.querySelectorAll<HTMLElement>("[data-message]")) {
    element.textContent = t(element.dataset.message as MessageKey);
  }
  if (statusKey) status.textContent = t(statusKey);
}).catch(report);
function closeAbout() {
  if (native) void getCurrentWindow().close().catch(report);
  else window.close();
}
if (native) {
  for (const link of document.querySelectorAll<HTMLAnchorElement>("a[data-credit-link]")) {
    link.addEventListener("click", event => {
      event.preventDefault();
      void invoke("open_credit_link", { link: link.dataset.creditLink }).catch(error => report(error, "creditLinkFailed"));
    });
  }
}
document.querySelector("#close-about")!.addEventListener("click", closeAbout);
document.addEventListener("keydown", event => {
  if (event.key === "Escape") closeAbout();
});
if (native) void getVersion().then(version => {
  document.querySelector("#version")!.textContent = "v" + version;
}).catch(report);
