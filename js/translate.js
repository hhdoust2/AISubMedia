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

const PERSIAN_CHARS_RE = /[\u0600-\u06FF]/;

// آیا این خط از قبل فارسی است؟ (خط‌هایی که هوش مصنوعی قبلاً موفق ترجمه کرده)
function looksAlreadyPersian(text) {
    return !!text && PERSIAN_CHARS_RE.test(text);
}

// تابع ارتباط با سرور گوگل در پس‌زمینه — ارسال به بک‌اند در قالب دسته‌های
// ۴۰ تایی برای جلوگیری از Timeout.
//
// نکته مهم (باگ واقعی که این نسخه رفع می‌کند): وقتی یک دسته را با هم به یک
// متن می‌چسبانیم و با source="auto" می‌فرستیم، گوگل زبان کل بلوک را یک‌جا
// تشخیص می‌دهد، نه خط‌به‌خط. برای فایل‌هایی که بخشی از آن‌ها قبلاً (مثلاً با
// هوش مصنوعی) به فارسی ترجمه شده و فقط چند خط ناموفق به زبان اصلی مانده،
// اگر آن چند خط را کنار خط‌های فارسی در یک دسته بفرستیم، زبان غالبِ دسته
// «فارسی» تشخیص داده می‌شود و گوگل چون source=fa و target=fa یکسان است هیچ
// کاری نمی‌کند و متن را دقیقاً بدون تغییر برمی‌گرداند — بدون هیچ خطایی، پس
// به نظر می‌رسد "ترجمه هیچ اثری نداشته". راه‌حل: فقط خط‌هایی که از قبل فارسی
// نیستند را می‌فرستیم؛ خط‌های فارسی دست‌نخورده باقی می‌مانند.
export async function translateSegmentsWithGoogle(segments, els) {
    setProgress(els, 0, 'در حال ترجمه با گوگل در پس‌زمینه...');
    const texts = segments.map((s) => s.text);

    const indicesToTranslate = texts
        .map((t, i) => i)
        .filter((i) => texts[i] && texts[i].trim() && !looksAlreadyPersian(texts[i]));

    const finalTexts = [...texts];

    if (indicesToTranslate.length === 0) {
        setProgress(els, 100, 'همه‌ی خط‌ها از قبل فارسی هستند — نیازی به ترجمه نبود.');
        return { segments: segments.map((seg, i) => ({ ...seg, text: finalTexts[i] })), failedChunks: 0, totalChunks: 0 };
    }

    const chunkSize = 40;
    let failedChunks = 0;
    let totalChunks = 0;

    for (let i = 0; i < indicesToTranslate.length; i += chunkSize) {
        const idxChunk = indicesToTranslate.slice(i, i + chunkSize);
        const chunk = idxChunk.map((idx) => texts[idx]);
        totalChunks++;
        const percent = Math.round(((i + idxChunk.length) / indicesToTranslate.length) * 100);

        const attemptOnce = async () => {
            const res = await fetchWithTimeout('/translate-google', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ texts: chunk }),
            }, 25000);
            if (!res.ok) throw new Error('خطای ارتباط با سرور گوگل');
            return res.json();
        };

        try {
            let data = await attemptOnce();
            // اگر گوگل/MyMemory هر دو در سرور شکست خوردند، احتمال اینکه فقط
            // یک بلاک/محدودیت نرخ لحظه‌ای بوده باشد وجود دارد؛ یک بار دیگر
            // با کمی تأخیر امتحان می‌کنیم قبل از اینکه دسته را ناموفق بشماریم.
            if (data.engine === 'none') {
                await sleep(1500);
                data = await attemptOnce();
            }
            if (data.engine === 'none') {
                failedChunks++;
            }
            idxChunk.forEach((idx, j) => {
                finalTexts[idx] = data.translated_texts[j] ?? texts[idx];
            });
        } catch (e) {
            console.error(e);
            // در صورت بروز مشکل، متن اصلی همان خط‌ها بدون تغییر باقی می‌ماند
            failedChunks++;
        }

        setProgress(els, percent);
    }

    const translatedSegments = segments.map((seg, i) => ({ ...seg, text: finalTexts[i] }));
    setProgress(
        els,
        undefined,
        failedChunks > 0
            ? `تکمیل شد، اما ⚠️ ${failedChunks} از ${totalChunks} دسته با گوگل ترجمه نشد (سرور گوگل/MyMemory در دسترس نبود؛ متن اصلی باقی ماند).`
            : 'ترجمه با گوگل با موفقیت انجام شد! 🎉'
    );
    return { segments: translatedSegments, failedChunks, totalChunks };
}


export async function translateSrtWithAI(srtText, provUrl, model, apiKey, els, options = {}) {
    // ترجمه هوشمند از طریق بک‌اند خودمان انجام می‌شود (نه مستقیم مرورگر به
    // پروایدر) تا مشکل CORS نداشته باشیم. فایل را یک‌جا به سرور نمی‌فرستیم؛
    // به دسته‌های کوچک تقسیم و هر دسته را جدا می‌فرستیم، وگرنه از سقف زمان
    // اجرای توابع سرورلس رد می‌شویم.
    // نکته مهم: بیشتر محدودیت‌های پروایدرهای رایگان روی «تعداد درخواست در
    // دقیقه» است، نه حجم هر درخواست. پس دسته‌ی کوچیک‌تر باعث می‌شود درخواست
    // بیشتری لازم باشد و زودتر به سقف نرخ بخوریم — دقیقاً برعکس چیزی که
    // می‌خواهیم. چون حالا truncation/parse ناقص هم با max_tokens و بازیابی
    // نرم (لنیِنت) در بک‌اند مدیریت می‌شود، دیگر نیازی به دسته‌ی خیلی کوچیک
    // برای مدل‌های رایگان نیست.
    const isFreeModel = /:free\b/i.test(model || '');
    const batchSize = options.batchSize || 25;
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

    // با batchSize بزرگ‌تر (اصلاح بالا)، تعداد کل دسته‌ها کمتر شده؛ نیازی
    // به تعداد retry بالا نیست — هر retry اضافه یعنی چند ثانیه انتظار بیشتر
    // که روی کل زمان فایل جمع می‌شود.
    const maxRetries = 3;

    // وقتی یک worker به rate-limit (429) می‌خورد، بقیه worker های موازی هم باید
    // منتظر بمانند؛ وگرنه همه هم‌زمان دوباره درخواست می‌زنند و دوباره 429
    // می‌گیرند. این یک cooldown مشترک بین همه‌ی worker های همین عملیات است.
    let sharedCooldownUntil = 0;
    async function respectSharedCooldown() {
        const remaining = sharedCooldownUntil - Date.now();
        if (remaining > 0) await sleep(remaining);
    }

    async function translateOneBatch(batchTexts, attempt = 0, allowSplit = true) {
        await respectSharedCooldown();

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
        if (data.success !== true && retryableStatuses.includes(data.status)) {
            if (data.status === 'rate_limited') {
                // اگر پروایدر Retry-After نداده، حدس محتاطانه‌ای می‌زنیم؛ نه
                // خیلی کوتاه (که دوباره فوری 429 بگیریم) نه خیلی بلند (که کل
                // فایل معطل بماند).
                const cooldownMs = data.retry_after ? Math.round(data.retry_after * 1000) : 8000;
                sharedCooldownUntil = Math.max(sharedCooldownUntil, Date.now() + cooldownMs);
            }

            if (attempt < maxRetries) {
                const waitMs = data.retry_after
                    ? Math.round(data.retry_after * 1000)
                    : Math.min(1000 * Math.pow(1.6, attempt), 8000);
                await sleep(waitMs);
                return translateOneBatch(batchTexts, attempt + 1, allowSplit);
            }

            // نصف‌کردن دسته فقط برای parse_error معنی دارد (پاسخ مدل وسط راه
            // قطع شده — با دسته‌ی کوچک‌تر معمولاً حل می‌شود). برای
            // rate_limited/server_error نصف‌کردن هیچ کمکی نمی‌کند — چون
            // محدودیت روی «تعداد درخواست در دقیقه» است، نه اندازه‌ی هر
            // درخواست؛ نصف‌کردن فقط تعداد درخواست‌ها را زیاد می‌کند و باعث
            // rate-limit بیشتر می‌شود (دقیقاً چیزی که قبلاً باعث سیل درخواست،
            // کندی شدید و افت درصد موفقیت شد). به همین دلیل هم فقط روی
            // parse_error split می‌کنیم، و هم فقط یک سطح (allowSplit=false
            // برای نیمه‌ها) تا رشد نمایی درخواست رخ ندهد.
            if (allowSplit && data.status === 'parse_error' && batchTexts.length > 1) {
                const mid = Math.ceil(batchTexts.length / 2);
                const [left, right] = await Promise.all([
                    translateOneBatch(batchTexts.slice(0, mid), 0, false),
                    translateOneBatch(batchTexts.slice(mid), 0, false),
                ]);
                return { texts: [...left.texts, ...right.texts], ok: left.ok && right.ok };
            }
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
