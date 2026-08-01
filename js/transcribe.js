// آپلود و تبدیل فایل صوتی به متن (مستقیم از مرورگر به پروایدر Whisper منتخب کاربر)
import { convertSegmentsToSRT } from './srt.js';
import { translateSegmentsWithGoogle, translateSrtWithAI } from './translate.js';

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

    let tProvUrl = '', tModel = '';
    if (isTranslate) {
        const [tProvName, modelName] = tVal.split('|');
        tProvUrl = configData.providers[tProvName]?.url;
        tModel = modelName;
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

            let srt;
            if (isGoogleTranslate) {
                const translatedSegments = await translateSegmentsWithGoogle(data.segments, { state: progressState, bar: progressBar, percent: progressPercent });
                srt = convertSegmentsToSRT(translatedSegments);
            } else {
                srt = convertSegmentsToSRT(data.segments);
                if (isTranslate) {
                    const trResult = await translateSrtWithAI(srt, tProvUrl, tModel, tKey, { state: progressState, bar: progressBar, percent: progressPercent });
                    srt = trResult.text;
                    if (trResult.failedChunks > 0) {
                        translateWarningMsg = `تکمیل شد، اما ⚠️ ${trResult.failedChunks} از ${trResult.totalChunks} بخش ترجمه نشدند (متن اصلی جایگزین شده).`;
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
