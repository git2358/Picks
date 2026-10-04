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

    stopSpeech();
    window.scrollTo({ top: 0, behavior: 'smooth' });

    let availableMovies = movies.filter(m => !viewedMovies.has(`${m.title} (${m.year})`));

    if (availableMovies.length === 0) {
        viewedMovies.clear();
        availableMovies = [...movies];
    }

    const randomMovie = availableMovies[Math.floor(Math.random() * availableMovies.length)];
    viewedMovies.add(`${randomMovie.title} (${randomMovie.year})`);
    
    document.getElementById('movieTitle').innerText = randomMovie.title;
    // Removed "Released: " prefix, showing only the year
    document.getElementById('movieYear').innerText = randomMovie.year ? randomMovie.year : '';
    
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

// Text-to-Speech logic: 5% faster (1.05), perky pitch (1.2), using available female voice without forced regional accent locks
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
    utterance.rate = 1.05;  // 5% faster than normal speed
    utterance.pitch = 1.2;  // Perky, bright pitch

    const voices = window.speechSynthesis.getVoices();
    
    // Look for any standard English female voice available on the user's system
    let selectedVoice = voices.find(v => 
        v.lang.startsWith('en') && 
        (v.name.toLowerCase().includes('female') || v.name.toLowerCase().includes('woman') || v.name.toLowerCase().includes('samantha') || v.name.toLowerCase().includes('karen') || v.name.toLowerCase().includes('victoria') || v.name.toLowerCase().includes('zira') || v.name.toLowerCase().includes('hazel'))
    );
    
    // Fallback to the first available English voice if no specific female keyword matches
    if (!selectedVoice) {
        selectedVoice = voices.find(v => v.lang.startsWith('en'));
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

if ('speechSynthesis' in window) {
    window.speechSynthesis.onvoiceschanged = () => {
        window.speechSynthesis.getVoices();
    };
}

window.onload = loadMoviesDatabase;
