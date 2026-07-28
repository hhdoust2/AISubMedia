from flask import Flask, request, jsonify, Response, send_from_directory
from flask_cors import CORS
from deep_translator import GoogleTranslator
import srt
import requests
import json
import os

app = Flask(__name__, static_folder='.', static_url_path='')
CORS(app)

@app.route('/')
def index():
    return send_from_directory('.', 'index.html')

# ==================== ۱. ترجمه با گوگل (Deep Translator) ====================
@app.route('/translate-srt', methods=['POST'])
def translate_srt():
    try:
        if 'file' not in request.files:
            return jsonify({'error': 'فایلی یافت نشد'}), 400
            
        file = request.files['file']
        if file.filename == '':
            return jsonify({'error': 'فایلی انتخاب نشده است'}), 400

        target_lang = request.form.get('to', 'fa')
        source_lang = request.form.get('from', 'auto')

        try:
            file_content = file.read().decode('utf-8')
        except UnicodeDecodeError:
            file.seek(0)
            file_content = file.read().decode('windows-1256', errors='ignore')
        
        subtitles = list(srt.parse(file_content))
        translator = GoogleTranslator(source=source_lang, target=target_lang)

        # ترجمه ایمن خط به خط
        for sub in subtitles:
            if sub.content.strip():
                try:
                    sub.content = translator.translate(sub.content.strip())
                except Exception:
                    pass

        final_srt = srt.compose(subtitles)

        return Response(
            final_srt,
            mimetype="text/srt",
            headers={"Content-disposition": f"attachment; filename=translated_{file.filename}"}
        )

    except Exception as e:
        return jsonify({'error': 'خطا در ترجمه فایل', 'details': str(e)}), 500

# ==================== ۲. ترجمه هوشمند با هوش مصنوعی ====================
@app.route('/translate-ai-srt', methods=['POST'])
def translate_ai_srt():
    try:
        user_api_key = request.form.get('api_key')
        endpoint_url = request.form.get('endpoint_url')
        model_name = request.form.get('model')

        if not user_api_key or not endpoint_url or not model_name:
            return jsonify({'error': 'اطلاعات کلید، اندپوینت یا مدل کامل نیست'}), 400

        if 'file' not in request.files:
            return jsonify({'error': 'فایل زیرنویس یافت نشد'}), 400
            
        file = request.files['file']
        if file.filename == '':
            return jsonify({'error': 'نام فایل نامعتبر است'}), 400

        try:
            file_content = file.read().decode('utf-8')
        except UnicodeDecodeError:
            file.seek(0)
            file_content = file.read().decode('windows-1256', errors='ignore')
        
        subtitles = list(srt.parse(file_content))
        valid_subs = [sub for sub in subtitles if sub.content.strip()]
        
        batch_size = 15
        headers = {
            "Authorization": f"Bearer {user_api_key}",
            "Content-Type": "application/json"
        }
        
        for i in range(0, len(valid_subs), batch_size):
            batch = valid_subs[i:i+batch_size]
            lines_dict = {str(idx + 1): sub.content.replace('\n', ' ').strip() for idx, sub in enumerate(batch)}
            
            prompt = f"""
You are an expert movie subtitle translator. Translate the values of the JSON object into natural, fluent Persian (فارسی روان و محاوره‌ای).
CRITICAL FORMAT RULES:
1. Respond ONLY with a valid JSON object matching the exact keys provided.
2. Do NOT change keys.
3. Do NOT wrap response in markdown code blocks.

JSON to translate:
{json.dumps(lines_dict, ensure_ascii=False)}
"""
            data = {
                "model": model_name,
                "messages": [{"role": "user", "content": prompt}],
                "temperature": 0.3
            }
            
            try:
                response = requests.post(endpoint_url, headers=headers, json=data, timeout=60)
                if response.status_code == 200:
                    result = response.json()
                    raw_content = result['choices'][0]['message']['content'].strip()
                    
                    if raw_content.startswith("```json"):
                        raw_content = raw_content[7:-3].strip()
                    elif raw_content.startswith("```"):
                        raw_content = raw_content[3:-3].strip()
                        
                    translated_json = json.loads(raw_content)
                    for idx, sub in enumerate(batch):
                        key = str(idx + 1)
                        if key in translated_json:
                            sub.content = translated_json[key].strip()
            except Exception as err:
                print(f"Error processing batch: {err}")
                continue

        final_srt = srt.compose(subtitles)

        return Response(
            final_srt,
            mimetype="text/srt",
            headers={"Content-disposition": f"attachment; filename=ai_{file.filename}"}
        )

    except Exception as e:
        return jsonify({'error': 'خطا در ترجمه با هوش مصنوعی', 'details': str(e)}), 500

if __name__ == '__main__':
    app.run(host='0.0.0.0', port=5000, debug=True)
