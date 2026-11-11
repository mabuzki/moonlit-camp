import { invoke, isTauri } from "@tauri-apps/api/core";
import { getCurrentWindow } from "@tauri-apps/api/window";
import { getVersion } from "@tauri-apps/api/app";
import "./about.css";

const native = isTauri();
const status = document.querySelector<HTMLElement>("#status")!;
function report(error: unknown) {
  status.textContent = error instanceof Error ? error.message : String(error);
}
function closeAbout() {
  if (native) void getCurrentWindow().close().catch(report);
  else window.close();
}
document.querySelector("#download")!.addEventListener("click", event => {
  if (!native) return;
  event.preventDefault();
  void invoke("open_fire_download").catch(report);
});
document.querySelector("#close-about")!.addEventListener("click", closeAbout);
document.addEventListener("keydown", event => {
  if (event.key === "Escape") closeAbout();
});
if (native) void getVersion().then(version => {
  document.querySelector("#version")!.textContent = "v" + version;
}).catch(report);
void fetch("./art/fire/LICENSE.txt").then(async response => {
  if (!response.ok) throw new Error("许可说明读取失败");
  document.querySelector("#original-license")!.textContent = await response.text();
}).catch(report);
