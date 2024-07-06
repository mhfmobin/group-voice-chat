const peers = {};
const chatContainer = document.getElementById('left');
const remoteVideoContainer = document.getElementById('right');
const toggleButton = document.getElementById('toggle-cam');
const roomId = window.location.pathname.split('/')[2];
let userStream;
let isAdmin = false;
const socket = io('/');

function callOtherUsers(otherUsers, stream) {
    if (!otherUsers.length) {
        isAdmin = true;
    }
    otherUsers.forEach(userIdToCall => {
        const peer = createPeer(userIdToCall);
        peers[userIdToCall] = peer;
        stream.getTracks().forEach(track => {
            peer.addTrack(track, stream);
        });
    });
}

function createPeer(userIdToCall) {
    const peer = new RTCPeerConnection({
        iceServers: [
            {
                urls: "stun:stun.l.google.com:19302"
            }
        ]
    });
    peer.onnegotiationneeded = () => userIdToCall ? handleNegotiationNeededEvent(peer, userIdToCall) : null;
    peer.onicecandidate = handleICECandidateEvent;
    peer.ontrack = (e) => {
        const container = document.createElement('div');
        container.classList.add('remote-video-container');

        const audio = document.createElement('audio');
        audio.srcObject = e.streams[0];
        audio.autoplay = true;
        audio.playsInline = true;
        audio.classList.add("remote-audio");
        container.appendChild(audio);

        if (isAdmin) {
            const button = document.createElement("button");
            button.innerHTML = `Mute user`;
            button.classList.add('button');
            button.setAttribute('user-id', userIdToCall);
            container.appendChild(button);
        }
        container.id = userIdToCall;
        remoteVideoContainer.appendChild(container);
    }
    return peer;
}

async function handleNegotiationNeededEvent(peer, userIdToCall) {
    const offer = await peer.createOffer();
    await peer.setLocalDescription(offer);
    const payload = {
        sdp: peer.localDescription,
        userIdToCall,
    };

    socket.emit('peer connection request', payload);
}

async function handleReceiveOffer({ sdp, callerId }, stream) {
    const peer = createPeer(callerId);
    peers[callerId] = peer;
    const desc = new RTCSessionDescription(sdp);
    await peer.setRemoteDescription(desc);

    stream.getTracks().forEach(track => {
        peer.addTrack(track, stream);
    });

    const answer = await peer.createAnswer();
    await peer.setLocalDescription(answer);

    const payload = {
        userToAnswerTo: callerId,
        sdp: peer.localDescription,
    };

    socket.emit('connection answer', payload);
}

function handleAnswer({ sdp, answererId }) {
    const desc = new RTCSessionDescription(sdp);
    peers[answererId].setRemoteDescription(desc).catch(e => console.log(e));
}

function handleICECandidateEvent(e) {
    if (e.candidate) {
        Object.keys(peers).forEach(id => {
            const payload = {
                target: id,
                candidate: e.candidate,
            }
            socket.emit("ice-candidate", payload);
        });
    }
}

function handleReceiveIce({ candidate, from }) {
    const inComingCandidate = new RTCIceCandidate(candidate);
    peers[from].addIceCandidate(inComingCandidate);
};

function handleDisconnect(userId) {
    delete peers[userId];
    document.getElementById(userId).remove();
};

toggleButton.addEventListener('click', () => {
    const audioTrack = userStream.getTracks().find(track => track.kind === 'audio');
    if (audioTrack.enabled) {
        audioTrack.enabled = false;
        toggleButton.innerHTML = 'Unmute'
    } else {
        audioTrack.enabled = true;
        toggleButton.innerHTML = "Mute"
    }
});

remoteVideoContainer.addEventListener('click', (e) => {
    if (e.target.innerHTML.includes('Hide')) {
        e.target.innerHTML = 'show remote cam';
        socket.emit('hide remote cam', e.target.getAttribute('user-id'));
    } else {
        e.target.innerHTML = `Hide user's cam`;
        socket.emit('show remote cam', e.target.getAttribute('user-id'));
    }
})

function mute() {
    const audioTrack = userStream.getTracks().find(track => track.kind === 'audio');
    audioTrack.enabled = false;
}

function unmute() {
    const audioTrack = userStream.getTracks().find(track => track.kind === 'audio');
    audioTrack.enabled = true;
}

async function init() {
    socket.on('connect', async () => {
        const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
        userStream = stream;
        socket.emit('user joined room', roomId);

        socket.on('all other users', (otherUsers) => callOtherUsers(otherUsers, stream));

        socket.on("connection offer", (payload) => handleReceiveOffer(payload, stream));

        socket.on('connection answer', handleAnswer);

        socket.on('ice-candidate', handleReceiveIce);

        socket.on('user disconnected', (userId) => handleDisconnect(userId));

        socket.on('hide cam', mute);

        socket.on("show cam", unmute);

        socket.on('server is full', () => alert("chat is full"));
    });
}

init();