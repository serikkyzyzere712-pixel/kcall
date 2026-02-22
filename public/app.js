// =================== ГЛОБАЛЬНЫЕ ПЕРЕМЕННЫЕ ===================
let socket = null;
let peer = null;
let localStream = null;

let nickname = "";
let room = "";

// =================== JOIN ===================
function join() {
  // Берём значения из input (если вызывается напрямую)
  if (!nickname || !room) {
    nickname = document.getElementById("nickname")?.value.trim();
    room = document.getElementById("room")?.value.trim();
  }

  if (!nickname || !room) {
    alert("Nickname and room required");
    return;
  }

  socket = new WebSocket("wss://kcall2.onrender.com");

  socket.onopen = () => {
    console.log("Connected to server");

    socket.send(JSON.stringify({
      type: "join",
      nickname: nickname,
      room: room
    }));
  };

  socket.onmessage = async (event) => {
    const data = JSON.parse(event.data);

    if (data.type === "msg") {
      addMsg(data.nickname || "Unknown", data.text);
    }

    if (data.type === "offer") {
      await handleOffer(data.offer);
    }

    if (data.type === "answer") {
      if (peer) {
        await peer.setRemoteDescription(new RTCSessionDescription(data.answer));
      }
    }

    if (data.type === "candidate") {
      if (peer) {
        await peer.addIceCandidate(new RTCIceCandidate(data.candidate));
      }
    }
  };

  socket.onclose = () => {
    console.log("Disconnected from server");
  };

  socket.onerror = (err) => {
    console.error("WebSocket error:", err);
  };
}

// =================== CHAT ===================
function sendMsg() {
  const input = document.getElementById("msg");
  const text = input.value.trim();
  if (!text) return;

  if (!socket || socket.readyState !== WebSocket.OPEN) {
    alert("Not connected to server");
    return;
  }

  socket.send(JSON.stringify({
    type: "msg",
    text: text,
    room: room
  }));

  addMsg("You", text);
  input.value = "";
}

function addMsg(nick, text) {
  const div = document.createElement("div");
  div.className = "message";
  div.innerHTML = `<b>${nick}</b>: ${text}`;
  document.getElementById("messages").appendChild(div);
  document.getElementById("messages").scrollTop =
    document.getElementById("messages").scrollHeight;
}

// =================== WEBRTC ===================
function createPeer() {
  peer = new RTCPeerConnection({
    iceServers: [
      { urls: "stun:stun.l.google.com:19302" }
    ]
  });

  peer.onicecandidate = (event) => {
    if (event.candidate && socket) {
      socket.send(JSON.stringify({
        type: "candidate",
        candidate: event.candidate,
        room: room
      }));
    }
  };

  peer.ontrack = (event) => {
    document.getElementById("remoteAudio").srcObject =
      event.streams[0];
  };
}

async function startCall() {
  if (!socket || socket.readyState !== WebSocket.OPEN) {
    alert("Not connected to server");
    return;
  }

  createPeer();

  try {
    localStream = await navigator.mediaDevices.getUserMedia({
      audio: true
    });
  } catch (err) {
    alert("Microphone access denied");
    return;
  }

  localStream.getTracks().forEach(track =>
    peer.addTrack(track, localStream)
  );

  const offer = await peer.createOffer();
  await peer.setLocalDescription(offer);

  socket.send(JSON.stringify({
    type: "offer",
    offer: offer,
    room: room
  }));
}

async function handleOffer(offer) {
  createPeer();

  try {
    localStream = await navigator.mediaDevices.getUserMedia({
      audio: true
    });
  } catch (err) {
    alert("Microphone access denied");
    return;
  }

  localStream.getTracks().forEach(track =>
    peer.addTrack(track, localStream)
  );

  await peer.setRemoteDescription(new RTCSessionDescription(offer));

  const answer = await peer.createAnswer();
  await peer.setLocalDescription(answer);

  socket.send(JSON.stringify({
    type: "answer",
    answer: answer,
    room: room
  }));
}

function endCall() {
  if (peer) {
    peer.close();
    peer = null;
  }

  if (localStream) {
    localStream.getTracks().forEach(track => track.stop());
    localStream = null;
  }

  document.getElementById("remoteAudio").srcObject = null;
}

// =================== ENTER CHAT (если нужно) ===================
function enterChat() {
  nickname = document.getElementById("nickname").value.trim();
  room = document.getElementById("room").value.trim();

  if (!nickname || !room) {
    alert("Fill all fields");
    return;
  }

  document.getElementById("loginScreen").style.display = "none";
  document.getElementById("chatScreen").style.display = "block";
  document.getElementById("roomTitle").innerText = "Room: " + room;

  join();
}
