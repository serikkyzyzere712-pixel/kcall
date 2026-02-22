// ==================== ГЛОБАЛЬНЫЕ ПЕРЕМЕННЫЕ ====================
let socket;
let peer;
let localStream;
let nickname;
let room;

// Для переподключения
let reconnectAttempts = 0;
const MAX_RECONNECT_ATTEMPTS = 5;
let reconnectTimer = null;

// Флаг, показываем ли мы индикатор соединения
let connectionActive = false;

// ==================== ВСПОМОГАТЕЛЬНЫЕ ФУНКЦИИ ====================
function setConnectionStatus(connected) {
  connectionActive = connected;
  const statusEl = document.getElementById("connectionStatus");
  if (statusEl) {
    statusEl.innerText = connected ? "🟢 Online" : "🔴 Offline";
  }
  // Если соединение потеряно, скрываем индикатор звонка
  if (!connected) setCallStatus(false);
}

function setCallStatus(inCall) {
  const statusEl = document.getElementById("callStatus");
  if (statusEl) {
    statusEl.style.display = inCall ? "inline" : "none";
  }
}

function addMsg(text, type) {
  const div = document.createElement("div");
  div.classList.add("message", type);
  div.innerText = text;
  const messagesDiv = document.getElementById("messages");
  messagesDiv.appendChild(div);
  messagesDiv.scrollTop = messagesDiv.scrollHeight; // автоскролл
}

// Очистка ресурсов перед новым подключением
function cleanup() {
  if (localStream) {
    localStream.getTracks().forEach(track => track.stop());
    localStream = null;
  }
  if (peer) {
    peer.close();
    peer = null;
  }
  setCallStatus(false);
}

// ==================== СОЗДАНИЕ ПИРА (WEBRTC) ====================
function createPeer() {
  peer = new RTCPeerConnection({
    iceServers: [
      { urls: "stun:stun.l.google.com:19302" },
      {
        urls: "turn:openrelay.metered.ca:80",
        username: "openrelayproject",
        credential: "openrelayproject"
      }
    ]
  });

  peer.onicecandidate = e => {
    if (e.candidate && socket && socket.readyState === WebSocket.OPEN) {
      socket.send(JSON.stringify({
        type: "candidate",
        candidate: e.candidate,
        room
      }));
    }
  };

  peer.ontrack = e => {
    const remoteAudio = document.getElementById("remoteAudio");
    remoteAudio.srcObject = e.streams[0];
    setCallStatus(true);
  };

  peer.oniceconnectionstatechange = () => {
    console.log("ICE state:", peer.iceConnectionState);
    if (peer.iceConnectionState === 'disconnected' || peer.iceConnectionState === 'failed') {
      setCallStatus(false);
    }
  };
}

// ==================== ПОДКЛЮЧЕНИЕ К WEBSOCKET ====================
function connectWebSocket() {
  if (socket && socket.readyState === WebSocket.OPEN) {
    console.log("WebSocket уже открыт");
    return;
  }

  // Очищаем предыдущий сокет, если есть
  if (socket) {
    socket.onopen = null;
    socket.onerror = null;
    socket.onclose = null;
    socket.onmessage = null;
    socket.close();
  }

  const wsUrl = "wss://kcall2.onrender.com"; // Замените на ваш URL
  console.log(`Connecting to ${wsUrl}...`);
  socket = new WebSocket(wsUrl);

  // Таймаут соединения (10 секунд)
  const connectionTimeout = setTimeout(() => {
    if (socket.readyState !== WebSocket.OPEN) {
      console.warn("Connection timeout");
      socket.close();
      addMsg("Connection timeout. Retrying...", "system");
      scheduleReconnect();
    }
  }, 10000);

  socket.onopen = () => {
    clearTimeout(connectionTimeout);
    reconnectAttempts = 0; // сбрасываем счётчик при успехе
    console.log("✅ WebSocket OPEN");
    setConnectionStatus(true);

    // Отправляем приветствие серверу
    const safeNick = nickname || "Anonymous";
    const safeRoom = room || "default";
    socket.send(JSON.stringify({
      type: "join",
      room: safeRoom,
      nickname: safeNick
    }));
    addMsg(`You joined as ${safeNick}`, "system");
  };

  socket.onerror = (err) => {
    console.error("❌ WebSocket ERROR:", err);
    // Ошибка может прийти и без закрытия, но мы не выводим сразу пользователю,
    // так как обычно за ней последует onclose.
  };

  socket.onclose = (event) => {
    clearTimeout(connectionTimeout);
    console.log(`🔒 WebSocket CLOSED: code=${event.code}, reason=${event.reason}`);
    setConnectionStatus(false);

    let reason = "";
    if (event.code === 1000) reason = "Normal closure";
    else if (event.code === 1001) reason = "Going away";
    else if (event.code === 1002) reason = "Protocol error";
    else if (event.code === 1003) reason = "Unsupported data";
    else if (event.code === 1005) reason = "No status received";
    else if (event.code === 1006) reason = "Abnormal closure (possible network issue)";
    else if (event.code === 1007) reason = "Invalid frame payload data";
    else if (event.code === 1008) reason = "Policy violation";
    else if (event.code === 1009) reason = "Message too big";
    else if (event.code === 1010) reason = "Missing extension";
    else if (event.code === 1011) reason = "Internal server error";
    else reason = `Unknown code ${event.code}`;

    addMsg(`Connection lost: ${reason}`, "system");

    // Очищаем ресурсы (стопим звонок, если он был)
    cleanup();

    // Пытаемся переподключиться, если код не 1000 (нормальное закрытие) или если это не намеренное завершение
    if (event.code !== 1000 || reconnectAttempts > 0) {
      scheduleReconnect();
    }
  };

  socket.onmessage = (event) => {
    try {
      const data = JSON.parse(event.data);
      handleWebSocketMessage(data);
    } catch (e) {
      console.error("Failed to parse message:", event.data, e);
    }
  };
}

// ==================== ПЛАНИРОВЩИК ПЕРЕПОДКЛЮЧЕНИЯ ====================
function scheduleReconnect() {
  if (reconnectTimer) clearTimeout(reconnectTimer);
  if (reconnectAttempts >= MAX_RECONNECT_ATTEMPTS) {
    addMsg("Maximum reconnect attempts reached. Please reload the page or click Reconnect manually.", "system");
    return;
  }
  reconnectAttempts++;
  const delay = reconnectAttempts * 3000; // 3, 6, 9, 12, 15 сек
  addMsg(`Reconnecting in ${delay/1000} seconds... (attempt ${reconnectAttempts}/${MAX_RECONNECT_ATTEMPTS})`, "system");
  reconnectTimer = setTimeout(() => {
    connectWebSocket();
  }, delay);
}

// ==================== ОБРАБОТКА СООБЩЕНИЙ ОТ СЕРВЕРА ====================
function handleWebSocketMessage(data) {
  console.log("Received:", data);

  if (data.type === "msg") {
    addMsg(data.nickname + ": " + data.text, "friend");
  }

  if (data.type === "joinNotice") {
    addMsg(data.nickname + " joined", "system");
  }

  if (data.type === "leave" || data.type === "bye") {
    addMsg(data.nickname + " left", "system");
    // Если это был наш собеседник, сбрасываем статус звонка
    setCallStatus(false);
    if (peer) {
      peer.close();
      peer = null;
    }
  }

  if (data.type === "offer") {
    handleOffer(data.offer);
  }

  if (data.type === "answer") {
    handleAnswer(data.answer);
  }

  if (data.type === "candidate") {
    handleCandidate(data.candidate);
  }
}

// ==================== WEBRTC ОБРАБОТЧИКИ ====================
async function handleOffer(offer) {
  // Если есть активный пир, закрываем его
  if (peer && peer.connectionState !== 'closed') {
    peer.close();
    peer = null;
  }
  if (!peer) createPeer();

  try {
    localStream = await navigator.mediaDevices.getUserMedia({ audio: true });
  } catch (err) {
    addMsg("Cannot access microphone: " + err.message, "system");
    return;
  }

  const senders = peer.getSenders();
  const hasAudio = senders.some(s => s.track && s.track.kind === 'audio');
  if (!hasAudio) {
    localStream.getTracks().forEach(track => peer.addTrack(track, localStream));
  }

  await peer.setRemoteDescription(new RTCSessionDescription(offer));
  const answer = await peer.createAnswer();
  await peer.setLocalDescription(answer);

  if (socket && socket.readyState === WebSocket.OPEN) {
    socket.send(JSON.stringify({ type: "answer", answer, room }));
  }
  setCallStatus(true);
}

async function handleAnswer(answer) {
  await peer.setRemoteDescription(new RTCSessionDescription(answer));
  setCallStatus(true);
}

async function handleCandidate(candidate) {
  try {
    await peer.addIceCandidate(new RTCIceCandidate(candidate));
  } catch (err) {
    console.error("ICE error:", err);
  }
}

// ==================== ФУНКЦИИ, ВЫЗЫВАЕМЫЕ ИЗ ИНТЕРФЕЙСА ====================
async function join() {
  // Переменные nickname и room должны быть установлены ДО вызова этой функции (из index.html)
  if (!nickname || !room) {
    console.error("nickname or room not set");
    return;
  }
  // Сбрасываем счётчик попыток и запускаем подключение
  reconnectAttempts = 0;
  connectWebSocket();
  createPeer(); // создаём peer заранее
}

function sendMsg() {
  const input = document.getElementById("msg");
  const text = input.value.trim();
  if (!text) return;
  if (!socket || socket.readyState !== WebSocket.OPEN) {
    addMsg("No connection to server", "system");
    return;
  }

  socket.send(JSON.stringify({ type: "msg", text, room }));
  addMsg("You: " + text, "you");
  input.value = "";
  input.focus();
}

async function startCall() {
  if (!socket || socket.readyState !== WebSocket.OPEN) {
    addMsg("No connection to server", "system");
    return;
  }

  try {
    localStream = await navigator.mediaDevices.getUserMedia({ audio: true });
  } catch (err) {
    addMsg("Cannot access microphone: " + err.message, "system");
    return;
  }

  if (!peer) createPeer();

  const senders = peer.getSenders();
  const hasAudio = senders.some(s => s.track && s.track.kind === 'audio');
  if (!hasAudio) {
    localStream.getTracks().forEach(track => peer.addTrack(track, localStream));
  }

  const offer = await peer.createOffer();
  await peer.setLocalDescription(offer);

  socket.send(JSON.stringify({ type: "offer", offer, room }));
  console.log("Call started");
}

function endCall() {
  if (socket && socket.readyState === WebSocket.OPEN) {
    socket.send(JSON.stringify({ type: "bye", room }));
  }
  cleanup();
  // Создаём новый peer для будущих звонков
  createPeer();
  console.log("Call ended");
}

// Ручное переподключение (можно повесить на кнопку)
function manualReconnect() {
  reconnectAttempts = 0;
  if (socket) socket.close();
  connectWebSocket();
}

// ==================== ЭКСПОРТ ФУНКЦИЙ В ГЛОБАЛЬНУЮ ОБЛАСТЬ ====================
// (для вызова из HTML)
window.join = join;
window.sendMsg = sendMsg;
window.startCall = startCall;
window.endCall = endCall;
window.manualReconnect = manualReconnect;
