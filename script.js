let movies=[];
let watchedIndices=[];
let currentMovie=null;
let isSpeaking=false;

const fallbackPoster='https://upload.wikimedia.org/wikipedia/commons/2/29/ButterflyDancebis.jpg';

async function loadMoviesDatabase(){
try{
const response=await fetch('movies.txt');
if(!response.ok)throw new Error(`HTTP error! status: ${response.status}`);
const text=await response.text();

movies=text.split(/\r?\n/)
.map(line=>line.trim())
.filter(line=>line.length>0&&!line.startsWith('#'));

if(!movies.length){
document.getElementById('movieTitle').innerText='No Movies Found';
document.getElementById('movieSynopsis').innerText='Please add items to your movies.txt file!';
return;
}

await fetchNextMovie(true);
}catch(error){
console.error('Error loading movies.txt:',error);
document.getElementById('movieTitle').innerText='Error Loading File';
document.getElementById('movieSynopsis').innerText='Make sure you are running via a local web server (like VS Code Live Server) so movies.txt can be read correctly.';
}
}

async function fetchNextMovie(isInitial=false){
if(watchedIndices.length>=movies.length){
const overlay=document.getElementById('curtainOverlay');
overlay.classList.remove('open','no-light');
stopSpeech();

window.scrollTo({top:0,behavior:'smooth'});

const synopsisArea=document.querySelector('.synopsis-scroll-area');
if(synopsisArea)synopsisArea.scrollTo({top:0,behavior:'smooth'});

await new Promise(resolve=>setTimeout(resolve,600));
overlay.classList.add('show-spotlight');
document.getElementById('reloadBtn').style.display='none';
return;
}

if(!isInitial){
const overlay=document.getElementById('curtainOverlay');
overlay.classList.remove('open','no-light');
stopSpeech();

window.scrollTo({top:0,behavior:'smooth'});

const synopsisArea=document.querySelector('.synopsis-scroll-area');
if(synopsisArea)synopsisArea.scrollTo({top:0,behavior:'smooth'});

await new Promise(resolve=>setTimeout(resolve,1000));
}

let randomIndex;
do{
randomIndex=Math.floor(Math.random()*movies.length);
}while(watchedIndices.includes(randomIndex));

watchedIndices.push(randomIndex);

let rawLine=movies[randomIndex];
let cleaned=rawLine.replace(/^[-–*#\d.]+\s*/,'').trim();
let title=cleaned;
let year='';

let match=cleaned.match(/^(.*?)(?:\s+\(?(\d{4})\)?)?\s*$/);

if(match){
title=match[1].trim();
year=match[2]?match[2].trim():'';
}

currentMovie=await fetchMovieDetailsFromWikipedia(title,year);
currentMovie.poster=await preloadImage(currentMovie.poster);

document.getElementById('movieTitle').innerText=currentMovie.title;
document.getElementById('movieYear').innerText=currentMovie.year;
document.getElementById('movieSynopsis').innerText=currentMovie.synopsis;
document.getElementById('moviePoster').src=currentMovie.poster;
document.getElementById('bgBackdrop').style.backgroundImage=`url('${currentMovie.poster}')`;
document.getElementById('speakBtn').style.display='inline-block';

await new Promise(resolve=>setTimeout(resolve,150));

const overlay=document.getElementById('curtainOverlay');
overlay.classList.add('open');

setTimeout(()=>{
overlay.classList.add('no-light');
},500);
}

function normaliseTitle(title){
return title
.toLowerCase()
.replace(/\([^)]*\)/g,'')
.replace(/[^a-z0-9]+/g,' ')
.replace(/\s+/g,' ')
.trim();
}

function titleMatches(requestedTitle,resultTitle){
const requested=normaliseTitle(requestedTitle);
const result=normaliseTitle(resultTitle);

return result===requested||result.startsWith(requested+' ')||requested.startsWith(result+' ');
}

async function fetchMovieDetailsFromWikipedia(title,year){
try{
const searchQuery=`${title} ${year?year+' ':''}film`.trim();

const searchRes=await fetch(`https://en.wikipedia.org/w/api.php?action=query&list=search&srsearch=${encodeURIComponent(searchQuery)}&srlimit=10&format=json&origin=*`);
const searchData=await searchRes.json();

if(searchData.query&&searchData.query.search.length>0){
let results=searchData.query.search;

results.sort((a,b)=>{
const aTitle=normaliseTitle(a.title);
const bTitle=normaliseTitle(b.title);
const requested=normaliseTitle(title);

const score=result=>{
let value=0;

if(a.title===title)value+=100;
if(normaliseTitle(result.title)===requested)value+=90;
if(result.title.match(new RegExp(`\\b${year}\\b`)))value+=20;
if(result.title.toLowerCase().includes('(film)'))value+=10;
if(result.title.toLowerCase().includes('film'))value+=5;

return value;
};

return score(b)-score(a);
});

for(const result of results){
const pageTitle=result.title;

if(!titleMatches(title,pageTitle))continue;

if(year){
const titleYear=pageTitle.match(/\b(19|20)\d{2}\b/);

if(titleYear&&titleYear[0]!==year)continue;
}

const summaryRes=await fetch(`https://en.wikipedia.org/api/rest_v1/page/summary/${encodeURIComponent(pageTitle)}`);
const summaryData=await summaryRes.json();

if(summaryData.type==='disambiguation'||!summaryData.extract)continue;

if(year){
const titleYear=pageTitle.match(/\b(19|20)\d{2}\b/);

if(titleYear&&titleYear[0]!==year){
continue;
}

if(!titleYear){
const extractYear=summaryData.extract.match(/\b(19|20)\d{2}\b/);

if(extractYear&&extractYear[0]!==year){
continue;
}
}
}

return{
title:title,
year:year||'N/A',
synopsis:summaryData.extract,
poster:summaryData.thumbnail?.source||summaryData.originalimage?.source||fallbackPoster
};
}
}
}catch(err){
console.error('Error fetching from Wikipedia:',err);
}

return{
title:title,
year:year||'N/A',
synopsis:'Synopsis currently unavailable.',
poster:fallbackPoster
};
}

function preloadImage(url){
return new Promise(resolve=>{
const img=new Image();

img.onload=()=>resolve(url);
img.onerror=()=>resolve(fallbackPoster);

img.src=url||fallbackPoster;
});
}

function toggleSpeech(){
if(!('speechSynthesis' in window)){
alert('Text-to-speech is not supported in your browser.');
return;
}

if(isSpeaking){
stopSpeech();
}else{
const utterance=new SpeechSynthesisUtterance(currentMovie.synopsis);
utterance.rate=1;

utterance.onend=()=>{
isSpeaking=false;
document.getElementById('speakBtn').classList.remove('speaking');
document.getElementById('speakBtn').innerText='🔊 Listen';
};

window.speechSynthesis.speak(utterance);
isSpeaking=true;

document.getElementById('speakBtn').classList.add('speaking');
document.getElementById('speakBtn').innerText='⏹ Stop';
}
}

function stopSpeech(){
if('speechSynthesis' in window)window.speechSynthesis.cancel();

isSpeaking=false;

const btn=document.getElementById('speakBtn');

if(btn){
btn.classList.remove('speaking');
btn.innerText='🔊 Listen';
}
}

window.onload=loadMoviesDatabase;
