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
        
        // Handle both Windows (\r\n) and Unix (\n) line endings cleanly
        movies = text.split(/\r?\n/)
            .map(line => line.trim())
            .filter(line => line.length > 0 && !line.startsWith('#')); // Ignore comments/empty rows

        if (movies.length === 0) {
            document.getElementById('movieTitle').innerText = "No Movies Found";
            document.getElementById('movieSynopsis').innerText = "Please add items to your movies.txt file!";
            return;
        }

        // Initial load
        await fetchNextMovie(true);
    } catch (error) {
        console.error("Error loading movies.txt:", error);
        document.getElementById('movieTitle').innerText = "Error Loading File";
        document.getElementById('movieSynopsis').innerText = "Make sure you are running via a local web server (like VS Code Live Server) so movies.txt can be read correctly.";
    }
}

async function fetchNextMovie(isInitial = false) {
    if (watchedIndices.length >= movies.length) {
        // All movies watched - close curtains and trigger spotlight text
        document.getElementById('curtainOverlay').classList.remove('open');
        document.getElementById('curtainOverlay').classList.add('show-spotlight');
        document.getElementById('reloadBtn').style.display = 'none';
        return;
    }

    if (!isInitial) {
        // Close curtains before fetching the next movie
        document.getElementById('curtainOverlay').classList.remove('open');
        stopSpeech();
        await new Promise(resolve => setTimeout(resolve, 1000)); // Wait for curtains to close
    }

    // Pick a random unwatched movie
    let randomIndex;
    do {
        randomIndex = Math.floor(Math.random() * movies.length);
    } while (watchedIndices.includes(randomIndex));

    watchedIndices.push(randomIndex);
    let rawLine = movies[randomIndex];

    // Clean up typical formatting markers (-, *, numbers, etc.)
    let cleaned = rawLine.replace(/^[-–*#\d.]+\s*/, '').trim();
    let title = cleaned;
    let year = '';

    // Match year format at the end of the line (e.g., "Inception 2010" or "Inception (2010)")
    let match = cleaned.match(/^(.*?)(?:\s+\(?(\d{4})\)?)?\s*$/);
    if (match) {
        title = match[1].trim();
        year = match[2] ? match[2].trim() : '';
    }

    // Fetch details from OMDB API
    try {
        const apiKey = 'trilogy'; // Public backup key or replace with your own
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

    // Preload poster image before opening curtains
    await preloadImage(currentMovie.poster);

    // Update DOM content
    document.getElementById('movieTitle').innerText = currentMovie.title;
    document.getElementById('movieYear').innerText = currentMovie.year;
    document.getElementById('movieSynopsis').innerText = currentMovie.synopsis;
    document.getElementById('moviePoster').src = currentMovie.poster;
    document.getElementById('bgBackdrop').style.backgroundImage = `url('${currentMovie.poster}')`;
    document.getElementById('speakBtn').style.display = 'inline-block';

    // Slight pause to ensure render, then open curtains
    await new Promise(resolve => setTimeout(resolve, 150));
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
