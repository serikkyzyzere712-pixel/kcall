let socket;
let peer;
let localStream;
let nickname;
let room;

function createPeer() {
  peer = new RTCPeerConnection({
    iceServers: [
      { urls: "stun:stun.l.google.com:19302" }
    ]
  });

  peer.onicecandidate = e => {
    if (e.candidate) {
      socket.send(JSON.stringify({ type: "candidate", candidate: e.candidate }));
    }
  };

  peer.ontrack = e => {
    document.getElementById("remoteAudio").srcObject = e.streams[0];
  };
}

async function join() {
  nickname = document.getElementById("nickname").value;
  room = document.getElementById("room").value;

  socket = new WebSocket("wss://kcall2.onrender.com");

  socket.onopen = () => {
    socket.send(JSON.stringify({ type: "join", room, nickname }));
    addMsg("You joined as " + nickname, "friend");
  };

  socket.onmessage = async event => {
    let data = JSON.parse(event.data);

    if (data.type === "msg") {
      addMsg(data.nickname + ": " + data.text, "friend");
    }

    if (data.type === "joinNotice") {
      addMsg(data.nickname + " joined", "friend");
    }

    if (data.type === "offer") {
      await peer.setRemoteDescription(data.offer);
      let answer = await peer.createAnswer();
      await peer.setLocalDescription(answer);
      socket.send(JSON.stringify({ type: "answer", answer }));
    }

    if (data.type === "answer") {
      await peer.setRemoteDescription(data.answer);
    }

    if (data.type === "candidate") {
      await peer.addIceCandidate(data.candidate);
    }
  };

  createPeer();
}

function sendMsg() {
  let input = document.getElementById("msg");
  let text = input.value;
  addMsg("You: " + text, "you");
  socket.send(JSON.stringify({ type: "msg", text, nickname }));
  input.value = "";
}

function addMsg(text, type) {
  let div = document.createElement("div");
  div.classList.add("message", type);
  div.innerText = text;
  document.getElementById("messages").appendChild(div);
}

async function startCall() {
  localStream = await navigator.mediaDevices.getUserMedia({ audio: true });
  localStream.getTracks().forEach(track => peer.addTrack(track, localStream));
  let offer = await peer.createOffer();
  await peer.setLocalDescription(offer);
  socket.send(JSON.stringify({ type: "offer", offer }));
}

function endCall() {
  if (localStream) {
    localStream.getTracks().forEach(track => track.stop());
  }
  peer.close();
  createPeer();

}


