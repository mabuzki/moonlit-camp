import { invoke, isTauri } from "@tauri-apps/api/core";
import { listen } from "@tauri-apps/api/event";
import simplified from "../locales/zh-Hans.json";
import traditional from "../locales/zh-Hant.json";
import japanese from "../locales/ja.json";
import english from "../locales/en.json";
import french from "../locales/fr.json";
import russian from "../locales/ru.json";
import spanish from "../locales/es.json";
import arabic from "../locales/ar.json";

const catalogs = {
  "zh-Hans": simplified,
  "zh-Hant": traditional,
  ja: japanese,
  en: english,
  fr: french,
  ru: russian,
  es: spanish,
  ar: arabic,
} satisfies Record<string, typeof english>;

export type MessageKey = keyof typeof english;
type Locale = keyof typeof catalogs;

function supportedLocale(tag: string): Locale | undefined {
  const [language, ...subtags] = tag.toLowerCase().split("-");
  if (language === "zh") {
    if (subtags.includes("hans")) return "zh-Hans";
    return subtags.some(part => ["hant", "tw", "hk", "mo"].includes(part)) ? "zh-Hant" : "zh-Hans";
  }
  return Object.hasOwn(catalogs, language) ? language as Locale : undefined;
}

let locale = navigator.languages.map(supportedLocale).find(code => code !== undefined) ?? "en";

export function currentLocale() { return locale; }

export function t(key: MessageKey, value?: string) {
  const message = catalogs[locale][key];
  return value === undefined ? message : message.replace("{value}", () => value);
}

export function formatNumber(value: number, digits = 0) {
  return new Intl.NumberFormat(locale === "ar" ? "ar-u-nu-arab" : locale, {
    minimumFractionDigits: digits,
    maximumFractionDigits: digits,
  }).format(value);
}

export async function initLocale(render: () => void) {
  function apply(code: Locale) {
    locale = code;
    document.documentElement.lang = locale;
    document.documentElement.dir = locale === "ar" ? "rtl" : "ltr";
    render();
  }
  apply(locale);
  if (!isTauri()) return;

  // Subscribe before reading the preference so a concurrent tray change cannot be missed.
  let changed = false;
  await listen<Locale>("camp-language", ({ payload }) => {
    changed = true;
    apply(payload);
  });
  const saved = await invoke<Locale>("get_camp_locale");
  if (!changed) apply(saved);
}
