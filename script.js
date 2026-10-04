let movies = [];
let viewedMovies = new Set();
let currentSynopsisText = "";

async function loadMoviesDatabase() {
    try {
        const response = await fetch('movies.txt');
        const text = await response.text();
        
        const lines = text.split('\n');
        const parsedMovies = [];

        for (let line of lines) {
            let cleanLine = line.trim();

            if (cleanLine.startsWith('-')) {
                cleanLine = cleanLine.replace(/^-\s*/, '');
            }

            const match = cleanLine.match(/^(.*?)\s+(\d{4})$/);
            if (match) {
                parsedMovies.push({
                    title: match[1].trim(),
                    year: match[2]
                });
            }
        }

        movies = Array.from(new Set(parsedMovies.map(m => JSON.stringify(m)))).map(m => JSON.parse(m));

        if (movies.length > 0) {
            pickRandomMovie();
        } else {
            document.getElementById('movieTitle').innerText = "Database Empty";
            hideLoaders();
            document.getElementById('movieSynopsis').innerText = "No movies matching the 'Title YYYY' format were found in movies.txt.";
        }
    } catch (error) {
        document.getElementById('movieTitle').innerText = "Loading Error";
        hideLoaders();
        document.getElementById('movieSynopsis').innerText = "Could not load movies.txt. Make sure you are running this through a local server (like Live Server in VS Code).";
    }
}

async function pickRandomMovie() {
    if (movies.length === 0) return;

    // Stop any active speech when switching movies
    stopSpeech();

    // Smooth scroll back to top on mobile when picking a new movie
    window.scrollTo({ top: 0, behavior: 'smooth' });

    // Filter out movies already viewed in this session
    let availableMovies = movies.filter(m => !viewedMovies.has(`${m.title} (${m.year})`));

    // If all movies have been viewed, reset the session tracker
    if (availableMovies.length === 0) {
        viewedMovies.clear();
        availableMovies = [...movies];
    }

    const randomMovie = availableMovies[Math.floor(Math.random() * availableMovies.length)];
    viewedMovies.add(`${randomMovie.title} (${randomMovie.year})`);
    
    document.getElementById('movieTitle').innerText = randomMovie.title;
    document.getElementById('movieYear').innerText = randomMovie.year ? `Released: ${randomMovie.year}` : '';
    
    // Show loading animations and hide speech button temporarily
    showLoaders();
    
    const posterImg = document.getElementById('moviePoster');
    const bgBackdrop = document.getElementById('bgBackdrop');
    
    posterImg.src = "";
    posterImg.style.display = "none";
    bgBackdrop.style.backgroundImage = "none";

    try {
        const query = encodeURIComponent(`${randomMovie.title} ${randomMovie.year}`);
        const res = await fetch(`https://en.wikipedia.org/w/api.php?action=query&list=search&srsearch=${query}&format=json&origin=*`);
        const data = await res.json();
        
        if (data.query && data.query.search.length > 0) {
            const pageTitle = data.query.search[0].title;
            const summaryRes = await fetch(`https://en.wikipedia.org/api/rest_v1/page/summary/${encodeURIComponent(pageTitle)}`);
            const summaryData = await summaryRes.json();

            hideLoaders();

            if (summaryData.extract) {
                currentSynopsisText = summaryData.extract;
                document.getElementById('movieSynopsis').innerText = currentSynopsisText;
            } else {
                currentSynopsisText = "No detailed synopsis available for this selection.";
                document.getElementById('movieSynopsis').innerText = currentSynopsisText;
            }

            if (summaryData.thumbnail && summaryData.thumbnail.source) {
                const posterUrl = summaryData.thumbnail.source;
                applyPoster(posterUrl);
            } else {
                setDefaultPoster(randomMovie.title);
            }
        } else {
            hideLoaders();
            currentSynopsisText = "Synopsis could not be found automatically for this title.";
            document.getElementById('movieSynopsis').innerText = currentSynopsisText;
            setDefaultPoster(randomMovie.title);
        }
    } catch (error) {
        hideLoaders();
        currentSynopsisText = "Could not load data connection. Try clicking reload again!";
        document.getElementById('movieSynopsis').innerText = currentSynopsisText;
        setDefaultPoster(randomMovie.title);
    }
}

function showLoaders() {
    document.getElementById('posterLoader').style.display = 'flex';
    document.getElementById('moviePoster').style.display = 'none';
    document.getElementById('speakBtn').style.display = 'none';
    
    const synopsisContainer = document.getElementById('movieSynopsis');
    synopsisContainer.innerHTML = `
        <span id="synopsisLoader" class="loader-container inline-loader">
            <span class="dot-pulse"></span>
        </span>
    `;
}

function hideLoaders() {
    document.getElementById('posterLoader').style.display = 'none';
    document.getElementById('moviePoster').style.display = 'block';
    document.getElementById('speakBtn').style.display = 'inline-block';
    
    const synopsisLoader = document.getElementById('synopsisLoader');
    if (synopsisLoader) {
        synopsisLoader.remove();
    }
}

function applyPoster(url) {
    const posterImg = document.getElementById('moviePoster');
    const bgBackdrop = document.getElementById('bgBackdrop');
    
    posterImg.src = url;
    bgBackdrop.style.backgroundImage = `url("${url}")`;
}

function setDefaultPoster(title) {
    const fallback = `https://via.placeholder.com/300x450/222/fff?text=${encodeURIComponent(title)}`;
    applyPoster(fallback);
}

// Text-to-Speech logic for Irish Female Voice at 20% rate
let isSpeaking = false;

function toggleSpeech() {
    if (!('speechSynthesis' in window)) {
        alert("Text-to-speech is not supported in your browser.");
        return;
    }

    const speakBtn = document.getElementById('speakBtn');

    if (isSpeaking) {
        stopSpeech();
        return;
    }

    if (!currentSynopsisText) return;

    const utterance = new SpeechSynthesisUtterance(currentSynopsisText);
    utterance.rate = 0.2; // 20% speaking rate

    // Look for Irish Female voice (en-IE)
    const voices = window.speechSynthesis.getVoices();
    let selectedVoice = voices.find(v => v.lang.includes('en-IE') && (v.name.toLowerCase().includes('female') || v.name.toLowerCase().includes('moira') || v.name.toLowerCase().includes('ora')));
    
    // Fallback to any en-IE voice
    if (!selectedVoice) {
        selectedVoice = voices.find(v => v.lang.includes('en-IE'));
    }
    // Fallback to any English female voice
    if (!selectedVoice) {
        selectedVoice = voices.find(v => v.lang.startsWith('en') && (v.name.toLowerCase().includes('female') || v.name.toLowerCase().includes('woman')));
    }

    if (selectedVoice) {
        utterance.voice = selectedVoice;
    }

    utterance.onstart = () => {
        isSpeaking = true;
        speakBtn.classList.add('speaking');
        speakBtn.innerText = "⏹ Stop Reading";
    };

    utterance.onend = () => {
        stopSpeech();
    };

    utterance.onerror = () => {
        stopSpeech();
    };

    window.speechSynthesis.speak(utterance);
}

function stopSpeech() {
    if ('speechSynthesis' in window) {
        window.speechSynthesis.cancel();
    }
    isSpeaking = false;
    const speakBtn = document.getElementById('speakBtn');
    if (speakBtn) {
        speakBtn.classList.remove('speaking');
        speakBtn.innerText = "🔊 Read Synopsis";
    }
}

// Preload voices if available
if ('speechSynthesis' in window) {
    window.speechSynthesis.onvoiceschanged = () => {
        window.speechSynthesis.getVoices();
    };
}

window.onload = loadMoviesDatabase;