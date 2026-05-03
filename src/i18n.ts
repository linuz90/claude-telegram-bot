/**
 * Minimal runtime localization.
 */

import { PRIMARY_LANGUAGE, RECENT_CONTEXT_KEYWORDS } from "./config";

type Locale = "en" | "tr";

const locale: Locale = PRIMARY_LANGUAGE.startsWith("tr") ? "tr" : "en";

const messages = {
  en: {
    unauthorized: "Unauthorized.",
    unauthorizedOwner: "Unauthorized. Contact the bot owner for access.",
    llmApiKeyMissing: (name: string) => `${name} is not configured`,
    llmCommandMissing: (command: string) => `${command} command was not found in PATH`,
    llmActive: (provider: string, detail: string, providers: string) =>
      `🧠 Active LLM: <b>${provider}</b>\n${detail}\n\n<b>Providers:</b>\n${providers}\n\nUsage: <code>/llm provider_id</code>`,
    llmInvalid: (ids: string) => `❌ Invalid LLM. Valid providers: ${ids}`,
    llmUnavailable: (id: string, reason: string) => `❌ ${id} cannot be selected: ${reason}.`,
    llmBusy: "⏳ A query is running. Use /stop first.",
    llmChanged: (id: string, detail: string) => `✅ LLM changed: <b>${id}</b>\n${detail}`,
    retryMissing: "❌ No message to retry.",
    retryBusy: "⏳ A query is already running. Use /stop first.",
    retrying: (message: string) => `🔄 Retrying: "${message}"`,
    repeatMissing: "❌ No last message to process again.",
    repeatRunning: (message: string) => `🔄 Processing last message again: "${message}"`,
    audioTranscribing: "🎤 Transcribing audio...",
    audioFailed: "❌ Audio could not be transcribed. Configure WHISPER_SERVICE_URL, install local `whisper`, or configure OPENAI_API_KEY.",
    audioPreview: (text: string) => `🎤 ${text}`,
    audioPreviewCorrected: (raw: string, corrected: string) => `raw: "${raw}"\n-> corrected: "${corrected}"`,
    queryStopped: "🛑 Query stopped.",
    providerRetry: "⚠️ LLM provider crashed, retrying...",
    rateLimited: (seconds: string) => `⏳ Rate limited. Please wait ${seconds} seconds.`,
    downloadAudioFailed: "❌ Failed to download audio file.",
    error: (message: string) => `❌ Error: ${message}`,
    statusTitle: "📊 <b>Bot Status</b>\n",
    newDone: "🆕 Session cleared. Next message starts fresh.",
    resumeActive: "Session already active. Use /new to start over.",
    resumeEmpty: "❌ No saved sessions.",
    resumeTitle: "📋 <b>Saved sessions</b>\n\nSelect a session to resume:",
    invalidSessionId: "Invalid session ID",
    resumeSuccess: "Session resumed!",
    defaultSessionTitle: "Untitled session",
    sessionNotFound: "Session not found",
    sessionDifferentDirectory: (dir: string) => `Session belongs to a different directory: ${dir}`,
    sessionResumed: (title: string) => `Resumed session: "${title}"`,
    noSavedSessions: "No saved sessions",
    recapPrompt: "Please write a very concise recap of where we are in this conversation, to refresh my memory. Max 2-3 sentences.",
    restarting: "🔄 Restarting bot...",
    restarted: "✅ Bot restarted",
  },
  tr: {
    unauthorized: "Yetkisiz.",
    unauthorizedOwner: "Yetkisiz. Erişim için bot sahibiyle iletişime geç.",
    llmApiKeyMissing: (name: string) => `${name} yapılandırılmamış`,
    llmCommandMissing: (command: string) => `${command} komutu PATH içinde bulunamadı`,
    llmActive: (provider: string, detail: string, providers: string) =>
      `🧠 Aktif LLM: <b>${provider}</b>\n${detail}\n\n<b>Providers:</b>\n${providers}\n\nKullanım: <code>/llm provider_id</code>`,
    llmInvalid: (ids: string) => `❌ Geçersiz LLM. Geçerli provider'lar: ${ids}`,
    llmUnavailable: (id: string, reason: string) => `❌ ${id} seçilemez: ${reason}.`,
    llmBusy: "⏳ Çalışan sorgu var. Önce /stop kullan.",
    llmChanged: (id: string, detail: string) => `✅ LLM değiştirildi: <b>${id}</b>\n${detail}`,
    retryMissing: "❌ Tekrar işlenecek son mesaj yok.",
    retryBusy: "⏳ Çalışan sorgu var. Önce /stop kullan.",
    retrying: (message: string) => `🔄 Tekrar deneniyor: "${message}"`,
    repeatMissing: "❌ Tekrar işlenecek son mesaj yok.",
    repeatRunning: (message: string) => `🔄 Son mesaj tekrar işleniyor: "${message}"`,
    audioTranscribing: "🎤 Ses metne çevriliyor...",
    audioFailed: "❌ Ses metne çevrilemedi. WHISPER_SERVICE_URL yapılandır, lokal `whisper` kur veya OPENAI_API_KEY ayarla.",
    audioPreview: (text: string) => `🎤 ${text}`,
    audioPreviewCorrected: (raw: string, corrected: string) => `ham: "${raw}"\n-> düzeltilmiş: "${corrected}"`,
    queryStopped: "🛑 Sorgu durduruldu.",
    providerRetry: "⚠️ LLM provider çöktü, tekrar deneniyor...",
    rateLimited: (seconds: string) => `⏳ Rate limit. Lütfen ${seconds} saniye bekle.`,
    downloadAudioFailed: "❌ Ses dosyası indirilemedi.",
    error: (message: string) => `❌ Hata: ${message}`,
    statusTitle: "📊 <b>Bot Durumu</b>\n",
    newDone: "🆕 Session temizlendi. Sonraki mesaj yeni başlar.",
    resumeActive: "Session zaten aktif. Yeniden başlamak için /new kullan.",
    resumeEmpty: "❌ Kayıtlı session yok.",
    resumeTitle: "📋 <b>Kayıtlı sessionlar</b>\n\nDevam edilecek session'ı seç:",
    invalidSessionId: "Geçersiz session ID",
    resumeSuccess: "Session devam ettirildi!",
    defaultSessionTitle: "Başlıksız session",
    sessionNotFound: "Session bulunamadı",
    sessionDifferentDirectory: (dir: string) => `Session farklı bir dizine ait: ${dir}`,
    sessionResumed: (title: string) => `Session devam ettirildi: "${title}"`,
    noSavedSessions: "Kayıtlı session yok",
    recapPrompt: "Bu konuşmada nerede kaldığımızı hatırlatmak için çok kısa bir özet yaz. En fazla 2-3 cümle.",
    restarting: "🔄 Bot yeniden başlatılıyor...",
    restarted: "✅ Bot yeniden başlatıldı",
  },
} as const;

export const t = messages[locale];

export function responseLanguageInstruction(): string {
  return locale === "tr"
    ? "Reply in Turkish unless the user clearly requests another language."
    : `Use ${PRIMARY_LANGUAGE} as the default response language unless the user clearly writes in another language.`;
}

export function localeCode(): Locale {
  return locale;
}

export function dateLocale(): string {
  return locale === "tr" ? "tr-TR" : "en-US";
}

export function isRecentMessageIntent(text: string): boolean {
  const normalized = text.trim().toLocaleLowerCase().replace(/\s+/g, " ");
  return RECENT_CONTEXT_KEYWORDS.some((phrase) => normalized.includes(phrase));
}
