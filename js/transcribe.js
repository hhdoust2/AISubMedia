// آپلود و تبدیل فایل صوتی به متن (مستقیم از مرورگر به پروایدر Whisper منتخب کاربر)
import { convertSegmentsToSRT } from './srt.js';
import { translateSegmentsWithGoogle, translateSrtWithAI } from './translate.js';

// اگر Whisper تایم‌استمپ کلمه‌به‌کلمه برگردانده باشد (data.words)، شروع هر
// segment را روی شروع واقعی اولین کلمه‌ای که با آن هم‌پوشانی زمانی دارد تنظیم
// می‌کنیم. این فقط شروع را دیرتر می‌برد (هیچ‌وقت زودتر)، و فقط وقتی اختلاف
// معقول است (حداکثر ۶ ثانیه) تا در برابر خطای تطبیق کلمه محافظه‌کارانه بمانیم.
// هدف: رفع مشکل «زیرنویس ��ند ثانیه زودتر از دیالوگ می‌آید» که وقتی قبل از
// حرف‌زدن سکوت یا موسیقی هست، Whisper گاهی آن را هم جزو segment حساب می‌کند.
function refineSegmentStarts(segments, words) {
    if (!Array.isArray(words) || words.length === 0) {
        console.warn(
            '[refineSegmentStarts] این پروایدر تایم‌استمپ کلمه‌به‌کلمه (words) برنگردانده؛ ' +
            'زمان شروع زیرنویس‌ها دست‌نخورده (خام از Whisper) باقی می‌ماند.'
        );
        return segments;
    }
    return segments.map((seg) => {
        const overlapping = words.filter((w) => w.start < seg.end && w.end > seg.start);
        if (overlapping.length === 0) return seg;
        const tightStart = Math.min(...overlapping.map((w) => w.start));
        if (tightStart > seg.start && tightStart - seg.start <= 6) {
            return { ...seg, start: tightStart };
        }
        return seg;
    });
}

// Whisper تشخیص گوینده (speaker diarization) ندارد و فقط بر اساس سکوت segment
// می‌سازد. وقتی چند نفر بدون مکث واضح پشت‌سر هم حرف می‌زنند، کل تبادل ممکن
// است یک segment طولانی و چندجمله‌ای بشود که از اول تا آخرش روی صفحه می‌ماند
// و صفحه را پر می‌کند. این تابع چنین segmentهایی را بر اساس علائم پایان جمله
// می‌شکند و — در صورت وجود تایم‌استمپ کلمه‌به‌کلمه — زمان هر تکه را از روی
// کلمات واقعی حساب می‌کند (نه فقط تقسیم مساوی زمان کل).
const SENTENCE_SPLIT_RE = /(?<=[.!?؟…])\s+(?=\S)/;
const MIN_SPLIT_DURATION = 3.2; // ثانیه — segmentهای کوتاه‌تر شکسته نمی‌شوند
const MIN_SPLIT_CHARS = 70; // segmentهای کوتاه‌تر معمولاً یک جمله‌اند، نیازی به شکستن نیست

function splitLongSegments(segments, words) {
    const hasWords = Array.isArray(words) && words.length > 0;
    const result = [];

    segments.forEach((seg) => {
        const duration = seg.end - seg.start;
        const text = (seg.text || '').trim();

        if (duration < MIN_SPLIT_DURATION || text.length < MIN_SPLIT_CHARS) {
            result.push(seg);
            return;
        }

        const parts = text.split(SENTENCE_SPLIT_RE).map((p) => p.trim()).filter(Boolean);
        if (parts.length < 2) {
            result.push(seg);
            return;
        }

        // روش دقیق: تطبیق هر تکه با کلمات واقعی خودش (وقتی words موجود است)
        if (hasWords) {
            const segWords = words
                .filter((w) => w.start < seg.end && w.end > seg.start)
                .sort((a, b) => a.start - b.start);
            const wordCounts = parts.map((p) => p.split(/\s+/).filter(Boolean).length);
            const totalWords = wordCounts.reduce((a, b) => a + b, 0);

            // اگر تعداد کلمه‌های واقعی به‌قدر کافی نزدیک تعداد کلمه‌های متن باشد
            // (کمی اغماض برای اختلاف جزئی توکن‌سازی)، از تایم‌بندی دقیق استفاده کن.
            if (segWords.length > 0 && Math.abs(segWords.length - totalWords) <= Math.ceil(totalWords * 0.15) + 2) {
                let wIdx = 0;
                let cursor = seg.start;
                parts.forEach((p, i) => {
                    const isLast = i === parts.length - 1;
                    const count = isLast ? (segWords.length - wIdx) : wordCounts[i];
                    const sliceWords = segWords.slice(wIdx, wIdx + count);
                    wIdx += count;
                    const chunkStart = cursor;
                    const lastWord = sliceWords[sliceWords.length - 1];
                    const chunkEnd = isLast ? seg.end : Math.min(seg.end, Math.max(lastWord ? lastWord.end : chunkStart, chunkStart + 0.4));
                    cursor = chunkEnd;
                    result.push({ ...seg, start: chunkStart, end: chunkEnd, text: p });
                });
                return;
            }
        }

        // fallback: بدون تایم‌استمپ کلمه‌به‌کلمهٔ قابل‌اتکا، زمان را متناسب با
        // طول کاراکتر هر تکه از کل بازهٔ segment سهم می‌دهیم (دقیق نیست ولی
        // بهتر از یک زیرنویس طولانی‌ست که کل صفحه را پر می‌کند).
        const totalChars = parts.reduce((a, p) => a + p.length, 0) || 1;
        let cursor = seg.start;
        const dur = seg.end - seg.start;
        parts.forEach((p, i) => {
            const isLast = i === parts.length - 1;
            const chunkStart = cursor;
            const chunkEnd = isLast ? seg.end : Math.min(seg.end, cursor + dur * (p.length / totalChars));
            cursor = chunkEnd;
            result.push({ ...seg, start: chunkStart, end: chunkEnd, text: p });
        });
    });

    return result;
}

/**
 * @param {File} file
 * @param {object} ctx - عناصر DOM و تنظیمات لازم (از ui.js تزریق می‌شود)
 */
export function processAudioFile(file, ctx) {
    const {
        configData,
        assignWhisperSelect, assignTranslateSelect, keyWhisperSelect, keyTranslateSelect,
        googleTranslateCheckbox, aiTranslateCheckbox,
        progressContainer, progressBar, progressPercent, progressState,
        output, loader, submitBtn, downloadBtn,
        onDone,
        // دریافت مقادیر ارسال‌شده از ui.js (اگر ارسال شده باشند)
        whisperMaxRps, translateMaxRps, translateProvUrl: ctxTranslateProvUrl, translateModelName: ctxTranslateModelName,
    } = ctx;

    const wVal = assignWhisperSelect.value;
    const tVal = assignTranslateSelect.value;
    const wKey = keyWhisperSelect.value;
    const tKey = keyTranslateSelect.value;
    const isGoogleTranslate = googleTranslateCheckbox.checked;
    const isTranslate = aiTranslateCheckbox.checked;
    let translateWarningMsg = null;

    if (!wVal) { alert('لطفاً پروایدر تبدیل صوت را انتخاب کنید.'); return; }
    if (!wKey) { alert('لطفاً کلید API بخش تبدیل صوت را انتخاب کنید.'); return; }
    if (isTranslate) {
        if (!tVal) { alert('لطفاً پروایدر/مدل ترجمه را انتخاب کنید.'); return; }
        if (!tKey) { alert('لطفاً کلید API بخش ترجمه را انتخاب کنید.'); return; }
    }

    const [wProvName, wModel] = wVal.split('|');
    const wProvUrl = configData.providers[wProvName]?.url;
    if (!wProvUrl) { alert('پروایدر انتخاب‌شده معتبر نیست.'); return; }

    let tProvUrl = '', tModel = '', tProvMaxRps = null;
    if (isTranslate) {
        // اگر UI مقدار url/model/maxRps را فرستاده از آن استفاده کن، در غیر این صورت از config بخوان
        if (ctxTranslateProvUrl) {
            tProvUrl = ctxTranslateProvUrl;
        } else if (tVal && tVal.includes('|')) {
            const [tProvName] = tVal.split('|');
            tProvUrl = configData.providers[tProvName]?.url;
        }

        tModel = ctxTranslateModelName || (tVal && tVal.includes('|') ? tVal.split('|')[1] : '');

        if (translateMaxRps) {
            tProvMaxRps = translateMaxRps;
        } else if (tVal && tVal.includes('|')) {
            const [tProvName, modelName] = tVal.split('|');
            const foundModel = configData.providers[tProvName]?.models?.find(m => m.name === modelName);
            tProvMaxRps = foundModel ? foundModel.maxRps : null;
        } else {
            tProvMaxRps = null;
        }
    }

    progressContainer.style.display = 'block';
    progressBar.style.width = '0%';
    progressPercent.innerText = '0%';
    progressState.innerText = 'در حال آپلود و استخراج متن صوت...';
    output.style.display = 'none';
    downloadBtn.style.display = 'none';
    submitBtn.disabled = true;

    const formData = new FormData();
    formData.append('file', file);
    formData.append('model', wModel);
    formData.append('temperature', '0.0');
    formData.append('response_format', 'verbose_json');
    // تایم‌استمپ سطح کلمه هم می‌خواهیم (علاوه بر سطح جمله) تا بشه شروع هر زیرنویس
    // را روی شروع واقعی اولین کلمه تنظیم کرد، نه روی مرز تخمینی جمله که گاهی
    // چند فریم سکوت/موسیقی قبل از دیالوگ را هم اشتباهی داخل segment حساب می‌کند.
    // اگر پروایدر این ویژگی را پشتیبانی نکند، بی‌ضرر نادیده گرفته می‌شود.
    formData.append('timestamp_granularities[]', 'segment');
    formData.append('timestamp_granularities[]', 'word');

    const cleanBaseUrl = wProvUrl.replace(/\/$/, '');
    const audioEndpoint = cleanBaseUrl.replace(/\/chat\/completions$/, '') + '/audio/transcriptions';

    const xhr = new XMLHttpRequest();
    xhr.open('POST', audioEndpoint);
    xhr.setRequestHeader('Authorization', `Bearer ${wKey}`);
    xhr.timeout = 120000;

    xhr.upload.addEventListener('progress', (e) => {
        if (e.lengthComputable) {
            const percent = Math.round((e.loaded / e.total) * 100);
            progressBar.style.width = percent + '%';
            progressPercent.innerText = percent + '%';
            if (percent === 100) loader.style.display = 'block';
        }
    });

    const fail = (message) => {
        loader.style.display = 'none';
        submitBtn.disabled = false;
        output.style.display = 'block';
        output.style.color = '#ef4444';
        output.innerText = message;
    };

    xhr.onload = async function () {
        if (xhr.status < 200 || xhr.status >= 300) {
            fail('خطای سرور پروایدر: ' + xhr.responseText);
            return;
        }
        try {
            const data = JSON.parse(xhr.responseText);
            if (!data.segments) {
                throw new Error('ساختار پاسخ زیرنویس معتبر نیست.');
            }

            const refinedSegments = refineSegmentStarts(data.segments, data.words);
            const segments = splitLongSegments(refinedSegments, data.words);

            let srt;
            if (isGoogleTranslate) {
                const gResult = await translateSegmentsWithGoogle(segments, { state: progressState, bar: progressBar, percent: progressPercent });
                srt = convertSegmentsToSRT(gResult.segments);
                if (gResult.failedChunks > 0) {
                    translateWarningMsg = `تکمیل شد، اما ⚠️ ${gResult.failedChunks} از ${gResult.totalChunks} دسته با گوگل ترجمه نشد (سرور گوگل در د�[...]`
                }
            } else {
                srt = convertSegmentsToSRT(segments);
                if (isTranslate) {
                    const trResult = await translateSrtWithAI(srt, tProvUrl, tModel, tKey, { state: progressState, bar: progressBar, percent: progressPercent }, { maxRps: tProvMaxRps });
                    srt = trResult.text;
                    if (trResult.failedChunks > 0) {
                        translateWarningMsg = `تکمیل شد، اما ⚠️ ${trResult.failedChunks} از ${trResult.totalChunks} بخش ترجمه نشدند (متن اصلی جایگزین �[...]`
                    }
                }
            }

            output.innerText = srt;
            output.style.display = 'block';
            output.style.color = '#e0e0e0';
            loader.style.display = 'none';
            submitBtn.disabled = false;
            progressState.innerText = translateWarningMsg || 'تکمیل عملیات! 🎉';
            downloadBtn.style.display = 'block';
            onDone(srt);
        } catch (err) {
            fail('خطا: ' + err.message);
        }
    };

    xhr.onerror = () => fail('خطای شبکه رخ داد.');
    xhr.ontimeout = () => fail('زمان درخواست به پایان رسید. لطفاً دوباره تلاش کنید.');

    xhr.send(formData);
}
