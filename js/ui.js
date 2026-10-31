// اتصال رابط کاربری: تب‌ها، dropdown ها، فرم‌ها و رویدادها
import { fillSelectOptions, baseFileName, downloadTextFile } from './utils.js';
import {
    loadConfig, getConfig, saveConfig,
    addProvider, addApiKey, deleteApiKey,
    deleteProvider, deleteModel, updateModelRps, updateProviderUrl,
    exportConfig, importConfig,
} from './config.js';
import { parseSrtBlocks, buildSrtFromBlocks } from './srt.js';
import { translateSegmentsWithGoogle, translateSrtWithAI } from './translate.js';
import { processAudioFile } from './transcribe.js';

export function initApp() {
    // ---------- تب‌های اصلی ----------
    const mainTabProcess = document.getElementById('mainTabProcess');
    const mainTabTranslate = document.getElementById('mainTabTranslate');
    const mainTabSettings = document.getElementById('mainTabSettings');
    const tabContentProcess = document.getElementById('tabContentProcess');
    const tabContentTranslate = document.getElementById('tabContentTranslate');
    const tabContentSettings = document.getElementById('tabContentSettings');

    const mainTabMap = [
        { btn: mainTabProcess, content: tabContentProcess },
        { btn: mainTabTranslate, content: tabContentTranslate },
        { btn: mainTabSettings, content: tabContentSettings },
    ];

    // Robust tab activation: support missing elements and also buttons that follow the naming convention mainTabX -> tabContentX
    function activateMainTabByIdOrBtn(identifier) {
        // identifier can be an element or an id string
        let activeBtn = null;
        if (typeof identifier === 'string') activeBtn = document.getElementById(identifier);
        else if (identifier && identifier.id) activeBtn = identifier;

        // try to find content id by naming convention
        let targetContent = null;
        if (activeBtn && activeBtn.id) {
            const contentId = activeBtn.id.replace(/^mainTab/, 'tabContent');
            targetContent = document.getElementById(contentId);
        }

        // Fallback: try mapping array
        if (!targetContent) {
            for (const { btn, content } of mainTabMap) {
                if (btn && activeBtn && btn.id === activeBtn.id) { targetContent = content; break; }
            }
        }

        // Deactivate all
        // first deactivate all known buttons and contents safely
        const allButtons = document.querySelectorAll('.main-tab-btn');
        allButtons.forEach(b => b.classList.remove('active'));
        const allContents = document.querySelectorAll('.tab-content');
        allContents.forEach(c => c.classList.remove('active'));

        // Activate found ones
        if (activeBtn) activeBtn.classList.add('active');
        if (targetContent) targetContent.classList.add('active');
    }

    // Attach listeners to any element with class .main-tab-btn (works for both mobile and desktop layout)
    const tabButtons = Array.from(document.querySelectorAll('.main-tab-btn'));
    if (tabButtons.length > 0) {
        tabButtons.forEach(btn => {
            btn.addEventListener('click', (e) => {
                e.preventDefault();
                activateMainTabByIdOrBtn(btn);
            });
        });
    } else {
        // Fallback to previous explicit bindings if class-based buttons not found
        if (mainTabProcess) mainTabProcess.addEventListener('click', () => activateMainTabByIdOrBtn(mainTabProcess));
        if (mainTabTranslate) mainTabTranslate.addEventListener('click', () => activateMainTabByIdOrBtn(mainTabTranslate));
        if (mainTabSettings) mainTabSettings.addEventListener('click', () => activateMainTabByIdOrBtn(mainTabSettings));
    }

    // Ensure a default active tab: prefer Process
    if (document.getElementById('mainTabProcess')) activateMainTabByIdOrBtn('mainTabProcess');
    else if (tabButtons[0]) activateMainTabByIdOrBtn(tabButtons[0]);

    // ---------- عناصر تب «پردازش صوت» ----------
    const fileInput = document.getElementById('file-upload');
    const fileLabel = document.getElementById('file-label');
    const form = document.getElementById('uploadForm');
    const output = document.getElementById('output');
    const loader = document.getElementById('loader');
    const submitBtn = document.getElementById('submitBtn');
    const downloadBtn = document.getElementById('downloadBtn');
    const warningBox = document.getElementById('warningBox');

    const tabUpload = document.getElementById('tabUpload');
    const tabLink = document.getElementById('tabLink');
    const fileInputWrapper = document.getElementById('fileInputWrapper');
    const linkInputWrapper = document.getElementById('linkInputWrapper');
    const audioUrlInput = document.getElementById('audio-url');

    const assignWhisperSelect = document.getElementById('assignWhisperSelect');
    const assignTranslateSelect = document.getElementById('assignTranslateSelect');
    const keyWhisperSelect = document.getElementById('keyWhisperSelect');
    const keyTranslateSelect = document.getElementById('keyTranslateSelect');

    const googleTranslateCheckbox = document.getElementById('googleTranslateCheckbox');
    const aiTranslateCheckbox = document.getElementById('translateCheckbox');

    const progressContainer = document.getElementById('progressContainer');
    const progressBar = document.getElementById('progressBar');
    const progressPercent = document.getElementById('progressPercent');
    const progressState = document.getElementById('progressState');

    // ---------- عناصر تب «تنظیمات» ----------
    const provName = document.getElementById('provName');
    const provBaseUrl = document.getElementById('provBaseUrl');
    const provModel = document.getElementById('provModel');
    const saveEndpointBtn = document.getElementById('saveEndpointBtn');

    const keyLabelInput = document.getElementById('keyLabelInput');
    const keyValueInput = document.getElementById('keyValueInput');
    const saveKeyBtn = document.getElementById('saveKeyBtn');
    const deleteKeyBtn = document.getElementById('deleteKeyBtn');
    const keyListSelect = document.getElementById('keyListSelect');

    const editProviderSelect = document.getElementById('editProviderSelect');
    const editProviderDetails = document.getElementById('editProviderDetails');
    const editProviderUrl = document.getElementById('editProviderUrl');
    const updateProviderUrlBtn = document.getElementById('updateProviderUrlBtn');
    const editModelsList = document.getElementById('editModelsList');
    const deleteProviderBtn = document.getElementById('deleteProviderBtn');

    const exportBtn = document.getElementById('exportBtn');
    const importBtn = document.getElementById('importBtn');
    const importFile = document.getElementById('importFile');

    // ---------- عناصر تب «ترجمه» ----------
    const srtProviderSelect = document.getElementById('srtProviderSelect');
    const srtModelSelect = document.getElementById('srtModelSelect');
    const srtKeySelect = document.getElementById('srtKeySelect');
    const srtTabUpload = document.getElementById('srtTabUpload');
    const srtTabLink = document.getElementById('srtTabLink');
    const srtFileInputWrapper = document.getElementById('srtFileInputWrapper');
    const srtLinkInputWrapper = document.getElementById('srtLinkInputWrapper');
    const srtFileInput = document.getElementById('srt-file-upload');
    const srtFileLabel = document.getElementById('srt-file-label');
    const srtUrlInput = document.getElementById('srt-url');
    const srtUploadForm = document.getElementById('srtUploadForm');
    const srtGoogleTranslateCheckbox = document.getElementById('srtGoogleTranslateCheckbox');
    const srtAiTranslateCheckbox = document.getElementById('srtAiTranslateCheckbox');
    const srtSubmitBtn = document.getElementById('srtSubmitBtn');
    const srtDownloadBtn = document.getElementById('srtDownloadBtn');
    const srtLoader = document.getElementById('srtLoader');
    const srtOutput = document.getElementById('srtOutput');
    const srtProgressContainer = document.getElementById('srtProgressContainer');
    const srtProgressBar = document.getElementById('srtProgressBar');
    const srtProgressPercent = document.getElementById('srtProgressPercent');
    const srtProgressState = document.getElementById('srtProgressState');

    let srtCurrentMode = 'upload';
    let srtTranslatedContent = '';
    let srtTranslatedFileName = 'translated_subtitle';
    let srtContent = '';
    let outputFileName = 'subtitle';
    let currentMode = 'upload';

    // جلوگیری از انتخاب همزمان هر دو روش ترجمه
    if (googleTranslateCheckbox && aiTranslateCheckbox) {
        googleTranslateCheckbox.addEventListener('change', () => {
            if (googleTranslateCheckbox.checked) aiTranslateCheckbox.checked = false;
        });
        aiTranslateCheckbox.addEventListener('change', () => {
            if (aiTranslateCheckbox.checked) googleTranslateCheckbox.checked = false;
        });
    }
    if (srtGoogleTranslateCheckbox && srtAiTranslateCheckbox) {
        srtGoogleTranslateCheckbox.addEventListener('change', () => {
            if (srtGoogleTranslateCheckbox.checked) srtAiTranslateCheckbox.checked = false;
        });
        srtAiTranslateCheckbox.addEventListener('change', () => {
            if (srtAiTranslateCheckbox.checked) srtGoogleTranslateCheckbox.checked = false;
        });
    }

    if (srtTabUpload && srtTabLink && srtFileInputWrapper && srtLinkInputWrapper) {
        srtTabUpload.addEventListener('click', () => {
            srtCurrentMode = 'upload';
            srtTabUpload.classList.add('active');
            srtTabLink.classList.remove('active');
            srtFileInputWrapper.style.display = 'block';
            srtLinkInputWrapper.style.display = 'none';
        });
        srtTabLink.addEventListener('click', () => {
            srtCurrentMode = 'link';
            srtTabLink.classList.add('active');
            srtTabUpload.classList.remove('active');
            srtFileInputWrapper.style.display = 'none';
            srtLinkInputWrapper.style.display = 'block';
        });
    }

    if (tabUpload && tabLink && fileInputWrapper && linkInputWrapper) {
        tabUpload.addEventListener('click', () => {
            currentMode = 'upload';
            tabUpload.classList.add('active');
            tabLink.classList.remove('active');
            fileInputWrapper.style.display = 'block';
            linkInputWrapper.style.display = 'none';
        });
        tabLink.addEventListener('click', () => {
            currentMode = 'link';
            tabLink.classList.add('active');
            tabUpload.classList.remove('active');
            fileInputWrapper.style.display = 'none';
            linkInputWrapper.style.display = 'block';
        });
    }

    // ---------- به‌روزرسانی dropdown ها (بدون innerHTML خام — امن در برابر XSS) ----------
    function updateDropdowns() {
        const configData = getConfig();
        const providerKeys = Object.keys(configData.providers || {});

        const provItems = [];
        providerKeys.forEach((pKey) => {
            const prov = configData.providers[pKey];
            if (prov && prov.models) {
                prov.models.forEach((modelObj) => {
                    provItems.push({ value: `${pKey}|${modelObj.name}`, label: `${prov.name || pKey} (${modelObj.name})` });
                });
            }
        });
        if (assignWhisperSelect) fillSelectOptions(assignWhisperSelect, '-- انتخاب پروایدر --', provItems);
        if (assignTranslateSelect) fillSelectOptions(assignTranslateSelect, '-- انتخاب پروایدر --', provItems);

        const keyItems = (configData.api_keys || []).map((kObj) => ({ value: kObj.key, label: kObj.label }));
        const deleteKeyItems = (configData.api_keys || []).map((kObj, idx) => ({ value: String(idx), label: kObj.label }));

        if (keyWhisperSelect) fillSelectOptions(keyWhisperSelect, '-- انتخاب کلید --', keyItems);
        if (keyTranslateSelect) fillSelectOptions(keyTranslateSelect, '-- انتخاب کلید --', keyItems);
        if (keyListSelect) fillSelectOptions(keyListSelect, '-- لیست کلیدها --', deleteKeyItems);

        if (assignWhisperSelect && localStorage.getItem('assigned_whisper_val')) assignWhisperSelect.value = localStorage.getItem('assigned_whisper_val');
        if (assignTranslateSelect && localStorage.getItem('assigned_translate_val')) assignTranslateSelect.value = localStorage.getItem('assigned_translate_val');
        if (keyWhisperSelect && localStorage.getItem('assigned_key_whisper')) keyWhisperSelect.value = localStorage.getItem('assigned_key_whisper');
        if (keyTranslateSelect && localStorage.getItem('assigned_key_translate')) keyTranslateSelect.value = localStorage.getItem('assigned_key_translate');

        // ---------- بخش ویرایش/حذف پروایدر و مدل ----------
        if (editProviderSelect) {
            const previouslySelected = editProviderSelect.value;
            const editProvItems = providerKeys.map((pKey) => ({
                value: pKey,
                label: configData.providers[pKey].name || pKey,
            }));
            fillSelectOptions(editProviderSelect, '-- انتخاب پروایدر --', editProvItems);
            // اگر پروایدر قبلاً انتخاب‌شده هنوز وجود داشت، انتخابش را حفظ کن
            if (previouslySelected && configData.providers[previouslySelected]) {
                editProviderSelect.value = previouslySelected;
            }
            renderEditProviderDetails();
        }

        updateSrtTabDropdowns();
    }

    // نمایش جزئیات (Base URL + لیست مدل‌ها) پروایدرِ انتخاب‌شده در بخش ویرایش،
    // با دکمه‌ی حذف مستقل برای هر مدل و یک دکمه‌ی حذف کل پروایدر.
    function renderEditProviderDetails() {
        if (!editProviderSelect || !editProviderDetails || !editModelsList) return;
        const key = editProviderSelect.value;
        const configData = getConfig();
        const prov = key ? configData.providers[key] : null;

        if (!prov) {
            editProviderDetails.style.display = 'none';
            editModelsList.textContent = '';
            return;
        }

        editProviderDetails.style.display = 'block';
        if (editProviderUrl) editProviderUrl.value = prov.url || '';

        editModelsList.textContent = '';
        (prov.models || []).forEach((modelObj) => {
            const row = document.createElement('div');
            row.className = 'row-group model-row';

            const nameSpan = document.createElement('span');
            nameSpan.className = 'model-row-name';
            nameSpan.textContent = modelObj.name;
            nameSpan.title = modelObj.name;

            const rpsInput = document.createElement('input');
            rpsInput.type = 'text';
            rpsInput.className = 'model-row-rps';
            rpsInput.placeholder = 'RPS';
            rpsInput.value = modelObj.maxRps != null ? String(modelObj.maxRps) : '';
            rpsInput.addEventListener('change', () => {
                updateModelRps(key, modelObj.name, rpsInput.value);
            });

            const delBtn = document.createElement('button');
            delBtn.type = 'button';
            delBtn.className = 'delete-btn btn-sm';
            delBtn.textContent = 'حذف';
            delBtn.addEventListener('click', () => {
                if (!confirm(`مدل «${modelObj.name}» حذف شود؟`)) return;
                deleteModel(key, modelObj.name);
                updateDropdowns();
            });

            row.appendChild(nameSpan);
            row.appendChild(rpsInput);
            row.appendChild(delBtn);
            editModelsList.appendChild(row);
        });
    }

    if (editProviderSelect) editProviderSelect.addEventListener('change', renderEditProviderDetails);

    if (updateProviderUrlBtn) updateProviderUrlBtn.addEventListener('click', () => {
        const key = editProviderSelect ? editProviderSelect.value : '';
        if (!key) return;
        try {
            updateProviderUrl(key, editProviderUrl.value);
            alert('آدرس پروایدر بروزرسانی شد.');
            updateDropdowns();
        } catch (err) {
            alert(err.message);
        }
    });

    if (deleteProviderBtn) deleteProviderBtn.addEventListener('click', () => {
        const key = editProviderSelect ? editProviderSelect.value : '';
        if (!key) return;
        const configData = getConfig();
        const provName = configData.providers[key]?.name || key;
        if (!confirm(`کل پروایدر «${provName}» به همراه همه‌ی مدل‌هایش حذف شود؟ این عمل قابل بازگشت نیست.`)) return;
        deleteProvider(key);
        updateDropdowns();
    });

    function updateSrtModelSelect() {
        const configData = getConfig();
        const pKey = srtProviderSelect ? srtProviderSelect.value : '';
        const prov = configData.providers[pKey];
        const items = prov && prov.models ? prov.models.map((m) => ({ value: m.name, label: m.name })) : [];
        if (srtModelSelect) fillSelectOptions(srtModelSelect, prov ? '-- انتخاب مدل --' : '-- ابتدا پروایدر را انتخاب کنید --', items);
    }

    function updateSrtTabDropdowns() {
        const configData = getConfig();
        const provItems = Object.keys(configData.providers || {}).map((pKey) => ({
            value: pKey,
            label: configData.providers[pKey].name || pKey,
        }));
        if (srtProviderSelect) fillSelectOptions(srtProviderSelect, '-- انتخاب پروایدر --', provItems);

        const keyItems = (configData.api_keys || []).map((kObj) => ({ value: kObj.key, label: kObj.label }));
        if (srtKeySelect) fillSelectOptions(srtKeySelect, '-- انتخاب کلید --', keyItems);

        if (srtProviderSelect && localStorage.getItem('srt_provider_val')) srtProviderSelect.value = localStorage.getItem('srt_provider_val');
        updateSrtModelSelect();
        if (srtModelSelect && localStorage.getItem('srt_model_val')) srtModelSelect.value = localStorage.getItem('srt_model_val');
        if (srtKeySelect && localStorage.getItem('srt_key_val')) srtKeySelect.value = localStorage.getItem('srt_key_val');
    }

    if (srtProviderSelect) srtProviderSelect.addEventListener('change', () => {
        updateSrtModelSelect();
        localStorage.setItem('srt_provider_val', srtProviderSelect.value);
        localStorage.removeItem('srt_model_val');
    });
    if (srtModelSelect) srtModelSelect.addEventListener('change', () => localStorage.setItem('srt_model_val', srtModelSelect.value));
    if (srtKeySelect) srtKeySelect.addEventListener('change', () => localStorage.setItem('srt_key_val', srtKeySelect.value));

    if (assignWhisperSelect) assignWhisperSelect.addEventListener('change', () => localStorage.setItem('assigned_whisper_val', assignWhisperSelect.value));
    if (assignTranslateSelect) assignTranslateSelect.addEventListener('change', () => localStorage.setItem('assigned_translate_val', assignTranslateSelect.value));
    if (keyWhisperSelect) keyWhisperSelect.addEventListener('change', () => localStorage.setItem('assigned_key_whisper', keyWhisperSelect.value));
    if (keyTranslateSelect) keyTranslateSelect.addEventListener('change', () => localStorage.setItem('assigned_key_translate', keyTranslateSelect.value));

    const provMaxRps = document.getElementById('provMaxRps');

    // ---------- تنظیمات: افزودن پروایدر ----------
    if (saveEndpointBtn) saveEndpointBtn.addEventListener('click', () => {
        try {
            const result = addProvider(provName.value, provBaseUrl.value, provModel.value, provMaxRps.value);
            provName.value = '';
            provBaseUrl.value = '';
            provModel.value = '';
            provMaxRps.value = '';
            updateDropdowns();
            alert(
                result.addedCount > 1
                    ? `${result.addedCount} مدل با موفقیت زیر پروایدر «${result.providerName}» اضافه شدند.`
                    : 'پروایدر/مدل با موفقیت اضافه شد.'
            );
        } catch (err) {
            alert(err.message);
        }
    });

    if (saveKeyBtn) saveKeyBtn.addEventListener('click', () => {
        try {
            addApiKey(keyLabelInput.value, keyValueInput.value);
            keyLabelInput.value = '';
            keyValueInput.value = '';
            updateDropdowns();
            alert('کلید API اضافه شد.');
        } catch (err) {
            alert(err.message);
        }
    });

    if (deleteKeyBtn) deleteKeyBtn.addEventListener('click', () => {
        const idx = keyListSelect ? keyListSelect.value : '';
        if (idx === '') {
            alert('لطفاً یک کلید را برای حذف انتخاب کنید.');
            return;
        }
        if (confirm('آیا از حذف این کلید اطمینان دارید؟')) {
            deleteApiKey(Number(idx));
            updateDropdowns();
            alert('کلید حذف شد.');
        }
    });

    if (exportBtn) exportBtn.addEventListener('click', () => {
        const exportObj = exportConfig();
        downloadTextFile(JSON.stringify(exportObj, null, 2), 'ai_config_backup.json');
    });

    if (importBtn) importBtn.addEventListener('click', () => importFile.click());
    if (importFile) importFile.addEventListener('change', (e) => {
        const file = e.target.files[0];
        if (!file) return;
        const reader = new FileReader();
        reader.onload = function (evt) {
            try {
                importConfig(evt.target.result);
                updateDropdowns();
                alert('پشتیبان با موفقیت بازیابی شد!');
            } catch (err) {
                alert('فایل JSON نامعتبر است.');
            }
            importFile.value = '';
        };
        reader.readAsText(file);
    });

    // ---------- انتخاب فایل ----------
    if (fileInput) fileInput.addEventListener('change', function () {
        if (this.files && this.files[0]) {
            const file = this.files[0];
            const sizeMb = (file.size / (1024 * 1024)).toFixed(2);
            if (fileLabel) fileLabel.textContent = `${file.name} (${sizeMb} MB)`;
            outputFileName = baseFileName(file.name);

            if (file.size > 25 * 1024 * 1024) {
                if (warningBox) warningBox.style.display = 'block';
                if (submitBtn) submitBtn.disabled = true;
            } else {
                if (warningBox) warningBox.style.display = 'none';
                if (submitBtn) submitBtn.disabled = false;
            }
        }
    });

    if (srtFileInput) srtFileInput.addEventListener('change', function () {
        if (this.files && this.files[0]) {
            const file = this.files[0];
            const sizeKb = (file.size / 1024).toFixed(1);
            if (srtFileLabel) srtFileLabel.textContent = `${file.name} (${sizeKb} KB)`;
            srtTranslatedFileName = baseFileName(file.name) + '_fa';
        }
    });

    // ---------- فرم پردازش صوت ----------
    if (form) form.addEventListener('submit', async function (e) {
        e.preventDefault();
        if (currentMode === 'upload') {
            const file = fileInput ? fileInput.files[0] : null;
            if (!file) return;
            runProcessAudio(file);
        } else {
            const url = audioUrlInput ? audioUrlInput.value.trim() : '';
            if (!url) return;
            if (progressContainer) progressContainer.style.display = 'block';
            if (progressState) progressState.innerText = 'در حال دانلود فایل از لینک...';
            if (submitBtn) submitBtn.disabled = true;
            try {
                const res = await fetch(url);
                const blob = await res.blob();
                const file = new File([blob], 'audio.mp3', { type: blob.type });
                runProcessAudio(file);
            } catch (err) {
                if (submitBtn) submitBtn.disabled = false;
                alert('خطا در دریافت لینک صوتی');
            }
        }
    });

        function runProcessAudio(file) {
        const configData = getConfig();

        // استخراج maxRps مدل ویس (Whisper)
        const whisperVal = assignWhisperSelect ? assignWhisperSelect.value : '';
        let whisperMaxRps = null;
        if (whisperVal && whisperVal.includes('|')) {
            const [pKey, mName] = whisperVal.split('|');
            const foundModel = configData.providers[pKey]?.models?.find(m => m.name === mName);
            if (foundModel) whisperMaxRps = foundModel.maxRps;
        }

        // استخراج maxRps و URL مدل ترجمه در تب پردازش صوت
        const translateVal = assignTranslateSelect ? assignTranslateSelect.value : '';
        let translateMaxRps = null;
        let translateProvUrl = null;
        let translateModelName = null;
        
        if (translateVal && translateVal.includes('|')) {
            const [pKey, mName] = translateVal.split('|');
            translateModelName = mName;
            translateProvUrl = configData.providers[pKey]?.url;
            const foundModel = configData.providers[pKey]?.models?.find(m => m.name === mName);
            if (foundModel) translateMaxRps = foundModel.maxRps;
        }

        processAudioFile(file, {
            configData: configData,
            assignWhisperSelect, assignTranslateSelect, keyWhisperSelect, keyTranslateSelect,
            googleTranslateCheckbox, aiTranslateCheckbox,
            progressContainer, progressBar, progressPercent, progressState,
            output, loader, submitBtn, downloadBtn,
            whisperMaxRps,
            translateMaxRps,
            translateProvUrl,      // اضافه شدن url پروایدر ترجمه
            translateModelName,    // اضافه شدن نام مدل ترجمه
            onDone: (srt) => { srtContent = srt; },
        });
    }


    if (downloadBtn) downloadBtn.addEventListener('click', () => {
        if (!srtContent) return;
        downloadTextFile(srtContent, `${outputFileName}.srt`);
    });

    // ---------- تب ترجمه فایل SRT ----------
    async function processSrtFile(file) {
        const isGoogleTranslate = srtGoogleTranslateCheckbox ? srtGoogleTranslateCheckbox.checked : false;
        const isAiTranslate = srtAiTranslateCheckbox ? srtAiTranslateCheckbox.checked : false;
        let srtTranslateWarningMsg = null;

        if (!isGoogleTranslate && !isAiTranslate) {
            alert('لطفاً یکی از روش‌های ترجمه را انتخاب کنید.');
            return;
        }

        const configData = getConfig();
        let tProvUrl = '', tModel = '', tKey = '', tProvMaxRps = null;
        if (isAiTranslate) {
            const pKey = srtProviderSelect ? srtProviderSelect.value : '';
            tModel = srtModelSelect ? srtModelSelect.value : '';
            tKey = srtKeySelect ? srtKeySelect.value : '';
            if (!pKey) { alert('لطفاً پروایدر ترجمه را انتخاب کنید.'); return; }
            if (!tModel) { alert('لطفاً مدل ترجمه را انتخاب کنید.'); return; }
            if (!tKey) { alert('لطفاً کلید API را انتخاب کنید.'); return; }
            tProvUrl = configData.providers[pKey]?.url;
            const foundModel = configData.providers[pKey]?.models?.find(m => m.name === tModel);
            tProvMaxRps = foundModel ? foundModel.maxRps : null;
        }

        const srtEls = { state: srtProgressState, bar: srtProgressBar, percent: srtProgressPercent };

        if (srtProgressContainer) srtProgressContainer.style.display = 'block';
        if (srtProgressBar) srtProgressBar.style.width = '0%';
        if (srtProgressPercent) srtProgressPercent.innerText = '0%';
        if (srtProgressState) srtProgressState.innerText = 'در حال خواندن فایل زیرنویس...';
        if (srtOutput) srtOutput.style.display = 'none';
        if (srtDownloadBtn) srtDownloadBtn.style.display = 'none';
        if (srtSubmitBtn) srtSubmitBtn.disabled = true;
        if (srtLoader) srtLoader.style.display = 'block';

        try {
            const rawText = await file.text();
            let translatedSrt;

            if (isGoogleTranslate) {
                const blocks = parseSrtBlocks(rawText);
                if (blocks.length === 0) throw new Error('فایل SRT معتبر نیست یا خالی است.');

                const fakeSegments = blocks.map((b) => ({ text: b.text }));
                const gResult = await translateSegmentsWithGoogle(fakeSegments, srtEls);
                const translatedBlocks = blocks.map((b, i) => ({ timecode: b.timecode, text: gResult.segments[i].text }));
                translatedSrt = buildSrtFromBlocks(translatedBlocks);
                if (gResult.failedChunks > 0) {
                    srtTranslateWarningMsg = `تکمیل شد، اما ⚠️ ${gResult.failedChunks} از ${gResult.totalChunks} دسته با گوگل ترجمه نشد (سرور گوگل/MyMemory در دسترس نبود؛ متن اصلی باقی ماند).`;
                }
            } else {
                const trResult = await translateSrtWithAI(rawText, tProvUrl, tModel, tKey, srtEls, { maxRps: tProvMaxRps });
                translatedSrt = trResult.text;
                if (trResult.failedChunks > 0) {
                    srtTranslateWarningMsg = `تکمیل شد، اما ⚠️ ${trResult.failedChunks} از ${trResult.totalChunks} بخش ترجمه نشدند (متن اصلی جایگزین شد).`;
                }
            }

            srtTranslatedContent = translatedSrt;
            if (srtOutput) srtOutput.innerText = srtTranslatedContent;
            if (srtOutput) srtOutput.style.display = 'block';
            if (srtOutput) srtOutput.style.color = '#e0e0e0';
            if (srtProgressState) srtProgressState.innerText = srtTranslateWarningMsg || 'تکمیل عملیات! 🎉';
            if (srtDownloadBtn) srtDownloadBtn.style.display = 'block';
        } catch (err) {
            if (srtOutput) { srtOutput.style.display = 'block'; srtOutput.style.color = '#ef4444'; srtOutput.innerText = 'خطا: ' + err.message; }
        } finally {
            if (srtLoader) srtLoader.style.display = 'none';
            if (srtSubmitBtn) srtSubmitBtn.disabled = false;
        }
    }

    if (srtUploadForm) srtUploadForm.addEventListener('submit', async function (e) {
        e.preventDefault();
        if (srtCurrentMode === 'upload') {
            const file = srtFileInput ? srtFileInput.files[0] : null;
            if (!file) { alert('لطفاً یک فایل SRT انتخاب کنید.'); return; }
            processSrtFile(file);
        } else {
            const url = srtUrlInput ? srtUrlInput.value.trim() : '';
            if (!url) { alert('لطفاً لینک فایل SRT را وارد کنید.'); return; }
            if (srtProgressContainer) srtProgressContainer.style.display = 'block';
            if (srtProgressState) srtProgressState.innerText = 'در حال دانلود فایل از لینک...';
            if (srtSubmitBtn) srtSubmitBtn.disabled = true;
            try {
                const res = await fetch(url);
                const blob = await res.blob();
                const file = new File([blob], 'subtitle.srt', { type: blob.type || 'text/plain' });
                processSrtFile(file);
            } catch (err) {
                if (srtSubmitBtn) srtSubmitBtn.disabled = false;
                alert('خطا در دریافت لینک فایل زیرنویس');
            }
        }
    });

    if (srtDownloadBtn) srtDownloadBtn.addEventListener('click', () => {
        if (!srtTranslatedContent) return;
        downloadTextFile(srtTranslatedContent, `${srtTranslatedFileName}.srt`);
    });

    // ---------- شروع ----------
    loadConfig();
    updateDropdowns();

    // --- Small UI fixes to ensure consistent mobile behavior ---
    try {
        // Ensure main tab and process tab active state
        // activateMainTabByIdOrBtn already activated default above

        // Default to upload mode for audio and SRT
        if (fileInputWrapper) fileInputWrapper.style.display = 'block';
        if (linkInputWrapper) linkInputWrapper.style.display = 'none';
        if (tabUpload) { tabUpload.classList.add('active'); }
        if (tabLink) { tabLink.classList.remove('active'); }

        if (srtFileInputWrapper) srtFileInputWrapper.style.display = 'block';
        if (srtLinkInputWrapper) srtLinkInputWrapper.style.display = 'none';
        if (srtTabUpload) srtTabUpload.classList.add('active');
        if (srtTabLink) srtTabLink.classList.remove('active');

        // Hide download buttons until content ready
        if (downloadBtn) downloadBtn.style.display = 'none';
        if (srtDownloadBtn) srtDownloadBtn.style.display = 'none';

        // Normalize button heights for consistent look on mobile
        document.querySelectorAll('.btn-primary, .submit-btn, .backup-btn, .delete-btn, .download-btn').forEach(b => {
            try { b.style.minHeight = '44px'; b.style.boxSizing = 'border-box'; } catch(e){}
        });
    } catch (err) {
        console.warn('UI init tweaks failed', err);
    }
}
