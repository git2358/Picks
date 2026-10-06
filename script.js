let movies=[];
let watchedIndices=[];
let currentMovie=null;
let isSpeaking=false;
let speechTimeout=null;

const fallbackPoster='https://upload.wikimedia.org/wikipedia/commons/2/29/ButterflyDancebis.jpg';
const wikidataCache=new Map();
const wikipediaCache=new Map();
const wikidataEntityCache=new Map();

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
document.getElementById('movieBlurbSection').style.display='none';
const overlay=document.getElementById('curtainOverlay');
overlay.classList.remove('open','no-light');
stopSpeech();

window.scrollTo({top:0,behavior:'smooth'});

const synopsisArea=document.querySelector('.synopsis-scroll-area');
if(synopsisArea)synopsisArea.scrollTo({top:0,behavior:'smooth'});

await new Promise(resolve=>setTimeout(resolve,400));
}

let randomIndex;
do{
randomIndex=Math.floor(Math.random()*movies.length);
}while(watchedIndices.includes(randomIndex));

watchedIndices.push(randomIndex);

let cleaned=movies[randomIndex].replace(/^[-–*#\d.]+\s*/,'').trim();
let title=cleaned;
let year='';

const match=cleaned.match(/^(.*?)(?:\s+\(?(\d{4})\)?)?\s*$/);

if(match){
title=match[1].trim();
year=match[2]||'';
}

currentMovie=await fetchMovieDetailsFromWikipedia(title,year);

document.getElementById('movieTitle').innerText=currentMovie.title;
document.getElementById('movieYear').innerText=currentMovie.year;
document.getElementById('movieSynopsis').innerText=currentMovie.synopsis;
document.getElementById('movieBlurb').innerText=currentMovie.blurb;
document.getElementById('movieBlurbSection').style.display=currentMovie.blurb?'':'none';
document.getElementById('movieDetails').innerHTML=renderMovieDetails(currentMovie);
document.getElementById('moviePoster').src=currentMovie.poster;
document.getElementById('bgBackdrop').style.backgroundImage=`url('${currentMovie.poster}')`;
document.getElementById('speakBtn').style.display='inline-block';

loadPoster(currentMovie).then(()=>{
document.getElementById('moviePoster').src=currentMovie.poster;
document.getElementById('bgBackdrop').style.backgroundImage=`url('${currentMovie.poster}')`;
});

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
.normalize('NFD')
.replace(/[\u0300-\u036f]/g,'')
.replace(/&/g,'and')
.replace(/['’]/g,'')
.replace(/[^\p{L}\p{N}]+/gu,' ')
.replace(/\s+/g,' ')
.trim();
}

function titleWords(title){
return normaliseTitle(title).split(' ').filter(Boolean);
}

function titleSimilarity(a,b){
const x=normaliseTitle(a);
const y=normaliseTitle(b);

if(!x||!y)return 0;
if(x===y)return 1;

const ax=new Set(titleWords(a));
const bx=new Set(titleWords(b));
let common=0;

ax.forEach(word=>{
if(bx.has(word))common++;
});

return common/Math.max(ax.size,bx.size);
}

function getYearFromClaims(claims){
const claim=claims?.P577?.[0]?.mainsnak?.datavalue?.value?.time;
if(!claim)return '';

const match=claim.match(/\+(\d{4})-/);
return match?match[1]:'';
}

function isFilmEntity(entity){
const description=(entity.description?.value||'').toLowerCase();

if(description.includes('film')||
description.includes('movie')||
description.includes('motion picture')||
description.includes('feature-length')){
return true;
}

const filmTypes=[
'Q11424',
'Q24869',
'Q29168811',
'Q202866',
'Q506240',
'Q18011172',
'Q93204',
'Q130232',
'Q229390'
];

const p31=entity.claims?.P31||[];

return p31.some(claim=>{
const id=claim.mainsnak?.datavalue?.value?.id;
return filmTypes.includes(id);
});
}

function getAliases(entity){
const aliases=[];

if(entity.aliases){
Object.values(entity.aliases).forEach(list=>{
list.forEach(item=>{
if(item.value)aliases.push(item.value);
});
});
}

return aliases;
}

function scoreWikidataEntity(entity,title,year){
if(!isFilmEntity(entity))return -100000;

const label=entity.labels?.en?.value||'';
const aliases=getAliases(entity);
const requested=normaliseTitle(title);

let score=0;

if(normaliseTitle(label)===requested)score+=1000;

aliases.forEach(alias=>{
if(normaliseTitle(alias)===requested)score+=950;
});

const bestLabelSimilarity=titleSimilarity(title,label);

if(bestLabelSimilarity===1)score+=500;
else score+=bestLabelSimilarity*300;

aliases.forEach(alias=>{
score=Math.max(score,titleSimilarity(title,alias)*280);
});

const entityYear=getYearFromClaims(entity.claims);

if(year){
if(entityYear===year)score+=800;
else if(entityYear)score-=700;
}

if(entity.sitelinks?.enwiki)score+=150;

if(entity.description?.value){
const description=entity.description.value.toLowerCase();

if(description.includes('film'))score+=100;
if(description.includes('american film'))score+=20;
if(description.includes('british film'))score+=20;
if(description.includes('french film'))score+=20;
if(description.includes('italian film'))score+=20;
if(description.includes('german film'))score+=20;
if(description.includes('czech film'))score+=20;
}

return score;
}

async function searchWikidata(title,year){
const cacheKey=`${title}|${year}`;

if(wikidataCache.has(cacheKey)){
return wikidataCache.get(cacheKey);
}

const languages=['en','fr','it','de','es','cs','ru'];
const searches=languages.map(language=>()=>fetch(
`https://www.wikidata.org/w/api.php?action=wbsearchentities&search=${encodeURIComponent(title)}&language=${language}&uselang=en&type=item&limit=20&format=json&origin=*`
).then(response=>response.ok?response.json():null).catch(()=>null));

const responses=[];
for(let i=0;i<searches.length;i+=3){
responses.push(...await Promise.all(searches.slice(i,i+3).map(search=>search())));
}
const ids=new Set();

responses.forEach(data=>{
(data?.search||[]).forEach(result=>{
if(result.id)ids.add(result.id);
});
});

if(!ids.size){
wikidataCache.set(cacheKey,null);
return null;
}

const entityResponse=await fetch(
`https://www.wikidata.org/w/api.php?action=wbgetentities&ids=${[...ids].join('|')}&props=labels|aliases|claims|sitelinks&languages=en&sitefilter=enwiki&format=json&origin=*`
);

if(!entityResponse.ok){
wikidataCache.set(cacheKey,null);
return null;
}

const entityData=await entityResponse.json();
const entities=Object.values(entityData.entities||{});

entities.sort((a,b)=>scoreWikidataEntity(b,title,year)-scoreWikidataEntity(a,title,year));

for(const entity of entities){
const score=scoreWikidataEntity(entity,title,year);

if(score<500)continue;

const entityYear=getYearFromClaims(entity.claims);

if(year&&entityYear&&entityYear!==year)continue;

const wikipediaTitle=entity.sitelinks?.enwiki?.title;

if(!wikipediaTitle)continue;

const result={
id:entity.id,
title:entity.labels?.en?.value||title,
year:entityYear||year||'',
wikipediaTitle,
claims:entity.claims||{}
};

wikidataCache.set(cacheKey,result);
return result;
}

wikidataCache.set(cacheKey,null);
return null;
}

async function getWikipediaSummary(pageTitle){
if(wikipediaCache.has(pageTitle)){
return wikipediaCache.get(pageTitle);
}

try{
const response=await fetch(
`https://en.wikipedia.org/api/rest_v1/page/summary/${encodeURIComponent(pageTitle)}`
);

if(!response.ok){
wikipediaCache.set(pageTitle,null);
return null;
}

const data=await response.json();

if(data.type==='disambiguation'||!data.extract){
wikipediaCache.set(pageTitle,null);
return null;
}

wikipediaCache.set(pageTitle,data);
return data;
}catch(error){
console.error('Wikipedia summary error:',error);
wikipediaCache.set(pageTitle,null);
return null;
}
}

async function searchWikipediaFallback(title,year){
const queries=[
`"${title}" ${year} film`,
`"${title}" film`,
`"${title}"`
];

for(const query of queries){
try{
const response=await fetch(
`https://en.wikipedia.org/w/api.php?action=query&list=search&srsearch=${encodeURIComponent(query)}&srlimit=20&format=json&origin=*`
);

if(!response.ok)continue;

const data=await response.json();

for(const result of data.query?.search||[]){
const summary=await getWikipediaSummary(result.title);

if(!summary)continue;

const summaryTitle=summary.title||result.title;
const similarity=titleSimilarity(title,summaryTitle);
const summaryText=(summary.extract||'').toLowerCase();

if(similarity<0.85)continue;
if(!summaryText.includes('film')&&!summaryText.includes('movie'))continue;

const foundYears=summary.extract.match(/\b(19|20)\d{2}\b/g)||[];

if(year&&!foundYears.includes(year)){
if(result.title.match(/\b(19|20)\d{2}\b/)?.[0]!==year)continue;
}

return summary;
}
}catch(error){
console.error('Wikipedia search error:',error);
}
}

return null;
}

async function fetchMovieDetailsFromWikipedia(title,year){
try{
const wikidata=await searchWikidata(title,year);

if(wikidata){
const summary=await getWikipediaSummary(wikidata.wikipediaTitle);

if(summary){
const details=await getMovieDetails(wikidata);
return{
title:title,
year:year||wikidata.year||'N/A',
synopsis:summary.extract,
blurb:buildMovieBlurb(summary.extract,title,year||wikidata.year),
details,
poster:summary.thumbnail?.source||summary.originalimage?.source||fallbackPoster,
original:summary.originalimage?.source||null
};
}
}
const fallback=await searchWikipediaFallback(title,year);

if(fallback){
return{
title:title,
year:year||'N/A',
synopsis:fallback.extract,
blurb:buildMovieBlurb(fallback.extract,title,year),
details:{},
poster:fallback.thumbnail?.source||fallback.originalimage?.source||fallbackPoster,
original:fallback.originalimage?.source||null
};
}
}catch(error){
console.error('Error fetching movie details:',error);
}

return{
title:title,
year:year||'N/A',
synopsis:'Synopsis currently unavailable.',
blurb:'Movie information currently unavailable.',
details:{},
poster:fallbackPoster,
original:null
};
}

async function getWikidataEntityLabel(id){
if(!id)return '';
if(wikidataEntityCache.has(id))return wikidataEntityCache.get(id);
try{
const response=await fetch(`https://www.wikidata.org/w/api.php?action=wbgetentities&ids=${id}&props=labels&languages=en&format=json&origin=*`);
if(!response.ok)return '';
const data=await response.json();
const label=data.entities?.[id]?.labels?.en?.value||'';
wikidataEntityCache.set(id,label);
return label;
}catch(error){return '';}
}

function getClaimIds(claims,property){
return (claims?.[property]||[]).map(claim=>claim.mainsnak?.datavalue?.value?.id).filter(Boolean);
}

async function getMovieDetails(wikidata){
const claims=wikidata.claims||{};
const ids=[...new Set([
...getClaimIds(claims,'P57'),
...getClaimIds(claims,'P161'),
...getClaimIds(claims,'P136'),
...getClaimIds(claims,'P495'),
...getClaimIds(claims,'P364')
])];

let labels={};

if(ids.length){
try{
const response=await fetch(
`https://www.wikidata.org/w/api.php?action=wbgetentities&ids=${ids.join('|')}&props=labels&languages=en&format=json&origin=*`
);
if(response.ok){
const data=await response.json();
Object.entries(data.entities||{}).forEach(([id,entity])=>{
labels[id]=entity.labels?.en?.value||'';
});
}
}catch(error){}
}

const list=property=>getClaimIds(claims,property).map(id=>labels[id]).filter(Boolean);
const runtimeClaim=claims.P2047?.[0]?.mainsnak?.datavalue?.value;
let runtime='';

if(runtimeClaim?.amount){
const value=Math.abs(Number(runtimeClaim.amount));
if(Number.isFinite(value)){
const minutes=Math.round(value);
runtime=minutes>=60?Math.floor(minutes/60)+' h '+minutes%60+' min':minutes+' min';
}
}

return{
director:list('P57').slice(0,1).join(''),
cast:list('P161').slice(0,5),
genre:formatGenres(list('P136').slice(0,3)),
country:list('P495').slice(0,2),
language:list('P364').slice(0,2),
runtime
};
}

function buildMovieBlurb(extract,title,year){
if(!extract)return '';

const sentences=(extract.match(/[^.!?]+[.!?]+(?:\s|$)/g)||[])
.map(sentence=>sentence.trim())
.filter(Boolean);

const metadata=/\b(?:is|was)\s+(?:an?|the)\s+(?:19|20)\d{2}\s+(?:American|British|Australian|Canadian|French|German|Italian|Spanish|Japanese|film|movie)\b|\b(?:film|movie)\s+(?:directed|written|produced)\b|\b(?:directed|written|produced)\s+by\b|\b(?:released|premiered)\b|\b(?:starring|stars)\b/i;

const story=/\b(?:follows|follows the|centers on|centres on|about|after|when|where|whose|must|tries|attempts|sets out|travels|returns|discovers|finds|becomes|joins|seeks|searches|escapes|fights|battles|protects|survives|struggles|investigates|is sent|is tasked|is forced|is hired|is drawn|is caught|is stranded|is trapped|is pursued|is targeted|is recruited)\b/i;

const candidates=sentences.filter(sentence=>!metadata.test(sentence));

let selected=candidates.filter(sentence=>story.test(sentence));

if(!selected.length)selected=candidates;

if(!selected.length)return '';

let blurb=selected.slice(0,2).join(' ');

blurb=blurb.replace(/\s+/g,' ').trim();

if(blurb.length>360){
blurb=blurb.slice(0,357).replace(/\s+\S*$/,'')+'...';
}

return blurb;
}

function genreArticle(genre){
const word=genre.trim().toLowerCase();
return /^(honest|honour|hour|heir|heirloom|herb)\b/.test(word)||/^[aeiou]\b/.test(word)?'an':'a';
}

function formatGenres(genres){
const clean=[...new Set(genres.map(genre=>genre.replace(/\s+film$/i,'').trim()).filter(Boolean))];
return clean;
}

function renderMovieDetails(movie){
const d=movie.details||{};
const rows=[];
const add=(label,value)=>{if(value)rows.push(`<div class="detail-row"><span class="detail-label">${label}</span><span class="detail-value">${value}</span></div>`);};
add('Director',d.director);
add('Cast',d.cast?.join(', '));
add('Genre',d.genre?.join(' · '));
add('Runtime',d.runtime);
add('Released',movie.year&&movie.year!=='N/A'?movie.year:'');
add('Country',d.country?.join(' · '));
add('Language',d.language?.join(' · '));
return rows.length?rows.join(''):'<div class="detail-row"><span class="detail-value">Additional details unavailable.</span></div>';
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
const title=currentMovie.title||'';
const year=currentMovie.year&&currentMovie.year!=='N/A'?currentMovie.year:'';
const genres=currentMovie.details?.genre||[];
const parts=[];
const pauses=[];

const addSpeech=(text,delay=250)=>{
if(text){
parts.push(text);
pauses.push(delay);
}
};

addSpeech(year?'released '+year:'');
addSpeech(title);

if(genres.length===1){
addSpeech('is '+genreArticle(genres[0])+' '+genres[0]+' film');
}else if(genres.length>1){
addSpeech('is '+genreArticle(genres[0])+' '+genres[0],genres.length===2?0:125);
genres.slice(1,-1).forEach((genre,i,items)=>addSpeech(genre,i===items.length-1?0:125));
addSpeech('and '+genres[genres.length-1]+' film',250);
}

addSpeech(currentMovie.blurb,currentMovie.blurb?500:250);
addSpeech(currentMovie.synopsis);

let index=0;
isSpeaking=true;

document.getElementById('speakBtn').classList.add('speaking');
document.getElementById('speakBtn').innerText='⏹ Stop';

const speakNext=()=>{
if(!isSpeaking||index>=parts.length){
if(isSpeaking){
isSpeaking=false;
document.getElementById('speakBtn').classList.remove('speaking');
document.getElementById('speakBtn').innerText='🔊 Listen';
}
return;
}

const utterance=new SpeechSynthesisUtterance(parts[index++]);
utterance.rate=1;

utterance.onend=()=>{
if(!isSpeaking)return;
speechTimeout=setTimeout(speakNext,pauses[index-1]??250);
};

window.speechSynthesis.speak(utterance);
};

speakNext();
}
}


function stopSpeech(){
if('speechSynthesis' in window)window.speechSynthesis.cancel();

if(speechTimeout){
clearTimeout(speechTimeout);
speechTimeout=null;
}

isSpeaking=false;

const btn=document.getElementById('speakBtn');

if(btn){
btn.classList.remove('speaking');
btn.innerText='🔊 Listen';
}
}


window.onload=loadMoviesDatabase;
