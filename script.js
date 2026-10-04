let movies = [];
let watchedIndices = [];
let currentMovie = null;
let isSpeaking = false;

async function loadMoviesDatabase() {
    try {
        const response = await fetch('movies.txt');
        if (!response.ok) {
            throw new Error(`HTTP error! status: ${response.status}`);
        }
        const text = await response.text();
        
        movies = text.split(/\r?\n/)
            .map(line => line.trim())
            .filter(line => line.length > 0 && !line.startsWith('#'));

        if (movies.length === 0) {
            document.getElementById('movieTitle').innerText = "No Movies Found";
            document.getElementById('movieSynopsis').innerText = "Please add items to your movies.txt file!";
            return;
        }

        await fetchNextMovie(true);
    } catch (error) {
        console.error("Error loading movies.txt:", error);
        document.getElementById('movieTitle').innerText = "Error Loading File";
        document.getElementById('movieSynopsis').innerText = "Make sure you are running via a local web server (like VS Code Live Server) so movies.txt can be read correctly.";
    }
}

async function fetchNextMovie(isInitial = false) {
    if (watchedIndices.length >= movies.length) {
        // Scroll to top first when reaching the end
        window.scrollTo({ top: 0, behavior: 'smooth' });
        const synopsisArea = document.querySelector('.synopsis-scroll-area');
        if (synopsisArea) {
            synopsisArea.scrollTop = 0;
        }

        // Fade in spotlight and close curtains
        document.getElementById('curtainOverlay').classList.remove('open');
        stopSpeech();
        
        // Wait for fade and curtains to fully close (1 second) before showing the wrap message
        await new Promise(resolve => setTimeout(resolve, 1000));
        document.getElementById('curtainOverlay').classList.add('show-spotlight');
        document.getElementById('reloadBtn').style.display = 'none';
        return;
    }

    if (!isInitial) {
        // 1. Scroll back to top & fade in spotlight simultaneously
        window.scrollTo({ top: 0, behavior: 'smooth' });
        const synopsisArea = document.querySelector('.synopsis-scroll-area');
        if (synopsisArea) {
            synopsisArea.scrollTop = 0;
        }

        // Close curtains & stop speech
        document.getElementById('curtainOverlay').classList.remove('open');
        stopSpeech();
        
        // Wait for spotlight to fade in and curtains to close
        await new Promise(resolve => setTimeout(resolve, 1000));
    }

    let randomIndex;
    do {
        randomIndex = Math.floor(Math.random() * movies.length);
    } while (watchedIndices.includes(randomIndex));

    watchedIndices.push(randomIndex);
    let rawLine = movies[randomIndex];

    let cleaned = rawLine.replace(/^[-–*#\d.]+\s*/, '').trim();
    let title = cleaned;
    let year = '';

    let match = cleaned.match(/^(.*?)(?:\s+\(?(\d{4})\)?)?\s*$/);
    if (match) {
        title = match[1].trim();
        year = match[2] ? match[2].trim() : '';
    }

    try {
        const apiKey = 'trilogy';
        const omdbRes = await fetch(`https://www.omdbapi.com/?t=${encodeURIComponent(title)}${year ? '&y=' + year : ''}&apikey=${apiKey}`);
        const data = await omdbRes.json();

        if (data.Response === "True") {
            currentMovie = {
                title: data.Title,
                year: data.Year,
                synopsis: data.Plot,
                poster: data.Poster !== "N/A" ? data.Poster : 'https://via.placeholder.com/400x600?text=No+Poster'
            };
        } else {
            currentMovie = {
                title: title,
                year: year || 'N/A',
                synopsis: 'Synopsis currently unavailable.',
                poster: 'https://via.placeholder.com/400x600?text=No+Poster'
            };
        }
    } catch (err) {
        currentMovie = {
            title: title,
            year: year || 'N/A',
            synopsis: 'Failed to fetch movie details.',
            poster: 'https://via.placeholder.com/400x600?text=No+Poster'
        };
    }

    await preloadImage(currentMovie.poster);

    document.getElementById('movieTitle').innerText = currentMovie.title;
    document.getElementById('movieYear').innerText = currentMovie.year;
    document.getElementById('movieSynopsis').innerText = currentMovie.synopsis;
    document.getElementById('moviePoster').src = currentMovie.poster;
    document.getElementById('bgBackdrop').style.backgroundImage = `url('${currentMovie.poster}')`;
    document.getElementById('speakBtn').style.display = 'inline-block';

    await new Promise(resolve => setTimeout(resolve, 150));
    
    // Open curtains and let spotlight fade away
    document.getElementById('curtainOverlay').classList.add('open');
}

function preloadImage(url) {
    return new Promise((resolve) => {
        const img = new Image();
        img.src = url;
        img.onload = resolve;
        img.onerror = resolve;
    });
}

function toggleSpeech() {
    if (!('speechSynthesis' in window)) {
        alert("Text-to-speech is not supported in your browser.");
        return;
    }

    if (isSpeaking) {
        stopSpeech();
    } else {
        const textToSpeak = `${currentMovie.title}, released in ${currentMovie.year}. ${currentMovie.synopsis}`;
        const utterance = new SpeechSynthesisUtterance(textToSpeak);
        utterance.rate = 1.0;
        
        utterance.onend = () => {
            isSpeaking = false;
            document.getElementById('speakBtn').classList.remove('speaking');
            document.getElementById('speakBtn').innerText = '🔊 Listen';
        };

        window.speechSynthesis.speak(utterance);
        isSpeaking = true;
        document.getElementById('speakBtn').classList.add('speaking');
        document.getElementById('speakBtn').innerText = '⏹ Stop';
    }
}

function stopSpeech() {
    if ('speechSynthesis' in window) {
        window.speechSynthesis.cancel();
    }
    isSpeaking = false;
    const btn = document.getElementById('speakBtn');
    if (btn) {
        btn.classList.remove('speaking');
        btn.innerText = '🔊 Listen';
    }
}

window.onload = loadMoviesDatabase;
