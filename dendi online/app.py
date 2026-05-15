import gevent.monkey
gevent.monkey.patch_all() # Новая заплатка для gevent

import os
from flask import Flask, render_template, send_from_directory, request, jsonify
from flask_socketio import SocketIO, emit, join_room
import telebot
from threading import Thread
import uuid

app = Flask(__name__, static_folder='static')
app.config['SECRET_KEY'] = 'nes_online_secret'
app.config['UPLOAD_FOLDER'] = '/tmp/uploads'

if not os.path.exists(app.config['UPLOAD_FOLDER']):
    os.makedirs(app.config['UPLOAD_FOLDER'])

# Указываем async_mode='gevent'
socketio = SocketIO(app, cors_allowed_origins="*", max_http_buffer_size=20000000, async_mode='gevent')

BOT_TOKEN = '8798187369:AAFGRXMMvElulTGtuhePUmp5QAEuZAK7ALs'
bot = telebot.TeleBot(BOT_TOKEN)
room_roms = {}

def run_bot():
    print("Telegram bot is starting...")
    try:
        bot.infinity_polling()
    except Exception as e:
        print(f"Bot error: {e}")

bot_thread = Thread(target=run_bot)
bot_thread.daemon = True
bot_thread.start()

@app.route('/upload', methods=['POST'])
def upload_file():
    if 'file' not in request.files: return jsonify({"error": "No file"}), 400
    file = request.files['file']
    room_id = request.form.get('room')
    if file and room_id:
        filename = f"{room_id}.nes"
        filepath = os.path.join(app.config['UPLOAD_FOLDER'], filename)
        file.save(filepath)
        room_roms[room_id] = filename
        return jsonify({"url": f"/download/{filename}"})
    return jsonify({"error": "Invalid data"}), 400

@app.route('/download/<filename>')
def download_file(filename):
    return send_from_directory(app.config['UPLOAD_FOLDER'], filename)

@app.route('/')
def index():
    return send_from_directory('static', 'index.html')

@app.route('/<path:path>')
def static_files(path):
    return send_from_directory('static', path)

@socketio.on('join')
def on_join(data):
    room = data['room']
    join_room(room)
    if room in room_roms:
        emit('load_rom', {'url': f"/download/{room_roms[room]}"}, room=request.sid)
    emit('status', {'msg': f'Joined room: {room}'}, room=room)

@socketio.on('input')
def on_input(data):
    emit('input', data, room=data['room'], include_self=False)

@socketio.on('sync_state')
def on_sync_state(data):
    emit('apply_state', data, room=data['room'], include_self=False)

@socketio.on('request_sync')
def on_request_sync(data):
    room = data['room']
    if room in room_roms:
        emit('load_rom', {'url': f"/download/{room_roms[room]}"}, room=request.sid)
    else:
        emit('request_sync', data, room=room, include_self=False)

@bot.message_handler(commands=['start', 'help'])
def send_welcome(message):
    bot.reply_to(message, "🎮 Бот запущен на сервере! Открой сайт и начни играть.")

if __name__ == '__main__':
    port = int(os.environ.get('PORT', 5000))
    socketio.run(app, host='0.0.0.0', port=port)
