// ترجمه با گوگل (پروکسی سمت سرور) و ترجمه هوشمند با مدل انتخابی کاربر
import { sleep, setProgress } from './utils.js';
import { parseSrtBlocks, buildSrtFromBlocks } from './srt.js';

// یک درخواست fetch با timeout واقعی (AbortController) تا در صورت هنگ کردن
// شبکه، رابط کاربری برای همیشه در حالت "در حال بارگذاری" گیر نکند.
async function fetchWithTimeout(url, options = {}, timeoutMs = 30000) {
    const controller = new AbortController();
    const id = setTimeout(() => controller.abort(), timeoutMs);
    try {
        return await fetch(url, { ...options, signal: controller.signal });
    } finally {
        clearTimeout(id);
    }
}

// تابع ارتباط با سرور گوگل در پس‌زمینه — ارسال به بک‌اند در قالب دسته‌های
// ۴۰ تایی برای جلوگیری از Timeout.
export async function translateSegmentsWithGoogle(segments, els) {
    setProgress(els, 0, 'در حال ترجمه با گوگل در پس‌زمینه...');
    const texts = segments.map((s) => s.text);

    const chunkSize = 40;
    let translatedTexts = [];

    for (let i = 0; i < texts.length; i += chunkSize) {
        const chunk = texts.slice(i, i + chunkSize);
        const percent = Math.round(((i + chunk.length) / texts.length) * 100);

        try {
            const res = await fetchWithTimeout('/translate-google', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ texts: chunk }),
            }, 25000);

            if (!res.ok) throw new Error('خطای ارتباط با سرور گوگل');
            const data = await res.json();
            translatedTexts = translatedTexts.concat(data.translated_texts);
        } catch (e) {
            console.error(e);
            // در صورت بروز مشکل، خود متن اصلی جایگزین می‌شود تا کل عملیات fail نشود
            translatedTexts = translatedTexts.concat(chunk);
        }

        setProgress(els, percent);
    }

    return segments.map((seg, i) => ({ ...seg, text: translatedTexts[i] || seg.text }));
}

export async function translateSrtWithAI(srtText, provUrl, model, apiKey, els, options = {}) {
    // ترجمه هوشمند از طریق بک‌اند خودمان انجام می‌شود (نه مستقیم مرورگر به
    // پروایدر) تا مشکل CORS نداشته باشیم. فایل را یک‌جا به سرور نمی‌فرستیم؛
    // به دسته‌های کوچک تقسیم و هر دسته را جدا می‌فرستیم، وگرنه از سقف زمان
    // اجرای توابع سرورلس رد می‌شویم.
    const isFreeModel = /:free\b/i.test(model || '');
    const batchSize = options.batchSize || (isFreeModel ? 15 : 25);
    const concurrency = options.concurrency || (isFreeModel ? 1 : 3);

    const blocks = parseSrtBlocks(srtText);
    if (blocks.length === 0) {
        throw new Error('متن SRT معتبر نیست یا خالی است.');
    }

    const texts = blocks.map((b) => b.text);
    const batches = [];
    for (let i = 0; i < texts.length; i += batchSize) {
        batches.push(texts.slice(i, i + batchSize));
    }

    const results = new Array(batches.length).fill(null);
    let completed = 0;
    let failedBatches = 0;
    let nextIndex = 0;

    setProgress(els, 0, `در حال ترجمه ${batches.length} دسته با هوش مصنوعی${isFreeModel ? ' (مدل رایگان — محتاطانه‌تر)' : ''}...`);

    const maxRetries = isFreeModel ? 5 : 3;

    async function translateOneBatch(batchTexts, attempt = 0) {
        const res = await fetchWithTimeout('/translate-ai', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ texts: batchTexts, provider_url: provUrl, model, api_key: apiKey }),
        }, 30000);

        let data = null;
        try {
            data = await res.json();
        } catch (e) {
            data = null;
        }

        if (!data) {
            throw new Error(`پاسخ نامعتبر از سرور (${res.status})`);
        }
        if (!res.ok && !data.status) {
            throw new Error(data.details || data.error || `خطای سرور (${res.status})`);
        }

        const retryableStatuses = ['rate_limited', 'server_error', 'parse_error'];
        if (data.success !== true && retryableStatuses.includes(data.status) && attempt < maxRetries) {
            const waitMs = data.retry_after
                ? Math.round(data.retry_after * 1000)
                : Math.min(1200 * Math.pow(1.8, attempt), 15000);
            await sleep(waitMs);
            return translateOneBatch(batchTexts, attempt + 1);
        }

        if (!Array.isArray(data.translated_texts) || data.translated_texts.length !== batchTexts.length) {
            throw new Error(data.details || data.error || 'پاسخ نامعتبر از سرور ترجمه.');
        }

        return { texts: data.translated_texts, ok: data.success === true };
    }

    async function worker() {
        let first = true;
        while (nextIndex < batches.length) {
            if (!first) {
                await sleep(isFreeModel ? 600 : 150);
            }
            first = false;

            const myIndex = nextIndex++;
            try {
                const r = await translateOneBatch(batches[myIndex]);
                results[myIndex] = r.texts;
                if (!r.ok) failedBatches++;
            } catch (err) {
                console.error(`ترجمه دسته ${myIndex + 1} شکست خورد:`, err);
                results[myIndex] = batches[myIndex];
                failedBatches++;
            }
            completed++;
            const percent = Math.round((completed / batches.length) * 100);
            setProgress(
                els,
                percent,
                failedBatches > 0
                    ? `ترجمه شد: ${completed} از ${batches.length} دسته (⚠️ ${failedBatches} دسته ناموفق)...`
                    : `ترجمه شد: ${completed} از ${batches.length} دسته...`
            );
        }
    }

    const workerCount = Math.min(concurrency, batches.length) || 1;
    await Promise.all(Array.from({ length: workerCount }, () => worker()));

    const translatedTexts = results.flat();
    const translatedBlocks = blocks.map((b, i) => ({ timecode: b.timecode, text: translatedTexts[i] || b.text }));
    const translatedSrt = buildSrtFromBlocks(translatedBlocks);

    setProgress(
        els,
        undefined,
        failedBatches > 0
            ? `تکمیل شد، اما ⚠️ ${failedBatches} از ${batches.length} دسته ترجمه نشدند (متن اصلی جایگزین شده).`
            : 'ترجمه با موفقیت انجام شد! 🎉'
    );

    return { text: translatedSrt, failedChunks: failedBatches, totalChunks: batches.length };
}
