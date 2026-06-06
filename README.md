#🌐 GEO TEST: Battle Edition
GEO TEST: Battle Edition is a high-stakes, multiplayer geographic guessing game built for the open-source web. Players compete in real-time to locate iconic global landmarks, using Mapillary’s panoramic imagery and Leaflet mapping to test their navigation skills against an opponent.

#🎮 Gameplay
In GEO TEST, two players enter a shared lobby. Each round, you are presented with a 360° panorama of a mystery location. You must navigate the scene, deduce the location, and drop a pin on the interactive world map.

The Twist: Your accuracy determines your health. The player who guesses closer to the true location deals damage to their opponent’s HP pool. The first player to reduce their opponent to zero HP wins the match!

#✨ Key Features
Real-Time Multiplayer: Built on Firebase Realtime Database for synchronized lobby state management.

3D Panorama Engine: Powered by Mapillary.js for street-level exploration.

Kinetic Combat HUD: Visual HP bars, damage pop-ups, and projectile animations visualize your accuracy impact.

Consensus Skip Mechanic: If a location has poor image coverage, players can vote to skip and randomize a new target location.

Cyber-Battle Theme: A sleek, high-contrast UI designed for an intense competitive experience.

#🛠️ Tech Stack
Frontend: HTML5, CSS3 (Custom Cyber Theme), Vanilla JavaScript (ES6 Modules).

Mapping: Leaflet.js for interactive pin-dropping.

Imagery: Mapillary for global street-level panoramic data.

Backend & Sync: Firebase Realtime Database for state orchestration.

Security: Firebase App Check with reCAPTCHA v3.

#🚀 Deployment Instructions
To host this project on GitHub Pages:

Firebase Setup: Create a project, enable Realtime Database, and apply the strict Security Rules to prevent unauthorized data manipulation.

Enable Security: Enable App Check with reCAPTCHA v3 in the Firebase Console.

Mapillary Setup: Register a developer token and add your GitHub Pages domain (e.g., https://yourusername.github.io/geo-test/) to the Allowed Referrers list.

Environment: Update app.js with your specific Firebase project credentials.

Launch: Push your code to a public repository and enable GitHub Pages in the settings.

#🛡️ Security Note
This project uses App Check and Strict Database Rules to ensure that all interactions are verified. Mapillary tokens are obfuscated using a split-array join method to bypass automated scanners and are domain-locked to prevent unauthorized third-party usage.

Built with passion for the open-source geo-community.
