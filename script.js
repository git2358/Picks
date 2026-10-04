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
await loadPoster(currentMovie);

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
.replace(/\b(19|20)\d{2}\b/g,'')
.replace(/[^a-z0-9]+/g,' ')
.replace(/\s+/g,' ')
.trim();
}

function exactTitleMatch(requested,result){
return normaliseTitle(requested)===normaliseTitle(result);
}

function getTitleScore(title,year,result){
let score=0;
const requested=normaliseTitle(title);
const candidate=normaliseTitle(result);

if(candidate===requested)score+=1000;

const lower=result.toLowerCase();

if(lower===title.toLowerCase())score+=500;
if(lower===`${title.toLowerCase()} (film)`)score+=400;
if(year&&lower===`${title.toLowerCase()} (${year} film)`)score+=450;

if(year){
const match=result.match(/\b(19|20)\d{2}\b/);
if(match&&match[0]===year)score+=100;
}

if(lower.includes('(film)'))score+=25;
if(lower.includes('film'))score+=10;

return score;
}

async function getWikipediaSummary(pageTitle){
try{
const response=await fetch(`https://en.wikipedia.org/api/rest_v1/page/summary/${encodeURIComponent(pageTitle)}`);
if(!response.ok)return null;

const data=await response.json();

if(data.type==='disambiguation'||!data.extract)return null;

return data;
}catch(error){
console.error('Wikipedia summary error:',error);
return null;
}
}

async function tryWikipediaTitle(title,year){
const candidates=[
title,
`${title} (film)`,
year?`${title} (${year} film)`:null
].filter(Boolean);

const seen=new Set();

for(const pageTitle of candidates){
const key=pageTitle.toLowerCase();

if(seen.has(key))continue;
seen.add(key);

const summaryData=await getWikipediaSummary(pageTitle);

if(!summaryData)continue;

if(!exactTitleMatch(title,summaryData.title||pageTitle))continue;

if(year){
const titleYear=(summaryData.title||pageTitle).match(/\b(19|20)\d{2}\b/);

if(titleYear&&titleYear[0]!==year)continue;

if(!titleYear){
const extractYear=summaryData.extract.match(/\b(19|20)\d{2}\b/);

if(extractYear&&extractYear[0]!==year)continue;
}
}

return summaryData;
}

return null;
}

async function searchWikipedia(title,year){
const queries=[
`"${title}" ${year?year+' ':''}film`,
`"${title}" film`,
`"${title}"`
];

const results=[];
const seen=new Set();

for(const query of queries){
try{
const response=await fetch(`https://en.wikipedia.org/w/api.php?action=query&list=search&srsearch=${encodeURIComponent(query)}&srlimit=10&format=json&origin=*`);

if(!response.ok)continue;

const data=await response.json();

if(!data.query?.search)continue;

for(const result of data.query.search){
if(seen.has(result.title))continue;

seen.add(result.title);
results.push(result);
}
}catch(error){
console.error('Wikipedia search error:',error);
}
}

results.sort((a,b)=>getTitleScore(title,year,b.title)-getTitleScore(title,year,a.title));

for(const result of results){
if(!exactTitleMatch(title,result.title))continue;

if(year){
const resultYear=result.title.match(/\b(19|20)\d{2}\b/);

if(resultYear&&resultYear[0]!==year)continue;
}

const summaryData=await getWikipediaSummary(result.title);

if(!summaryData)continue;

if(!exactTitleMatch(title,summaryData.title||result.title))continue;

if(year){
const titleYear=(summaryData.title||result.title).match(/\b(19|20)\d{2}\b/);

if(titleYear&&titleYear[0]!==year)continue;

if(!titleYear){
const extractYear=summaryData.extract.match(/\b(19|20)\d{2}\b/);

if(extractYear&&extractYear[0]!==year)continue;
}
}

return summaryData;
}

return null;
}

async function fetchMovieDetailsFromWikipedia(title,year){
try{
let summaryData=await tryWikipediaTitle(title,year);

if(!summaryData){
summaryData=await searchWikipedia(title,year);
}

if(summaryData){
return{
title:title,
year:year||'N/A',
synopsis:summaryData.extract,
poster:summaryData.thumbnail?.source||summaryData.originalimage?.source||fallbackPoster,
original:summaryData.originalimage?.source||null
};
}
}catch(error){
console.error('Error fetching from Wikipedia:',error);
}

return{
title:title,
year:year||'N/A',
synopsis:'Synopsis currently unavailable.',
poster:fallbackPoster,
original:null
};
}

function loadPoster(movie){
return new Promise(resolve=>{
const img=new Image();

img.onload=()=>{
movie.poster=img.src;
resolve();
};

img.onerror=()=>{
if(movie.original&&img.src!==movie.original){
img.src=movie.original;
}else{
movie.poster=fallbackPoster;
resolve();
}
};

if(movie.poster){
img.src=movie.poster;
}else if(movie.original){
img.src=movie.original;
}else{
movie.poster=fallbackPoster;
resolve();
}
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
