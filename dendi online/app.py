import os
from flask import Flask, render_template, send_from_directory, request, jsonify
from flask_socketio import SocketIO, emit, join_room
import telebot
from threading import Thread
import uuid

app = Flask(__name__, static_folder='static')
app.config['SECRET_KEY'] = 'nes_online_secret'
app.config['UPLOAD_FOLDER'] = 'uploads'
if not os.path.exists('uploads'):
    os.makedirs('uploads')

socketio = SocketIO(app, cors_allowed_origins="*", max_http_buffer_size=20000000)

# Telegram Bot Setup
BOT_TOKEN = '8798187369:AAFGRXMMvElulTGtuhePUmp5QAEuZAK7ALs'
bot = telebot.TeleBot(BOT_TOKEN)

# ROM storage mapping room -> filename
room_roms = {}

@app.route('/upload', methods=['POST'])
def upload_file():
    if 'file' not in request.files:
        return jsonify({"error": "No file"}), 400
    file = request.files['file']
    room_id = request.form.get('room')
    if file and room_id:
        filename = f"{room_id}.nes"
        filepath = os.path.join(app.config['UPLOAD_FOLDER'], filename)
        file.save(filepath)
        room_roms[room_id] = filename
        
        # На хостинге используем относительный путь
        relative_url = f"/download/{filename}"
        print(f"[HTTP] ROM uploaded: {filename}")
        return jsonify({"url": relative_url})
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

# Socket.io events with logging
@socketio.on('join')
def on_join(data):
    room = data['room']
    join_room(room)
    print(f"[Socket] User joined room: {room}")
    
    if room in room_roms:
        rom_url = f"/download/{room_roms[room]}"
        emit('load_rom', {'url': rom_url}, room=request.sid)
    
    emit('status', {'msg': f'Joined room: {room}'}, room=room)

@socketio.on('input')
def on_input(data):
    room = data['room']
    emit('input', data, room=room, include_self=False)

@socketio.on('share_rom')
def on_share_rom(data):
    room = data['room']
    emit('load_rom', data, room=room, include_self=False)

@socketio.on('sync_state')
def on_sync_state(data):
    room = data['room']
    emit('apply_state', data, room=room, include_self=False)

@socketio.on('request_sync')
def on_request_sync(data):
    room = data['room']
    if room in room_roms:
        rom_url = f"/download/{room_roms[room]}"
        emit('load_rom', {'url': rom_url}, room=request.sid)
    else:
        emit('request_sync', data, room=room, include_self=False)

# Telegram Bot Handlers
@bot.message_handler(commands=['start', 'help'])
def send_welcome(message):
    # На хостинге мы не знаем заранее URL, поэтому просим пользователя 
    # зайти на сайт, который ему выдаст хостинг
    welcome_text = (
        "🎮 Привет! Это бот для игры в Денди онлайн.\n\n"
        "Открой сайт игры, создай комнату и отправь код другу!\n"
    )
    bot.reply_to(message, welcome_text)

def run_bot():
    print("Telegram bot is running...")
    bot.infinity_polling()

if __name__ == '__main__':
    # Start Telegram bot in a separate thread
    bot_thread = Thread(target=run_bot)
    bot_thread.daemon = True
    bot_thread.start()
    
    # Start Flask server
    print(f"Server starting on http://localhost:5000")
    socketio.run(app, host='0.0.0.0', port=5000)
