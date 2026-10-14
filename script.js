let movies=[];
let watchedIndices=[];
let currentMovie=null;
let activeMovieSlug='';
let movieDisplayRequest=0;
let nextMovieRequest=0;
let historyNavigationRequest=0;
const movieLoadTimeout=15000;
let isSpeaking=false;
let speechTimeout=null;
let pullStartY=0;
let pullTracking=false;
let isPullRefreshing=false;
const pullRefreshThreshold=90;

const fallbackPoster='https://upload.wikimedia.org/wikipedia/commons/2/29/ButterflyDancebis.jpg';
const wikidataCache=new Map();
const wikipediaCache=new Map();
const wikidataEntityCache=new Map();
const movieDetailsCache=new Map();
let prefetchedNextIndex=null;
let prefetchInProgress=null;

async function loadMoviesDatabase(){
try{
const response=await fetch('movies.txt');
if(!response.ok)throw new Error(`HTTP error! status: ${response.status}`);
const text=await response.text();

movies=text.split(/\r?\n/)
.map(line=>line.trim())
.filter(line=>line.length>0&&!line.startsWith('#')&&!line.startsWith('##'));

if(!movies.length){
document.getElementById('movieTitle').innerText='No Movies Found';
document.getElementById('movieSynopsis').innerText='Please add items to your movies.txt file!';
return;
}

const isHomeScreenApp=window.navigator.standalone===true;
if(isHomeScreenApp&&location.hash){
history.replaceState(null,'',location.pathname+location.search);
}
const linkedIndex=isHomeScreenApp?-1:findMovieIndexFromHash();
if(linkedIndex>=0)normaliseMovieUrl(linkedIndex);
const navigationEntry=performance.getEntriesByType('navigation')[0];
const isPageRefresh=navigationEntry?.type==='reload';

window.addEventListener('popstate',handleMovieUrlChange);
window.addEventListener('hashchange',handleMovieUrlChange);

if(linkedIndex>=0&&isPageRefresh){
watchedIndices.push(linkedIndex);
await fetchNextMovie(false);
}else if(linkedIndex>=0){
watchedIndices.push(linkedIndex);
await displayMovieAtIndex(linkedIndex);
}else{
await fetchNextMovie(true);
}

setupPullToRefresh();
}catch(error){
console.error('Error loading movies.txt:',error);
document.getElementById('movieTitle').innerText='Error Loading File';
document.getElementById('movieSynopsis').innerText='Make sure you are running via a local web server (like VS Code Live Server) so movies.txt can be read correctly.';
}
}

function setupPullToRefresh(){
const indicator=document.createElement('div');
indicator.id='pullRefreshIndicator';
indicator.textContent='↓ Pull to get another movie';
document.body.append(indicator);

let pullDistance=0;

window.addEventListener('touchstart',event=>{
if(event.touches.length!==1||window.scrollY>0||isPullRefreshing)return;
if(event.target.closest('.synopsis-scroll-area'))return;
pullStartY=event.touches[0].clientY;
pullDistance=0;
pullTracking=true;
},{passive:true});

window.addEventListener('touchmove',event=>{
if(!pullTracking||event.touches.length!==1)return;
pullDistance=event.touches[0].clientY-pullStartY;
if(pullDistance<=0){
indicator.classList.remove('visible','ready');
return;
}
if(window.scrollY>0){
pullTracking=false;
indicator.classList.remove('visible','ready');
return;
}
event.preventDefault();
if(pullDistance>8){
indicator.classList.add('visible');
indicator.classList.toggle('ready',pullDistance>=pullRefreshThreshold);
indicator.textContent=pullDistance>=pullRefreshThreshold?'↑ Release for next movie':'↓ Pull to get another movie';
indicator.style.transform=`translate(-50%, ${Math.min(pullDistance*0.55,70)-70}px)`;
}
},{passive:false});

const finishPull=async()=>{
if(!pullTracking)return;
pullTracking=false;
const shouldRefresh=pullDistance>=pullRefreshThreshold;
indicator.classList.remove('visible','ready');
indicator.style.transform='';
if(shouldRefresh&&!isPullRefreshing&&movies.length){
isPullRefreshing=true;
try{
await fetchNextMovie();
}finally{
isPullRefreshing=false;
}
}
pullDistance=0;
};

window.addEventListener('touchend',finishPull,{passive:true});
window.addEventListener('touchcancel',()=>{
pullTracking=false;
pullDistance=0;
indicator.classList.remove('visible','ready');
indicator.style.transform='';
},{passive:true});
}

function parseMovieLine(line){
const cleaned=line.replace(/^[-–*#\d.]+\s*/,'').trim();
const match=cleaned.match(/^(.*?)(?:\s+(\d{4}))?\s*$/);
return {title:match?match[1].trim():cleaned,year:match?.[2]||''};
}

function movieSlug(title,year){
return normaliseTitle([title,year].filter(Boolean).join(' '));
}

function normaliseMovieUrl(index){
const movie=parseMovieLine(movies[index]);
const slug=movieSlug(movie.title,movie.year);
const movieUrl=`#${slug.replace(/\s+/g,'_')}`;
if(location.hash!==movieUrl)history.replaceState({movie:slug},'',movieUrl);
return slug;
}

function findMovieIndexFromHash(){
let slug=location.hash.slice(1);
try{slug=decodeURIComponent(slug);}catch(error){}
slug=normaliseTitle(slug.replace(/_/g,' '));
if(!slug)return -1;
return movies.findIndex(line=>{
const movie=parseMovieLine(line);
return movieSlug(movie.title,movie.year)===slug;
});
}

function scrollToTopAndWait(){
const synopsisArea=document.querySelector('.synopsis-scroll-area');
window.scrollTo({top:0,behavior:'smooth'});
if(synopsisArea)synopsisArea.scrollTo({top:0,behavior:'smooth'});
return new Promise(resolve=>{
let stableFrames=0;
const checkScroll=()=>{
const pageAtTop=window.scrollY<=1;
const synopsisAtTop=!synopsisArea||synopsisArea.scrollTop<=1;
if(pageAtTop&&synopsisAtTop){
stableFrames++;
if(stableFrames>=3){resolve();return;}
}else{
stableFrames=0;
}
requestAnimationFrame(checkScroll);
};
requestAnimationFrame(checkScroll);
});
}

async function handleMovieUrlChange(){
const index=findMovieIndexFromHash();
if(index<0)return;
const slug=normaliseMovieUrl(index);
if(activeMovieSlug===slug)return;
activeMovieSlug=slug;
const navigationRequest=++historyNavigationRequest;
if(!watchedIndices.includes(index))watchedIndices.push(index);

document.getElementById('movieBlurbSection').style.display='none';
document.title='Picks';
const overlay=document.getElementById('curtainOverlay');
stopSpeech();
await scrollToTopAndWait();
overlay.classList.remove('no-light');
overlay.classList.add('loading-movie');
await new Promise(resolve=>setTimeout(resolve,300));
overlay.classList.remove('open');
await new Promise(resolve=>setTimeout(resolve,1000));
await new Promise(resolve=>setTimeout(resolve,300));
if(navigationRequest!==historyNavigationRequest)return;
await displayMovieAtIndex(index);
}

async function fetchNextMovie(isInitial=false){
const requestId=++nextMovieRequest;
if(watchedIndices.length>=movies.length){
const overlay=document.getElementById('curtainOverlay');
stopSpeech();
await scrollToTopAndWait();
overlay.classList.remove('open','no-light','loading-movie');
await new Promise(resolve=>setTimeout(resolve,600));
overlay.classList.add('show-spotlight');
document.getElementById('reloadBtn').style.display='none';
return;
}

if(!isInitial){
document.getElementById('movieBlurbSection').style.display='none';
document.title='Picks';
const overlay=document.getElementById('curtainOverlay');
stopSpeech();
await scrollToTopAndWait();
overlay.classList.remove('no-light');
overlay.classList.add('loading-movie');
await new Promise(resolve=>setTimeout(resolve,300));
overlay.classList.remove('open');
await new Promise(resolve=>setTimeout(resolve,1000));
await new Promise(resolve=>setTimeout(resolve,300));
}
if(requestId!==nextMovieRequest)return;

if(prefetchInProgress){
const prefetchResult=await Promise.race([
prefetchInProgress.then(()=>true),
new Promise(resolve=>setTimeout(()=>resolve(false),movieLoadTimeout))
]);
if(requestId!==nextMovieRequest)return;
if(!prefetchResult){
prefetchedNextIndex=null;
prefetchInProgress=null;
}
}

const chooseRandomMovie=excludedIndex=>{
const candidates=movies.map((_,index)=>index).filter(index=>!watchedIndices.includes(index)&&index!==excludedIndex);
return candidates.length?candidates[Math.floor(Math.random()*candidates.length)]:-1;
};

let randomIndex;
if(prefetchedNextIndex!==null&&!watchedIndices.includes(prefetchedNextIndex)){
randomIndex=prefetchedNextIndex;
}else{
randomIndex=chooseRandomMovie(-1);
}
if(randomIndex<0)return;
prefetchedNextIndex=null;

const showMovie=async index=>{
const parsed=parseMovieLine(movies[index]);
const slug=movieSlug(parsed.title,parsed.year);
const movieUrl=`#${slug.replace(/\\s+/g,'_')}`;
await displayMovieAtIndex(index);
if(!document.getElementById('curtainOverlay').classList.contains('open')||activeMovieSlug!==slug)return;
if(isInitial){
history.replaceState({movie:slug},'',movieUrl);
}else{
history.pushState({movie:slug},'',movieUrl);
}
if(!watchedIndices.includes(index))watchedIndices.push(index);
};

await Promise.race([
showMovie(randomIndex).catch(error=>{
console.error('Movie failed to load:',error);
return 'timeout';
}),
new Promise(resolve=>setTimeout(()=>resolve('timeout'),movieLoadTimeout))
]);
if(requestId!==nextMovieRequest)return;

if(document.getElementById('curtainOverlay').classList.contains('open'))return;

const fallbackIndex=chooseRandomMovie(randomIndex);
if(fallbackIndex<0)return;
movieDisplayRequest++;
prefetchedNextIndex=null;
prefetchInProgress=null;
await showMovie(fallbackIndex);
}
async function displayMovieAtIndex(randomIndex){
const requestId=++movieDisplayRequest;
const overlay=document.getElementById('curtainOverlay');
overlay.classList.add('loading-movie');
const parsed=parseMovieLine(movies[randomIndex]);
activeMovieSlug=movieSlug(parsed.title,parsed.year);
const title=parsed.title;
const year=parsed.year;

let movie=movieDetailsCache.get(randomIndex);
if(!movie){
movie=await fetchMovieDetailsFromWikipedia(title,year);
movieDetailsCache.set(randomIndex,movie);
}
if(requestId!==movieDisplayRequest)return;
currentMovie=movie;
document.getElementById('movieTitle').innerText=currentMovie.title;
document.getElementById('movieYear').innerText=currentMovie.year;
document.getElementById('movieSynopsis').innerText=currentMovie.synopsis;
document.getElementById('movieBlurb').innerText=currentMovie.blurb;
document.getElementById('movieBlurbSection').style.display=currentMovie.blurb?'':'none';
document.getElementById('movieDetails').innerHTML=renderMovieDetails(currentMovie);
requestAnimationFrame(()=>requestAnimationFrame(updateSynopsisScrollHints));
document.getElementById('speakBtn').style.display='inline-block';

await loadPoster(currentMovie);
if(requestId!==movieDisplayRequest)return;
const posterElement=document.getElementById('moviePoster');
posterElement.onload=fitCardToPoster;
posterElement.src=currentMovie.poster;
if(posterElement.complete)fitCardToPoster();
document.getElementById('bgBackdrop').style.backgroundImage=`url('${currentMovie.poster}')`;

await new Promise(resolve=>setTimeout(resolve,150));
overlay.classList.remove('loading-movie');
overlay.classList.add('open');
document.title=`Picks - ${title}${year?' '+year:''}`;
setTimeout(()=>overlay.classList.add('no-light'),1050);
prefetchNextMovie();
}


async function prefetchNextMovie(){
if(prefetchInProgress||prefetchedNextIndex!==null||!movies.length||watchedIndices.length>=movies.length)return;
prefetchInProgress=(async()=>{
const attempted=new Set();
const timeoutResult=Symbol('prefetch-timeout');
try{
while(attempted.size<movies.length){
const candidates=movies.map((_,index)=>index).filter(index=>!watchedIndices.includes(index)&&!attempted.has(index));
if(!candidates.length)return;
const index=candidates[Math.floor(Math.random()*candidates.length)];
attempted.add(index);
const attempt=(async()=>{
let movie=movieDetailsCache.get(index);
if(!movie){
const parsed=parseMovieLine(movies[index]);
movie=await fetchMovieDetailsFromWikipedia(parsed.title,parsed.year);
movieDetailsCache.set(index,movie);
}
if(movie.synopsis==='Synopsis currently unavailable.'&&movie.poster===fallbackPoster){
throw new Error('Movie details could not be found');
}
await loadPoster(movie);
return movie;
})();
try{
const movie=await Promise.race([
attempt,
new Promise(resolve=>setTimeout(()=>resolve(timeoutResult),movieLoadTimeout))
]);
if(movie===timeoutResult){
console.warn('Movie preloading timed out; trying another movie:',movies[index]);
continue;
}
if(watchedIndices.includes(index))continue;
prefetchedNextIndex=index;
return;
}catch(error){
console.error('Movie preloading failed; trying another movie:',movies[index],error);
}
}
}finally{
prefetchInProgress=null;
}
})();
await prefetchInProgress;
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
return /^(honest|honour|hour|heir|heirloom|herb)\b/.test(word)||/^[aeiou]/.test(word)?'an':'a';
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

function updateSynopsisScrollHints(){
const shell=document.querySelector('.synopsis-scroll-shell');
const area=document.querySelector('.synopsis-scroll-area');
if(!shell||!area)return;
if(window.innerWidth<768){
shell.classList.remove('has-more-above','has-more-below');
return;
}
const maxScroll=area.scrollHeight-area.clientHeight;
shell.classList.toggle('has-more-above',area.scrollTop>2);
shell.classList.toggle('has-more-below',maxScroll-area.scrollTop>2);
}

const synopsisArea=document.querySelector('.synopsis-scroll-area');
if(synopsisArea){
synopsisArea.addEventListener('scroll',updateSynopsisScrollHints,{passive:true});
window.addEventListener('resize',updateSynopsisScrollHints);
if('ResizeObserver' in window){
const synopsisResizeObserver=new ResizeObserver(updateSynopsisScrollHints);
synopsisResizeObserver.observe(synopsisArea);
const synopsisShell=synopsisArea.closest('.synopsis-scroll-shell');
if(synopsisShell)synopsisResizeObserver.observe(synopsisShell);
}
window.addEventListener('load',updateSynopsisScrollHints);
}

function fitCardToPoster(){
const card=document.querySelector('.content-card');
const poster=document.getElementById('moviePoster');
const container=document.querySelector('.poster-container');

if(!card||!poster||!container)return;

let topFill=container.querySelector('.poster-fill-top');
let bottomFill=container.querySelector('.poster-fill-bottom');

if(!topFill){
topFill=document.createElement('div');
topFill.className='poster-fill poster-fill-top';
container.prepend(topFill);
}
if(!bottomFill){
bottomFill=document.createElement('div');
bottomFill.className='poster-fill poster-fill-bottom';
container.append(bottomFill);
}

if(window.innerWidth<768||!poster.naturalWidth||!poster.naturalHeight){
card.style.height='';
container.classList.remove('has-landscape-fill');
topFill.style.height='0';
bottomFill.style.height='0';
return;
}

const posterWidth=container.clientWidth;
const posterHeight=posterWidth*poster.naturalHeight/poster.naturalWidth;
const isWide=poster.naturalWidth/poster.naturalHeight>1.15;
const cardHeight=isWide?Math.max(560,posterHeight):posterHeight;

card.style.height=`${cardHeight}px`;
container.classList.toggle('has-landscape-fill',isWide);

if(isWide){
const spareHeight=Math.max(0,(cardHeight-posterHeight)/2);
topFill.style.height=`${spareHeight}px`;
bottomFill.style.height=`${spareHeight}px`;
container.style.setProperty('--poster-image',`url("${poster.currentSrc||poster.src}")`);
}else{
topFill.style.height='0';
bottomFill.style.height='0';
}
}

window.addEventListener('resize',fitCardToPoster);

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

function yearToSpeech(year){
const value=Number(year);
if(!Number.isInteger(value)||value<1000||value>2099)return year;
const small=['zero','one','two','three','four','five','six','seven','eight','nine'];
const tens=['','','twenty','thirty','forty','fifty','sixty','seventy','eighty','ninety'];
const underHundred=n=>n<10?small[n]:n<20?['ten','eleven','twelve','thirteen','fourteen','fifteen','sixteen','seventeen','eighteen','nineteen'][n-10]:tens[Math.floor(n/10)]+(n%10?'-'+small[n%10]:'');
if(value<2000){
const century=Math.floor(value/100);
const remainder=value%100;
const centuryWord=underHundred(century);
if(!remainder)return centuryWord+' hundred';
if(remainder<10)return centuryWord+' oh '+small[remainder];
return centuryWord+' '+underHundred(remainder);
}
if(value<2010){
const remainder=value%2000;
return remainder===0?'two thousand':'two thousand '+underHundred(remainder);
}
return 'twenty '+underHundred(value%2000-0);
}

function prepareSpeechText(text){
return String(text||'').replace(/\b(?:1[0-9]{3}|20[0-9]{2})\b/g,match=>yearToSpeech(match));
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

addSpeech(currentMovie.blurb,currentMovie.blurb?1000:250);
if(currentMovie.blurb&&currentMovie.synopsis)addSpeech('Furthermore');
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

const utterance=new SpeechSynthesisUtterance(prepareSpeechText(parts[index++]));
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
