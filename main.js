import { initializeApp } from "https://www.gstatic.com/firebasejs/10.7.0/firebase-app.js";
import { getFirestore, collection, getDoc, getDocs, addDoc, setDoc, updateDoc, doc, onSnapshot, deleteDoc } from "https://www.gstatic.com/firebasejs/10.7.0/firebase-firestore.js";

const firebaseConfig = {
    apiKey: "AIzaSyAhh5dioyGi-s3KuY9CIvUKn76ypT-SjCs",
    authDomain: "webrtc-demo-7a442.firebaseapp.com",
    projectId: "webrtc-demo-7a442",
    storageBucket: "webrtc-demo-7a442.appspot.com",
    messagingSenderId: "362028803592",
    appId: "1:362028803592:web:89b5af1830645b69f993bd",
    measurementId: "G-P0KQP9E1XQ"
};

const servers = {
    iceServers: [
        {
            urls: ['stun:stun1.l.google.com:19302', 'stun:stun2.l.google.com:19302'],
        },
    ],
    iceCandidatePoolSize: 10,
};

const app = initializeApp(firebaseConfig);
const db = getFirestore(app);




let peerConnection;
let localStream;
let remoteStream;

// HTML elements
const webcamButton = $('#webcamButton');
const micButton = $('#micButton');
const hangupButton = $('#hangupButton');
const quantity = $("#quantity");
const localUser = document.getElementById('localUser');
const remoteUser = document.getElementById('remoteUser');

let timerInterval;
let minutes = 0;
let seconds = 0;

let webrtc = async () => {
    peerConnection = createPeerConnection();
    await getMediaStream();
    let flag = await checkIfRoomExists();
    if (!flag) {
        await createOffer();
    }
    else {
        await answerOffer();
    }
}
webrtc();

hangupButton.on("click", () => {
    stopTimer();
    closeConnection();
})

webcamButton.on("click", () => {
    toggleButton("video", webcamButton);
})
micButton.on("click", () => {
    toggleButton("audio", micButton);
})

function toggleButton(type, button) {
    let videoPlayer = localStream.getTracks().find(track => track.kind === type)

    if (videoPlayer.enabled) {
        videoPlayer.enabled = false;
        button.addClass("bg-danger");
        button.removeClass("bg-white");
    }
    else {
        videoPlayer.enabled = true;
        button.addClass("bg-white");
        button.removeClass("bg-danger");
    }
}

async function closeConnection() {
    peerConnection.close();
    const urlSearchParams = new URLSearchParams(window.location.search);
    const roomParameter = urlSearchParams.get('room');
    await deleteDoc(doc(db, "calls", roomParameter));

    await clearData();

    window.location.href = "/index.html";
}


function createPeerConnection() {
    const newpeerConnection = new RTCPeerConnection(servers);
    console.log("PEER CONNECTION: ", newpeerConnection);

    return newpeerConnection;
}

async function getMediaStream() {
    localStream = await navigator.mediaDevices.getUserMedia({ video: true, audio: true });
    remoteStream = new MediaStream();

    localStream.getTracks().forEach((track) => {
        peerConnection.addTrack(track, localStream);
    });

    peerConnection.ontrack = (event) => {
        event.streams[0].getTracks().forEach((track) => {
            remoteStream.addTrack(track);
        });
    };
    localUser.srcObject = localStream;
    remoteUser.srcObject = remoteStream;
}


async function getCallDoc() {
    const urlSearchParams = new URLSearchParams(window.location.search);
    //Lấy room làm id
    const roomParameter = urlSearchParams.get('room');
    if (roomParameter == "" || !roomParameter) {
        window.location.href = "/index.html"
    }
    //Kiểm tra xem room tồn tại chưa
    const callRef = doc(db, "calls", roomParameter);
    const callDocExists = await getDoc(callRef);
    return callDocExists;
}

async function createOffer() {
    const offerCandidates = collection(db, 'offerCandidates');
    const answerCandidates = collection(db, 'answerCandidates');
    const urlSearchParams = new URLSearchParams(window.location.search);
    //Lấy room làm id
    const roomParameter = urlSearchParams.get('room');
    //Chưa tồn tại bên phía offer => tạo doc
    const callDoc = await doc(db, "calls", roomParameter);
    peerConnection.onicecandidate = async (event) => {
        if (event.candidate) {
            console.log("NEW ICE CANDIDATE: ", event.candidate.toJSON());
            event.candidate && await addDoc(offerCandidates, event.candidate.toJSON());
        }
    };

    // Tạo offer
    const offerDescription = await peerConnection.createOffer();
    await peerConnection.setLocalDescription(offerDescription);

    const offer = {
        sdp: offerDescription.sdp,
        type: offerDescription.type,
    };

    await setDoc(callDoc, { offer });

    // Lắng nghe remote answer
    onSnapshot(callDoc, async (snapshot) => {
        const data = snapshot.data();
        if (snapshot.exists() && data && !peerConnection.currentRemoteDescription && data.answer) {
            console.log("REMOTE ANSWER", data.answer);
            const answerDescription = new RTCSessionDescription(data.answer);
            await peerConnection.setRemoteDescription(answerDescription).then(() => {
                // Khi remote answered, add candidate to peer connection
                onSnapshot(answerCandidates, (snapshot) => {
                    snapshot.docChanges().forEach((change) => {
                        console.log(change.type);
                        if (change.type === 'added') {
                            const candidate = new RTCIceCandidate(change.doc.data());
                            if (candidate) {
                                console.log("Add icecandidate to peer connection on Remote");
                                peerConnection.addIceCandidate(candidate);
                            }
                        }
                    });
                });
            }).catch((error) => {
                console.error('Error setting remote description:', error);
            });
        }
    });
}

async function answerOffer() {
    const offerCandidates = collection(db, 'offerCandidates');
    const answerCandidates = collection(db, 'answerCandidates');
    const callDoc = await getCallDoc();
    peerConnection.onicecandidate = async (event) => {
        if (event.candidate) {
            console.log("NEW ICE CANDIDATE: ", event.candidate.toJSON());
            event.candidate && await addDoc(answerCandidates, event.candidate.toJSON());
        }
    };

    const callData = await callDoc.data();

    const offerDescription = callData.offer;
    await peerConnection.setRemoteDescription(new RTCSessionDescription(offerDescription));

    const answerDescription = await peerConnection.createAnswer();
    await peerConnection.setLocalDescription(answerDescription);

    const answer = {
        type: answerDescription.type,
        sdp: answerDescription.sdp,
    };
    await updateDoc(callDoc.ref, { answer });

    onSnapshot(offerCandidates, (snapshot) => {
        snapshot.docChanges().forEach((change) => {
            if (change.type === 'added') {
                let candidate = new RTCIceCandidate(change.doc.data());
                if (candidate) {
                    console.log("Add icecandidate to peer connection on Local");
                    peerConnection.addIceCandidate(candidate);
                }
            }
        });
    });
}

async function clearData() {

    const offerRef = await collection(db, 'offerCandidates');
    await getDocs(offerRef).then((querySnapshot) => {
        querySnapshot.forEach(async (docValue) => {
            console.log(docValue.id);
            await deleteDoc(doc(db, 'offerCandidates', docValue.id)).then(() => console.log("success")).catch(error => console.log(error));
        });
    });

    const answerRef = await collection(db, 'answerCandidates');
    await getDocs(answerRef).then((querySnapshot) => {
        querySnapshot.forEach(async (docValue) => {
            await deleteDoc(doc(db, 'answerCandidates', docValue.id));
        });
    });
}
async function checkIfRoomExists() {
    let callDoc = await getCallDoc();
    if (callDoc.exists()) {
        let callDocJSON = JSON.stringify(callDoc.data());
        console.log(callDocJSON)
        const callDocObject = JSON.parse(callDocJSON);
        if (callDocObject.answer != null) {
            const urlSearchParams = new URLSearchParams(window.location.search);
            const roomParameter = urlSearchParams.get('room');
            await deleteDoc(doc(db, "calls", roomParameter));
            return false;
        }
        return true;
    }
    else {
        return false;
    }
}
peerConnection.addEventListener('iceconnectionstatechange', () => {
    console.log('ICE Connection State:', peerConnection.iceConnectionState);

    // Kiểm tra xem người dùng có rời khỏi cuộc gọi hay không
    if (peerConnection.iceConnectionState === 'disconnected' ||
        peerConnection.iceConnectionState === 'failed' ||
        peerConnection.iceConnectionState === 'closed') {
        stopTimer();
        quantity.text("1");
        closeConnection();
    }
    if (peerConnection.iceConnectionState === 'connected') {
        console.log("connected successfully");
        startTimer();
        quantity.text("2");
    }
});


function updateTimer() {

    const $timerElement = $('#timer');
    seconds++;
    if (seconds === 60) {
        minutes++;
        seconds = 0;
    }

    const displayMinutes = minutes < 10 ? `0${minutes}` : minutes;
    const displaySeconds = seconds < 10 ? `0${seconds}` : seconds;

    $timerElement.text(`${displayMinutes}:${displaySeconds}`);
}

function startTimer() {
    timerInterval = setInterval(updateTimer, 1000);
}

function stopTimer() {
    const $timerElement = $('#timer');
    const timerValue = $timerElement.text().split(":");

    clearInterval(timerInterval);
    alert('Người dùng đã rời khỏi cuộc gọi. Cuộc gọi dài ' + timerValue[0] + " phút " + timerValue[1] + " giây");
}


