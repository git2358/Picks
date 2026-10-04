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
            document.getElementById('movieSynopsis').innerText = "No movies matching the 'Title YYYY' format were found in movies.txt.";
        }
    } catch (error) {
        document.getElementById('movieTitle').innerText = "Loading Error";
        document.getElementById('movieSynopsis').innerText = "Could not load movies.txt. Make sure you are running this through a local server.";
    }
}

async function pickRandomMovie() {
    if (movies.length === 0) return;

    stopSpeech();
    window.scrollTo({ top: 0, behavior: 'smooth' });

    let availableMovies = movies.filter(m => !viewedMovies.has(`${m.title} (${m.year})`));

    if (availableMovies.length === 0) {
        showFinalCurtains();
        return;
    }

    // 1. Close curtains first (remove open class)
    closeCurtains();

    // Wait for the closing transition (1000ms) before fetching data
    setTimeout(async () => {
        const randomMovie = availableMovies[Math.floor(Math.random() * availableMovies.length)];
        viewedMovies.add(`${randomMovie.title} (${randomMovie.year})`);
        
        document.getElementById('movieTitle').innerText = randomMovie.title;
        document.getElementById('movieYear').innerText = randomMovie.year ? randomMovie.year : '';
        document.getElementById('speakBtn').style.display = 'inline-block';
        
        let targetImgUrl = "";

        try {
            const query = encodeURIComponent(`${randomMovie.title} ${randomMovie.year}`);
            const res = await fetch(`https://en.wikipedia.org/w/api.php?action=query&list=search&srsearch=${query}&format=json&origin=*`);
            const data = await res.json();
            
            if (data.query && data.query.search.length > 0) {
                const pageTitle = data.query.search[0].title;
                const summaryRes = await fetch(`https://en.wikipedia.org/api/rest_v1/page/summary/${encodeURIComponent(pageTitle)}`);
                const summaryData = await summaryRes.json();

                if (summaryData.extract) {
                    currentSynopsisText = summaryData.extract;
                    document.getElementById('movieSynopsis').innerText = currentSynopsisText;
                } else {
                    currentSynopsisText = "No detailed synopsis available for this selection.";
                    document.getElementById('movieSynopsis').innerText = currentSynopsisText;
                }

                if (summaryData.thumbnail && summaryData.thumbnail.source) {
                    const imgUrl = summaryData.thumbnail.source;
                    const imgWidth = summaryData.thumbnail.width || 0;
                    const imgHeight = summaryData.thumbnail.height || 0;

                    if (imgHeight > imgWidth) {
                        targetImgUrl = imgUrl;
                    } else {
                        targetImgUrl = `https://via.placeholder.com/300x450/222/fff?text=${encodeURIComponent(randomMovie.title)}`;
                    }
                } else {
                    targetImgUrl = `https://via.placeholder.com/300x450/222/fff?text=${encodeURIComponent(randomMovie.title)}`;
                }
            } else {
                currentSynopsisText = "Synopsis could not be found automatically for this title.";
                document.getElementById('movieSynopsis').innerText = currentSynopsisText;
                targetImgUrl = `https://via.placeholder.com/300x450/222/fff?text=${encodeURIComponent(randomMovie.title)}`;
            }
        } catch (error) {
            currentSynopsisText = "Could not load data connection. Try clicking reload again!";
            document.getElementById('movieSynopsis').innerText = currentSynopsisText;
            targetImgUrl = `https://via.placeholder.com/300x450/222/fff?text=${encodeURIComponent(randomMovie.title)}`;
        }

        // 2. Preload poster image behind closed curtains before opening them
        const preloadImg = new Image();
        preloadImg.src = targetImgUrl;
        preloadImg.onload = () => {
            applyPoster(targetImgUrl);
            // 3. Open curtains once data and image are fully loaded
            openCurtains();
        };
        preloadImg.onerror = () => {
            applyPoster(targetImgUrl);
            openCurtains();
        };

    }, 1000);
}

function closeCurtains() {
    const overlay = document.getElementById('curtainOverlay');
    if (overlay) {
        overlay.classList.remove('show-spotlight');
        overlay.classList.remove('open');
    }
}

function openCurtains() {
    const overlay = document.getElementById('curtainOverlay');
    if (overlay) {
        overlay.classList.add('open');
    }
}

function showFinalCurtains() {
    stopSpeech();
    const overlay = document.getElementById('curtainOverlay');
    if (overlay) {
        overlay.classList.remove('open');
        setTimeout(() => {
            overlay.classList.add('show-spotlight');
        }, 1000); // Show spotlight after curtains finish closing
    }
}

function applyPoster(url) {
    const posterImg = document.getElementById('moviePoster');
    const bgBackdrop = document.getElementById('bgBackdrop');
    
    posterImg.src = url;
    bgBackdrop.style.backgroundImage = `url("${url}")`;
}

// Text-to-Speech logic
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
    utterance.rate = 1.05;
    utterance.pitch = 0.95;

    const voices = window.speechSynthesis.getVoices();
    let selectedVoice = voices.find(v => 
        v.lang.startsWith('en') && 
        (v.name.toLowerCase().includes('female') || v.name.toLowerCase().includes('woman') || v.name.toLowerCase().includes('samantha') || v.name.toLowerCase().includes('karen') || v.name.toLowerCase().includes('victoria') || v.name.toLowerCase().includes('zira') || v.name.toLowerCase().includes('hazel'))
    );
    
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
