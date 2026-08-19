import i18n from "i18next";
import { initReactI18next } from "react-i18next";
import * as Localization from "expo-localization";

import en from "./locales/en.json";
import zh from "./locales/zh.json";

const resources = {
  en: { translation: en },
  zh: { translation: zh },
};

const getLocales = Localization.getLocales();
const deviceLanguage = getLocales?.[0]?.languageCode ?? "en";

i18n
  .use(initReactI18next)
  .init({
    resources,
    lng: deviceLanguage,
    fallbackLng: "en",
    interpolation: {
      escapeValue: false, // react already safes from xss
    },
  });

export default i18n;
