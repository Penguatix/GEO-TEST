import { initializeApp } from "https://www.gstatic.com/firebasejs/10.8.0/firebase-app.js";
import { getDatabase, ref, set, onValue, update } from "https://www.gstatic.com/firebasejs/10.8.0/firebase-database.js";
// import { initializeAppCheck, ReCaptchaV3Provider } from "https://www.gstatic.com/firebasejs/10.8.0/firebase-app-check.js";

// Config configuration
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

// Initialize Firebase
const app = initializeApp(firebaseConfig);
const db = getDatabase(app);

// NEW: ACTIVATE PUBLIC ATTIDUDINAL APP CHECK CHECKSUM GATE
// const appCheck = initializeAppCheck(app, {
//     provider: new ReCaptchaV3Provider('6LeQHRAtAAAAAJMGvjg5CxEiVJ_9MTspWKvkVCeu'),
//     isTokenAutoRefreshEnabled: true // Automatically updates token keys invisibly mid-game session
// });

let map, guessMarker, mlyViewer;
let currentRoomId = "";
let playerId = "player_" + Math.floor(Math.random() * 1000); // Simple random ID for testing
let selectedCoords = null;
let actualCoords = null;
let resultsLayers = []; // Tracking container to clear lines/pins on new rounds
let isHost = false; // Flag to trace who runs global HP drainage updates

// Pool of global location metrics
const gameLocations = [
    { name: "Rome Colosseum", lat: 41.8902, lng: 12.4922 },
    { name: "Eiffel Tower", lat: 48.8584, lng: 2.2945 },
    { name: "Times Square", lat: 40.7580, lng: -73.9855 },
    { name: "Taj Mahal", lat: 27.1751, lng: 78.0421 },
    { name: "Sydney Opera House", lat: -33.8568, lng: 151.2153 },
    { name: "Pyramids of Giza", lat: 29.9792, lng: 31.1342 },
    { name: "Golden Gate Bridge", lat: 37.8199, lng: -122.4783 }
];

// Initialize the free Leaflet Guess Map
function initMap() {
    map = L.map('map').setView([20, 0], 2);
    L.tileLayer('https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png', {
        attribution: '© OpenStreetMap contributors'
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

// 1. CREATE A ROOM
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

// 2. JOIN A ROOM
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
        updates[`rooms/${roomId}/playerHealths/guestId`] = playerId;
        updates[`rooms/${roomId}/playerHealths/${playerId}`] = 5000;

        update(ref(db), updates).then(() => {
            listenToRoom(roomId);
        });
    }, { onlyOnce: true });
}

// 3. LISTEN TO LIVE MULTIPLAYER CHANGES
let loadedTargetName = ""; 

function listenToRoom(roomId) {
    onValue(ref(db, 'rooms/' + roomId), (snapshot) => {
        const data = snapshot.val();
        if (!data) return;

        if (data.gameState === "playing" && data.guesses && Object.keys(data.guesses).length > 0) {
            if (Object.keys(data.guesses).length < 2) return;
        }

        actualCoords = { lat: data.targetLocation.lat, lng: data.targetLocation.lng };

        // Process Interactive HUD gauges ONLY on regular states
        // FIXED CHECK: We removed short-circuit returns here so the reveal screen can process final hits!
        if (data.gameState === "waiting" || data.gameState === "playing") {
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

        // Live monitor skip ballot box counts
        if (data.gameState === "playing") {
            document.getElementById('skip-hud').style.display = 'flex'; 
            const currentVotesCount = data.skipVotes ? Object.keys(data.skipVotes).length : 0;
            document.getElementById('skip-vote-counter').innerText = `Votes: ${currentVotesCount} / 2`;

            if (data.skipVotes && data.skipVotes[playerId]) {
                const voteBtn = document.getElementById('btn-vote-skip');
                voteBtn.disabled = true;
                voteBtn.innerText = "⏳ Voted to Skip";
            }

            if (currentVotesCount === 2 && isHost) {
                executeHostSkipRelocation();
                return; 
            }
        } else {
            document.getElementById('skip-hud').style.display = 'none';
        }

        // STATE A: ACTIVE ROUND RUNNING
        if (data.gameState === "playing") {
            document.getElementById('menu-overlay').style.opacity = '0';
            document.getElementById('menu-overlay').style.visibility = 'hidden';
            document.getElementById('battle-scorecard-overlay').style.display = 'none'; 
            document.getElementById('battle-hud').style.display = 'flex';

            if (resultsLayers.length > 0 || document.getElementById('btn-guess').getAttribute('data-submitted') === 'true') {
                resultsLayers.forEach(layer => map.removeLayer(layer));
                resultsLayers = [];
                if (guessMarker) { map.removeLayer(guessMarker); guessMarker = null; }
                selectedCoords = null;
                
                const guessBtn = document.getElementById('btn-guess');
                guessBtn.disabled = true;
                guessBtn.removeAttribute('data-submitted');
            }

            const nextRoundBtn = document.getElementById('btn-next-round');
            if (nextRoundBtn) nextRoundBtn.style.display = 'none';

            if (loadedTargetName !== data.targetLocation.name) {
                loadedTargetName = data.targetLocation.name; 

                const voteBtn = document.getElementById('btn-vote-skip');
                voteBtn.disabled = false;
                voteBtn.innerText = "🔄 Vote to Skip Location";

                if (mlyViewer) {
                    try { mlyViewer.remove(); } catch(e) {}
                    mlyViewer = null;
                }

                setTimeout(() => {
                    const fetchWithFallbackRadius = (radiusSize) => {
                        const token = ['MLY', '27009972391994261', '636862a07870af0060407d2b511a95bf'].join('|');
                        const url = `https://graph.mapillary.com/images?access_token=${token}&fields=id&lat=${actualCoords.lat}&lng=${actualCoords.lng}&radius=${radiusSize}&limit=1`;

                        fetch(url)
                            .then(response => response.json())
                            .then(result => {
                                if (!result.data || result.data.length === 0) {
                                    if (radiusSize === 50) { fetchWithFallbackRadius(250); } 
                                    else if (radiusSize === 250) { fetchWithFallbackRadius(1000); } 
                                    else { throw new Error("No available imagery found near coordinates."); }
                                    return;
                                }

                                const targetImageId = result.data[0].id;
                                document.getElementById('status-msg').innerText = "Game Active! Find the location and guess!";
                                
                                mlyViewer = new mapillary.Viewer({
                                    container: 'mly',
                                    accessToken: token,
                                    imageId: targetImageId
                                });
                                
                                setTimeout(() => { mlyViewer.resize(); }, 50);
                            })
                            .catch(err => {
                                console.error("Mapillary Fallback Error:", err);
                                document.getElementById('status-msg').innerText = "Location lookup failed! Use Vote to Skip Button above.";
                            });
                    };

                    fetchWithFallbackRadius(50);
                }, 200); 
            }
        }

        // STATE B: BOTH GUESSES COMMITTED - TRIGGER COMBAT EVALUATION (Host Only)
        if (data.gameState === "playing" && data.guesses && Object.keys(data.guesses).length === 2) {
            processCombatDamageEvaluation(data);
        }

        // STATE C: SCOREBOARD REVEAL CYCLE RUNNING
        if (data.gameState === "revealed" && data.guesses && Object.keys(data.guesses).length === 2) {
            renderVisualResultsOnly(data, data.guesses);
        }
    });
}

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
    updates[`rooms/${currentRoomId}/gameState`] = "playing";

    update(ref(db), updates).catch(err => console.error("Skip failed:", err));
}

// 4. SUBMIT GUESS TO FIREBASE
window.submitGuess = function() {
    if (!selectedCoords || !currentRoomId) return;

    document.getElementById('btn-guess').disabled = true;
    document.getElementById('btn-guess').setAttribute('data-submitted', 'true');
    document.getElementById('status-msg').innerText = "Guess submitted! Waiting for opponent...";

    set(ref(db, `rooms/${currentRoomId}/guesses/${playerId}`), {
        lat: selectedCoords.lat,
        lng: selectedCoords.lng
    });
}

function processCombatDamageEvaluation(roomData) {
    if (!isHost) return; 

    update(ref(db), { [`rooms/${currentRoomId}/gameState`]: "processing" }).then(() => {
        const pIds = Object.keys(roomData.guesses);
        const playerScores = {};

        pIds.forEach(id => {
            const guess = roomData.guesses[id];
            const dist = calculateHaversineDistance(guess.lat, guess.lng, roomData.targetLocation.lat, roomData.targetLocation.lng);
            playerScores[id] = computeGeoGuessrScore(dist);
        });

        const p1 = pIds[0];
        const p2 = pIds[1];
        
        let currentHp1 = roomData.playerHealths[p1];
        let currentHp2 = roomData.playerHealths[p2];

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

        update(ref(db), updates);
    });
}

// 5. ANIMATED SCOREBOARD AND COMBAT SEQUENCER
function renderVisualResultsOnly(roomData, guesses) {
    if (resultsLayers.length > 0) return;

    const myGuess = guesses[playerId];
    const oppId = Object.keys(guesses).find(id => id !== playerId);
    const enemyGuess = guesses[oppId];

    const myDistance = calculateHaversineDistance(myGuess.lat, myGuess.lng, actualCoords.lat, actualCoords.lng);
    const enemyDistance = enemyGuess ? calculateHaversineDistance(enemyGuess.lat, enemyGuess.lng, actualCoords.lat, actualCoords.lng) : 20037;

    const myScore = computeGeoGuessrScore(myDistance);
    const enemyScore = enemyGuess ? computeGeoGuessrScore(enemyDistance) : 0;

    const finalMyHp = roomData.playerHealths[playerId] !== undefined ? roomData.playerHealths[playerId] : 5000;
    const finalEnemyHp = (oppId && roomData.playerHealths[oppId] !== undefined) ? roomData.playerHealths[oppId] : 5000;

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

    document.getElementById('card-my-dist').innerText = `${Math.round(myDistance)} km away`;
    document.getElementById('card-enemy-dist').innerText = enemyGuess ? `${Math.round(enemyDistance)} km away` : "No guess";
    
    document.getElementById('combat-narrative').innerText = "Calculating accuracy tracks...";

    let currentTick = 0;
    const tickDuration = 60; 
    const interval = setInterval(() => {
        currentTick++;
        const ratio = currentTick / tickDuration;
        
        document.getElementById('card-my-score').innerText = Math.round(myScore * ratio);
        document.getElementById('card-enemy-score').innerText = Math.round(enemyScore * ratio);

        if (currentTick >= tickDuration) {
            clearInterval(interval);
            // FIXED REDIRECT: Health parameters pass straight down into the sequencer
            triggerLaserProjectileCombatAnimation(myScore, enemyScore, startMyHp, finalMyHp, startEnemyHp, finalEnemyHp);
        }
    }, 25);

    const trueMarker = L.circleMarker([actualCoords.lat, actualCoords.lng], {
        radius: 12, fillColor: '#ff1744', color: '#fff', weight: 3, opacity: 1, fillOpacity: 0.9, zIndexOffset: 1000
    }).addTo(map).bindPopup("<b>Target Location</b>");
    resultsLayers.push(trueMarker);

    let summaryText = "Round Over! Combats: ";

    Object.keys(guesses).forEach(pId => {
        const pGuess = guesses[pId];
        const distance = calculateHaversineDistance(pGuess.lat, pGuess.lng, actualCoords.lat, actualCoords.lng);
        const score = computeGeoGuessrScore(distance);

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

        summaryText += `${isMe ? 'You' : 'Opponent'}: ${score} pts (${Math.round(distance)}km) | `;
    });

    document.getElementById('status-msg').innerText = summaryText;
    trueMarker.openPopup();

    // Only allow the "Next Round" button to mount if BOTH players have surviving health points remaining
    if (isHost && finalMyHp > 0 && finalEnemyHp > 0) {
        let nextRoundBtn = document.getElementById('btn-next-round');
        if (!nextRoundBtn) {
            nextRoundBtn = document.createElement('button');
            nextRoundBtn.id = 'btn-next-round';
            nextRoundBtn.innerText = "Next Round";
            nextRoundBtn.style.cssText = "position:absolute; top:15px; right:15px; z-index:100; padding:12px 24px; background:#007bff; color:white; border:none; border-radius:6px; font-weight:bold; cursor:pointer; box-shadow:0 4px 15px rgba(0,0,0,0.3);";
            nextRoundBtn.onclick = window.startNextRound;
            document.getElementById('streetview-container').appendChild(nextRoundBtn);
        }
        nextRoundBtn.style.display = 'block';
    }
}

// E. Kinetic Projectile Combat Animation Controller (NOW HANDLES CINEMATIC FINISHING BLOWS)
function triggerLaserProjectileCombatAnimation(myScore, enemyScore, startMyHp, finalMyHp, startEnemyHp, finalEnemyHp) {
    const projectile = document.getElementById('damage-projectile');
    const narrative = document.getElementById('combat-narrative');
    
    const myCard = document.querySelector('.my-lane');
    const enemyCard = document.querySelector('.enemy-lane');

    const netDamage = Math.abs(myScore - enemyScore);

    if (netDamage === 0) {
        narrative.innerText = "💥 PERFECT TIE! Absolute gridlock blocks all structural damage.";
        setTimeout(() => dismissScorecardOverlayScreen(), 2500);
        return;
    }

    projectile.style.animation = 'none'; 
    projectile.offsetHeight; 
    projectile.style.display = 'block';

    if (myScore > enemyScore) {
        // Checking if this specific blow completely finishes the match
        const isFinishingBlow = finalEnemyHp <= 0;
        narrative.innerHTML = isFinishingBlow ? 
            `<span style="color:#ff1744; font-size:1.4rem; font-weight:900; animation:spin 0.5s infinite;">☠️ FINISHING BLOW!</span> Pounding enemy with ${netDamage} FATAL points!` : 
            `🔥 ACCURACY ADVANTAGE! Launching ${netDamage} damage points at enemy!`;
            
        projectile.style.animation = 'fireRight 0.8s ease-in-out forwards';
        
        setTimeout(() => {
            projectile.style.display = 'none';
            enemyCard.classList.add('hurt-shake');
            narrative.innerText = isFinishingBlow ? "💥 FATALITY! Enemy health has been completely vaporized!" : `💥 BOOM! Enemy health pool lost ${netDamage} HP!`;
            
            const enemyPop = document.getElementById('enemy-damage-pop');
            enemyPop.innerText = `-${netDamage} HP`;
            enemyPop.classList.add('animate-damage-pop');

            let hpTick = 0;
            const hpSteps = 40;
            const hpInterval = setInterval(() => {
                hpTick++;
                const ratio = hpTick / hpSteps;
                const currentTickHp = Math.round(startEnemyHp - (netDamage * ratio));
                document.getElementById('card-enemy-hp-running').innerText = `HP: ${Math.max(finalEnemyHp, currentTickHp)}`;
                
                if (hpTick >= hpSteps) { clearInterval(hpInterval); }
            }, 20);

            document.getElementById('enemy-hp-text').innerText = `${finalEnemyHp} / 5000`;
            document.getElementById('enemy-hp-bar').style.width = `${(finalEnemyHp / 5000) * 100}%`;

            setTimeout(() => {
                enemyCard.classList.remove('hurt-shake');
                if (isFinishingBlow) {
                    triggerFinalMatchOverOverlayScreen(true); // You won!
                } else {
                    dismissScorecardOverlayScreen();
                }
            }, 1200);
        }, 800);
    } else {
        const isFinishingBlow = finalMyHp <= 0;
        narrative.innerHTML = isFinishingBlow ? 
            `<span style="color:#ff1744; font-size:1.4rem; font-weight:900;">🚨 CRITICAL FINISHER!</span> Defensive barrier collapsing, taking ${netDamage} fatal points!` : 
            `⚠️ INCOMING ASSAULT! Taking ${netDamage} impact damage points!`;
            
        projectile.style.animation = 'fireLeft 0.8s ease-in-out forwards';
        
        setTimeout(() => {
            projectile.style.display = 'none';
            myCard.classList.add('hurt-shake');
            narrative.innerText = isFinishingBlow ? "💥 WIPEOUT! Your map HP dropped down to zero!" : `💥 IMPACT! Your health pool lost ${netDamage} HP!`;
            
            const myPop = document.getElementById('my-damage-pop');
            myPop.innerText = `-${netDamage} HP`;
            myPop.classList.add('animate-damage-pop');

            let hpTick = 0;
            const hpSteps = 40;
            const hpInterval = setInterval(() => {
                hpTick++;
                const ratio = hpTick / hpSteps;
                const currentTickHp = Math.round(startMyHp - (netDamage * ratio));
                document.getElementById('card-my-hp-running').innerText = `HP: ${Math.max(finalMyHp, currentTickHp)}`;
                
                if (hpTick >= hpSteps) { clearInterval(hpInterval); }
            }, 20);

            document.getElementById('my-hp-text').innerText = `${finalMyHp} / 5000`;
            document.getElementById('my-hp-bar').style.width = `${(finalMyHp / 5000) * 100}%`;

            setTimeout(() => {
                myCard.classList.remove('hurt-shake');
                if (isFinishingBlow) {
                    triggerFinalMatchOverOverlayScreen(false); // You lost!
                } else {
                    dismissScorecardOverlayScreen();
                }
            }, 1200);
        }, 800);
    }
}

// F. SEQUENTIAL MATCH-OVER OVERLAY DISPATCHER
function triggerFinalMatchOverOverlayScreen(didIWin) {
    // Fade the face-off scoreboard away gracefully
    const overlayScore = document.getElementById('battle-scorecard-overlay');
    overlayScore.style.transition = "opacity 0.4s ease";
    overlayScore.style.opacity = "0";
    
    setTimeout(() => {
        overlayScore.style.display = "none";
        overlayScore.style.opacity = "1"; // Reset reference container structures cleanly

        // Force launch the primary main menu layout wrapped into your custom win styles
        const mainOverlayMenu = document.getElementById('menu-overlay');
        mainOverlayMenu.style.opacity = '1';
        mainOverlayMenu.style.visibility = 'visible';
        document.getElementById('lobby-waiting-status').style.display = 'none';
        
        const titleNode = document.querySelector('#menu-overlay h1');
        const subNode = document.querySelector('.menu-subtitle');
        
        if (didIWin) {
            titleNode.innerHTML = "🏆 MATCH VICTORY!";
            subNode.innerHTML = `<span style="color:#00e676; font-size:1.2rem; font-weight:bold;">KNOCKOUT!</span> You systematically drained your enemy's HP bar to absolute zero!`;
        } else {
            titleNode.innerHTML = "💀 MATCH DEFEAT";
            subNode.innerHTML = `<span style="color:#ff1744; font-size:1.2rem; font-weight:bold;">ELIMINATED!</span> Your health bar flatlined. Re-host a room to take revenge!`;
        }
    }, 400);
}

function dismissScorecardOverlayScreen() {
    setTimeout(() => {
        const overlay = document.getElementById('battle-scorecard-overlay');
        overlay.style.transition = "opacity 0.4s ease";
        overlay.style.opacity = "0";
        setTimeout(() => {
            overlay.style.display = "none";
            overlay.style.opacity = "1"; 
        }, 400);
    }, 1500);
}

// Distance Calculation Helpers
function calculateHaversineDistance(lat1, lon1, lat2, lon2) {
    const R = 6371; 
    const dLat = (lat2 - lat1) * Math.PI / 180;
    const dLon = (lon2 - lon1) * Math.PI / 180;
    const a = Math.sin(dLat / 2) * Math.sin(dLat / 2) +
              Math.cos(lat1 * Math.PI / 180) * Math.cos(lat2 * Math.PI / 180) * Math.sin(dLon / 2) * Math.sin(dLon / 2);
    const c = 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
    return R * c; 
}

// Score Calculation
function computeGeoGuessrScore(distanceInKm) {
    const maxScore = 5000;
    const scalingFactor = 2000; 
    const score = maxScore * Math.exp(-distanceInKm / scalingFactor);
    return Math.max(0, Math.round(score));
}

// 6. START NEXT ROUND
window.startNextRound = function() {
    if (!currentRoomId || !isHost) return;
    
    const randomIndex = Math.floor(Math.random() * gameLocations.length);
    const nextTarget = gameLocations[randomIndex];

    onValue(ref(db, 'rooms/' + currentRoomId), (snapshot) => {
        const data = snapshot.val();
        if (!data) return;

        const updates = {};
        updates[`rooms/${currentRoomId}/targetLocation`] = nextTarget;
        updates[`rooms/${currentRoomId}/guesses`] = {}; 
        updates[`rooms/${currentRoomId}/skipVotes`] = {}; 
        updates[`rooms/${currentRoomId}/gameState`] = "playing";

        update(ref(db), updates).catch(err => {
            console.error("Round Reset Transaction Failed:", err);
        });
    }, { onlyOnce: true });
};

window.onload = initMap;
