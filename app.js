import { initializeApp } from "https://www.gstatic.com/firebasejs/10.8.0/firebase-app.js";
import { getDatabase, ref, set, onValue, update, serverTimestamp } from "https://www.gstatic.com/firebasejs/10.8.0/firebase-database.js";
import { getAuth, signInAnonymously } from "https://www.gstatic.com/firebasejs/10.8.0/firebase-auth.js";
import { initializeAppCheck, ReCaptchaV3Provider } from "https://www.gstatic.com/firebasejs/10.8.0/firebase-app-check.js";

const firebaseConfig = {
    apiKey: "AIzaSyAvbpQ5r3Ikfndjs7cme5MTTvPVslk6kjI",
    authDomain: "geotest-51bdf.firebaseapp.com",
    databaseURL: "https://geotest-51bdf-default-rtdb.asia-southeast1.firebasedatabase.app",
    projectId: "geotest-51bdf",
    storageBucket: "geotest-51bdf.firebasestorage.app",
    messagingSenderId: "1079101227743",
    appId: "1:1079101227743:web:def9f952358ada96ad1f6a",
    measurementId: "G-W72KKW2020"
};

const app = initializeApp(firebaseConfig);
const db = getDatabase(app);
const auth = getAuth(app);

signInAnonymously(auth)
    .then(() => { console.log("Player identified anonymously."); })
    .catch((error) => { console.error("Auth error:", error); });

const appCheck = initializeAppCheck(app, {
    provider: new ReCaptchaV3Provider('6LeQHRAtAAAAAJMGvjg5CxEiVJ_9MTspWKvkVCeu'),
    isTokenAutoRefreshEnabled: true
});

const gameLocations = [
    { name: "Rome Colosseum", lat: 41.8902, lng: 12.4922 },
    { name: "Eiffel Tower", lat: 48.8584, lng: 2.2945 },
    { name: "Times Square", lat: 40.7580, lng: -73.9855 },
    { name: "Taj Mahal", lat: 27.1751, lng: 78.0421 },
    { name: "Sydney Opera House", lat: -33.8568, lng: 151.2153 },
    { name: "Pyramids of Giza", lat: 29.9792, lng: 31.1342 },
    { name: "Golden Gate Bridge", lat: 37.8199, lng: -122.4783 }
];

let map, guessMarker, mlyViewer;
let currentRoomId = "";
let playerId = "player_" + Math.floor(Math.random() * 1000); 
let selectedCoords = null;
let actualCoords = null;
let resultsLayers = []; 
let isHost = false; 
let countdownInterval = null;
let localPanicTriggered = false;
let hasGuessed = false;

function initMap() {
    map = L.map('map').setView([20, 0], 2);
    L.tileLayer('https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png', {
        attribution: '© OpenStreetMap'
    }).addTo(map);

    map.on('click', function(e) {
        if (document.getElementById('btn-guess').getAttribute('data-submitted') === 'true') return;

        selectedCoords = e.latlng;
        if (guessMarker) {
            guessMarker.setLatLng(selectedCoords);
        } else {
            guessMarker = L.marker(selectedCoords).addTo(map);
        }
        document.getElementById('btn-guess').disabled = false;
    });
}

function showNotification(message, duration = 4000) {
    let container = document.getElementById('toast-container');
    if (!container) {
        container = document.createElement('div');
        container.id = 'toast-container';
        document.body.appendChild(container);
    }

    const toast = document.createElement('div');
    toast.className = 'custom-toast';
    toast.innerHTML = `<span class="toast-icon">📢</span><span class="toast-text">${message}</span>`;
    
    container.appendChild(toast);
    setTimeout(() => { toast.classList.add('toast-visible'); }, 50);

    setTimeout(() => {
        toast.classList.remove('toast-visible');
        toast.classList.add('toast-exit');
        setTimeout(() => { toast.remove(); }, 400);
    }, duration);
}

window.createRoom = function() {
    const roomId = document.getElementById('room-input').value.trim();
    if (!roomId) return alert("Please enter a Room ID");
    
    currentRoomId = roomId;
    isHost = true; 
    const randomIndex = Math.floor(Math.random() * gameLocations.length);
    const target = gameLocations[randomIndex];

    document.getElementById('lobby-waiting-status').style.display = 'block';
    document.getElementById('waiting-msg').innerText = `Room ${roomId} created! Waiting for opponent...`;

    set(ref(db, 'rooms/' + roomId), {
        targetLocation: target,
        gameState: "waiting",
        playerHealths: {
            hostId: playerId,
            guestId: "",
            [playerId]: 5000
        },
        guesses: {},
        skipVotes: {} 
    }).then(() => {
        listenToRoom(roomId);
    }).catch((error) => {
        console.error("Firebase write error:", error);
    });
}

window.joinRoom = function() {
    const roomId = document.getElementById('room-input').value.trim();
    if (!roomId) return alert("Please enter a Room ID");
    
    currentRoomId = roomId;
    isHost = false;

    onValue(ref(db, 'rooms/' + roomId), (snapshot) => {
        const data = snapshot.val();
        if (!data || data.gameState !== "waiting") return;

        const updates = {};
        updates[`rooms/${roomId}/gameState`] = "playing";
        updates[`rooms/${roomId}/timerStartTime`] = serverTimestamp();
        updates[`rooms/${roomId}/timerDuration`] = 60;
        updates[`rooms/${roomId}/panicTriggered`] = false;
        updates[`rooms/${roomId}/playerHealths/guestId`] = playerId;
        updates[`rooms/${roomId}/playerHealths/${playerId}`] = 5000;

        update(ref(db), updates).then(() => {
            listenToRoom(roomId);
        });
    }, { onlyOnce: true });
}

let loadedTargetName = ""; 

function listenToRoom(roomId) {
    onValue(ref(db, 'rooms/' + roomId), (snapshot) => {
        const data = snapshot.val();
        if (!data) return;

        actualCoords = { lat: data.targetLocation.lat, lng: data.targetLocation.lng };

        if (data.gameState === "waiting" || data.gameState === "playing" || data.gameState === "revealed") {
            if (data.playerHealths && data.playerHealths.hostId) {
                const myHp = data.playerHealths[playerId] !== undefined ? data.playerHealths[playerId] : 5000;
                const oppId = data.playerHealths.hostId === playerId ? data.playerHealths.guestId : data.playerHealths.hostId;
                const enemyHp = (oppId && data.playerHealths[oppId] !== undefined) ? data.playerHealths[oppId] : 5000;

                document.getElementById('my-hp-text').innerText = `${myHp} / 5000`;
                document.getElementById('enemy-hp-text').innerText = `${enemyHp} / 5000`;
                document.getElementById('my-hp-bar').style.width = `${(myHp / 5000) * 100}%`;
                document.getElementById('enemy-hp-bar').style.width = `${(enemyHp / 5000) * 100}%`;
            }
        }

        if (data.gameState === "playing") {
            document.getElementById('skip-hud').style.display = 'flex'; 
            const currentVotesCount = data.skipVotes ? Object.keys(data.skipVotes).length : 0;
            
            // Map live string updates sequentially to both container views
            const counterFull = document.getElementById('skip-vote-counter');
            if (counterFull) counterFull.innerText = `${currentVotesCount}/2`;
            
            const counterSmall = document.getElementById('skip-vote-counter-small');
            if (counterSmall) counterSmall.innerText = `${currentVotesCount}/2`;

            if (data.skipVotes && data.skipVotes[playerId]) {
                const voteBtn = document.getElementById('btn-vote-skip');
                if (voteBtn) {
                    voteBtn.disabled = true;
                    voteBtn.innerText = "⏳ Voted to Skip";
                }
            }

            if (currentVotesCount === 2 && isHost) {
                executeHostSkipRelocation();
                return; 
            }
        } else {
            document.getElementById('skip-hud').style.display = 'none';
        }

        if (data.gameState === "playing" && data.guesses && Object.keys(data.guesses).length === 2) {
            clearInterval(countdownInterval);
            document.body.classList.remove('panic-flash', 'screen-shake');
            processCombatDamageEvaluation(data);
            return; 
        }

        if (data.gameState === "revealed" && data.guesses && Object.keys(data.guesses).length === 2) {
            clearInterval(countdownInterval);
            document.body.classList.remove('panic-flash', 'screen-shake');
            renderVisualResultsOnly(data, data.guesses);
            return; 
        }

        if (data.gameState === "playing") {
            document.getElementById('menu-overlay').style.opacity = '0';
            document.getElementById('menu-overlay').style.visibility = 'hidden';
            document.getElementById('battle-scorecard-overlay').style.display = 'none'; 
            document.getElementById('battle-hud').style.display = 'flex';
            document.getElementById('timer-hud').style.display = 'flex';

            const serverSaysIMadeAGuess = data.guesses && data.guesses[playerId] !== undefined;
            const totalGuessesCount = data.guesses ? Object.keys(data.guesses).length : 0;
            
            const oppId = data.playerHealths.hostId === playerId ? data.playerHealths.guestId : data.playerHealths.hostId;
            const opponentHasGuessed = data.guesses && oppId && data.guesses[oppId] !== undefined;

            if (loadedTargetName !== data.targetLocation.name) {
                if (resultsLayers) { resultsLayers.forEach(layer => map.removeLayer(layer)); resultsLayers = []; }
                if (guessMarker) { map.removeLayer(guessMarker); guessMarker = null; }
                selectedCoords = null;
                hasGuessed = false; 
                localPanicTriggered = false;
                
                document.body.classList.remove('panic-flash', 'screen-shake');
                
                const guessBtn = document.getElementById('btn-guess');
                guessBtn.disabled = true;
                guessBtn.removeAttribute('data-submitted');
                guessBtn.innerText = "Submit Guess";

                const nextBtnCheck = document.getElementById('btn-next-round');
                if (nextBtnCheck) nextBtnCheck.style.display = 'none';
                
                // Force pill closure cleanly whenever a brand new round spawns
                const skipHud = document.getElementById('skip-hud');
                if (skipHud) {
                    skipHud.classList.remove('skip-expanded');
                    skipHud.classList.add('skip-collapsed');
                    const compact = document.getElementById('skip-compact');
                    const full = document.getElementById('skip-full');
                    if (compact) compact.style.display = 'block';
                    if (full) full.style.display = 'none';
                }
            }

            if (data.panicTriggered && !localPanicTriggered) {
                localPanicTriggered = true; 
                
                if (!serverSaysIMadeAGuess) {
                    document.body.classList.add('panic-flash', 'screen-shake');
                    setTimeout(() => document.body.classList.remove('screen-shake'), 600);
                    showNotification("⚠️ WARNING: Opponent has locked a guess! Timer cut down to 10s!");
                } else {
                    document.body.classList.remove('panic-flash', 'screen-shake');
                    showNotification("🎯 Success: You guessed first! Opponent's timer slashed down!");
                }
            }

            if (data.timerStartTime) {
                clearInterval(countdownInterval);
                countdownInterval = setInterval(() => {
                    const elapsedSecs = Math.floor((Date.now() - data.timerStartTime) / 1000);
                    let timeRemaining = data.timerDuration - elapsedSecs;

                    if (timeRemaining <= 0) {
                        timeRemaining = 0;
                        clearInterval(countdownInterval);
                        
                        if (!hasGuessed && !serverSaysIMadeAGuess) {
                            if (selectedCoords) {
                                window.submitGuess();
                            } else {
                                submitNoGuessTimeout();
                            }
                        }
                    }

                    if (totalGuessesCount === 1 && !data.panicTriggered && isHost) {
                        const timeElapsedSoFar = Math.floor((Date.now() - data.timerStartTime) / 1000);
                        const initialRemaining = data.timerDuration - timeElapsedSoFar;

                        if (initialRemaining > 10) {
                            const newStartTime = Date.now() - ((data.timerDuration - 10) * 1000);
                            update(ref(db, `rooms/${currentRoomId}`), {
                                timerStartTime: newStartTime,
                                panicTriggered: true
                            });
                        } else {
                            update(ref(db, `rooms/${currentRoomId}`), { panicTriggered: true });
                        }
                    }

                    if (hasGuessed || serverSaysIMadeAGuess) {
                        if (!opponentHasGuessed) {
                            document.getElementById('timer-clock').innerText = `${timeRemaining}s`;
                            document.getElementById('status-msg').innerText = `You have locked in your guess! Opponent has not guessed yet... (${timeRemaining}s remaining)`;
                            document.body.classList.remove('panic-flash', 'screen-shake');
                        } else {
                            document.getElementById('timer-clock').innerText = "⏳";
                            document.getElementById('status-msg').innerText = "All guesses locked! Calculating battle damage results...";
                        }
                    } else {
                        document.getElementById('timer-clock').innerText = `${timeRemaining}s`;
                        if (data.panicTriggered || timeRemaining <= 10) {
                            document.getElementById('timer-clock').style.color = '#ff1744';
                            document.getElementById('status-msg').innerText = "⚠️ PANIC MODE: Opponent submitted! 10 seconds remaining!";
                            
                            if(!document.body.classList.contains('panic-flash')) {
                                document.body.classList.add('panic-flash');
                            }
                        } else {
                            document.getElementById('timer-clock').style.color = '#ff9100';
                            document.getElementById('status-msg').innerText = "Game Active! Find the location and guess!";
                        }
                    }
                }, 200);
            }

            if (loadedTargetName !== data.targetLocation.name) {
                loadedTargetName = data.targetLocation.name; 
                const voteBtn = document.getElementById('btn-vote-skip');
                if (voteBtn) {
                    voteBtn.disabled = false;
                    voteBtn.innerText = "🔄 Vote to Skip";
                }

                if (mlyViewer) { try { mlyViewer.remove(); } catch(e) {} mlyViewer = null; }

                setTimeout(() => {
                    const fetchWithFallbackRadius = (radiusSize) => {
                        const token = ['MLY', '27253020047671245', '1ada96c9c41234954cb5bbe20ecc1961'].join('|');
                        const url = `https://graph.mapillary.com/images?access_token=${token}&fields=id&lat=${actualCoords.lat}&lng=${actualCoords.lng}&radius=${radiusSize}&limit=1`;

                        fetch(url)
                            .then(response => response.json())
                            .then(result => {
                                if (!result.data || result.data.length === 0) {
                                    if (radiusSize === 50) { fetchWithFallbackRadius(250); } 
                                    else if (radiusSize === 250) { fetchWithFallbackRadius(1000); } 
                                    else { throw new Error("No imagery found."); }
                                    return;
                                }
                                const targetImageId = result.data[0].id;
                                mlyViewer = new mapillary.Viewer({ container: 'mly', accessToken: token, imageId: targetImageId });
                                setTimeout(() => { mlyViewer.resize(); }, 50);
                            })
                            .catch(err => {
                                console.error(err);
                                document.getElementById('status-msg').innerText = "Imagery lookup failed! Use Skip Button.";
                            });
                    };
                    fetchWithFallbackRadius(50);
                }, 200); 
            }
        } else {
            clearInterval(countdownInterval);
            document.getElementById('timer-hud').style.display = 'none';
            document.body.classList.remove('panic-flash', 'screen-shake');
        }
    });
}

// Collapsible Skip Hud Controller Function
window.toggleSkipHud = function(e) {
    const hud = document.getElementById('skip-hud');
    if (!hud) return;
    const compact = document.getElementById('skip-compact');
    const full = document.getElementById('skip-full');
    
    if (hud.classList.contains('skip-collapsed')) {
        hud.classList.remove('skip-collapsed');
        hud.classList.add('skip-expanded');
        if (compact) compact.style.display = 'none';
        if (full) full.style.display = 'flex';
    } else {
        hud.classList.remove('skip-expanded');
        hud.classList.add('skip-collapsed');
        if (compact) compact.style.display = 'block';
        if (full) full.style.display = 'none';
    }
};

window.voteToSkipLocation = function() {
    if (!currentRoomId) return;
    set(ref(db, `rooms/${currentRoomId}/skipVotes/${playerId}`), true);
}

function executeHostSkipRelocation() {
    const randomIndex = Math.floor(Math.random() * gameLocations.length);
    const nextTarget = gameLocations[randomIndex];

    const updates = {};
    updates[`rooms/${currentRoomId}/targetLocation`] = nextTarget;
    updates[`rooms/${currentRoomId}/guesses`] = {}; 
    updates[`rooms/${currentRoomId}/skipVotes`] = {}; 
    updates[`rooms/${currentRoomId}/panicTriggered`] = false;
    updates[`rooms/${currentRoomId}/timerStartTime`] = serverTimestamp();
    updates[`rooms/${currentRoomId}/timerDuration`] = 60;
    updates[`rooms/${currentRoomId}/gameState`] = "playing";

    update(ref(db), updates).catch(err => console.error(err));
}

window.submitGuess = function() {
    const targetCoords = selectedCoords || { lat: 0, lng: 0 };
    if (!currentRoomId) return;

    hasGuessed = true; 

    document.getElementById('btn-guess').disabled = true;
    document.getElementById('btn-guess').setAttribute('data-submitted', 'true');
    document.getElementById('btn-guess').innerText = "Submitted Lock ✓";
    document.getElementById('status-msg').innerText = "Guess submitted! Waiting for opponent...";
    document.body.classList.remove('panic-flash', 'screen-shake');

    set(ref(db, `rooms/${currentRoomId}/guesses/${playerId}`), {
        lat: targetCoords.lat,
        lng: targetCoords.lng,
        isTimedOut: false
    });
}

function submitNoGuessTimeout() {
    hasGuessed = true;

    document.getElementById('btn-guess').disabled = true;
    document.getElementById('btn-guess').setAttribute('data-submitted', 'true');
    document.getElementById('btn-guess').innerText = "No Guess Lock ❌";
    document.getElementById('status-msg').innerText = "Time expired! Empty choice registered...";
    document.body.classList.remove('panic-flash', 'screen-shake');

    set(ref(db, `rooms/${currentRoomId}/guesses/${playerId}`), {
        lat: 0,
        lng: 0,
        isTimedOut: true
    });
}

function processCombatDamageEvaluation(roomData) {
    if (!isHost) return; 

    const roomRef = ref(db, `rooms/${currentRoomId}`);
    update(roomRef, { gameState: "processing" }).then(() => {
        const pIds = [roomData.playerHealths.hostId, roomData.playerHealths.guestId];
        const playerScores = {};

        pIds.forEach(id => {
            if (!id) return;
            const guess = roomData.guesses ? roomData.guesses[id] : null;
            
            if (!guess || guess.isTimedOut === true) {
                playerScores[id] = 0;
            } else {
                const dist = calculateHaversineDistance(guess.lat, guess.lng, roomData.targetLocation.lat, roomData.targetLocation.lng);
                playerScores[id] = computeGeoGuessrScore(dist);
            }
        });

        const p1 = pIds[0];
        const p2 = pIds[1];
        
        let currentHp1 = (roomData.playerHealths && roomData.playerHealths[p1] !== undefined) ? roomData.playerHealths[p1] : 5000;
        let currentHp2 = (roomData.playerHealths && roomData.playerHealths[p2] !== undefined) ? roomData.playerHealths[p2] : 5000;

        if (playerScores[p1] > playerScores[p2]) {
            const damage = playerScores[p1] - playerScores[p2];
            currentHp2 = Math.max(0, currentHp2 - damage);
        } else if (playerScores[p2] > playerScores[p1]) {
            const damage = playerScores[p2] - playerScores[p1];
            currentHp1 = Math.max(0, currentHp1 - damage);
        }

        const updates = {};
        updates[`rooms/${currentRoomId}/gameState`] = "revealed";
        updates[`rooms/${currentRoomId}/playerHealths/${p1}`] = currentHp1;
        updates[`rooms/${currentRoomId}/playerHealths/${p2}`] = currentHp2;

        update(ref(db), updates).catch(err => console.error("Evaluation crash caught: ", err));
    });
}

function renderVisualResultsOnly(roomData, guesses) {
    if (resultsLayers.length > 0) return;

    const myGuess = guesses ? guesses[playerId] : null;
    const oppId = roomData.playerHealths.hostId === playerId ? roomData.playerHealths.guestId : roomData.playerHealths.hostId;
    const enemyGuess = guesses ? guesses[oppId] : null;

    const myDistance = (!myGuess || myGuess.isTimedOut) ? 20037 : calculateHaversineDistance(myGuess.lat, myGuess.lng, actualCoords.lat, actualCoords.lng);
    const enemyDistance = (!enemyGuess || enemyGuess.isTimedOut) ? 20037 : calculateHaversineDistance(enemyGuess.lat, enemyGuess.lng, actualCoords.lat, actualCoords.lng);

    const myScore = (!myGuess || myGuess.isTimedOut) ? 0 : computeGeoGuessrScore(myDistance);
    const enemyScore = (!enemyGuess || enemyGuess.isTimedOut) ? 0 : computeGeoGuessrScore(enemyDistance);

    const finalMyHp = (roomData.playerHealths && roomData.playerHealths[playerId] !== undefined) ? roomData.playerHealths[playerId] : 5000;
    const finalEnemyHp = (roomData.playerHealths && oppId && roomData.playerHealths[oppId] !== undefined) ? roomData.playerHealths[oppId] : 5000;

    const netDamage = Math.abs(myScore - enemyScore);
    let startMyHp = finalMyHp;
    let startEnemyHp = finalEnemyHp;
    
    if (myScore > enemyScore) { startEnemyHp = finalEnemyHp + netDamage; } 
    else if (enemyScore > myScore) { startMyHp = finalMyHp + netDamage; }

    const scorecardOverlay = document.getElementById('battle-scorecard-overlay');
    scorecardOverlay.style.display = 'flex';

    document.getElementById('my-damage-pop').innerText = "";
    document.getElementById('my-damage-pop').classList.remove('animate-damage-pop');
    document.getElementById('enemy-damage-pop').innerText = "";
    document.getElementById('enemy-damage-pop').classList.remove('animate-damage-pop');

    document.getElementById('card-my-hp-running').innerText = `HP: ${startMyHp}`;
    document.getElementById('card-enemy-hp-running').innerText = `HP: ${startEnemyHp}`;

    document.getElementById('card-my-dist').innerText = (!myGuess || myGuess.isTimedOut) ? "No Guess" : `${Math.round(myDistance)} km away`;
    document.getElementById('card-enemy-dist').innerText = (!enemyGuess || enemyGuess.isTimedOut) ? "No Guess" : `${Math.round(enemyDistance)} km away`;

    let currentTick = 0;
    const tickDuration = 40; 
    const interval = setInterval(() => {
        currentTick++;
        const ratio = currentTick / tickDuration;
        document.getElementById('card-my-score').innerText = Math.round(myScore * ratio);
        document.getElementById('card-enemy-score').innerText = Math.round(enemyScore * ratio);

        if (currentTick >= tickDuration) {
            clearInterval(interval);
            triggerLaserProjectileCombatAnimation(myScore, enemyScore, startMyHp, finalMyHp, startEnemyHp, finalEnemyHp);
        }
    }, 25);

    const trueMarker = L.circleMarker([actualCoords.lat, actualCoords.lng], {
        radius: 12, fillColor: '#ff1744', color: '#fff', weight: 3, opacity: 1, fillOpacity: 0.9, zIndexOffset: 1000
    }).addTo(map).bindPopup("<b>Target Location</b>");
    resultsLayers.push(trueMarker);

    if (guesses) {
        Object.keys(guesses).forEach(pId => {
            const pGuess = guesses[pId];
            if (!pGuess || pGuess.isTimedOut) return; 

            const distance = calculateHaversineDistance(pGuess.lat, pGuess.lng, actualCoords.lat, actualCoords.lng);
            const isMe = pId === playerId;
            const color = isMe ? '#00e676' : '#29b6f6'; 

            const guessPin = L.circleMarker([pGuess.lat, pGuess.lng], {
                radius: 9, fillColor: color, color: '#fff', weight: 2, opacity: 1, fillOpacity: 0.8
            }).addTo(map).bindPopup(`<b>${isMe ? 'Your' : "Opponent's"} Guess</b><br>${Math.round(distance)} km away`);
            resultsLayers.push(guessPin);

            const line = L.polyline([[pGuess.lat, pGuess.lng], [actualCoords.lat, actualCoords.lng]], {
                color: color, weight: 4, dashArray: '5, 10'
            }).addTo(map);
            resultsLayers.push(line);
        });
    }

    trueMarker.openPopup();

    if (isHost && finalMyHp > 0 && finalEnemyHp > 0) {
        let nextRoundBtn = document.getElementById('btn-next-round');
        if (!nextRoundBtn) {
            nextRoundBtn = document.createElement('button');
            nextRoundBtn.id = 'btn-next-round';
            nextRoundBtn.innerText = "Next Round";
            nextRoundBtn.className = "global-next-round-btn";
            nextRoundBtn.onclick = window.startNextRound;
            document.getElementById('streetview-container').appendChild(nextRoundBtn);
        }
        nextRoundBtn.style.display = 'block';
    }
}

function triggerLaserProjectileCombatAnimation(myScore, enemyScore, startMyHp, finalMyHp, startEnemyHp, finalEnemyHp) {
    const projectile = document.getElementById('damage-projectile');
    const narrative = document.getElementById('combat-narrative');
    
    const myCard = document.querySelector('.lane.my-lane');
    const enemyCard = document.querySelector('.lane.enemy-lane');
    const netDamage = Math.abs(myScore - enemyScore);

    if (netDamage === 0) {
        narrative.innerText = "💥 PERFECT TIE! Structural grids locked.";
        setTimeout(() => dismissScorecardOverlayScreen(), 2500);
        return;
    }

    projectile.style.animation = 'none'; 
    projectile.offsetHeight; 
    projectile.style.display = 'block';

    if (myScore > enemyScore) {
        const isFinishingBlow = finalEnemyHp <= 0;
        narrative.innerHTML = isFinishingBlow ? `<span style="color:#ff1744; font-weight:900;">☠️ FINISHING BLOW!</span>` : `🔥 ADVANTAGE! Striking enemy for ${netDamage}!`;
        projectile.style.animation = 'fireRight 0.6s ease-in-out forwards';
        
        setTimeout(() => {
            projectile.style.display = 'none';
            if (enemyCard) enemyCard.classList.add('hurt-shake');
            
            const enemyPop = document.getElementById('enemy-damage-pop');
            enemyPop.innerText = `-${netDamage} HP`;
            enemyPop.classList.add('animate-damage-pop');

            document.getElementById('card-enemy-hp-running').innerText = `HP: ${finalEnemyHp}`;
            
            const enemyHpTxt = document.getElementById('enemy-hp-text');
            const enemyHpBar = document.getElementById('enemy-hp-bar');
            if (enemyHpTxt) enemyHpTxt.innerText = `${finalEnemyHp} / 5000`;
            if (enemyHpBar) enemyHpBar.style.width = `${(finalEnemyHp / 5000) * 100}%`;

            setTimeout(() => {
                if (enemyCard) enemyCard.classList.remove('hurt-shake');
                if (isFinishingBlow) triggerFinalMatchOverOverlayScreen(true);
                else dismissScorecardOverlayScreen();
            }, 1200);
        }, 600);
    } else {
        const isFinishingBlow = finalMyHp <= 0;
        narrative.innerHTML = isFinishingBlow ? `<span style="color:#ff1744; font-weight:900;">🚨 CRITICAL COLLAPSE!</span>` : `⚠️ IMPACT! Defensive barriers hit for ${netDamage}!`;
        projectile.style.animation = 'fireLeft 0.6s ease-in-out forwards';
        
        setTimeout(() => {
            projectile.style.display = 'none';
            if (myCard) myCard.classList.add('hurt-shake');
            
            const myPop = document.getElementById('my-damage-pop');
            myPop.innerText = `-${netDamage} HP`;
            myPop.classList.add('animate-damage-pop');

            document.getElementById('card-my-hp-running').innerText = `HP: ${finalMyHp}`;
            
            const myHpTxt = document.getElementById('my-hp-text');
            const myHpBar = document.getElementById('my-hp-bar');
            if (myHpTxt) myHpTxt.innerText = `${finalMyHp} / 5000`;
            if (myHpBar) myHpBar.style.width = `${(finalMyHp / 5000) * 100}%`;

            setTimeout(() => {
                if (myCard) myCard.classList.remove('hurt-shake');
                if (isFinishingBlow) triggerFinalMatchOverOverlayScreen(false);
                else dismissScorecardOverlayScreen();
            }, 1200);
        }, 600);
    }
}

function triggerFinalMatchOverOverlayScreen(didIWin) {
    const overlayScore = document.getElementById('battle-scorecard-overlay');
    overlayScore.style.display = "none";
    const mainOverlayMenu = document.getElementById('menu-overlay');
    mainOverlayMenu.style.opacity = '1';
    mainOverlayMenu.style.visibility = 'visible';
    document.getElementById('lobby-waiting-status').style.display = 'none';
    
    const titleNode = document.querySelector('#menu-overlay h1');
    const subNode = document.querySelector('.menu-subtitle');
    
    if (didIWin) {
        titleNode.innerHTML = "🏆 MATCH VICTORY!";
        subNode.innerHTML = `<span style="color:#00e676; font-weight:bold;">KNOCKOUT!</span> Target neutralized.`;
    } else {
        titleNode.innerHTML = "💀 MATCH DEFEAT";
        subNode.innerHTML = `<span style="color:#ff1744; font-weight:bold;">ELIMINATED!</span> Barriers flattened.`;
    }
}

function dismissScorecardOverlayScreen() {
    setTimeout(() => {
        const overlay = document.getElementById('battle-scorecard-overlay');
        overlay.style.display = "none";
    }, 1500);
}

function calculateHaversineDistance(lat1, lon1, lat2, lon2) {
    const R = 6371; 
    const dLat = (lat2 - lat1) * Math.PI / 180;
    const dLon = (lon2 - lon1) * Math.PI / 180;
    const a = Math.sin(dLat / 2) * Math.sin(dLat / 2) +
              Math.cos(lat1 * Math.PI / 180) * Math.cos(lat2 * Math.PI / 180) * Math.sin(dLon / 2) * Math.sin(dLon / 2);
    const c = 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
    return R * c; 
}

function computeGeoGuessrScore(distanceInKm) {
    const score = 5000 * Math.exp(-distanceInKm / 2000);
    return Math.max(0, Math.round(score));
}

window.startNextRound = function() {
    if (!currentRoomId || !isHost) return;
    const randomIndex = Math.floor(Math.random() * gameLocations.length);
    const nextTarget = gameLocations[randomIndex];

    const updates = {};
    updates[`rooms/${currentRoomId}/targetLocation`] = nextTarget;
    updates[`rooms/${currentRoomId}/guesses`] = {}; 
    updates[`rooms/${currentRoomId}/skipVotes`] = {}; 
    updates[`rooms/${currentRoomId}/panicTriggered`] = false;
    updates[`rooms/${currentRoomId}/timerStartTime`] = serverTimestamp();
    updates[`rooms/${currentRoomId}/timerDuration`] = 60;
    updates[`rooms/${currentRoomId}/gameState`] = "playing";

    update(ref(db), updates).catch(err => console.error(err));
};

window.toggleMobileMapDrawer = function() {
    const container = document.getElementById('map-container');
    if(container.classList.contains('mobile-expanded')) {
        container.classList.remove('mobile-expanded');
    } else {
        container.classList.add('mobile-expanded');
    }
    setTimeout(() => { if(map) map.invalidateSize(); }, 300);
}

window.onload = initMap;