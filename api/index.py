from flask import Flask, request, jsonify, Response
from flask_cors import CORS
from deep_translator import GoogleTranslator
import requests
import io
import os
import srt

app = Flask(__name__)
CORS(app)

GROQ_API_KEY = os.environ.get("GROQ_API_KEY", "gsk_YOUR_ACTUAL_GROQ_API_KEY_HERE")

# --- روت پروژه ۱: تبدیل صوت به متن / زیرنویس ---
@app.route('/transcribe-aac', methods=['POST'])
def transcribe_aac():
    try:
        if 'file' not in request.files:
            return jsonify({'error': 'هیچ فایلی ارسال نشده است.'}), 400
            
        file = request.files['file']
        if file.filename == '':
            return jsonify({'error': 'فایلی انتخاب نشده است.'}), 400

        file_bytes = file.read()
        file_size_mb = len(file_bytes) / (1024 * 1024)
        
        if file_size_mb > 25:
            return jsonify({
                'error': f'حجم فایل ({file_size_mb:.2f}MB) بیشتر از ۲۵ مگابایت است.'
            }), 400

        audio_io = io.BytesIO(file_bytes)
        audio_io.name = file.filename

        headers = { "Authorization": f"Bearer {GROQ_API_KEY}" }
        data = {
            "model": "whisper-large-v3-turbo",
            "temperature": "0.0",
            "response_format": "json"
        }
        files = { 'file': (file.filename, audio_io, 'audio/aac') }
        
        response = requests.post(
            "https://api.groq.com/openai/v1/audio/transcriptions",
            headers=headers,
            data=data,
            files=files,
            timeout=60
        )

        if response.status_code == 200:
            return jsonify({ 'success': True, 'text': response.json().get('text', '') })
        else:
            return jsonify({ 'error': 'خطا در سرور Whisper', 'details': response.text }), response.status_code

    except Exception as e:
        return jsonify({'error': 'خطای غیرمنتظره رخ داد', 'details': str(e)}), 500

# --- روت پروژه ۲: ترجمه فایل SRT ---
@app.route('/translate-srt', methods=['POST'])
def translate_srt():
    try:
        if 'file' not in request.files:
            return jsonify({'error': 'No file part'}), 400
            
        file = request.files['file']
        if file.filename == '':
            return jsonify({'error': 'No selected file'}), 400

        target_lang = request.form.get('to', 'fa')
        source_lang = request.form.get('from', 'auto')

        try:
            file_content = file.read().decode('utf-8')
        except UnicodeDecodeError:
            file.seek(0)
            file_content = file.read().decode('windows-1256', errors='ignore')
        
        subtitles = list(srt.parse(file_content))
        translator = GoogleTranslator(source=source_lang, target=target_lang)

        valid_subs = [sub for sub in subtitles if sub.content.strip()]
        batch_size = 30
        
        for i in range(0, len(valid_subs), batch_size):
            batch = valid_subs[i:i+batch_size]
            separator = "\n---\n"
            combined_text = separator.join([sub.content for sub in batch])
            
            try:
                translated_combined = translator.translate(combined_text)
                translated_lines = translated_combined.split("---")
                
                for index, sub in enumerate(batch):
                    if index < len(translated_lines):
                        sub.content = translated_lines[index].strip()
            except Exception:
                for sub in batch:
                    try:
                        sub.content = translator.translate(sub.content)
                    except:
                        pass

        final_srt = srt.compose(subtitles)

        return Response(
            final_srt,
            mimetype="text/srt",
            headers={"Content-disposition": f"attachment; filename={file.filename}"}
        )

    except Exception as e:
        return jsonify({'error': 'Translation failed', 'details': str(e)}), 500

@app.route('/', defaults={'path': ''})
@app.route('/<path:path>')
def catch_all(path):
    return jsonify({"message": "Subtitle Studio API is active."})

if __name__ == '__main__':
    app.run(debug=True, port=5000)