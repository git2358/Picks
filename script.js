let movies = [];

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

    // Smooth scroll back to top on mobile when picking a new movie
    window.scrollTo({ top: 0, behavior: 'smooth' });

    const randomMovie = movies[Math.floor(Math.random() * movies.length)];
    
    document.getElementById('movieTitle').innerText = randomMovie.title;
    document.getElementById('movieYear').innerText = randomMovie.year ? `Released: ${randomMovie.year}` : '';
    
    // Show loading animations
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
                document.getElementById('movieSynopsis').innerText = summaryData.extract;
            } else {
                document.getElementById('movieSynopsis').innerText = "No detailed synopsis available for this selection.";
            }

            if (summaryData.thumbnail && summaryData.thumbnail.source) {
                const posterUrl = summaryData.thumbnail.source;
                applyPoster(posterUrl);
            } else {
                setDefaultPoster(randomMovie.title);
            }
        } else {
            hideLoaders();
            document.getElementById('movieSynopsis').innerText = "Synopsis could not be found automatically for this title.";
            setDefaultPoster(randomMovie.title);
        }
    } catch (error) {
        hideLoaders();
        document.getElementById('movieSynopsis').innerText = "Could not load data connection. Try clicking reload again!";
        setDefaultPoster(randomMovie.title);
    }
}

function showLoaders() {
    document.getElementById('posterLoader').style.display = 'flex';
    document.getElementById('moviePoster').style.display = 'none';
    
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

window.onload = loadMoviesDatabase;